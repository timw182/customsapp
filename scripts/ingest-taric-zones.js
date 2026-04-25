#!/usr/bin/env node
// Monthly TARIC geographical-areas ingest.
//
// Walks the public CIRCABC "TARIC and Quota data & information" library,
// finds the most recent monthly extraction, downloads the two geographical
// area workbooks and upserts them into the TaricGeoArea / TaricZoneMember
// tables. Idempotent — safe to re-run.
//
// Cron (suggested, first Monday of the month): 0 4 1-7 * 1 cd /var/www/customs && node scripts/ingest-taric-zones.js >> /var/log/dutify-taric-zones.log 2>&1
//
// Requires: `npm install xlsx`.

'use strict'

const { mkdtempSync, createWriteStream, rmSync } = require('fs')
const { tmpdir } = require('os')
const { join } = require('path')
const { pipeline } = require('stream/promises')
const XLSX = require('xlsx')
const { PrismaClient } = require('@prisma/client')

const CIRCABC_GROUP_ID = '0e5f18c2-4b2f-42e9-aed4-dfe50ae1263b' // TARIC and Quota data & information
const CIRCABC_BASE = 'https://circabc.europa.eu'
const COMP_FILE = 'Geographical areas composition.xlsx'
const DESC_FILE = 'Geographical areas descriptions.xlsx'

const prisma = new PrismaClient()

function log(msg) {
  console.log(`[${new Date().toISOString()}] ${msg}`)
}

async function fetchJson(url) {
  const r = await fetch(url, { headers: { Accept: 'application/json' } })
  if (!r.ok) throw new Error(`${url} → HTTP ${r.status}`)
  return r.json()
}

async function listChildren(spaceId) {
  const url = `${CIRCABC_BASE}/service/circabc/spaces/${spaceId}/children?guest=true&limit=500`
  const body = await fetchJson(url)
  return body.data || []
}

async function resolveLibraryId() {
  const g = await fetchJson(`${CIRCABC_BASE}/service/circabc/groups/${CIRCABC_GROUP_ID}?guest=true`)
  if (!g.libraryId) throw new Error('Group response missing libraryId')
  return g.libraryId
}

// Walk library → "TARIC data" → latest year → latest month.
async function findLatestMonthFolder(libraryId) {
  const libChildren = await listChildren(libraryId)
  const taricData = libChildren.find((n) => n.name === 'TARIC data')
  if (!taricData) throw new Error('"TARIC data" folder not found in library')

  const years = (await listChildren(taricData.id))
    .filter((n) => /^\d{4}$/.test(n.name))
    .sort((a, b) => b.name.localeCompare(a.name))
  if (years.length === 0) throw new Error('No year folders under TARIC data')

  for (const year of years) {
    const months = (await listChildren(year.id))
      .filter((n) => /^\d{2}\s*-/.test(n.name))
      .sort((a, b) => b.name.localeCompare(a.name))
    for (const month of months) {
      const files = await listChildren(month.id)
      const hasComp = files.find((n) => n.name === COMP_FILE)
      const hasDesc = files.find((n) => n.name === DESC_FILE)
      if (hasComp && hasDesc) {
        return { year: year.name, month: month.name, comp: hasComp, desc: hasDesc }
      }
    }
  }
  throw new Error('No month folder containing both geographical-area files')
}

async function downloadTo(url, filePath) {
  const r = await fetch(url)
  if (!r.ok || !r.body) throw new Error(`${url} → HTTP ${r.status}`)
  await pipeline(r.body, createWriteStream(filePath))
}

function downloadUrlFor(node) {
  // CIRCABC serves the raw bytes at this stable path for any content node.
  return `${CIRCABC_BASE}/d/d/workspace/SpacesStore/${node.id}/${encodeURIComponent(node.name)}`
}

function parseDate(s) {
  if (!s) return null
  // Input is "DD-MM-YYYY"
  const m = String(s).match(/^(\d{2})-(\d{2})-(\d{4})$/)
  if (!m) return null
  return new Date(`${m[3]}-${m[2]}-${m[1]}T00:00:00Z`)
}

function readSheetRows(filePath) {
  const wb = XLSX.readFile(filePath)
  const sheet = wb.Sheets[wb.SheetNames[0]]
  return XLSX.utils.sheet_to_json(sheet, { defval: null, raw: false })
}

async function ingestDescriptions(filePath) {
  // Columns: Or./Dest., Language, Abbrev., Description, Start date, Descr. start date, End date
  // Only the English row per code becomes the canonical description/acronym.
  const rows = readSheetRows(filePath)
  const latestByCode = new Map() // code -> row (keep the row with latest "Descr. start date")

  for (const r of rows) {
    if ((r['Language'] || '').toUpperCase() !== 'EN') continue
    const code = String(r['Or./Dest.'] || '').trim()
    if (!code) continue
    const startDate = parseDate(r['Descr. start date']) || parseDate(r['Start date'])
    const existing = latestByCode.get(code)
    if (!existing || (startDate && (!existing._start || startDate > existing._start))) {
      latestByCode.set(code, { ...r, _start: startDate })
    }
  }

  log(`descriptions: ${latestByCode.size} unique codes (EN)`)

  let done = 0
  for (const [code, r] of latestByCode) {
    await prisma.taricGeoArea.upsert({
      where: { code },
      create: {
        code,
        acronym: r['Abbrev.'] || null,
        description: r['Description'] || '',
        startDate: parseDate(r['Start date']),
        endDate: parseDate(r['End date']),
        isCountry: !/^\d+$/.test(code),
      },
      update: {
        acronym: r['Abbrev.'] || null,
        description: r['Description'] || '',
        startDate: parseDate(r['Start date']),
        endDate: parseDate(r['End date']),
        isCountry: !/^\d+$/.test(code),
      },
    })
    if (++done % 500 === 0) log(`  …${done} descriptions upserted`)
  }
  log(`descriptions: ${done} upserted`)
}

async function ingestComposition(filePath) {
  // Columns: Country group, Start date, Language, Abbrev., Country group descr.,
  //          Member country, Abbrev._1, Description, Mbship start date, Mbship end date, End date
  const rows = readSheetRows(filePath)

  // Deduplicate on (zone, member, membershipStart) — source file already
  // has one row per (zone, member) for EN but defend against duplicates.
  const seen = new Set()
  const edges = []
  for (const r of rows) {
    if ((r['Language'] || '').toUpperCase() !== 'EN') continue
    const zoneCode = String(r['Country group'] || '').trim()
    const memberCode = String(r['Member country'] || '').trim()
    if (!zoneCode || !memberCode) continue
    const membershipStart = parseDate(r['Mbship start date'])
    const key = `${zoneCode}|${memberCode}|${membershipStart ? membershipStart.toISOString() : ''}`
    if (seen.has(key)) continue
    seen.add(key)
    edges.push({
      zoneCode,
      memberCode,
      membershipStart,
      membershipEnd: parseDate(r['Mbship end date']),
    })
  }
  log(`composition: ${edges.length} zone-member edges`)

  // Ensure every zoneCode in composition exists as a TaricGeoArea — the
  // descriptions file contains them, but the two files can temporarily
  // drift, so we create minimal rows on the fly.
  const zoneCodes = [...new Set(edges.map((e) => e.zoneCode))]
  const existing = new Set(
    (await prisma.taricGeoArea.findMany({ where: { code: { in: zoneCodes } }, select: { code: true } })).map(
      (z) => z.code,
    ),
  )
  const missingZones = zoneCodes.filter((c) => !existing.has(c))
  if (missingZones.length) {
    log(`composition: creating ${missingZones.length} placeholder zones missing from descriptions file`)
    for (const code of missingZones) {
      await prisma.taricGeoArea.create({
        data: { code, description: `(no description)`, isCountry: false },
      })
    }
  }

  // Wipe + bulk insert is simplest and keeps the table consistent with
  // the latest extraction. SQLite is fast enough for ~3k rows.
  await prisma.taricZoneMember.deleteMany({})
  const batchSize = 500
  for (let i = 0; i < edges.length; i += batchSize) {
    const batch = edges.slice(i, i + batchSize)
    await prisma.taricZoneMember.createMany({ data: batch })
    log(`  …${Math.min(i + batchSize, edges.length)}/${edges.length} memberships inserted`)
  }
}

async function main() {
  const tmp = mkdtempSync(join(tmpdir(), 'taric-zones-'))
  log(`workdir: ${tmp}`)
  try {
    const libraryId = await resolveLibraryId()
    log(`libraryId: ${libraryId}`)

    const latest = await findLatestMonthFolder(libraryId)
    log(`latest extraction: ${latest.year} / ${latest.month}`)

    const descPath = join(tmp, 'desc.xlsx')
    const compPath = join(tmp, 'comp.xlsx')
    log('downloading descriptions…')
    await downloadTo(downloadUrlFor(latest.desc), descPath)
    log('downloading composition…')
    await downloadTo(downloadUrlFor(latest.comp), compPath)

    await ingestDescriptions(descPath)
    await ingestComposition(compPath)

    const zoneCount = await prisma.taricGeoArea.count()
    const memberCount = await prisma.taricZoneMember.count()
    log(`done — ${zoneCount} geo areas, ${memberCount} memberships`)
  } finally {
    try {
      rmSync(tmp, { recursive: true, force: true })
    } catch {}
    await prisma.$disconnect()
  }
}

main().catch((err) => {
  console.error(`[${new Date().toISOString()}] FATAL:`, err)
  process.exit(1)
})
