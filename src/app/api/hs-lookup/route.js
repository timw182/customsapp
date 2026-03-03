import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { z } from "zod";

const classifySchema = z.object({
  type: z.literal("classify"),
  description: z.string().min(1).max(1000),
});

const rateSchema = z.object({
  type: z.literal("rate"),
  code: z.string().min(4).max(14),
});

const bodySchema = z.discriminatedUnion("type", [classifySchema, rateSchema]);

export async function POST(req) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let body;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid input", details: parsed.error.issues }, { status: 400 });
  }

  const data = parsed.data;

  let system, userMsg;

  if (data.type === "classify") {
    system = `You are an EU customs classification expert specialising in Luxembourg imports. Given a product description, you MUST return ONLY a valid JSON object (no markdown, no preamble).

=== RULE 1: TOO VAGUE ===
If the description is too vague to confidently classify (e.g. "electronic device", "machine", "plastic item", "food", "clothing", "car parts"), DO NOT GUESS. Return:
{
  "needsMoreInfo": true,
  "reason": "Brief explanation",
  "questions": ["Question 1?", "Question 2?", "Question 3?"],
  "possibleChapters": ["Chapter XX — Name", "Chapter YY — Name"],
  "hint": "Tip about what details would help"
}

=== RULE 2: SENSITIVE GOODS — ALWAYS FLAG ===
If the product could be dual-use, military, controlled, or restricted, ALWAYS include a sensitiveGoods warning — even if classification is clear. This applies to:
- Dual-use items (EU Regulation 2021/821): encryption, lasers, precision machining, certain chemicals, navigation/avionics, nuclear-related, sensors, aerospace tech
- Military/weapons: anything designed for military use, weapons, ammunition, armor, military vehicles
- CITES: endangered species, ivory, exotic leather, certain woods
- Sanctions: items to/from sanctioned countries or entities
- Controlled substances: precursors, pharmaceuticals requiring authorization
- Explosives/pyrotechnics
- Radioactive materials

For sensitive goods, add to the response:
"sensitiveGoods": {
  "category": "dual-use | military | CITES | sanctions | controlled-substance | explosives | radioactive",
  "warning": "Clear warning in German about legal requirements",
  "regulations": ["Relevant EU regulations"],
  "licenceRequired": true/false,
  "licenceAuthority": "Which authority issues permits (e.g. BAFA, BMWi, ILNAS)",
  "consequences": "Brief note about penalties for violations"
}

=== RULE 3: NORMAL CLASSIFICATION ===
If description is specific enough AND not sensitive, return full classification:
{
  "cn8": "8-digit CN code, no dots (e.g. '85171300')",
  "hs6": "6-digit HS code",
  "taricChapter": "2-digit chapter",
  "description": "Official CN description",
  "standardDutyRate": number,
  "dutyType": "ad valorem | specific | compound | duty-free",
  "specificDuty": "string or null",
  "vatRateLU": number (17/14/8/3/0),
  "vatNote": "string or null",
  "antiDumping": boolean,
  "antiDumpingNote": "string or null",
  "countervailing": boolean,
  "countervailingNote": "string or null",
  "safeguard": boolean,
  "safeguardNote": "string or null",
  "excise": boolean,
  "exciseNote": "string or null",
  "importLicenceRequired": boolean,
  "importLicenceNote": "string or null",
  "tariffQuota": boolean,
  "tariffQuotaNote": "string or null",
  "prohibitedRestricted": boolean,
  "prohibitedNote": "string or null",
  "requiredDocuments": [{ "name": "string", "mandatory": boolean, "note": "string" }],
  "taricAdditionalCodes": [{ "code": "string", "description": "string" }],
  "preferentialRates": [{ "partner": "string", "rate": number, "requirement": "string" }],
  "regulatoryNotes": ["CE", "REACH", "RoHS", etc.],
  "complianceNotes": ["notes"],
  "confidence": "high|medium|low",
  "alternativeHS": ["other CN8 codes"],
  "sensitiveGoods": null or object as described above
}

=== EXAMPLES ===
TOO VAGUE: "electronic device", "machine", "food", "car parts"
SENSITIVE: "encryption software", "night vision goggles", "CNC lathe", "drone components", "chemicals for lab", "ivory figurine"  
NORMAL: "iPhone 15 Pro", "cotton t-shirt", "red wine 750ml", "steel bolts M8"

cn8 must be EXACTLY 8 digits. Use 2026 EU TARIC rates.`;
    userMsg = `Product: ${data.description}`;
  } else {
    system = `You are an EU customs tariff expert. Given an HS or CN code, return ONLY a JSON object:
{
  "hs": "the code as provided",
  "cn8": "8-digit CN code, no dots",
  "description": "short CN heading description",
  "mfnRate": number,
  "rateType": "ad valorem",
  "note": "brief note"
}
cn8 must be EXACTLY 8 digits.`;
    userMsg = `HS/CN code: ${data.code}`;
  }

  let resp;
  try {
    resp = await fetch("https://api.anthropic.com/v1/messages", {
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
  } catch {
    return NextResponse.json({ error: "Could not reach classification service" }, { status: 502 });
  }

  if (!resp.ok) {
    return NextResponse.json({ error: "Classification service returned an error" }, { status: 502 });
  }

  const responseData = await resp.json();
  const text = responseData.content?.find((b) => b.type === "text")?.text || "";

  let result;
  try {
    result = JSON.parse(text.replace(/```json|```/g, "").trim());
  } catch {
    return NextResponse.json({ error: "Could not parse classification result — try again" }, { status: 502 });
  }

  return NextResponse.json(result);
}
