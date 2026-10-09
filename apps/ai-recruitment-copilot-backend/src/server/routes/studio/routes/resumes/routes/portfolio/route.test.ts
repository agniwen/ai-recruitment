import { Hono } from "hono";
import { beforeEach, expect, it, vi } from "vitest";
import { portfolioRouter } from "./route";

const mocks = vi.hoisted(() => ({
  invalidate: vi.fn(),
  limit: vi.fn(),
  returning: vi.fn(),
  set: vi.fn(),
  store: vi.fn(),
}));
vi.mock("@arc/ai-recruitment-copilot-backend/lib/server/db", () => ({
  db: {
    select: () => ({ from: () => ({ where: () => ({ limit: mocks.limit }) }) }),
    update: () => ({ set: mocks.set }),
  },
}));
vi.mock("@arc/ai-recruitment-copilot-backend/lib/server/s3", () => ({ getObjectStream: vi.fn() }));
vi.mock("@arc/ai-recruitment-copilot-backend/server/cache-tags", () => ({
  invalidateStudioInterviewCaches: mocks.invalidate,
}));
vi.mock("@arc/ai-recruitment-copilot-backend/server/access/resume-visibility", () => ({
  buildResumeVisibilityCondition: vi.fn(),
  resolveResumeVisibilityScope: vi.fn(),
}));
vi.mock("@arc/ai-recruitment-copilot-backend/server/middlewares/permission", () => ({
  requirePermission: () => (_c: unknown, next: () => Promise<void>) => next(),
}));
vi.mock("../../utils/portfolio-attachments", () => ({
  InvalidPortfolioFileError: class extends Error {},
  storePortfolioAttachment: mocks.store,
}));

const attachment = { id: "attachment-1", mimeType: "application/pdf", name: "作品.pdf", size: 4 };
beforeEach(() => {
  vi.clearAllMocks();
  mocks.limit.mockResolvedValue([{ portfolioAttachments: [] }]);
  mocks.store.mockResolvedValue(attachment);
  mocks.returning.mockResolvedValue([{ id: "candidate-1" }]);
  mocks.set.mockReturnValue({ where: () => ({ returning: mocks.returning }) });
});

function appForPortfolio() {
  const app = new Hono<{ Variables: { activeOrg: { id: string }; user: { id: string } } }>();
  app.use("*", async (c, next) => {
    c.set("activeOrg", { id: "org-1" });
    c.set("user", { id: "user-1" });
    await next();
  });
  app.route("/:id/portfolio", portfolioRouter);
  return app;
}

function upload(attachToCandidate = false) {
  const app = appForPortfolio();
  const body = new FormData();
  body.set("file", new File(["work"], "作品.pdf", { type: "application/pdf" }));
  if (attachToCandidate) {
    body.set("attachToCandidate", "true");
  }
  return app.request("/candidate-1/portfolio/uploads", { body, method: "POST" });
}

it("persists direct uploads without submitting candidate identity fields", async () => {
  const response = await upload(true);
  expect(response.status).toBe(201);
  expect(await response.json()).toEqual(attachment);
  expect(Object.keys(mocks.set.mock.calls[0][0]).toSorted()).toEqual([
    "portfolioAttachments",
    "updatedAt",
  ]);
  expect(mocks.returning).toHaveBeenCalledOnce();
  expect(mocks.invalidate).toHaveBeenCalledWith("org-1");
});

it("keeps uploads in the identity editor staged until its existing save", async () => {
  const response = await upload();
  expect(response.status).toBe(201);
  expect(mocks.set).not.toHaveBeenCalled();
  expect(mocks.invalidate).not.toHaveBeenCalled();
});

it("rejects the attachment limit before storing a file", async () => {
  mocks.limit.mockResolvedValue([
    { portfolioAttachments: Array.from({ length: 10 }, () => attachment) },
  ]);
  const response = await upload(true);
  expect(response.status).toBe(400);
  expect(mocks.store).not.toHaveBeenCalled();
});

it("does not report success if the atomic append cannot persist the attachment", async () => {
  mocks.returning.mockResolvedValue([]);
  const response = await upload(true);
  expect(response.status).toBe(409);
  expect(mocks.invalidate).not.toHaveBeenCalled();
});

it("does not upload to a record outside the visible scope", async () => {
  mocks.limit.mockResolvedValue([]);
  const response = await upload(true);
  expect(response.status).toBe(404);
  expect(mocks.store).not.toHaveBeenCalled();
});

function linksRequest(body: unknown, path = "/links", method = "POST") {
  return appForPortfolio().request(`/candidate-1/portfolio${path}`, {
    body: JSON.stringify(body),
    headers: { "Content-Type": "application/json" },
    method,
  });
}
it("adds multiple links without storing files, returning the saved mixed collection", async () => {
  const links = [
    { name: "个人网站", url: "https://example.com" },
    { name: "项目", url: "https://github.com/example" },
  ];
  mocks.returning.mockResolvedValue([{ attachments: [attachment, ...links] }]);
  const response = await linksRequest({ links });
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ attachments: [attachment, ...links] });
  expect(mocks.store).not.toHaveBeenCalled();
  expect(mocks.invalidate).toHaveBeenCalledWith("org-1");
});
// oxlint-disable-next-line no-script-url -- Regression coverage for rejecting executable URLs.
it.each(["javascript:alert(1)", "data:text/html,test", "file:///tmp/test", "invalid"])(
  "rejects unsafe link input %s before writing",
  async (url) => {
    const response = await linksRequest({ links: [{ name: "", url }] });
    expect(response.status).toBe(400);
    expect(mocks.set).not.toHaveBeenCalled();
  },
);
it("rejects adding more than the available combined portfolio capacity", async () => {
  mocks.returning.mockResolvedValue([]);
  const response = await linksRequest({ links: [{ url: "https://example.com" }] });
  expect(response.status).toBe(409);
  expect(mocks.invalidate).not.toHaveBeenCalled();
});
it("only edits an existing link and cannot convert a file to a link", async () => {
  mocks.limit.mockResolvedValue([{ portfolioAttachments: [attachment] }]);
  const response = await linksRequest(
    { url: "https://example.com" },
    `/links/${attachment.id}`,
    "PATCH",
  );
  expect(response.status).toBe(404);
  expect(mocks.set).not.toHaveBeenCalled();
});
it("updates a link in the saved collection", async () => {
  const link = { id: "link-1", kind: "link", name: "网站", url: "https://example.com" };
  mocks.limit.mockResolvedValue([{ portfolioAttachments: [attachment, link] }]);
  mocks.returning.mockResolvedValue([{ attachments: [attachment, { ...link, name: "新名称" }] }]);
  const response = await linksRequest({ name: "新名称", url: link.url }, "/links/link-1", "PATCH");
  expect(response.status).toBe(200);
  expect(mocks.invalidate).toHaveBeenCalledWith("org-1");
});
