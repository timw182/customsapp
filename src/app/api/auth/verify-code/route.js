import { NextResponse } from "next/server";
export async function POST() {
  return NextResponse.json({ error: "Removed. Use /api/auth/verify-email or /api/auth/reset-password." }, { status: 410 });
}
