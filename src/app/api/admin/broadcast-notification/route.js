// POST /api/admin/broadcast-notification
//   Fan a Product Updates announcement (or similar) out to every user who
//   has the matching flag enabled. Push and email are independent — the
//   caller can send either, both, or neither.
//
//   Body: {
//     category?:  "productUpdates" | "newResults" | "lowConfidence" | "billing"
//                   (default: "productUpdates")
//     push?:   { title, body, data? }            — omit to skip push
//     email?:  { subject, heading, lead,
//                eyebrow?, ctaLabel?, ctaUrl? }  — omit to skip email
//   }
//
//   Auth: requires role === "ADMIN" on the authenticated user.
//   Returns a summary { push: {...}, email: {...} }.

import { NextResponse } from "next/server";
import { requireUser } from "@/lib/apiAuth";
import { prisma } from "@/lib/prisma";
import { broadcastPush } from "@/lib/push";
import { broadcastNotificationEmail } from "@/lib/notifyEmail";

const ALLOWED_CATEGORIES = new Set([
  "productUpdates",
  "newResults",
  "lowConfidence",
  "billing",
]);

export async function POST(req) {
  const auth = await requireUser(req);
  if ("error" in auth) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  // Token-auth short-circuits `user.role` — fetch the actual row. Session
  // users already carry role on the session payload but re-reading is cheap
  // and keeps both paths uniform.
  const me = await prisma.user.findUnique({
    where: { id: auth.userId },
    select: { role: true },
  });
  if (me?.role !== "ADMIN") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  let body;
  try { body = await req.json(); } catch { body = null; }
  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  }

  const category = body.category ?? "productUpdates";
  if (!ALLOWED_CATEGORIES.has(category)) {
    return NextResponse.json({ error: "Unknown category" }, { status: 400 });
  }

  const summary = { push: null, email: null };

  if (body.push) {
    const { title, body: pushBody, data } = body.push;
    if (!title || !pushBody) {
      return NextResponse.json({ error: "push.title and push.body required" }, { status: 400 });
    }
    summary.push = await broadcastPush({ category, title, body: pushBody, data });
  }

  if (body.email) {
    const { subject, heading, lead, eyebrow, ctaLabel, ctaUrl } = body.email;
    if (!subject || !heading || !lead) {
      return NextResponse.json(
        { error: "email.subject, email.heading, email.lead required" },
        { status: 400 },
      );
    }
    summary.email = await broadcastNotificationEmail({
      category, subject, heading, lead, eyebrow, ctaLabel, ctaUrl,
    });
  }

  return NextResponse.json(summary);
}
