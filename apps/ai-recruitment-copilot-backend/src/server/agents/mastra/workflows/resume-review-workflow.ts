import { createStep, createWorkflow } from "@mastra/core/workflows";
import type { WorkflowStreamEvent } from "@mastra/core/stream";
import { z } from "zod";
import { resumeProfileSchema } from "@arc/db-schema/interview/types";
import { resumeReviewSchema } from "@arc/db-schema/resume-review";
import { generateResumeReview } from "../../resume-analysis-review";
import type { ResumeReviewGenerationResult } from "../../resume-analysis-review";
import type { AiRunEvent } from "@arc/shared/ai-run-events";
import { emitMastraWorkflowStreamEvents } from "../adapters/ai-run-stream";

const resumeReviewInputSchema = z.object({
  jobDescription: z.string().nullable().optional(),
  resumeProfile: resumeProfileSchema,
  resumeText: z.string().nullable().optional(),
});
const resumeReviewOutputSchema = z.object({
  review: z.string(),
  screeningResult: z.null(),
  structuredReview: resumeReviewSchema,
});

export function createResumeReviewWorkflow(deps: { generateReview: typeof generateResumeReview }) {
  const reviewStep = createStep({
    execute: async ({ inputData }) => await deps.generateReview(inputData),
    id: "resume-review",
    inputSchema: resumeReviewInputSchema,
    outputSchema: resumeReviewOutputSchema,
  });
  return (
    createWorkflow({
      description: "Generate resume evidence, judgment and numeric scores in one model call.",
      id: "resume-review-workflow",
      inputSchema: resumeReviewInputSchema,
      outputSchema: resumeReviewOutputSchema,
    })
      // oxlint-disable-next-line prefer-await-to-then -- Mastra composes workflow steps with .then().
      .then(reviewStep)
      .commit()
  );
}

export const resumeReviewWorkflow = createResumeReviewWorkflow({
  generateReview: generateResumeReview,
});

export async function runResumeReviewWorkflow(
  input: z.input<typeof resumeReviewInputSchema>,
): Promise<ResumeReviewGenerationResult> {
  const run = await resumeReviewWorkflow.createRun();
  const result = await run.start({ inputData: resumeReviewInputSchema.parse(input) });

  if (result.status === "success") {
    return resumeReviewOutputSchema.parse(result.result) as ResumeReviewGenerationResult;
  }
  if (result.status === "failed") {
    throw result.error;
  }
  throw new Error(`Resume review workflow ended with status ${result.status}.`);
}

export async function streamResumeReviewWorkflow(
  input: z.input<typeof resumeReviewInputSchema>,
  options: { onWorkflowEvent: (event: AiRunEvent) => void },
): Promise<ResumeReviewGenerationResult> {
  const run = await resumeReviewWorkflow.createRun();
  const output = await run.stream({ inputData: resumeReviewInputSchema.parse(input) });
  await emitMastraWorkflowStreamEvents(
    output.fullStream as AsyncIterable<WorkflowStreamEvent>,
    options.onWorkflowEvent,
    {
      stepLabels: {
        "resume-review": "生成简历评价与评分",
      },
      title: "生成简历评价",
      workflowId: "resume-review-workflow",
    },
  );

  const result = await output.result;
  if (result.status === "success") {
    return resumeReviewOutputSchema.parse(result.result) as ResumeReviewGenerationResult;
  }
  if (result.status === "failed") {
    throw result.error;
  }
  throw new Error(`Resume review workflow ended with status ${result.status}.`);
}
