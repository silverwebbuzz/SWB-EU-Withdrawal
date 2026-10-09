// Mandatory privacy compliance webhooks (customers/data_request,
// customers/redact, shop/redact). authenticate.webhook verifies the HMAC
// signature and responds 401 for invalid requests before our code runs.
import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import {
  forgetWebhook,
  handleCustomerDataRequest,
  handleCustomerRedact,
  handleShopRedact,
  markWebhookProcessed,
} from "../models/privacy.server";

const normaliseTopic = (topic: string) => topic.toLowerCase().replace(/_/g, "/").replace("data/request", "data_request");

export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop, topic, payload, webhookId } = await authenticate.webhook(request);
  const normalised = normaliseTopic(String(topic));
  console.log(`Received ${normalised} webhook for ${shop}`);

  // Idempotency: Shopify may retry; process each webhook ID once.
  if (!(await markWebhookProcessed(webhookId, shop, normalised))) return new Response();

  try {
    switch (normalised) {
      case "customers/data_request":
        await handleCustomerDataRequest(shop, payload);
        break;
      case "customers/redact":
        await handleCustomerRedact(shop, payload);
        break;
      case "shop/redact":
        await handleShopRedact(shop);
        break;
      default:
        console.warn(`Unhandled compliance topic ${normalised}`);
    }
  } catch (error) {
    await forgetWebhook(webhookId);
    console.error(`[webhook] ${normalised} failed for ${shop}:`, (error as Error).message);
    // Non-2xx makes Shopify retry the delivery.
    return new Response("Processing failed", { status: 500 });
  }
  return new Response();
};
