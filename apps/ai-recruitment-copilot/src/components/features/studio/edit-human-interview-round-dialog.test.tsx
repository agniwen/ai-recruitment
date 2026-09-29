// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act } from "react";
import { toast } from "sonner";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import type { HumanInterviewRoundRecord } from "@arc/shared/studio-pipeline-stages";
import { RoundCard } from "./human-interview-stage-rounds";

const { patchRound } = vi.hoisted(() => ({ patchRound: vi.fn() }));
vi.mock("@/lib/client/api", () => ({
  checkHumanInterviewConflicts: vi.fn().mockResolvedValue({ conflicts: [] }),
  patchHumanInterviewRound: patchRound,
}));
vi.mock("@/lib/client/workspace-context", () => ({ useWorkspaceSlug: () => "test" }));
vi.mock("@/hooks/use-mobile", () => ({ useIsMobile: () => false }));
vi.mock("./use-workspace-interviewer-members", () => ({
  useWorkspaceInterviewerMembers: () => ({ data: [], isError: false, isPending: false }),
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
    <input
      aria-label={id}
      id={id}
      value={value}
      onChange={(event) => onValueChange(event.target.value)}
    />
  ),
}));
vi.mock("@/components/ui/searchable-multi-select", () => ({
  SearchableMultiSelect: () => <span>内部面试官选择</span>,
}));

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
const round: HumanInterviewRoundRecord = {
  cancelReason: null,
  cancelledAt: null,
  completedAt: null,
  createdAt: "2026-09-29T00:00:00.000Z",
  externalInterviewers: [{ id: "external-1", name: "吉米", telegram: "" }],
  feedback: null,
  format: "online",
  id: "round-1",
  interviewRecordId: "candidate-1",
  interviewers: [],
  label: "初试",
  location: null,
  meetingUrl: null,
  notes: null,
  organizationId: "org-1",
  outcome: null,
  scheduledAt: "2026-09-29T08:30:00.000Z",
  score: null,
  sortOrder: 0,
  status: "pending",
  updatedAt: "2026-09-29T00:00:00.000Z",
};
const roots: ReturnType<typeof createRoot>[] = [];
const clients: QueryClient[] = [];
afterEach(() => {
  for (const root of roots) {
    act(() => root.unmount());
  }
  roots.length = 0;
  for (const client of clients) {
    client.clear();
  }
  clients.length = 0;
  document.body.innerHTML = "";
  vi.clearAllMocks();
});
function click(text: string) {
  const button = [...document.querySelectorAll("button")].find((item) => item.textContent === text);
  if (!button) {
    throw new Error(`Missing button: ${text}`);
  }
  act(() => button.click());
}
function renderCard() {
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  roots.push(root);
  const client = new QueryClient({
    defaultOptions: { mutations: { retry: false }, queries: { retry: false } },
  });
  clients.push(client);
  const saved = vi.fn();
  act(() =>
    root.render(
      <QueryClientProvider client={client}>
        <RoundCard
          round={round}
          meeting={null}
          canCreate
          canUpdate
          canDelete
          onComplete={vi.fn()}
          onCancel={vi.fn()}
          onCreateMeeting={vi.fn()}
          onEndMeeting={vi.fn()}
          onOpenLinks={vi.fn()}
          onRescheduled={saved}
        />
      </QueryClientProvider>,
    ),
  );
  return saved;
}
function getInput(selector: string): HTMLInputElement {
  const input = document.querySelector<HTMLInputElement>(selector);
  if (!input) {
    throw new Error(`Missing input: ${selector}`);
  }
  return input;
}
function changeInput(input: HTMLInputElement, value: string) {
  act(() => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}
it("opens a modal, prefills external interviewers, and submits the edited name and interviewer", async () => {
  patchRound.mockResolvedValue(round);
  const saved = renderCard();
  expect(document.querySelector('[role="dialog"]')).toBeNull();
  click("编辑");
  await vi.waitFor(() => expect(document.querySelector('[role="dialog"]')).not.toBeNull());
  const label = getInput("#edit-round-label");
  const interviewer = getInput('input[id^="external-name-"]');
  expect(label.value).toBe("初试");
  expect(interviewer.value).toBe("吉米");
  changeInput(label, "技术复面");
  changeInput(interviewer, "新的面试官");
  click("保存修改");
  await vi.waitFor(() =>
    expect(patchRound).toHaveBeenCalledWith(
      "test",
      "candidate-1",
      "round-1",
      expect.objectContaining({
        externalInterviewers: [{ name: "新的面试官", telegram: "" }],
        interviewerIds: [],
        label: "技术复面",
      }),
    ),
  );
  await vi.waitFor(() => expect(saved).toHaveBeenCalledOnce());
});
it("discards draft changes when cancelled", async () => {
  renderCard();
  click("编辑");
  await vi.waitFor(() => expect(document.querySelector("#edit-round-label")).not.toBeNull());
  changeInput(getInput("#edit-round-label"), "未保存");
  click("取消");
  click("编辑");
  await vi.waitFor(() =>
    expect(document.querySelector<HTMLInputElement>("#edit-round-label")?.value).toBe("初试"),
  );
  expect(patchRound).not.toHaveBeenCalled();
});

it("requires at least one interviewer", async () => {
  renderCard();
  click("编辑");
  await vi.waitFor(() =>
    expect(document.querySelector('input[id^="external-name-"]')).not.toBeNull(),
  );
  click("删除");
  const save = [...document.querySelectorAll("button")].find(
    (button) => button.textContent === "保存修改",
  );
  expect(save?.disabled).toBe(true);
  expect(patchRound).not.toHaveBeenCalled();
});

it("keeps a successful save and warns when notification delivery fails", async () => {
  const warning = vi.spyOn(toast, "warning");
  patchRound.mockResolvedValue({ ...round, externalNotificationFailures: ["吉米"] });
  const saved = renderCard();
  click("编辑");
  await vi.waitFor(() => expect(document.querySelector("#edit-round-label")).not.toBeNull());
  click("保存修改");
  await vi.waitFor(() => expect(saved).toHaveBeenCalledOnce());
  expect(warning).toHaveBeenCalledWith(expect.stringContaining("吉米"));
  warning.mockRestore();
});
