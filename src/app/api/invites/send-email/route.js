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
    ? `<p style="margin:0 0 8px;color:#5A6B5F;font-size:13px;font-style:italic;">
         Expires: ${new Date(expiresAt).toLocaleDateString("de-LU", { day: "2-digit", month: "2-digit", year: "numeric" })}
       </p>`
    : "";

  // Dossier palette — bone paper, forest ink, brass accents.
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <title>Your Dutify Invite</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;700&family=Fraunces:opsz,wght@9..144,400;9..144,500;9..144,600&family=JetBrains+Mono:wght@500;600&display=swap" rel="stylesheet">
</head>
<body style="margin:0;padding:0;background:#F5F1E8;font-family:'DM Sans',Arial,sans-serif;color:#14281E;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#F5F1E8;padding:48px 16px;">
    <tr>
      <td align="center">
        <table width="560" cellpadding="0" cellspacing="0" style="background:#FBF8F0;border:1px solid #D4C9A8;border-bottom:1px solid #9A8B5E;border-radius:4px;overflow:hidden;max-width:560px;width:100%;box-shadow:0 2px 0 #E8DFC4, 0 6px 20px rgba(31,59,45,0.08);">

          <!-- Brass rail -->
          <tr>
            <td style="background:#B8914A;height:3px;font-size:0;line-height:0;">&nbsp;</td>
          </tr>

          <!-- Masthead -->
          <tr>
            <td style="padding:36px 44px 20px;border-bottom:1px solid #D4C9A8;">
              <p style="margin:0 0 10px;font-size:10px;font-weight:500;letter-spacing:2.4px;text-transform:uppercase;color:#8A6A33;font-family:'JetBrains Mono',Courier,monospace;">
                Grand-Duché de Luxembourg · EU Customs
              </p>
              <h1 style="margin:0;font-size:30px;font-weight:500;color:#14281E;letter-spacing:-0.4px;font-family:'Fraunces',Georgia,serif;">
                Dutify<span style="color:#B8914A;">.</span>
              </h1>
              <p style="margin:8px 0 0;font-size:14px;color:#5A6B5F;font-style:italic;font-family:'Fraunces',Georgia,serif;">
                The customs dossier for Luxembourg importers.
              </p>
            </td>
          </tr>

          <!-- Body -->
          <tr>
            <td style="padding:36px 44px;">
              <p style="margin:0 0 8px;font-size:10px;font-weight:500;letter-spacing:2.2px;text-transform:uppercase;color:#8A6A33;font-family:'JetBrains Mono',Courier,monospace;">
                — Admittance by invite —
              </p>
              <h2 style="margin:0 0 18px;font-size:24px;font-weight:500;color:#14281E;letter-spacing:-0.3px;font-family:'Fraunces',Georgia,serif;">
                Your invite code
              </h2>
              <p style="margin:0 0 28px;color:#5A6B5F;font-size:15px;line-height:1.65;">
                You have been admitted to <strong style="color:#14281E;">Dutify</strong> — a working dossier for EU import duties, classification, excise, and CBAM.
                Present the code below at registration.
              </p>

              <!-- Code box — brass-framed stamp -->
              <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:24px;">
                <tr>
                  <td style="background:#F5F1E8;border:1.5px solid #B8914A;border-radius:3px;padding:28px 20px;text-align:center;">
                    <p style="margin:0 0 10px;font-size:10px;font-weight:500;letter-spacing:2.4px;text-transform:uppercase;color:#8A6A33;font-family:'JetBrains Mono',Courier,monospace;">
                      Invite Code
                    </p>
                    <p style="margin:0;font-family:'JetBrains Mono',Courier,monospace;font-size:28px;letter-spacing:6px;color:#14281E;font-weight:600;">
                      ${code}
                    </p>
                  </td>
                </tr>
              </table>

              ${expiryLine}

              <!-- CTA -->
              <table cellpadding="0" cellspacing="0" style="margin:12px 0 0;">
                <tr>
                  <td style="background:#1F3B2D;border:1px solid #14281E;border-radius:2px;">
                    <a href="${APP_URL}/register" target="_blank"
                       style="display:inline-block;padding:14px 28px;font-size:14px;font-weight:500;color:#FBF8F0;text-decoration:none;letter-spacing:0.3px;font-family:'DM Sans',Arial,sans-serif;">
                      Register your dossier  →
                    </a>
                  </td>
                </tr>
              </table>

              <p style="margin:24px 0 0;color:#5A6B5F;font-size:12px;line-height:1.6;">
                Or open this link directly:<br/>
                <a href="${APP_URL}/register" style="color:#1F3B2D;text-decoration:underline;text-decoration-color:#D9BE83;">${APP_URL}/register</a>
              </p>
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="padding:18px 44px;border-top:1px solid #D4C9A8;background:#F5F1E8;">
              <p style="margin:0;font-size:11px;color:#8A9188;line-height:1.65;font-style:italic;font-family:'Fraunces',Georgia,serif;">
                This invite was issued by the Dutify registrar. If you weren't expecting it, simply disregard.
              </p>
            </td>
          </tr>

        </table>

        <!-- Sub-footer -->
        <p style="margin:22px 0 0;font-size:10px;color:#8A9188;font-family:'JetBrains Mono',Courier,monospace;letter-spacing:2.4px;text-transform:uppercase;">
          Luxembourg · Vol. XVII · dutify.lu
        </p>
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
