import { NextResponse } from 'next/server';
import { auth } from '@/auth';

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
  // nested: "measure_type > measure_type"
  const parts = tag.split('>').map(s => s.trim());
  let cur = xml;
  for (const p of parts) {
    const m = cur.match(new RegExp(`<${p}[^>]*>([\\s\\S]*?)</${p}>`));
    if (!m) return null;
    cur = m[1];
  }
  return cur.trim();
}

export async function POST(req) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  let body;
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }); }

  const { cn8, countryCode } = body;
  if (!cn8) return NextResponse.json({ error: 'cn8 required' }, { status: 400 });

  // Pad/trim to 10 digits (TARIC level)
  const code = cn8.replace(/[^0-9]/g, '').padEnd(10, '0').slice(0, 10);

  try {
    // 1) Get description
    const descrSoap = makeSoapEnvelope('goodsDescrForWs', {
      goodsCode: code,
      languageCode: 'en',
    });
    const descrResp = await fetch(TARIC_SOAP_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'text/xml; charset=UTF-8', SOAPAction: '""' },
      body: descrSoap,
    });
    const descrXml = await descrResp.text();
    const description = extractText(descrXml, 'description');
    const declarable = extractText(descrXml, 'declarable') === 'true';
    const refDate = extractText(descrXml, 'reference_date');

    // 2) Get measures if origin country provided
    let measures = [];
    if (countryCode) {
      const measSoap = makeSoapEnvelope('goodsMeasForWs', {
        goodsCode: code,
        countryCode: countryCode.toUpperCase(),
        tradeMovement: 'I',
      });
      const measResp = await fetch(TARIC_SOAP_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'text/xml; charset=UTF-8', SOAPAction: '""' },
        body: measSoap,
      });
      const measXml = await measResp.text();

      const measureBlocks = parseXmlBlocks(measXml, 'measure');
      measures = measureBlocks.map(m => {
        const mtBlock = m.match(/<measure_type>([\s\S]*?)<\/measure_type>/)?.[1] || '';
        return {
          validFrom: extractText(m, 'validity_start_date'),
          validTo: extractText(m, 'validity_end_date'),
          regulation: extractText(m, 'regulation_id'),
          dutyRate: extractText(m, 'duty_rate')?.trim() || null,
          measureType: extractText(mtBlock, 'measure_type'),
          measureDesc: extractText(mtBlock, 'description'),
          tradeMovement: extractText(mtBlock, 'trade_movement_code'),
        };
      });
    }

    // Extract key rates
    const mfnMeasure = measures.find(m => m.measureType === '103');
    const mfnRate = mfnMeasure ? parseFloat(mfnMeasure.dutyRate) ?? null : null;
    const preferential = measures.filter(m => ['142', '145'].includes(m.measureType));
    const antiDumpingMeasures = measures.filter(m => ['551', '552', '553', '554'].includes(m.measureType));

    return NextResponse.json({
      cn10: code,
      cn8: code.slice(0, 8),
      chapter: code.slice(0, 2),
      description,
      declarable,
      referenceDate: refDate,
      mfnRate,
      mfnRateRaw: mfnMeasure?.dutyRate?.trim() || null,
      preferential,
      antiDumping: antiDumpingMeasures.length > 0,
      antiDumpingMeasures,
      allMeasures: measures,
      source: 'TARIC-API-2026',
    });
  } catch (err) {
    return NextResponse.json({ error: 'TARIC lookup failed', details: err.message }, { status: 502 });
  }
}
