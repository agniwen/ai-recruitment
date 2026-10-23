import { renderToStaticMarkup } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ResumeLibraryListRecord } from "@arc/shared/studio-resumes";
import { ResumeProtectionPanel } from "./resume-protection-panel";

vi.mock("@/lib/client/workspace-context", () => ({ useWorkspaceSlug: () => "workspace" }));
vi.mock("./resume-protection-continue-button", () => ({
  ResumeProtectionContinueButton: () => <button type="button">继续推荐</button>,
}));
const record = {
  candidateName: "陈安",
  creatorName: "李明",
  id: "blocked-upload",
  resumeAdmissionStatus: "protected",
  resumeProtection: {
    checkedAt: "2026-10-22T02:00:00Z",
    cycleId: "cycle",
    durationDays: 15,
    expiresAt: "2026-10-31T02:00:00Z",
    hiringUnitNames: ["技术中心", "海外业务中心"],
    matchBasis: "姓名及邮箱一致",
    ownerName: "王晓",
    ownerUserId: "a",
    startsAt: "2026-10-16T02:00:00Z",
  },
} as ResumeLibraryListRecord;
afterEach(() => vi.useRealTimers());
function render(candidate = record, tagOnly = false) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return renderToStaticMarkup(
    <QueryClientProvider client={client}>
      <ResumeProtectionPanel record={candidate} tagOnly={tagOnly} />
    </QueryClientProvider>,
  );
}
describe("selected protection presentation", () => {
  it("keeps continuation hidden while showing the protection summary and details action", () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-22T02:00:00Z"));
    const markup = render();
    expect(markup).toContain("推荐保护人：王晓");
    expect(markup).toContain("剩余 9 天");
    expect(markup).toContain("技术中心、海外业务中心");
    expect(markup).toContain("2026/10/31 10:00");
    expect(markup).toContain("查看保护详情");
    expect(markup).not.toContain("继续推荐");
    expect(markup).not.toContain("已解析");
    expect(markup).not.toContain("结构化");
  });
  it("shows the independent protection tag and keeps expired uploads out of automatic progression", () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-22T02:00:00Z"));
    expect(render(record, true)).toContain("保护期中");
    vi.setSystemTime(new Date("2026-10-31T02:00:00Z"));
    const markup = render(record, true);
    expect(markup).toContain("保护已到期");
    expect(markup).not.toContain("继续推荐");
  });
  it("adds no protection UI to normal candidates", () => {
    expect(render({ ...record, resumeAdmissionStatus: "accepted", resumeProtection: null })).toBe(
      "",
    );
  });
});
