import type { OutboundMail } from "@/lib/mail";

function escapeHtml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/** Trial end, in US Central, as "November 17". */
export function formatTrialEnd(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "soon";
  return new Intl.DateTimeFormat("en-US", { month: "long", day: "numeric", timeZone: "America/Chicago" }).format(date);
}

function shell(heading: string, inner: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(heading)}</title>
</head>
<body style="margin:0;background:#e7eefb;color:#0b1224;font-family:Inter,Segoe UI,sans-serif;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#e7eefb;padding:28px 14px;">
    <tr><td align="center">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#ffffff;border-radius:20px;padding:28px 24px 24px;">
        <tr><td>
          <p style="margin:0 0 14px;font-family:Montserrat,Avenir Next,Segoe UI,sans-serif;font-size:13px;font-weight:800;letter-spacing:0.16em;color:#1d4ed8;">SWATHLINE</p>
          ${inner}
          <p style="margin:22px 0 0;">
            <span style="display:inline-block;width:18px;height:8px;border-radius:99px;background:#16a34a;"></span>
            <span style="display:inline-block;width:18px;height:8px;border-radius:99px;background:#facc15;"></span>
            <span style="display:inline-block;width:18px;height:8px;border-radius:99px;background:#f97316;"></span>
            <span style="display:inline-block;width:18px;height:8px;border-radius:99px;background:#e11d48;"></span>
            <span style="display:inline-block;width:18px;height:8px;border-radius:99px;background:#d946ef;"></span>
          </p>
          <p style="margin:8px 0 0;font-size:12px;line-height:1.4;color:#3e4c66;">Hail size, smallest to largest. The map stays free.</p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

function button(href: string, label: string): string {
  const safe = escapeHtml(href);
  return `<p style="margin:20px 0 8px;"><a href="${safe}" style="display:inline-block;background:#1d4ed8;color:#f8fbff;text-decoration:none;font-weight:700;font-size:16px;line-height:1;padding:14px 18px;border-radius:12px;">${escapeHtml(label)}</a></p>
<p style="margin:0;font-size:13px;line-height:1.45;word-break:break-all;"><a href="${safe}" style="color:#1d4ed8;">${safe}</a></p>`;
}

export function inviteEmail(input: { to: string; ownerName: string; planName: string; joinUrl: string }): OutboundMail {
  const owner = input.ownerName.trim() || "Your crew";
  const plan = input.planName.trim() || "plan";
  const text = `${owner} invited you to their ${plan} plan on Swathline.

Open this link to join. Sign in with this email address. You don't pay separately. Their plan covers you.

${input.joinUrl}

If you weren't expecting this, you can ignore the email.`;
  const html = shell(
    "You're invited to a Swathline crew",
    `<h1 style="margin:0 0 12px;font-size:26px;line-height:1.15;letter-spacing:-0.03em;">You're invited to a crew</h1>
<p style="margin:0 0 10px;font-size:16px;line-height:1.5;">${escapeHtml(owner)} invited you to their ${escapeHtml(plan)} plan on Swathline.</p>
<p style="margin:0;font-size:16px;line-height:1.5;">Open the link to join. Sign in with this email address. You don't pay separately. Their plan covers you.</p>
${button(input.joinUrl, "Join the crew")}
<p style="margin:16px 0 0;font-size:14px;line-height:1.45;color:#3e4c66;">If you weren't expecting this, you can ignore the email.</p>`,
  );
  return { to: input.to, subject: "You're invited to a Swathline crew", text, html };
}

export function trialEndingEmail(input: {
  to: string;
  name: string;
  planName: string;
  trialEnd: string;
  accountUrl: string;
}): OutboundMail {
  const when = formatTrialEnd(input.trialEnd);
  const name = input.name.trim() || "there";
  const first = name.split(" ")[0] || name;
  const plan = input.planName.trim() || "Swathline";
  const text = `Hi ${first},

Your free trial of ${plan} ends on ${when}. After that, the card you added is charged for the plan.

The hail map stays free either way. You can cancel before then from your account:

${input.accountUrl}`;
  const html = shell(
    "Your Swathline trial ends soon",
    `<h1 style="margin:0 0 12px;font-size:26px;line-height:1.15;letter-spacing:-0.03em;">Your trial ends ${escapeHtml(when)}</h1>
<p style="margin:0 0 10px;font-size:16px;line-height:1.5;">Hi ${escapeHtml(first)},</p>
<p style="margin:0 0 10px;font-size:16px;line-height:1.5;">Your free trial of ${escapeHtml(plan)} ends on ${escapeHtml(when)}. After that, the card you added is charged for the plan.</p>
<p style="margin:0;font-size:16px;line-height:1.5;">The hail map stays free either way. You can cancel before then from your account.</p>
${button(input.accountUrl, "Open your account")}`,
  );
  return { to: input.to, subject: "Your Swathline trial ends soon", text, html };
}
