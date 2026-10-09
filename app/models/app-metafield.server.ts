// Stores storefront button defaults in an app-owned metafield on the
// AppInstallation. Theme app extensions read it as `app.metafields.swb.button`.
// App-data metafields require no access scopes.
import type { GraphqlClient } from "./shop.server";

const INSTALLATION_QUERY = `#graphql
  query AppInstallationId { currentAppInstallation { id } }`;

const METAFIELDS_SET = `#graphql
  mutation SetAppMetafield($metafields: [MetafieldsSetInput!]!) {
    metafieldsSet(metafields: $metafields) { userErrors { field message } }
  }`;

export interface ButtonConfig {
  label: string;
  help_text: string;
  bg: string;
  fg: string;
}

export async function writeButtonConfig(admin: GraphqlClient, config: ButtonConfig): Promise<string | null> {
  const idResponse = await admin.graphql(INSTALLATION_QUERY);
  const idJson = (await idResponse.json()) as { data?: { currentAppInstallation?: { id: string } } };
  const ownerId = idJson.data?.currentAppInstallation?.id;
  if (!ownerId) return "Could not resolve the app installation.";

  const response = await admin.graphql(METAFIELDS_SET, {
    variables: {
      metafields: [{ ownerId, namespace: "swb", key: "button", type: "json", value: JSON.stringify(config) }],
    },
  });
  const json = (await response.json()) as { data?: { metafieldsSet?: { userErrors: { message: string }[] } } };
  const errors = json.data?.metafieldsSet?.userErrors ?? [];
  return errors.length ? errors.map((e) => e.message).join("; ") : null;
}
