/* oxlint-disable max-lines -- recruiting copilot search/detail/proposal tools stay co-located. */
import { createTool } from "@mastra/core/tools";
import { and, eq, inArray, ne } from "drizzle-orm";
import { z } from "zod";
import { db } from "@arc/ai-recruitment-copilot-backend/lib/server/db";
import type { RecruitingVisibilityScope } from "@arc/ai-recruitment-copilot-backend/server/access/recruiting-visibility";
import type { WorkspaceAuthorizer } from "@arc/ai-recruitment-copilot-backend/server/access/workspace-access-policy";
import { QdrantResumeVectorStore } from "@arc/ai-recruitment-copilot-backend/lib/server/qdrant/resume-vector-store";
import {
  embedResumeSemanticTexts,
  getResumeEmbeddingConfig,
  isResumeSemanticIndexEnabled,
} from "@arc/ai-recruitment-copilot-backend/lib/server/resume-semantic/embedding";
import { getResumeSemanticIndexConfig } from "@arc/ai-recruitment-copilot-backend/lib/server/resume-semantic/indexer";
import type { ResumeSemanticTextChunk } from "@arc/ai-recruitment-copilot-backend/lib/server/resume-semantic/text-builders";
import type {
  ResumeVectorSearchResult,
  ResumeVectorStore,
} from "@arc/ai-recruitment-copilot-backend/lib/server/resume-semantic/vector-store";
import {
  listResumeRecords,
  loadResumeDetail,
} from "@arc/ai-recruitment-copilot-backend/server/routes/studio/routes/resumes/dao/resumes";
import {
  listAllJobDescriptions,
  loadJobDescriptionById,
} from "@arc/ai-recruitment-copilot-backend/server/routes/studio/routes/job-descriptions/dao";
import { loadResumePoolItem } from "@arc/ai-recruitment-copilot-backend/server/routes/studio/routes/resume-pool/dao";
import { upsertConversationContextJobBinding } from "@arc/ai-recruitment-copilot-backend/server/routes/chat/dao/chat";
import type { ChatContextBindings } from "@arc/db-schema/chat-context-bindings";
import { EMPTY_CHAT_CONTEXT_BINDINGS } from "@arc/db-schema/chat-context-bindings";
import { resumeReviewLooseSchema } from "@arc/db-schema/resume-review";
import { jobDescription, studioInterview } from "@arc/db-schema/schema";
import type { ResumeLibraryListRecord } from "@arc/shared/studio-resumes";
import type { JobDescriptionRecord } from "@arc/shared/job-descriptions";
import {
  getResumePoolDetailForCopilot,
  getResumePoolDetailInputSchema,
  getResumePoolDetailOutputSchema,
} from "./resume-pool";
import { resolveConversationJobOverlay } from "./conversation-job-overlay";
import { normalizeResumePoolItemId } from "./resume-pool-id";

export { normalizeResumePoolItemId } from "./resume-pool-id";
export {
  getResumePoolDetailForCopilot,
  getResumePoolDetailInputSchema,
  getResumePoolDetailOutputSchema,
  resumePoolItemDetailSchema,
} from "./resume-pool";

const MAX_SEARCH_LIMIT = 10;
const MAX_COMPARISON_CANDIDATES = 5;

export const copilotCitationSchema = z.object({
  id: z.string(),
  label: z.string(),
  recordType: z.enum(["job_description", "resume_pool_item", "resume_record"]),
  secondaryLabel: z.string().nullable(),
});

export const candidateSummaryCardSchema = z.object({
  candidateName: z.string(),
  hasResumeFile: z.boolean(),
  id: z.string(),
  jobDescriptionId: z.string().nullable(),
  jobDescriptionName: z.string().nullable(),
  keySkills: z.array(z.string()),
  notes: z.string().nullable(),
  pipelineStage: z.string(),
  resumeFileName: z.string().nullable(),
  resumeSummary: z.string().nullable(),
  targetRole: z.string().nullable(),
  updatedAt: z.string(),
  workYears: z.number().nullable(),
});

export const resumeRecordDetailSchema = z.object({
  candidateName: z.string(),
  citation: copilotCitationSchema,
  id: z.string(),
  interviewQuestions: z.array(z.unknown()),
  jobDescriptionId: z.string().nullable(),
  jobDescriptionName: z.string().nullable(),
  notes: z.string().nullable(),
  pipelineStage: z.string(),
  resumeProfile: z.unknown().nullable(),
  resumeReview: resumeReviewLooseSchema.nullable(),
  resumeSummary: z.string().nullable(),
  resumeText: z.string().nullable(),
  targetRole: z.string().nullable(),
});

export const jobDescriptionSummarySchema = z.object({
  code: z.string().nullable(),
  departmentName: z.string().nullable(),
  description: z.string().nullable(),
  id: z.string(),
  name: z.string(),
  prompt: z.string(),
});

export const recruitingActionProposalSchema = z.object({
  explanation: z.string(),
  id: z.string(),
  payload: z.record(z.string(), z.unknown()),
  title: z.string(),
  type: z.enum([
    "bind_candidate_to_job",
    "bind_pool_item_to_job",
    "advance_candidate_stage",
    "generate_interview_questions",
  ]),
});

export const recruitingActionConfirmationSchema = z.object({
  confirmedAt: z.string(),
  jobDescriptionId: z.string().optional(),
  jobDescriptionName: z.string().nullable().optional(),
  status: z.enum(["confirmed", "ignored"]),
});

export const searchResumeRecordsInputSchema = z.object({
  jobDescriptionId: z.string().min(1).optional(),
  limit: z.number().int().min(1).max(MAX_SEARCH_LIMIT).optional(),
  pipelineStages: z.array(z.string().min(1)).max(10).optional(),
  query: z.string().trim().max(120).optional(),
  skills: z.array(z.string().min(1)).max(20).optional(),
});

export const searchResumeRecordsOutputSchema = z.object({
  candidateSummaryCards: z.array(candidateSummaryCardSchema),
  citations: z.array(copilotCitationSchema),
  retrievalMode: z.enum(["combined", "semantic", "structured", "structured_text"]),
  semanticHitCount: z.number().int().nonnegative(),
  total: z.number().int().nonnegative(),
});

export const getResumeRecordDetailInputSchema = z.object({
  id: z.string().min(1),
  includeResumeText: z.boolean().optional(),
});

export const getResumeRecordDetailOutputSchema = z.object({
  resumeRecord: resumeRecordDetailSchema.nullable(),
});

export const searchJobDescriptionsInputSchema = z.object({
  limit: z.number().int().min(1).max(MAX_SEARCH_LIMIT).optional(),
  query: z.string().trim().max(120).optional(),
});

export const searchJobDescriptionsOutputSchema = z.object({
  citations: z.array(copilotCitationSchema),
  jobDescriptions: z.array(jobDescriptionSummarySchema),
});

export const getJobDescriptionDetailInputSchema = z.object({
  id: z.string().min(1),
});

export const proposeRecruitingActionInputSchema = z.object({
  explanation: z.string().trim().min(1).max(600),
  payload: z.record(z.string(), z.unknown()),
  title: z.string().trim().min(1).max(120),
  type: recruitingActionProposalSchema.shape.type,
});

export const proposeRecruitingActionOutputSchema = z.object({
  confirmation: recruitingActionConfirmationSchema.optional(),
  proposal: recruitingActionProposalSchema,
});

export interface SearchResumeRecordsDeps {
  listResumeRecords: typeof listResumeRecords;
  semanticSearch?: typeof searchSemanticResumeRecords;
}

export function capCandidateComparisonIds(ids: string[]) {
  return {
    ids: ids.slice(0, MAX_COMPARISON_CANDIDATES),
    truncated: ids.length > MAX_COMPARISON_CANDIDATES,
  };
}

function cleanString(value: string | null | undefined): string | null {
  const text = value?.trim();
  return text || null;
}

function readResumeReviewConclusion(value: unknown): string | null {
  if (!(typeof value === "object" && value !== null && "overall" in value)) {
    return null;
  }
  const { overall } = value;
  if (!(typeof overall === "object" && overall !== null && "conclusion" in overall)) {
    return null;
  }
  return typeof overall.conclusion === "string" ? cleanString(overall.conclusion) : null;
}

function serializeDate(value: string | Date): string {
  return value instanceof Date ? value.toISOString() : value;
}

function toCandidateSummaryCard(record: ResumeLibraryListRecord) {
  return {
    candidateName: record.candidateName,
    hasResumeFile: record.hasResumeFile,
    id: record.id,
    jobDescriptionId: record.jobDescriptionId,
    jobDescriptionName: record.jobDescriptionName,
    keySkills: record.resumeSkills.slice(0, 8),
    notes: cleanString(record.notes),
    pipelineStage: record.pipelineStage,
    resumeFileName: record.resumeFileName,
    resumeSummary: cleanString(record.resumeSummary),
    targetRole: cleanString(record.targetRole),
    updatedAt: serializeDate(record.updatedAt),
    workYears: null,
  };
}

function mergeCandidateSummaryCards(
  primary: z.infer<typeof candidateSummaryCardSchema>[],
  secondary: z.infer<typeof candidateSummaryCardSchema>[],
) {
  const seen = new Set<string>();
  const merged: z.infer<typeof candidateSummaryCardSchema>[] = [];
  for (const card of [...primary, ...secondary]) {
    if (seen.has(card.id)) {
      continue;
    }
    seen.add(card.id);
    merged.push(card);
  }
  return merged;
}

function resolveRetrievalMode({
  hasQuery,
  semanticCount,
  structuredCount,
}: {
  hasQuery: boolean;
  semanticCount: number;
  structuredCount: number;
}): z.infer<typeof searchResumeRecordsOutputSchema>["retrievalMode"] {
  if (semanticCount > 0) {
    return structuredCount > 0 ? "combined" : "semantic";
  }
  return hasQuery ? "structured_text" : "structured";
}

function toResumeCitation(record: ResumeLibraryListRecord) {
  return {
    id: record.id,
    label: record.candidateName,
    recordType: "resume_record" as const,
    secondaryLabel: record.jobDescriptionName,
  };
}

export async function searchResumeRecordsForCopilot(
  input: z.infer<typeof searchResumeRecordsInputSchema> & {
    organizationId: string;
    visibilityScope: RecruitingVisibilityScope;
  },
  deps?: SearchResumeRecordsDeps,
): Promise<z.infer<typeof searchResumeRecordsOutputSchema>> {
  const parsed = searchResumeRecordsInputSchema.parse(input);
  const resumeRecordsDeps = deps ?? { listResumeRecords };
  const limit = parsed.limit ?? 5;
  const result = await resumeRecordsDeps.listResumeRecords(
    input.organizationId,
    {
      jobDescriptionIds: parsed.jobDescriptionId ? [parsed.jobDescriptionId] : null,
      pipelineStages: parsed.pipelineStages ?? null,
      search: parsed.query ?? null,
      skills: parsed.skills ?? null,
    },
    {
      page: 1,
      pageSize: limit,
      sortBy: "updatedAt",
      sortOrder: "desc",
    },
    input.visibilityScope,
  );
  const semanticCards = parsed.query
    ? // oxlint-disable-next-line no-use-before-define -- Default dependency is declared below the public tool entrypoint.
      await (resumeRecordsDeps.semanticSearch ?? searchSemanticResumeRecords)({
        jobDescriptionId: parsed.jobDescriptionId,
        limit,
        organizationId: input.organizationId,
        pipelineStages: parsed.pipelineStages,
        query: parsed.query,
        skills: parsed.skills,
        visibilityScope: input.visibilityScope,
      })
    : [];
  const candidateSummaryCards = mergeCandidateSummaryCards(
    result.records.map(toCandidateSummaryCard),
    semanticCards,
  ).slice(0, limit);
  // oxlint-disable-next-line no-use-before-define -- Helper is kept below the main flow for readability.
  const citations = mergeCitations([
    ...result.records.map(toResumeCitation),
    ...semanticCards.map((card) => ({
      id: card.id,
      label: card.candidateName,
      recordType: "resume_record" as const,
      secondaryLabel: card.jobDescriptionName,
    })),
  ]);
  return {
    candidateSummaryCards,
    citations,
    retrievalMode: resolveRetrievalMode({
      hasQuery: Boolean(parsed.query),
      semanticCount: semanticCards.length,
      structuredCount: result.records.length,
    }),
    semanticHitCount: semanticCards.length,
    total: result.total,
  };
}

function mergeCitations(citations: z.infer<typeof copilotCitationSchema>[]) {
  const seen = new Set<string>();
  const merged: z.infer<typeof copilotCitationSchema>[] = [];
  for (const citation of citations) {
    const key = `${citation.recordType}:${citation.id}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    merged.push(citation);
  }
  return merged;
}

function buildQueryChunks(query: string): ResumeSemanticTextChunk[] {
  return [
    { chunkType: "resume_overview", text: query },
    { chunkType: "skill_role", text: query },
    { chunkType: "work_project", text: query },
  ];
}

function createSemanticSearchDeps() {
  const embeddingConfig = getResumeEmbeddingConfig();
  const semanticConfig = getResumeSemanticIndexConfig();
  return {
    embed: embedResumeSemanticTexts,
    embeddingConfig,
    enabled:
      isResumeSemanticIndexEnabled() &&
      Boolean(semanticConfig.qdrantUrl) &&
      Boolean(embeddingConfig.apiKey),
    vectorStore: new QdrantResumeVectorStore({
      apiKey: semanticConfig.qdrantApiKey,
      collectionName: semanticConfig.qdrantCollectionName,
      dimensions: semanticConfig.dimensions,
      url: semanticConfig.qdrantUrl || "http://127.0.0.1:6333",
    }) satisfies ResumeVectorStore,
  };
}

function mergeSemanticSourceIds(results: ResumeVectorSearchResult[]) {
  const scores = new Map<string, number>();
  for (const result of results) {
    if (result.sourceType !== "studio_interview") {
      continue;
    }
    scores.set(result.sourceId, Math.max(scores.get(result.sourceId) ?? 0, result.score));
  }
  return [...scores.entries()].toSorted((a, b) => b[1] - a[1]).map(([id]) => id);
}

function matchesSemanticFilters(
  record: z.infer<typeof candidateSummaryCardSchema>,
  filters: {
    jobDescriptionId?: string;
    pipelineStages?: string[];
    skills?: string[];
  },
) {
  if (filters.jobDescriptionId && record.jobDescriptionId !== filters.jobDescriptionId) {
    return false;
  }
  if (filters.pipelineStages?.length && !filters.pipelineStages.includes(record.pipelineStage)) {
    return false;
  }
  if (filters.skills?.length) {
    const normalized = new Set(record.keySkills.map((skill) => skill.trim().toLowerCase()));
    return filters.skills.every((skill) => normalized.has(skill.trim().toLowerCase()));
  }
  return true;
}

async function loadSemanticCandidateCards({
  ids,
  organizationId,
  visibilityScope,
}: {
  ids: string[];
  organizationId: string;
  visibilityScope: RecruitingVisibilityScope;
}) {
  if (ids.length === 0 || visibilityScope.kind === "none") {
    return [];
  }
  const visibilityCondition =
    visibilityScope.kind === "restricted"
      ? inArray(studioInterview.createdBy, visibilityScope.userIds)
      : undefined;
  const rows = await db
    .select({
      candidateName: studioInterview.candidateName,
      id: studioInterview.id,
      jobDescriptionId: studioInterview.jobDescriptionId,
      jobDescriptionName: jobDescription.name,
      notes: studioInterview.notes,
      pipelineStage: studioInterview.pipelineStage,
      resumeFileName: studioInterview.resumeFileName,
      resumeProfile: studioInterview.resumeProfile,
      resumeReview: studioInterview.resumeReview,
      resumeStorageKey: studioInterview.resumeStorageKey,
      skills: studioInterview.skillsNormalized,
      targetRole: studioInterview.targetRole,
      updatedAt: studioInterview.updatedAt,
    })
    .from(studioInterview)
    .leftJoin(
      jobDescription,
      and(
        eq(studioInterview.jobDescriptionId, jobDescription.id),
        eq(jobDescription.organizationId, studioInterview.organizationId),
      ),
    )
    .where(
      and(
        eq(studioInterview.organizationId, organizationId),
        inArray(studioInterview.id, ids),
        ne(studioInterview.pipelineStage, "closed"),
        visibilityCondition,
      ),
    );
  const byId = new Map(rows.map((row) => [row.id, row]));
  return ids.flatMap((id) => {
    const row = byId.get(id);
    if (!row) {
      return [];
    }
    return [
      {
        candidateName: row.candidateName,
        hasResumeFile: Boolean(row.resumeStorageKey),
        id: row.id,
        jobDescriptionId: row.jobDescriptionId,
        jobDescriptionName: row.jobDescriptionName,
        keySkills: row.skills.slice(0, 8),
        notes: cleanString(row.notes),
        pipelineStage: row.pipelineStage,
        resumeFileName: row.resumeFileName,
        resumeSummary: readResumeReviewConclusion(row.resumeReview) ?? cleanString(row.notes),
        targetRole: cleanString(row.targetRole),
        updatedAt: serializeDate(row.updatedAt),
        workYears:
          row.resumeProfile && typeof row.resumeProfile.workYears === "number"
            ? row.resumeProfile.workYears
            : null,
      },
    ];
  });
}

export async function searchSemanticResumeRecords(input: {
  jobDescriptionId?: string;
  limit: number;
  organizationId: string;
  pipelineStages?: string[];
  query: string;
  skills?: string[];
  visibilityScope: RecruitingVisibilityScope;
}): Promise<z.infer<typeof candidateSummaryCardSchema>[]> {
  const deps = createSemanticSearchDeps();
  if (!deps.enabled) {
    return [];
  }
  try {
    const embedded = await deps.embed({
      ...deps.embeddingConfig,
      chunks: buildQueryChunks(input.query),
    });
    await deps.vectorStore.ensureCollection();
    const resultGroups = await Promise.all(
      embedded.map((chunk) =>
        deps.vectorStore.searchSimilarResumes({
          chunkType: chunk.chunkType,
          embedding: chunk.embedding,
          limit: Math.max(input.limit * 4, 20),
          organizationId: input.organizationId,
          sourceTypes: ["studio_interview"],
        }),
      ),
    );
    const ids = mergeSemanticSourceIds(resultGroups.flat()).slice(0, Math.max(input.limit * 3, 10));
    const cards = await loadSemanticCandidateCards({
      ids,
      organizationId: input.organizationId,
      visibilityScope: input.visibilityScope,
    });
    return cards
      .filter((record) =>
        matchesSemanticFilters(record, {
          jobDescriptionId: input.jobDescriptionId,
          pipelineStages: input.pipelineStages,
          skills: input.skills,
        }),
      )
      .slice(0, input.limit);
  } catch (error) {
    console.warn("[recruiting-copilot] semantic resume search failed", error);
    return [];
  }
}

export function buildConversationBindProposalId(
  kind: "resume_pool_item" | "resume_record",
  recordId: string,
) {
  return `conversation-bind:${kind}:${recordId}`;
}

function resolveRecruitingActionProposalId(
  input: z.infer<typeof proposeRecruitingActionInputSchema>,
): string {
  if (input.type === "bind_candidate_to_job") {
    const resumeRecordId =
      typeof input.payload.resumeRecordId === "string" ? input.payload.resumeRecordId : null;
    if (resumeRecordId) {
      return buildConversationBindProposalId("resume_record", resumeRecordId);
    }
  }
  if (input.type === "bind_pool_item_to_job") {
    const rawPoolItemId =
      typeof input.payload.poolItemId === "string" ? input.payload.poolItemId : null;
    const poolItemId = rawPoolItemId ? normalizeResumePoolItemId(rawPoolItemId) : null;
    if (poolItemId) {
      return buildConversationBindProposalId("resume_pool_item", poolItemId);
    }
  }
  return crypto.randomUUID();
}

export function createRecruitingActionProposal(
  input: z.infer<typeof proposeRecruitingActionInputSchema> & { id?: string },
): z.infer<typeof proposeRecruitingActionOutputSchema> {
  const parsed = proposeRecruitingActionInputSchema.parse(input);
  return {
    proposal: {
      ...parsed,
      id: input.id ?? resolveRecruitingActionProposalId(parsed),
    },
  };
}

function confirmedConversationBindResult(input: {
  extraPayload?: Record<string, unknown>;
  jobDescriptionId: string;
  jobDescriptionName: string;
  proposal: z.infer<typeof recruitingActionProposalSchema>;
}): z.infer<typeof proposeRecruitingActionOutputSchema> {
  const { jobDescriptionId, jobDescriptionName, proposal } = input;
  return {
    confirmation: {
      confirmedAt: new Date().toISOString(),
      jobDescriptionId,
      jobDescriptionName,
      status: "confirmed",
    },
    proposal: {
      ...proposal,
      explanation: `用户已确认：本对话分析岗位为「${jobDescriptionName}」（jobDescriptionId=${jobDescriptionId}）。请立即基于该岗位继续匹配/分析；不要再说未绑定岗位，也不要再次调用 propose_recruiting_action。`,
      payload: {
        ...proposal.payload,
        ...input.extraPayload,
        jobDescriptionId,
      },
      title: `已关联「${jobDescriptionName}」`,
    },
  };
}

async function resolvePriorRecruitingActionConfirmation(input: {
  actorUserId: string;
  organizationId: string;
  priorConfirmation: z.infer<typeof recruitingActionConfirmationSchema> | undefined;
  proposal: z.infer<typeof recruitingActionProposalSchema>;
}): Promise<z.infer<typeof proposeRecruitingActionOutputSchema> | null> {
  const { priorConfirmation, proposal } = input;
  if (priorConfirmation?.status === "confirmed" && priorConfirmation.jobDescriptionId) {
    const selectedJobDescription = await loadJobDescriptionById(
      input.organizationId,
      priorConfirmation.jobDescriptionId,
      { actorUserId: input.actorUserId },
    );
    if (!selectedJobDescription) {
      return null;
    }
    const name = priorConfirmation.jobDescriptionName?.trim() || selectedJobDescription.name;
    return confirmedConversationBindResult({
      jobDescriptionId: priorConfirmation.jobDescriptionId,
      jobDescriptionName: name,
      proposal,
    });
  }
  if (priorConfirmation?.status === "ignored") {
    return {
      confirmation: priorConfirmation,
      proposal: {
        ...proposal,
        explanation:
          "用户已忽略本对话岗位关联建议。请在不绑定岗位的前提下继续回答（可说明信息有限）。",
        title: "已忽略岗位关联",
      },
    };
  }
  return null;
}

async function assertConversationJobBindingPermission(input: {
  authorize: WorkspaceAuthorizer;
  proposalType: "bind_candidate_to_job" | "bind_pool_item_to_job";
}) {
  const permissionResults =
    input.proposalType === "bind_pool_item_to_job"
      ? await Promise.all([
          input.authorize({ action: "import", resource: "resumePool" }),
          input.authorize({ action: "read", resource: "jd" }),
        ])
      : await Promise.all([
          input.authorize({ action: "update", resource: "resumeLibrary" }),
          input.authorize({ action: "read", resource: "jd" }),
        ]);
  if (!permissionResults.every(Boolean)) {
    throw new Error("没有权限在本对话中关联该候选人与岗位。");
  }
}

async function executeCandidateBindProposal(input: {
  actorUserId: string;
  contextBindings: ChatContextBindings;
  conversationId: string;
  created: z.infer<typeof proposeRecruitingActionOutputSchema>;
  organizationId: string;
  payloadJobDescriptionId: string | null;
  visibilityScope: RecruitingVisibilityScope;
}): Promise<z.infer<typeof proposeRecruitingActionOutputSchema>> {
  const { created } = input;
  const { proposal } = created;
  const resumeRecordId =
    typeof proposal.payload.resumeRecordId === "string" ? proposal.payload.resumeRecordId : null;
  if (!resumeRecordId) {
    return created;
  }
  const boundFromConversation = input.contextBindings.resume_record?.[resumeRecordId];
  const jobDescriptionId = boundFromConversation ?? input.payloadJobDescriptionId;
  if (!jobDescriptionId) {
    return created;
  }
  const nextJobDescription = await loadJobDescriptionById(input.organizationId, jobDescriptionId, {
    actorUserId: input.actorUserId,
  });
  if (!nextJobDescription) {
    return created;
  }
  if (boundFromConversation !== jobDescriptionId) {
    const existing = await loadResumeDetail(
      resumeRecordId,
      input.organizationId,
      input.visibilityScope,
    );
    if (!existing) {
      return created;
    }
    await upsertConversationContextJobBinding({
      conversationId: input.conversationId,
      jobDescriptionId,
      jobDescriptionName: nextJobDescription.name,
      kind: "resume_record",
      organizationId: input.organizationId,
      recordId: resumeRecordId,
      summaryText: `已在本对话中将该候选人关联到「${nextJobDescription.name}」（仅影响本轮分析，未改招聘台数据）。`,
    });
  }
  return confirmedConversationBindResult({
    jobDescriptionId,
    jobDescriptionName: nextJobDescription.name,
    proposal,
  });
}

async function executePoolBindProposal(input: {
  actorUserId: string;
  contextBindings: ChatContextBindings;
  conversationId: string;
  created: z.infer<typeof proposeRecruitingActionOutputSchema>;
  organizationId: string;
  payloadJobDescriptionId: string | null;
  visibilityScope: RecruitingVisibilityScope;
}): Promise<z.infer<typeof proposeRecruitingActionOutputSchema>> {
  const { created } = input;
  const { proposal } = created;
  const rawPoolItemId =
    typeof proposal.payload.poolItemId === "string" ? proposal.payload.poolItemId : null;
  const poolItemId = rawPoolItemId ? normalizeResumePoolItemId(rawPoolItemId) : null;
  if (!poolItemId) {
    return created;
  }
  const boundFromConversation = input.contextBindings.resume_pool_item?.[poolItemId];
  const jobDescriptionId = boundFromConversation ?? input.payloadJobDescriptionId;
  if (!jobDescriptionId) {
    return created;
  }
  const nextJobDescription = await loadJobDescriptionById(input.organizationId, jobDescriptionId, {
    actorUserId: input.actorUserId,
  });
  if (!nextJobDescription) {
    return created;
  }
  if (boundFromConversation !== jobDescriptionId) {
    const existing = await loadResumePoolItem({
      organizationId: input.organizationId,
      poolItemId,
      userId: input.actorUserId,
      visibilityScope: input.visibilityScope,
    });
    if (!existing) {
      return created;
    }
    await upsertConversationContextJobBinding({
      conversationId: input.conversationId,
      jobDescriptionId,
      jobDescriptionName: nextJobDescription.name,
      kind: "resume_pool_item",
      organizationId: input.organizationId,
      recordId: poolItemId,
      summaryText: `已在本对话中将该简历池条目关联到「${nextJobDescription.name}」（仅影响本轮分析，未改简历池数据）。`,
    });
  }
  return confirmedConversationBindResult({
    extraPayload: { poolItemId },
    jobDescriptionId,
    jobDescriptionName: nextJobDescription.name,
    proposal,
  });
}

async function executeProposeRecruitingAction(input: {
  actorUserId: string;
  authorize: WorkspaceAuthorizer;
  conversationId?: string | null;
  contextBindings: ChatContextBindings;
  organizationId: string;
  proposalInput: z.infer<typeof proposeRecruitingActionInputSchema>;
  visibilityScope: RecruitingVisibilityScope;
}): Promise<z.infer<typeof proposeRecruitingActionOutputSchema>> {
  const created = createRecruitingActionProposal(input.proposalInput);
  const { proposal } = created;
  if (proposal.type !== "bind_candidate_to_job" && proposal.type !== "bind_pool_item_to_job") {
    return created;
  }
  if (!input.conversationId) {
    return created;
  }
  await assertConversationJobBindingPermission({
    authorize: input.authorize,
    proposalType: proposal.type,
  });
  const priorConfirmation = input.contextBindings.actionConfirmations?.[proposal.id];
  const confirmedProposal = await resolvePriorRecruitingActionConfirmation({
    actorUserId: input.actorUserId,
    organizationId: input.organizationId,
    priorConfirmation,
    proposal,
  });
  if (confirmedProposal) {
    return confirmedProposal;
  }

  const payloadJobDescriptionId =
    typeof proposal.payload.jobDescriptionId === "string" &&
    proposal.payload.jobDescriptionId.length > 0
      ? proposal.payload.jobDescriptionId
      : null;

  if (proposal.type === "bind_candidate_to_job") {
    return executeCandidateBindProposal({
      actorUserId: input.actorUserId,
      contextBindings: input.contextBindings,
      conversationId: input.conversationId,
      created,
      organizationId: input.organizationId,
      payloadJobDescriptionId,
      visibilityScope: input.visibilityScope,
    });
  }
  return executePoolBindProposal({
    actorUserId: input.actorUserId,
    contextBindings: input.contextBindings,
    conversationId: input.conversationId,
    created,
    organizationId: input.organizationId,
    payloadJobDescriptionId,
    visibilityScope: input.visibilityScope,
  });
}

export async function getResumeRecordDetailForCopilot(input: {
  actorUserId: string;
  contextBindings?: ChatContextBindings;
  id: string;
  includeResumeText?: boolean;
  organizationId: string;
  visibilityScope: RecruitingVisibilityScope;
}): Promise<z.infer<typeof getResumeRecordDetailOutputSchema>> {
  const parsed = getResumeRecordDetailInputSchema.parse(input);
  if (input.visibilityScope.kind === "none") {
    return { resumeRecord: null };
  }
  const visibilityCondition =
    input.visibilityScope.kind === "restricted"
      ? inArray(studioInterview.createdBy, input.visibilityScope.userIds)
      : undefined;
  const [record] = await db
    .select({
      candidateName: studioInterview.candidateName,
      id: studioInterview.id,
      interviewQuestions: studioInterview.interviewQuestions,
      jobDescriptionId: studioInterview.jobDescriptionId,
      jobDescriptionName: jobDescription.name,
      notes: studioInterview.notes,
      pipelineStage: studioInterview.pipelineStage,
      resumeProfile: studioInterview.resumeProfile,
      resumeReview: studioInterview.resumeReview,
      resumeText: studioInterview.resumeText,
      targetRole: studioInterview.targetRole,
    })
    .from(studioInterview)
    .leftJoin(
      jobDescription,
      and(
        eq(studioInterview.jobDescriptionId, jobDescription.id),
        eq(jobDescription.organizationId, studioInterview.organizationId),
      ),
    )
    .where(
      and(
        eq(studioInterview.id, parsed.id),
        eq(studioInterview.organizationId, input.organizationId),
        visibilityCondition,
      ),
    )
    .limit(1);
  if (!record) {
    return { resumeRecord: null };
  }
  const jobBinding = await resolveConversationJobOverlay({
    actorUserId: input.actorUserId,
    boundJobDescriptionId: input.contextBindings?.resume_record?.[record.id],
    jobDescriptionId: record.jobDescriptionId,
    jobDescriptionName: record.jobDescriptionName,
    organizationId: input.organizationId,
  });
  return {
    resumeRecord: {
      candidateName: record.candidateName,
      citation: {
        id: record.id,
        label: record.candidateName,
        recordType: "resume_record",
        secondaryLabel: jobBinding.jobDescriptionName,
      },
      id: record.id,
      interviewQuestions: record.interviewQuestions ?? [],
      jobDescriptionId: jobBinding.jobDescriptionId,
      jobDescriptionName: jobBinding.jobDescriptionName,
      notes: cleanString(record.notes),
      pipelineStage: record.pipelineStage,
      resumeProfile: record.resumeProfile,
      resumeReview: record.resumeReview,
      resumeSummary: readResumeReviewConclusion(record.resumeReview) ?? cleanString(record.notes),
      resumeText: parsed.includeResumeText ? (record.resumeText?.slice(0, 12_000) ?? null) : null,
      targetRole: cleanString(record.targetRole),
    },
  };
}

function readDepartmentName(record: JobDescriptionRecord): string | null {
  return "departmentName" in record && typeof record.departmentName === "string"
    ? record.departmentName
    : null;
}

function toJobDescriptionSummary(record: JobDescriptionRecord) {
  return {
    code: record.code,
    departmentName: readDepartmentName(record),
    description: cleanString(record.description),
    id: record.id,
    name: record.name,
    prompt: record.prompt,
  };
}

function toJobDescriptionCitation(record: JobDescriptionRecord) {
  return {
    id: record.id,
    label: record.name,
    recordType: "job_description" as const,
    secondaryLabel: readDepartmentName(record),
  };
}

export async function searchJobDescriptionsForCopilot(
  input: z.infer<typeof searchJobDescriptionsInputSchema> & {
    actorUserId: string;
    organizationId: string;
  },
): Promise<z.infer<typeof searchJobDescriptionsOutputSchema>> {
  const parsed = searchJobDescriptionsInputSchema.parse(input);
  const all = await listAllJobDescriptions(input.organizationId, {
    actorUserId: input.actorUserId,
  });
  const query = parsed.query?.toLowerCase();
  const filtered = query
    ? all.filter((record) =>
        [record.name, record.description, record.prompt, record.departmentName]
          .filter((value): value is string => typeof value === "string")
          .some((value) => value.toLowerCase().includes(query)),
      )
    : all;
  const records = filtered.slice(0, parsed.limit ?? 5);
  return {
    citations: records.map(toJobDescriptionCitation),
    jobDescriptions: records.map(toJobDescriptionSummary),
  };
}

export function createRecruitingCopilotTools({
  authorize,
  contextBindings = EMPTY_CHAT_CONTEXT_BINDINGS,
  conversationId,
  organizationId,
  userId,
  visibilityScope,
}: {
  authorize: WorkspaceAuthorizer;
  contextBindings?: ChatContextBindings;
  conversationId?: string | null;
  organizationId: string;
  userId: string;
  visibilityScope: RecruitingVisibilityScope;
}) {
  return {
    get_job_description_detail: createTool({
      description: "读取当前 workspace 中某个岗位的完整岗位描述，用于解释岗位匹配。",
      execute: async ({ id }: z.infer<typeof getJobDescriptionDetailInputSchema>) => {
        const canReadJobDescription = await authorize({ action: "read", resource: "jd" });
        if (!canReadJobDescription) {
          return { citation: null, jobDescription: null };
        }
        const record = await loadJobDescriptionById(organizationId, id, {
          actorUserId: userId,
        });
        return record
          ? {
              citation: toJobDescriptionCitation(record),
              jobDescription: toJobDescriptionSummary(record),
            }
          : { citation: null, jobDescription: null };
      },
      id: "get_job_description_detail",
      inputSchema: getJobDescriptionDetailInputSchema,
    }),
    get_resume_pool_detail: createTool({
      description:
        "读取当前 workspace 简历池（resume pool）条目详情。id 可为 uuid 或 pool:uuid。若返回的 jobDescriptionId 为 null：同一轮必须立刻调用 propose_recruiting_action（type=bind_pool_item_to_job，payload.poolItemId=本条目 id），不要先口头询问用户是否要选岗位，也不要在提案前输出匹配/分析正文。",
      execute: (input: z.infer<typeof getResumePoolDetailInputSchema>) =>
        getResumePoolDetailForCopilot({
          ...input,
          authorize,
          contextBindings,
          organizationId,
          userId,
          visibilityScope,
        }),
      id: "get_resume_pool_detail",
      inputSchema: getResumePoolDetailInputSchema,
      outputSchema: getResumePoolDetailOutputSchema,
    }),
    get_resume_record_detail: createTool({
      description:
        "读取当前 workspace 中某个招聘台候选人的简历详情，并返回数据库已有六维评分 resumeReview。若返回的 jobDescriptionId 不为空，必须依据 resumeReview 输出数据库评分，不要自行重算；前端会直接渲染评分卡。若 jobDescriptionId 为 null：同一轮必须立刻调用 propose_recruiting_action（type=bind_candidate_to_job，payload.resumeRecordId=本候选人 id），不要先口头询问用户是否要选岗位，也不要在提案前输出匹配/分析正文。",
      execute: (input: z.infer<typeof getResumeRecordDetailInputSchema>) =>
        getResumeRecordDetailForCopilot({
          ...input,
          actorUserId: userId,
          contextBindings,
          organizationId,
          visibilityScope,
        }),
      id: "get_resume_record_detail",
      inputSchema: getResumeRecordDetailInputSchema,
      outputSchema: getResumeRecordDetailOutputSchema,
    }),
    propose_recruiting_action: createTool({
      description:
        "弹出需要用户批准的动作卡（前端会渲染）。读详情后若 jobDescriptionId 为空，必须主动、立即调用本工具做本对话岗位关联，不要等用户再说「选岗位」。bind_candidate_to_job：payload 含 resumeRecordId，尽量预填推荐 jobDescriptionId；bind_pool_item_to_job：payload 含 poolItemId，尽量预填推荐 jobDescriptionId。若本轮已有 search_job_descriptions 结果，用最相关岗位填 jobDescriptionId；没有也可先提案，由用户在卡片里选择。批准前不要输出分析正文；确认后只写入本对话分析上下文。推进阶段/生成面试题等写操作也用本工具。",
      execute: (input: z.infer<typeof proposeRecruitingActionInputSchema>) =>
        executeProposeRecruitingAction({
          actorUserId: userId,
          authorize,
          contextBindings,
          conversationId,
          organizationId,
          proposalInput: input,
          visibilityScope,
        }),
      id: "propose_recruiting_action",
      inputSchema: proposeRecruitingActionInputSchema,
      outputSchema: proposeRecruitingActionOutputSchema,
      requireApproval: true,
    }),
    search_job_descriptions: createTool({
      description:
        "在当前 workspace 中检索岗位信息，返回可引用的岗位摘要。为未绑定候选人推荐岗位时优先调用；拿到结果后同一轮继续调用 propose_recruiting_action 预填 jobDescriptionId。",
      execute: async (input: z.infer<typeof searchJobDescriptionsInputSchema>) => {
        const canReadJobDescriptions = await authorize({ action: "read", resource: "jd" });
        if (!canReadJobDescriptions) {
          return { citations: [], jobDescriptions: [] };
        }
        return searchJobDescriptionsForCopilot({
          ...input,
          actorUserId: userId,
          organizationId,
        });
      },
      id: "search_job_descriptions",
      inputSchema: searchJobDescriptionsInputSchema,
      outputSchema: searchJobDescriptionsOutputSchema,
    }),
    search_resume_records: createTool({
      description:
        "在当前 workspace 的候选人管理中检索候选人。默认返回候选人摘要卡片，不返回完整简历全文。",
      execute: (input: z.infer<typeof searchResumeRecordsInputSchema>) =>
        searchResumeRecordsForCopilot({ ...input, organizationId, visibilityScope }),
      id: "search_resume_records",
      inputSchema: searchResumeRecordsInputSchema,
      outputSchema: searchResumeRecordsOutputSchema,
    }),
  };
}
