import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { requireAdmin } from "../lib/admin-context.server";
import { listRequests, parseFilters } from "../models/request.server";
import { RequestListPage } from "../components/RequestListPage";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { shop, timeZone } = await requireAdmin(request);
  const filters = parseFilters(new URL(request.url).searchParams, false);
  return { ...(await listRequests(shop.id, filters, timeZone)), timeZone };
};

export default function Withdrawals() {
  const data = useLoaderData<typeof loader>();
  return <RequestListPage heading="Withdrawals" archived={false} {...data} />;
}

export const headers: HeadersFunction = (headersArgs) => boundary.headers(headersArgs);
