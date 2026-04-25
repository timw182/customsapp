// POST /api/auth/register-mobile
// Body: { email, name? }
//
// The only path that creates new accounts. Called by the iOS app during
// first-time onboarding. Creates the User row (if not already present)
// and dispatches a 6-digit OTP — the iOS app then continues with the
// standard /api/auth/verify-code flow to obtain an ApiToken.
//
// Always returns 200 { ok: true } regardless of whether the email was
// already on file: the response shape must be identical so this endpoint
// can't be used to enumerate existing accounts. If the user already
// exists we still send a fresh OTP, which means re-running register-mobile
// is a safe no-op for an iOS user who's already onboarded.

import { NextResponse } from "next/server";
import { z } from "zod";
import {
  normalizeEmail, isValidEmail, checkRateLimit, issueCode,
  purgeStaleCodes, CODE_TTL_MS,
} from "@/lib/otp";
import { sendOtpEmail } from "@/lib/otpEmail";
import { prisma } from "@/lib/prisma";

const schema = z.object({
  email: z.string().min(1).max(320),
  name: z.string().trim().min(1).max(120).optional(),
});

function clientIp(req) {
  const fwd = req.headers.get("x-forwarded-for");
  if (fwd) return fwd.split(",")[0].trim();
  return req.headers.get("x-real-ip") ?? null;
}

export async function POST(req) {
  let body;
  try { body = await req.json(); } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid input" }, { status: 400 });
  }

  const email = normalizeEmail(parsed.data.email);
  if (!isValidEmail(email)) {
    return NextResponse.json({ error: "Invalid email" }, { status: 400 });
  }

  const ip = clientIp(req);

  const rl = await checkRateLimit({ email, ip });
  if (!rl.ok) {
    return NextResponse.json(
      { error: "Too many requests. Please wait a moment." },
      { status: 429, headers: { "Retry-After": String(Math.ceil(rl.retryAfterMs / 1000)) } }
    );
  }

  purgeStaleCodes().catch(() => {});

  // Create the user if absent. `passwordHash` is non-nullable in the
  // schema, so we store the same sentinel used elsewhere — disables
  // password sign-in completely; OTP is the only way in. Leave existing
  // rows untouched so a re-registration call can't overwrite an updated
  // display name.
  await prisma.user.upsert({
    where: { email },
    create: {
      email,
      name: parsed.data.name || null,
      passwordHash: "!otp-only",
    },
    update: {},
  });

  const { plaintext } = await issueCode({ email, ip });

  const ttlMinutes = Math.round(CODE_TTL_MS / 60000);
  try {
    const result = await sendOtpEmail({ to: email, code: plaintext, ttlMinutes });
    if (!result.ok) {
      console.error("[register-mobile] Resend failed:", result.error);
    }
  } catch (e) {
    console.error("[register-mobile] sendOtpEmail threw:", e);
  }

  return NextResponse.json({ ok: true });
}
