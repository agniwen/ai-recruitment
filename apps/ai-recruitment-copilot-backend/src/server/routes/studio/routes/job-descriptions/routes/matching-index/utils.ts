import { QdrantClient } from "@qdrant/js-client-rest";
import { isResumeSemanticIndexEnabled } from "@arc/ai-recruitment-copilot-backend/lib/server/resume-semantic/embedding";
import { getResumeSemanticIndexConfig } from "@arc/ai-recruitment-copilot-backend/lib/server/resume-semantic/indexer";
import { QdrantResumeVectorStore } from "@arc/ai-recruitment-copilot-backend/lib/server/qdrant/resume-vector-store";
import { enqueueResumeSemanticIndexJobs } from "@arc/resume-parse-queue/resume-semantic-index";
import { isResumeParseQueueConfigured } from "@arc/resume-parse-queue/resume-parse";
import type { JobMatchingIndexStatus } from "@arc/shared/job-matching-index";
import {
  jobMatchingIndexHash,
  loadJobMatchingIndexRows,
  markJobMatchingEnqueueFailed,
  markJobMatchingIndexesPending,
} from "./dao";

function configurationError() {
  const config = getResumeSemanticIndexConfig();
  if (!isResumeSemanticIndexEnabled()) {
    return "尚未启用岗位向量索引，请配置 RESUME_SEMANTIC_INDEX_ENABLED。";
  }
  if (!config.qdrantUrl || !config.apiKey) {
    return "请先配置 Qdrant 连接和 Embedding 模型凭据。";
  }
  if (!isResumeParseQueueConfigured()) {
    return "后台队列尚未配置，请配置 Redis 并启动 Worker。";
  }
  return null;
}

async function countJobVectorPoints(organizationId: string, sourceIds: string[]) {
  const config = getResumeSemanticIndexConfig();
  const client = new QdrantClient({
    apiKey: config.qdrantApiKey ?? undefined,
    checkCompatibility: false,
    url: config.qdrantUrl,
  });
  const collection = await client.collectionExists(config.qdrantCollectionName);
  if (!collection.exists || !sourceIds.length) {
    return 0;
  }
  const result = await client.count(config.qdrantCollectionName, {
    exact: true,
    filter: {
      must: [
        { key: "organizationId", match: { value: organizationId } },
        { key: "sourceType", match: { value: "job_description" } },
        { key: "sourceId", match: { any: sourceIds } },
        { key: "embeddingVersion", match: { value: config.embeddingVersion } },
        { key: "status", match: { value: "active" } },
      ],
    },
  });
  return result.count;
}

export async function getJobMatchingIndexStatus(
  organizationId: string,
): Promise<JobMatchingIndexStatus> {
  const config = getResumeSemanticIndexConfig();
  const rows = await loadJobMatchingIndexRows(organizationId, config.embeddingVersion);
  const error = configurationError();
  let vectorPoints: number | null = null;
  let vectorError: string | null = null;
  if (config.qdrantUrl) {
    try {
      vectorPoints = await countJobVectorPoints(
        organizationId,
        rows.map((row) => row.job.id),
      );
    } catch {
      vectorError = "无法读取 Qdrant，请检查连接和访问权限。";
    }
  }
  return {
    configurationError: error,
    failed: rows.filter((row) => row.indexStatus === "failed").length,
    indexed: rows.filter(
      (row) => row.indexStatus === "indexed" && row.indexHash === jobMatchingIndexHash(row),
    ).length,
    pending: rows.filter((row) => row.indexStatus === "pending").length,
    profiles: rows.filter((row) => row.profile !== null).length,
    total: rows.length,
    vectorError,
    vectorPoints,
  };
}

export async function startJobMatchingIndexRebuild(organizationId: string) {
  const error = configurationError();
  if (error) {
    throw new Error(error);
  }
  const config = getResumeSemanticIndexConfig();
  const rows = await loadJobMatchingIndexRows(organizationId, config.embeddingVersion);
  if (!rows.length) {
    return { queued: 0 };
  }
  const store = new QdrantResumeVectorStore({
    apiKey: config.qdrantApiKey,
    collectionName: config.qdrantCollectionName,
    dimensions: config.dimensions,
    url: config.qdrantUrl,
  });
  await store.ensureCollection();
  await markJobMatchingIndexesPending(organizationId, rows, config);
  try {
    await enqueueResumeSemanticIndexJobs(
      rows.map((row) => ({
        organizationId,
        rebuildJobMatching: true,
        sourceId: row.job.id,
        sourceType: "job_description" as const,
      })),
    );
  } catch (enqueueError) {
    await markJobMatchingEnqueueFailed(
      organizationId,
      rows.map((row) => row.job.id),
      config.embeddingVersion,
    );
    throw enqueueError;
  }
  return { queued: rows.length };
}
