import pLimit from "p-limit";
import { isResumeParseQueueConfigured } from "@arc/resume-parse-queue/resume-parse";
import { retryFailedResumeParse } from "../../resume-upload-batches/utils/retry";
import { listFailedResumePoolItemIds } from "../dao";

export async function retryFailedResumePoolItems(
  input: Parameters<typeof listFailedResumePoolItemIds>[0] & { requestedBy: string },
) {
  if (!isResumeParseQueueConfigured()) {
    throw new Error("简历解析队列未配置 REDIS_URL。");
  }
  const items = await listFailedResumePoolItemIds(input);
  const counts = { failed: 0, queued: 0, skipped: 0, total: items.length };
  const limit = pLimit(4);
  await Promise.all(
    items.map(({ id }) =>
      limit(async () => {
        try {
          const result = await retryFailedResumeParse({
            allowExhaustedRetries: true,
            organizationId: input.organizationId,
            poolItemId: id,
            requestedBy: input.requestedBy,
          });
          if (result.status === "queued") {
            counts.queued += 1;
          } else if (result.status === "queue_unavailable") {
            counts.failed += 1;
          } else {
            counts.skipped += 1;
          }
        } catch (error) {
          counts.failed += 1;
          console.error("[resume-pool] failed to enqueue parse retry", { error, poolItemId: id });
        }
      }),
    ),
  );
  return counts;
}
