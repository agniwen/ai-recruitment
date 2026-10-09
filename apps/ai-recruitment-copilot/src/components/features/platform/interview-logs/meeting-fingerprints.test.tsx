// @vitest-environment jsdom
import { act } from "react";
import { afterEach, describe, expect, it } from "vitest";
import {
  enableReactActEnvironment,
  installNoopResizeObserver,
  renderInAct,
  unmountInAct,
  waitForUi,
} from "@/test-utils/react-act";
import type { MeetingLogs } from "./api";
import { MeetingFingerprints } from "./meeting-fingerprints";

type Meeting = MeetingLogs["records"][number];
enableReactActEnvironment();
installNoopResizeObserver();
let rendered: Awaited<ReturnType<typeof renderInAct>> | undefined;
afterEach(async () => {
  if (rendered) {
    await unmountInAct(rendered.root);
  }
  rendered = undefined;
  document.body.innerHTML = "";
});

async function renderFingerprints(participants: Meeting["participants"]) {
  rendered = await renderInAct(
    <MeetingFingerprints
      meeting={{
        eventCount: 188,
        fingerprintCount: new Set(participants.flatMap((p) => p.fingerprints)).size,
        firstReceivedAt: "2026-10-08T01:00:00Z",
        lastReceivedAt: "2026-10-08T02:00:00Z",
        meetingId: "meeting",
        meetingTitle: "指纹测试",
        organizationId: "org",
        participantCount: participants.length,
        participants,
        roomName: "human_test",
      }}
    />,
  );
}

async function openDetails() {
  const trigger = document.querySelector<HTMLButtonElement>("button");
  expect(trigger).not.toBeNull();
  act(() => trigger?.click());
  await waitForUi(() => expect(document.querySelector('[role="dialog"]')).not.toBeNull());
  return document.querySelector('[role="dialog"]');
}

describe("meeting fingerprint summary", () => {
  it("shows all identities and full fingerprints on activation without flagging a shared browser", async () => {
    await renderFingerprints([
      { fingerprints: ["a".repeat(32)], identity: "candidate", name: "Miles", role: "candidate" },
      { fingerprints: ["a".repeat(32)], identity: "host", name: "主持 A", role: "host" },
      {
        fingerprints: ["a".repeat(32)],
        identity: "interviewer_b",
        name: "面试 B",
        role: "interviewer",
      },
      {
        fingerprints: ["a".repeat(32)],
        identity: "interviewer_c",
        name: "面试 C",
        role: "interviewer",
      },
    ]);
    expect(document.querySelector("button")?.textContent).toContain("1 个");
    expect(document.querySelector('[aria-label="候选人出现多个浏览器指纹"]')).toBeNull();
    const details = await openDetails();
    expect(details?.textContent).toContain("候选人");
    expect(details?.textContent).toContain("面试官 · 主持人");
    expect(details?.textContent).toContain("Miles");
    expect(details?.textContent).toContain("面试 B");
    expect(details?.textContent).toContain("面试 C");
    expect(details?.querySelectorAll("code")).toHaveLength(4);
    expect(details?.querySelector("code")?.textContent).toBe("a".repeat(32));
  });

  it("flags multiple fingerprints for one candidate before opening details", async () => {
    await renderFingerprints([
      {
        fingerprints: ["a".repeat(32), "b".repeat(32)],
        identity: "candidate",
        name: "Miles",
        role: "candidate",
      },
      { fingerprints: ["a".repeat(32)], identity: "host", name: "主持 A", role: "host" },
    ]);
    expect(document.querySelector('[aria-label="候选人出现多个浏览器指纹"]')).not.toBeNull();
    const details = await openDetails();
    expect(details?.textContent).toContain("疑似浏览器环境变化");
    expect(details?.textContent).toContain("2 个指纹");
    expect(details?.textContent).toContain("b".repeat(32));
  });

  it("checks each candidate separately and does not flag interviewer environment changes", async () => {
    await renderFingerprints([
      {
        fingerprints: ["a".repeat(32)],
        identity: "candidate_a",
        name: "候选 A",
        role: "candidate",
      },
      {
        fingerprints: ["b".repeat(32)],
        identity: "candidate_b",
        name: "候选 B",
        role: "candidate",
      },
      {
        fingerprints: ["c".repeat(32), "d".repeat(32)],
        identity: "host",
        name: "主持 A",
        role: "host",
      },
    ]);
    expect(document.querySelector("button")?.textContent).toContain("4 个");
    expect(document.querySelector('[aria-label="候选人出现多个浏览器指纹"]')).toBeNull();
    const details = await openDetails();
    expect(details?.textContent).not.toContain("疑似浏览器环境变化");
    expect(details?.textContent).toContain("2 个指纹");
  });

  it("shows missing fingerprints as unknown, retaining identities without a display name", async () => {
    await renderFingerprints([
      { fingerprints: [], identity: "candidate_unknown", name: null, role: "candidate" },
    ]);
    expect(document.querySelector("button")?.textContent).toContain("0 个未采集");
    expect(document.querySelector('[aria-label="候选人出现多个浏览器指纹"]')).toBeNull();
    const details = await openDetails();
    expect(details?.textContent).toContain("candidate_unknown");
    expect(details?.textContent).toContain("未采集到指纹，暂无法判断环境变化");
  });
});
