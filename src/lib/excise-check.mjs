// Luxembourg excise rate check, shared by the bi-weekly cron (scripts/check-excise-rates.js) and the
// admin panel's "check now" button (src/app/api/admin/excise-rates/route.js).
//
// 2026-11-06. Before this, both copies fetched three ae.gouvernement.lu pages (that domain no longer
// resolves), used a retired model, asked for 15 keys of which 5 no longer exist in the rates file, and
// when nothing was fetched they "verified" the rates from model memory and stamped them as checked.
// Now:
//   1. read the official index page (douanes.public.lu) and pick the newest table already in force
//      (taux-accises-lu-DDMMYYYY.pdf, effective date <= today);
//   2. send that PDF to Claude with every key of the rates file and its unit;
//   3. structured output (JSON schema) -> one value per key the table states;
//   4. apply changes, except implausible ones (> 50 % relative move), which are reported for a human.
// If the official table cannot be fetched, nothing is written (ExciseCheckError).

import { readFileSync, writeFileSync, renameSync, realpathSync } from 'node:fs'

const INDEX_URL = 'https://douanes.public.lu/fr/accises/taux-droits-accise.html'
const ORIGIN = 'https://douanes.public.lu'
const MAX_RELATIVE_CHANGE = 0.5

// What each key of data/excise-rates.json means, in the official table's terms ("Total" column).
const KEY_HELP = {
  beer_small: 'Bières <= 50.000 hl/année (Cat. 1), EUR per hl per degree Plato',
  beer_medium: 'Bières <= 200.000 hl/année (Cat. 2), EUR per hl per degree Plato',
  beer_large: 'Bières > 200.000 hl/année (Cat. 3), EUR per hl per degree Plato',
  'still-wine': 'Vins tranquilles, EUR per hl',
  'sparkling-wine': 'Vins mousseux, EUR per hl',
  intermediate_low: 'Produits intermédiaires <= 15 degrees, EUR per hl',
  intermediate_high: 'Produits intermédiaires > 15 degrees, EUR per hl',
  spirits: 'Alcools 100% vol., EUR per hl of pure alcohol (Total column)',
  cigarettes_specific: 'Cigarettes, specific duty, EUR per 1000 pieces (Total column)',
  cigarettes_advalorem: 'Cigarettes, ad valorem total as a decimal (e.g. 48.14% -> 0.4814)',
  cigarettes_minimum: 'Cigarettes, minimum, EUR per 1000 pieces',
  cigars_advalorem: 'Cigares / Cigarillos, ad valorem total as a decimal',
  cigars_minimum: 'Cigares / Cigarillos, minimum, EUR per 1000 pieces',
  fine_cut_specific: 'Tabacs fine coupe et autres tabacs, specific duty, EUR per kg',
  fine_cut_advalorem: 'Tabacs fine coupe et autres tabacs, ad valorem total as a decimal',
  fine_cut_minimum: 'Tabacs fine coupe et autres tabacs, minimum, EUR per kg',
  heated_tobacco_advalorem: 'Tabac à chauffer, ad valorem total as a decimal',
  heated_tobacco_specific: 'Tabac à chauffer, specific duty, EUR per kg',
  eliquid: 'E-liquide, specific duty, EUR per litre',
  nicotine_pouches: 'Sachets de nicotine, specific duty, EUR per kg',
  petrol: 'Essence sans plomb <= 10 mg/kg soufre, Total, converted to EUR per litre (table is per 1000 l)',
  diesel: 'Gasoil carburant <= 10 mg/kg soufre, Total, converted to EUR per litre (table is per 1000 l)',
  heating_fuel: 'Fioul domestique (chauffage), Total, converted to EUR per litre (table is per 1000 l)',
  lpg: 'LPG / Méthane carburant, Total, converted to EUR per kg (table is per 1000 kg)',
}

export class ExciseCheckError extends Error {}

async function get(url, as = 'text') {
  const resp = await fetch(url, { headers: { 'User-Agent': 'dutify-excise-check' }, signal: AbortSignal.timeout(20000) })
  if (!resp.ok) throw new Error(`${url}: HTTP ${resp.status}`)
  return as === 'buffer' ? Buffer.from(await resp.arrayBuffer()) : resp.text()
}

// Newest table whose effective date (from the file name) is not in the future.
async function currentTable(now) {
  const html = await get(INDEX_URL)
  const tables = [...new Set(html.match(/\/content\/dam\/douanes\/fr\/accises\/taux-accises-lu-\d{8}\.pdf/g) ?? [])]
    .map(path => {
      const [, dd, mm, yyyy] = path.match(/(\d{2})(\d{2})(\d{4})\.pdf$/)
      return { url: ORIGIN + path, from: `${dd}.${mm}.${yyyy}`, date: new Date(`${yyyy}-${mm}-${dd}T00:00:00Z`) }
    })
    .filter(t => t.date <= now)
    .sort((a, b) => b.date - a.date)
  if (!tables.length) throw new Error(`no taux-accises-lu-DDMMYYYY.pdf link found on ${INDEX_URL}`)
  return tables[0]
}

async function extract(apiKey, pdf, keys, current) {
  // A list of {key, value} pairs: a rate the table does not state is simply left out. (Nullable fields
  // would be simpler, but the API allows at most 16 union-typed parameters per schema.)
  const schema = {
    type: 'object',
    properties: {
      rates: {
        type: 'array',
        items: {
          type: 'object',
          properties: { key: { type: 'string', enum: keys }, value: { type: 'number' } },
          required: ['key', 'value'],
          additionalProperties: false,
        },
      },
      confidence: { type: 'string', enum: ['high', 'medium', 'low'] },
      notes: { type: 'string' },
    },
    required: ['rates', 'confidence', 'notes'],
    additionalProperties: false,
  }
  const resp = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      // Server-side refusal fallback: a declined request is re-run on Anthropic's recommended model.
      'anthropic-beta': 'server-side-fallback-2026-07-01',
    },
    body: JSON.stringify({
      // claude-sonnet-4-20250514 (used before) was retired on 2026-06-15.
      model: 'claude-sonnet-5-5',
      // Sonnet 5.5 thinks by default and thinking counts against max_tokens, so leave room.
      max_tokens: 16000,
      output_config: { effort: 'medium', format: { type: 'json_schema', schema } },
      fallbacks: 'default',
      system: 'You read the official Luxembourg excise duty table (Administration des douanes et accises) and return the rate for each requested key exactly as printed, converted only where the key description says so. Use the "Total" column. Leave out any key the table does not state; never estimate.',
      messages: [{
        role: 'user',
        content: [
          { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: pdf.toString('base64') } },
          { type: 'text', text: `Keys and their meaning:\n${keys.map(k => `- ${k}: ${KEY_HELP[k] ?? 'see the table'}`).join('\n')}\n\nCurrently stored values, for reference only (the table is authoritative):\n${JSON.stringify(current, null, 2)}` },
        ],
      }],
    }),
  })
  if (!resp.ok) throw new Error(`Anthropic API error: ${resp.status} ${(await resp.text()).slice(0, 300)}`)
  const data = await resp.json()
  if (data.stop_reason === 'refusal') throw new Error(`model declined (${data.stop_details?.category ?? 'no category'})`)
  if (data.stop_reason === 'max_tokens') throw new Error('response truncated at max_tokens')
  const text = data.content?.find(b => b.type === 'text')?.text
  if (!text) throw new Error(`no text block in response (stop_reason ${data.stop_reason})`)
  const parsed = JSON.parse(text)
  return { ...parsed, rates: Object.fromEntries(parsed.rates.map(r => [r.key, r.value])) }
}

/**
 * Check the stored rates against the official table in force and write the result.
 * @param {{ ratesFile: string, apiKey?: string, dryRun?: boolean, logFile?: string }} opts
 * @returns {Promise<{ table: {url: string, from: string}, changes: {key: string, from: number, to: number}[],
 *   held: {key: string, from: number, to: number}[], missing: string[], confidence: string, notes: string,
 *   source: string, lastChecked: string, written: boolean }>}
 * @throws {ExciseCheckError} when the rates file, the official table or the extraction fails (nothing written)
 */
export async function runExciseCheck({ ratesFile, apiKey = process.env.ANTHROPIC_API_KEY, dryRun = false, logFile = '/var/log/apps/apps/dutify-excise.log' }) {
  if (!apiKey) throw new ExciseCheckError('ANTHROPIC_API_KEY not set')
  // The live app reads a symlink to the real file (.next/standalone/data -> data/); write through it.
  let file, stored
  try {
    file = realpathSync(ratesFile)
    stored = JSON.parse(readFileSync(file, 'utf8'))
  } catch (e) { throw new ExciseCheckError(`Could not read ${ratesFile}: ${e.message}`) }
  const keys = Object.keys(stored.rates)

  let table, pdf
  try {
    table = await currentTable(new Date())
    pdf = await get(table.url, 'buffer')
    if (pdf.subarray(0, 5).toString() !== '%PDF-') throw new Error(`${table.url} is not a PDF`)
  } catch (e) { throw new ExciseCheckError(`Official table not available: ${e.message}`) }

  let extracted
  try { extracted = await extract(apiKey, pdf, keys, stored.rates) } catch (e) { throw new ExciseCheckError(`Extraction failed: ${e.message}`) }

  const changes = [], held = [], missing = []
  for (const key of keys) {
    const from = stored.rates[key], to = extracted.rates[key]
    if (typeof to !== 'number') { missing.push(key); continue }
    if (Math.abs(from - to) <= 0.00001) continue
    const rel = from === 0 ? Infinity : Math.abs(to - from) / Math.abs(from)
    if (rel > MAX_RELATIVE_CHANGE) { held.push({ key, from, to }); continue }
    changes.push({ key, from, to })
    stored.rates[key] = to
  }

  const lastChecked = new Date().toISOString()
  const source = `Official ADA Luxembourg — Tableau des taux d'accises applicables au Luxembourg à partir du ${table.from}`
  const result = { table: { url: table.url, from: table.from }, changes, held, missing, confidence: extracted.confidence,
    notes: extracted.notes, source, lastChecked, written: false }
  if (dryRun) return result

  stored.lastChecked = lastChecked
  stored.source = source
  stored.notes = `Source PDF: ${table.url} (index: ${INDEX_URL}). Checked every 14 days and from the admin panel.` +
    (held.length ? ` ${held.length} change(s) held for review on ${lastChecked.slice(0, 10)}: ${held.map(h => `${h.key} ${h.from} → ${h.to}`).join(', ')}.` : '')
  const tmp = `${file}.tmp`
  writeFileSync(tmp, JSON.stringify(stored, null, 2) + '\n', { mode: 0o640 })
  renameSync(tmp, file)
  return { ...result, written: true }
}
