// Centralised, validated access to environment configuration.
import { z } from "zod";

const envSchema = z.object({
  NODE_ENV: z.string().default("development"),
  SHOPIFY_API_SECRET: z.string().default(""),
  SHOPIFY_APP_URL: z.string().default(""),
  APP_SIGNING_SECRET: z.string().default(""),
  EMAIL_PROVIDER: z.enum(["log", "smtp", "resend"]).default("log"),
  EMAIL_FROM: z.string().default("Withdrawals <no-reply@example.com>"),
  SMTP_HOST: z.string().default(""),
  SMTP_PORT: z.coerce.number().int().default(587),
  SMTP_SECURE: z
    .string()
    .default("false")
    .transform((v) => v === "true"),
  SMTP_USER: z.string().default(""),
  SMTP_PASSWORD: z.string().default(""),
  RESEND_API_KEY: z.string().default(""),
  RUN_JOBS_IN_PROCESS: z
    .string()
    .default("true")
    .transform((v) => v !== "false"),
});

export type AppEnv = z.infer<typeof envSchema>;

export function getEnv(): AppEnv {
  return envSchema.parse(process.env);
}

/**
 * Secret used to sign storefront form tokens and to hash client IPs. Falls back
 * to the Shopify API secret so a fresh install works, but production
 * deployments should set a dedicated APP_SIGNING_SECRET.
 */
export function getSigningSecret(): string {
  const env = getEnv();
  const secret = env.APP_SIGNING_SECRET || env.SHOPIFY_API_SECRET;
  if (!secret || secret.length < 16) {
    throw new Error("APP_SIGNING_SECRET (or SHOPIFY_API_SECRET) must be set to at least 16 characters");
  }
  return secret;
}
