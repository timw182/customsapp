import { readFileSync } from 'fs'
import { join } from 'path'
import { NextResponse } from 'next/server'

const RATES_FILE = join(process.cwd(), 'data/excise-rates.json')

export async function GET() {
  try {
    const data = JSON.parse(readFileSync(RATES_FILE, 'utf8'))
    return NextResponse.json(data)
  } catch {
    return NextResponse.json({ error: 'Could not load rates' }, { status: 500 })
  }
}
