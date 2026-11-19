import { env } from "./env";

/**
 * Sends the magic-link sign-in email.
 *
 * Production: Resend (https://resend.com) — free tier covers early volume.
 * Requires RESEND_API_KEY and EMAIL_FROM.
 *
 * Local dev without a Resend key: the link is printed to the server console
 * instead, so the full sign-in flow can be tested with no email account.
 */
export async function sendMagicLinkEmail(to: string, link: string): Promise<boolean> {
  if (!env.resendApiKey) {
    console.log(`[dev] Magic link for ${to}: ${link}`);
    return true;
  }

  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.resendApiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: env.emailFrom,
        to,
        subject: "Sign in to Local Jobs Board",
        text: [
          "Tap the link below to sign in to Local Jobs Board.",
          "",
          link,
          "",
          "This link works once and expires in 15 minutes. If you didn't ask for it, just ignore this email.",
        ].join("\n"),
      }),
    });
    if (!res.ok) {
      console.error("[mail] Resend error:", res.status, await res.text());
      return false;
    }
    return true;
  } catch (err) {
    console.error("[mail] Failed to send magic link:", err);
    return false;
  }
}
