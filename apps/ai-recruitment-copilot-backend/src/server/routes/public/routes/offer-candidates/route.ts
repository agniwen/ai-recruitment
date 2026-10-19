import { factory } from "@arc/ai-recruitment-copilot-backend/server/factory";
import { getObjectStream } from "@arc/ai-recruitment-copilot-backend/lib/server/s3";
import { loadOfferCandidatePreview } from "./dao";

const unavailable = { error: "候选人详情链接已失效或不可用，请联系招聘负责人。" };
const inlineMediaTypes = new Map([
  ["gif", "image/gif"],
  ["jpeg", "image/jpeg"],
  ["jpg", "image/jpeg"],
  ["pdf", "application/pdf"],
  ["png", "image/png"],
  ["webp", "image/webp"],
]);

export const offerCandidatesRouter = factory
  .createApp()
  .use("*", async (c, next) => {
    c.header("Cache-Control", "no-store");
    c.header("Referrer-Policy", "no-referrer");
    c.header("X-Robots-Tag", "noindex, nofollow");
    c.header("X-Content-Type-Options", "nosniff");
    await next();
  })
  .get("/", async (c) => {
    const result = await loadOfferCandidatePreview(c.req.param("token") ?? "");
    return result ? c.json(result.preview, 200) : c.json(unavailable, 404);
  })
  .get("/resume", async (c) => {
    const result = await loadOfferCandidatePreview(c.req.param("token") ?? "");
    if (!result?.resumeStorageKey) {
      return c.json(unavailable, 404);
    }
    const object = await getObjectStream(result.resumeStorageKey);
    if (!object) {
      return c.json(unavailable, 404);
    }
    const fileName = result.preview.candidate.resumeFileName || "resume";
    const extension = fileName.split(".").at(-1)?.toLowerCase() ?? "";
    const inlineMediaType = inlineMediaTypes.get(extension);
    c.header("Content-Type", inlineMediaType || "application/octet-stream");
    c.header("Content-Security-Policy", "sandbox");
    const filename = encodeURIComponent(fileName);
    c.header(
      "Content-Disposition",
      `${inlineMediaType ? "inline" : "attachment"}; filename="${filename}"; filename*=UTF-8''${filename}`,
    );
    if (object.contentLength !== undefined) {
      c.header("Content-Length", String(object.contentLength));
    }
    return c.newResponse(object.body);
  });
