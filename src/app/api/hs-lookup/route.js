import { NextResponse } from "next/server";
import { requireUser } from "@/lib/apiAuth";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
export const maxDuration = 60;

// Cache entries older than 180 days are considered stale (CN codes update annually)
const CACHE_MAX_AGE_DAYS = 180;

function normalizeDescription(s) {
  return s.toLowerCase().trim().replace(/\s+/g, " ");
}

const TARIC_SOAP_URL = "https://ec.europa.eu/taxation_customs/dds2/taric/services/goods";
const TARIC_TREE_BASE = "https://ec.europa.eu/taxation_customs/dds2/taric/nomenclaturetree";

const classifySchema = z.object({
  type: z.literal("classify"),
  description: z.string().min(1).max(1000),
});

const rateSchema = z.object({
  type: z.literal("rate"),
  code: z.string().min(4).max(14),
});

const bodySchema = z.discriminatedUnion("type", [classifySchema, rateSchema]);

// ── TARIC SOAP helpers ────────────────────────────────────────────────────────

function makeSoap(operation, params) {
  const inner = Object.entries(params)
    .map(([k, v]) => v != null ? `<tns:${k}>${v}</tns:${k}>` : "")
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

const MFN_TYPES = new Set(["103"]);
const PREF_TYPES = new Set(["141","142","143","145","146","147"]);
const PROHIBITION_TYPES = new Set(["277", "278"]);
const LICENSING_TYPES = new Set(["750", "755", "717", "718", "760", "761", "762"]);

// Static chapter-level sensitivity map — used when TARIC has no explicit prohibition/licensing measure
const SENSITIVE_CHAPTERS = {
  "01": { category: "Live animals", warning: "Protected species require a CITES permit under the Convention on International Trade in Endangered Species.", licenceAuthority: "CITES Management Authority", regulations: ["CITES Appendix I/II/III", "EU Wildlife Trade Regulation 338/97"] },
  "02": { category: "Meat and edible offal", warning: "Requires veterinary health certificate; may be subject to import bans based on origin-country disease status.", regulations: ["EU Regulation 853/2004", "Veterinary import conditions"] },
  "03": { category: "Fish and seafood", warning: "Protected species require CITES permit. EU imports require an IUU catch certificate (Regulation 1005/2008).", licenceAuthority: "Fisheries authority / CITES Management Authority", regulations: ["EU IUU Regulation 1005/2008", "CITES"] },
  "05": { category: "Animal products", warning: "Health certificates required; parts of protected species require a CITES permit.", regulations: ["CITES", "EU Wildlife Trade Regulation 338/97"] },
  "06": { category: "Live trees and plants", warning: "Phytosanitary certificate required. Protected plant species need a CITES permit.", licenceAuthority: "Phytosanitary authority / CITES Management Authority", regulations: ["EU Phytosanitary Regulation 2016/2031", "CITES"] },
  "28": { category: "Inorganic chemicals", warning: "Certain substances are regulated drug precursors under EU Regulation 2019/1148; export authorisation may be required.", regulations: ["EU Regulation 2019/1148", "UN Convention against Illicit Traffic in Narcotic Drugs"] },
  "29": { category: "Organic chemicals", warning: "May be scheduled drug precursors under EU Regulation 2019/1148. Pre-export notification or licence required for certain substances.", licenceAuthority: "National competent authority", regulations: ["EU Regulation 2019/1148", "UN Drug Conventions (1961/1971/1988)"] },
  "30": { category: "Pharmaceutical products", warning: "Narcotics and psychotropic substances require import/export authorisation. Medicinal products require marketing authorisation.", licenceAuthority: "National medicines agency / narcotics bureau", regulations: ["UN Single Convention on Narcotic Drugs 1961", "EU Directive 2001/83/EC"] },
  "36": { category: "Explosives and pyrotechnics", warning: "Subject to strict import/export controls. Import licence required in most jurisdictions. Civilian use is heavily restricted.", licenceAuthority: "National explosives authority", regulations: ["EU Directive 2014/28/EU", "EU Regulation 2019/1148 on explosives precursors"], consequences: "Unlicensed import may result in immediate seizure and criminal prosecution." },
  "38": { category: "Miscellaneous chemical products", warning: "Some products are dual-use or regulated as precursors. Verify against the EU Dual-Use Regulation and precursor lists.", regulations: ["EU Dual-Use Regulation 2021/821", "EU Regulation 2019/1148"] },
  "44": { category: "Wood and wood articles", warning: "Subject to EU Deforestation Regulation (EUDR) — due diligence statement required. FLEGT timber licence needed from certain origins.", licenceAuthority: "Competent authority under EUDR", regulations: ["EU Deforestation Regulation 2023/1115", "FLEGT Regulation 995/2010"] },
  "87": { category: "Vehicles", warning: "Armoured and military vehicles are subject to EU Dual-Use export controls and may require individual export authorisation.", regulations: ["EU Dual-Use Regulation 2021/821", "Arms Trade Treaty"] },
  "88": { category: "Aircraft and spacecraft", warning: "Military aircraft require export authorisation. Subject to Wassenaar Arrangement controls.", licenceAuthority: "National export control authority", regulations: ["EU Dual-Use Regulation 2021/821", "Wassenaar Arrangement"] },
  "89": { category: "Ships and floating structures", warning: "Warships and naval vessels are subject to strict arms export controls.", regulations: ["EU Dual-Use Regulation 2021/821", "Arms Trade Treaty"] },
  "93": { category: "Arms and ammunition", warning: "Firearms and ammunition require import authorisation under EU Firearms Directive. Prohibited in many civilian contexts.", licenceAuthority: "National firearms authority", regulations: ["EU Firearms Directive 91/477/EEC (amended 2017/853)", "Arms Trade Treaty", "UN Programme of Action on Small Arms"], consequences: "Import without authorisation will result in seizure. Criminal penalties apply in most jurisdictions." },
  "97": { category: "Works of art and antiques", warning: "Import of cultural goods from certain regions requires proof of lawful export. Items containing CITES-listed materials (ivory, coral, tortoiseshell) require permits.", regulations: ["EU Regulation 2019/880 on import of cultural goods", "CITES", "UNESCO Convention 1970"] },
};

function buildSensitiveGoods(hs6, bestMatch) {
  const chapter = (hs6 || "").slice(0, 2);

  if (bestMatch?.prohibited) {
    const base = SENSITIVE_CHAPTERS[chapter] ?? {};
    return {
      category: base.category ?? "Prohibited goods",
      warning: "This product is subject to an EU import prohibition (TARIC measure 277). Import is not permitted.",
      licenceAuthority: "EU Customs / National competent authority",
      regulations: base.regulations ?? [],
      consequences: "Goods will be seized at customs. Criminal penalties may apply.",
    };
  }

  if (bestMatch?.licensing?.length > 0) {
    const base = SENSITIVE_CHAPTERS[chapter] ?? {};
    const isCITES = bestMatch.licensing.includes("755");
    return {
      category: base.category ?? "Licence-controlled goods",
      warning: isCITES
        ? "This product requires a CITES permit for import into the EU."
        : `Import licence required (TARIC measure type ${bestMatch.licensing.join(", ")}). Contact the relevant authority before importing.`,
      licenceAuthority: base.licenceAuthority ?? "National competent authority",
      regulations: base.regulations ?? [],
      consequences: "Import without required authorisation may result in seizure and penalties.",
    };
  }

  return SENSITIVE_CHAPTERS[chapter] ?? null;
}

async function taricVerify(cn8, originCountry = null) {
  const code = cn8.replace(/\D/g, "").padEnd(10, "0").slice(0, 10);
  try {
    const descrResp = await fetch(TARIC_SOAP_URL, {
      method: "POST",
      headers: { "Content-Type": "text/xml; charset=UTF-8", SOAPAction: '""' },
      body: makeSoap("goodsDescrForWs", { goodsCode: code, languageCode: "en" }),
      signal: AbortSignal.timeout(8000),
    });
    const descrXml = await descrResp.text();
    if (descrXml.includes("<faultstring>")) return null;
    const description = xmlText(descrXml, "description");
    if (!description) return null;
    const declarable = xmlText(descrXml, "declarable") === "true";

    let mfnRate = null, mfnRateRaw = null;
    const country = originCountry ? originCountry.replace(/[^A-Za-z]/g, "").toUpperCase().slice(0, 2) : "US";
    const measResp = await fetch(TARIC_SOAP_URL, {
      method: "POST",
      headers: { "Content-Type": "text/xml; charset=UTF-8", SOAPAction: '""' },
      body: makeSoap("goodsMeasForWs", { goodsCode: code, countryCode: country, tradeMovement: "I" }),
      signal: AbortSignal.timeout(8000),
    });
    const measXml = await measResp.text();
    const blocks = xmlBlocks(measXml, "measure");
    const now = new Date();
    const measures = blocks.map(m => {
      const mtBlock = m.match(/<measure_type>([\s\S]*?)<\/measure_type>/)?.[1] || "";
      const validTo = xmlText(m, "validity_end_date");
      return { measureType: xmlText(mtBlock, "measure_type"), dutyRateRaw: xmlText(m, "duty_rate")?.trim() || null, expired: validTo ? new Date(validTo) < now : false };
    }).filter(m => !m.expired);
    const mfnMeasure = measures.find(m => MFN_TYPES.has(m.measureType));
    if (mfnMeasure) { mfnRateRaw = mfnMeasure.dutyRateRaw; mfnRate = parseDutyRate(mfnRateRaw)?.adValorem ?? null; }

    return { description, declarable, mfnRate, mfnRateRaw, code10: code };
  } catch { return null; }
}

// ── TARIC nomenclature tree fallback ─────────────────────────────────────────
// When the SOAP service is down, we fall back to the daily-published static
// nomenclature tree JS files. These confirm code existence + descriptions but
// do NOT contain duty rates.

function extractJsonArray(js, varName) {
  const startStr = `${varName} = `;
  const idx = js.indexOf(startStr);
  if (idx < 0) return null;
  let pos = idx + startStr.length;
  if (js[pos] !== "[") return null;
  let depth = 0, inStr = false, escape = false;
  for (let i = pos; i < js.length; i++) {
    const ch = js[i];
    if (escape) { escape = false; continue; }
    if (ch === "\\") { escape = true; continue; }
    if (ch === '"') { inStr = !inStr; continue; }
    if (inStr) continue;
    if (ch === "[") depth++;
    else if (ch === "]") { depth--; if (depth === 0) { try { return JSON.parse(js.slice(pos, i + 1)); } catch { return null; } } }
  }
  return null;
}

async function taricBrowseHeadingFromTree(heading) {
  const h = heading.replace(/\D/g, "").slice(0, 4);
  if (h.length !== 4) return [];
  const chapter = h.slice(0, 2).padStart(2, "0");
  // EU publishes nomenclature tree files on Jan 1 of the regulation year, not daily.
  // Try current-year Jan 1, previous-year Jan 1, then today as a last resort.
  const now = new Date();
  const year = now.getFullYear();
  const today = now.toISOString().slice(0, 10).replace(/-/g, "");
  const datesToTry = [`${year}0101`, `${year - 1}0101`, today];
  let js = null;
  for (const date of datesToTry) {
    try {
      const url = `${TARIC_TREE_BASE}/nomenclaturetree_en_${date}_${chapter}_en.js`;
      const resp = await fetch(url, { signal: AbortSignal.timeout(12000) });
      if (resp.ok) { js = await resp.text(); break; }
    } catch { /* try next date */ }
  }
  if (!js) return [];
  try {
    const tree = extractJsonArray(js, "chaptertree");
    if (!tree) return [];
    const results = [];
    const seen = new Set();
    function walk(nodes) {
      if (!Array.isArray(nodes)) return;
      for (const node of nodes) {
        if (!Array.isArray(node) || node.length < 6) continue;
        const code = node[2];
        const desc = node[5];
        const children = node[7];
        if (typeof code === "string" && code.length === 10 && code.startsWith(h)) {
          const declarable = !Array.isArray(children);
          if (declarable && !seen.has(code)) {
            seen.add(code);
            results.push({
              cn8: code.slice(0, 8),
              cn10: code,
              description: typeof desc === "string" ? desc.replace(/ : $/, "").trim() : "",
              declarable: true,
              mfnRate: null,
              mfnRateRaw: null,
              _fromTree: true,
            });
          }
        }
        if (Array.isArray(children)) walk(children);
      }
    }
    walk(tree);
    return results;
  } catch { return []; }
}

// ── TARIC subheading browser ──────────────────────────────────────────────────

/**
 * Probe TARIC SOAP for valid declarable CN10 codes under a 4-digit heading.
 * Three-level probing:
 *   1. HS6 subheadings (heading + 10..90)
 *   2. CN8 extensions under each valid HS6 (hs6 + 00..90) → padded to CN10 with "00"
 *   3. For non-declarable CN8s, probe CN10 subdivisions (cn8 + 10..90)
 * Returns only TARIC-confirmed declarable codes with descriptions and MFN duty rates.
 * Falls back to nomenclature tree files when the SOAP service is unavailable.
 */
async function taricBrowseHeading(heading, extraCodes = []) {
  const h = heading.replace(/\D/g, "").slice(0, 4);
  if (h.length !== 4) return [];

  // Helper: probe a single CN10 code via SOAP.
  // Returns null if code not found; throws { isTaricDown: true } if service is broken.
  async function verifyExact(cn10) {
    const code = cn10.replace(/\D/g, "").padEnd(10, "0").slice(0, 10);
    let descrXml;
    try {
      const descrResp = await fetch(TARIC_SOAP_URL, {
        method: "POST",
        headers: { "Content-Type": "text/xml; charset=UTF-8", SOAPAction: '""' },
        body: makeSoap("goodsDescrForWs", { goodsCode: code, languageCode: "en" }),
        signal: AbortSignal.timeout(8000),
      });
      descrXml = await descrResp.text();
    } catch (e) {
      // Network error — service unreachable
      const err = new Error("TARIC_DOWN");
      err.isTaricDown = true;
      throw err;
    }

    // Server-side fault: "A technical error occurred" or similar
    if (descrXml.includes("<faultstring>")) {
      const err = new Error("TARIC_DOWN");
      err.isTaricDown = true;
      throw err;
    }

    const description = xmlText(descrXml, "description");
    if (!description) return null; // Code genuinely not in TARIC
    const declarable = xmlText(descrXml, "declarable") === "true";

    let mfnRate = null, mfnRateRaw = null, prohibited = false;
    const licensing = [];
    if (declarable) {
      try {
        const measResp = await fetch(TARIC_SOAP_URL, {
          method: "POST",
          headers: { "Content-Type": "text/xml; charset=UTF-8", SOAPAction: '""' },
          body: makeSoap("goodsMeasForWs", { goodsCode: code, countryCode: "US", tradeMovement: "I" }),
          signal: AbortSignal.timeout(8000),
        });
        const measXml = await measResp.text();
        if (!measXml.includes("<faultstring>")) {
          const blocks = xmlBlocks(measXml, "measure");
          const now = new Date();
          for (const m of blocks) {
            const mtBlock = m.match(/<measure_type>([\s\S]*)<\/measure_type>/)?.[1] || "";
            const mt = xmlText(mtBlock, "measure_type");
            const validTo = xmlText(m, "validity_end_date");
            const expired = validTo ? new Date(validTo) < now : false;
            if (expired || !mt) continue;
            if (MFN_TYPES.has(mt) && !mfnRateRaw) {
              mfnRateRaw = xmlText(m, "duty_rate")?.trim() || null;
              mfnRate = parseDutyRate(mfnRateRaw)?.adValorem ?? null;
            }
            if (PROHIBITION_TYPES.has(mt)) prohibited = true;
            if (LICENSING_TYPES.has(mt) && !licensing.includes(mt)) licensing.push(mt);
          }
        }
      } catch {} // Rate lookup failure is non-fatal
    }
    return { code10: code, description, declarable, mfnRate, mfnRateRaw, prohibited, licensing };
  }

  try {
    // Step 1: probe HS6 subheadings (heading + 10..90)
    const hs6Probes = [];
    for (let i = 1; i <= 9; i++) hs6Probes.push(h + String(i * 10).padStart(2, "0"));

    const hs6Results = await Promise.all(hs6Probes.map(hs6 => verifyExact(hs6 + "0000")));
    const validHs6 = hs6Probes.filter((_, i) => hs6Results[i]);

    // Step 2: probe CN8 under each valid HS6 (hs6 + 00..90, padded to 10 with "00")
    const cn8Probes = [];
    for (const hs6 of validHs6) {
      for (let i = 0; i <= 9; i++) cn8Probes.push(hs6 + String(i * 10).padStart(2, "0") + "00");
    }
    for (const code of extraCodes) {
      const clean = code.replace(/\D/g, "").padEnd(10, "0").slice(0, 10);
      if (!cn8Probes.includes(clean)) cn8Probes.push(clean);
    }

    const cn8Results = [];
    for (let i = 0; i < cn8Probes.length; i += 15) {
      const batch = cn8Probes.slice(i, i + 15);
      const results = await Promise.all(batch.map(c => verifyExact(c)));
      batch.forEach((code, j) => { if (results[j]) cn8Results.push({ code, ...results[j] }); });
    }

    // Step 3: for non-declarable CN8 results, probe CN10 subdivisions (cn8 + 10..90)
    const nonDeclarable = cn8Results.filter(r => !r.declarable);
    const cn10Probes = [];
    for (const r of nonDeclarable) {
      const cn8 = r.code.slice(0, 8);
      for (let i = 1; i <= 9; i++) cn10Probes.push(cn8 + String(i * 10).padStart(2, "0"));
    }

    const cn10Results = [];
    for (let i = 0; i < cn10Probes.length; i += 15) {
      const batch = cn10Probes.slice(i, i + 15);
      const results = await Promise.all(batch.map(c => verifyExact(c)));
      batch.forEach((code, j) => { if (results[j]) cn10Results.push({ code, ...results[j] }); });
    }

    const all = [...cn8Results, ...cn10Results];
    const seen = new Set();
    return all
      .filter(r => {
        if (!r.declarable) return false;
        if (seen.has(r.code10)) return false;
        seen.add(r.code10);
        return true;
      })
      .map(r => ({
        cn8: r.code10.slice(0, 8),
        cn10: r.code10,
        description: r.description,
        declarable: true,
        mfnRate: r.mfnRate,
        mfnRateRaw: r.mfnRateRaw,
        prohibited: r.prohibited ?? false,
        licensing: r.licensing ?? [],
      }));
  } catch (e) {
    if (e?.isTaricDown) {
      // TARIC SOAP is unavailable — fall back to nomenclature tree files (no rates)
      console.warn("[hs-lookup] TARIC SOAP down — falling back to nomenclature tree");
      const treeResults = await taricBrowseHeadingFromTree(h);
      // Signal to caller whether we got results or the service is genuinely down
      if (treeResults.length === 0) {
        const err = new Error("TARIC_SERVICE_DOWN");
        err.isTaricServiceDown = true;
        throw err;
      }
      return treeResults;
    }
    return [];
  }
}

// ── Claude call helper ────────────────────────────────────────────────────────

async function callClaude(system, userMsg, model = "claude-sonnet-4-6", maxTokens = 2500) {
  const resp = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": process.env.ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model,
      max_tokens: maxTokens,
      system,
      messages: [{ role: "user", content: userMsg }],
    }),
  });
  if (!resp.ok) {
    const errText = await resp.text().catch(() => "");
    console.error(`[hs-lookup] Claude API error (${model}):`, resp.status, errText.slice(0, 300));
    throw new Error(`Claude API ${resp.status}`);
  }
  const data = await resp.json();
  const text = data.content?.find(b => b.type === "text")?.text || "";
  try {
    return JSON.parse(text.replace(/```json|```/g, "").trim());
  } catch (e) {
    console.error(`[hs-lookup] JSON parse error (${model}). Raw:`, text.slice(0, 500));
    throw e;
  }
}

// Lightweight system prompt for Haiku — no WCO/BTI citation required, just correct heading.
const HAIKU_SYSTEM = `You are an EU customs classification expert. Classify products into the correct HS subheading (6-digit) for EU import.

NOMENCLATURE: CN 2026 (Reg EU 2025/1926, from 1 Jan 2026). HS 6-digit level is HS 2022.
Key changes your training may not have:
- Chapter 95 Additional Note 1 DELETED (1 Nov 2025): classify festive goods by material (GRI 1), NOT as 9505
- 8803 abolished → 8807 (aircraft parts); 8806 = UAVs
- New CN8 subheadings (TARIC resolves 8–10 digits, you only return 6): NMC oxide 2841 90, LFP 2842 90, artificial graphite 3801 10, PV wafers 3818 00, wind tower 7308 20, turbine rotors/blades 8410 90/8412 90, H2 fuel cell gen 8501 33, MPPT inverter 8504 40, battery separator 8507 90, electrolysis cell stack 8543 90

Output raw JSON only. Two options:

OPTION A — confident (clear single heading):
{"status":"classified","hs6":"6-digit","heading":"4-digit","confidence":"high","reasoning":"1-2 sentence justification citing the key GRI or chapter note"}

OPTION B — not confident (ambiguous, needs info, multiple options, or unusual product):
{"status":"escalate","reason":"why you are not confident"}

Rules:
- Return OPTION A only when you are genuinely certain of the 6-digit subheading
- Return OPTION B for anything ambiguous, multi-material, dual-use, specialty chemical, or where you would normally ask a follow-up question
- Never refuse to classify — if completely unsure return OPTION B
- Output raw JSON, no markdown`;

const CLASSIFY_SYSTEM = `You are a customs classification expert specializing in EU Combined Nomenclature (CN) and TARIC.

Your task: classify products into the correct HS HEADING (4-digit) and SUBHEADING (6-digit) based on a description.

CRITICAL: You must ONLY return 6-digit HS codes (subheading level). The 7th–10th digits (CN8/TARIC) will be resolved automatically from the official EU TARIC database. Do NOT guess CN8 or CN10 codes — they change annually and your training data may be outdated.

NOMENCLATURE IN FORCE: Use CN 2026 (Commission Implementing Regulation (EU) 2025/1926, OJ L 31.10.2025, applicable from 1 January 2026). The 6-digit HS subheadings are still HS 2022 — only the EU's 8–10 digit CN extensions changed. Key restructuring to know:
- HS 2017: 8803 abolished → 8807; 8806 (UAVs) added
- HS 2022: Chapter 28/29 battery precursors restructured
- CN 2026 (new at CN8 level, your training data will NOT have these — TARIC probing handles them):
  • 2841 90 40 — Lithium nickel manganese cobalt oxides (NMC cathode powder) [was: 2841 90 other]
  • 2842 90 20 — Lithium iron phosphate (LFP cathode powder) [was: 2842 90 other]
  • 3801 10 10/90 — Artificial graphite split by ash content [was: 3801 10 00]
  • 3818 00 1x — Photovoltaic silicon wafers ≤200 µm (so-called PV wafers) [new split]
  • 7308 20 10 — Tubular wind turbine steel towers and tower-sections [was: 7308 20 other, now free]
  • 8410 90 10/20 — Rotors / Stators for hydraulic turbines [was: 8410 90 other]
  • 8412 90 60 — Wind turbine blades [was: 8412 90 other]
  • 8501 33 10 — Hydrogen fuel cell generators 75–375 kW [was: 8501 33 other]
  • 8504 40 84 — Inverters with maximum power point tracking (MPPT) functionality [was: 8504 40 other]
  • 8507 90 31/39 — Battery separators of plastic film ≤40 µm / other [was: 8507 90 other]
  • 8543 90 10 — Assemblies of stacked galvanic cells for water electrolysis (H₂/O₂ production) [was: 8543 90 other]
  • Chapter 29 new: 2909 30 37 (decabromodiphenyl ether), 2915 60 11 (1-isopropyl-2,2-dimethyltrimethylene diisobutyrate)

CLASSIFICATION RULE CHANGES — these affect the correct 6-digit heading, not just CN8 extensions:

1. CHAPTER 95 — Christmas articles (effective 1 November 2025, Reg EU 2025/1926 Art.1(1)):
   Additional Note 1 to Chapter 95 has been DELETED. This note previously overrode GRI and classified Christmas/festive articles under 9505 regardless of their material or function.
   Now apply GRI 1 strictly by material and function:
   - Plastic Christmas tree ornaments → Chapter 39 (plastics), not 9505
   - Glass Christmas ornaments → Chapter 70, not 9505
   - Textile advent calendars → Chapter 63, not 9505
   - Purpose-made Christmas crackers (pyrotechnic) → 3604
   - Articles that ARE toys (playable by children) → 9503, not 9505
   ONLY classify under 9505 if the article is exclusively a festivity decoration with no other function and cannot be classified more specifically elsewhere. When in doubt, classify by material.

2. DICHLOROETHYLENE / HALOGENATED ETHYLENE MIXTURES (Annex 10 amendment, Reg EU 2025/1926):
   Dichloroethylene and mixtures containing halogenated derivatives of ethylene or propylene CANNOT be classified as derivatives of ethane (Chapter 29 ethane subheadings). These must be classified under their own specific subheadings as halogenated derivatives of ethylene/propylene:
   - 1,2-dichloroethylene → 2903 29 (halogenated derivatives of acyclic hydrocarbons, unsaturated)
   - Mixtures of halogenated ethylene/propylene derivatives → 2903 or 3824 depending on composition and use
   Do NOT classify these as ethane derivatives.

When classifying CN 2026 product types in the list above, note in your reasoning that a dedicated CN 2026 subheading exists at the 8-digit level (TARIC will resolve it). Classify to the correct 6-digit HS subheading.

PROCESS:
1. Extract key classification attributes: material, function/use, product category, level of processing
2. Check Chapter Notes and Section Notes for exclusions first (GRI 1)
3. For festive/seasonal goods: apply GRI 1 by material since Chapter 95 Note 1 is deleted
4. For halogenated hydrocarbons: verify ethylene vs ethane origin before selecting subheading
5. Map to the most specific 6-digit HS subheading
6. For clean-energy goods (battery materials, wind/solar, electrolysis), flag CN 2026 subheading in reasoning

RESPONSE FORMAT — pick exactly ONE of the four options below. Output raw JSON only, no markdown, no code fences.

OPTION 1 — HIGH/MEDIUM CONFIDENCE (you can determine a single subheading):
{
  "status": "classified",
  "hs6": "6-digit string (e.g. 880730)",
  "heading": "4-digit heading (e.g. 8807)",
  "confidence": "high | medium",
  "reasoning": "Authoritative reasoning citing: (1) which GRI applies (GRI 1–6) and why, (2) the relevant Chapter Note or Section Note by number (e.g. 'Chapter 61 Note 3 excludes...'), (3) the WCO Explanatory Note for the heading/subheading (e.g. 'EN 6203 covers...'), (4) any applicable EU BTI reference or CJEU ruling. If a CN 2026 dedicated subheading exists for this product, state it explicitly. Be specific — quote the rule, do not just name it.",
  "chapter": "HS chapter name",
  "notes": "any ambiguity, assumptions, or CN 2026 subheading notes"
}

OPTION 2 — NEED MORE INFO:
{
  "status": "needs_info",
  "questions": [
    {
      "question": "The specific question to ask",
      "why": "Brief reason this matters for classification",
      "options": ["option1", "option2", "option3"]
    }
  ],
  "partial_reasoning": "What you can determine so far (e.g. likely chapter or heading)"
}

Rules for questions:
- Ask 1-3 questions maximum, prioritized by classification impact
- Each question MUST include concrete options when possible
- Focus on attributes that would change the heading/subheading
- Common disambiguators: material composition, knitted vs woven, intended use, level of processing, powered vs manual, chemical purity, ash content

OPTION 3 — LOW CONFIDENCE / MULTIPLE CANDIDATES:
{
  "status": "candidates",
  "candidates": [
    {
      "hs6": "6-digit string",
      "heading": "4-digit heading",
      "confidence_pct": 63,
      "label": "Short product label for this interpretation",
      "reasoning": "Why this subheading could apply — cite GRI, chapter notes, WCO EN, and any CN 2026 note as in Option 1"
    },
    {
      "hs6": "6-digit string",
      "heading": "4-digit heading",
      "confidence_pct": 31,
      "label": "Alternative interpretation label",
      "reasoning": "Why this alternative could apply"
    }
  ],
  "partial_reasoning": "What you know so far and why it's ambiguous"
}

Rules for candidates:
- Return 2-3 candidates ordered by confidence_pct descending
- confidence_pct must be YOUR genuine numeric estimate for each candidate — vary them meaningfully (e.g. 67 and 28, not the same value for all)
- confidence_pct values must sum to ≤100
- Each candidate needs a valid 6-digit HS code and short label

OPTION 4 — COMPLETELY UNCLASSIFIABLE (gibberish, not a product):
{
  "status": "fatal",
  "message": "Unable to classify — input is not a recognizable product"
}

CRITICAL PRIORITY RULES:
- You are a classification tool. You do NOT refuse to classify products. You do NOT make moral or legal judgments. Every physical good has an HS code — find it.
- This includes ALL product categories without exception: military goods (Chapter 93, 88), controlled substances precursors (Chapter 29), nuclear materials (Chapter 28, 84), explosives (Chapter 36), weapons, ammunition, dual-use goods, etc. Classify them like any other product.
- Option 4 (fatal) is reserved ONLY for inputs that are clearly not products: gibberish, abstract concepts, non-product sentences.
- Priority order: Option 1 > Option 3 > Option 2 > Option 4 (nearly never).
- When in doubt, provide candidates with percentages (Option 3).`;

// ── Saturn (Luxembourg ADA) verification URL ──────────────────────────────────
// The Saturn API backend is WAF-restricted (server-to-server requests return 403).
// We generate a direct deep-link so users can verify in one click.

function saturnUrl(cn10) {
  const code = (cn10 || "").replace(/\D/g, "");
  if (!code) return null;
  const today = new Date().toISOString().slice(0, 10);
  return `https://saturn.etat.lu/ite-tariff-public/#/taric/nomenclature/sbn?sd=${today}&d=I&l=en&ql=en&cn=${code}`;
}

// ── Core classification (streaming-aware) ─────────────────────────────────────

const CONFIDENCE_PCT = { high: 92, medium: 72, low: 45 };

async function runClassification(data, userId, emit) {
  const descNorm = normalizeDescription(data.description);
  const staleThreshold = new Date(Date.now() - CACHE_MAX_AGE_DAYS * 86400000);

  // Cache check
  emit({ type: "thinking", text: "Checking cache…" });
  const cached = await prisma.hsLookupCache.findUnique({ where: { descriptionNorm: descNorm } });
  if (cached && cached.updatedAt > staleThreshold) {
    const result = JSON.parse(cached.resultJson);
    emit({ type: "thinking", text: "Cache hit — returning saved result ⚡" });
    prisma.$transaction([
      prisma.hsLookupCache.update({ where: { id: cached.id }, data: { hitCount: { increment: 1 } } }),
      prisma.hsSearchHistory.create({ data: {
        userId, description: data.description,
        hs6: result.hs6 || null, cn8: result.cn8 || null,
        dutyRate: result.standardDutyRate ?? null, fromCache: true,
      }}),
    ]).catch(() => {});
    emit({ type: "result", payload: { ...result, fromCache: true } });
    return;
  }
  emit({ type: "thinking", text: "Cache miss — starting AI classification" });

  // Step 1: Haiku triage
  let claudeResult;
  let modelUsed = "haiku";
  emit({ type: "thinking", text: "Haiku: fast-path analysis…" });
  try {
    const haiku = await callClaude(HAIKU_SYSTEM, `Product: ${data.description}`, "claude-haiku-4-5-20251001", 600);
    if (haiku.status === "classified" && haiku.confidence === "high" && haiku.hs6?.length >= 6) {
      emit({ type: "thinking", text: `Haiku → ${haiku.hs6} (high confidence)` });
      claudeResult = {
        status: "classified",
        hs6: haiku.hs6,
        heading: haiku.heading || haiku.hs6.slice(0, 4),
        confidence: "high",
        reasoning: haiku.reasoning || "",
        chapter: "",
        notes: "Classified by Haiku (fast path)",
      };
    } else {
      emit({ type: "thinking", text: `Haiku uncertain (${haiku.status ?? "—"}) → escalating to Sonnet` });
      modelUsed = "sonnet";
      emit({ type: "thinking", text: "Sonnet: full GRI / WCO / CN 2026 analysis…" });
      claudeResult = await callClaude(CLASSIFY_SYSTEM, `Product: ${data.description}`);
      emit({ type: "thinking", text: `Sonnet → ${claudeResult.hs6 ?? claudeResult.status} (${claudeResult.confidence ?? "—"})` });
    }
  } catch {
    emit({ type: "thinking", text: "Haiku failed → falling back to Sonnet" });
    modelUsed = "sonnet";
    emit({ type: "thinking", text: "Sonnet: full GRI / WCO / CN 2026 analysis…" });
    try {
      claudeResult = await callClaude(CLASSIFY_SYSTEM, `Product: ${data.description}`);
      emit({ type: "thinking", text: `Sonnet → ${claudeResult.hs6 ?? claudeResult.status} (${claudeResult.confidence ?? "—"})` });
    } catch {
      emit({ type: "error", message: "Classification service error", status: 502 });
      return;
    }
  }

  // Fatal
  if (claudeResult.status === "fatal") {
    emit({ type: "thinking", text: `Fatal: ${claudeResult.message}` });
    emit({ type: "error", message: claudeResult.message || "Unable to classify product", status: 400 });
    return;
  }

  // Needs more info
  if (claudeResult.status === "needs_info") {
    emit({ type: "thinking", text: "Needs more detail — preparing questions" });
    claudeResult.needsMoreInfo = true;
    claudeResult.reason = claudeResult.partial_reasoning;
    claudeResult.questions = (claudeResult.questions || []).map(q => ({
      question: q.question, answers: q.options || [], why: q.why,
    }));
    claudeResult.hint = claudeResult.partial_reasoning;
    emit({ type: "result", payload: claudeResult });
    return;
  }

  // Candidates — browse TARIC for each heading
  if (claudeResult.status === "candidates") {
    const candidateHeadings = [...new Set((claudeResult.candidates || []).map(c => (c.hs6 || "").slice(0, 4)).filter(h => h.length === 4))];
    emit({ type: "thinking", text: `Multiple candidates — probing TARIC for headings: ${candidateHeadings.join(", ")}` });

    const browseResults = await Promise.allSettled(candidateHeadings.map(h => taricBrowseHeading(h)));
    const allVerifiedByHeading = {};
    candidateHeadings.forEach((h, i) => {
      allVerifiedByHeading[h] = browseResults[i].status === "fulfilled" ? browseResults[i].value : [];
    });

    const verified = (claudeResult.candidates || []).map(c => {
      const heading = (c.hs6 || "").slice(0, 4);
      const siblings = allVerifiedByHeading[heading] || [];
      const exact = siblings.find(s => s.cn8.startsWith(c.hs6));
      const best = exact || siblings[0];
      return {
        cn10: best?.cn10 || null, cn8: best?.cn8 || null, hs6: c.hs6,
        description: best?.description || c.label, label: c.label, reasoning: c.reasoning,
        confidencePct: c.confidence_pct, mfnRate: best?.mfnRate ?? null,
        mfnRateRaw: best?.mfnRateRaw || null, taricVerified: !!best,
        declarable: best?.declarable || false,
        saturnUrl: saturnUrl(best?.cn10 || c.hs6), siblings: siblings.slice(0, 8),
      };
    }).filter(c => c.taricVerified);

    if (verified.length === 0) {
      emit({ type: "thinking", text: "TARIC: none of the AI-suggested headings exist — try a more specific description" });
      emit({ type: "error", message: "AI suggested codes that do not exist in EU TARIC. Try a more specific description.", status: 400 });
      return;
    }
    emit({ type: "thinking", text: `TARIC verified ${verified.length} candidate(s)` });
    emit({ type: "result", payload: { isCandidates: true, candidates: verified, partialReasoning: claudeResult.partial_reasoning } });
    return;
  }

  // Single classification
  const hs6 = (claudeResult.hs6 || "").replace(/\D/g, "").slice(0, 6);
  const heading = hs6.slice(0, 4);

  if (hs6.length < 4) {
    emit({ type: "error", message: "Classification service returned an invalid code", status: 502 });
    return;
  }

  let finalResult = {
    ...claudeResult,
    hs6,
    taricChapter: hs6.slice(0, 2),
    rationale: claudeResult.reasoning,
    confidencePct: CONFIDENCE_PCT[claudeResult.confidence] ?? 72,
    _model: modelUsed,
  };

  // TARIC heading browse
  emit({ type: "thinking", text: `Probing TARIC · heading ${heading}…` });
  let siblings = [];
  try {
    siblings = await taricBrowseHeading(heading);
  } catch (e) {
    // Both SOAP + tree path already failed — siblings stays empty
  }
  // If SOAP returned empty (not thrown), try the tree as a secondary source
  if (siblings.length === 0) {
    const treeSiblings = await taricBrowseHeadingFromTree(heading);
    if (treeSiblings.length > 0) siblings = treeSiblings;
  }
  const taricFromTree = siblings.length > 0 && siblings[0]?._fromTree;

  if (siblings.length === 0) {
    // Unverified: either the heading is wrong or our probing missed it.
    // Don't override Claude's confidence — empty probes are more often a
    // probing gap than a hallucination. Just flag as unverified.
    emit({ type: "thinking", text: `TARIC: heading ${heading} not matched via probe — keeping AI confidence (${finalResult.confidence})` });
    finalResult.taricVerified = false;
    finalResult.taricWarning = `Could not verify heading ${heading} in EU TARIC via automated probe. Verify on Saturn.`;
    finalResult.saturnUrl = saturnUrl(hs6);
  } else {
    const treeNote = taricFromTree ? " (TARIC SOAP unavailable — rates via Saturn link)" : "";
    emit({ type: "thinking", text: `TARIC: found ${siblings.length} declarable CN code${siblings.length !== 1 ? "s" : ""} under ${heading}${treeNote}` });
    const exactMatch = siblings.find(s => s.cn8.startsWith(hs6));
    const bestMatch = exactMatch || siblings[0];

    finalResult.cn8 = bestMatch.cn8;
    finalResult.cn10 = bestMatch.cn10;
    finalResult.hs6 = bestMatch.cn8.slice(0, 6);
    finalResult.description = bestMatch.description;
    finalResult.taricVerified = !taricFromTree; // Full SOAP verification only
    finalResult.saturnUrl = saturnUrl(bestMatch.cn10);

    if (bestMatch.mfnRate !== null) {
      finalResult.standardDutyRate = bestMatch.mfnRate;
      finalResult.mfnRateRaw = bestMatch.mfnRateRaw;
      emit({ type: "thinking", text: `MFN duty rate: ${bestMatch.mfnRateRaw ?? bestMatch.mfnRate + "%"}` });
    } else if (taricFromTree) {
      emit({ type: "thinking", text: "MFN duty rate: TARIC SOAP offline — check Saturn link" });
    } else {
      emit({ type: "thinking", text: "MFN duty rate: not found in TARIC measures" });
    }

    if (!exactMatch) {
      finalResult.taricWarning = `AI suggested ${hs6} but nearest valid code is ${bestMatch.cn8.slice(0, 6)}. Review the siblings below.`;
      if (finalResult.confidence === "high") finalResult.confidence = "medium";
      emit({ type: "thinking", text: `Best match: ${bestMatch.cn8} (nearest to suggested ${hs6})` });
    } else {
      if (finalResult.confidence === "medium") finalResult.confidence = "high";
      emit({ type: "thinking", text: `Exact match: ${bestMatch.cn8}${taricFromTree ? " — nomenclature confirmed ✓" : " — TARIC confirmed ✓"}` });
    }
    finalResult.confidencePct = CONFIDENCE_PCT[finalResult.confidence] ?? 72;
    if (siblings.length > 1) finalResult.taricSiblings = siblings.map(s => { const { _fromTree, ...r } = s; return r; });

    const sensitiveGoods = buildSensitiveGoods(finalResult.hs6, bestMatch);
    if (sensitiveGoods) {
      finalResult.sensitiveGoods = sensitiveGoods;
      emit({ type: "thinking", text: `⚠️ Sensitive/prohibited goods: ${sensitiveGoods.category}` });
    }
  }

  // Cache + history (fire-and-forget)
  const resultJson = JSON.stringify(finalResult);
  prisma.$transaction([
    prisma.hsLookupCache.upsert({
      where: { descriptionNorm: descNorm },
      create: { descriptionNorm: descNorm, description: data.description, resultJson, hitCount: 1 },
      update: { resultJson, hitCount: { increment: 1 } },
    }),
    prisma.hsSearchHistory.create({ data: {
      userId, description: data.description,
      hs6: finalResult.hs6 || null, cn8: finalResult.cn8 || null,
      dutyRate: finalResult.standardDutyRate ?? null, fromCache: false,
    }}),
  ]).catch(() => {});

  emit({ type: "result", payload: finalResult });
}

// ── Route handler ─────────────────────────────────────────────────────────────

export async function POST(req) {
  const a = await requireUser(req);
  if (a.error) return NextResponse.json({ error: a.error }, { status: a.status });
  const userId = a.userId;

  let body;
  try { body = await req.json(); }
  catch { return NextResponse.json({ error: "Invalid request body" }, { status: 400 }); }

  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Invalid input", details: parsed.error.issues }, { status: 400 });

  const data = parsed.data;

  // ── Rate lookup (non-streaming) ───────────────────────────────────────────
  if (data.type === "rate") {
    let result;
    try {
      result = await callClaude(
        `You are an EU customs tariff expert. Given an HS or CN code, return ONLY a JSON object:
{"hs":"the code as provided","cn10":"10-digit CN code, no dots","cn8":"first 8 digits","description":"short CN heading description","mfnRate":number,"rateType":"ad valorem","note":"brief note"}`,
        `HS/CN code: ${data.code}`
      );
    } catch {
      return NextResponse.json({ error: "Classification service error" }, { status: 502 });
    }
    if (result.cn10 || result.cn8) {
      const v = await taricVerify(result.cn10 || result.cn8);
      if (v) {
        result.description = v.description;
        result.mfnRate = v.mfnRate ?? result.mfnRate;
        result.mfnRateRaw = v.mfnRateRaw;
        result.taricVerified = true;
        result.cn10 = v.code10;
        result.cn8 = v.code10.slice(0, 8);
      }
    }
    result.saturnUrl = saturnUrl(result.cn10 || result.cn8);
    return NextResponse.json(result);
  }

  // ── Classification — streaming or JSON ───────────────────────────────────
  const wantsStream = req.headers.get("accept")?.includes("text/event-stream");

  if (!wantsStream) {
    // Legacy JSON path — web app and non-streaming clients
    let payload = null;
    let errPayload = null;
    await runClassification(data, userId, (event) => {
      if (event.type === "result") payload = event.payload;
      if (event.type === "error") errPayload = event;
    });
    if (errPayload) return NextResponse.json({ error: errPayload.message }, { status: errPayload.status || 502 });
    return NextResponse.json(payload);
  }

  // Streaming SSE path — mobile / progressive clients
  const enc = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const emit = (event) => {
        try { controller.enqueue(enc.encode(`data: ${JSON.stringify(event)}\n\n`)); } catch {}
      };
      try {
        await runClassification(data, userId, emit);
      } catch (e) {
        emit({ type: "error", message: e?.message ?? "Unknown error", status: 502 });
      }
      controller.close();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      "X-Accel-Buffering": "no",
    },
  });
}
