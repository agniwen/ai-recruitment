import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@arc/ai-recruitment-copilot-backend/lib/server/db";
import type { RecruitingVisibilityScope } from "@arc/ai-recruitment-copilot-backend/server/access/recruiting-visibility";
import type { WorkspaceAuthorizer } from "@arc/ai-recruitment-copilot-backend/server/access/workspace-access-policy";
import { loadResumePoolItem } from "@arc/ai-recruitment-copilot-backend/server/routes/studio/routes/resume-pool/dao";
import { resumePoolItem } from "@arc/db-schema/schema";
import type { ResumePoolDetail } from "@arc/shared/resume-pool";
import { normalizeResumePoolItemId } from "./resume-pool-id";

const resumePoolCitationSchema = z.object({
  id: z.string(),
  label: z.string(),
  recordType: z.literal("resume_pool_item"),
  secondaryLabel: z.string().nullable(),
});

export const resumePoolItemDetailSchema = z.object({
  candidateName: z.string(),
  citation: resumePoolCitationSchema,
  hasAiProfile: z.boolean(),
  id: z.string(),
  jobDescriptionId: z.string().nullable(),
  jobDescriptionName: z.string().nullable(),
  keySkills: z.array(z.string()),
  notes: z.string().nullable(),
  resumeParseStatus: z.string(),
  resumeProfile: z.unknown().nullable(),
  resumeSummary: z.string().nullable(),
  resumeText: z.string().nullable(),
  scope: z.enum(["private", "public"]),
  targetRole: z.string().nullable(),
});

export const getResumePoolDetailInputSchema = z.object({
  id: z.string().min(1),
  includeResumeText: z.boolean().optional(),
});

export const getResumePoolDetailOutputSchema = z.object({
  resumePoolItem: resumePoolItemDetailSchema.nullable(),
});

function cleanString(value: string | null | undefined): string | null {
  const text = value?.trim();
  return text || null;
}

function toResumePoolItemDetail(
  detail: ResumePoolDetail,
  resumeText: string | null,
): z.infer<typeof resumePoolItemDetailSchema> {
  const keySkills = (
    detail.masteredSkills.length > 0 ? detail.masteredSkills : detail.skillsNormalized
  ).slice(0, 8);
  return {
    candidateName: detail.candidateName,
    citation: {
      id: `pool:${detail.id}`,
      label: detail.candidateName,
      recordType: "resume_pool_item",
      secondaryLabel: detail.jobDescriptionName,
    },
    hasAiProfile: detail.resumeProfile !== null,
    id: detail.id,
    jobDescriptionId: detail.jobDescriptionId,
    jobDescriptionName: detail.jobDescriptionName,
    keySkills,
    notes: cleanString(detail.notes),
    resumeParseStatus: detail.resumeParseStatus,
    resumeProfile: detail.resumeProfile,
    resumeSummary: cleanString(detail.notes),
    resumeText,
    scope: detail.scope,
    targetRole: cleanString(detail.targetRole),
  };
}

export async function getResumePoolDetailForCopilot(input: {
  authorize: WorkspaceAuthorizer;
  id: string;
  includeResumeText?: boolean;
  organizationId: string;
  userId: string;
  visibilityScope: RecruitingVisibilityScope;
}): Promise<z.infer<typeof getResumePoolDetailOutputSchema>> {
  const parsed = getResumePoolDetailInputSchema.parse(input);
  const canReadResumePool = await input.authorize({
    action: "read",
    resource: "resumePool",
  });
  if (!canReadResumePool || input.visibilityScope.kind === "none") {
    return { resumePoolItem: null };
  }
  const poolItemId = normalizeResumePoolItemId(parsed.id);
  if (!poolItemId) {
    return { resumePoolItem: null };
  }
  const detail = await loadResumePoolItem({
    organizationId: input.organizationId,
    poolItemId,
    userId: input.userId,
    visibilityScope: input.visibilityScope,
  });
  if (!detail) {
    return { resumePoolItem: null };
  }
  let resumeText: string | null = null;
  if (parsed.includeResumeText) {
    const [row] = await db
      .select({ resumeText: resumePoolItem.resumeText })
      .from(resumePoolItem)
      .where(
        and(
          eq(resumePoolItem.id, detail.id),
          eq(resumePoolItem.organizationId, input.organizationId),
        ),
      )
      .limit(1);
    resumeText = row?.resumeText?.slice(0, 12_000) ?? null;
  }
  return { resumePoolItem: toResumePoolItemDetail(detail, resumeText) };
}
