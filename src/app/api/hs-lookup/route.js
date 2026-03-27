import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
export const maxDuration = 60;

// Cache entries older than 180 days are considered stale (CN codes update annually)
const CACHE_MAX_AGE_DAYS = 180;

function normalizeDescription(s) {
  return s.toLowerCase().trim().replace(/\s+/g, " ");
}

const TARIC_SOAP_URL = "https://ec.europa.eu/taxation_customs/dds2/taric/services/goods";

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

// ── TARIC subheading browser ──────────────────────────────────────────────────

/**
 * Probe TARIC SOAP for valid declarable CN10 codes under a 4-digit heading.
 * Three-level probing:
 *   1. HS6 subheadings (heading + 10..90)
 *   2. CN8 extensions under each valid HS6 (hs6 + 00..90) → padded to CN10 with "00"
 *   3. For non-declarable CN8s, probe CN10 subdivisions (cn8 + 10..90)
 * Returns only TARIC-confirmed declarable codes with descriptions and MFN duty rates.
 */
async function taricBrowseHeading(heading, extraCodes = []) {
  const h = heading.replace(/\D/g, "").slice(0, 4);
  if (h.length !== 4) return [];

  // Helper: call taricVerify with an exact 10-digit code (no auto-padding)
  async function verifyExact(cn10) {
    const code = cn10.replace(/\D/g, "").padEnd(10, "0").slice(0, 10);
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
      if (declarable) {
        const measResp = await fetch(TARIC_SOAP_URL, {
          method: "POST",
          headers: { "Content-Type": "text/xml; charset=UTF-8", SOAPAction: '""' },
          body: makeSoap("goodsMeasForWs", { goodsCode: code, countryCode: "US", tradeMovement: "I" }),
          signal: AbortSignal.timeout(8000),
        });
        const measXml = await measResp.text();
        const blocks = xmlBlocks(measXml, "measure");
        const now = new Date();
        for (const m of blocks) {
          const mtBlock = m.match(/<measure_type>([\s\S]*?)<\/measure_type>/)?.[1] || "";
          const mt = xmlText(mtBlock, "measure_type");
          const validTo = xmlText(m, "validity_end_date");
          const expired = validTo ? new Date(validTo) < now : false;
          if (!expired && MFN_TYPES.has(mt)) {
            mfnRateRaw = xmlText(m, "duty_rate")?.trim() || null;
            mfnRate = parseDutyRate(mfnRateRaw)?.adValorem ?? null;
            break;
          }
        }
      }
      return { code10: code, description, declarable, mfnRate, mfnRateRaw };
    } catch { return null; }
  }

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
  // Also probe any extra codes the AI suggested
  for (const code of extraCodes) {
    const clean = code.replace(/\D/g, "").padEnd(10, "0").slice(0, 10);
    if (!cn8Probes.includes(clean)) cn8Probes.push(clean);
  }

  // Run CN8 probes in parallel batches
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

  // Combine all results, keep only declarable, deduplicate
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
    }));
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
  if (!resp.ok) {
    const errText = await resp.text().catch(() => "");
    console.error("[hs-lookup] Claude API error:", resp.status, errText.slice(0, 300));
    throw new Error(`Claude API ${resp.status}`);
  }
  const data = await resp.json();
  const text = data.content?.find(b => b.type === "text")?.text || "";
  try {
    return JSON.parse(text.replace(/```json|```/g, "").trim());
  } catch (e) {
    console.error("[hs-lookup] JSON parse error. Raw text:", text.slice(0, 500));
    throw e;
  }
}

const CLASSIFY_SYSTEM = `You are a customs classification expert specializing in EU Combined Nomenclature (CN) and TARIC.

Your task: classify products into the correct HS HEADING (4-digit) and SUBHEADING (6-digit) based on a description.

CRITICAL: You must ONLY return 6-digit HS codes (subheading level). The 7th–10th digits (CN8/TARIC) will be resolved automatically from the official EU TARIC database. Do NOT guess CN8 or CN10 codes — they change annually and your training data may be outdated.

IMPORTANT: Use the CURRENT HS 2022 nomenclature. Many headings were restructured in HS 2017 and HS 2022. For example:
- 8803 (aircraft parts) was ABOLISHED in HS 2017 → now 8807
- 8806 (unmanned aircraft) was ADDED in HS 2017
- Chapter 28/29 had battery-compound changes in CN 2026
If in doubt, verify the heading still exists in HS 2022 before returning it.

PROCESS:
1. Extract key classification attributes: material, function/use, product category, level of processing
2. Map attributes to HS classification logic (chapters, headings, subheadings)
3. Return the most specific 6-digit subheading

RESPONSE FORMAT — pick exactly ONE of the four options below. Output raw JSON only, no markdown, no code fences.

OPTION 1 — HIGH/MEDIUM CONFIDENCE (you can determine a single subheading):
{
  "status": "classified",
  "hs6": "6-digit string (e.g. 880730)",
  "heading": "4-digit heading (e.g. 8807)",
  "confidence": "high | medium",
  "reasoning": "concise explanation of classification logic",
  "chapter": "HS chapter name",
  "notes": "any ambiguity or assumptions"
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
- Common disambiguators: material composition, knitted vs woven, intended use, level of processing, powered vs manual

OPTION 3 — LOW CONFIDENCE / MULTIPLE CANDIDATES:
{
  "status": "candidates",
  "candidates": [
    {
      "hs6": "6-digit string",
      "heading": "4-digit heading",
      "confidence_pct": 45,
      "label": "Short product label for this interpretation",
      "reasoning": "Why this subheading could apply"
    }
  ],
  "partial_reasoning": "What you know so far and why it's ambiguous"
}

Rules for candidates:
- Return 2-3 candidates, ordered by confidence_pct descending
- confidence_pct values must sum to 100 or less
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
    result.saturnUrl = saturnUrl(result.cn10 || result.cn8);
    return NextResponse.json(result);
  }

  // ── Classification ────────────────────────────────────────────────────────

  // Cache check — avoid burning API tokens for repeated lookups
  const descNorm = normalizeDescription(data.description);
  const staleThreshold = new Date(Date.now() - CACHE_MAX_AGE_DAYS * 86400000);
  const cached = await prisma.hsLookupCache.findUnique({ where: { descriptionNorm: descNorm } });
  if (cached && cached.updatedAt > staleThreshold) {
    const result = JSON.parse(cached.resultJson);
    // Record in user history and bump hit counter (fire-and-forget)
    prisma.$transaction([
      prisma.hsLookupCache.update({ where: { id: cached.id }, data: { hitCount: { increment: 1 } } }),
      prisma.hsSearchHistory.create({ data: {
        userId: session.user.id,
        description: data.description,
        hs6: result.hs6 || null,
        cn8: result.cn8 || null,
        dutyRate: result.standardDutyRate ?? null,
        fromCache: true,
      }}),
    ]).catch(() => {});
    return NextResponse.json({ ...result, fromCache: true });
  }

  // Step 1: Claude AI classification (HS6 only)
  let claudeResult;
  try {
    claudeResult = await callClaude(CLASSIFY_SYSTEM, `Product: ${data.description}`);
  } catch {
    return NextResponse.json({ error: "Classification service error" }, { status: 502 });
  }

  // Handle fatal / needs_info early
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
    return NextResponse.json(claudeResult);
  }

  // Step 2: For candidates, browse TARIC for each heading to find real codes
  if (claudeResult.status === "candidates") {
    const candidateHeadings = [...new Set((claudeResult.candidates || []).map(c => (c.hs6 || "").slice(0, 4)).filter(h => h.length === 4))];

    // Browse TARIC for all candidate headings in parallel
    const browseResults = await Promise.all(
      candidateHeadings.map(h => taricBrowseHeading(h))
    );
    const allVerifiedByHeading = {};
    candidateHeadings.forEach((h, i) => { allVerifiedByHeading[h] = browseResults[i]; });

    const verified = (claudeResult.candidates || []).map(c => {
      const heading = (c.hs6 || "").slice(0, 4);
      const siblings = allVerifiedByHeading[heading] || [];
      // Find exact match or closest sibling
      const exact = siblings.find(s => s.cn8.startsWith(c.hs6));
      const best = exact || siblings[0];
      return {
        cn10: best?.cn10 || null,
        cn8: best?.cn8 || null,
        hs6: c.hs6,
        description: best?.description || c.label,
        label: c.label,
        reasoning: c.reasoning,
        confidencePct: c.confidence_pct,
        mfnRate: best?.mfnRate ?? null,
        mfnRateRaw: best?.mfnRateRaw || null,
        taricVerified: !!best,
        declarable: best?.declarable || false,
        saturnUrl: saturnUrl(best?.cn10 || c.hs6),
        siblings: siblings.slice(0, 8),
      };
    }).filter(c => c.taricVerified);

    if (verified.length === 0) {
      return NextResponse.json({
        error: "AI suggested codes that do not exist in EU TARIC. Try a more specific description.",
        aiSuggestions: claudeResult.candidates?.map(c => c.hs6),
      }, { status: 400 });
    }

    return NextResponse.json({
      isCandidates: true,
      candidates: verified,
      partialReasoning: claudeResult.partial_reasoning,
    });
  }

  // Step 3: Single classification — extract HS6 from Claude
  const hs6 = (claudeResult.hs6 || "").replace(/\D/g, "").slice(0, 6);
  const heading = hs6.slice(0, 4);

  if (hs6.length < 4) {
    return NextResponse.json({ error: "Classification service returned an invalid code" }, { status: 502 });
  }

  let finalResult = {
    ...claudeResult,
    hs6,
    taricChapter: hs6.slice(0, 2),
    rationale: claudeResult.reasoning,
  };

  // Step 4: Browse TARIC for valid declarable codes under this heading
  const siblings = await taricBrowseHeading(heading);

  if (siblings.length === 0) {
    // Heading doesn't exist in TARIC — Claude hallucinated it
    finalResult.taricVerified = false;
    finalResult.taricWarning = `Heading ${heading} does not exist in EU TARIC. This code may be outdated or incorrect. Verify manually.`;
    finalResult.confidence = "low";
    finalResult.saturnUrl = saturnUrl(hs6);
  } else {
    // Find the best match: exact HS6 match first, then closest sibling
    const exactMatch = siblings.find(s => s.cn8.startsWith(hs6));
    const bestMatch = exactMatch || siblings[0];

    finalResult.cn8 = bestMatch.cn8;
    finalResult.cn10 = bestMatch.cn10;
    finalResult.hs6 = bestMatch.cn8.slice(0, 6);
    finalResult.description = bestMatch.description;
    finalResult.taricVerified = true;
    finalResult.saturnUrl = saturnUrl(bestMatch.cn10);

    if (bestMatch.mfnRate !== null) {
      finalResult.standardDutyRate = bestMatch.mfnRate;
      finalResult.mfnRateRaw = bestMatch.mfnRateRaw;
    }

    // If Claude's HS6 didn't match any sibling, flag it
    if (!exactMatch) {
      finalResult.taricWarning = `AI suggested ${hs6} but nearest valid code is ${bestMatch.cn8.slice(0, 6)}. Review the siblings below.`;
      if (finalResult.confidence === "high") finalResult.confidence = "medium";
    } else {
      // Boost confidence when TARIC confirms the code
      if (finalResult.confidence === "medium") finalResult.confidence = "high";
    }

    // Include all siblings with duty rates
    if (siblings.length > 1) {
      finalResult.taricSiblings = siblings;
    }
  }

  // Save to global cache + user history (fire-and-forget, don't block response)
  const resultJson = JSON.stringify(finalResult);
  prisma.$transaction([
    prisma.hsLookupCache.upsert({
      where: { descriptionNorm: descNorm },
      create: { descriptionNorm: descNorm, description: data.description, resultJson, hitCount: 1 },
      update: { resultJson, hitCount: { increment: 1 } },
    }),
    prisma.hsSearchHistory.create({ data: {
      userId: session.user.id,
      description: data.description,
      hs6: finalResult.hs6 || null,
      cn8: finalResult.cn8 || null,
      dutyRate: finalResult.standardDutyRate ?? null,
      fromCache: false,
    }}),
  ]).catch(() => {});

  return NextResponse.json(finalResult);
}
