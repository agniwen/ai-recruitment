import { and, eq, sql } from "drizzle-orm";
import { db } from "@arc/ai-recruitment-copilot-backend/lib/server/db";
import { studioInterview } from "@arc/db-schema/schema";
import { parseResumePayloadInput } from "@arc/db-schema/studio-interviews";
import { factory } from "@arc/ai-recruitment-copilot-backend/server/factory";
import { requirePermission } from "@arc/ai-recruitment-copilot-backend/server/middlewares/permission";
import { validateResumeFile } from "@arc/ai-recruitment-copilot-backend/server/agents/resume-analysis-agent";
import { resolveResumeUploadStorage } from "@arc/ai-recruitment-copilot-backend/server/routes/interview/utils";
import { invalidateStudioInterviewCaches } from "@arc/ai-recruitment-copilot-backend/server/cache-tags";
import { findResumeProtectionConflict } from "../../dao/protection";
import { createResumeRecordFromStorage } from "../../utils/create-from-storage";

export const resumeProtectionCheckRouter = factory
  .createApp()
  .use("*", requirePermission("resumeLibrary", "create"))
  .post("/", async (c) => {
    const { activeOrg, user, member } = c.var;
    if (!activeOrg || !user) {
      return c.json({ error: "Unauthorized" }, 401);
    }
    const form = await c.req.formData();
    const file = form.get("resume");
    const payload = parseResumePayloadInput(form.get("resumePayload"));
    if (!(file instanceof File) || !payload?.resumeProfile) {
      return c.json({ error: "缺少候选人资料。" }, 400);
    }
    validateResumeFile(file);
    const stored = await resolveResumeUploadStorage({
      organizationId: activeOrg.id,
      parsedResumePayload: payload,
      resume: file,
      userId: user.id,
    });
    const profile = payload.resumeProfile;
    const result = await db.transaction(async (tx) => {
      await tx.execute(
        sql`select pg_advisory_xact_lock(hashtextextended(${`resume-protection:${activeOrg.id}`}, 0))`,
      );
      const protection = await findResumeProtectionConflict(
        {
          identity: {
            contentHash: stored?.contentHash ?? null,
            email: profile.email,
            name: profile.name,
            phone: profile.phone,
          },
          organizationId: activeOrg.id,
          userId: user.id,
        },
        tx,
      );
      if (!protection) {
        return null;
      }
      // The same file checked repeatedly reuses the blocked upload, rather than
      // producing another candidate whenever the client retries a request.
      const [existing] = await tx
        .select({ id: studioInterview.id })
        .from(studioInterview)
        .where(
          and(
            eq(studioInterview.organizationId, activeOrg.id),
            eq(studioInterview.createdBy, user.id),
            eq(studioInterview.resumeAdmissionStatus, "protected"),
            sql`${studioInterview.resumeProtection}->>'cycleId' = ${protection.cycleId}`,
            eq(studioInterview.resumeContentHash, stored?.contentHash ?? ""),
          ),
        )
        .limit(1);
      const recordId =
        existing?.id ??
        (await createResumeRecordFromStorage(
          {
            candidateEmail: profile.email,
            candidateName: profile.name,
            candidatePhone: profile.phone,
            contentHash: stored?.contentHash ?? null,
            jobDescriptionId: null,
            notes: null,
            organizationId: activeOrg.id,
            recommendationReady: false,
            resumeFileName: file.name,
            resumeProfile: profile,
            resumeText: payload.resumeText,
            storageKey: stored?.storageKey ?? null,
            targetRole: profile.targetRoles[0] ?? null,
            userId: user.id,
            userRole: member?.role,
          },
          tx,
        ));
      return { protection, recordId };
    });
    if (!result) {
      return c.json({ status: "clear" as const }, 200);
    }
    invalidateStudioInterviewCaches(activeOrg.id);
    return c.json(
      {
        message: "该候选人处于推荐保护期，已保留至全部候选人。",
        protection: result.protection,
        recordId: result.recordId,
        status: "protected" as const,
      },
      200,
    );
  });
