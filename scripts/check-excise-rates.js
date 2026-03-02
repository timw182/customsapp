#!/usr/bin/env node
// Bi-weekly Luxembourg excise rate checker
// Cron: 0 9 1,15 * * cd /var/www/customs && node scripts/check-excise-rates.js >> /var/log/dutify-excise.log 2>&1

'use strict'

const { readFileSync, writeFileSync } = require('fs')
const { join } = require('path')
const { config } = require('dotenv')

config({ path: join(__dirname, '../.env') })

const RATES_FILE = join(__dirname, '../data/excise-rates.json')
const API_KEY = process.env.ANTHROPIC_API_KEY

if (!API_KEY) {
  console.error(`[${new Date().toISOString()}] ANTHROPIC_API_KEY not set — aborting`)
  process.exit(1)
}

const RATE_PAGES = [
  'https://ae.gouvernement.lu/fr/services/professionnels/alcool/droits-d-accise.html',
  'https://ae.gouvernement.lu/fr/services/professionnels/tabacs-manufactures/droits-d-accise.html',
  'https://ae.gouvernement.lu/fr/services/professionnels/produits-energetiques/droits-d-accise.html',
]

async function fetchPage(url) {
  try {
    const resp = await fetch(url, { signal: AbortSignal.timeout(12000) })
    if (!resp.ok) return null
    return await resp.text()
  } catch {
    return null
  }
}

async function callClaude(systemPrompt, userMsg) {
  const resp = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': API_KEY,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 1500,
      system: systemPrompt,
      messages: [{ role: 'user', content: userMsg }],
    }),
  })
  if (!resp.ok) throw new Error(`Anthropic API error: ${resp.status}`)
  const data = await resp.json()
  return data.content?.find(b => b.type === 'text')?.text || ''
}

async function main() {
  const ts = new Date().toISOString()
  console.log(`[${ts}] Starting Luxembourg excise rate check...`)

  let stored
  try {
    stored = JSON.parse(readFileSync(RATES_FILE, 'utf8'))
  } catch (e) {
    console.error(`[${ts}] Could not read ${RATES_FILE}: ${e.message}`)
    process.exit(1)
  }

  const pages = await Promise.all(RATE_PAGES.map(fetchPage))
  const pageContents = pages.filter(Boolean)
  console.log(`[${ts}] Fetched ${pageContents.length}/${RATE_PAGES.length} pages from ae.gouvernement.lu`)

  const systemPrompt = `You are a Luxembourg excise duty expert. Extract the current Luxembourg excise rates and return ONLY a JSON object (no markdown) with:
- "rates": object with keys: beer, sparkling-wine, still-wine, intermediate, spirits, cigarettes_specific, cigarettes_advalorem, cigarettes_minimum, cigars, fine_cut, other_tobacco, petrol, diesel, heating_fuel, lpg. Set to null if not found.
- "confidence": "high"|"medium"|"low"
- "notes": brief string about the source/year

Units: beer=€/hl/%vol, sparkling-wine/still-wine/intermediate=€/hl, spirits=€/hl pure alcohol, cigarettes_specific/minimum=€/1000 units, cigarettes_advalorem=decimal (0.50=50%), cigars=decimal ad valorem, fine_cut/other_tobacco=€/kg, petrol/diesel/heating_fuel=€/L, lpg=€/kg.`

  const userMsg = pageContents.length > 0
    ? `Current stored rates:\n${JSON.stringify(stored.rates, null, 2)}\n\nWeb content from ae.gouvernement.lu:\n${pageContents.join('\n\n---\n\n').slice(0, 28000)}`
    : `Could not fetch the rate pages. Based on your knowledge of current Luxembourg excise rates, verify or correct these:\n${JSON.stringify(stored.rates, null, 2)}`

  let extracted
  try {
    const text = await callClaude(systemPrompt, userMsg)
    extracted = JSON.parse(text.replace(/```json|```/g, '').trim())
  } catch (e) {
    console.error(`[${ts}] Failed to get/parse AI response: ${e.message}`)
    stored.lastChecked = new Date().toISOString()
    stored.source = 'Auto-check attempted — AI error'
    writeFileSync(RATES_FILE, JSON.stringify(stored, null, 2))
    process.exit(0)
  }

  const changes = []
  if (extracted.rates) {
    for (const [key, newVal] of Object.entries(extracted.rates)) {
      if (newVal === null || newVal === undefined) continue
      const oldVal = stored.rates[key]
      if (oldVal !== undefined && Math.abs(oldVal - newVal) > 0.00001) {
        changes.push(`  ${key}: ${oldVal} → ${newVal}`)
        stored.rates[key] = newVal
      }
    }
  }

  if (changes.length > 0) {
    console.log(`[${ts}] ${changes.length} rate change(s) detected:`)
    changes.forEach(c => console.log(c))
  } else {
    console.log(`[${ts}] No rate changes detected.`)
  }

  stored.lastChecked = new Date().toISOString()
  stored.source = `Auto-check (confidence: ${extracted.confidence ?? 'unknown'}) — ${changes.length} change(s)`
  if (extracted.notes) stored.notes = extracted.notes

  writeFileSync(RATES_FILE, JSON.stringify(stored, null, 2))
  console.log(`[${ts}] Wrote updated rates to ${RATES_FILE}`)
}

main().catch(e => {
  console.error(`[${new Date().toISOString()}] Fatal: ${e.message}`)
  process.exit(1)
})
