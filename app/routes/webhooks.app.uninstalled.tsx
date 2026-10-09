import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import db from "../db.server";
import { markUninstalled } from "../models/shop.server";

export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop, session, topic } = await authenticate.webhook(request);

  console.log(`Received ${topic} webhook for ${shop}`);

  // Webhook requests can trigger multiple times and after an app has already been uninstalled.
  // If this webhook already ran, the session may have been deleted previously.
  if (session) {
    await db.session.deleteMany({ where: { shop } });
  }
  // Shop data is kept until Shopify sends shop/redact (48 hours after uninstall),
  // so a quick reinstall does not lose the merchant's requests.
  await markUninstalled(shop);

  return new Response();
};
