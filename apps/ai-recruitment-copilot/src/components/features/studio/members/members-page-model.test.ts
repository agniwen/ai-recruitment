import { describe, expect, it } from "vitest";
import { filterWorkspaceMembers } from "./members-page-model";
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
});
