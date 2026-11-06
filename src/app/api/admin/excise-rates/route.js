import { join } from 'path'
import { NextResponse } from 'next/server'
import { auth } from '@/auth'
import { runExciseCheck, ExciseCheckError } from '@/lib/excise-check.mjs'

// The admin panel's "check now" button. Same check as the bi-weekly cron (scripts/check-excise-rates.js):
// the official ADA table in force -> Claude -> data/excise-rates.json. Nothing is written when the
// official table cannot be fetched.
export async function POST() {
  const session = await auth()
  if (session?.user?.role !== 'ADMIN') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  try {
    const r = await runExciseCheck({ ratesFile: join(process.cwd(), 'data/excise-rates.json') })
    return NextResponse.json({
      updated: r.changes.length > 0,
      changes: r.changes,
      held: r.held,
      confidence: r.confidence,
      // AdminPanel shows `notes` as the rates' source line.
      notes: r.source,
      modelNotes: r.notes,
      table: r.table,
      lastChecked: r.lastChecked,
    })
  } catch (e) {
    const status = e instanceof ExciseCheckError ? 502 : 500
    return NextResponse.json({ error: e.message }, { status })
  }
}
