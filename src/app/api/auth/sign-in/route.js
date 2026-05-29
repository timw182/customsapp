// POST /api/auth/sign-in
// Body: { email, password, deviceName? }
//
// Bcrypt-compares the supplied password against the user's `passwordHash`. On
// success: issues a session ApiToken (same shape every existing API route
// accepts via `requireUser`). On failure: returns a uniform "invalid credentials"
// response — never differentiates "wrong password" from "unknown email" so the
// endpoint can't be used to enumerate accounts.
//
// Two well-known machine-readable codes the mobile app branches on:
//   - "MUST_RESET" → user signed up under the legacy passwordless OTP flow and
//     has the "!otp-only" sentinel password. The app routes them through
//     forgot-password to set a real password.
//   - "EMAIL_UNVERIFIED" → password matches but the user never finished email
//     verification. The app routes them to /verify-email and we re-issue a code.

import { NextResponse } from "next/server";
import { z } from "zod";
import {
  normalizeEmail, isValidEmail, issueCode, checkRateLimit,
  CODE_TTL_MS, CODE_PURPOSES,
} from "@/lib/otp";
import { sendOtpEmail } from "@/lib/otpEmail";
import { verifyPassword, isOtpOnlyHash } from "@/lib/password";
import { prisma } from "@/lib/prisma";
import { issueToken } from "@/lib/apiAuth";

const schema = z.object({
  email: z.string().min(1).max(320),
  password: z.string().min(1).max(200),
  deviceName: z.string().trim().min(1).max(60).optional(),
});

const INVALID_CREDENTIALS = { error: "Invalid email or password", code: "INVALID_CREDENTIALS" };

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
    return NextResponse.json(INVALID_CREDENTIALS, { status: 401 });
  }

  const email = normalizeEmail(parsed.data.email);
  if (!isValidEmail(email)) {
    return NextResponse.json(INVALID_CREDENTIALS, { status: 401 });
  }

  const user = await prisma.user.findUnique({
    where: { email },
    select: {
      id: true, email: true, name: true, role: true,
      passwordHash: true, emailVerifiedAt: true,
    },
  });
  if (!user) {
    return NextResponse.json(INVALID_CREDENTIALS, { status: 401 });
  }

  // Legacy passwordless users — route them through reset to set a real password.
  // This is exposed only when the user's email is on file *and* their hash is the
  // sentinel; anyone else hitting it gets the generic INVALID_CREDENTIALS, so this
  // doesn't add an enumeration vector beyond what reset-password already offers.
  if (isOtpOnlyHash(user.passwordHash)) {
    return NextResponse.json(
      { error: "Set a password to continue", code: "MUST_RESET" },
      { status: 403 }
    );
  }

  const match = await verifyPassword(parsed.data.password, user.passwordHash);
  if (!match) {
    return NextResponse.json(INVALID_CREDENTIALS, { status: 401 });
  }

  // Password is correct but email never verified. Re-issue a verify_email code
  // so the user lands on the verify screen with a fresh code waiting. Rate-limit
  // is best-effort — failing to send doesn't block the response.
  if (!user.emailVerifiedAt) {
    const ip = clientIp(req);
    const rl = await checkRateLimit({ email, ip });
    if (rl.ok) {
      try {
        const { plaintext } = await issueCode({
          email, ip, purpose: CODE_PURPOSES.VERIFY_EMAIL,
        });
        const ttlMinutes = Math.round(CODE_TTL_MS / 60000);
        await sendOtpEmail({
          to: email,
          code: plaintext,
          ttlMinutes,
          purpose: CODE_PURPOSES.VERIFY_EMAIL,
        });
      } catch (e) {
        console.error("[sign-in] failed to re-issue verify code:", e);
      }
    }
    return NextResponse.json(
      { error: "Email not verified", code: "EMAIL_UNVERIFIED" },
      { status: 403 }
    );
  }

  const { plaintext, row: tokenRow } = await issueToken({
    userId: user.id,
    name: parsed.data.deviceName || "Password sign-in",
  });

  return NextResponse.json({
    ok: true,
    token: plaintext,
    tokenId: tokenRow.id,
    user: {
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
    },
  });
}
