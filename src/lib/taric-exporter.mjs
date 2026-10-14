// One exporter's own anti-dumping and countervailing rates, from the EU's TARIC consultation site.
//
// Why not the SOAP service the rest of /api/taric uses: for a named company (additional code C382,
// "Bodo Vehicle Group") it returns the measure with no duty_rate at all, because the rate is
// conditional — 58.30 % with an invoice carrying the signed producer declaration (document D008),
// 62.10 % without. Only the "all other companies" measure (C999) has a plain rate there. The
// consultation site keeps the conditions behind each measure (measures_conditions.jsp), so this
// reads them for one company at a time: e-bikes from China name 110 companies, and asking for all
// of them on every look-up would be 220 requests to the Commission's site (2026-10-14).

const BASE = 'https://ec.europa.eu/taxation_customs/dds2/taric/';
const TIMEOUT = 15000;

const ANTI_DUMPING = /anti-dumping/i;
const COUNTERVAILING = /countervailing/i;

const decode = (s) => s.replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&#39;/g, "'").replace(/&quot;/g, '"');
const plain = (s) => decode(s.replace(/<script[\s\S]*?<\/script>/g, ' ').replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();

/** The URL of the frame that lists the measures; the outer page only frames it, with a session id. */
export function detailsUrlOf(outerHtml) {
  const m = outerHtml.match(/measures_details\.jsp[^"' ]*/);
  return m ? BASE + decode(m[0]) : null;
}

/**
 * The trade-defence measures on the details frame: one per `<div id="measure_SID">`, with its type,
 * regulation, and additional code. Measures of other kinds (third-country duty, controls) are left out.
 */
export function measuresOf(detailsHtml) {
  const parts = detailsHtml.split(/<div id="measure_(\d+)">/);
  const out = [];
  for (let i = 1; i < parts.length; i += 2) {
    const sid = parts[i];
    const block = parts[i + 1] ?? '';
    const descHtml = block.match(/class="td_measure_description[^"]*"[^>]*>([\s\S]*?)<\/td>/)?.[1] ?? '';
    const description = plain(descHtml.split('<span')[0]);
    const kind = ANTI_DUMPING.test(description) ? 'antiDumping' : COUNTERVAILING.test(description) ? 'countervailing' : null;
    if (!kind) continue;
    const code = block.match(/Additional Code&nbsp;([A-Z0-9]{4}):/)?.[1] ?? null;
    const company = code
      ? plain(block.match(/name="additional_code_description_search">([\s\S]*?)<\/td>/)?.[1] ?? '') || null
      : null;
    const regulation = plain(block.match(/class="regulation_link"[^>]*>([\s\S]*?)<\/a>/)?.[1] ?? '') || null;
    /* A rate printed beside the description (": 62.10 %") is there only when it is unconditional. */
    const flat = plain(block.match(/<span class="duty_rate">([\s\S]*?)<\/span>/)?.[1] ?? '').match(/^(\d+(?:\.\d+)?)\s*%$/);
    out.push({ sid, kind, description, regulation, additionalCode: code, company, rate: flat ? Number(flat[1]) : null });
  }
  return out;
}

/**
 * A measure's conditions page read into the two rates that matter: with the document the condition
 * names (D008, the invoice with the signed declaration) and without it. TARIC writes them as
 * "A1 Presentation of … D 008 Apply the amount of the action 58.30 %" and "A2 … 62.10 %".
 */
export function conditionsOf(conditionsHtml) {
  const text = plain(conditionsHtml);
  const rows = [...text.matchAll(/\b([A-Z])(\d{1,2})\s+(.*?)(?=\s[A-Z]\d{1,2}\s+Presentation|\s+Additional information|$)/g)];
  let withDocument = null, without = null, document = null;
  for (const [, , , body] of rows) {
    const rate = body.match(/(\d+(?:\.\d+)?)\s*%/);
    if (!rate) continue;
    const doc = body.match(/\b([A-Z])\s?(\d{3})\b/);
    if (doc && withDocument == null) { withDocument = Number(rate[1]); document = `${doc[1]}${doc[2]}`; }
    else if (!doc && without == null) without = Number(rate[1]);
  }
  return { withDocument, without, document };
}

const cache = new Map();
const CACHE_MS = 24 * 3600 * 1000;
const CACHE_MAX = 500;

async function get(url) {
  const res = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT) });
  if (!res.ok) throw new Error(`TARIC consultation answered ${res.status}`);
  return res.text();
}

/**
 * The anti-dumping and countervailing measures that name `additionalCode` (e.g. "C382") on a
 * ten-digit code from an origin, each with its rate with and without the invoice declaration.
 * Cached for a day: these regulations change a few times a year.
 */
export async function exporterRates(code, origin, additionalCode, now = new Date()) {
  const day = now.toISOString().slice(0, 10).replace(/-/g, '');
  const key = `${code}|${origin}|${additionalCode}|${day}`;
  const hit = cache.get(key);
  if (hit && hit.at > Date.now() - CACHE_MS) return hit.value;

  const outer = await get(`${BASE}measures.jsp?Lang=en&SimDate=${day}&Taric=${code}&Area=${origin}&GeoArea=${origin}&LangDescr=en&Expand=true&Domain=TARIC&Offset=0`);
  const detailsUrl = detailsUrlOf(outer);
  if (!detailsUrl) throw new Error('TARIC consultation page had no measures frame');
  const measures = measuresOf(await get(detailsUrl)).filter((m) => m.additionalCode === additionalCode);

  const value = [];
  for (const m of measures) {
    const conditions = m.rate != null
      ? { withDocument: null, without: m.rate, document: null }
      : conditionsOf(await get(`${BASE}measures_conditions.jsp?MeasureSid=${m.sid}&Lang=en&LangDescr=&SimDate=${day}`));
    value.push({ kind: m.kind, regulation: m.regulation, additionalCode: m.additionalCode, company: m.company, ...conditions });
  }

  if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value);
  cache.set(key, { at: Date.now(), value });
  return value;
}
