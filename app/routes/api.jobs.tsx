// Runs background jobs on demand for deployments that disable the in-process
// scheduler (RUN_JOBS_IN_PROCESS=false), e.g. from a cron service:
//   curl -X POST -H "Authorization: Bearer $JOBS_SECRET" https://your-app/api/jobs
import { timingSafeEqual } from "node:crypto";
import type { ActionFunctionArgs } from "react-router";
import { runEmailJob, runMaintenance } from "../jobs.server";

function authorised(request: Request): boolean {
  const secret = process.env.JOBS_SECRET ?? "";
  if (secret.length < 16) return false;
  const given = Buffer.from((request.headers.get("authorization") ?? "").replace(/^Bearer /, ""));
  const expected = Buffer.from(secret);
  return given.length === expected.length && timingSafeEqual(given, expected);
}

export const loader = () => new Response("Method not allowed", { status: 405 });

export const action = async ({ request }: ActionFunctionArgs) => {
  if (request.method !== "POST" || !authorised(request)) return new Response("Unauthorized", { status: 401 });
  await runEmailJob();
  await runMaintenance();
  return Response.json({ ok: true });
};
