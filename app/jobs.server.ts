// Periodic maintenance: email retries, rate-limit cleanup, retention purge.
// Runs in-process by default (RUN_JOBS_IN_PROCESS=true). For multi-instance
// deployments set it to false and call POST /api/jobs from a scheduler
// (see app/routes/api.jobs.tsx).
import prisma from "./db.server";
import { getEnv } from "./lib/env.server";
import { processEmailQueue } from "./models/email.server";
import { purgeRateLimitHits } from "./models/rate-limit.server";
import { purgeArchivedRequests } from "./models/request.server";

const EMAIL_INTERVAL_MS = 60 * 1000;
const MAINTENANCE_INTERVAL_MS = 60 * 60 * 1000;

declare global {
  // eslint-disable-next-line no-var
  var swbJobsStarted: boolean | undefined;
}

export async function runEmailJob() {
  try {
    await processEmailQueue({ limit: 50 });
  } catch (error) {
    console.error("[jobs] Email queue run failed:", (error as Error).message);
  }
}

export async function runMaintenance() {
  try {
    await purgeRateLimitHits();
    await prisma.processedWebhook.deleteMany({
      where: { processedAt: { lt: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) } },
    });
    const shops = await prisma.shopSettings.findMany({
      where: { retentionDays: { gt: 0 } },
      select: { shopId: true, retentionDays: true },
    });
    for (const s of shops) {
      const n = await purgeArchivedRequests(s.shopId, s.retentionDays);
      if (n > 0) console.info(`[jobs] Retention purge removed ${n} archived request(s) for shop ${s.shopId}`);
    }
  } catch (error) {
    console.error("[jobs] Maintenance run failed:", (error as Error).message);
  }
}

export function startBackgroundJobs() {
  if (globalThis.swbJobsStarted) return;
  if (process.env.NODE_ENV === "test" || !getEnv().RUN_JOBS_IN_PROCESS) return;
  globalThis.swbJobsStarted = true;
  setInterval(runEmailJob, EMAIL_INTERVAL_MS).unref();
  setInterval(runMaintenance, MAINTENANCE_INTERVAL_MS).unref();
}
