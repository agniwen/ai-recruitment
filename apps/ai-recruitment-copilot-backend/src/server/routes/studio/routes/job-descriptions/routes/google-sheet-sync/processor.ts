import { enqueueJobDescriptionIndexJobBestEffort } from "@arc/ai-recruitment-copilot-backend/lib/server/jd-semantic/enqueue";
import { safeUpdateTag } from "@arc/ai-recruitment-copilot-backend/server/cache-tags";
import { claimGoogleSheetSyncRun, completeGoogleSheetSyncRun, failGoogleSheetSyncRun } from "./dao";
import { GoogleSheetsError, readConfiguredGoogleSheetValues } from "./utils/google-sheets-client";
import { GoogleSheetFormatError, syncGoogleSheetJobDescriptions } from "./utils/google-sheets-sync";

function publicSyncError(error: unknown): string {
  if (error instanceof GoogleSheetFormatError || error instanceof GoogleSheetsError) {
    return error.message;
  }
  return "Google 文档同步失败。";
}

export async function processGoogleSheetSyncRun({ runId }: { runId: string }): Promise<void> {
  const claimed = await claimGoogleSheetSyncRun(runId);
  if (!claimed) {
    return;
  }

  try {
    const values = await readConfiguredGoogleSheetValues();
    const { changedJobIds, ...result } = await syncGoogleSheetJobDescriptions({
      actorUserId: claimed.requestedBy,
      organizationId: claimed.organizationId,
      values,
    });

    if (result.hiringUnitsCreated > 0) {
      safeUpdateTag(`hiring-units:${claimed.organizationId}`);
    }
    if (result.departmentsCreated > 0) {
      safeUpdateTag(`departments:${claimed.organizationId}`);
    }
    if (changedJobIds.length > 0) {
      safeUpdateTag(`job-descriptions:${claimed.organizationId}`);
      await Promise.all(
        changedJobIds.map((jobDescriptionId) =>
          enqueueJobDescriptionIndexJobBestEffort({
            jobDescriptionId,
            organizationId: claimed.organizationId,
          }),
        ),
      );
    }
    await completeGoogleSheetSyncRun(runId, result);
  } catch (error) {
    await failGoogleSheetSyncRun(runId, publicSyncError(error));
    throw error;
  }
}
