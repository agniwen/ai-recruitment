import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { factory, jsonValidatorError } from "../../../../../../factory";
import { adminMiddleware } from "../../../../../../middlewares/admin";
import { deleteMediaAsset, listMediaArchives, loadMediaContent, loadMeetingMedia } from "./dao";

const defaults = {
  content: loadMediaContent,
  detail: loadMeetingMedia,
  list: listMediaArchives,
  remove: deleteMediaAsset,
};
const pageSchema = z.coerce.number().int().min(1).max(100_000).default(1);
const listSchema = z.object({ page: pageSchema, search: z.string().trim().max(200).optional() });
const detailSchema = z.object({
  kind: z.enum(["audio", "image"]).optional(),
  page: pageSchema,
  status: z.enum(["ready", "issues", "all"]).default("ready"),
});

export function createInterviewMediaRouter(dependencies = defaults) {
  return factory
    .createApp()
    .use(adminMiddleware)
    .use(async (c, next) => {
      c.header("Cache-Control", "no-store");
      c.header("X-Content-Type-Options", "nosniff");
      await next();
    })
    .get("/", zValidator("query", listSchema, jsonValidatorError("查询参数无效")), async (c) =>
      c.json(await dependencies.list(c.req.valid("query")), 200),
    )
    .get(
      "/meetings/:meetingId",
      zValidator("query", detailSchema, jsonValidatorError("查询参数无效")),
      async (c) =>
        c.json(await dependencies.detail(c.req.param("meetingId"), c.req.valid("query")), 200),
    )
    .get("/assets/:id/content", async (c) => {
      if (!c.var.user) {
        return c.json({ message: "Unauthorized" }, 401);
      }
      try {
        const result = await dependencies.content(c.req.param("id"), c.var.user.id);
        if (!result) {
          return c.json({ message: "文件不存在或已清理" }, 404);
        }
        c.header("Content-Type", result.contentType);
        return c.body(new Uint8Array(result.bytes), 200);
      } catch {
        return c.json({ message: "留底文件暂时无法读取，请稍后重试" }, 503);
      }
    })
    .delete("/assets/:id", async (c) => {
      if (!c.var.user) {
        return c.json({ message: "Unauthorized" }, 401);
      }
      try {
        const result = await dependencies.remove(c.req.param("id"), c.var.user.id);
        if (result === "missing") {
          return c.json({ message: "记录不存在" }, 404);
        }
        if (result === "pending") {
          return c.json({ message: "采集尚未结束，请稍后清理" }, 409);
        }
        return c.json({ success: true }, 200);
      } catch {
        return c.json({ message: "清理失败，文件仍保留，请重试" }, 503);
      }
    });
}
export const interviewMediaRouter = createInterviewMediaRouter();
