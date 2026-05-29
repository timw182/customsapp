// POST /api/auth/resend-verification
// Body: { email }
//
// Issues a fresh verify_email code for an unverified account. Always returns
// 200 { ok: true } regardless of whether the email is on file or already
// verified — same enumeration-proof contract as sign-up and forgot-password.

import { NextResponse } from "next/server";
import { z } from "zod";
import {
  normalizeEmail, isValidEmail, checkRateLimit, issueCode,
  purgeStaleCodes, CODE_TTL_MS, CODE_PURPOSES,
} from "@/lib/otp";
import { sendOtpEmail } from "@/lib/otpEmail";
import { prisma } from "@/lib/prisma";

const schema = z.object({
  email: z.string().min(1).max(320),
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

  const user = await prisma.user.findUnique({
    where: { email },
    select: { id: true, emailVerifiedAt: true },
  });
  if (!user || user.emailVerifiedAt) {
    return NextResponse.json({ ok: true });
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
    if (!result.ok) console.error("[resend-verification] Resend failed:", result.error);
  } catch (e) {
    console.error("[resend-verification] sendOtpEmail threw:", e);
  }

  return NextResponse.json({ ok: true });
}
