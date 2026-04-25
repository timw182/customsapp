// Read-only access to the EU TARIC geographical-areas catalogue ingested
// monthly from CIRCABC. Exposes three query shapes:
//
//   GET /api/trade-agreements              → list of all country groups / agreements
//   GET /api/trade-agreements?code=2020    → one zone + its member countries
//   GET /api/trade-agreements?origin=JP    → all zones that currently include JP
//
// Data is reference material from a public EU source, so the route is not
// gated. Results are cached in-memory for 1h since the underlying table only
// changes once a month.

import { getZone, listAgreements, zonesForMember } from "@/lib/taric-zones";

const CACHE_TTL_MS = 60 * 60 * 1000;
const cache = new Map();

function cachedOrFresh(key, loader) {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.ts < CACHE_TTL_MS) return Promise.resolve(hit.data);
  return loader().then((data) => {
    cache.set(key, { data, ts: Date.now() });
    return data;
  });
}

export async function GET(req) {
  const { searchParams } = new URL(req.url);
  const code = searchParams.get("code");
  const origin = searchParams.get("origin");

  try {
    if (code) {
      const zone = await cachedOrFresh(`zone:${code}`, () => getZone(code));
      if (!zone) return Response.json({ error: "Unknown code" }, { status: 404 });
      return Response.json({ zone });
    }
    if (origin) {
      const zones = await cachedOrFresh(`origin:${origin.toUpperCase()}`, () => zonesForMember(origin));
      return Response.json({ origin: origin.toUpperCase(), zones });
    }
    const agreements = await cachedOrFresh("all", listAgreements);
    return Response.json({ agreements, count: agreements.length });
  } catch (err) {
    return Response.json({ error: err.message }, { status: 500 });
  }
}
