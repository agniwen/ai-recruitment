import { and, eq, sql } from "drizzle-orm";
import {
  MAX_PORTFOLIO_ATTACHMENTS,
  portfolioLinksInputSchema,
  portfolioLinkInputSchema,
} from "@arc/shared/bulk-resume-upload";
import { invalidateStudioInterviewCaches } from "@arc/ai-recruitment-copilot-backend/server/cache-tags";
import { db } from "@arc/ai-recruitment-copilot-backend/lib/server/db";
import { getObjectStream } from "@arc/ai-recruitment-copilot-backend/lib/server/s3";
import { chatAttachment, studioInterview } from "@arc/db-schema/schema";
import {
  buildResumeVisibilityCondition,
  resolveResumeVisibilityScope,
} from "@arc/ai-recruitment-copilot-backend/server/access/resume-visibility";
import { zValidator } from "@hono/zod-validator";
import { factory, jsonValidatorError } from "@arc/ai-recruitment-copilot-backend/server/factory";
import { requirePermission } from "@arc/ai-recruitment-copilot-backend/server/middlewares/permission";
import {
  InvalidPortfolioFileError,
  storePortfolioAttachment,
} from "../../utils/portfolio-attachments";

async function loadVisiblePortfolio(
  id: string,
  organizationId: string,
  role: string | null | undefined,
  userId: string,
) {
  const scope = await resolveResumeVisibilityScope({ currentRole: role, organizationId, userId });
  const [row] = await db
    .select({ portfolioAttachments: studioInterview.portfolioAttachments })
    .from(studioInterview)
    .where(
      and(
        eq(studioInterview.id, id),
        eq(studioInterview.organizationId, organizationId),
        buildResumeVisibilityCondition(scope),
      ),
    )
    .limit(1);
  return row ?? null;
}

export const portfolioRouter = factory
  .createApp()
  .post(
    "/links",
    requirePermission("resumeLibrary", "update"),
    zValidator("json", portfolioLinksInputSchema, jsonValidatorError("请输入有效的作品链接")),
    async (c) => {
      const { activeOrg, user } = c.var;
      if (!activeOrg || !user) {
        return c.json({ error: "Unauthorized" }, 401);
      }
      const id = c.req.param("id") ?? "";
      const record = await loadVisiblePortfolio(id, activeOrg.id, c.var.member?.role, user.id);
      if (!record) {
        return c.json({ error: "记录不存在。" }, 404);
      }
      const links = c.req.valid("json").links.map((link) => ({
        ...link,
        id: crypto.randomUUID(),
        kind: "link" as const,
        name: link.name || link.url.slice(0, 500),
      }));
      const [updated] = await db
        .update(studioInterview)
        .set({
          portfolioAttachments: sql`${studioInterview.portfolioAttachments} || ${JSON.stringify(links)}::jsonb`,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(studioInterview.id, id),
            eq(studioInterview.organizationId, activeOrg.id),
            sql`jsonb_array_length(${studioInterview.portfolioAttachments}) + ${links.length} <= ${MAX_PORTFOLIO_ATTACHMENTS}`,
          ),
        )
        .returning({ attachments: studioInterview.portfolioAttachments });
      if (!updated) {
        return c.json({ error: "作品集最多添加 10 项，请移除部分内容后重试。" }, 409);
      }
      invalidateStudioInterviewCaches(activeOrg.id);
      return c.json(updated, 200);
    },
  )
  .patch(
    "/links/:linkId",
    requirePermission("resumeLibrary", "update"),
    zValidator("json", portfolioLinkInputSchema, jsonValidatorError("请输入有效的作品链接")),
    async (c) => {
      const { activeOrg, user } = c.var;
      if (!activeOrg || !user) {
        return c.json({ error: "Unauthorized" }, 401);
      }
      const id = c.req.param("id") ?? "";
      const linkId = c.req.param("linkId");
      const record = await loadVisiblePortfolio(id, activeOrg.id, c.var.member?.role, user.id);
      if (!record?.portfolioAttachments.some((item) => item.id === linkId && "url" in item)) {
        return c.json({ error: "链接不存在。" }, 404);
      }
      const input = c.req.valid("json");
      const link = { ...input, id: linkId, kind: "link", name: input.name || input.url };
      const [updated] = await db
        .update(studioInterview)
        .set({
          portfolioAttachments: sql`(select jsonb_agg(case when item->>'id' = ${linkId} then ${JSON.stringify(link)}::jsonb else item end order by ordinal)
          from jsonb_array_elements(${studioInterview.portfolioAttachments}) with ordinality as entries(item, ordinal))`,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(studioInterview.id, id),
            eq(studioInterview.organizationId, activeOrg.id),
            sql`${studioInterview.portfolioAttachments} @> ${JSON.stringify([{ id: linkId, kind: "link" }])}::jsonb`,
          ),
        )
        .returning({ attachments: studioInterview.portfolioAttachments });
      if (!updated) {
        return c.json({ error: "链接不存在。" }, 404);
      }
      invalidateStudioInterviewCaches(activeOrg.id);
      return c.json(updated, 200);
    },
  )
  .delete("/:attachmentId", requirePermission("resumeLibrary", "update"), async (c) => {
    const { activeOrg, user } = c.var;
    if (!activeOrg || !user) {
      return c.json({ message: "Unauthorized" }, 401);
    }
    const id = c.req.param("id") ?? "";
    const record = await loadVisiblePortfolio(id, activeOrg.id, c.var.member?.role, user.id);
    if (!record) {
      return c.json({ error: "记录不存在。" }, 404);
    }
    const attachmentId = c.req.param("attachmentId");
    const [updated] = await db
      .update(studioInterview)
      .set({
        portfolioAttachments: sql`(select coalesce(jsonb_agg(attachment), '[]'::jsonb)
        from jsonb_array_elements(${studioInterview.portfolioAttachments}) as attachment
        where attachment->>'id' <> ${attachmentId})`,
        updatedAt: new Date(),
      })
      .where(and(eq(studioInterview.id, id), eq(studioInterview.organizationId, activeOrg.id)))
      .returning({ attachments: studioInterview.portfolioAttachments });
    invalidateStudioInterviewCaches(activeOrg.id);
    return c.json({ attachments: updated?.attachments ?? [] }, 200);
  })
  .post("/uploads", requirePermission("resumeLibrary", "update"), async (c) => {
    const { activeOrg, user } = c.var;
    if (!activeOrg || !user) {
      return c.json({ message: "Unauthorized" }, 401);
    }
    const record = await loadVisiblePortfolio(
      c.req.param("id") ?? "",
      activeOrg.id,
      c.var.member?.role,
      user.id,
    );
    if (!record) {
      return c.json({ error: "记录不存在。" }, 404);
    }
    try {
      const formData = await c.req.formData();
      const attachToCandidate = formData.get("attachToCandidate") === "true";
      if (
        attachToCandidate &&
        (record.portfolioAttachments?.length ?? 0) >= MAX_PORTFOLIO_ATTACHMENTS
      ) {
        return c.json({ error: "作品集附件最多上传 10 个。" }, 400);
      }
      const attachment = await storePortfolioAttachment(
        formData.get("file"),
        activeOrg.id,
        user.id,
      );
      if (attachToCandidate) {
        const [updated] = await db
          .update(studioInterview)
          .set({
            portfolioAttachments: sql`coalesce(${studioInterview.portfolioAttachments}, '[]'::jsonb) || ${JSON.stringify([attachment])}::jsonb`,
            updatedAt: new Date(),
          })
          .where(
            and(
              eq(studioInterview.id, c.req.param("id") ?? ""),
              eq(studioInterview.organizationId, activeOrg.id),
              sql`jsonb_array_length(coalesce(${studioInterview.portfolioAttachments}, '[]'::jsonb)) < ${MAX_PORTFOLIO_ATTACHMENTS}`,
            ),
          )
          .returning({ id: studioInterview.id });
        if (!updated) {
          return c.json({ error: "附件未保存，记录已不可用或附件数量已达上限。" }, 409);
        }
        invalidateStudioInterviewCaches(activeOrg.id);
      }
      return c.json(attachment, 201);
    } catch (error) {
      if (error instanceof InvalidPortfolioFileError) {
        return c.json({ error: error.message }, 400);
      }
      return c.json({ error: "作品集上传失败，请稍后重试。" }, 500);
    }
  })
  .get("/:attachmentId", requirePermission("resumeLibrary", "read"), async (c) => {
    const { activeOrg, user } = c.var;
    if (!activeOrg || !user) {
      return c.json({ message: "Unauthorized" }, 401);
    }
    const record = await loadVisiblePortfolio(
      c.req.param("id") ?? "",
      activeOrg.id,
      c.var.member?.role,
      user.id,
    );
    const attachmentId = c.req.param("attachmentId") ?? "";
    if (
      !record?.portfolioAttachments?.some(
        (attachment) => attachment.id === attachmentId && !("url" in attachment),
      )
    ) {
      return c.json({ error: "附件不存在。" }, 404);
    }
    const [row] = await db
      .select({
        filename: chatAttachment.filename,
        mediaType: chatAttachment.mediaType,
        storageKey: chatAttachment.storageKey,
      })
      .from(chatAttachment)
      .where(
        and(eq(chatAttachment.id, attachmentId), eq(chatAttachment.organizationId, activeOrg.id)),
      )
      .limit(1);
    if (!row) {
      return c.json({ error: "附件不存在。" }, 404);
    }
    const object = await getObjectStream(row.storageKey);
    if (!object) {
      return c.json({ error: "附件文件已不可用。" }, 404);
    }
    const disposition = c.req.query("download") === "1" ? "attachment" : "inline";
    return new Response(object.body, {
      headers: {
        "Cache-Control": "private, max-age=300",
        "Content-Disposition": `${disposition}; filename*=UTF-8''${encodeURIComponent(row.filename)}`,
        "Content-Type": row.mediaType,
        "X-Content-Type-Options": "nosniff",
      },
    });
  });
