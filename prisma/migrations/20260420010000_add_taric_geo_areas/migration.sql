-- CreateTable
CREATE TABLE "TaricGeoArea" (
    "code" TEXT NOT NULL PRIMARY KEY,
    "acronym" TEXT,
    "description" TEXT NOT NULL,
    "startDate" DATETIME,
    "endDate" DATETIME,
    "isCountry" BOOLEAN NOT NULL DEFAULT false,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "TaricZoneMember" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "zoneCode" TEXT NOT NULL,
    "memberCode" TEXT NOT NULL,
    "membershipStart" DATETIME,
    "membershipEnd" DATETIME,
    CONSTRAINT "TaricZoneMember_zoneCode_fkey" FOREIGN KEY ("zoneCode") REFERENCES "TaricGeoArea" ("code") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "TaricZoneMember_zoneCode_memberCode_membershipStart_key" ON "TaricZoneMember"("zoneCode", "memberCode", "membershipStart");

-- CreateIndex
CREATE INDEX "TaricZoneMember_memberCode_idx" ON "TaricZoneMember"("memberCode");
