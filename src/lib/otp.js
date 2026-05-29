// Email-code helpers — generation, hashing, rate limiting, cleanup.
// Plaintext codes are never stored: only the bcrypt hash lives in the DB.
// Codes are scoped by `purpose` ("verify_email" after signup, "reset_password"
// for forgot-password) so a code issued for one flow can't be replayed in the
// other.

import bcrypt from "bcryptjs";
import crypto from "node:crypto";
import { prisma } from "@/lib/prisma";

/** How long a freshly issued code is valid for. */
export const CODE_TTL_MS = 10 * 60 * 1000;

/** Max failed `verify` attempts before a code self-destructs. */
export const MAX_ATTEMPTS = 5;

/** Rate limit windows for code-issuing endpoints. */
export const RATE_LIMITS = {
  perEmailPerMinute: 1,
  perEmailPerHour: 5,
  perIpPerMinute: 3,
  perIpPerHour: 20,
};

/** Allowed `purpose` values. Anything else throws — fail loud on a typo. */
export const CODE_PURPOSES = Object.freeze({
  VERIFY_EMAIL: "verify_email",
  RESET_PASSWORD: "reset_password",
});

function assertPurpose(purpose) {
  if (purpose !== CODE_PURPOSES.VERIFY_EMAIL && purpose !== CODE_PURPOSES.RESET_PASSWORD) {
    throw new Error(`Unknown OTP purpose: ${purpose}`);
  }
}

/** RFC-ish email regex — permissive enough for real-world addresses, strict enough to reject garbage. */
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function normalizeEmail(raw) {
  return String(raw ?? "").trim().toLowerCase();
}

export function isValidEmail(raw) {
  const e = normalizeEmail(raw);
  return e.length > 0 && e.length <= 254 && EMAIL_RE.test(e);
}

/**
 * Generate a random 6-digit numeric code using crypto.randomInt so there's
 * no modulo bias. Always zero-padded so "007421" is a valid code, not "7421".
 */
export function generateCode() {
  const n = crypto.randomInt(0, 1_000_000);
  return String(n).padStart(6, "0");
}

export function hashCode(plaintext) {
  return bcrypt.hash(plaintext, 10);
}

/**
 * Constant-time-ish compare: bcrypt.compare already avoids early-exit on
 * per-char mismatch. Returns true on match.
 */
export function verifyCodeHash(plaintext, hash) {
  return bcrypt.compare(plaintext, hash);
}

/**
 * Check whether a fresh code can be issued for the given email + IP.
 * Counts rows in OtpCode (consumed or not) created inside each window.
 * Returns { ok: true } or { ok: false, retryAfterMs, reason }.
 */
export async function checkRateLimit({ email, ip }) {
  const now = Date.now();
  const oneMinAgo = new Date(now - 60 * 1000);
  const oneHourAgo = new Date(now - 60 * 60 * 1000);

  const [emailMin, emailHour, ipMin, ipHour] = await Promise.all([
    prisma.otpCode.count({ where: { email, createdAt: { gte: oneMinAgo } } }),
    prisma.otpCode.count({ where: { email, createdAt: { gte: oneHourAgo } } }),
    ip ? prisma.otpCode.count({ where: { ip, createdAt: { gte: oneMinAgo } } }) : Promise.resolve(0),
    ip ? prisma.otpCode.count({ where: { ip, createdAt: { gte: oneHourAgo } } }) : Promise.resolve(0),
  ]);

  if (emailMin >= RATE_LIMITS.perEmailPerMinute) {
    return { ok: false, reason: "email-minute", retryAfterMs: 60 * 1000 };
  }
  if (emailHour >= RATE_LIMITS.perEmailPerHour) {
    return { ok: false, reason: "email-hour", retryAfterMs: 60 * 60 * 1000 };
  }
  if (ipMin >= RATE_LIMITS.perIpPerMinute) {
    return { ok: false, reason: "ip-minute", retryAfterMs: 60 * 1000 };
  }
  if (ipHour >= RATE_LIMITS.perIpPerHour) {
    return { ok: false, reason: "ip-hour", retryAfterMs: 60 * 60 * 1000 };
  }
  return { ok: true };
}

/** Create, persist, and return the plaintext of a fresh code for this email + purpose. */
export async function issueCode({ email, ip, purpose = CODE_PURPOSES.VERIFY_EMAIL }) {
  assertPurpose(purpose);
  const plaintext = generateCode();
  const codeHash = await hashCode(plaintext);
  const row = await prisma.otpCode.create({
    data: {
      email,
      codeHash,
      purpose,
      expiresAt: new Date(Date.now() + CODE_TTL_MS),
      ip: ip ?? null,
    },
  });
  return { plaintext, row };
}

/**
 * Find the latest unconsumed, non-expired code for this email + purpose.
 * Returns the OtpCode row or null.
 */
export async function latestActiveCode(email, purpose = CODE_PURPOSES.VERIFY_EMAIL) {
  assertPurpose(purpose);
  return prisma.otpCode.findFirst({
    where: {
      email,
      purpose,
      consumedAt: null,
      expiresAt: { gt: new Date() },
    },
    orderBy: { createdAt: "desc" },
  });
}

/** Mark a code consumed so it can't be replayed. */
export async function consumeCode(id) {
  await prisma.otpCode.update({
    where: { id },
    data: { consumedAt: new Date() },
  });
}

/** Bump the failed-attempt counter on a code. */
export async function bumpAttempts(id) {
  await prisma.otpCode.update({
    where: { id },
    data: { attempts: { increment: 1 } },
  });
}

/**
 * Opportunistic cleanup: delete codes older than 24h. Cheap when called from
 * the request-code route; no separate cron needed while volume is small.
 */
export async function purgeStaleCodes() {
  const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000);
  await prisma.otpCode.deleteMany({ where: { createdAt: { lt: cutoff } } });
}
