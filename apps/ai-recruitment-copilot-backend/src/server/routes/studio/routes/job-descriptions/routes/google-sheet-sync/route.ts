import {
  enqueueJobDescriptionGoogleSheetSyncJob,
  isJobDescriptionGoogleSheetSyncQueueConfigured,
} from "@arc/resume-parse-queue/job-description-google-sheet-sync";
import { isWorkspaceAdministratorRole } from "@arc/shared/permissions";
import { factory } from "@arc/ai-recruitment-copilot-backend/server/factory";
import {
  createOrGetActiveGoogleSheetSyncRun,
  failGoogleSheetSyncRun,
  loadLatestGoogleSheetSyncRun,
} from "./dao";

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

    const { created, run } = await createOrGetActiveGoogleSheetSyncRun({
      organizationId: activeOrg.id,
      requestedBy: c.var.user?.id ?? null,
    });
    if (created) {
      try {
        await enqueueJobDescriptionGoogleSheetSyncJob({ runId: run.id });
      } catch (error) {
        console.error("[job-description-google-sheet-sync] enqueue failed", {
          error,
          organizationId: activeOrg.id,
          runId: run.id,
        });
        await failGoogleSheetSyncRun(run.id, "异步同步任务提交失败，请稍后重试。");
        return c.json({ error: "异步同步任务提交失败，请稍后重试。" }, 503);
      }
    }
    return c.json(run, 202);
  });
