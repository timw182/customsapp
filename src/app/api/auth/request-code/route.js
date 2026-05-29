import { NextResponse } from "next/server";
export async function POST() {
  return NextResponse.json({ error: "Removed. Use /api/auth/sign-up or /api/auth/forgot-password." }, { status: 410 });
}
