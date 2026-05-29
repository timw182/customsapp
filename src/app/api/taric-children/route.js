import { NextResponse } from "next/server";
import { requireUser } from "@/lib/apiAuth";

export const maxDuration = 60;

const TARIC_SOAP_URL = "https://ec.europa.eu/taxation_customs/dds2/taric/services/goods";
const MFN_TYPES = new Set(["103"]);

function makeSoap(operation, params) {
  const inner = Object.entries(params)
    .map(([k, v]) => (v != null ? `<tns:${k}>${v}</tns:${k}>` : ""))
    .join("");
  return `<?xml version="1.0" encoding="UTF-8"?>
<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:tns="http://goodsNomenclatureForWS.ws.taric.dds.s/">
  <soapenv:Header/>
  <soapenv:Body><tns:${operation}>${inner}</tns:${operation}></soapenv:Body>
</soapenv:Envelope>`;
}

function xmlText(xml, tag) {
  const m = xml.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`));
  return m ? m[1].trim() : null;
}

function xmlBlocks(xml, tag) {
  const re = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, "g");
  const out = []; let m;
  while ((m = re.exec(xml)) !== null) out.push(m[1]);
  return out;
}

function parseDutyRate(raw) {
  if (!raw) return null;
  const s = raw.trim();
  if (!s || s.toUpperCase() === "FREE" || s === "0%") return { adValorem: 0, type: "duty_free", raw: s };
  const av = s.match(/^(\d+(?:\.\d+)?)\s*%/);
  const sp = s.match(/(\d+(?:\.\d+)?)\s+(EUR\/[^\s+]+(?:\s+[^\s+]+)?)/i);
  const adValorem = av ? parseFloat(av[1]) : 0;
  const specific = sp ? { amount: parseFloat(sp[1]), unit: sp[2].trim() } : null;
  let type = "duty_free";
  if (adValorem > 0 && specific) type = "compound";
  else if (adValorem > 0) type = "ad_valorem";
  else if (specific) type = "specific";
  return { adValorem, specific, type, raw: s };
}

async function probeCode(code10) {
  try {
    const resp = await fetch(TARIC_SOAP_URL, {
      method: "POST",
      headers: { "Content-Type": "text/xml; charset=UTF-8", SOAPAction: '""' },
      body: makeSoap("goodsDescrForWs", { goodsCode: code10, languageCode: "en" }),
      signal: AbortSignal.timeout(8000),
    });
    const xml = await resp.text();
    if (xml.includes("<faultstring>")) return null;
    const description = xmlText(xml, "description");
    if (!description) return null;
    const declarable = xmlText(xml, "declarable") === "true";
    return { code10, description, declarable };
  } catch {
    return null;
  }
}

async function getMfnRate(code10) {
  try {
    const resp = await fetch(TARIC_SOAP_URL, {
      method: "POST",
      headers: { "Content-Type": "text/xml; charset=UTF-8", SOAPAction: '""' },
      body: makeSoap("goodsMeasForWs", { goodsCode: code10, countryCode: "US", tradeMovement: "I" }),
      signal: AbortSignal.timeout(8000),
    });
    const xml = await resp.text();
    const blocks = xmlBlocks(xml, "measure");
    const now = new Date();
    const measures = blocks.map(m => {
      const mtBlock = m.match(/<measure_type>([\s\S]*?)<\/measure_type>/)?.[1] || "";
      const validTo = xmlText(m, "validity_end_date");
      return {
        measureType: xmlText(mtBlock, "measure_type"),
        dutyRateRaw: xmlText(m, "duty_rate")?.trim() || null,
        expired: validTo ? new Date(validTo) < now : false,
      };
    }).filter(m => !m.expired);
    const mfnMeasure = measures.find(m => MFN_TYPES.has(m.measureType));
    if (!mfnMeasure) return { mfnRate: null, mfnRateRaw: null };
    const parsed = parseDutyRate(mfnMeasure.dutyRateRaw);
    return { mfnRate: parsed?.adValorem ?? null, mfnRateRaw: mfnMeasure.dutyRateRaw };
  } catch {
    return { mfnRate: null, mfnRateRaw: null };
  }
}

export async function GET(req) {
  const a = await requireUser(req);
  if (a.error) return NextResponse.json({ error: a.error }, { status: a.status });

  const { searchParams } = new URL(req.url);
  const raw = (searchParams.get("code") ?? "").replace(/\D/g, "");

  if (raw.length < 6 || raw.length >= 10) {
    return NextResponse.json(
      { error: "code must be 6–9 digits (use /api/taric for 10-digit codes)" },
      { status: 400 }
    );
  }

  // Normalize to either 6 or 8 digits
  const clean = raw.length <= 7 ? raw.slice(0, 6) : raw.slice(0, 8);
  const is6 = clean.length === 6;

  let declarableCn10s = [];
  let taricDown = false;

  try {
    if (is6) {
      // Probe 10 CN8-level candidates (padded to 10 digits)
      const cn8Candidates = Array.from({ length: 10 }, (_, i) =>
        (clean + String(i * 10).padStart(2, "0")).padEnd(10, "0")
      );
      const cn8Results = await Promise.all(cn8Candidates.map(probeCode));

      // Also collect non-declarable parents to probe their CN10 children
      const cn10ProbeTargets = [];
      for (const r of cn8Results) {
        if (!r) continue;
        if (r.declarable) {
          declarableCn10s.push(r);
        } else {
          // Parent CN8 node — probe its CN10 children
          const cn8 = r.code10.slice(0, 8);
          for (let i = 0; i <= 9; i++) {
            cn10ProbeTargets.push(cn8 + String(i * 10).padStart(2, "0"));
          }
        }
      }

      // Probe CN10 children in batches of 10
      for (let i = 0; i < cn10ProbeTargets.length; i += 10) {
        const batch = cn10ProbeTargets.slice(i, i + 10);
        const results = await Promise.all(batch.map(probeCode));
        for (const r of results) {
          if (r?.declarable) declarableCn10s.push(r);
        }
      }
    } else {
      // 8-digit path: probe 10 CN10 candidates directly
      const cn10Candidates = Array.from({ length: 10 }, (_, i) =>
        clean + String(i * 10).padStart(2, "0")
      );
      const results = await Promise.all(cn10Candidates.map(probeCode));
      declarableCn10s = results.filter(r => r?.declarable);
    }

    // Fetch MFN rates for all declarable CN10s in one parallel batch
    const rateResults = await Promise.all(declarableCn10s.map(r => getMfnRate(r.code10)));

    const children = declarableCn10s.map((r, idx) => ({
      cn10: r.code10,
      cn8: r.code10.slice(0, 8),
      description: r.description,
      mfnRate: rateResults[idx]?.mfnRate ?? null,
      mfnRateRaw: rateResults[idx]?.mfnRateRaw ?? null,
    }));

    return NextResponse.json({ code: clean, children });
  } catch {
    taricDown = true;
    return NextResponse.json({ code: clean, children: [], taricDown });
  }
}
