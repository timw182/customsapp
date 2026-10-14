// The Luxembourg VAT rate of a commodity code, read from TARLUX (saturn.etat.lu, the national
// tariff: TARIC plus Luxembourg's own measures). Until 2026-10-14 the rate was guessed from the
// HS chapter alone (landed-cost.mjs getLuVAT), which put every chapter-90 instrument at 8% when
// 9014 20 20 00 is 17% (Tim, that morning). TARLUX carries the real answer as a national
// measure of type LBT on each declarable code, so this asks it and keeps the chapter guess only
// as a fallback.
//
// The page at saturn.etat.lu/ite-tariff-public is an Angular app over a JSON service with no
// session or token (found by watching its own requests, 2026-10-14). One GET gives every measure
// on a ten-digit code; the LBT rows each come twice, once for ERGA OMNES (area 1011) and once for
// the EU (area 1010), at the same rate. A code with several VAT rates tells them apart by a
// national additional code whose description says what the goods are (1926 cut flowers at 8%,
// 1936 medicines at 3%, 1994 "other goods at 17%"): the same choice the customs declaration asks
// for, so it is handed to the person rather than decided here. A code given short of ten digits
// is refused as "not declarable", which the caller already handles.

const BASE = 'https://saturn.etat.lu/ite-tariff-public-proxy/ite-tariff-trusted-rs/v1';
const TIMEOUT = 10000;
const VAT = 'LBT';
const ERGA_OMNES = '1011';
const STANDARD = 17;

/** The measures service URL for every import measure on `code` as of `now`. */
export function measuresUrl(code, now = new Date()) {
  const q = new URLSearchParams({
    count: '200', offset: '0', sortorder: 'A',
    simulationdate: now.toISOString().slice(0, 10),
    tradedirection: 'I', commoditycode: String(code).replace(/\D/g, ''), currency: 'EUR',
  });
  return `${BASE}/mcc/measures?${q}`;
}

const pct = (expr) => {
  const m = String(expr ?? '').match(/(\d+(?:\.\d+)?)\s*%/);
  return m ? Number(m[1]) : null;
};

/**
 * The VAT rates TARLUX lists for a code: `ratePct` to lead with (the standard rate when there is a
 * choice) and `choices`, one per rate, each with the national additional code that claims it and
 * what that code is for. Null when TARLUX refused the code (not declarable, not found).
 */
export function vatRowsOf(answer) {
  if (!answer || !Array.isArray(answer.items)) return null;
  const rows = answer.items.filter((m) => m.measureType?.id === VAT);
  if (rows.length === 0) return null;
  const described = new Map((answer.additionalCodes ?? []).map((a) => [a.typeAndId, a.descriptions?.en ?? null]));
  /* Prefer the ERGA OMNES rows (imports from outside the EU); the EU rows repeat them. */
  const omnes = rows.filter((m) => m.geographicalArea?.id === ERGA_OMNES);
  const choices = [];
  for (const m of omnes.length ? omnes : rows) {
    const ratePct = pct(m.dutyExpressions?.en);
    if (ratePct == null) continue;
    const additionalCode = m.additionalCode != null ? String(m.additionalCode) : null;
    if (choices.some((c) => c.ratePct === ratePct && c.additionalCode === additionalCode)) continue;
    choices.push({ ratePct, additionalCode, description: additionalCode ? (described.get(additionalCode) ?? null)?.trim() ?? null : null });
  }
  if (choices.length === 0) return null;
  /* Standard rate first: it is the row a declaration falls back to when no other applies. */
  choices.sort((a, b) => (b.ratePct === STANDARD) - (a.ratePct === STANDARD) || b.ratePct - a.ratePct);
  return { ratePct: choices[0].ratePct, choices };
}

const cache = new Map();
const CACHE_MS = 24 * 3600 * 1000;
const CACHE_MAX = 2000;

/**
 * The VAT rates for a ten-digit code, from TARLUX, cached for a day (national VAT measures change
 * at a year's turn). Null when TARLUX refuses the code; throws when it cannot be reached, so the
 * caller can fall back to the chapter guess and say so.
 */
export async function luVatFor(code, now = new Date()) {
  const digits = String(code).replace(/\D/g, '');
  const key = `${digits}|${now.toISOString().slice(0, 10)}`;
  const hit = cache.get(key);
  if (hit && hit.at > Date.now() - CACHE_MS) return hit.value;
  const res = await fetch(measuresUrl(digits, now), { signal: AbortSignal.timeout(TIMEOUT), headers: { accept: 'application/json' } });
  if (!res.ok && res.status !== 400 && res.status !== 404) throw new Error(`TARLUX answered ${res.status}`);
  const value = vatRowsOf(await res.json());
  if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value);
  cache.set(key, { at: Date.now(), value });
  return value;
}
