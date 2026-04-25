// Resolves the destination-country VAT rate (and any reduced-rate
// candidate) for an HS code. Backed by the static EU TEDB snapshot in
// src/lib/eu-vat-rates.js — no network call, no LLM, no cost.
//
// Public route (no auth) since the data is reference material from the
// European Commission. Cached at the edge via Cache-Control.
//
// Example:
//   GET /api/vat-lookup?dest=BE&hs=0401
//   → { country: { code: "BE", name: "Belgium", … },
//       standard: 21, suggested: 21, reducedCandidate: 6,
//       alternatives: [21, 12, 6, 0],
//       hint: { category: "foodstuff", strength: "likely", … },
//       reasoning: "...", source: "..." }

import { resolveVat } from "@/lib/eu-vat-rates";

export async function GET(req) {
  const { searchParams } = new URL(req.url);
  const dest = (searchParams.get("dest") || "").trim();
  const hs = (searchParams.get("hs") || "").trim();

  if (!dest || dest.length !== 2) {
    return Response.json({ error: "dest must be a 2-letter EU ISO code" }, { status: 400 });
  }

  const result = resolveVat({ dest, hs });
  if (result.error) return Response.json(result, { status: 404 });

  return Response.json(result, {
    headers: { "Cache-Control": "public, max-age=86400, stale-while-revalidate=604800" },
  });
}
