import { factory } from "@arc/ai-recruitment-copilot-backend/server/factory";
import { resumeProfileSchema } from "@arc/db-schema/interview/types";
import { findResumeProtectionConflict } from "../../../studio/routes/resumes/dao/protection";
import { loadResumeDetail } from "../../../studio/routes/resumes/dao/resumes";
import { resolveResumeVisibilityScope } from "@arc/ai-recruitment-copilot-backend/server/access/resume-visibility";

export const requireResumeAnalysisAdmission = factory.createMiddleware(async (c, next) => {
  if (c.req.method !== "POST") {
    return next();
  }
  const { activeOrg, user } = c.var;
  if (!activeOrg || !user) {
    return c.json({ error: "请在工作区内处理简历。" }, 403);
  }
  const body: unknown = await c.req.json().catch(() => null);
  if (!body || typeof body !== "object") {
    return next();
  }
  const { resumeProfile, interviewRecordId } = body as {
    resumeProfile?: unknown;
    interviewRecordId?: unknown;
  };
  const parsed = resumeProfileSchema.safeParse(resumeProfile);
  if (!parsed.success) {
    return next();
  }
  if (typeof interviewRecordId === "string") {
    const scope = await resolveResumeVisibilityScope({
      currentRole: c.var.member?.role,
      organizationId: activeOrg.id,
      userId: user.id,
    });
    const record = await loadResumeDetail(interviewRecordId, activeOrg.id, scope);
    if (!record || record.resumeAdmissionStatus !== "accepted") {
      return c.json({ error: "该候选人暂不能继续推荐，请查看保护详情。" }, 409);
    }
    const existing = resumeProfileSchema.safeParse(record.resumeProfile);
    if (!existing.success || JSON.stringify(existing.data) !== JSON.stringify(parsed.data)) {
      return c.json({ error: "候选人资料已发生变化，请刷新后重试。" }, 409);
    }
    // Reviewing an authorized existing recommendation does not constitute a
    // new recommendation by the reviewer or interviewer.
    return next();
  }
  const protection = await findResumeProtectionConflict({
    identity: {
      contentHash: null,
      email: parsed.data.email,
      name: parsed.data.name,
      phone: parsed.data.phone,
    },
    organizationId: activeOrg.id,
    userId: user.id,
  });
  if (protection) {
    return c.json({ error: "该候选人处于推荐保护期，暂不能继续推荐。", protection }, 409);
  }
  return next();
});
