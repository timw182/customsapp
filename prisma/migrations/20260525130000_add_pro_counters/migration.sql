-- AlterTable
ALTER TABLE "User" ADD COLUMN "sonnetUsesUsed" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "User" ADD COLUMN "proSince" DATETIME;
ALTER TABLE "User" ADD COLUMN "proSource" TEXT;
ALTER TABLE "User" ADD COLUMN "revenueCatUserId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "User_revenueCatUserId_key" ON "User"("revenueCatUserId");
