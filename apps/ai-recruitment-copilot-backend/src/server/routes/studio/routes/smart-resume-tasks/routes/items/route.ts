import type { Context } from "hono";
import { getObjectStream } from "@arc/ai-recruitment-copilot-backend/lib/server/s3";
import { factory } from "@arc/ai-recruitment-copilot-backend/server/factory";
import type { Env } from "@arc/ai-recruitment-copilot-backend/server/type";
import { loadOwnedTaskItemFile } from "./dao";

async function serveTaskFile(c: Context<Env>, attachmentId?: string) {
  const { activeOrg, user } = c.var;
  if (!activeOrg || !user) {
    return c.json({ error: "Unauthorized" }, 401);
  }
  const file = await loadOwnedTaskItemFile(
    c.req.param("id") ?? "",
    c.req.param("itemId") ?? "",
    activeOrg.id,
    user.id,
    attachmentId,
  );
  if (!file) {
    return c.json({ error: "文件不存在或无权访问。" }, 404);
  }
  const object = await getObjectStream(file.storageKey);
  if (!object) {
    return c.json({ error: "文件已不可用。" }, 404);
  }
  const disposition = c.req.query("download") === "1" ? "attachment" : "inline";
  return new Response(object.body, {
    headers: {
      "Cache-Control": "private, max-age=300",
      "Content-Disposition": `${disposition}; filename*=UTF-8''${encodeURIComponent(file.filename)}`,
      "Content-Type": file.mediaType ?? object.contentType ?? "application/octet-stream",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

export const smartResumeTaskItemsRouter = factory
  .createApp()
  .get("/:itemId/resume", (c) => serveTaskFile(c))
  .get("/:itemId/portfolio/:attachmentId", (c) => serveTaskFile(c, c.req.param("attachmentId")));
