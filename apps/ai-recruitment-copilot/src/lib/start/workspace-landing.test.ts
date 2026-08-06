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

  it("uses agent first when agent/chat is preferred and page:chat is granted", () => {
    expect(
      resolveWorkspaceLandingHref({
        permissions: { page: ["chat", "resumes"] },
        preferredArea: "chat",
        slug: "acme",
      }),
    ).toBe("/w/acme/agent");
    expect(
      resolveWorkspaceLandingHref({
        permissions: { page: ["chat", "resumes"] },
        preferredArea: "agent",
        slug: "acme",
      }),
    ).toBe("/w/acme/agent");
  });

  it("falls back to studio resumes when agent is preferred but page:chat is missing", () => {
    expect(
      resolveWorkspaceLandingHref({
        permissions: { page: ["resumes"] },
        preferredArea: "agent",
        slug: "acme",
      }),
    ).toBe("/w/acme/studio/resumes");
  });

  it("returns null without an allowed destination", () => {
    expect(resolveWorkspaceLandingHref({ permissions: {}, slug: "acme" })).toBeNull();
  });
});
