// POST /api/auth/request-code
// Body: { email }
// Always returns 200 { ok: true } to prevent email-enumeration.
// Actual delivery failures are logged server-side.

import { NextResponse } from "next/server";
import { z } from "zod";
import {
  normalizeEmail, isValidEmail, checkRateLimit, issueCode,
  purgeStaleCodes, CODE_TTL_MS,
} from "@/lib/otp";
import { sendOtpEmail } from "@/lib/otpEmail";

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

  // Opportunistic cleanup so stale codes don't inflate rate-limit counts.
  purgeStaleCodes().catch(() => {});

  const { plaintext } = await issueCode({ email, ip });

  const ttlMinutes = Math.round(CODE_TTL_MS / 60000);
  try {
    const result = await sendOtpEmail({ to: email, code: plaintext, ttlMinutes });
    if (!result.ok) {
      console.error("[request-code] Resend failed:", result.error);
    }
  } catch (e) {
    console.error("[request-code] sendOtpEmail threw:", e);
  }

  return NextResponse.json({ ok: true });
}
