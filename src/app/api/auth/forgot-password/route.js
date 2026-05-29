// POST /api/auth/forgot-password
// Body: { email }
//
// Sends a 6-digit reset_password code to the email iff the address is on file.
// Always returns 200 { ok: true } so the response shape doesn't reveal whether
// an account exists. The mobile app moves to the reset-password screen
// regardless and the user discovers their typo only when no code arrives.

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

  const exists = await prisma.user.findUnique({ where: { email }, select: { id: true } });
  if (!exists) {
    return NextResponse.json({ ok: true });
  }

  const { plaintext } = await issueCode({ email, ip, purpose: CODE_PURPOSES.RESET_PASSWORD });

  const ttlMinutes = Math.round(CODE_TTL_MS / 60000);
  try {
    const result = await sendOtpEmail({
      to: email,
      code: plaintext,
      ttlMinutes,
      purpose: CODE_PURPOSES.RESET_PASSWORD,
    });
    if (!result.ok) console.error("[forgot-password] Resend failed:", result.error);
  } catch (e) {
    console.error("[forgot-password] sendOtpEmail threw:", e);
  }

  return NextResponse.json({ ok: true });
}
