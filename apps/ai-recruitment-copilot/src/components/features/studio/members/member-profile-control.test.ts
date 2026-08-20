import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const controlSource = readFileSync(new URL("member-profile-control.tsx", import.meta.url), "utf-8");
const pageSource = readFileSync(new URL("members-page.tsx", import.meta.url), "utf-8");

describe("workspace member profile control", () => {
  it("waits for profile data before showing TG values or enabling profile edits", () => {
    expect(controlSource).toContain("canUpdate && query.isSuccess");
    expect(controlSource).toContain("memberProfilesReady: query.isSuccess");
    expect(pageSource).toContain("canUpdate: canUpdate && memberProfilesReady");
  });
});
