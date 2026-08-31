import {
  ensureJobDescriptionGoogleSheetSyncJobEnqueued,
  isJobDescriptionGoogleSheetSyncQueueConfigured,
} from "@arc/resume-parse-queue/job-description-google-sheet-sync";
import { isWorkspaceAdministratorRole } from "@arc/shared/permissions";
import { factory } from "@arc/ai-recruitment-copilot-backend/server/factory";
import {
  createOrGetActiveGoogleSheetSyncRun,
  failGoogleSheetSyncRun,
  failStaleGoogleSheetSyncRuns,
  loadLatestGoogleSheetSyncRun,
} from "./dao";

async function ensureSyncJobQueued(runId: string, organizationId: string): Promise<boolean> {
  try {
    await ensureJobDescriptionGoogleSheetSyncJobEnqueued({ runId });
    return true;
  } catch (error) {
    console.error("[job-description-google-sheet-sync] enqueue failed", {
      error,
      organizationId,
      runId,
    });
    await failGoogleSheetSyncRun(runId, "异步同步任务提交失败，请稍后重试。");
    return false;
  }
}

export const googleSheetSyncRouter = factory
  .createApp()
  .use("*", async (c, next) => {
    if (!isWorkspaceAdministratorRole(c.var.member?.role)) {
      return c.json({ message: "Forbidden" }, 403);
    }
    await next();
  })
  .get("/", async (c) => {
    const { activeOrg } = c.var;
    if (!activeOrg) {
      return c.json({ message: "Unauthorized" }, 401);
    }
    // Expire zombies before returning state so the button can leave loading.
    await failStaleGoogleSheetSyncRuns({ organizationId: activeOrg.id });
    const run = await loadLatestGoogleSheetSyncRun(activeOrg.id);
    return c.json({ run }, 200);
  })
  .post("/", async (c) => {
    const { activeOrg } = c.var;
    if (!activeOrg) {
      return c.json({ message: "Unauthorized" }, 401);
    }
    if (!isJobDescriptionGoogleSheetSyncQueueConfigured()) {
      return c.json({ error: "异步同步服务未配置，请先配置 REDIS_URL。" }, 503);
    }

    await failStaleGoogleSheetSyncRuns({ organizationId: activeOrg.id });

    const { run } = await createOrGetActiveGoogleSheetSyncRun({
      organizationId: activeOrg.id,
      requestedBy: c.var.user?.id ?? null,
      requestedByRole: c.var.member?.role ?? null,
    });
    // Always ensure the queue has a job — even when reusing an active DB run
    // (Redis may have lost the original job after a restart / Redis switch).
    const enqueued = await ensureSyncJobQueued(run.id, activeOrg.id);
    if (!enqueued) {
      return c.json({ error: "异步同步任务提交失败，请稍后重试。" }, 503);
    }
    const latest = (await loadLatestGoogleSheetSyncRun(activeOrg.id)) ?? run;
    return c.json(latest, 202);
  });
