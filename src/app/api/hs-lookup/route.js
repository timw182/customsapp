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
    system = `You are an EU customs classification expert. Given a product description, return ONLY a JSON object (no markdown, no preamble) with these fields:
{
  "hs6": "6-digit HS code (most likely)",
  "taricChapter": "2-digit chapter",
  "description": "Official HS heading description",
  "standardDutyRate": number,
  "antiDumping": boolean,
  "antiDumpingNote": "brief note if applicable, else null",
  "excise": boolean,
  "exciseNote": "brief note if excise duty applies, else null",
  "prohibitedRestricted": boolean,
  "complianceNotes": ["list of compliance requirements"],
  "confidence": "high|medium|low",
  "alternativeHS": ["other possible codes if ambiguous"]
}`;
    userMsg = `Product: ${data.description}`;
  } else {
    system = `You are an EU customs tariff expert. Given an HS code, return ONLY a JSON object with no markdown:
{
  "hs": "the code provided",
  "description": "short heading description",
  "mfnRate": number,
  "rateType": "ad valorem",
  "note": "brief note on rate type or caveats"
}`;
    userMsg = `HS code: ${data.code}`;
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
        max_tokens: 1000,
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
