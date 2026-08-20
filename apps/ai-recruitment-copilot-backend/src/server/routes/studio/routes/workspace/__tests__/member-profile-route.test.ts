import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const routeSource = readFileSync(new URL("../route.ts", import.meta.url), "utf-8");
const daoSource = readFileSync(new URL("../dao.ts", import.meta.url), "utf-8");

describe("workspace member profile route", () => {
  it("requires member update permission before returning TG numbers", () => {
    const routeStart = routeSource.indexOf('.get("/members/profiles"');
    const routeSection = routeSource.slice(routeStart, routeStart + 500);

    expect(routeStart).toBeGreaterThan(-1);
    expect(routeSection).toContain('requirePermission("member", "update")');
    expect(routeSection).toContain("listWorkspaceMemberProfiles");
  });

  it("keeps TG numbers out of the unrestricted interviewer member list", () => {
    const listStart = daoSource.indexOf("export async function listWorkspaceMembers");
    const listEnd = daoSource.indexOf("export function listWorkspaceMemberProfiles");

    expect(daoSource.slice(listStart, listEnd)).not.toContain("telegram");
  });
});
