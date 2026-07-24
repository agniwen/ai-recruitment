import { beforeEach, describe, expect, it, vi } from "vitest";
import { factory } from "@arc/ai-recruitment-copilot-backend/server/factory";

const mocks = vi.hoisted(() => ({
  loadJobDescriptionById: vi.fn(),
  transaction: vi.fn(),
}));

vi.mock("@arc/ai-recruitment-copilot-backend/lib/server/db", () => ({
  db: { transaction: mocks.transaction },
}));

vi.mock("@arc/ai-recruitment-copilot-backend/server/middlewares/permission", () => ({
  requirePermission: () => (_c: unknown, next: () => Promise<void>) => next(),
}));

vi.mock(
  "@arc/ai-recruitment-copilot-backend/server/routes/studio/routes/job-descriptions/dao",
  () => ({ loadJobDescriptionById: mocks.loadJobDescriptionById }),
);

// oxlint-disable-next-line import/first -- route import must follow hoisted mocks.
import { studioInterviewCollectionRouter } from "../collection-route";

function makeApp() {
  return factory
    .createApp()
    .use("*", async (c, next) => {
      c.set("activeOrg", { id: "org-1" } as never);
      c.set("user", { id: "user-1" } as never);
      await next();
    })
    .route("/", studioInterviewCollectionRouter);
}

describe("AI interview collection route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("rejects creating an AI interview for a job that disables AI interviews", async () => {
    mocks.loadJobDescriptionById.mockResolvedValue({
      aiInterviewDisabled: true,
      id: "jd-disabled",
      name: "线下面试岗位",
    });
    const formData = new FormData();
    formData.set("candidateEmail", "");
    formData.set("candidateName", "候选人");
    formData.set("candidatePhone", "");
    formData.set("jobDescriptionId", "jd-disabled");
    formData.set("notes", "");
    formData.set(
      "scheduleEntries",
      JSON.stringify([
        {
          allowTextInput: false,
          notes: "",
          roundLabel: "AI 面试",
          scheduledAt: "",
          sortOrder: 0,
        },
      ]),
    );
    formData.set("targetRole", "");

    const response = await makeApp().request("/", { body: formData, method: "POST" });

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({
      error: "所选在招岗位已禁用 AI 面试。",
    });
    expect(mocks.transaction).not.toHaveBeenCalled();
  });
});
