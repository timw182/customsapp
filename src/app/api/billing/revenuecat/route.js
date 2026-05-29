// RevenueCat → Dutify webhook.
//
// Subscribes to all events from the RC project and flips user.plan accordingly.
// Auth: RC adds an Authorization header that we configure in the RC dashboard;
// we compare it byte-for-byte against REVENUECAT_WEBHOOK_SECRET.
//
// Mapping (RC event → our action):
//   INITIAL_PURCHASE | RENEWAL | UNCANCELLATION | PRODUCT_CHANGE
//     → user.plan = "pro", proSince = now (first time), proSource = "revenuecat"
//   CANCELLATION
//     → no-op (user still has access until expiration; RC sends EXPIRATION later)
//   EXPIRATION | BILLING_ISSUE | SUBSCRIPTION_PAUSED
//     → user.plan = "free"
//   NON_RENEWING_PURCHASE | TRANSFER | SUBSCRIBER_ALIAS | TEST | etc.
//     → log + 200 (no state change)
//
// User mapping: RC's `app_user_id` is set to our User.id when the mobile app
// initialises Purchases (Phase 3). So we look up users directly by id, with
// a fallback to revenueCatUserId for any historic aliases.

import crypto from "node:crypto";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

// Constant-time secret comparison. The length check leaks length only (which is
// not secret-derived here), but avoids the byte-by-byte early-exit timing oracle
// of `!==` on the webhook secret that grants Pro.
function secretsMatch(a, b) {
  const ab = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  if (ab.length !== bb.length) return false;
  return crypto.timingSafeEqual(ab, bb);
}

const GRANT_EVENTS = new Set([
  "INITIAL_PURCHASE",
  "RENEWAL",
  "UNCANCELLATION",
  "PRODUCT_CHANGE",
  "NON_RENEWING_PURCHASE",
]);

const REVOKE_EVENTS = new Set([
  "EXPIRATION",
  "BILLING_ISSUE",
  "SUBSCRIPTION_PAUSED",
  "REFUND",
]);

function unauthorized() {
  return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
}

async function findUser(appUserId) {
  if (!appUserId || typeof appUserId !== "string") return null;
  // Convention: app_user_id === User.id. Fall back to the explicit mapping
  // column for any historic aliases (e.g. RC's auto-generated $RCAnonymousID
  // tied to a user via Purchases.logIn()).
  const byId = await prisma.user.findUnique({ where: { id: appUserId } });
  if (byId) return byId;
  return prisma.user.findUnique({ where: { revenueCatUserId: appUserId } });
}

export async function POST(req) {
  const secret = process.env.REVENUECAT_WEBHOOK_SECRET;
  if (!secret) {
    console.error("[revenuecat] REVENUECAT_WEBHOOK_SECRET not set — rejecting");
    return unauthorized();
  }

  // Normalise whatever RC sends in the Authorization field — the dashboard UI
  // doesn't force a `Bearer ` prefix and silently keeps any surrounding quotes,
  // so accept all three plausible shapes (Bearer <s>, raw <s>, "<s>") rather
  // than making the user re-edit the value byte-perfect.
  const auth = req.headers.get("authorization") || "";
  const stripped = auth.replace(/^Bearer\s+/i, "").replace(/^["']|["']$/g, "").trim();
  if (!secretsMatch(stripped, secret)) return unauthorized();

  let body;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const ev = body?.event;
  if (!ev || typeof ev !== "object") {
    return NextResponse.json({ error: "Missing event" }, { status: 400 });
  }

  const type = String(ev.type || "").toUpperCase();
  const appUserId = ev.app_user_id || ev.original_app_user_id;
  const user = await findUser(appUserId);

  if (!user) {
    // Don't 404 — RC retries 4xx aggressively and we don't want noise for
    // events tied to deleted accounts. Log and acknowledge.
    console.warn(`[revenuecat] ${type}: no user for app_user_id=${appUserId}`);
    return NextResponse.json({ ok: true, ignored: "unknown_user" });
  }

  if (GRANT_EVENTS.has(type)) {
    await prisma.user.update({
      where: { id: user.id },
      data: {
        plan: "pro",
        proSince: user.proSince ?? new Date(),
        proSource: "revenuecat",
        revenueCatUserId: appUserId,
      },
    });
    return NextResponse.json({ ok: true, applied: "pro" });
  }

  if (REVOKE_EVENTS.has(type)) {
    await prisma.user.update({
      where: { id: user.id },
      data: { plan: "free" },
    });
    return NextResponse.json({ ok: true, applied: "free" });
  }

  // CANCELLATION = user opted out but still has access; we only revoke on
  // EXPIRATION. Other event types (TEST, TRANSFER, SUBSCRIBER_ALIAS, etc.)
  // are acknowledged without side effects.
  return NextResponse.json({ ok: true, ignored: type });
}
