-- Add per-user subscription plan ("free" | "pro"). Defaults to "free" for
-- existing and new rows; flipped to "pro" manually or via billing flow later.
ALTER TABLE "User" ADD COLUMN "plan" TEXT NOT NULL DEFAULT 'free';
