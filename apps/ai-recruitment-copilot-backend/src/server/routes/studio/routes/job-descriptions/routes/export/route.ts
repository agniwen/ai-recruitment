import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { listTextFiltersSchema } from "@arc/shared/list-text-filters";
import { factory, jsonValidatorError } from "@arc/ai-recruitment-copilot-backend/server/factory";
import { requirePermission } from "@arc/ai-recruitment-copilot-backend/server/middlewares/permission";
import { queryAllJobDescriptions } from "../../dao";

const jobDescriptionExportQuerySchema = z.object({
  code: z.string().optional(),
  dateField: z.enum(["requestedDate", "expectedOnboardDate"]).optional(),
  dateFrom: z.string().date().optional(),
  dateTo: z.string().date().optional(),
  departmentId: z.string().optional(),
  googleSheetStatus: z.string().optional(),
  hiringUnitId: z.string().optional(),
  interviewerId: z.string().optional(),
  recruitmentStatus: z.string().optional(),
  resumeSourceId: z.string().trim().min(1).optional(),
  search: z.string().optional(),
  sortBy: z.enum(["createdAt", "name", "updatedAt"]).optional(),
  sortOrder: z.enum(["asc", "desc"]).optional(),
  sourceSheet: z.string().optional(),
  textFilters: listTextFiltersSchema("jobs"),
});

export const jobDescriptionExportRouter = factory
  .createApp()
  .use("*", requirePermission("jd", "read"), requirePermission("jd", "export"))
  .get(
    "/",
    zValidator("query", jobDescriptionExportQuerySchema, jsonValidatorError("查询参数无效。")),
    async (c) => {
      const { activeOrg } = c.var;
      if (!activeOrg) {
        return c.json({ message: "Unauthorized" }, 401);
      }
      const q = c.req.valid("query");
      const records = await queryAllJobDescriptions(
        activeOrg.id,
        {
          actorUserId: c.var.user?.id,
          code: q.code,
          dateField: q.dateField,
          dateFrom: q.dateFrom,
          dateTo: q.dateTo,
          departmentId: q.departmentId,
          googleSheetStatus: q.googleSheetStatus,
          hiringUnitId: q.hiringUnitId,
          interviewerId: q.interviewerId,
          recruitmentStatus: q.recruitmentStatus,
          resumeSourceId: q.resumeSourceId,
          search: q.search,
          sourceSheet: q.sourceSheet,
          textFilters: q.textFilters,
        },
        { sortBy: q.sortBy, sortOrder: q.sortOrder },
      );
      return c.json({ records }, 200);
    },
  );
