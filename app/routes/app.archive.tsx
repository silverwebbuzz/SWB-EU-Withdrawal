import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { requireAdmin } from "../lib/admin-context.server";
import { listRequests, parseFilters } from "../models/request.server";
import { RequestListPage } from "../components/RequestListPage";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { shop, timeZone } = await requireAdmin(request);
  const filters = parseFilters(new URL(request.url).searchParams, true);
  return { ...(await listRequests(shop.id, filters, timeZone)), timeZone };
};

export default function Archive() {
  const data = useLoaderData<typeof loader>();
  return <RequestListPage heading="Archive" archived {...data} />;
}

export const headers: HeadersFunction = (headersArgs) => boundary.headers(headersArgs);
