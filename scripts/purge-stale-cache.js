#!/usr/bin/env node
// One-time + safe-to-re-run cache purge for CN nomenclature changes.
//
// Purges:
//   1. Chapter 95 entries updated before 2025-11-01 — Additional Note 1 deleted,
//      Christmas articles must now be classified by material under GRI 1.
//   2. Pre-2026-01-01 entries for headings that gained new CN 2026 subheadings,
//      so next lookup re-probes TARIC and picks up the correct specific code.
//
// Usage:
//   node scripts/purge-stale-cache.js          # live run
//   node scripts/purge-stale-cache.js --dry-run

'use strict'

const { join } = require('path')
// Load .env manually without dotenv dependency
const { readFileSync } = require('fs')
try {
  const env = readFileSync(join(__dirname, '../.env'), 'utf8')
  for (const line of env.split('\n')) {
    const m = line.match(/^([^#=]+)=(.*)$/)
    if (m) process.env[m[1].trim()] = m[2].trim().replace(/^["']|["']$/g, '')
  }
} catch {}

const { PrismaClient } = require('@prisma/client')
const prisma = new PrismaClient()
const DRY = process.argv.includes('--dry-run')

async function main() {
  console.log(`[purge-stale-cache] ${DRY ? 'DRY RUN — ' : ''}${new Date().toISOString()}`)

  const CH95_CUTOFF   = new Date('2025-11-01')
  const CN2026_CUTOFF = new Date('2026-01-01')

  // ── 1. Chapter 95 — Christmas articles ────────────────────────────────────
  // Additional Note 1 deleted 1 Nov 2025. Any cached 9505x result from before
  // that date used the old rule (festive use → 9505 regardless of material).
  const ch95 = await prisma.hsLookupCache.findMany({
    where: {
      updatedAt: { lt: CH95_CUTOFF },
      resultJson: { contains: '"9505' },
    },
    select: { id: true, description: true, updatedAt: true },
  })

  console.log(`\n[Ch95] ${ch95.length} stale entries (9505x, pre-Nov 2025)`)
  for (const r of ch95) {
    console.log(`  ${r.updatedAt.toISOString().slice(0,10)}  ${r.description.slice(0, 70)}`)
  }
  if (!DRY && ch95.length > 0) {
    const { count } = await prisma.hsLookupCache.deleteMany({
      where: { id: { in: ch95.map(r => r.id) } },
    })
    console.log(`  → Deleted ${count}`)
  }

  // ── 2. CN 2026 new subheadings — products that previously landed in "other" ─
  // These hs6 values gained dedicated CN8 codes on 1 Jan 2026.
  // Purge pre-2026 cached entries so next lookup re-probes TARIC.
  const affectedHs6 = [
    '284190',  // NMC cathode oxides
    '284290',  // LFP cathode
    '380110',  // artificial graphite
    '381800',  // photovoltaic wafers
    '730820',  // wind turbine towers
    '841090',  // hydraulic turbine rotors/stators
    '841290',  // wind turbine blades
    '850133',  // H2 fuel cell generators
    '850440',  // MPPT inverters
    '850790',  // battery separators
    '854390',  // stacked galvanic cells (electrolysis)
  ]

  let cn2026Total = 0
  console.log('\n[CN2026] Scanning pre-Jan-2026 entries for affected headings...')
  for (const hs6 of affectedHs6) {
    const rows = await prisma.hsLookupCache.findMany({
      where: {
        updatedAt: { lt: CN2026_CUTOFF },
        resultJson: { contains: `"${hs6}"` },
      },
      select: { id: true, description: true, updatedAt: true },
    })
    if (rows.length === 0) continue
    console.log(`  hs6 ${hs6}: ${rows.length} entries`)
    for (const r of rows) {
      console.log(`    ${r.updatedAt.toISOString().slice(0,10)}  ${r.description.slice(0, 60)}`)
    }
    if (!DRY) {
      const { count } = await prisma.hsLookupCache.deleteMany({
        where: { id: { in: rows.map(r => r.id) } },
      })
      cn2026Total += count
    } else {
      cn2026Total += rows.length
    }
  }
  console.log(`[CN2026] ${DRY ? 'Would delete' : 'Deleted'} ${cn2026Total} entries`)

  const remaining = await prisma.hsLookupCache.count()
  console.log(`\n[purge-stale-cache] Done. Cache: ${remaining} entries remaining.`)
}

main()
  .catch(e => { console.error(e); process.exit(1) })
  .finally(() => prisma.$disconnect())
