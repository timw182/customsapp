import { NextResponse } from 'next/server'
import { auth } from '@/auth'

export async function POST(req) {
  const session = await auth()
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { description, code, type } = await req.json()

  let system, userMsg

  if (type === 'classify') {
    system = `You are an EU customs classification expert. Given a product description, return ONLY a JSON object (no markdown, no preamble) with these fields:
{
  "hs6": "6-digit HS code (most likely)",
  "taricChapter": "2-digit chapter",
  "description": "Official HS heading description",
  "standardDutyRate": number,
  "antiDumping": boolean,
  "antiDumpingNote": "brief note if applicable, else null",
  "excise": boolean,
  "exciseNote": "brief note if excise duty applies, else null",
  "prohibitedRestricted": boolean,
  "complianceNotes": ["list of compliance requirements"],
  "confidence": "high|medium|low",
  "alternativeHS": ["other possible codes if ambiguous"]
}`
    userMsg = `Product: ${description}`
  } else {
    system = `You are an EU customs tariff expert. Given an HS code, return ONLY a JSON object with no markdown:
{
  "hs": "the code provided",
  "description": "short heading description",
  "mfnRate": number,
  "rateType": "ad valorem",
  "note": "brief note on rate type or caveats"
}`
    userMsg = `HS code: ${code}`
  }

  const resp = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': process.env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 1000,
      system,
      messages: [{ role: 'user', content: userMsg }]
    })
  })

  const data = await resp.json()
  const text = data.content?.find(b => b.type === 'text')?.text || ''
  const parsed = JSON.parse(text.replace(/```json|```/g, '').trim())
  return NextResponse.json(parsed)
}
