-- Account-wide profile fields. Both the mobile app and the customs web UI
-- read/write these via /api/me/profile so a user sees the same name, company,
-- phone, and avatar everywhere they sign in.
ALTER TABLE "User" ADD COLUMN "company"    TEXT;
ALTER TABLE "User" ADD COLUMN "phone"      TEXT;
ALTER TABLE "User" ADD COLUMN "avatarMime" TEXT;
ALTER TABLE "User" ADD COLUMN "avatarData" TEXT;
