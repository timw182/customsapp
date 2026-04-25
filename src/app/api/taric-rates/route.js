// Given a CN/TARIC code + origin ISO2, fetches all applicable import
// measures from the EU TARIC SOAP service and returns the MFN (type 103)
// and preferential (types 141/142/143/145/146/147) ad-valorem rates.
// Used by the calculator wizard to offer a trade-agreement toggle when a
// preferential rate applies and is lower than MFN.

const TARIC_SOAP_URL = "https://ec.europa.eu/taxation_customs/dds2/taric/services/goods";
const MFN_TYPES = new Set(["103"]);
const PREF_TYPES = new Set(["141", "142", "143", "145", "146", "147"]);

// Customs-union partners. TARIC does NOT encode these as preferential
// measures (goods move at the MFN rate, but 0% duty is extended on
// presentation of a movement certificate). Scope is approximate — the
// actual Customs Union coverage excludes ECSC products and, for TR/AD,
// agricultural goods (HS 01–24).
const CUSTOMS_UNION = {
  TR: { certificate: "A.TR", agreement: "EU-Turkey Customs Union", coversChapterFrom: 25 },
  AD: { certificate: "T2 transit", agreement: "EU-Andorra Customs Union", coversChapterFrom: 25 },
  SM: { certificate: "T2/T2L", agreement: "EU-San Marino Customs Union", coversChapterFrom: 1 },
};

const CACHE_TTL_MS = 6 * 60 * 60 * 1000; // 6h — TARIC updates monthly
const cache = new Map();

function makeSoap(params) {
  const inner = Object.entries(params)
    .map(([k, v]) => (v != null ? `<tns:${k}>${v}</tns:${k}>` : ""))
    .join("");
  return `<?xml version="1.0" encoding="UTF-8"?>
<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:tns="http://goodsNomenclatureForWS.ws.taric.dds.s/">
  <soapenv:Header/>
  <soapenv:Body><tns:goodsMeasForWs>${inner}</tns:goodsMeasForWs></soapenv:Body>
</soapenv:Envelope>`;
}

function xmlText(xml, tag) {
  const m = xml.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`));
  return m ? m[1].trim() : null;
}

function xmlBlocks(xml, tag) {
  const re = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, "g");
  const out = [];
  let m;
  while ((m = re.exec(xml)) !== null) out.push(m[1]);
  return out;
}

function parseAdValorem(raw) {
  if (!raw) return null;
  // Matches "10.000 %", "0 %", "5.5%", etc. Ignores specific duties (EUR/kg).
  const pct = raw.match(/(\d+(?:[.,]\d+)?)\s*%/);
  if (!pct) return null;
  const n = parseFloat(pct[1].replace(",", "."));
  return Number.isFinite(n) ? n : null;
}

async function fetchMeasures(cn10, origin) {
  const resp = await fetch(TARIC_SOAP_URL, {
    method: "POST",
    headers: { "Content-Type": "text/xml; charset=UTF-8", SOAPAction: '""' },
    body: makeSoap({ goodsCode: cn10, countryCode: origin, tradeMovement: "I" }),
    signal: AbortSignal.timeout(8000),
  });
  const xml = await resp.text();
  if (xml.includes("<faultstring>")) return [];
  const now = new Date();
  return xmlBlocks(xml, "measure")
    .map((m) => {
      // Greedy match — the outer <measure_type> wraps an inner <measure_type>
      // element. A lazy match would stop at the inner closing tag and miss
      // the payload; greedy spans to the final </measure_type> so the inner
      // xmlText() call can then pick out the numeric code.
      const mtBlock = m.match(/<measure_type>([\s\S]*)<\/measure_type>/)?.[1] || "";
      const validTo = xmlText(m, "validity_end_date");
      return {
        type: xmlText(mtBlock, "measure_type"),
        dutyRateRaw: xmlText(m, "duty_rate")?.trim() || null,
        regulationId: xmlText(m, "regulation_id"),
        expired: validTo ? new Date(validTo) < now : false,
      };
    })
    .filter((m) => !m.expired);
}

export async function GET(req) {
  const { searchParams } = new URL(req.url);
  const cn = (searchParams.get("cn") || "").replace(/\D/g, "");
  const origin = (searchParams.get("origin") || "").replace(/[^A-Za-z]/g, "").toUpperCase().slice(0, 2);
  if (cn.length < 8) return Response.json({ error: "cn must be 8 or 10 digits" }, { status: 400 });
  if (origin.length !== 2) return Response.json({ error: "origin must be a 2-letter ISO code" }, { status: 400 });

  const cn10 = cn.padEnd(10, "0").slice(0, 10);
  const cacheKey = `${cn10}|${origin}`;
  const hit = cache.get(cacheKey);
  if (hit && Date.now() - hit.ts < CACHE_TTL_MS) return Response.json({ ...hit.data, cached: true });

  try {
    const measures = await fetchMeasures(cn10, origin);
    const mfn = measures.find((m) => MFN_TYPES.has(m.type));
    // Pick the lowest-rate preferential measure (a CN can have multiple PREF
    // measures for different schemes; the lowest is the most beneficial).
    const prefs = measures
      .filter((m) => PREF_TYPES.has(m.type))
      .map((m) => ({ ...m, rate: parseAdValorem(m.dutyRateRaw) }))
      .filter((m) => m.rate != null);
    prefs.sort((a, b) => a.rate - b.rate);
    const bestPref = prefs[0] || null;

    const mfnInfo = mfn ? { rate: parseAdValorem(mfn.dutyRateRaw), raw: mfn.dutyRateRaw, regulationId: mfn.regulationId } : null;

    // Customs-union path: TARIC has no PREF measure for TR/SM/AD, but a
    // 0% rate is available on presentation of a movement certificate as
    // long as MFN is non-zero and the HS chapter is in scope.
    let customsUnion = null;
    const cu = CUSTOMS_UNION[origin];
    if (cu && mfnInfo?.rate != null && mfnInfo.rate > 0) {
      const chapter = parseInt(cn10.slice(0, 2), 10);
      if (Number.isFinite(chapter) && chapter >= cu.coversChapterFrom) {
        customsUnion = { rate: 0, certificate: cu.certificate, agreement: cu.agreement };
      }
    }

    const data = {
      cn: cn10,
      origin,
      mfn: mfnInfo,
      preferential: bestPref
        ? { rate: bestPref.rate, raw: bestPref.dutyRateRaw, regulationId: bestPref.regulationId, measureType: bestPref.type }
        : null,
      customsUnion,
    };
    cache.set(cacheKey, { data, ts: Date.now() });
    return Response.json(data);
  } catch (err) {
    return Response.json({ error: err.message }, { status: 502 });
  }
}
