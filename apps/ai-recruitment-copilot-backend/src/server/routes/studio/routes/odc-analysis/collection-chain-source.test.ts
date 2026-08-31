import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

function source(relativePath: string): string {
  return readFileSync(new URL(relativePath, import.meta.url), "utf-8");
}

describe("ODC role configuration and visibility", () => {
  it("persists the ODC role marker with a safe false default", () => {
    const schema = source("../../../../../../../../packages/db-schema/src/schema.ts");
    const migration = source(
      "../../../../../../../ai-recruitment-copilot/drizzle/20260831120000_add_organization_role_is_odc/migration.sql",
    );

    expect(schema).toContain('isOdc: boolean("is_odc").default(false).notNull()');
    expect(migration).toContain('ADD COLUMN "is_odc" boolean DEFAULT false NOT NULL');
  });

  it("persists the actor role for every resume-library creation path", () => {
    const createFromStorage = source("../resumes/utils/create-from-storage.ts");
    const resumesRoute = source("../resumes/route.ts");
    const batchDao = source("../resume-upload-batches/dao/batches.ts");
    const batchRoute = source("../resume-upload-batches/route.ts");
    const poolDao = source("../resume-pool/dao.ts");
    const poolRoute = source("../resume-pool/route.ts");

    expect(createFromStorage).toContain("userRole?: string | null;");
    expect(createFromStorage).toContain("createdByRole: input.userRole ?? null");
    expect(resumesRoute).toContain("userRole: c.var.member?.role ?? null");
    expect(batchDao).toContain("userRole?: string | null;");
    expect(batchDao).toContain("createdByRole: input.userRole ?? null");
    expect(batchRoute).toContain("userRole: c.var.member?.role ?? null");
    expect(poolDao).toContain("importedByRole?: string | null;");
    expect(poolDao).toContain("userRole: admission.importedByRole ?? null");
    expect(poolRoute).toContain("importedByRole: member?.role ?? null");
  });

  it("propagates the actor role when launching a default AI interview round", () => {
    const application = source("../resumes/application/launch-ai-interview-round.ts");
    const defaultLaunch = source("../resumes/application/default-launch-ai-interview-round.ts");
    const readRoute = source("../resumes/read-route.ts");

    expect(application).toContain("actorRole: string | null;");
    expect(defaultLaunch).toContain("actorRole,");
    expect(defaultLaunch).toContain("operatorRole: actorRole");
    expect(readRoute).toContain("actorRole: member.role");
  });

  it("preserves the confirming member role for Copilot stage transitions", () => {
    const actions = source("../../../chat/routes/conversations/actions.ts");
    const chatRoute = source("../../../chat/routes/conversations/route.ts");

    expect(chatRoute).toContain("operatorRole: c.var.member?.role ?? null");
    expect(actions).toContain("operatorRole: input.operatorRole");
  });

  it("applies the merged ODC-member visibility scope to every metric family", () => {
    const dao = source("./dao.ts");
    const visibility = source("./visibility-scope.ts");

    expect(visibility).toContain("resolveRecruitingVisibilityScope");
    expect(visibility).toContain("resolveHiringUnitAccessScope");
    expect(visibility).toContain("odcRoleCondition(member.role, roleNames)");
    expect(dao).toContain("candidateVisibilityCondition(visibilityScope)");
    expect(dao).toContain("visibility.recruiting");
    expect(dao).not.toContain("latestTransitionRoleCondition");
    expect(dao).not.toContain("matchesOdcRole");
  });

  it("scopes demand jobs and job filters to ODC members' hiring-unit visibility", () => {
    const dao = source("./dao.ts");

    expect(dao).toContain("buildJobDescriptionHiringUnitScopeCondition(visibility.hiringUnits)");
    expect(dao).toContain("loadSelectedJobs(organizationId, visibility)");
    expect(dao).not.toContain("odcRoleCondition(jobDescription.createdByRole");
  });

  it("captures mail-ingest roles and excludes unfinished parsing from admission counts", () => {
    const mailDao = source("../mail-ingest/dao.ts");
    const mailProcessor = source(
      "../../../../../../../ai-recruitment-copilot-worker/src/mail-ingest/processor.ts",
    );
    const dao = source("./dao.ts");

    expect(mailDao).toContain("toWorkerMailIngestAccount(row.account, row.userRole)");
    expect(mailProcessor).toContain("userRole: account.userRole");
    expect(dao).toContain('eq(studioInterview.resumeParseStatus, "ready")');
  });

  it("keeps evaluator and job-change roles in the audit trail", () => {
    const evaluationDao = source("../resumes/dao/evaluation.ts");
    const jobChangeDao = source("../resumes/dao/job-change-reset.ts");
    const resumesRoute = source("../resumes/route.ts");

    expect(evaluationDao).toContain("operatorRole: input.operatorRole ?? null");
    expect(jobChangeDao).toContain("operatorRole: input.operatorRole ?? null");
    expect(resumesRoute).toContain("operatorRole: c.var.member?.role ?? null");
  });
});
