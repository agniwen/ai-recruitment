import { Hono } from "hono";
import { beforeEach, expect, it, vi } from "vitest";
import { smartResumeTasksRouter } from "./route";

const mocks = vi.hoisted(() => ({
  insert: vi.fn(),
  load: vi.fn(),
  loadFile: vi.fn(),
  object: vi.fn(),
  portfolioValid: vi.fn(),
  where: vi.fn(),
}));
vi.mock("@arc/ai-recruitment-copilot-backend/lib/server/db", () => ({
  db: { select: () => ({ from: () => ({ where: mocks.where }) }) },
}));
vi.mock("@arc/ai-recruitment-copilot-backend/lib/server/s3", () => ({
  getObjectStream: mocks.object,
}));
vi.mock("@arc/ai-recruitment-copilot-backend/server/middlewares/permission", () => ({
  requirePermission: () => (_c: unknown, next: () => Promise<void>) => next(),
}));
vi.mock("@arc/resume-parse-queue/resume-parse", () => ({
  enqueueResumeParseJobs: vi.fn(),
  isResumeParseQueueConfigured: () => true,
}));
vi.mock("../resume-upload-batches/dao/batches", () => ({ insertBatchWithItems: mocks.insert }));
vi.mock("../resumes/utils/portfolio-attachments", () => ({
  validatePortfolioAttachments: mocks.portfolioValid,
}));
vi.mock("./dao", () => ({
  listUnsubmittedSmartTasks: vi.fn(),
  loadSmartTask: mocks.load,
  retrySmartTask: vi.fn(),
  saveSmartTaskDraft: vi.fn(),
  submitSmartTask: vi.fn(),
}));
vi.mock("./utils/jobs", () => ({ loadEligibleSmartJobs: vi.fn() }));
vi.mock("./routes/items/dao", () => ({ loadOwnedTaskItemFile: mocks.loadFile }));

const file = {
  contentHash: "hash",
  fileSize: 100,
  originalFileName: "简历.pdf",
  storageKey: "resumes/test.pdf",
};
const portfolio = {
  id: "15ce7c54-712b-49d0-91db-f9cd25a30241",
  mimeType: "application/pdf",
  name: "作品.pdf",
  size: 100,
};
const input = {
  files: [{ ...file, portfolioAttachments: [portfolio] }],
  requestId: "15ce7c54-712b-49d0-91db-f9cd25a30240",
};
beforeEach(() => {
  vi.clearAllMocks();
  mocks.load.mockResolvedValue(null);
  mocks.portfolioValid.mockResolvedValue(true);
  mocks.where.mockResolvedValue([]);
  mocks.loadFile.mockResolvedValue({
    filename: "简历.pdf",
    mediaType: null,
    storageKey: file.storageKey,
  });
  mocks.object.mockImplementation(() =>
    Promise.resolve({ body: new Blob(["%PDF-test"]).stream(), contentType: "application/pdf" }),
  );
});
function app(signedIn = true, role = "admin") {
  const instance = new Hono<{
    Variables: { activeOrg: { id: string } | null; user: { id: string; role: string } | null };
  }>();
  instance.use("*", async (c, next) => {
    c.set("activeOrg", signedIn ? { id: "org" } : null);
    c.set("user", signedIn ? { id: "user", role } : null);
    await next();
  });
  return instance.route("/tasks", smartResumeTasksRouter);
}
const createTask = () =>
  app().request("/tasks", {
    body: JSON.stringify(input),
    headers: { "Content-Type": "application/json" },
    method: "POST",
  });

it("validates initial portfolio ownership before creating a task", async () => {
  mocks.portfolioValid.mockResolvedValue(false);
  const response = await createTask();
  expect(response.status).toBe(400);
  expect(mocks.portfolioValid).toHaveBeenCalledWith([portfolio], "org", "user");
  expect(mocks.insert).not.toHaveBeenCalled();
});
it("stages valid portfolios with the uploaded resume", async () => {
  mocks.where
    .mockResolvedValueOnce([{ contentHash: file.contentHash, storageKey: file.storageKey }])
    .mockResolvedValueOnce([]);
  const response = await createTask();
  expect(response.status).toBe(201);
  expect(mocks.insert).toHaveBeenCalledWith(
    expect.objectContaining({ files: input.files, smartUpload: true }),
  );
});
it("streams the owned resume inline and offers an explicit original-file download", async () => {
  const response = await app().request("/tasks/task/items/item/resume");
  expect(response.status).toBe(200);
  expect(response.headers.get("Content-Type")).toBe("application/pdf");
  expect(response.headers.get("Content-Disposition")).toContain("inline; filename*=UTF-8''");
  expect(response.headers.get("Cache-Control")).toBe("private, max-age=300");
  expect(await response.text()).toBe("%PDF-test");
  expect(mocks.loadFile).toHaveBeenCalledWith("task", "item", "org", "user", undefined);
  const download = await app().request("/tasks/task/items/item/resume?download=1");
  expect(download.headers.get("Content-Disposition")).toContain("attachment;");
});
it("streams portfolio files through the same owned task item boundary", async () => {
  mocks.loadFile.mockResolvedValue({
    filename: "作品.pdf",
    mediaType: "application/pdf",
    storageKey: "portfolio/test.pdf",
  });
  const response = await app().request("/tasks/task/items/item/portfolio/file");
  expect(response.status).toBe(200);
  expect(mocks.loadFile).toHaveBeenCalledWith("task", "item", "org", "user", "file");
  expect(mocks.object).toHaveBeenCalledWith("portfolio/test.pdf");
});
it("does not touch storage when the user or owned item is missing", async () => {
  const unauthenticated = await app(false).request("/tasks/task/items/item/resume");
  expect(unauthenticated.status).toBe(401);
  expect(mocks.loadFile).not.toHaveBeenCalled();
  mocks.loadFile.mockResolvedValue(null);
  const missing = await app().request("/tasks/task/items/item/resume");
  expect(missing.status).toBe(404);
  expect(mocks.object).not.toHaveBeenCalled();
});
it("reports unavailable stored files without an empty successful preview", async () => {
  mocks.object.mockResolvedValue(null);
  const unavailable = await app().request("/tasks/task/items/item/resume");
  expect(unavailable.status).toBe(404);
});
it.each([
  ["/tasks", "GET"],
  ["/tasks", "POST"],
  ["/tasks/task", "GET"],
  ["/tasks/task", "PATCH"],
  ["/tasks/task/submit", "POST"],
  ["/tasks/task/retry", "POST"],
  ["/tasks/task/items/item/resume", "GET"],
  ["/tasks/task/items/item/portfolio/file", "GET"],
])("restricts smart upload to platform admins before handling %s %s", async (path, method) => {
  const response = await app(true, "user").request(path, { method });
  expect(response.status).toBe(403);
  expect(mocks.load).not.toHaveBeenCalled();
  expect(mocks.loadFile).not.toHaveBeenCalled();
  expect(mocks.insert).not.toHaveBeenCalled();
});
