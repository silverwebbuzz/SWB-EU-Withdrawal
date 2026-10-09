// Stateless signed tokens for the two-step storefront flow. App proxies strip
// cookies, so the review step carries its state in an HMAC-signed hidden field.
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { getSigningSecret } from "./env.server";

function hmac(purpose: string, data: string): string {
  return createHmac("sha256", getSigningSecret()).update(`${purpose}:${data}`).digest("base64url");
}

export function signToken<T extends object>(purpose: string, payload: T): string {
  const body = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  return `${body}.${hmac(purpose, body)}`;
}

/** Returns the payload if the signature is valid, otherwise null. */
export function verifyToken<T>(purpose: string, token: string | null | undefined): T | null {
  if (!token || token.length > 100_000) return null;
  const dot = token.lastIndexOf(".");
  if (dot <= 0) return null;
  const body = token.slice(0, dot);
  const given = Buffer.from(token.slice(dot + 1));
  const expected = Buffer.from(hmac(purpose, body));
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
  try {
    return JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as T;
  } catch {
    return null;
  }
}

export function randomNonce(bytes = 16): string {
  return randomBytes(bytes).toString("base64url");
}

/** One-way, keyed hash so rate-limit keys never contain raw IP addresses. */
export function hashKey(...parts: string[]): string {
  return createHmac("sha256", getSigningSecret()).update(parts.join("|")).digest("hex");
}
