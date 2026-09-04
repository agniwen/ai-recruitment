import { and, eq } from "drizzle-orm";
import { buildResumeVisibilityCondition } from "@arc/ai-recruitment-copilot-backend/server/access/resume-visibility";
import type { CompatibleResumeVisibilityScope } from "@arc/ai-recruitment-copilot-backend/server/access/resume-visibility";
import { db } from "@arc/ai-recruitment-copilot-backend/lib/server/db";
import { studioInterview } from "@arc/db-schema/schema";

export async function loadResumeRecordFocus(input: {
  organizationId: string;
  resumeRecordId: string;
  visibilityScope: CompatibleResumeVisibilityScope;
}): Promise<{ id: string } | null> {
  const visibilityCondition = buildResumeVisibilityCondition(input.visibilityScope);
  const [row] = await db
    .select({ id: studioInterview.id })
    .from(studioInterview)
    .where(
      and(
        eq(studioInterview.id, input.resumeRecordId),
        eq(studioInterview.organizationId, input.organizationId),
        visibilityCondition,
      ),
    )
    .limit(1);
  return row ?? null;
}
