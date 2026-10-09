// Downloads the data prepared for a customers/data_request webhook.
import type { LoaderFunctionArgs } from "react-router";
import { requireAdmin } from "../lib/admin-context.server";
import { getPrivacyRequest } from "../models/privacy.server";

export const loader = async ({ request, params }: LoaderFunctionArgs) => {
  const { shop } = await requireAdmin(request);
  const record = await getPrivacyRequest(shop.id, params.id ?? "");
  if (!record) throw new Response("Not found", { status: 404 });
  return Response.json(record.payload, {
    headers: {
      "Content-Disposition": `attachment; filename="data-request-${record.id}.json"`,
      "Cache-Control": "no-store",
    },
  });
};
