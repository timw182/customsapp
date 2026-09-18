// What an import costs once customs is done with it, as a figure rather than a screen.
//
// The calculator page works this out in the browser; this is the same function (src/lib/landed-cost.mjs)
// behind an API, so another tool on this server — the ELP forwarding tool quoting an import — gets the
// answer the calculator would give instead of doing the arithmetic a second time.
//
// Authenticated like every other route here: a session (web) or a bearer token (phone app, ELP tool).

import { NextResponse } from "next/server";
import { z } from "zod";
import { requireUser } from "@/lib/apiAuth";
import { landedCost, getLuVAT, INCOTERMS_CIF, ORIGIN_AGREEMENTS } from "@/lib/landed-cost.mjs";

export const runtime = "nodejs";

const money = z.coerce.number().min(0).max(1e12);

const schema = z.object({
  value: money,
  currency: z.string().length(3).optional(),
  /* EUR per unit of the invoice currency; 1 for an invoice already in EUR. */
  exchangeRate: z.coerce.number().positive().max(1e6).default(1),
  freight: money.optional(),
  insurance: money.optional(),
  incoterm: z.enum(Object.keys(INCOTERMS_CIF)).default("EXW"),
  transportMode: z.enum(["air", "sea", "road", "rail", "post"]).optional(),
  origin: z.string().length(2).optional(),
  hsCode: z.string().max(14).optional(),
  dutyRatePct: z.coerce.number().min(0).max(1000).default(0),
  usingPreferentialRate: z.boolean().optional(),
  preferential: z.boolean().optional(),
  hasProofOfOrigin: z.boolean().optional(),
  antiDumpingRatePct: z.coerce.number().min(0).max(1000).optional(),
  /* Excise is worked out per product schema on the calculator page; pass the figure if you have one. */
  exciseDuty: money.optional(),
  /* Overrides the VAT rate the HS chapter implies. */
  vatRatePct: z.coerce.number().min(0).max(100).nullable().optional(),
  stillWineLow: z.boolean().optional(),
});

/** The VAT rate a commodity code implies in Luxembourg, for a screen that asks before it has figures. */
export async function GET(req) {
  const who = await requireUser(req);
  if (who.error) return NextResponse.json({ error: who.error }, { status: who.status });

  const hsCode = new URL(req.url).searchParams.get("hsCode") || "";
  const stillWineLow = new URL(req.url).searchParams.get("stillWineLow") === "1";
  return NextResponse.json({
    hsCode,
    vatRatePct: getLuVAT(hsCode, stillWineLow) * 100,
    /* What Luxembourg charges, for a picker: super-reduced, reduced, intermediate, standard. */
    luVatRates: [3, 8, 14, 17],
  });
}

export async function POST(req) {
  const who = await requireUser(req);
  if (who.error) return NextResponse.json({ error: who.error }, { status: who.status });

  let body;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid input", details: parsed.error.issues }, { status: 400 });
  }

  const origin = parsed.data.origin ? parsed.data.origin.toUpperCase() : "";
  const result = landedCost({ ...parsed.data, origin });

  return NextResponse.json({
    ...result,
    currency: parsed.data.currency?.toUpperCase() ?? "EUR",
    /* What the origin brings with it, so the caller can say why the duty is what it is. */
    agreement: origin
      ? { code: origin, name: ORIGIN_AGREEMENTS[origin]?.name ?? null, type: ORIGIN_AGREEMENTS[origin]?.type ?? null,
          preferenceAvailable: !!ORIGIN_AGREEMENTS[origin]?.pref, note: ORIGIN_AGREEMENTS[origin]?.note ?? null }
      : null,
  });
}
