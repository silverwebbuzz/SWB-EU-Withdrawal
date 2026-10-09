// Optional order verification. Requires the optional `read_orders` scope
// (orders older than 60 days additionally need `read_all_orders`, which this
// app does not request). Results are only stored for the merchant; nothing
// about the order is ever shown to the customer.
import type { GraphqlClient } from "./shop.server";

export type OrderLookupResult =
  | { status: "VERIFIED"; orderId: string; processedAt: Date }
  | { status: "NOT_FOUND" }
  | { status: "UNVERIFIED"; reason: string };

const ORDER_QUERY = `#graphql
  query FindOrderByName($query: String!) {
    orders(first: 5, query: $query) {
      nodes { id name email processedAt customer { defaultEmailAddress { emailAddress } } }
    }
  }`;

/** Normalises "#1001", "1001" and " #1001 " to "1001". */
export function normaliseOrderName(reference: string): string {
  return reference.trim().replace(/^#/, "").replace(/\s+/g, "");
}

export async function lookupOrder(
  admin: GraphqlClient | undefined,
  grantedScopes: string | null | undefined,
  orderReference: string,
  customerEmail: string,
): Promise<OrderLookupResult> {
  if (!admin) return { status: "UNVERIFIED", reason: "no_session" };
  const scopes = (grantedScopes ?? "").split(",").map((s) => s.trim());
  if (!scopes.includes("read_orders") && !scopes.includes("write_orders")) {
    return { status: "UNVERIFIED", reason: "missing_scope" };
  }
  const name = normaliseOrderName(orderReference);
  if (!/^[A-Za-z0-9_.-]{1,50}$/.test(name)) return { status: "NOT_FOUND" };

  try {
    const response = await admin.graphql(ORDER_QUERY, { variables: { query: `name:${name}` } });
    const json = (await response.json()) as {
      data?: {
        orders?: {
          nodes: {
            id: string;
            name: string;
            email: string | null;
            processedAt: string;
            customer: { defaultEmailAddress: { emailAddress: string | null } | null } | null;
          }[];
        };
      };
      errors?: unknown;
    };
    if (!json.data?.orders) return { status: "UNVERIFIED", reason: "api_error" };
    const email = customerEmail.trim().toLowerCase();
    const match = json.data.orders.nodes.find((o) => {
      const sameName = normaliseOrderName(o.name).toLowerCase() === name.toLowerCase();
      const emails = [o.email, o.customer?.defaultEmailAddress?.emailAddress]
        .filter(Boolean)
        .map((e) => (e as string).toLowerCase());
      return sameName && emails.includes(email);
    });
    return match
      ? { status: "VERIFIED", orderId: match.id, processedAt: new Date(match.processedAt) }
      : { status: "NOT_FOUND" };
  } catch (error) {
    console.error("[order-lookup] Order lookup failed:", (error as Error).message);
    return { status: "UNVERIFIED", reason: "api_error" };
  }
}

const TAGS_ADD = `#graphql
  mutation TagOrder($id: ID!, $tags: [String!]!) {
    tagsAdd(id: $id, tags: $tags) { userErrors { field message } }
  }`;

/** Adds a tag to a verified order. Requires the optional `write_orders` scope. */
export async function tagOrder(admin: GraphqlClient, orderId: string, tag: string): Promise<boolean> {
  const response = await admin.graphql(TAGS_ADD, { variables: { id: orderId, tags: [tag] } });
  const json = (await response.json()) as {
    data?: { tagsAdd?: { userErrors: { message: string }[] } };
  };
  const errors = json.data?.tagsAdd?.userErrors ?? [{ message: "No response" }];
  if (errors.length > 0) {
    console.error("[order-tag] tagsAdd failed:", errors.map((e) => e.message).join("; "));
    return false;
  }
  return true;
}
