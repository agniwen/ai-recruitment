import { factory } from "@arc/ai-recruitment-copilot-backend/server/factory";
import { requirePermission } from "@arc/ai-recruitment-copilot-backend/server/middlewares/permission";
import { resolveResumeVisibilityScope } from "@arc/ai-recruitment-copilot-backend/server/access/resume-visibility";
import { loadResumeDetail } from "../../dao/resumes";
import { loadResumeProtectionDetails } from "../../dao/protection";
import { resumeProtectionContinueRouter } from "./continue-route";

export const resumeProtectionRouter = factory
  .createApp()
  .use("*", requirePermission("resumeLibrary", "read"))
  .route("/continue", resumeProtectionContinueRouter)
  .get("/", async (c) => {
    const { activeOrg, user, member } = c.var;
    if (!activeOrg || !user) {
      return c.json({ error: "Unauthorized" }, 401);
    }
    const id = c.req.param("id");
    if (!id) {
      return c.json({ error: "记录不存在。" }, 404);
    }
    const scope = await resolveResumeVisibilityScope({
      currentRole: member?.role,
      organizationId: activeOrg.id,
      userId: user.id,
    });
    if (!(await loadResumeDetail(id, activeOrg.id, scope))) {
      return c.json({ error: "记录不存在。" }, 404);
    }
    const details = await loadResumeProtectionDetails(id, activeOrg.id);
    if (!details) {
      return c.json({ error: "保护信息不存在。" }, 404);
    }
    return c.json(details, 200);
  });
