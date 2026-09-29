// @vitest-environment jsdom

import type { StudioHumanCalendarEvent } from "@arc/shared/studio-calendar";
import { act } from "react";
import type { ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { HumanInterviewEventHoverCard } from "./human-interview-event-hover-card";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const permissions = vi.hoisted(() => ({ allowed: true }));
vi.mock("@/hooks/use-has-permission", () => ({ useHasPermission: () => permissions.allowed }));
vi.mock("@tanstack/react-router", () => ({
  Link: ({
    children,
    params,
    search,
    to,
  }: {
    children: ReactNode;
    params: { recordId: string; slug: string };
    search: { tab: string };
    to: string;
  }) => (
    <a
      href={`${to.replace("$slug", params.slug).replace("$recordId", params.recordId)}?tab=${search.tab}`}
    >
      {children}
    </a>
  ),
}));
const event: StudioHumanCalendarEvent = {
  candidates: [
    {
      candidateName: "张三",
      interviewRecordId: "candidate-1",
      roundId: "round-1",
      roundLabel: "初试",
    },
  ],
  endAt: "2026-09-29T03:00:00Z",
  format: "online",
  id: "meeting-1",
  interviewers: [
    { id: "internal-1", kind: "internal", name: "李老师" },
    { id: "external-1", kind: "external", name: "王老师" },
  ],
  kind: "human",
  location: null,
  meetingUrl: null,
  startAt: "2026-09-29T02:00:00Z",
  status: "scheduled",
  title: "技术初试",
};
const roots: ReturnType<typeof createRoot>[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) {
    act(() => root.unmount());
  }
  document.body.innerHTML = "";
  permissions.allowed = true;
});
async function openCard(value = event) {
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  roots.push(root);
  act(() =>
    root.render(
      <HumanInterviewEventHoverCard
        event={value}
        slug="demo"
        trigger={<button type="button">面试</button>}
      />,
    ),
  );
  await act(() => {
    host.querySelector("button")?.focus();
  });
  await vi.waitFor(() => expect(document.body.textContent).toContain("技术初试"));
}
describe("HumanInterviewEventHoverCard", () => {
  it("shows both interviewer types and links to the candidate's human interview tab", async () => {
    await openCard();
    expect(document.body.textContent).toContain("李老师（内部）");
    expect(document.body.textContent).toContain("王老师（外部）");
    const link = document.querySelector("a");
    expect(link?.textContent).toBe("查看候选人详情");
    expect(link?.getAttribute("href")).toBe(
      "/w/demo/studio/resumes/candidate-1?tab=human-interview",
    );
  });
  it("offers one link per candidate in a shared meeting", async () => {
    await openCard({
      ...event,
      candidates: [
        ...event.candidates,
        ...event.candidates,
        { ...event.candidates[0], candidateName: "李四", interviewRecordId: "candidate-2" },
      ],
    });
    expect([...document.querySelectorAll("a")].map((link) => link.getAttribute("href"))).toEqual([
      "/w/demo/studio/resumes/candidate-1?tab=human-interview",
      "/w/demo/studio/resumes/candidate-2?tab=human-interview",
    ]);
  });
  it("hides candidate links when the user cannot access candidate details", async () => {
    permissions.allowed = false;
    await openCard();
    expect(document.querySelector("a")).toBeNull();
  });
});
