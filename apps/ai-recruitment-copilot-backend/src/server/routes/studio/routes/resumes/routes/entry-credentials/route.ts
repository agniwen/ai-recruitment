import { and, eq } from "drizzle-orm";
import { zValidator } from "@hono/zod-validator";
import { candidateEntryCredentialSettingSchema } from "@arc/shared/entry-credentials";
import { db } from "@arc/ai-recruitment-copilot-backend/lib/server/db";
import { studioInterview, user as users } from "@arc/db-schema/schema";
import { factory, jsonValidatorError } from "../../../../../../factory";
import { adminMiddleware } from "../../../../../../middlewares/admin";
import { requirePermission } from "../../../../../../middlewares/permission";
import {
  resolveResumeVisibilityScope,
  buildResumeVisibilityCondition,
} from "../../../../../../access/resume-visibility";
import { recordCandidateActivityInTransaction } from "../../../interviews/utils/candidate-activity";

async function visibleCandidate(
  id: string,
  organizationId: string,
  userId: string,
  role: string | null | undefined,
) {
  const visibility = await resolveResumeVisibilityScope({
    currentRole: role,
    organizationId,
    userId,
  });
  return and(
    eq(studioInterview.id, id),
    eq(studioInterview.organizationId, organizationId),
    buildResumeVisibilityCondition(visibility),
  );
}

export const candidateEntryCredentialRouter = factory
  .createApp()
  .use((c, next) => {
    c.header("Cache-Control", "no-store");
    return next();
  })
  .use(adminMiddleware)
  .get("/", requirePermission("resumeLibrary", "read"), async (c) => {
    const { activeOrg, user, member } = c.var;
    if (!activeOrg || !user) {
      return c.json({ error: "Unauthorized" }, 401);
    }
    const where = await visibleCandidate(
      c.req.param("id") ?? "",
      activeOrg.id,
      user.id,
      member?.role,
    );
    const [row] = await db
      .select({
        enabled: studioInterview.entryCredentialEnabled,
        reason: studioInterview.entryCredentialReason,
        updatedAt: studioInterview.entryCredentialUpdatedAt,
        updatedByName: users.name,
      })
      .from(studioInterview)
      .leftJoin(users, eq(users.id, studioInterview.entryCredentialUpdatedBy))
      .where(where)
      .limit(1);
    if (!row) {
      return c.json({ error: "记录不存在。" }, 404);
    }
    return c.json({ ...row, updatedAt: row.updatedAt?.toISOString() ?? null }, 200);
  })
  .patch(
    "/",
    requirePermission("resumeLibrary", "update"),
    zValidator("json", candidateEntryCredentialSettingSchema, jsonValidatorError("请填写调整原因")),
    async (c) => {
      const { activeOrg, user, member } = c.var;
      if (!activeOrg || !user) {
        return c.json({ error: "Unauthorized" }, 401);
      }
      const id = c.req.param("id") ?? "";
      const where = await visibleCandidate(id, activeOrg.id, user.id, member?.role);
      const input = c.req.valid("json");
      const saved = await db.transaction(async (tx) => {
        const [before] = await tx
          .select({ enabled: studioInterview.entryCredentialEnabled })
          .from(studioInterview)
          .where(where)
          .for("update");
        if (!before) {
          return false;
        }
        await tx
          .update(studioInterview)
          .set({
            entryCredentialEnabled: input.enabled,
            entryCredentialReason: input.reason,
            entryCredentialUpdatedAt: new Date(),
            entryCredentialUpdatedBy: user.id,
          })
          .where(where);
        await recordCandidateActivityInTransaction(tx, {
          action: "candidate_entry_credential_policy_updated",
          detail: { fromEnabled: before.enabled, reason: input.reason, toEnabled: input.enabled },
          interviewRecordId: id,
          operatorId: user.id,
          operatorRole: member?.role,
          organizationId: activeOrg.id,
        });
        return true;
      });
      if (!saved) {
        return c.json({ error: "记录不存在。" }, 404);
      }
      return c.json({ ok: true }, 200);
    },
  );
