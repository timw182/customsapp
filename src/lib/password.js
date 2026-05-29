// Password helpers — bcrypt at rounds=12 (matches the legacy invite-code
// register flow at src/app/api/register/route.js). Plaintext passwords are
// never logged or returned; we hold them only long enough to hash + compare.

import bcrypt from "bcryptjs";

/** Sentinel passwordHash value for accounts that pre-date the password flow.
 *  These users must go through reset-password to set a real password. */
export const OTP_ONLY_SENTINEL = "!otp-only";

/** Minimum password length enforced at the API boundary. */
export const MIN_PASSWORD_LENGTH = 8;

export function hashPassword(plaintext) {
  return bcrypt.hash(plaintext, 12);
}

export function verifyPassword(plaintext, hash) {
  if (!hash || hash === OTP_ONLY_SENTINEL) return Promise.resolve(false);
  return bcrypt.compare(plaintext, hash);
}

export function isOtpOnlyHash(hash) {
  return hash === OTP_ONLY_SENTINEL;
}
