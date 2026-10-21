// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CreateOrEditOfferDialog } from "./offer-stage-dialogs";
import { OfferCard } from "./offer-stage-cards";
import type { OfferDraftRecord } from "@arc/shared/studio-pipeline-stages";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const mocks = vi.hoisted(() => ({
  context: vi.fn(),
  create: vi.fn(),
  patch: vi.fn(),
}));
vi.mock("@/lib/client/workspace-context", () => ({ useWorkspaceSlug: () => "demo" }));
vi.mock("@/lib/client/api", () => ({
  cancelOfferDraft: vi.fn(),
  completeOfferSscConfirmation: vi.fn(),
  createOfferDraft: mocks.create,
  deleteOfferDraft: vi.fn(),
  fetchStudioResume: vi.fn(),
  getOfferCreationContext: mocks.context,
  getOfferSscTelegramLink: vi.fn().mockResolvedValue({ url: null }),
  patchOfferDraft: mocks.patch,
  receiveOfferSscConfirmation: vi.fn(),
  respondOfferDraft: vi.fn(),
  updateCandidateExpectations: vi.fn(),
}));

const defaults = {
  candidateCode: null,
  candidateName: "候选人甲",
  departmentName: "平台部",
  directManager: null,
  gender: "女",
  hiringUnitName: "研发中心",
  interviewFeedback: null,
  interviewRoundId: null,
  jobLevel: "P6",
  jobType: null,
  mainInterviewerName: null,
  managementSequence: null,
  personnelType: null,
  probationPeriod: null,
  probationSalary: null,
  serviceUnit: "研发服务单位",
  workLocation: "上海",
  workMode: null,
};
function creationContext(name = "候选人甲") {
  return {
    defaults: { ...defaults, candidateName: name },
    interviewRounds: [
      {
        feedback: "系统设计清晰，建议通过。",
        id: "round-1",
        interviewers: [
          { id: "interviewer-1", name: "面试官甲" },
          { id: "interviewer-2", name: "面试官乙" },
        ],
        label: "技术复面",
      },
    ],
    resume: { available: true, filename: "original-resume.pdf", mediaType: "application/pdf" },
  };
}
function savedDraft(): OfferDraftRecord {
  return {
    approvalAttachment: null,
    baseSalary: 30_000,
    bonus: null,
    candidateCounter: null,
    confirmationInfo: {
      ...defaults,
      candidateCode: "EMP-SAVED",
      interviewFeedback: "已保存的面试评价",
    },
    createdAt: "2026-10-21T00:00:00.000Z",
    currency: "CNY",
    equity: null,
    expiresAt: null,
    id: "offer-saved",
    interviewRecordId: "candidate-1",
    joiningDate: null,
    notes: null,
    organizationId: "org-1",
    position: "平台工程师",
    responseAt: null,
    sentAt: null,
    sscConfirmationStatus: "completed",
    sscRevision: 3,
    status: "draft",
    updatedAt: "2026-10-21T00:00:00.000Z",
    version: 2,
  };
}

const roots: ReturnType<typeof createRoot>[] = [];
const clients: QueryClient[] = [];
beforeEach(() => {
  vi.clearAllMocks();
  mocks.context.mockResolvedValue(creationContext());
  mocks.create.mockResolvedValue({ id: "offer-1" });
  mocks.patch.mockResolvedValue(savedDraft());
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    value: vi.fn(() => ({
      addEventListener: vi.fn(),
      matches: false,
      removeEventListener: vi.fn(),
    })),
  });
});

function button(label: string) {
  return [...document.body.querySelectorAll<HTMLButtonElement>("button")].find(
    (item) => item.textContent?.trim() === label,
  );
}
async function click(label: string) {
  const target = button(label);
  expect(target, `missing button ${label}`).toBeDefined();
  await act(() => target?.click());
}
function fill(id: string, value: string) {
  const input = document.querySelector(`#${id}`) as
    | HTMLInputElement
    | HTMLTextAreaElement
    | HTMLSelectElement
    | null;
  expect(input, `missing input ${id}`).not.toBeNull();
  const prototype = Object.getPrototypeOf(input);
  act(() => {
    Object.getOwnPropertyDescriptor(prototype, "value")?.set?.call(input, value);
    input?.dispatchEvent(
      new Event(input instanceof HTMLSelectElement ? "change" : "input", { bubbles: true }),
    );
  });
}

describe("saved Offer confirmation information", () => {
  function renderCard() {
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    roots.push(root);
    const client = new QueryClient();
    clients.push(client);
    const onSaved = vi.fn();
    act(() =>
      root.render(
        <QueryClientProvider client={client}>
          <OfferCard
            draft={savedDraft()}
            canConfirm={false}
            canDelete={false}
            canReceive={false}
            canUpdate={true}
            candidateId="candidate-1"
            onRespond={vi.fn()}
            onSaved={onSaved}
            onCancelled={vi.fn()}
            onDeleted={vi.fn()}
          />
        </QueryClientProvider>,
      ),
    );
    return { onSaved };
  }
  it("shows the stored template and its completed approval status", async () => {
    renderCard();
    await click("查看 Offer 信息");
    const dialog = document.querySelector('[role="dialog"]');
    expect(dialog?.textContent).toContain("EMP-SAVED");
    expect(dialog?.textContent).toContain("已保存的面试评价");
    expect(dialog?.textContent).toContain("offer审批已通过");
    expect(dialog?.textContent).not.toContain("待 SSC 确认");
  });
  it("retains stored information when editing terms and sends edits through the existing patch flow", async () => {
    const { onSaved } = renderCard();
    await click("编辑");
    expect(
      (document.querySelector("#offer-offer-saved-confirm-candidateCode") as HTMLInputElement)
        .value,
    ).toBe("EMP-SAVED");
    fill("offer-offer-saved-base", "35000");
    fill("offer-offer-saved-confirm-directManager", "直属上级甲");
    await click("保存");
    await vi.waitFor(() => expect(onSaved).toHaveBeenCalledOnce());
    expect(mocks.patch).toHaveBeenCalledExactlyOnceWith(
      "demo",
      "candidate-1",
      "offer-saved",
      expect.objectContaining({
        baseSalary: 35_000,
        confirmationInfo: expect.objectContaining({
          candidateCode: "EMP-SAVED",
          directManager: "直属上级甲",
          interviewFeedback: "已保存的面试评价",
        }),
      }),
    );
  });
});
afterEach(() => {
  for (const root of roots.splice(0)) {
    act(() => root.unmount());
  }
  for (const client of clients.splice(0)) {
    client.clear();
  }
  document.body.innerHTML = "";
});

function renderDialog() {
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  roots.push(root);
  const client = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  clients.push(client);
  const onSaved = vi.fn();
  const onOpenChange = vi.fn();
  function render(candidateId = "candidate-1", open = true) {
    act(() =>
      root.render(
        <QueryClientProvider client={client}>
          <CreateOrEditOfferDialog
            candidateEmail={null}
            candidateId={candidateId}
            mode="create"
            open={open}
            onSaved={onSaved}
            onOpenChange={onOpenChange}
          />
        </QueryClientProvider>,
      ),
    );
  }
  render();
  fill("offer-position", "平台工程师");
  fill("offer-base", "30000");
  return { onOpenChange, onSaved, render };
}
async function next() {
  await click("下一步：确认信息");
  await vi.waitFor(() =>
    expect(document.querySelector("#offer-confirm-candidateCode")).not.toBeNull(),
  );
}

describe("Offer creation confirmation", () => {
  it("loads context and allows cancelling without creating an offer", async () => {
    const { onOpenChange } = renderDialog();
    await next();
    expect(mocks.context).toHaveBeenCalledExactlyOnceWith("demo", "candidate-1");
    expect(mocks.create).not.toHaveBeenCalled();
    expect(document.body.textContent).toContain("待 SSC 确认");
    expect(document.body.textContent).not.toContain("offer审批已通过");
    expect(document.querySelector('input[type="file"]')).toBeNull();
    await click("取消");
    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it("keeps manual details on returning to the terms and creates only after explicit confirmation", async () => {
    const { onSaved } = renderDialog();
    await next();
    fill("offer-confirm-candidateCode", "EMP-001");
    fill("offer-confirm-probationSalary", "27000");
    fill("offer-confirm-interviewRoundId", "round-1");
    expect(
      (document.querySelector("#offer-confirm-mainInterviewerName") as HTMLSelectElement).value,
    ).toBe("");
    fill("offer-confirm-mainInterviewerName", "面试官乙");
    expect(
      (document.querySelector("#offer-confirm-interviewFeedback") as HTMLTextAreaElement).value,
    ).toBe("系统设计清晰，建议通过。");
    fill("offer-confirm-interviewFeedback", "复核后的面试评价");
    await click("返回修改");
    expect((document.querySelector("#offer-base") as HTMLInputElement).value).toBe("30000");
    expect(mocks.create).not.toHaveBeenCalled();
    fill("offer-base", "32000");
    await next();
    expect((document.querySelector("#offer-confirm-candidateCode") as HTMLInputElement).value).toBe(
      "EMP-001",
    );
    await click("确认创建");
    await vi.waitFor(() => expect(onSaved).toHaveBeenCalledOnce());
    expect(mocks.create).toHaveBeenCalledExactlyOnceWith(
      "demo",
      "candidate-1",
      expect.objectContaining({
        baseSalary: 32_000,
        confirmationInfo: expect.objectContaining({
          candidateCode: "EMP-001",
          interviewFeedback: "复核后的面试评价",
          interviewRoundId: "round-1",
          mainInterviewerName: "面试官乙",
          probationSalary: 27_000,
        }),
        position: "平台工程师",
        sendImmediately: false,
      }),
    );
  });

  it("locks repeated submission and keeps all information after a failed create for retry", async () => {
    const pending = Promise.withResolvers<unknown>();
    mocks.create.mockReturnValueOnce(pending.promise);
    const { onSaved } = renderDialog();
    await next();
    fill("offer-confirm-candidateCode", "EMP-RETRY");
    const confirm = button("确认创建");
    await act(() => {
      confirm?.click();
      confirm?.click();
    });
    expect(mocks.create).toHaveBeenCalledOnce();
    expect(button("创建中…")?.disabled).toBe(true);
    expect(button("返回修改")?.disabled).toBe(true);
    expect(button("取消")?.disabled).toBe(true);
    await act(() => pending.reject(new Error("创建失败，请重试")));
    await vi.waitFor(() =>
      expect(document.querySelector('[role="alert"]')?.textContent).toContain("创建失败，请重试"),
    );
    expect((document.querySelector("#offer-confirm-candidateCode") as HTMLInputElement).value).toBe(
      "EMP-RETRY",
    );
    expect(onSaved).not.toHaveBeenCalled();
    await click("确认创建");
    await vi.waitFor(() => expect(onSaved).toHaveBeenCalledOnce());
    expect(mocks.create).toHaveBeenCalledTimes(2);
  });

  it("starts clean when reopened or switched to a different candidate", async () => {
    const { render } = renderDialog();
    await next();
    fill("offer-confirm-candidateCode", "OLD-CODE");
    render("candidate-1", false);
    render("candidate-1", true);
    expect(document.querySelector("#offer-confirm-candidateCode")).toBeNull();
    expect((document.querySelector("#offer-position") as HTMLInputElement).value).toBe("");
    fill("offer-position", "新职位");
    fill("offer-base", "20000");
    mocks.context.mockResolvedValueOnce(creationContext("候选人乙"));
    render("candidate-2", true);
    expect((document.querySelector("#offer-position") as HTMLInputElement).value).toBe("");
    fill("offer-position", "新职位");
    fill("offer-base", "20000");
    await next();
    expect((document.querySelector("#offer-confirm-candidateCode") as HTMLInputElement).value).toBe(
      "",
    );
    expect((document.querySelector("#offer-confirm-candidateName") as HTMLInputElement).value).toBe(
      "候选人乙",
    );
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it("allows manual interview details without available rounds and rejects invalid probation pay", async () => {
    mocks.context.mockResolvedValueOnce({
      ...creationContext(),
      interviewRounds: [],
      resume: { available: false, filename: null, mediaType: null },
    });
    const { onSaved } = renderDialog();
    await next();
    fill("offer-confirm-mainInterviewerName", "补填面试官");
    fill("offer-confirm-interviewFeedback", "补填的评价");
    fill("offer-confirm-probationSalary", "-1");
    await click("确认创建");
    expect(document.querySelector('[role="alert"]')?.textContent).toContain("试用薪资");
    expect(mocks.create).not.toHaveBeenCalled();
    await click("返回修改");
    await next();
    fill("offer-confirm-probationSalary", "25000");
    await click("确认创建");
    await vi.waitFor(() => expect(onSaved).toHaveBeenCalledOnce());
    expect(mocks.create).toHaveBeenCalledWith(
      "demo",
      "candidate-1",
      expect.objectContaining({
        confirmationInfo: expect.objectContaining({
          interviewFeedback: "补填的评价",
          mainInterviewerName: "补填面试官",
          probationSalary: 25_000,
        }),
      }),
    );
  });

  it("keeps the terms available after context loading fails and retries without creating", async () => {
    mocks.context.mockRejectedValueOnce(new Error("确认信息暂不可用"));
    renderDialog();
    await click("下一步：确认信息");
    await vi.waitFor(() =>
      expect(document.querySelector('[role="alert"]')?.textContent).toContain("确认信息暂不可用"),
    );
    expect((document.querySelector("#offer-base") as HTMLInputElement).value).toBe("30000");
    expect(mocks.create).not.toHaveBeenCalled();
    await next();
    expect(mocks.context).toHaveBeenCalledTimes(2);
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it("ignores a delayed creation context from a previous candidate", async () => {
    const pending = Promise.withResolvers<ReturnType<typeof creationContext>>();
    mocks.context.mockReturnValueOnce(pending.promise);
    const { render } = renderDialog();
    await click("下一步：确认信息");
    render("candidate-2", true);
    await act(() => pending.resolve(creationContext("旧候选人")));
    expect(document.querySelector("#offer-confirm-candidateName")).toBeNull();
    expect((document.querySelector("#offer-position") as HTMLInputElement).value).toBe("");
    expect(mocks.create).not.toHaveBeenCalled();
  });
});
