import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import db from "../db.server";

export const action = async ({ request }: ActionFunctionArgs) => {
  const { payload, session, topic, shop } = await authenticate.webhook(request);
  console.log(`Received ${topic} webhook for ${shop}`);

  const current = Array.isArray(payload.current) ? (payload.current as string[]) : [];
  if (session) {
    await db.session.update({ where: { id: session.id }, data: { scope: current.toString() } });
  }

  // Turn off features whose optional scope was revoked by the merchant.
  const hasRead = current.includes("read_orders") || current.includes("write_orders");
  const hasWrite = current.includes("write_orders");
  const shopRow = await db.shop.findUnique({ where: { shopDomain: shop }, select: { id: true } });
  if (shopRow) {
    await db.shopSettings.updateMany({
      where: { shopId: shopRow.id },
      data: {
        ...(hasRead ? {} : { orderLookupEnabled: false }),
        ...(hasWrite ? {} : { orderTaggingEnabled: false }),
      },
    });
  }
  return new Response();
};
