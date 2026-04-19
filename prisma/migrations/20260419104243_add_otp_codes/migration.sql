-- Short-lived email verification codes for passwordless sign-in.
CREATE TABLE "OtpCode" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "email" TEXT NOT NULL,
    "codeHash" TEXT NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" DATETIME NOT NULL,
    "consumedAt" DATETIME,
    "ip" TEXT
);

CREATE INDEX "OtpCode_email_createdAt_idx" ON "OtpCode"("email", "createdAt");
CREATE INDEX "OtpCode_createdAt_idx" ON "OtpCode"("createdAt");
