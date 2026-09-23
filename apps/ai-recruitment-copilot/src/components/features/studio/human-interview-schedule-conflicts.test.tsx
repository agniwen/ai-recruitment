// @vitest-environment jsdom
import { setTimeout as delay } from "node:timers/promises";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { HumanInterviewStagePanel } from "./human-interview-stage-panel";
import { ScheduleRoundDialog } from "./human-interview-stage-dialogs";

const mocks = vi.hoisted(() => ({
  check: vi.fn(),
  createMeeting: vi.fn(),
  createRound: vi.fn(),
  error: vi.fn(),
  externalCheck: vi.fn(),
  externalDefaults: vi.fn(),
  listMeetings: vi.fn(),
  listRounds: vi.fn(),
  success: vi.fn(),
}));
vi.mock("@/lib/client/api", () => ({
  cancelHumanInterviewRound: vi.fn(),
  checkHumanInterviewConflicts: mocks.check,
  completeHumanInterviewRound: vi.fn(),
  createHumanInterviewMeeting: mocks.createMeeting,
  createHumanInterviewRound: mocks.createRound,
  endHumanInterviewMeeting: vi.fn(),
  issueHumanInterviewMeetingLinks: vi.fn(),
  listHumanInterviewMeetings: mocks.listMeetings,
  listHumanInterviewRounds: mocks.listRounds,
}));
vi.mock("@/lib/client/api/endpoints/external-interviewers", () => ({
  checkExternalInterviewerBindings: mocks.externalCheck,
  getExternalInterviewerDefaults: mocks.externalDefaults,
}));
vi.mock("sonner", () => ({ toast: { error: mocks.error, success: mocks.success } }));
vi.mock("@/hooks/use-mobile", () => ({ useIsMobile: () => false }));
vi.mock("@/lib/client/workspace-context", () => ({ useWorkspaceSlug: () => "world" }));
vi.mock("@/lib/client/api/query-keys", () => ({
  humanInterviewKeys: {
    links: (slug: string, id: string) => ["links", slug, id],
    meetings: (slug: string, id: string) => ["meetings", slug, id],
    rounds: (slug: string, id: string) => ["rounds", slug, id],
  },
  invalidateHumanInterviewCandidateQueries: vi.fn(),
}));
vi.mock("./human-interview-stage-rounds", () => ({
  RoundCard: ({
    onCreateMeeting,
    disabled,
  }: {
    onCreateMeeting: () => void;
    disabled: boolean;
  }) => (
    <button disabled={disabled} onClick={onCreateMeeting}>
      创建会议
    </button>
  ),
}));
vi.mock("./use-workspace-interviewer-members", () => ({
  useWorkspaceInterviewerMembers: () => ({ data: [{ id: "001", name: "压测 001" }] }),
}));
vi.mock("@/components/date-time-picker", () => ({
  DateTimePicker: ({
    id,
    value,
    onValueChange,
  }: {
    id: string;
    value: string;
    onValueChange: (value: string) => void;
  }) => (
    <button
      onClick={() => {
        let next = "2026-09-18T09:00";
        if (value) {
          next = id === "valid-until" ? "2026-09-20T10:00" : "2026-09-20T09:00";
        }
        onValueChange(next);
      }}
      type="button"
    >
      {id}:{value}
    </button>
  ),
}));
vi.mock("@/components/ui/searchable-multi-select", () => ({
  SearchableMultiSelect: () => <span>压测 001</span>,
}));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const roots: ReturnType<typeof createRoot>[] = [];
const defaultInterviewerIds = ["001"];
const conflicts = [
  {
    endAt: "2026-09-18T03:00:00Z",
    interviewerId: "001",
    interviewerName: "压测 001",
    startAt: "2026-09-17T15:00:00Z",
  },
];

async function flush() {
  await act(async () => {
    await delay(20);
  });
}
async function click(text: string) {
  const element = [...document.querySelectorAll("button")].find(
    (button) => button.textContent === text,
  );
  expect(element, text).toBeTruthy();
  act(() => {
    element?.click();
  });
  await flush();
}
async function renderDialog(interviewerIds = defaultInterviewerIds) {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  roots.push(root);
  const queryClient = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  act(() => {
    root.render(
      <QueryClientProvider client={queryClient}>
        <ScheduleRoundDialog
          open
          availableTimeSlots={[
            {
              endAt: "2026-09-19T09:00:00Z",
              startAt: "2026-09-19T01:00:00Z",
            },
          ]}
          candidateId="candidate"
          existingCount={0}
          defaultInterviewerIds={interviewerIds}
          onOpenChange={vi.fn()}
          onScheduled={vi.fn()}
        />
      </QueryClientProvider>,
    );
  });
  await flush();
  await click("scheduled-at:");
}

beforeEach(() => {
  mocks.externalDefaults.mockResolvedValue([]);
  mocks.externalCheck.mockResolvedValue([]);
  mocks.check.mockResolvedValue({ conflicts: [] });
  mocks.createRound.mockResolvedValue({ id: "new-round" });
  mocks.createMeeting.mockResolvedValue({ id: "new-meeting" });
  mocks.listRounds.mockResolvedValue([
    {
      id: "existing-round",
      interviewers: [{ id: "001" }],
      label: "技术复面",
      notes: null,
      scheduledAt: "2026-09-18T01:00:00Z",
    },
  ]);
  mocks.listMeetings.mockResolvedValue([]);
});
afterEach(() => {
  act(() => {
    for (const root of roots.splice(0)) {
      root.unmount();
    }
  });
  document.body.replaceChildren();
  vi.resetAllMocks();
});

describe("human interview scheduling conflict confirmation", () => {
  it("separates the progress summary and available times into a responsive row", async () => {
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    roots.push(root);
    const client = new QueryClient({
      defaultOptions: { mutations: { retry: false }, queries: { retry: false } },
    });

    act(() => {
      root.render(
        <QueryClientProvider client={client}>
          <HumanInterviewStagePanel
            availableTimeSlots={[
              {
                endAt: "2026-09-25T00:00:00Z",
                startAt: "2026-09-22T00:00:00Z",
              },
            ]}
            candidateId="candidate"
            candidateName="测试候选人"
          />
        </QueryClientProvider>,
      );
    });
    await flush();

    const title = [...document.querySelectorAll("h3")].find(
      (heading) => heading.textContent === "真人复面进度",
    );
    const header = title?.parentElement?.parentElement;
    expect(header?.classList.contains("sm:justify-between")).toBe(true);
    expect(header?.children).toHaveLength(2);
    const availableTimes = header?.children.item(1);
    expect(availableTimes?.textContent).toContain("候选人可预约时间");
    expect(availableTimes?.classList.contains("text-sm")).toBe(true);
    expect(availableTimes?.classList.contains("text-muted-foreground")).toBe(true);
    expect(availableTimes?.querySelector(".text-foreground")).toBeNull();
  });

  it("checks the full time range before creating the round or meeting", async () => {
    await renderDialog();
    expect(document.body.textContent).toContain("以中国标准时间（UTC+8）设置。");
    expect(document.body.textContent).toContain("有效时间至（中国标准时间）");
    expect(document.body.textContent).toContain("面试时间换算");
    expect(document.body.textContent).toContain("有效时间换算");
    expect(document.body.textContent).toContain("候选人可接受的预约时间");
    expect(document.body.textContent).toContain("安排面试时优先参考以下时间段");
    await click("保存");
    expect(mocks.check).toHaveBeenCalledWith("world", {
      interviewerIds: ["001"],
      scheduledAt: "2026-09-18T01:00:00.000Z",
      validUntil: "2026-09-18T02:00:00.000Z",
    });
    expect(mocks.check.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.createRound.mock.invocationCallOrder[0],
    );
    expect(mocks.createRound).toHaveBeenCalledTimes(1);
    expect(mocks.createMeeting).toHaveBeenCalledTimes(1);
  });
  it("shows the interviewer and cross-day interval and cancels without creating anything", async () => {
    mocks.check.mockResolvedValue({ conflicts });
    await renderDialog();
    await click("保存");
    const dialog = document.querySelector('[role="alertdialog"]');
    expect(dialog?.textContent).toContain("压测 001");
    expect(dialog?.textContent).toContain("2026-09-17 23:00");
    expect(dialog?.textContent).toContain("2026-09-18 11:00");
    expect(mocks.createRound).not.toHaveBeenCalled();
    expect(mocks.createMeeting).not.toHaveBeenCalled();
    await click("取消，修改时间");
    expect(mocks.createRound).not.toHaveBeenCalled();
    expect(mocks.createMeeting).not.toHaveBeenCalled();
    expect(mocks.success).not.toHaveBeenCalled();
    expect(document.body.textContent).toContain("scheduled-at:2026-09-18T09:00");
  });
  it("continues creating once only after explicit confirmation", async () => {
    mocks.check.mockResolvedValue({ conflicts });
    await renderDialog();
    await click("保存");
    await click("继续创建");
    expect(mocks.check).toHaveBeenCalledTimes(1);
    expect(mocks.createRound).toHaveBeenCalledTimes(1);
    expect(mocks.createMeeting).toHaveBeenCalledTimes(1);
  });
  it("checks again after cancellation and time changes", async () => {
    mocks.check.mockResolvedValueOnce({ conflicts }).mockResolvedValueOnce({ conflicts: [] });
    await renderDialog();
    await click("保存");
    await click("取消，修改时间");
    await click("scheduled-at:2026-09-18T09:00");
    await click("valid-until:2026-09-18T10:00");
    await click("保存");
    expect(mocks.check).toHaveBeenCalledTimes(2);
    expect(mocks.check.mock.calls[1][1].scheduledAt).toBe("2026-09-20T01:00:00.000Z");
  });
  it("preserves the form and does not create when the check fails", async () => {
    mocks.check.mockRejectedValue(new Error("检查失败，请重试"));
    await renderDialog();
    await click("保存");
    expect(mocks.error).toHaveBeenCalledWith("检查失败，请重试");
    expect(mocks.createRound).not.toHaveBeenCalled();
    expect(mocks.createMeeting).not.toHaveBeenCalled();
    expect(document.body.textContent).toContain("scheduled-at:2026-09-18T09:00");
  });
  it("does not create if the form is unmounted while the check is pending", async () => {
    const check = Promise.withResolvers<{ conflicts: typeof conflicts }>();
    mocks.check.mockReturnValue(check.promise);
    await renderDialog();
    await click("保存");
    act(() => {
      for (const root of roots.splice(0)) {
        root.unmount();
      }
    });
    await act(async () => {
      check.resolve({ conflicts: [] });
      await check.promise;
    });
    expect(mocks.createRound).not.toHaveBeenCalled();
    expect(mocks.createMeeting).not.toHaveBeenCalled();
  });

  it("checks the existing-round meeting entry point, excluding itself, then waits for confirmation", async () => {
    mocks.check.mockResolvedValue({ conflicts });
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    roots.push(root);
    const client = new QueryClient({
      defaultOptions: { mutations: { retry: false }, queries: { retry: false } },
    });
    act(() => {
      root.render(
        <QueryClientProvider client={client}>
          <HumanInterviewStagePanel candidateId="candidate" candidateName="测试候选人" />
        </QueryClientProvider>,
      );
    });
    await flush();
    await click("创建会议");
    expect(mocks.check).toHaveBeenCalledWith(
      "world",
      expect.objectContaining({
        excludeRoundIds: ["existing-round"],
        interviewerIds: ["001"],
        scheduledAt: "2026-09-18T01:00:00Z",
      }),
    );
    expect(mocks.createMeeting).not.toHaveBeenCalled();
    await click("继续创建");
    expect(mocks.createMeeting).toHaveBeenCalledTimes(1);
    expect(mocks.createRound).not.toHaveBeenCalled();
  });
});

describe("external interviewer scheduling", () => {
  it("prefills requester fields and cancels before creating any records", async () => {
    mocks.externalDefaults.mockResolvedValue([
      { name: "外部张三", telegram: "@outside1" },
      { name: "外部李四", telegram: "" },
    ]);
    mocks.externalCheck.mockResolvedValue([{ bound: false, name: "外部李四", telegram: "" }]);
    await renderDialog();
    expect(document.querySelector<HTMLInputElement>('input[placeholder="姓名"]')?.value).toBe(
      "外部张三",
    );
    await click("保存");
    expect(document.body.textContent).toContain("外部李四 · 未填写 TG 号");
    expect(mocks.createRound).not.toHaveBeenCalled();
    await click("取消保存");
    expect(mocks.createRound).not.toHaveBeenCalled();
    expect(mocks.createMeeting).not.toHaveBeenCalled();
  });
  it("continues after warning and saves all external interviewer fields", async () => {
    mocks.externalDefaults.mockResolvedValue([{ name: "外部张三", telegram: "@outside1" }]);
    mocks.externalCheck.mockResolvedValue([
      { bound: false, name: "外部张三", telegram: "@outside1" },
    ]);
    await renderDialog();
    await click("保存");
    expect(document.body.textContent).toContain("@outside1（尚未绑定）");
    await click("继续创建");
    expect(mocks.createRound).toHaveBeenCalledWith(
      "world",
      "candidate",
      expect.objectContaining({
        externalInterviewers: [{ name: "外部张三", telegram: "@outside1" }],
      }),
    );
    expect(mocks.createMeeting).toHaveBeenCalledOnce();
  });
  it("does not prompt when all external interviewers are bound", async () => {
    mocks.externalDefaults.mockResolvedValue([{ name: "张三", telegram: "@outside1" }]);
    mocks.externalCheck.mockResolvedValue([{ bound: true, name: "张三", telegram: "@outside1" }]);
    await renderDialog();
    await click("保存");
    expect(mocks.createMeeting).toHaveBeenCalledOnce();
    expect(document.body.textContent).not.toContain("部分外部面试官无法接收 TG 通知");
  });
  it("blocks saving on failed binding checks", async () => {
    mocks.externalDefaults.mockResolvedValue([{ name: "张三", telegram: "@outside1" }]);
    mocks.externalCheck.mockRejectedValue(new Error("检查失败"));
    await renderDialog();
    await click("保存");
    expect(mocks.createRound).not.toHaveBeenCalled();
    expect(mocks.error).toHaveBeenCalledWith("检查失败");
  });
});

it("schedules with external interviewers only and lets HR remove a prefilled person", async () => {
  mocks.externalDefaults.mockResolvedValue([
    { name: "张三", telegram: "@outside1" },
    { name: "李四", telegram: "" },
  ]);
  mocks.externalCheck.mockResolvedValue([{ bound: false, name: "李四", telegram: "" }]);
  await renderDialog([]);
  const remove = document.querySelector<HTMLButtonElement>('button[aria-label="删除外部面试官 1"]');
  act(() => remove?.click());
  await flush();
  await click("保存");
  await click("继续创建");
  expect(mocks.check).not.toHaveBeenCalled();
  expect(mocks.createRound).toHaveBeenCalledWith(
    "world",
    "candidate",
    expect.objectContaining({
      externalInterviewers: [{ name: "李四", telegram: "" }],
      interviewerIds: [],
    }),
  );
});

it("saves HR edits to the prefilled name and Telegram handle", async () => {
  mocks.externalDefaults.mockResolvedValue([{ name: "张三", telegram: "@outside1" }]);
  mocks.externalCheck.mockResolvedValue([{ bound: true, name: "新的姓名", telegram: "@updated1" }]);
  await renderDialog();
  const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
  for (const [placeholder, value] of [
    ["姓名", "新的姓名"],
    ["@用户名（可选）", "@updated1"],
  ]) {
    const input = document.querySelector<HTMLInputElement>(`input[placeholder="${placeholder}"]`);
    act(() => {
      setValue?.call(input, value);
      input?.dispatchEvent(new Event("input", { bubbles: true }));
    });
  }
  await flush();
  await click("保存");
  expect(mocks.externalCheck).toHaveBeenCalledWith("world", [
    { name: "新的姓名", telegram: "@updated1" },
  ]);
  expect(mocks.createRound).toHaveBeenCalledWith(
    "world",
    "candidate",
    expect.objectContaining({
      externalInterviewers: [{ name: "新的姓名", telegram: "@updated1" }],
    }),
  );
});
