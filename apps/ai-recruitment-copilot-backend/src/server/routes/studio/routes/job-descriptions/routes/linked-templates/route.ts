import { factory } from "@arc/ai-recruitment-copilot-backend/server/factory";
import { requirePermission } from "@arc/ai-recruitment-copilot-backend/server/middlewares/permission";
import { loadJobDescriptionById } from "../../dao";
import { queryPaginatedCandidateFormTemplates } from "../../../forms/dao/queries";
import { queryPaginatedInterviewQuestionTemplates } from "../../../interview-questions/dao/queries";

export const jobDescriptionLinkedTemplatesRouter = factory
  .createApp()
  .use("*", requirePermission("page", "jobDescriptions"), requirePermission("jd", "read"))
  .get("/", async (c) => {
    const { activeOrg, user } = c.var;
    if (!activeOrg || !user) {
      return c.json({ message: "Unauthorized" }, 401);
    }
    const jobId = c.req.param("id");
    if (!jobId || !(await loadJobDescriptionById(activeOrg.id, jobId, { actorUserId: user.id }))) {
      return c.json({ error: "岗位不存在或无权查看。" }, 404);
    }
    const filters = { archivedFilter: "active" as const, jobDescriptionId: jobId };
    const pagination = { page: "1", pageSize: "100", sortBy: "createdAt", sortOrder: "desc" };
    const [forms, questions] = await Promise.all([
      queryPaginatedCandidateFormTemplates(activeOrg.id, filters, pagination),
      queryPaginatedInterviewQuestionTemplates(activeOrg.id, filters, pagination),
    ]);
    return c.json(
      {
        forms: forms.records.map(({ id, title, description, questionCount }) => ({
          description,
          id,
          questionCount,
          title,
        })),
        interviewQuestions: questions.records.map(({ id, title, description, questionCount }) => ({
          description,
          id,
          questionCount,
          title,
        })),
      },
      200,
    );
  });
