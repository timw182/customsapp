import { NextResponse } from "next/server";
import { requireUser } from "@/lib/apiAuth";

const TARIC_SOAP_URL = "https://ec.europa.eu/taxation_customs/dds2/taric/services/goods";

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

async function fetchDescriptionOnce(code, lang, timeoutMs) {
  const res = await fetch(TARIC_SOAP_URL, {
    method: "POST",
    headers: { "Content-Type": "text/xml; charset=utf-8", SOAPAction: '""' },
    body: makeSoap("goodsDescrForWs", { goodsCode: code, languageCode: lang }),
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) throw new Error(`taric ${res.status}`);
  const xml = await res.text();
  return xml.match(/<description>([^<]+)<\/description>/)?.[1]?.trim() ?? "";
}

// Single retry on transient failure — TARIC SOAP is flaky.
// Returns { text, ok } so we can distinguish "upstream down" from "code not found".
async function fetchDescription(code, lang) {
  try {
    return { text: await fetchDescriptionOnce(code, lang, 12000), ok: true };
  } catch {
    await new Promise(r => setTimeout(r, 400));
    try {
      return { text: await fetchDescriptionOnce(code, lang, 15000), ok: true };
    } catch {
      return { text: "", ok: false };
    }
  }
}

function dedupe(descs) {
  const out = [];
  for (const d of descs) {
    if (d && d !== out[out.length - 1]) out.push(d);
  }
  return out;
}

export async function GET(req) {
  const a = await requireUser(req);
  if (a.error) return NextResponse.json({ error: a.error }, { status: a.status });

  const { searchParams } = new URL(req.url);
  const raw = (searchParams.get("code") ?? "").replace(/\D/g, "");
  if (raw.length < 6 || raw.length > 10) {
    return NextResponse.json({ error: "HS/CN code must be 6–10 digits" }, { status: 400 });
  }

  // Build the hierarchy: chapter (2), heading (4), subheading (6), CN8, CN10
  // Only include levels that fit within the supplied code.
  const prefixes = [2, 4, 6, 8, 10].filter((n) => n <= raw.length);
  const levels = [...new Set(prefixes.map((n) => raw.slice(0, n).padEnd(10, "0")))];

  try {
    const [enResults, frResults] = await Promise.all([
      Promise.all(levels.map((c) => fetchDescription(c, "en"))),
      Promise.all(levels.map((c) => fetchDescription(c, "fr"))),
    ]);
    const en = dedupe(enResults.map(r => r.text));
    const fr = dedupe(frResults.map(r => r.text));
    const anyOk = [...enResults, ...frResults].some(r => r.ok);

    if (!anyOk) {
      return NextResponse.json(
        { error: "EU TARIC service is currently unreachable. Please retry in a moment." },
        { status: 502 },
      );
    }
    if (en.length === 0 && fr.length === 0) {
      return NextResponse.json(
        { error: "No TARIC entry found for this code. Check the digits and try again." },
        { status: 404 },
      );
    }
    return NextResponse.json({ code: raw, en, fr });
  } catch {
    return NextResponse.json(
      { error: "EU TARIC service is currently unreachable. Please retry in a moment." },
      { status: 502 },
    );
  }
}
