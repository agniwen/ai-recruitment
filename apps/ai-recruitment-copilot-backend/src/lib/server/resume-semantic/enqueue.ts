import { isResumeSemanticIndexEnabled } from "./embedding";

export async function enqueueResumeSemanticIndexJobBestEffort(
  input: {
    organizationId: string;
    sourceId: string | null | undefined;
    sourceType: "resume_pool_item" | "studio_interview";
  },
  options: { noOpIsSuccess?: boolean } = {},
): Promise<boolean> {
  const noOpResult = options.noOpIsSuccess ?? true;
  if (!(input.sourceId && isResumeSemanticIndexEnabled())) {
    return noOpResult;
  }
  try {
    const { prepareResumeSemanticIndexJob } = await import("./indexer");
    const job = {
      organizationId: input.organizationId,
      sourceId: input.sourceId,
      sourceType: input.sourceType,
    };
    if (!(await prepareResumeSemanticIndexJob(job))) {
      return noOpResult;
    }
    const { enqueueResumeSemanticIndexJobs } =
      await import("@arc/resume-parse-queue/resume-semantic-index");
    await enqueueResumeSemanticIndexJobs([job]);
    return true;
  } catch (error) {
    console.warn("[resume-semantic-index] enqueue failed", {
      error,
      sourceId: input.sourceId,
      sourceType: input.sourceType,
    });
    return false;
  }
}
