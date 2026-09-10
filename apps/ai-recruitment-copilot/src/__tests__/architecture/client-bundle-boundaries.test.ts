import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const readSource = (relativePath: string) =>
  readFileSync(new URL(`../../${relativePath}`, import.meta.url), "utf-8");

describe("client bundle boundaries", () => {
  it.each([
    ["resumes", "resumes/resume-library-search"],
    ["members", "members/workspace-management-search"],
  ])("keeps %s search validation independent of page runtime", (route, searchModule) => {
    const source = readSource(`routes/w.$slug.studio.${route}.tsx`);
    expect(source).not.toContain("page-model");
    expect(source).toContain(searchModule);
    const search = readSource(`components/features/studio/${searchModule}.ts`);
    expect(search).not.toMatch(/from ["'](?:react|@tanstack\/react-query|.*auth-client)["']/u);
  });

  it("keeps plain interview messages independent of markdown and diagram rendering", () => {
    const transcript = readSource(
      "components/features/studio/interviews/interview-detail/conversation-transcript.tsx",
    );
    expect(transcript).toContain('from "@/components/ai-elements/message-primitives"');
    const primitives = readSource("components/ai-elements/message-primitives.tsx");
    expect(primitives).not.toMatch(/streamdown|mermaid/u);
  });

  it("loads document engines dynamically instead of importing them into dialog shells", () => {
    const sources = [
      readSource("components/features/pdf/pdf-preview-dialog.tsx"),
      readSource("components/features/resume/resume-document-preview-dialog.tsx"),
    ].join("\n");
    for (const viewer of ["pdf", "docx", "xlsx"]) {
      expect(sources).toContain(`import("@/components/ui/${viewer}-viewer")`);
      expect(sources).not.toMatch(
        new RegExp(`import (?!type)[^;]+from "@/components/ui/${viewer}-viewer"`, "u"),
      );
    }
  });
});
