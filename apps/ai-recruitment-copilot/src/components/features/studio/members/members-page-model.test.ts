import { describe, expect, it } from "vitest";
import {
  buildWorkspaceMemberTreeRows,
  filterWorkspaceMembers,
  filterWorkspaceMembersWithAncestors,
} from "./members-page-model";
import type { MemberRow } from "./members-page-model";

const MEMBER: MemberRow = {
  createdAt: "2026-08-20T00:00:00.000Z",
  email: "member@example.com",
  id: "member-id",
  image: null,
  isInterviewer: false,
  lastActiveAt: null,
  name: "张三",
  role: "member",
  telegram: "@zhangsan",
  userId: "user-id",
};

describe("filterWorkspaceMembers", () => {
  it("matches member names, email addresses, and TG numbers", () => {
    expect(filterWorkspaceMembers([MEMBER], "张三")).toEqual([MEMBER]);
    expect(filterWorkspaceMembers([MEMBER], "MEMBER@")).toEqual([MEMBER]);
    expect(filterWorkspaceMembers([MEMBER], "ZHANGSAN")).toEqual([MEMBER]);
    expect(filterWorkspaceMembers([MEMBER], "missing")).toEqual([]);
  });

  it("keeps matching members under their ancestor chain", () => {
    const manager = { ...MEMBER, id: "manager-id", name: "李经理", userId: "manager" };
    const report = { ...MEMBER, id: "report-id", name: "王专员", userId: "report" };
    const directManagers = new Map([["report", "manager"]]);

    expect(
      filterWorkspaceMembersWithAncestors([manager, report], "王专员", directManagers).map(
        (row) => row.userId,
      ),
    ).toEqual(["manager", "report"]);
  });
});

describe("buildWorkspaceMemberTreeRows", () => {
  const manager = { ...MEMBER, id: "manager-id", name: "李经理", userId: "manager" };
  const report = { ...MEMBER, id: "report-id", name: "王专员", userId: "report" };
  const orphan = { ...MEMBER, id: "orphan-id", name: "独立成员", userId: "orphan" };
  const directManagers = new Map<string, string | null>([
    ["report", "manager"],
    ["orphan", "missing-manager"],
  ]);

  it("orders direct reports beneath their manager and preserves orphan members", () => {
    expect(
      buildWorkspaceMemberTreeRows([report, orphan, manager], directManagers, new Set()).map(
        (row) => [row.userId, row.treeDepth, row.hasDirectReports],
      ),
    ).toEqual([
      ["orphan", 0, false],
      ["manager", 0, true],
      ["report", 1, false],
    ]);
  });

  it("removes collapsed descendants without dropping other members", () => {
    expect(
      buildWorkspaceMemberTreeRows(
        [manager, report, orphan],
        directManagers,
        new Set(["manager"]),
      ).map((row) => row.userId),
    ).toEqual(["manager", "orphan"]);
  });
});
