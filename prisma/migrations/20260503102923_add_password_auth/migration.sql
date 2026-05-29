-- Migrate from passwordless OTP-only sign-in to email + password.
--
-- 1. Add `emailVerifiedAt` to User. Backfill existing users to their `createdAt`
--    so they pass any "is verified" gate immediately (they already verified via
--    the old OTP flow).
-- 2. Add `purpose` to OtpCode so a verify-email code can't be replayed against
--    the password-reset endpoint and vice-versa. Existing rows are short-lived
--    (≤10 min TTL, purged after 24h) so the chosen default is harmless.
-- 3. Replace the (email, createdAt) index with (email, purpose, createdAt) to
--    match the new lookup pattern in latestActiveCode().

ALTER TABLE "User" ADD COLUMN "emailVerifiedAt" DATETIME;
UPDATE "User" SET "emailVerifiedAt" = "createdAt" WHERE "emailVerifiedAt" IS NULL;

ALTER TABLE "OtpCode" ADD COLUMN "purpose" TEXT NOT NULL DEFAULT 'verify_email';

DROP INDEX IF EXISTS "OtpCode_email_createdAt_idx";
CREATE INDEX "OtpCode_email_purpose_createdAt_idx" ON "OtpCode"("email", "purpose", "createdAt");
