import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "@arc/ai-recruitment-copilot-backend/lib/server/db";
import { member, memberReportingLine, organization, user } from "@arc/db-schema/schema";
import {
  listWorkspaceMemberHierarchy,
  updateWorkspaceMemberDirectManager,
  updateWorkspaceMembersDirectManager,
} from "../dao";

const ORGANIZATION_ID = "test_member_reporting_line_org";
const NOW = new Date("2026-09-03T00:00:00.000Z");
const USERS = {
  manager: "test_reporting_line_manager",
  report: "test_reporting_line_report",
  secondReport: "test_reporting_line_second_report",
} as const;

async function cleanup() {
  await db
    .delete(memberReportingLine)
    .where(eq(memberReportingLine.organizationId, ORGANIZATION_ID));
  await db.delete(member).where(eq(member.organizationId, ORGANIZATION_ID));
  await db.delete(organization).where(eq(organization.id, ORGANIZATION_ID));
  for (const userId of Object.values(USERS)) {
    await db.delete(user).where(eq(user.id, userId));
  }
}

beforeAll(async () => {
  await cleanup();
  await db.insert(user).values(
    Object.entries(USERS).map(([name, id]) => ({
      createdAt: NOW,
      email: `${name}@reporting-line.test`,
      emailVerified: false,
      id,
      name,
      updatedAt: NOW,
    })),
  );
  await db.insert(organization).values({
    createdAt: NOW,
    id: ORGANIZATION_ID,
    name: "Reporting Line Test",
    slug: "reporting-line-test",
  });
  await db.insert(member).values(
    Object.entries(USERS).map(([name, userId]) => ({
      createdAt: NOW,
      id: `m_reporting_line_${name}`,
      organizationId: ORGANIZATION_ID,
      role: "member",
      userId,
    })),
  );
}, 30_000);

afterAll(cleanup, 30_000);

describe("workspace member reporting-line dao", () => {
  it("updates, reads, clears, and rejects invalid reporting lines", async () => {
    expect(
      await updateWorkspaceMemberDirectManager({
        directManagerUserId: USERS.manager,
        organizationId: ORGANIZATION_ID,
        userId: USERS.report,
      }),
    ).toBe("updated");
    expect(
      await updateWorkspaceMemberDirectManager({
        directManagerUserId: USERS.report,
        organizationId: ORGANIZATION_ID,
        userId: USERS.secondReport,
      }),
    ).toBe("updated");

    const hierarchy = await listWorkspaceMemberHierarchy(ORGANIZATION_ID);
    expect(hierarchy).toEqual(
      expect.arrayContaining([
        { directManagerUserId: null, userId: USERS.manager },
        { directManagerUserId: USERS.manager, userId: USERS.report },
        { directManagerUserId: USERS.report, userId: USERS.secondReport },
      ]),
    );
    expect(
      await updateWorkspaceMemberDirectManager({
        directManagerUserId: USERS.secondReport,
        organizationId: ORGANIZATION_ID,
        userId: USERS.manager,
      }),
    ).toBe("cycle");
    expect(
      await updateWorkspaceMemberDirectManager({
        directManagerUserId: USERS.report,
        organizationId: ORGANIZATION_ID,
        userId: USERS.report,
      }),
    ).toBe("self");
    expect(
      await updateWorkspaceMemberDirectManager({
        directManagerUserId: null,
        organizationId: ORGANIZATION_ID,
        userId: USERS.report,
      }),
    ).toBe("updated");
    expect(await listWorkspaceMemberHierarchy(ORGANIZATION_ID)).toContainEqual({
      directManagerUserId: null,
      userId: USERS.report,
    });
  });

  it("updates several reporting lines atomically and rejects cycles", async () => {
    expect(
      await updateWorkspaceMembersDirectManager({
        directManagerUserId: USERS.manager,
        organizationId: ORGANIZATION_ID,
        userIds: [USERS.report, USERS.secondReport],
      }),
    ).toBe("updated");
    expect(await listWorkspaceMemberHierarchy(ORGANIZATION_ID)).toEqual(
      expect.arrayContaining([
        { directManagerUserId: USERS.manager, userId: USERS.report },
        { directManagerUserId: USERS.manager, userId: USERS.secondReport },
      ]),
    );
    expect(
      await updateWorkspaceMembersDirectManager({
        directManagerUserId: USERS.report,
        organizationId: ORGANIZATION_ID,
        userIds: [USERS.manager],
      }),
    ).toBe("cycle");
    expect(
      await updateWorkspaceMembersDirectManager({
        directManagerUserId: USERS.manager,
        organizationId: ORGANIZATION_ID,
        userIds: [USERS.manager, USERS.report],
      }),
    ).toBe("self");
    expect(await listWorkspaceMemberHierarchy(ORGANIZATION_ID)).toEqual(
      expect.arrayContaining([
        { directManagerUserId: null, userId: USERS.manager },
        { directManagerUserId: USERS.manager, userId: USERS.report },
        { directManagerUserId: USERS.manager, userId: USERS.secondReport },
      ]),
    );
  });
});
