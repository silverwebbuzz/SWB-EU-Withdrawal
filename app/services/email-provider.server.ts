// Email delivery behind a small interface. Select the implementation with
// EMAIL_PROVIDER (log | smtp | resend); credentials come from the environment.
import nodemailer from "nodemailer";
import { getEnv, type AppEnv } from "../lib/env.server";

export interface OutgoingEmail {
  to: string[];
  replyTo?: string | null;
  subject: string;
  text: string;
  html: string;
  /** Stable per message; providers that support it use it to drop duplicates. */
  idempotencyKey: string;
}

export interface EmailProvider {
  readonly name: string;
  send(email: OutgoingEmail): Promise<{ providerId?: string }>;
}

/** Development provider: prints a short summary, never the full body. */
class LogProvider implements EmailProvider {
  readonly name = "log";
  async send(email: OutgoingEmail) {
    console.info(
      `[email:log] to=${email.to.length} recipient(s) subject="${email.subject}" key=${email.idempotencyKey}` +
        ` (EMAIL_PROVIDER=log: not actually sent)`,
    );
    return { providerId: `log-${email.idempotencyKey}` };
  }
}

class SmtpProvider implements EmailProvider {
  readonly name = "smtp";
  private transport;
  constructor(private env: AppEnv) {
    this.transport = nodemailer.createTransport({
      host: env.SMTP_HOST,
      port: env.SMTP_PORT,
      secure: env.SMTP_SECURE,
      auth: env.SMTP_USER ? { user: env.SMTP_USER, pass: env.SMTP_PASSWORD } : undefined,
    });
  }
  async send(email: OutgoingEmail) {
    const info = await this.transport.sendMail({
      from: this.env.EMAIL_FROM,
      to: email.to,
      replyTo: email.replyTo ?? undefined,
      subject: email.subject,
      text: email.text,
      html: email.html,
      headers: { "X-Entity-Ref-ID": email.idempotencyKey },
    });
    return { providerId: info.messageId };
  }
}

class ResendProvider implements EmailProvider {
  readonly name = "resend";
  constructor(private env: AppEnv) {}
  async send(email: OutgoingEmail) {
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.env.RESEND_API_KEY}`,
        "Content-Type": "application/json",
        // Resend drops repeated sends with the same key for 24h.
        "Idempotency-Key": email.idempotencyKey.slice(0, 256),
      },
      body: JSON.stringify({
        from: this.env.EMAIL_FROM,
        to: email.to,
        reply_to: email.replyTo ?? undefined,
        subject: email.subject,
        text: email.text,
        html: email.html,
      }),
    });
    if (!response.ok) {
      throw new Error(`Resend responded ${response.status}: ${(await response.text()).slice(0, 300)}`);
    }
    const json = (await response.json()) as { id?: string };
    return { providerId: json.id };
  }
}

let override: EmailProvider | null = null;

/** Test hook: replace the provider (pass null to restore). */
export function setEmailProviderForTesting(provider: EmailProvider | null) {
  override = provider;
}

export function getEmailProvider(): EmailProvider {
  if (override) return override;
  const env = getEnv();
  switch (env.EMAIL_PROVIDER) {
    case "smtp":
      if (!env.SMTP_HOST) throw new Error("EMAIL_PROVIDER=smtp requires SMTP_HOST");
      return new SmtpProvider(env);
    case "resend":
      if (!env.RESEND_API_KEY) throw new Error("EMAIL_PROVIDER=resend requires RESEND_API_KEY");
      return new ResendProvider(env);
    default:
      return new LogProvider();
  }
}

export function emailProviderStatus(): { provider: string; configured: boolean; message: string } {
  const env = getEnv();
  if (env.EMAIL_PROVIDER === "log") {
    return {
      provider: "log",
      configured: false,
      message: "Development mode: emails are logged to the server console and not delivered. Set EMAIL_PROVIDER to smtp or resend.",
    };
  }
  try {
    getEmailProvider();
    return { provider: env.EMAIL_PROVIDER, configured: true, message: `Emails are delivered via ${env.EMAIL_PROVIDER}.` };
  } catch (error) {
    return { provider: env.EMAIL_PROVIDER, configured: false, message: (error as Error).message };
  }
}
