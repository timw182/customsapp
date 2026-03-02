import { readFileSync, writeFileSync } from 'fs'
import { join } from 'path'
import { NextResponse } from 'next/server'
import { auth } from '@/auth'

const RATES_FILE = join(process.cwd(), 'data/excise-rates.json')

const RATE_PAGES = [
  'https://ae.gouvernement.lu/fr/services/professionnels/alcool/droits-d-accise.html',
  'https://ae.gouvernement.lu/fr/services/professionnels/tabacs-manufactures/droits-d-accise.html',
  'https://ae.gouvernement.lu/fr/services/professionnels/produits-energetiques/droits-d-accise.html',
]

async function fetchPage(url) {
  try {
    const resp = await fetch(url, { signal: AbortSignal.timeout(10000) })
    if (!resp.ok) return null
    return await resp.text()
  } catch {
    return null
  }
}

export async function POST() {
  const session = await auth()
  if (session?.user?.role !== 'ADMIN') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  let stored
  try {
    stored = JSON.parse(readFileSync(RATES_FILE, 'utf8'))
  } catch {
    return NextResponse.json({ error: 'Could not read rates file' }, { status: 500 })
  }

  const pages = await Promise.all(RATE_PAGES.map(fetchPage))
  const pageContents = pages.filter(Boolean)

  const systemPrompt = `You are a Luxembourg excise duty expert. Extract the current Luxembourg excise rates and return ONLY a JSON object (no markdown) with:
- "rates": object with keys: beer, sparkling-wine, still-wine, intermediate, spirits, cigarettes_specific, cigarettes_advalorem, cigarettes_minimum, cigars, fine_cut, other_tobacco, petrol, diesel, heating_fuel, lpg. Set to null if not found.
- "confidence": "high"|"medium"|"low"
- "notes": brief string about the source/year

Units: beer=€/hl/%vol, sparkling-wine/still-wine/intermediate=€/hl, spirits=€/hl pure alcohol, cigarettes_specific/minimum=€/1000 units, cigarettes_advalorem=decimal (0.50=50%), cigars=decimal ad valorem, fine_cut/other_tobacco=€/kg, petrol/diesel/heating_fuel=€/L, lpg=€/kg.`

  const userMsg = pageContents.length > 0
    ? `Current stored rates:\n${JSON.stringify(stored.rates, null, 2)}\n\nWeb content from ae.gouvernement.lu:\n${pageContents.join('\n\n---\n\n').slice(0, 28000)}`
    : `Could not fetch pages. Based on your knowledge of current Luxembourg excise rates, verify or correct these stored rates:\n${JSON.stringify(stored.rates, null, 2)}`

  let resp
  try {
    resp = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 1500,
        system: systemPrompt,
        messages: [{ role: 'user', content: userMsg }],
      }),
    })
  } catch {
    return NextResponse.json({ error: 'Could not reach AI service' }, { status: 502 })
  }

  if (!resp.ok) {
    return NextResponse.json({ error: 'AI service error' }, { status: 502 })
  }

  const aiData = await resp.json()
  const text = aiData.content?.find(b => b.type === 'text')?.text || ''

  let extracted
  try {
    extracted = JSON.parse(text.replace(/```json|```/g, '').trim())
  } catch {
    // Couldn't parse — still update lastChecked
    stored.lastChecked = new Date().toISOString()
    stored.source = 'Auto-check attempted — could not parse AI response'
    writeFileSync(RATES_FILE, JSON.stringify(stored, null, 2))
    return NextResponse.json({ updated: false, error: 'Could not parse AI response', lastChecked: stored.lastChecked })
  }

  const changes = []
  if (extracted.rates) {
    for (const [key, newVal] of Object.entries(extracted.rates)) {
      if (newVal === null || newVal === undefined) continue
      const oldVal = stored.rates[key]
      if (oldVal !== undefined && Math.abs(oldVal - newVal) > 0.00001) {
        changes.push({ key, from: oldVal, to: newVal })
        stored.rates[key] = newVal
      }
    }
  }

  stored.lastChecked = new Date().toISOString()
  stored.source = `Auto-check (confidence: ${extracted.confidence ?? 'unknown'}) — ${changes.length} change(s)`
  if (extracted.notes) stored.notes = extracted.notes

  try {
    writeFileSync(RATES_FILE, JSON.stringify(stored, null, 2))
  } catch {
    return NextResponse.json({ error: 'Could not write rates file' }, { status: 500 })
  }

  return NextResponse.json({
    updated: changes.length > 0,
    changes,
    confidence: extracted.confidence,
    notes: extracted.notes,
    lastChecked: stored.lastChecked,
    pagesFetched: pageContents.length,
  })
}
