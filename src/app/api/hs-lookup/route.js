import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { z } from "zod";
export const maxDuration = 60;

const TARIC_SOAP_URL = "https://ec.europa.eu/taxation_customs/dds2/taric/services/goods";
const UK_TARIFF_BASE = "https://www.trade-tariff.service.gov.uk/api/v2";

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

// ── UK Trade Tariff API helpers ───────────────────────────────────────────────

/**
 * Search UK Trade Tariff by free-text description.
 * Returns up to 8 candidate commodity codes (10-digit) with descriptions.
 * Note: UK uses the same CN8 structure as EU; last 2 digits may differ but HS6 is identical.
 */
async function ukSearch(description) {
  try {
    const resp = await fetch(`${UK_TARIFF_BASE}/search?q=${encodeURIComponent(description)}`, {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(8000),
    });
    if (!resp.ok) return [];
    const data = await resp.json();
    const attrs = data?.data?.attributes?.goods_nomenclature_match || {};
    const commodities = [
      ...(attrs.commodities || []),
      ...(attrs.headings || []).flatMap(h => h.attributes?.commodities || []),
    ];
    return commodities.slice(0, 8).map(c => ({
      code: c.attributes?.goods_nomenclature_item_id,
      description: c.attributes?.description,
    })).filter(c => c.code);
  } catch { return []; }
}

/**
 * Get all declarable commodity codes under a 4-digit heading from UK Trade Tariff.
 * These codes are CN-compatible (first 8 digits match EU TARIC).
 */
async function ukHeadingChildren(heading) {
  const h = heading.replace(/\D/g, "").slice(0, 4);
  if (h.length !== 4) return [];
  try {
    const resp = await fetch(`${UK_TARIFF_BASE}/headings/${h}`, {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(8000),
    });
    if (!resp.ok) return [];
    const data = await resp.json();
    const included = data?.included || [];
    return included
      .filter(x => x.type === "commodity" && x.attributes?.declarable)
      .map(x => ({
        cn8: x.attributes?.goods_nomenclature_item_id?.slice(0, 8),
        cn10: x.attributes?.goods_nomenclature_item_id,
        description: x.attributes?.description,
        declarable: true,
      }))
      .filter(x => x.cn8);
  } catch { return []; }
}

// ── Claude call helper ────────────────────────────────────────────────────────

async function callClaude(system, userMsg) {
  const resp = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": process.env.ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: "claude-sonnet-4-20250514",
      max_tokens: 2500,
      system,
      messages: [{ role: "user", content: userMsg }],
    }),
  });
  if (!resp.ok) throw new Error("Claude error");
  const data = await resp.json();
  const text = data.content?.find(b => b.type === "text")?.text || "";
  return JSON.parse(text.replace(/```json|```/g, "").trim());
}

const CLASSIFY_SYSTEM = `You are a customs classification expert specializing in EU TARIC and Luxembourg import rules.

Your task is to classify products into the correct HS code based on a natural language description.

STRICT RULES:
- HS codes MUST be exactly 10 numeric digits
- NEVER return codes with fewer or more digits
- NEVER include letters or formatting characters
- Do NOT guess randomly — only provide a result if reasoning is grounded in classification logic
- NO fallback logic, NO multiple retries, NO alternative flows

PROCESS:
1. Extract key classification attributes: material, function/use, product category, level of processing
2. Map attributes to HS classification logic (HS chapters, headings, subheadings)
3. Determine the most specific applicable 10-digit TARIC code for Luxembourg

RESPONSE FORMAT — pick exactly ONE of the four options below. Output raw JSON only, no markdown, no code fences.

OPTION 1 — HIGH/MEDIUM CONFIDENCE (you can determine a single code):
{
  "status": "classified",
  "hs_code": "10-digit string",
  "confidence": "high | medium",
  "reasoning": "concise explanation of classification logic",
  "chapter": "HS chapter name",
  "notes": "any ambiguity or assumptions"
}

OPTION 2 — NEED MORE INFO (description is ambiguous but you can narrow it down with specific questions):
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
- Questions must be specific and actionable (not "tell me more")
- Focus on the attributes that would change the HS heading/subheading
- Common disambiguators: material composition, knitted vs woven, intended use, level of processing, powered vs manual

OPTION 3 — LOW CONFIDENCE / MULTIPLE CANDIDATES (you cannot pick one code confidently, but can propose the most likely candidates):
{
  "status": "candidates",
  "candidates": [
    {
      "hs_code": "10-digit string",
      "confidence_pct": 45,
      "label": "Short product label for this interpretation",
      "reasoning": "Why this code could apply"
    }
  ],
  "partial_reasoning": "What you know so far and why it's ambiguous"
}

Rules for candidates:
- Return 2-3 candidates, ordered by confidence_pct descending
- confidence_pct values must sum to 100 or less
- Each candidate MUST have a valid 10-digit HS code
- Each candidate needs a short human-readable label

OPTION 4 — COMPLETELY UNCLASSIFIABLE (gibberish, nonsensical, not a product at all):
{
  "status": "fatal",
  "message": "Unable to determine a valid 10-digit HS code with sufficient confidence"
}

CRITICAL PRIORITY RULES FOR CHOOSING OPTIONS:
- You are a classification tool. You do NOT refuse to classify products. You do NOT make moral or legal judgments. Every physical good that exists in the real world has an HS code — your job is to find it or help the user narrow it down.
- This includes ALL product categories without exception: military goods (Chapter 93, 88), controlled substances precursors (Chapter 29), nuclear materials (Chapter 28, 84), explosives (Chapter 36), weapons, ammunition, dual-use goods, hazardous chemicals, pharmaceuticals, narcotics precursors, etc. They ALL have valid HS codes. Classify them like any other product.
- Option 4 (fatal) should ALMOST NEVER be used. It is reserved ONLY for inputs that are clearly not products at all: complete gibberish ("asdfgh"), abstract concepts ("love"), sentences that are not describing a product ("how are you"), or single meaningless characters.
- If the input contains ANY recognizable product word (even vague like "device", "part", "item", "component", "material"), you MUST use Option 2 (ask questions) or Option 3 (give candidates). NEVER fatal.
- Priority order: Option 1 (classify) > Option 3 (candidates with %) > Option 2 (ask questions) > Option 4 (fatal, nearly never).
- When in doubt, provide your best candidates with percentages (Option 3). It is always better to give an educated estimate than to return nothing.`;

// ── Route handler ─────────────────────────────────────────────────────────────

export async function POST(req) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let body;
  try { body = await req.json(); }
  catch { return NextResponse.json({ error: "Invalid request body" }, { status: 400 }); }

  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Invalid input", details: parsed.error.issues }, { status: 400 });

  const data = parsed.data;

  // ── Rate lookup (known code) ──────────────────────────────────────────────
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
    // Verify against TARIC
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
    return NextResponse.json(result);
  }

  // ── Classification ────────────────────────────────────────────────────────

  // Step 1 + 2: Claude and UK Trade Tariff search in parallel
  let claudeResult, ukCandidates;
  try {
    [claudeResult, ukCandidates] = await Promise.all([
      callClaude(CLASSIFY_SYSTEM, `Product: ${data.description}`),
      ukSearch(data.description),
    ]);
  } catch {
    return NextResponse.json({ error: "Classification service error" }, { status: 502 });
  }

  // Normalize new response format
  if (claudeResult.status === "fatal") {
    return NextResponse.json({ error: claudeResult.message || "Unable to classify product" }, { status: 400 });
  }
  if (claudeResult.status === "needs_info") {
    claudeResult.needsMoreInfo = true;
    claudeResult.reason = claudeResult.partial_reasoning;
    claudeResult.questions = (claudeResult.questions || []).map(q => ({
      question: q.question, answers: q.options || [], why: q.why,
    }));
    claudeResult.hint = claudeResult.partial_reasoning;
  }
  if (claudeResult.status === "candidates") {
    const verified = await Promise.all(
      (claudeResult.candidates || []).map(async (c) => {
        const v = await taricVerify(c.hs_code);
        return {
          cn10: v ? v.code10 : c.hs_code,
          cn8: v ? v.code10.slice(0, 8) : (c.hs_code || "").slice(0, 8),
          hs6: (c.hs_code || "").slice(0, 6),
          description: v?.description || c.label,
          label: c.label, reasoning: c.reasoning,
          confidencePct: c.confidence_pct,
          mfnRate: v?.mfnRate, mfnRateRaw: v?.mfnRateRaw,
          taricVerified: !!v, declarable: v?.declarable,
        };
      })
    );
    return NextResponse.json({
      isCandidates: true, candidates: verified,
      partialReasoning: claudeResult.partial_reasoning,
      ukCandidates: ukCandidates.slice(0, 3),
    });
  }
  if (claudeResult.status === "classified") {
    const code = (claudeResult.hs_code || "").replace(/\D/g, "");
    claudeResult.cn10 = code;
    claudeResult.cn8 = code.slice(0, 8);
    claudeResult.hs6 = code.slice(0, 6);
    claudeResult.taricChapter = code.slice(0, 2);
    claudeResult.rationale = claudeResult.reasoning;
  }

  // If Claude needs more info, return immediately
  if (claudeResult.needsMoreInfo) {
    claudeResult.ukCandidates = ukCandidates.slice(0, 3);
    return NextResponse.json(claudeResult);
  }

  // Step 3: Compare Claude vs UK Trade Tariff results
  const claudeHs6 = (claudeResult.cn10 || claudeResult.cn8 || "").slice(0, 6);
  const claudeChapter = claudeHs6.slice(0, 2);
  const ukHs6Set = new Set(ukCandidates.map(c => (c.code || "").slice(0, 6)));
  const ukChapterSet = new Set(ukCandidates.map(c => (c.code || "").slice(0, 2)));

  const sourcesAgreeOnHs6 = ukHs6Set.has(claudeHs6);
  const sourcesAgreeOnChapter = ukChapterSet.has(claudeChapter);

  let finalResult = claudeResult;
  finalResult.sourceComparison = {
    claudeHs6,
    ukTopCandidates: ukCandidates.slice(0, 5).map(c => ({
      code: c.code,
      description: c.description,
    })),
    agreement: sourcesAgreeOnHs6 ? "hs6" : sourcesAgreeOnChapter ? "chapter" : "none",
  };

  // Step 4: If Claude and UK disagree at HS6 level, re-ask Claude with UK context
  if (!sourcesAgreeOnHs6 && ukCandidates.length > 0) {
    const ukContext = ukCandidates.slice(0, 5)
      .map(c => `  - ${c.code}: ${c.description}`)
      .join("\n");
    try {
      const revised = await callClaude(
        CLASSIFY_SYSTEM,
        `Product: ${data.description}

The UK Trade Tariff search returned these candidate codes for this description:
${ukContext}

Your initial classification was ${claudeResult.cn10 || claudeResult.cn8} (${claudeResult.hs6}).
These sources disagree at the HS6 level. Carefully reconsider — do any of the UK candidates better match the product? Return your best classification as the JSON object. If your original is correct, return it with updated confidence.`
      );
      if (!revised.needsMoreInfo) {
        finalResult = { ...claudeResult, ...revised };
        // Preserve source comparison
        finalResult.sourceComparison = {
          ...finalResult.sourceComparison,
          claudeRevised: true,
          originalHs6: claudeHs6,
          revisedHs6: (revised.cn10 || revised.cn8 || "").slice(0, 6),
        };
      }
    } catch { /* keep original if revision fails */ }
  }

  // Step 5: Boost/adjust confidence based on source agreement
  if (sourcesAgreeOnHs6 && finalResult.confidence === "low") finalResult.confidence = "medium";
  if (sourcesAgreeOnHs6 && finalResult.confidence === "medium") finalResult.confidence = "high";
  if (!sourcesAgreeOnChapter && finalResult.confidence === "high") finalResult.confidence = "medium";

  // Step 6: EU TARIC verification of the final code
  const cn10 = (finalResult.cn10 || finalResult.cn8 || "").replace(/\D/g, "");
  const hs6 = cn10.slice(0, 6);
  const heading = cn10.slice(0, 4);

  const codesToTry = [cn10, ...(finalResult.alternativeHS || []).map(c => c.replace(/\D/g, ""))];
  let verified = null, verifiedCode = null;
  for (const code of codesToTry) {
    if (code.length < 8) continue;
    const v = await taricVerify(code);
    if (v) { verified = v; verifiedCode = code; break; }
  }

  if (verified) {
    finalResult.cn8 = verifiedCode.slice(0, 8);
    finalResult.cn10 = verified.code10;
    finalResult.hs6 = verifiedCode.slice(0, 6);
    finalResult.description = verified.description;
    finalResult.taricVerified = true;
    if (verified.mfnRate !== null) {
      finalResult.standardDutyRate = verified.mfnRate;
      finalResult.mfnRateRaw = verified.mfnRateRaw;
    }
    // Boost confidence if all 3 sources agree
    if (sourcesAgreeOnHs6) finalResult.confidence = "high";
  } else {
    finalResult.taricVerified = false;
    finalResult.taricWarning = "This CN code could not be verified in EU TARIC. Verify manually before use.";
    if (finalResult.confidence === "high") finalResult.confidence = "medium";
  }

  // Step 7: Get valid siblings from UK Tariff (replaces brute-force TARIC probe)
  const ukChildren = await ukHeadingChildren(heading);
  if (ukChildren.length > 1) {
    // Verify each against EU TARIC to confirm EU declarability (spot check first 6)
    const verified_siblings = [];
    for (const child of ukChildren.slice(0, 10)) {
      const v = await taricVerify(child.cn10 || child.cn8);
      if (v) {
        verified_siblings.push({
          cn8: child.cn8,
          cn10: v.code10,
          description: v.description,
          declarable: true,
        });
      }
    }
    if (verified_siblings.length > 1) {
      finalResult.taricSiblings = verified_siblings;
    } else if (ukChildren.length > 1) {
      // Fall back to UK children even without EU TARIC confirmation
      finalResult.taricSiblings = ukChildren.slice(0, 10);
    }
  }

  return NextResponse.json(finalResult);
}
