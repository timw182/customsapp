import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { Resend } from "resend";
import { z } from "zod";

const schema = z.object({
  codeId: z.string().min(1),
  email: z.string().email(),
});

const APP_URL = process.env.NEXTAUTH_URL ?? "https://customs.bluebrick.cloud";
const FROM = process.env.RESEND_FROM ?? "Dutify <invites@customs.bluebrick.cloud>";

function buildHtml(code, expiresAt) {
  const expiryLine = expiresAt
    ? `<p style="margin:0 0 8px;color:#9a8e7e;font-size:13px;font-family:'Courier New',monospace;">
         Expires: ${new Date(expiresAt).toLocaleDateString("de-LU", { day: "2-digit", month: "2-digit", year: "numeric" })}
       </p>`
    : "";

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <title>Your Dutify Invite</title>
</head>
<body style="margin:0;padding:0;background:#f0ebe2;font-family:'DM Sans',Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f0ebe2;padding:40px 0;">
    <tr>
      <td align="center">
        <table width="560" cellpadding="0" cellspacing="0" style="background:#1a1208;border-radius:8px;overflow:hidden;max-width:560px;width:100%;">
          <!-- Header -->
          <tr>
            <td style="padding:36px 40px 28px;border-bottom:1px solid #2e2010;">
              <table cellpadding="0" cellspacing="0">
                <tr>
                  <td style="padding-right:12px;vertical-align:middle;">
                    <svg width="36" height="36" viewBox="0 0 56 56" fill="none" xmlns="http://www.w3.org/2000/svg">
                      <rect width="56" height="56" rx="11" fill="#1a1208"/>
                      <rect x="25" y="8" width="6" height="18" rx="3" fill="url(#gold1)"/>
                      <path d="M13 22L28 39L43 22" stroke="url(#gold1)" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"/>
                      <rect x="10" y="43" width="36" height="4" rx="2" fill="url(#gold1)"/>
                      <defs>
                        <linearGradient id="gold1" x1="13" y1="8" x2="43" y2="47" gradientUnits="userSpaceOnUse">
                          <stop offset="0%" stop-color="#F8DA6A"/>
                          <stop offset="100%" stop-color="#D4920A"/>
                        </linearGradient>
                      </defs>
                    </svg>
                  </td>
                  <td style="vertical-align:middle;">
                    <span style="font-family:Arial,sans-serif;font-size:22px;font-weight:700;letter-spacing:4px;text-transform:uppercase;color:#f0ebe2;">
                      DUTIFY
                    </span>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
          <!-- Body -->
          <tr>
            <td style="padding:36px 40px;">
              <p style="margin:0 0 6px;font-family:Arial,sans-serif;font-size:10px;letter-spacing:5px;text-transform:uppercase;color:#C8900A;">
                You've been invited
              </p>
              <h1 style="margin:0 0 20px;font-family:Arial,sans-serif;font-size:24px;font-weight:700;letter-spacing:2px;text-transform:uppercase;color:#f0ebe2;">
                Your Invite Code
              </h1>
              <p style="margin:0 0 24px;color:#b8a898;font-size:14px;line-height:1.6;">
                You've been invited to access <strong style="color:#f0ebe2;">Dutify</strong> — Luxembourg's import duty calculator.
                Use the code below to create your account.
              </p>

              <!-- Code box -->
              <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:24px;">
                <tr>
                  <td style="background:#0e0a04;border:1px solid #C8900A;border-radius:4px;padding:20px;text-align:center;">
                    <p style="margin:0 0 6px;font-family:Arial,sans-serif;font-size:10px;letter-spacing:4px;text-transform:uppercase;color:#9a8e7e;">
                      Invite Code
                    </p>
                    <p style="margin:0;font-family:'Courier New',monospace;font-size:26px;letter-spacing:6px;color:#F8DA6A;font-weight:700;">
                      ${code}
                    </p>
                  </td>
                </tr>
              </table>

              ${expiryLine}

              <!-- CTA button -->
              <table cellpadding="0" cellspacing="0" style="margin:28px 0 0;">
                <tr>
                  <td style="background:linear-gradient(135deg,#F8DA6A,#C8900A);border-radius:3px;">
                    <a href="${APP_URL}/register" target="_blank"
                       style="display:inline-block;padding:14px 32px;font-family:Arial,sans-serif;font-size:12px;font-weight:700;letter-spacing:3px;text-transform:uppercase;color:#ffffff;text-decoration:none;">
                      Create Account →
                    </a>
                  </td>
                </tr>
              </table>

              <p style="margin:28px 0 0;color:#5a4e3e;font-size:12px;line-height:1.6;">
                Or copy this link into your browser:<br/>
                <a href="${APP_URL}/register" style="color:#C8900A;">${APP_URL}/register</a>
              </p>
            </td>
          </tr>
          <!-- Footer -->
          <tr>
            <td style="padding:20px 40px;border-top:1px solid #2e2010;">
              <p style="margin:0;font-size:11px;color:#5a4e3e;line-height:1.6;">
                This invite was sent by the Dutify admin. If you weren't expecting this email, you can safely ignore it.
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

export async function POST(req) {
  const session = await auth();
  if (session?.user?.role !== "ADMIN") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  if (!process.env.RESEND_API_KEY) {
    return NextResponse.json({ error: "Email not configured (missing RESEND_API_KEY)" }, { status: 503 });
  }

  let body;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid input" }, { status: 400 });
  }

  const { codeId, email } = parsed.data;

  const invite = await prisma.inviteCode.findUnique({ where: { id: codeId } });
  if (!invite) {
    return NextResponse.json({ error: "Invite code not found" }, { status: 404 });
  }
  if (invite.usedAt) {
    return NextResponse.json({ error: "Invite code already used" }, { status: 400 });
  }

  const resend = new Resend(process.env.RESEND_API_KEY);
  const { error } = await resend.emails.send({
    from: FROM,
    to: email,
    subject: "Your Dutify Invite Code",
    html: buildHtml(invite.code, invite.expiresAt),
  });

  if (error) {
    return NextResponse.json({ error: error.message ?? "Failed to send email" }, { status: 502 });
  }

  const updated = await prisma.inviteCode.update({
    where: { id: codeId },
    data: { sentTo: email },
  });

  return NextResponse.json({ ok: true, invite: updated });
}
