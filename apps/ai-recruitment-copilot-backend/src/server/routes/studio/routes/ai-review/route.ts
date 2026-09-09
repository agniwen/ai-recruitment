import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { factory, jsonValidatorError } from "@arc/ai-recruitment-copilot-backend/server/factory";
import { requirePermission } from "@arc/ai-recruitment-copilot-backend/server/middlewares/permission";
import { resolveResumeVisibilityScope } from "@arc/ai-recruitment-copilot-backend/server/access/resume-visibility";
import { createRequestWorkspaceAuthorizer } from "@arc/ai-recruitment-copilot-backend/server/access/workspace-access-policy";
import { loadResumeDetail, queryPaginatedResumeRecords } from "../resumes/dao/resumes";
import { canApproveCandidateAiReview } from "../interviews/dao/ai-review-approval";
import { transitionCandidateStage } from "../interviews/utils/candidate-stage-transition";

const querySchema = z.object({
  candidateName: z.string().trim().max(120).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

export const aiReviewRouter = factory
  .createApp()
  .use("*", requirePermission("page", "aiReview"), requirePermission("aiReview", "read"))
  .get("/", zValidator("query", querySchema, jsonValidatorError("查询参数无效。")), async (c) => {
    const { activeOrg, user, member } = c.var;
    if (!activeOrg || !user) {
      return c.json({ message: "Unauthorized" }, 401);
    }
    const scope = await resolveResumeVisibilityScope({
      currentRole: member?.role,
      organizationId: activeOrg.id,
      userId: user.id,
    });
    const query = c.req.valid("query");
    const result = await queryPaginatedResumeRecords(
      activeOrg.id,
      {
        candidateName: query.candidateName,
        outcomes: ["in_pipeline"],
        pipelineStages: ["ai_review"],
      },
      { page: query.page, pageSize: query.pageSize, sortBy: "createdAt", sortOrder: "asc" },
      scope,
    );
    return c.json(result, 200);
  })
  .get("/:id", async (c) => {
    const { activeOrg, user, member } = c.var;
    if (!activeOrg || !user) {
      return c.json({ message: "Unauthorized" }, 401);
    }
    const scope = await resolveResumeVisibilityScope({
      currentRole: member?.role,
      organizationId: activeOrg.id,
      userId: user.id,
    });
    const record = await loadResumeDetail(c.req.param("id"), activeOrg.id, scope);
    if (!record || record.pipelineStage !== "ai_review") {
      return c.json({ error: "待审批简历不存在或已处理。" }, 404);
    }
    return c.json(
      {
        ...record,
        canApproveAiReview: await canApproveCandidateAiReview({
          jobDescriptionId: record.jobDescriptionId,
          organizationId: activeOrg.id,
          userId: user.id,
        }),
      },
      200,
    );
  })
  .post(
    "/:id/approve",
    zValidator(
      "json",
      z.object({
        approvalNote: z
          .string()
          .trim()
          .min(1, "请填写审批说明")
          .max(2000, "审批说明不能超过 2000 字"),
      }),
      jsonValidatorError("请填写有效的审批说明。"),
    ),
    async (c) => {
      const { activeOrg, user, member } = c.var;
      if (!activeOrg || !user) {
        return c.json({ message: "Unauthorized" }, 401);
      }
      const scope = await resolveResumeVisibilityScope({
        currentRole: member?.role,
        organizationId: activeOrg.id,
        userId: user.id,
      });
      const record = await loadResumeDetail(c.req.param("id"), activeOrg.id, scope);
      if (!record || record.pipelineStage !== "ai_review") {
        return c.json({ error: "待审批简历不存在或已处理。" }, 404);
      }
      const result = await transitionCandidateStage({
        authorize: createRequestWorkspaceAuthorizer({
          memberRole: member?.role,
          organizationId: activeOrg.id,
          userId: user.id,
        }),
        candidateId: record.id,
        input: { approvalNote: c.req.valid("json").approvalNote, pipelineStage: "screening" },
        operatorId: user.id,
        operatorRole: member?.role,
        organizationId: activeOrg.id,
        provenance: { kind: "manual" },
      });
      if (result.kind === "forbidden") {
        return c.json({ error: "仅负责该简历来源且具有 AI 评价审批权限的 ODC 可以审批。" }, 403);
      }
      if (result.kind === "not_found") {
        return c.json({ error: "待审批简历不存在。" }, 404);
      }
      if (result.kind === "invalid") {
        return c.json({ error: result.message }, 409);
      }
      return c.json({ ok: true }, 200);
    },
  );
