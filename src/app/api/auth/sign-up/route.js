// POST /api/auth/sign-up
// Body: { email, password }
//
// Creates a new account with `emailVerifiedAt = null` and dispatches a 6-digit
// verify_email code. The mobile app then continues with /api/auth/verify-email
// to confirm and obtain a session token.
//
// Always returns 200 { ok: true } regardless of whether the email is already on
// file: the response shape must be identical so this endpoint can't be used to
// enumerate accounts.
//   - If the email is unknown → create user, send code.
//   - If the email exists & unverified → resend code (treat as retry).
//   - If the email exists & already verified → silent no-op (user should sign in
//     instead; we don't say so to avoid leaking existence).
//
// `register-mobile`'s "name" field is intentionally dropped here — names are now
// captured later via the profile screen, not at signup. This keeps signup form
// minimal (email + password + confirm) per Apple's submission guidelines.

import { NextResponse } from "next/server";
import { z } from "zod";
import {
  normalizeEmail, isValidEmail, checkRateLimit, issueCode,
  purgeStaleCodes, CODE_TTL_MS, CODE_PURPOSES,
} from "@/lib/otp";
import { sendOtpEmail } from "@/lib/otpEmail";
import { hashPassword, MIN_PASSWORD_LENGTH } from "@/lib/password";
import { prisma } from "@/lib/prisma";

const schema = z.object({
  email: z.string().min(1).max(320),
  password: z.string().min(MIN_PASSWORD_LENGTH).max(200),
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

  const existing = await prisma.user.findUnique({
    where: { email },
    select: { id: true, emailVerifiedAt: true },
  });

  if (existing && existing.emailVerifiedAt) {
    // Account already verified. We intentionally surface this rather than the
    // older silent-200 "enumeration-proof" response: the silent variant
    // stranded users on the verify-code screen waiting for an email that
    // would never arrive. For a customs-lookup app the UX cost of pretending
    // is higher than the marginal enumeration risk — the auth endpoints are
    // rate-limited and the data behind them isn't account-existence-sensitive.
    return NextResponse.json(
      { error: "An account already exists for this email", code: "EMAIL_EXISTS" },
      { status: 409 },
    );
  }

  if (!existing) {
    const passwordHash = await hashPassword(parsed.data.password);
    await prisma.user.create({
      data: { email, passwordHash, emailVerifiedAt: null },
    });
  } else {
    // Existing unverified account — overwrite passwordHash with the new one
    // they just typed. Otherwise an abandoned signup would leave a stale
    // password locked behind a verify step the user might never finish.
    const passwordHash = await hashPassword(parsed.data.password);
    await prisma.user.update({
      where: { email },
      data: { passwordHash },
    });
  }

  const { plaintext } = await issueCode({ email, ip, purpose: CODE_PURPOSES.VERIFY_EMAIL });

  const ttlMinutes = Math.round(CODE_TTL_MS / 60000);
  try {
    const result = await sendOtpEmail({
      to: email,
      code: plaintext,
      ttlMinutes,
      purpose: CODE_PURPOSES.VERIFY_EMAIL,
    });
    if (!result.ok) console.error("[sign-up] Resend failed:", result.error);
  } catch (e) {
    console.error("[sign-up] sendOtpEmail threw:", e);
  }

  return NextResponse.json({ ok: true });
}
