import type { Prisma, Shop, ShopSettings } from "@prisma/client";
import prisma from "../db.server";
import { defaultWithdrawalFormSchema } from "../lib/form-schema";
import { DEFAULT_TEMPLATES, type TemplateKind } from "../lib/email-template";
import { isValidTimeZone } from "../lib/timezone";

/** Minimal shape of the Admin GraphQL client we depend on (eases testing). */
export interface GraphqlClient {
  graphql: (query: string, options?: { variables?: Record<string, unknown> }) => Promise<Response>;
}

export type ShopWithSettings = Shop & { settings: ShopSettings };

/**
 * Creates the shop row and its defaults if they do not exist yet. Safe to call
 * on every request; all writes are idempotent.
 */
export async function ensureShop(shopDomain: string): Promise<ShopWithSettings> {
  const shop = await prisma.shop.upsert({
    where: { shopDomain },
    create: { shopDomain, name: shopDomain.replace(/\.myshopify\.com$/, "") },
    update: {},
    include: { settings: true },
  });

  if (shop.settings && shop.uninstalledAt === null) {
    return shop as ShopWithSettings;
  }

  return prisma.$transaction(async (tx) => {
    if (shop.uninstalledAt) {
      await tx.shop.update({ where: { id: shop.id }, data: { uninstalledAt: null, installedAt: new Date() } });
    }
    const settings =
      shop.settings ??
      (await tx.shopSettings.upsert({ where: { shopId: shop.id }, create: { shopId: shop.id }, update: {} }));

    if ((await tx.form.count({ where: { shopId: shop.id } })) === 0) {
      const schema = defaultWithdrawalFormSchema() as unknown as Prisma.InputJsonValue;
      const form = await tx.form.create({ data: { shopId: shop.id, name: "Withdrawal form", draftSchema: schema } });
      const version = await tx.formVersion.create({
        data: { shopId: shop.id, formId: form.id, version: 1, schema },
      });
      await tx.form.update({ where: { id: form.id }, data: { publishedVersionId: version.id } });
      await tx.shopSettings.update({ where: { id: settings.id }, data: { defaultFormId: form.id } });
      settings.defaultFormId = form.id;
    }

    for (const kind of Object.keys(DEFAULT_TEMPLATES) as TemplateKind[]) {
      await tx.emailTemplate.upsert({
        where: { shopId_kind: { shopId: shop.id, kind } },
        create: {
          shopId: shop.id,
          kind,
          subject: DEFAULT_TEMPLATES[kind].subject,
          body: DEFAULT_TEMPLATES[kind].body,
          enabled: kind !== "STATUS_CHANGE",
        },
        update: {},
      });
    }
    const fresh = await tx.shop.findUniqueOrThrow({ where: { id: shop.id }, include: { settings: true } });
    return fresh as ShopWithSettings;
  });
}

const SHOP_QUERY = `#graphql
  query ShopIdentity {
    shop { name email ianaTimezone currencyCode }
  }`;

/** Refreshes shop identity from Shopify. Requires no access scopes. */
export async function syncShopFromShopify(shopDomain: string, admin: GraphqlClient): Promise<void> {
  const shop = await ensureShop(shopDomain);
  try {
    const response = await admin.graphql(SHOP_QUERY);
    const json = (await response.json()) as {
      data?: { shop?: { name: string; email: string; ianaTimezone: string; currencyCode: string } };
    };
    const data = json.data?.shop;
    if (!data) throw new Error("Shop query returned no data");
    await prisma.shop.update({
      where: { id: shop.id },
      data: {
        name: data.name,
        contactEmail: data.email,
        ianaTimezone: isValidTimeZone(data.ianaTimezone) ? data.ianaTimezone : "UTC",
        currencyCode: data.currencyCode,
      },
    });
    // Default the merchant notification recipient to the shop's contact email.
    if (!shop.settings.merchantNotificationEmails && data.email) {
      await prisma.shopSettings.update({
        where: { shopId: shop.id },
        data: { merchantNotificationEmails: data.email },
      });
    }
  } catch (error) {
    // Not fatal for installation; identity is refreshed on the next auth.
    console.error(`[shop] Failed to sync shop identity for ${shopDomain}:`, (error as Error).message);
  }
}

export function effectiveTimezone(shop: Pick<Shop, "ianaTimezone">, settings: Pick<ShopSettings, "timezoneOverride">) {
  const tz = settings.timezoneOverride || shop.ianaTimezone || "UTC";
  return isValidTimeZone(tz) ? tz : "UTC";
}

export function notificationRecipients(settings: Pick<ShopSettings, "merchantNotificationEmails">): string[] {
  return (settings.merchantNotificationEmails ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter((s) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s))
    .slice(0, 10);
}

export async function updateSettings(shopId: string, data: Prisma.ShopSettingsUpdateInput) {
  return prisma.shopSettings.update({ where: { shopId }, data });
}

export async function markUninstalled(shopDomain: string) {
  await prisma.shop.updateMany({ where: { shopDomain }, data: { uninstalledAt: new Date() } });
}
