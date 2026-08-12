import { createHash } from "node:crypto";
import path from "node:path";
import { and, eq, inArray } from "drizzle-orm";
import { member, organization, resumeUploadBatchItem, user } from "@arc/db-schema/schema";
import { db } from "@arc/ai-recruitment-copilot-backend/lib/server/db";
import { listStorageObjects } from "@arc/ai-recruitment-copilot-backend/lib/server/s3";
import { insertBatchWithItems } from "@arc/ai-recruitment-copilot-backend/server/routes/studio/routes/resume-upload-batches/dao/batches";

const BATCH_SIZE = 100;

export const LEGACY_RESUME_PREFIXES = [
  "dev/legacy-upload/",
  "dev/legacy-upload2/",
  "dev/legacy-upload3/",
  "dev/legacy-upload4/",
  "dev/legacy-upload5/",
  "dev/legacy-upload6/",
] as const;

const SUPPORTED_EXTENSIONS = new Set([".docx", ".jpeg", ".jpg", ".pdf", ".png", ".ppt", ".pptx"]);

export function isSupportedLegacyResumeKey(key: string): boolean {
  return SUPPORTED_EXTENSIONS.has(path.posix.extname(key).toLowerCase());
}

export function legacyResumeFileName(key: string): string {
  try {
    return decodeURIComponent(path.posix.basename(key));
  } catch {
    return path.posix.basename(key);
  }
}

async function resolveActor(workspaceSlug: string, uploaderEmail: string) {
  const [actor] = await db
    .select({ organizationId: organization.id, userId: user.id })
    .from(organization)
    .innerJoin(member, eq(member.organizationId, organization.id))
    .innerJoin(user, eq(user.id, member.userId))
    .where(and(eq(organization.slug, workspaceSlug), eq(user.email, uploaderEmail)))
    .limit(1);
  if (!actor) {
    throw new Error("LEGACY_PARSE_UPLOADER_EMAIL 必须是目标工作区的成员。");
  }
  return actor;
}

async function discoverLegacyResumeFiles() {
  const files: {
    contentHash: null;
    fileSize: number;
    originalFileName: string;
    sourceFolder: string;
    storageKey: string;
  }[] = [];
  for (const prefix of LEGACY_RESUME_PREFIXES) {
    let continuationToken: string | undefined;
    do {
      const page = await listStorageObjects({ continuationToken, prefix });
      for (const object of page.objects) {
        const originalFileName = legacyResumeFileName(object.key);
        if (isSupportedLegacyResumeKey(originalFileName)) {
          files.push({
            contentHash: null,
            fileSize: object.size,
            originalFileName,
            sourceFolder: prefix,
            storageKey: object.key,
          });
        }
      }
      continuationToken = page.continuationToken ?? undefined;
    } while (continuationToken);
  }
  return files;
}

export interface LegacyResumeImportResult {
  alreadyRegistered: number;
  created: number;
  discovered: number;
}

export async function importLegacyResumes(input: {
  commit: boolean;
  uploaderEmail: string;
  workspaceSlug: string;
}): Promise<LegacyResumeImportResult> {
  const actor = await resolveActor(input.workspaceSlug, input.uploaderEmail);
  const discovered = await discoverLegacyResumeFiles();
  const existing = new Set<string>();
  for (let offset = 0; offset < discovered.length; offset += 500) {
    const keys = discovered.slice(offset, offset + 500).map((file) => file.storageKey);
    const rows = await db
      .select({ storageKey: resumeUploadBatchItem.storageKey })
      .from(resumeUploadBatchItem)
      .where(
        and(
          eq(resumeUploadBatchItem.organizationId, actor.organizationId),
          inArray(resumeUploadBatchItem.storageKey, keys),
        ),
      );
    for (const row of rows) {
      existing.add(row.storageKey);
    }
  }
  const pending = discovered.filter((file) => !existing.has(file.storageKey));
  if (!input.commit) {
    return { alreadyRegistered: existing.size, created: 0, discovered: discovered.length };
  }
  for (let offset = 0; offset < pending.length; offset += BATCH_SIZE) {
    const files = pending.slice(offset, offset + BATCH_SIZE);
    const batchId = createHash("sha256")
      .update(`${actor.organizationId}:${files[0]?.storageKey ?? offset}`)
      .digest("hex")
      .slice(0, 32);
    await insertBatchWithItems({
      batchId,
      dedupPolicy: "create",
      files,
      jdMode: "none",
      jobDescriptionId: null,
      organizationId: actor.organizationId,
      recruitmentSourceDetail: "legacy-upload 历史简历导入",
      resumePoolScope: "public",
      sourceChannel: "historical_import",
      target: "resume_pool",
      userId: actor.userId,
    });
  }
  return {
    alreadyRegistered: existing.size,
    created: pending.length,
    discovered: discovered.length,
  };
}
