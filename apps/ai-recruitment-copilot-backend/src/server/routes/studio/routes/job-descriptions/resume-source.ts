import { and, asc, eq, inArray } from "drizzle-orm";
import { db } from "@arc/ai-recruitment-copilot-backend/lib/server/db";
import { resumeSource } from "@arc/db-schema/schema";
import { resolveHiringUnitAccessScope } from "../../utils/hiring-unit-scope";

/** Resolve legacy names at the API boundary; persisted permissions use the source ID. */
export async function resolveJobDescriptionResumeSource({
  organizationId,
  actorUserId,
  resumeSourceId,
  sourceSheet,
}: {
  organizationId: string;
  actorUserId?: string | null;
  resumeSourceId?: string | null;
  sourceSheet?: string | null;
}) {
  const name = sourceSheet?.trim();
  if (resumeSourceId === null || (!resumeSourceId && !name)) {
    return { error: null, resumeSourceId: null, sourceSheet: null };
  }
  const [source] = await db
    .select({ id: resumeSource.id, name: resumeSource.name })
    .from(resumeSource)
    .where(
      and(
        eq(resumeSource.organizationId, organizationId),
        resumeSourceId ? eq(resumeSource.id, resumeSourceId) : eq(resumeSource.name, name ?? ""),
      ),
    )
    .orderBy(resumeSource.createdAt, resumeSource.id)
    .limit(1);
  if (!source) {
    return {
      error: "部门/中心（来源）不存在，请选择或新建部门/中心（来源）。",
      resumeSourceId: null,
      sourceSheet: null,
    };
  }
  const scope = await resolveHiringUnitAccessScope({ actorUserId, organizationId });
  if (!scope.canAccessAll && !scope.resumeSourceIds?.includes(source.id)) {
    return {
      error: "所选部门/中心（来源）不在当前可访问范围内。",
      resumeSourceId: null,
      sourceSheet: null,
    };
  }
  return { error: null, resumeSourceId: source.id, sourceSheet: source.name };
}

/** Form options follow the same source scope enforced when saving a job. */
export async function listSelectableResumeSources(input: {
  organizationId: string;
  actorUserId: string;
}) {
  const scope = await resolveHiringUnitAccessScope(input);
  if (!scope.canAccessAll && !scope.resumeSourceIds?.length) {
    return [];
  }
  return db
    .select({ id: resumeSource.id, name: resumeSource.name })
    .from(resumeSource)
    .where(
      and(
        eq(resumeSource.organizationId, input.organizationId),
        scope.canAccessAll ? undefined : inArray(resumeSource.id, scope.resumeSourceIds ?? []),
      ),
    )
    .orderBy(asc(resumeSource.name));
}
