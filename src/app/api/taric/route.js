import { NextResponse } from 'next/server';
import { requireUser } from '@/lib/apiAuth';

const TARIC_SOAP_URL = 'https://ec.europa.eu/taxation_customs/dds2/taric/services/goods';

function makeSoapEnvelope(operation, params) {
  const inner = Object.entries(params)
    .map(([k, v]) => v != null ? `<tns:${k}>${v}</tns:${k}>` : '')
    .join('');
  return `<?xml version="1.0" encoding="UTF-8"?>
<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:tns="http://goodsNomenclatureForWS.ws.taric.dds.s/">
  <soapenv:Header/>
  <soapenv:Body>
    <tns:${operation}>${inner}</tns:${operation}>
  </soapenv:Body>
</soapenv:Envelope>`;
}

function parseXmlBlocks(xml, tag) {
  const regex = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, 'g');
  const matches = [];
  let m;
  while ((m = regex.exec(xml)) !== null) matches.push(m[1]);
  return matches;
}

function extractText(xml, tag) {
  const simple = tag.includes('>') ? null : xml.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`));
  if (simple) return simple[1].trim();
  const parts = tag.split('>').map(s => s.trim());
  let cur = xml;
  for (const p of parts) {
    const m = cur.match(new RegExp(`<${p}[^>]*>([\\s\\S]*?)</${p}>`));
    if (!m) return null;
    cur = m[1];
  }
  return cur.trim();
}

/**
 * Parse a TARIC duty rate string into structured form.
 * Examples:
 *   "12%"              → { adValorem: 12, specific: null, type: "ad_valorem" }
 *   "0%"               → { adValorem: 0,  specific: null, type: "duty_free" }
 *   "0 + 44.0 EUR/100 kg" → { adValorem: 0, specific: { amount: 44, unit: "EUR/100 kg" }, type: "compound" }
 *   "44.0 EUR/100 kg"  → { adValorem: 0, specific: { amount: 44, unit: "EUR/100 kg" }, type: "specific" }
 *   "FREE"             → { adValorem: 0, specific: null, type: "duty_free" }
 */
function parseDutyRate(raw) {
  if (!raw) return null;
  const s = raw.trim();
  if (!s || s.toUpperCase() === 'FREE' || s === '0%') {
    return { adValorem: 0, specific: null, type: 'duty_free', raw: s };
  }

  // Match: optional ad valorem % + optional specific amount + unit
  // Pattern: "12.5%" or "0 + 44.0 EUR/100 kg" or "44.0 EUR/100 kg"
  const avMatch = s.match(/^(\d+(?:\.\d+)?)\s*%/);
  const specificMatch = s.match(/(\d+(?:\.\d+)?)\s+(EUR\/[^\s+]+(?:\s+[^\s+]+)?)/i);

  const adValorem = avMatch ? parseFloat(avMatch[1]) : 0;
  const specific = specificMatch
    ? { amount: parseFloat(specificMatch[1]), unit: specificMatch[2].trim() }
    : null;

  let type = 'duty_free';
  if (adValorem > 0 && specific) type = 'compound';
  else if (adValorem > 0) type = 'ad_valorem';
  else if (specific) type = 'specific';

  return { adValorem, specific, type, raw: s };
}

// TARIC measure type codes (EU TARIC DB reference)
const MEASURE_TYPES = {
  MFN:          ['103'],                    // Third-country (MFN) duty
  PREFERENTIAL: ['141', '142', '143', '145', '146', '147'], // Tariff preferences (FTA/GSP/EBA)
  ANTI_DUMPING: ['551', '552', '553'],      // Anti-dumping duties
  CVD:          ['554', '555', '556'],      // Countervailing duties (separate from ADD)
  SAFEGUARD:    ['695', '696', '724', '725'], // Safeguard measures
  QUOTA_AUTO:   ['122', '123'],             // Autonomous tariff quotas
  QUOTA_PREF:   ['143', '146'],             // Preferential tariff quotas
  SUSPENSION:   ['115', '117', '119'],      // Autonomous suspensions
};

export async function POST(req) {
  // Accepts both NextAuth session cookies (web) and Bearer tokens (mobile).
  // Previously was session-only, which silently 401'd every mobile request.
  const a = await requireUser(req);
  if (a.error) return NextResponse.json({ error: a.error }, { status: a.status });

  let body;
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }); }

  const { cn8, countryCode } = body;
  if (!cn8) return NextResponse.json({ error: 'cn8 required' }, { status: 400 });

  // Validate countryCode format (ISO 2-letter)
  const safeCountry = countryCode ? String(countryCode).replace(/[^A-Za-z]/g, '').toUpperCase().slice(0, 2) : null;

  // Pad/trim to 10 digits (TARIC level)
  const code = cn8.replace(/[^0-9]/g, '').padEnd(10, '0').slice(0, 10);

  const now = new Date();

  try {
    // 1) Get description — 10s timeout
    const descrSoap = makeSoapEnvelope('goodsDescrForWs', {
      goodsCode: code,
      languageCode: 'en',
    });
    const descrResp = await fetch(TARIC_SOAP_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'text/xml; charset=UTF-8', SOAPAction: '""' },
      body: descrSoap,
      signal: AbortSignal.timeout(10000),
    });
    const descrXml = await descrResp.text();
    const description = extractText(descrXml, 'description');
    const declarable = extractText(descrXml, 'declarable') === 'true';
    const refDate = extractText(descrXml, 'reference_date');

    // 2) Get measures if origin country provided
    let measures = [];
    if (safeCountry) {
      const measSoap = makeSoapEnvelope('goodsMeasForWs', {
        goodsCode: code,
        countryCode: safeCountry,
        tradeMovement: 'I',
      });
      const measResp = await fetch(TARIC_SOAP_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'text/xml; charset=UTF-8', SOAPAction: '""' },
        body: measSoap,
        signal: AbortSignal.timeout(10000),
      });
      const measXml = await measResp.text();

      const measureBlocks = parseXmlBlocks(measXml, 'measure');
      measures = measureBlocks.map(m => {
        const mtBlock = m.match(/<measure_type>([\s\S]*)<\/measure_type>/)?.[1] || '';
        const validTo = extractText(m, 'validity_end_date');
        return {
          validFrom: extractText(m, 'validity_start_date'),
          validTo,
          regulation: extractText(m, 'regulation_id'),
          dutyRateRaw: extractText(m, 'duty_rate')?.trim() || null,
          measureType: extractText(mtBlock, 'measure_type'),
          measureDesc: extractText(mtBlock, 'description'),
          tradeMovement: extractText(mtBlock, 'trade_movement_code'),
          // Flag expired measures — filter them out of active calculations
          expired: validTo ? new Date(validTo) < now : false,
        };
      }).filter(m => !m.expired); // Only return currently active measures
    }

    // Parse duty rates for all active measures
    const parsedMeasures = measures.map(m => ({
      ...m,
      dutyRate: parseDutyRate(m.dutyRateRaw),
    }));

    // Extract key rates by measure type
    const mfnMeasure = parsedMeasures.find(m => MEASURE_TYPES.MFN.includes(m.measureType));
    const mfnParsed = mfnMeasure?.dutyRate || null;
    // For backward compat: expose simple adValorem % as mfnRate (null if specific/compound)
    const mfnRate = mfnParsed?.adValorem ?? null;
    const mfnRateType = mfnParsed?.type || null;

    const preferential = parsedMeasures.filter(m => MEASURE_TYPES.PREFERENTIAL.includes(m.measureType));
    const antiDumpingMeasures = parsedMeasures.filter(m => MEASURE_TYPES.ANTI_DUMPING.includes(m.measureType));
    // CVD now separated from ADD — previously incorrectly merged
    const countervailingMeasures = parsedMeasures.filter(m => MEASURE_TYPES.CVD.includes(m.measureType));
    const safeguardMeasures = parsedMeasures.filter(m => MEASURE_TYPES.SAFEGUARD.includes(m.measureType));

    // Tariff rate quotas
    const quotaMeasures = parsedMeasures.filter(m => MEASURE_TYPES.QUOTA_AUTO.concat(MEASURE_TYPES.QUOTA_PREF).includes(m.measureType));
    const quotaRate = quotaMeasures.length > 0 ? (quotaMeasures[0].dutyRate?.adValorem ?? null) : null;

    // Autonomous suspensions (reduced/zero rates outside FTA)
    const suspensionMeasures = parsedMeasures.filter(m => MEASURE_TYPES.SUSPENSION.includes(m.measureType));

    return NextResponse.json({
      cn10: code,
      cn8: code.slice(0, 8),
      chapter: code.slice(0, 2),
      description,
      declarable,
      referenceDate: refDate,
      // MFN duty
      mfnRate,                        // ad valorem % (null if specific/compound)
      mfnRateRaw: mfnMeasure?.dutyRateRaw || null,
      mfnRateType,                    // "ad_valorem" | "specific" | "compound" | "duty_free"
      mfnRateParsed: mfnParsed,       // full parsed object incl. specific duty amount/unit
      // Trade defence — now correctly separated
      antiDumping: antiDumpingMeasures.length > 0,
      antiDumpingMeasures,
      countervailing: countervailingMeasures.length > 0,
      countervailingMeasures,
      safeguard: safeguardMeasures.length > 0,
      safeguardMeasures,
      // Preferential
      preferential,
      tariffQuota: quotaMeasures.length > 0,
      quotaRate,
      quotaMeasures,
      suspensions: suspensionMeasures,
      allMeasures: parsedMeasures,
      source: 'TARIC-API-2026',
    });
  } catch (err) {
    return NextResponse.json({ error: 'TARIC lookup failed', details: err.message }, { status: 502 });
  }
}
