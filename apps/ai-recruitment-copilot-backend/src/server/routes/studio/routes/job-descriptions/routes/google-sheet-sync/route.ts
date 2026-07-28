import { createInternalErrorResponse } from "@arc/ai-recruitment-copilot-backend/server/error-handler";
import { factory } from "@arc/ai-recruitment-copilot-backend/server/factory";
import { requirePermission } from "@arc/ai-recruitment-copilot-backend/server/middlewares/permission";
import { safeUpdateTag } from "@arc/ai-recruitment-copilot-backend/server/cache-tags";
import { enqueueJobDescriptionIndexJobBestEffort } from "@arc/ai-recruitment-copilot-backend/lib/server/jd-semantic/enqueue";
import { GoogleSheetsError, readConfiguredGoogleSheetValues } from "./utils/google-sheets-client";
import { GoogleSheetFormatError, syncGoogleSheetJobDescriptions } from "./utils/google-sheets-sync";

export const googleSheetSyncRouter = factory
  .createApp()
  .post(
    "/",
    requirePermission("jd", "create"),
    requirePermission("jd", "update"),
    requirePermission("hiringUnit", "create"),
    requirePermission("department", "create"),
    async (c) => {
      const { activeOrg } = c.var;
      if (!activeOrg) {
        return c.json({ message: "Unauthorized" }, 401);
      }
      try {
        const values = await readConfiguredGoogleSheetValues();
        const { changedJobIds, ...result } = await syncGoogleSheetJobDescriptions({
          actorUserId: c.var.user?.id,
          organizationId: activeOrg.id,
          values,
        });

        if (result.hiringUnitsCreated > 0) {
          safeUpdateTag(`hiring-units:${activeOrg.id}`);
        }
        if (result.departmentsCreated > 0) {
          safeUpdateTag(`departments:${activeOrg.id}`);
        }
        if (changedJobIds.length > 0) {
          safeUpdateTag(`job-descriptions:${activeOrg.id}`);
          await Promise.all(
            changedJobIds.map((jobDescriptionId) =>
              enqueueJobDescriptionIndexJobBestEffort({
                jobDescriptionId,
                organizationId: activeOrg.id,
              }),
            ),
          );
        }

        return c.json(result, 200);
      } catch (error) {
        if (error instanceof GoogleSheetFormatError) {
          return c.json({ error: error.message }, 503);
        }
        if (error instanceof GoogleSheetsError) {
          return c.json({ error: error.message }, error.kind === "configuration" ? 503 : 502);
        }
        return c.json(
          createInternalErrorResponse({
            context: { organizationId: activeOrg.id },
            error,
            operation: "job-description-google-sheet-sync",
            publicMessage: "Google 文档同步失败。",
          }),
          500,
        );
      }
    },
  );
