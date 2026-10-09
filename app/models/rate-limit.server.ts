import prisma from "../db.server";
import { hashKey } from "../lib/signing.server";

const WINDOW_MS = 60 * 60 * 1000;

/** Extracts the client IP Shopify forwards through the app proxy. */
export function clientIp(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for") ?? "";
  return forwarded.split(",")[0]?.trim() || "unknown";
}

/**
 * Sliding one-hour window. Returns false when `limit` hits already exist for
 * this key. Only an HMAC of shop + IP is persisted, never the IP itself.
 */
export async function consumeRateLimit(
  shopId: string,
  scope: string,
  ip: string,
  limit: number,
  now = new Date(),
): Promise<boolean> {
  if (limit <= 0) return true;
  const keyHash = hashKey(shopId, scope, ip);
  const since = new Date(now.getTime() - WINDOW_MS);
  const count = await prisma.rateLimitHit.count({ where: { keyHash, createdAt: { gte: since } } });
  if (count >= limit) return false;
  await prisma.rateLimitHit.create({ data: { keyHash, createdAt: now } });
  return true;
}

export async function purgeRateLimitHits(olderThanMs = 24 * WINDOW_MS) {
  const { count } = await prisma.rateLimitHit.deleteMany({
    where: { createdAt: { lt: new Date(Date.now() - olderThanMs) } },
  });
  return count;
}
