// Transactional email through Brevo's API (never marketing campaigns: those add the account's postal address).
const ENDPOINT = "https://api.brevo.com/v3/smtp/email";

export type Email = { to: string; subject: string; html: string; text: string; headers?: Record<string, string> };

/** permanent: don't retry (bad address, rejected content). Otherwise the caller may retry on a later run. */
export class EmailError extends Error {
  constructor(message: string, readonly permanent: boolean) {
    super(message);
  }
}

export async function sendEmail(e: Email): Promise<void> {
  const key = process.env.BREVO_API_KEY;
  const from = process.env.EMAIL_FROM;
  if (!key || !from) throw new EmailError("BREVO_API_KEY / EMAIL_FROM missing", false);
  let res: Response;
  try {
    res = await fetch(ENDPOINT, {
      method: "POST",
      headers: { "api-key": key, "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({
        sender: { email: from, name: process.env.EMAIL_FROM_NAME || "PlayRadar" },
        to: [{ email: e.to }],
        subject: e.subject,
        htmlContent: e.html,
        textContent: e.text,
        headers: e.headers,
      }),
      signal: AbortSignal.timeout(20_000),
    });
  } catch (err) {
    throw new EmailError(`Brevo unreachable: ${(err as Error).message}`, false);
  }
  if (res.ok) return;
  const body = (await res.text()).slice(0, 300);
  // 400 = this message is bad; 401/403/429/5xx = our key, quota or Brevo itself, so keep the alert for later.
  throw new EmailError(`Brevo ${res.status}: ${body}`, res.status === 400);
}
