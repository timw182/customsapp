-- Earlier migration applied a DevicePushToken shape with per-device flag
-- columns baked in. We've since split the flags onto NotificationPrefs
-- (per user). Zero rows in DevicePushToken today, so safe to drop + recreate.

DROP INDEX IF EXISTS "DevicePushToken_token_key";
DROP INDEX IF EXISTS "DevicePushToken_userId_idx";
DROP TABLE IF EXISTS "DevicePushToken";

CREATE TABLE "DevicePushToken" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "platform" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "DevicePushToken_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "DevicePushToken_token_key" ON "DevicePushToken"("token");
CREATE INDEX "DevicePushToken_userId_idx" ON "DevicePushToken"("userId");

-- Per-user notification preferences (master + per-category toggles).
CREATE TABLE "NotificationPrefs" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "pushEnabled" BOOLEAN NOT NULL DEFAULT true,
    "pushNewResults" BOOLEAN NOT NULL DEFAULT true,
    "pushLowConfidence" BOOLEAN NOT NULL DEFAULT true,
    "pushBilling" BOOLEAN NOT NULL DEFAULT true,
    "pushProductUpdates" BOOLEAN NOT NULL DEFAULT false,
    "emailEnabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "NotificationPrefs_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "NotificationPrefs_userId_key" ON "NotificationPrefs"("userId");
