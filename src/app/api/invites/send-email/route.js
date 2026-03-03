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
    ? `<p style="margin:0 0 8px;color:#6b7280;font-size:13px;">
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
<body style="margin:0;padding:0;background:#f0f7f4;font-family:Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f0f7f4;padding:40px 16px;">
    <tr>
      <td align="center">
        <table width="540" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:16px;overflow:hidden;max-width:540px;width:100%;box-shadow:0 4px 24px rgba(0,0,0,0.08);">

          <!-- Green accent stripe -->
          <tr>
            <td style="background:linear-gradient(90deg,#10b981,#34d399);height:5px;font-size:0;line-height:0;">&nbsp;</td>
          </tr>

          <!-- Header -->
          <tr>
            <td style="padding:32px 40px 24px;border-bottom:1px solid #e2e8f0;">
              <table cellpadding="0" cellspacing="0">
                <tr>
                  <td style="padding-right:12px;vertical-align:middle;">
                    <svg width="36" height="36" viewBox="0 0 56 56" fill="none" xmlns="http://www.w3.org/2000/svg">
                      <rect width="56" height="56" rx="14" fill="#10b981"/>
                      <rect x="25" y="10" width="6" height="16" rx="3" fill="white"/>
                      <path d="M14 22L28 38L42 22" stroke="white" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"/>
                      <rect x="12" y="42" width="32" height="4" rx="2" fill="white"/>
                    </svg>
                  </td>
                  <td style="vertical-align:middle;">
                    <span style="font-size:20px;font-weight:700;color:#111827;letter-spacing:-0.3px;">Dutify</span>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Body -->
          <tr>
            <td style="padding:36px 40px;">
              <p style="margin:0 0 6px;font-size:11px;font-weight:700;letter-spacing:2px;text-transform:uppercase;color:#10b981;">
                You've been invited
              </p>
              <h1 style="margin:0 0 16px;font-size:24px;font-weight:700;color:#111827;letter-spacing:-0.5px;">
                Your invite code
              </h1>
              <p style="margin:0 0 28px;color:#6b7280;font-size:14px;line-height:1.7;">
                You've been invited to access <strong style="color:#111827;">Dutify</strong> — Luxembourg's import duty calculator.
                Use the code below to create your account.
              </p>

              <!-- Code box -->
              <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:24px;">
                <tr>
                  <td style="background:#111827;border-radius:12px;padding:24px;text-align:center;">
                    <p style="margin:0 0 8px;font-size:10px;font-weight:700;letter-spacing:3px;text-transform:uppercase;color:#6b7280;">
                      Invite Code
                    </p>
                    <p style="margin:0;font-family:'Courier New',monospace;font-size:28px;letter-spacing:8px;color:#34d399;font-weight:700;">
                      ${code}
                    </p>
                  </td>
                </tr>
              </table>

              ${expiryLine}

              <!-- CTA button -->
              <table cellpadding="0" cellspacing="0" style="margin:8px 0 0;">
                <tr>
                  <td style="background:#10b981;border-radius:10px;">
                    <a href="${APP_URL}/register" target="_blank"
                       style="display:inline-block;padding:14px 32px;font-size:14px;font-weight:700;color:#ffffff;text-decoration:none;letter-spacing:0.3px;">
                      Create account →
                    </a>
                  </td>
                </tr>
              </table>

              <p style="margin:24px 0 0;color:#9ca3af;font-size:12px;line-height:1.6;">
                Or open this link in your browser:<br/>
                <a href="${APP_URL}/register" style="color:#10b981;">${APP_URL}/register</a>
              </p>
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="padding:20px 40px;border-top:1px solid #e2e8f0;background:#f9fafb;">
              <p style="margin:0;font-size:11px;color:#9ca3af;line-height:1.6;">
                This invite was sent by the Dutify admin. If you weren't expecting this, you can safely ignore it.
              </p>
            </td>
          </tr>

        </table>

        <!-- Sub-footer -->
        <p style="margin:20px 0 0;font-size:11px;color:#9ca3af;">Luxembourg · Import Duties · dutify.lu</p>
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
