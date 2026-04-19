-- Restored: add nullable sensitiveGoods JSON-payload column to HSFavourite.
ALTER TABLE "HSFavourite" ADD COLUMN "sensitiveGoods" TEXT;
