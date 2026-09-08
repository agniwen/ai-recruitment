import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq, sql } from "drizzle-orm";
import { closeDatabase, db } from "@arc/ai-recruitment-copilot-backend/lib/server/db";
import {
  member,
  organization,
  organizationRole,
  resumeSource,
  resumeSourceOdcMember,
  user,
} from "@arc/db-schema/schema";
import {
  createStudioPreRegistration,
  queryPaginatedStudioPreRegistrations,
  updateStudioPreRegistration,
} from "../dao";
import { provisionPreRegisteredUser } from "../provisioning";
import { studioPreRegistrationInputSchema } from "../schema";

function input(email: string) {
  return studioPreRegistrationInputSchema.parse({
    directManagerEmail: null,
    displayName: "预录入 ODC",
    email,
    odcAssignments: [
      { jobSeries: "直属", resumeSourceId: "source-a", serviceUnit: "悦达" },
      { jobSeries: "派驻", resumeSourceId: "source-b", serviceUnit: " 无极 " },
    ],
    recruitingGroupNames: [],
    recruitingRole: "hr",
    telegram: "@odc",
    workspaceRole: "custom-odc",
  });
}
function assignments(memberId: string) {
  return db
    .select({
      jobSeries: resumeSourceOdcMember.jobSeries,
      resumeSourceId: resumeSourceOdcMember.resumeSourceId,
      serviceUnit: resumeSourceOdcMember.serviceUnit,
    })
    .from(resumeSourceOdcMember)
    .where(eq(resumeSourceOdcMember.memberId, memberId))
    .orderBy(resumeSourceOdcMember.resumeSourceId);
}

const testSchema = process.env.PRE_REGISTRATION_TEST_SCHEMA;

describe.skipIf(!testSchema)("pre-registration ODC persistence in an isolated schema", () => {
  beforeAll(async () => {
    const rows = await db.execute(sql`select current_schema() as name`);
    if (!testSchema?.startsWith("codex_pre_odc_") || rows[0]?.name !== testSchema) {
      throw new Error("Refusing to write outside the isolated test schema");
    }
    await db.insert(organization).values([
      { id: "org-a", name: "Alpha", slug: "alpha" },
      { id: "org-b", name: "Beta", slug: "beta" },
    ]);
    await db.insert(organizationRole).values({
      id: "role-a",
      isOdc: true,
      name: "ODC",
      organizationId: "org-a",
      permission: "{}",
      role: "custom-odc",
    });
    await db.insert(resumeSource).values([
      { id: "source-a", name: "来源 A", organizationId: "org-a" },
      { id: "source-b", name: "来源 B", organizationId: "org-a" },
      { id: "manual", name: "手动挂靠", organizationId: "org-a" },
      { id: "foreign", name: "其他工作区", organizationId: "org-b" },
    ]);
  }, 30_000);
  afterAll(async () => {
    await closeDatabase();
  }, 30_000);

  it("stores multiple scopes, provisions without recruiting groups and reconciles edits", async () => {
    const payload = input("odc@example.com");
    const created = await createStudioPreRegistration("alpha", payload);
    if (typeof created === "string") {
      throw new TypeError(created);
    }
    const listed = await queryPaginatedStudioPreRegistrations("alpha", {
      page: 1,
      pageSize: 20,
      sortBy: "displayName",
      sortOrder: "asc",
    });
    expect(listed.records.find((record) => record.id === created.id)?.odcAssignments).toEqual(
      payload.odcAssignments,
    );
    await db.insert(user).values({ email: payload.email, id: "odc-user", name: "User" });
    await provisionPreRegisteredUser({ email: payload.email, userId: "odc-user" });
    const [registered] = await db
      .select()
      .from(member)
      .where(and(eq(member.userId, "odc-user"), eq(member.organizationId, "org-a")));
    expect(registered.role).toBe("custom-odc");
    expect(await assignments(registered.id)).toEqual(payload.odcAssignments);
    await db
      .insert(resumeSourceOdcMember)
      .values({ memberId: registered.id, organizationId: "org-a", resumeSourceId: "manual" });
    const edited = {
      ...payload,
      odcAssignments: [{ jobSeries: null, resumeSourceId: "source-b", serviceUnit: null }],
    };
    await updateStudioPreRegistration("alpha", created.id, edited);
    expect(await assignments(registered.id)).toEqual([
      { jobSeries: null, resumeSourceId: "manual", serviceUnit: null },
      { jobSeries: null, resumeSourceId: "source-b", serviceUnit: null },
    ]);
    await provisionPreRegisteredUser({ email: payload.email, userId: "odc-user" });
    expect(await assignments(registered.id)).toHaveLength(2);
    await updateStudioPreRegistration("alpha", created.id, {
      ...edited,
      odcAssignments: [],
      workspaceRole: "member",
    });
    expect(await assignments(registered.id)).toEqual([
      { jobSeries: null, resumeSourceId: "manual", serviceUnit: null },
    ]);
  }, 120_000);

  it("rejects foreign sources and non-ODC roles before saving", async () => {
    const payload = input("invalid@example.com");
    await expect(
      createStudioPreRegistration("alpha", { ...payload, workspaceRole: "member" }),
    ).resolves.toBe("invalid_odc_role");
    await expect(
      createStudioPreRegistration("alpha", {
        ...payload,
        odcAssignments: [{ jobSeries: null, resumeSourceId: "foreign", serviceUnit: null }],
      }),
    ).resolves.toBe("invalid_resume_source");
    await expect(
      createStudioPreRegistration("alpha", {
        ...payload,
        odcAssignments: [{ jobSeries: null, resumeSourceId: "missing", serviceUnit: null }],
      }),
    ).resolves.toBe("invalid_resume_source");
  });

  it("does not grant source scopes to an existing non-ODC member", async () => {
    const payload = input("existing@example.com");
    await db.insert(user).values({ email: payload.email, id: "existing-user", name: "Existing" });
    await db.insert(member).values({
      id: "existing-member",
      organizationId: "org-a",
      role: "member",
      userId: "existing-user",
    });
    await createStudioPreRegistration("alpha", payload);
    await provisionPreRegisteredUser({ email: payload.email, userId: "existing-user" });
    expect(await assignments("existing-member")).toEqual([]);
    const [existing] = await db
      .select({ role: member.role })
      .from(member)
      .where(eq(member.id, "existing-member"));
    expect(existing.role).toBe("member");
  });
});
