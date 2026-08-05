import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { CopyableResumeRecordId } from "@/components/features/resume/copyable-resume-record-id";

const source = readFileSync(new URL("../copyable-resume-record-id.tsx", import.meta.url), "utf-8");

describe("CopyableResumeRecordId", () => {
  it("renders the masked id and a dedicated copy control", () => {
    const html = renderToStaticMarkup(<CopyableResumeRecordId id="abcd1234wxyz" parentheses />);
    expect(html).toContain("(abcd****wxyz)");
    expect(html).toContain('aria-label="复制候选人 ID"');
    expect(html).toContain("data-resume-card-interactive");
  });

  it("copies via clipboard helper and stops event bubbling", () => {
    expect(source).toContain("copyTextToClipboard");
    expect(source).toContain('toast.success("已复制候选人 ID")');
    expect(source).toContain("event.stopPropagation()");
    expect(source).toContain("event.preventDefault()");
  });
});
