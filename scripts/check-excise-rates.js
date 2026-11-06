#!/usr/bin/env node
// Bi-weekly Luxembourg excise rate check (dutify). The logic lives in src/lib/excise-check.mjs, which
// the admin panel's "check now" route uses too.
// Cron (/etc/cron.d/dutify-excise): cd /srv/apps/customs && as-apps node scripts/check-excise-rates.js
// Manual:  as-apps node scripts/check-excise-rates.js --dry-run   (prints proposed changes, writes nothing)

'use strict'

const { join } = require('path')

// dotenv is not a dependency of this app; Node >= 20.12 loads .env natively.
process.loadEnvFile(join(__dirname, '../.env'))

const log = msg => console.log(`[${new Date().toISOString()}] ${msg}`)
const fmt = c => `  ${c.key}: ${c.from} → ${c.to}`

async function main() {
  const dryRun = process.argv.includes('--dry-run')
  const { runExciseCheck } = await import('../src/lib/excise-check.mjs')
  log(`Starting Luxembourg excise rate check${dryRun ? ' (dry run)' : ''}...`)
  const r = await runExciseCheck({ ratesFile: join(__dirname, '../data/excise-rates.json'), dryRun })
  log(`Official table in force: from ${r.table.from} (${r.table.url})`)
  log(`Confidence ${r.confidence}; ${r.changes.length} change(s), ${r.held.length} held for review, ${r.missing.length} not stated in the table`)
  r.changes.forEach(c => console.log(fmt(c)))
  if (r.held.length) { console.log('  Not applied, check by hand:'); r.held.forEach(c => console.log(fmt(c))) }
  if (r.missing.length) console.log(`  Not stated (kept): ${r.missing.join(', ')}`)
  if (r.notes) console.log(`  Model notes: ${r.notes}`)
  log(r.written ? 'Wrote the rates file' : 'Dry run: nothing written')
}

main().catch(e => {
  console.error(`[${new Date().toISOString()}] ${e.message} — nothing written`)
  process.exit(1)
})
