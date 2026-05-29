import { NextResponse } from "next/server";
import { requireUser } from "@/lib/apiAuth";

const RATE_LABELS = {
  3:  "3% — Super-réduit",
  8:  "8% — Réduit",
  14: "14% — Intermédiaire",
  17: "17% — Taux normal",
};

const SYSTEM = `You are a Luxembourg customs VAT expert. Determine the correct Luxembourg import VAT rate for imported goods under Loi coordonnée sur la taxe sur la valeur ajoutée (Loi TVA 2026).

Luxembourg VAT rates applicable to imported goods:

3% (super-réduit):
- Foodstuffs and beverages for human consumption (HS chapters 01–21), water (HS 22.01, 22.02 non-alcoholic)
- Pharmaceutical products: medicines, drugs, vaccines, bandages (HS chapter 30, HS 3005, HS 3006)
- Books, newspapers, magazines, periodicals, e-books (HS chapter 49)
- Children's clothing and footwear sized for children under 14 years / shoe size ≤ 36 (HS chapters 61, 62, 64)
- Bicycles (HS 87.12)
- Hearing aids and orthopaedic appliances (HS 90.21)
- Baby products: prams, pushchairs (HS 87.15), diapers/nappies

14% (intermédiaire / parking rate):
- Still wine with actual alcoholic strength ≤ 13% vol (Loi TVA Annexe B, Art. 39 derogation)
- Does NOT apply to: sparkling wine, beer, spirits, wine >13% ABV — those are 17%

17% (taux normal):
- All other goods not covered above
- Electronics, computers, phones, appliances, cameras
- Adult clothing and footwear
- Tobacco products and e-cigarettes
- Alcoholic beverages (except still wine ≤13% ABV)
- Vehicles, machinery, tools, hardware
- Cosmetics, perfumes, personal care
- Furniture, home goods
- Jewellery, watches, luxury goods
- Sports equipment (except bicycles)
- Pet food and pet products
- Industrial goods, chemicals (non-pharmaceutical)

Note: The 8% reduced rate applies to specific services (hairdressing, housing renovation) and is almost never applicable to imported goods.

Return ONLY valid JSON with no markdown, no explanation outside the JSON:
{"rate":17,"category":"electronic device","reasoning":"Smartphones are standard-rated goods — no reduced-rate exemption applies under Luxembourg Loi TVA.","confidence":"high"}

confidence must be exactly one of: "high" (unambiguous legal basis), "medium" (likely but product details matter), "low" (genuinely ambiguous — user must verify).`;

export async function GET(req) {
  const a = await requireUser(req);
  if (a.error) return NextResponse.json({ error: a.error }, { status: a.status });

  const { searchParams } = new URL(req.url);
  const hs = (searchParams.get("hs") || "").replace(/\D/g, "").slice(0, 10);
  const description = (searchParams.get("description") || "").slice(0, 400).trim();

  if (!hs || !description) {
    return NextResponse.json({ error: "hs and description are required" }, { status: 400 });
  }

  try {
    const resp = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": process.env.ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 200,
        system: SYSTEM,
        messages: [{ role: "user", content: `HS code: ${hs}\nProduct: ${description}` }],
      }),
    });

    if (!resp.ok) {
      const err = await resp.text().catch(() => "");
      console.error("[vat-lookup-ai] Claude error:", resp.status, err.slice(0, 200));
      throw new Error(`Claude ${resp.status}`);
    }

    const data = await resp.json();
    const text = data.content?.find(b => b.type === "text")?.text || "";
    const parsed = JSON.parse(text.replace(/```json|```/g, "").trim());

    const rate = Number(parsed.rate);
    if (![3, 8, 14, 17].includes(rate)) throw new Error(`Unexpected rate: ${rate}`);

    return NextResponse.json({
      rate,
      rateLabel: RATE_LABELS[rate] ?? `${rate}%`,
      category: String(parsed.category || ""),
      reasoning: String(parsed.reasoning || ""),
      confidence: ["high", "medium", "low"].includes(parsed.confidence) ? parsed.confidence : "medium",
    });
  } catch (e) {
    console.error("[vat-lookup-ai] error:", e?.message);
    return NextResponse.json({ error: "AI VAT classification failed" }, { status: 502 });
  }
}
