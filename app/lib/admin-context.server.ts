import { authenticate } from "../shopify.server";
import { effectiveTimezone, ensureShop } from "../models/shop.server";

/**
 * Authenticates an embedded-admin request and resolves the shop record. All
 * admin loaders/actions use this so data access is always scoped to the
 * shop in the verified session token.
 */
export async function requireAdmin(request: Request) {
  const context = await authenticate.admin(request);
  const shop = await ensureShop(context.session.shop);
  // `sub` is the Shopify staff user ID from the App Bridge session token.
  const sub = context.sessionToken?.sub;
  const actor = sub ? `staff:${sub}` : "staff";
  return {
    ...context,
    shop,
    settings: shop.settings,
    timeZone: effectiveTimezone(shop, shop.settings),
    actor,
  };
}

export function describeActor(actor: string): string {
  if (actor === "customer") return "Customer";
  if (actor === "system") return "System";
  if (actor.startsWith("staff:")) return `Staff member (ID ${actor.slice(6)})`;
  return "Staff member";
}
