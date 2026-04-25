// Helpers over the TaricGeoArea / TaricZoneMember tables.
// Populated monthly by scripts/ingest-taric-zones.js from CIRCABC.

import { prisma } from "@/lib/prisma";

// Resolve a single TARIC geographical-area code. `code` is either a 2-letter
// ISO2 for a country (e.g. "JP") or a 4-digit numeric id for a country group
// (e.g. "1008"). Returns null if unknown.
export async function getZone(code) {
  if (!code) return null;
  const row = await prisma.taricGeoArea.findUnique({
    where: { code: String(code).trim() },
    include: { members: { orderBy: { memberCode: "asc" } } },
  });
  if (!row) return null;
  return {
    code: row.code,
    acronym: row.acronym,
    description: row.description,
    isCountry: row.isCountry,
    members: row.isCountry ? [] : row.members.map((m) => m.memberCode),
  };
}

// Every country group containing the given ISO2 country code. Useful when
// you want to know "which agreements does goods from Japan qualify for?".
export async function zonesForMember(iso2) {
  if (!iso2) return [];
  const memberCode = String(iso2).trim().toUpperCase();
  const edges = await prisma.taricZoneMember.findMany({
    where: { memberCode, OR: [{ membershipEnd: null }, { membershipEnd: { gt: new Date() } }] },
    select: { zoneCode: true },
  });
  const zoneCodes = [...new Set(edges.map((e) => e.zoneCode))];
  if (zoneCodes.length === 0) return [];
  return prisma.taricGeoArea.findMany({
    where: { code: { in: zoneCodes } },
    orderBy: { code: "asc" },
    select: { code: true, acronym: true, description: true },
  });
}

// All country groups (i.e. zones that represent agreements, quotas, or
// regional preferences). Countries are excluded. Members are omitted here
// for payload size — fetch per-zone via getZone() if needed.
export async function listAgreements() {
  return prisma.taricGeoArea.findMany({
    where: { isCountry: false, OR: [{ endDate: null }, { endDate: { gt: new Date() } }] },
    orderBy: { code: "asc" },
    select: { code: true, acronym: true, description: true, startDate: true },
  });
}
