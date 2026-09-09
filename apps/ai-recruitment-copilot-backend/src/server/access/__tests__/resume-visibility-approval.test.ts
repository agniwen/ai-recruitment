import { PgDialect } from "drizzle-orm/pg-core";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { buildResumeVisibilityCondition, resolveResumeVisibilityScope } from "../resume-visibility";

const mocks = vi.hoisted(() => ({ authorize: vi.fn(), authorizer: vi.fn(), recruiting: vi.fn() }));
vi.mock("@arc/ai-recruitment-copilot-backend/lib/server/db", async () => {
  const { drizzle } = await import("drizzle-orm/node-postgres");
  return { db: drizzle.mock() };
});
vi.mock("../workspace-access-policy", () => ({
  createRequestWorkspaceAuthorizer: mocks.authorizer,
}));
vi.mock("../recruiting-visibility", () => ({ resolveRecruitingVisibilityScope: mocks.recruiting }));
vi.mock(
  "@arc/ai-recruitment-copilot-backend/server/routes/studio/utils/hiring-unit-scope",
  async (importOriginal) => ({
    ...(await importOriginal<Record<string, unknown>>()),
    resolveOdcAccessScope: () =>
      Promise.resolve({
        departmentIds: [],
        hiringUnitIds: [],
        resumeSourceIds: [],
      }),
  }),
);

beforeEach(() => {
  vi.clearAllMocks();
  mocks.authorizer.mockReturnValue(mocks.authorize);
  mocks.recruiting.mockResolvedValue({ kind: "none" });
});

async function visibilityQuery() {
  const scope = await resolveResumeVisibilityScope({
    currentRole: "ai-reviewer",
    organizationId: "workspace-a",
    userId: "reviewer",
  });
  const condition = buildResumeVisibilityCondition(scope);
  if (!condition) {
    throw new Error("Reviewer must retain a stage and workspace restriction");
  }
  return new PgDialect().sqlToQuery(condition);
}

describe("AI approval candidate visibility", () => {
  it("allows all pending records even without recruiting-group or ODC membership", async () => {
    mocks.authorize.mockResolvedValue(true);
    const query = await visibilityQuery();
    expect(query.sql).toContain('"studio_interview"."organization_id" =');
    expect(query.sql).toContain('"studio_interview"."pipeline_stage" =');
    expect(query.sql).not.toContain("created_by");
    expect(query.sql).not.toContain("resume_source");
    expect(query.params).toEqual(["workspace-a", "ai_review"]);
    expect(mocks.authorizer).toHaveBeenCalledWith({
      memberRole: "ai-reviewer",
      organizationId: "workspace-a",
      userId: "reviewer",
    });
    expect(mocks.authorize).toHaveBeenCalledWith({ action: "approve", resource: "aiReview" });
  });

  it("unions pending records from superiors and other groups with the existing creator scope", async () => {
    mocks.authorize.mockResolvedValue(true);
    mocks.recruiting.mockResolvedValue({
      kind: "restricted",
      userIds: ["reviewer", "subordinate"],
    });
    const query = await visibilityQuery();
    expect(query.sql).toContain('"studio_interview"."created_by" in');
    expect(query.sql).toContain(" or ");
    expect(query.params).toEqual(["reviewer", "subordinate", "workspace-a", "ai_review"]);
  });

  it("removes cross-group pending visibility when approval permission is revoked", async () => {
    mocks.authorize.mockResolvedValue(false);
    const query = await visibilityQuery();
    expect(query.sql).toBe("false");
    expect(query.params).toEqual([]);
  });

  it.each(["admin", "owner"])(
    "keeps %s visibility unrestricted within the caller's workspace query",
    async (currentRole) => {
      const scope = await resolveResumeVisibilityScope({
        currentRole,
        organizationId: "workspace-a",
        userId: "reviewer",
      });
      expect(buildResumeVisibilityCondition(scope)).toBeUndefined();
      expect(mocks.authorizer).not.toHaveBeenCalled();
    },
  );
});
