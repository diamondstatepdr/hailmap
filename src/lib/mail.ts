export interface OutboundMail {
  to: string;
  subject: string;
  html: string;
  text: string;
}

export function mailFrom(): string {
  return process.env.RESEND_FROM?.trim() || "Swathline <hello@swathline.app>";
}

/** Posts one message to Resend. A missing key does not send and does not throw. */
export async function sendMail(mail: OutboundMail): Promise<{ sent: boolean; retry: boolean }> {
  const key = process.env.RESEND_API_KEY?.trim();
  if (!key) return { sent: false, retry: false };
  try {
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: mailFrom(),
        to: [mail.to],
        subject: mail.subject,
        html: mail.html,
        text: mail.text,
      }),
    });
    if (response.ok) return { sent: true, retry: false };
    console.error(`Swathline email failed (${response.status})`);
    return { sent: false, retry: response.status >= 500 || response.status === 429 };
  } catch (error) {
    console.error("Swathline email failed", error instanceof Error ? error.message : "network");
    return { sent: false, retry: true };
  }
}
