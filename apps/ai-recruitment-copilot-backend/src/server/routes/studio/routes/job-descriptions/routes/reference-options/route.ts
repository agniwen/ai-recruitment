import { factory } from "@arc/ai-recruitment-copilot-backend/server/factory";
import { requirePermission } from "@arc/ai-recruitment-copilot-backend/server/middlewares/permission";
import { listSelectableResumeSources } from "../../resume-source";

export const jobDescriptionReferenceOptionsRouter = factory
  .createApp()
  .use("*", requirePermission("page", "jobDescriptions"), requirePermission("jd", "read"))
  .get("/", async (c) => {
    const { activeOrg, user } = c.var;
    if (!activeOrg || !user) {
      return c.json({ message: "Unauthorized" }, 401);
    }
    const records = await listSelectableResumeSources({
      actorUserId: user.id,
      organizationId: activeOrg.id,
    });
    return c.json({ records }, 200);
  });
