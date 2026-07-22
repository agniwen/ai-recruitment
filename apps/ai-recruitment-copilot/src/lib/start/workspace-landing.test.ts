import { describe, expect, it } from "vitest";
import { resolveWorkspaceLandingHref } from "@/lib/start/workspace-landing";

describe("resolveWorkspaceLandingHref", () => {
  it("keeps the fork-specific hiring unit page in the Studio fallback order", () => {
    expect(
      resolveWorkspaceLandingHref({
        permissions: { page: ["hiringUnits"] },
        slug: "acme",
      }),
    ).toBe("/w/acme/studio/hiring-units");
  });

  it("uses chat first when chat is preferred", () => {
    expect(
      resolveWorkspaceLandingHref({
        permissions: { page: ["chat", "resumes"] },
        preferredArea: "chat",
        slug: "acme",
      }),
    ).toBe("/w/acme/chat");
  });

  it("returns null without an allowed destination", () => {
    expect(resolveWorkspaceLandingHref({ permissions: {}, slug: "acme" })).toBeNull();
  });
});
