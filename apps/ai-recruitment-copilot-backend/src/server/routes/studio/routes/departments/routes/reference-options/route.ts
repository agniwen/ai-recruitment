import { factory } from "@arc/ai-recruitment-copilot-backend/server/factory";
import { requirePermission } from "@arc/ai-recruitment-copilot-backend/server/middlewares/permission";
import { listSelectableHiringUnits } from "../../../hiring-units/dao";

export const departmentReferenceOptionsRouter = factory
  .createApp()
  .use("*", requirePermission("page", "departments"), requirePermission("department", "read"))
  .get("/", async (c) => {
    const { activeOrg, user } = c.var;
    if (!activeOrg || !user) {
      return c.json({ message: "Unauthorized" }, 401);
    }
    const units = await listSelectableHiringUnits({
      actorUserId: user.id,
      organizationId: activeOrg.id,
    });
    return c.json({ records: units.map(({ id, name }) => ({ id, name })) }, 200);
  });
