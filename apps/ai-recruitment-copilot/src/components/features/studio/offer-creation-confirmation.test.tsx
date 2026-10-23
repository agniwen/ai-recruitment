// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CreateOrEditOfferDialog } from "./offer-stage-dialogs";
import { OfferCard } from "./offer-stage-cards";
import {
  creationContext,
  defaults,
  savedDraft,
  fill,
  fillMissingRequired,
  expectEmptyInputWithTitleHint,
} from "./offer-creation-test-utils";

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

vi.mock("@/components/date-time-picker", () => ({
  DatePicker: ({
    id,
    value,
    onValueChange,
    ...props
  }: {
    id: string;
    value: string;
    onValueChange: (value: string) => void;
    "aria-invalid"?: boolean;
    required?: boolean;
  }) => (
    <input
      {...props}
      aria-required={props.required}
      id={id}
      type="date"
      value={value}
      onChange={(event) => onValueChange(event.target.value)}
    />
  ),
}));

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
describe("saved Offer confirmation information", () => {
  function renderCard(draft = savedDraft()) {
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
            draft={draft}
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
    expect(document.body.textContent).not.toContain("年度奖金");
    await click("查看 Offer 信息");
    const dialog = document.querySelector('[role="dialog"]');
    expect(dialog?.textContent).toContain("EMP-SAVED");
    expect(dialog?.textContent).toContain("系统记录编码：candidate-1");
    expect(dialog?.textContent).toContain("已保存的面试评价");
    expect(dialog?.textContent).toContain("offer审批已通过");
    expect(dialog?.textContent).not.toContain("待 SSC 确认");
  });
  it.each([0, 36_000])(
    "preserves historical bonus %s while removing its edit input",
    async (bonus) => {
      const { onSaved } = renderCard({
        ...savedDraft(),
        bonus,
        equity: "  历史期权\n尾行  ",
        expiresAt: "2026-12-31T00:00:00.000Z",
        joiningDate: "2026-12-01T08:00:00.000Z",
        notes: "  历史备注\n  缩进尾行  ",
      });
      expect(document.body.textContent).toContain("年度奖金");
      await click("编辑");
      for (const field of ["bonus", "equity", "notes"]) {
        expect(document.querySelector(`#offer-offer-saved-${field}`)).toBeNull();
      }
      expect(document.querySelector("#offer-offer-saved-expires")).not.toBeNull();
      expect(document.querySelector<HTMLInputElement>("#offer-offer-saved-joining")?.value).toBe(
        "2026-12-01",
      );
      const probationSalary = bonus === 0 ? 0 : 25_000;
      fill("offer-offer-saved-confirm-probationSalary", String(probationSalary));
      fill("offer-offer-saved-confirm-probationPeriod", "2个月");
      await click("保存");
      await vi.waitFor(() => expect(onSaved).toHaveBeenCalledOnce());
      expect(mocks.patch).toHaveBeenCalledWith(
        "demo",
        "candidate-1",
        "offer-saved",
        expect.objectContaining({
          confirmationInfo: expect.objectContaining({ probationPeriod: "2个月", probationSalary }),
          expiresAt: "2026-12-31",
          joiningDate: "2026-12-01",
        }),
      );
      const payload = mocks.patch.mock.lastCall?.at(-1);
      for (const field of ["bonus", "equity", "notes"]) {
        expect(payload).not.toHaveProperty(field);
      }
      expect(mocks.context).not.toHaveBeenCalled();
    },
  );
  it("retains stored information when editing terms and sends edits through the existing patch flow", async () => {
    const draft = savedDraft();
    draft.confirmationInfo = {
      ...defaults,
      ...draft.confirmationInfo,
      gender: "未发现信息",
      probationPeriod: "60天",
    };
    const { onSaved } = renderCard(draft);
    await click("编辑");
    const gender = document.querySelector<HTMLSelectElement>("#offer-offer-saved-confirm-gender");
    expect(gender?.value).toBe("未发现信息");
    expect(gender?.selectedOptions[0].disabled).toBe(true);
    const period = document.querySelector<HTMLSelectElement>(
      "#offer-offer-saved-confirm-probationPeriod",
    );
    expect(period?.value).toBe("60天");
    expect(period?.selectedOptions[0].disabled).toBe(true);
    expect(
      document.querySelector<HTMLInputElement>("#offer-offer-saved-confirm-jobLevel")?.value,
    ).toBe("P6");
    expect(
      document.querySelector<HTMLInputElement>("#offer-offer-saved-confirm-workLocation")?.value,
    ).toBe("上海");
    expect(
      (document.querySelector("#offer-offer-saved-confirm-candidateCode") as HTMLInputElement)
        .value,
    ).toBe("EMP-SAVED");
    expect(
      document.querySelector<HTMLInputElement>("#offer-offer-saved-confirm-systemRecordCode")
        ?.value,
    ).toBe("candidate-1");
    for (const field of ["interviewRoundId", "mainInterviewerName", "interviewFeedback"]) {
      expect(document.querySelector(`#offer-offer-saved-confirm-${field}`)).toBeNull();
    }
    fill("offer-offer-saved-base", "35000");
    fill("offer-offer-saved-confirm-directManager", "直属上级甲");
    fill("offer-offer-saved-confirm-gender", "女");
    fill("offer-offer-saved-confirm-probationPeriod", "2个月");
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
          gender: "女",
          interviewFeedback: "已保存的面试评价",
          jobLevel: "P6",
          probationPeriod: "2个月",
          workLocation: "上海",
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

function renderDialog(position = "平台工程师") {
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
  fill("offer-position", position);
  fill("offer-base", "30000");
  return { onOpenChange, onSaved, render };
}
async function ready() {
  await vi.waitFor(async () => {
    await act(() => Promise.resolve());
    const candidateName = document.querySelector<HTMLInputElement>("#offer-confirm-candidateName");
    expect(candidateName).not.toBeNull();
    expect(candidateName?.matches(":disabled")).toBe(false);
  });
}
async function next() {
  await ready();
  fillMissingRequired();
  await click("下一步：确认信息");
  await vi.waitFor(() =>
    expect(document.querySelector('[role="dialog"]')?.textContent).toContain("完整确认内容"),
  );
}

describe("Offer creation confirmation", () => {
  it("blocks review, lists every missing required field and focuses the first invalid control", async () => {
    renderDialog();
    await ready();
    const required = {
      base: "转正薪资",
      "confirm-departmentName": "入职部门",
      "confirm-directManager": "直属上级",
      "confirm-gender": "性别",
      "confirm-hiringUnitName": "入职编制组织",
      "confirm-jobLevel": "建议职级",
      "confirm-jobType": "岗位类型",
      "confirm-managementSequence": "管理序列",
      "confirm-personnelType": "人员性质",
      "confirm-probationPeriod": "试用期期限",
      "confirm-probationSalary": "试用薪资",
      "confirm-serviceUnit": "入职服务单位",
      "confirm-workLocation": "办公地区",
      "confirm-workMode": "办公方式",
      joining: "期望上岗日期",
      position: "职位",
    };
    for (const field of Object.keys(required)) {
      fill(`offer-${field}`, "");
    }
    await click("下一步：确认信息");
    const alert = document.querySelector('[role="alert"]');
    for (const [field, label] of Object.entries(required)) {
      const control = document.querySelector(`#offer-${field}`);
      expect(control?.getAttribute("aria-invalid"), label).toBe("true");
      expect(control?.getAttribute("aria-required"), label).toBe("true");
      expect(alert?.textContent, label).toContain(label);
    }
    expect(document.activeElement?.id).toBe("offer-confirm-gender");
    expect(document.querySelector('label[for="offer-currency"]')?.textContent).toContain("必填");
    expect(document.querySelector("#offer-expires")?.getAttribute("aria-required")).not.toBe(
      "true",
    );
    expect(button("确认创建")).toBeUndefined();
    expect(mocks.create).not.toHaveBeenCalled();
    fill("offer-confirm-gender", "男");
    expect(document.querySelector("#offer-confirm-gender")?.getAttribute("aria-invalid")).not.toBe(
      "true",
    );
    await click("下一步：确认信息");
    expect(document.activeElement?.id).toBe("offer-confirm-hiringUnitName");
  });

  it("preserves the expected joining date through review and saves it independently of SSC dates", async () => {
    const { onSaved } = renderDialog();
    await ready();
    fillMissingRequired();
    fill("offer-joining", "2027-01-15");
    fill("offer-confirm-probationSalary", "0");
    await next();
    expect(document.querySelector('pre[aria-label="Offer 确认内容"]')?.textContent).toContain(
      "期望上岗日期：2027-01-15",
    );
    await click("返回修改");
    expect(document.querySelector<HTMLInputElement>("#offer-joining")?.value).toBe("2027-01-15");
    await next();
    await click("确认创建");
    await vi.waitFor(() => expect(onSaved).toHaveBeenCalledOnce());
    const payload = mocks.create.mock.lastCall?.at(-1);
    expect(payload).toMatchObject({
      confirmationInfo: { probationSalary: 0 },
      expiresAt: null,
      joiningDate: "2027-01-15",
    });
    expect(payload).not.toHaveProperty("preboardingDate");
    expect(payload?.confirmationInfo).not.toHaveProperty("preboardingDate");
  });

  it("lists missing required terms on click and clears their field errors as they are filled", async () => {
    renderDialog();
    await ready();
    fillMissingRequired();
    fill("offer-position", "");
    fill("offer-base", "");
    expect(button("下一步：确认信息")?.disabled).toBe(false);
    expect(document.querySelector('[role="alert"]')).toBeNull();
    await click("下一步：确认信息");
    const alert = document.querySelector('[role="alert"]');
    expect(alert?.textContent).toContain("职位");
    expect(alert?.textContent).toContain("转正薪资");
    expect(document.querySelector("#offer-position")?.getAttribute("aria-invalid")).toBe("true");
    expect(document.querySelector("#offer-base")?.getAttribute("aria-invalid")).toBe("true");
    expect(mocks.create).not.toHaveBeenCalled();
    expect(button("确认创建")).toBeUndefined();
    fill("offer-position", "前端工程师");
    expect(document.querySelector("#offer-position")?.getAttribute("aria-invalid")).not.toBe(
      "true",
    );
    await click("下一步：确认信息");
    expect(document.querySelector('[role="alert"]')?.textContent).not.toContain("职位");
    expect(document.querySelector('[role="alert"]')?.textContent).toContain("转正薪资");
    fill("offer-base", "32000");
    expect(document.querySelector('[role="alert"]')).toBeNull();
    await next();
    expect(button("确认创建")?.disabled).toBe(false);
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it.each(["-1", "1.5"])("names invalid regular salary %s when continuing", async (value) => {
    renderDialog();
    await ready();
    fill("offer-base", value);
    await click("下一步：确认信息");
    expect(document.querySelector('[role="alert"]')?.textContent).toContain("转正薪资");
    expect(document.querySelector('[role="alert"]')?.textContent).toContain("正整数");
    expect(document.querySelector("#offer-base")?.getAttribute("aria-invalid")).toBe("true");
    expect(button("确认创建")).toBeUndefined();
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it("uses only the new information format while keeping the system Offer expiry field", () => {
    renderDialog();
    for (const field of ["bonus", "equity", "notes"]) {
      expect(document.querySelector(`#offer-${field}`)).toBeNull();
    }
    expect(document.querySelector("#offer-expires")).not.toBeNull();
    expect(document.querySelector("#offer-joining")).not.toBeNull();
    expect(
      document.querySelector("#offer-joining")?.closest("section")?.querySelector("h3")
        ?.textContent,
    ).toBe("1️⃣编制信息");
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it("shows hints beside field titles with empty inputs and creates with an optional business code", async () => {
    const context = creationContext();
    mocks.context.mockResolvedValueOnce({
      ...context,
      defaults: { ...context.defaults, gender: "未发现信息", workLocation: null },
    });
    const { onSaved } = renderDialog();
    await ready();
    expect(document.querySelector<HTMLSelectElement>("#offer-confirm-gender")?.value).toBe("");
    const examples = {
      jobType: "策划",
      managementSequence: "个人",
      personnelType: "直属",
      workLocation: "中国",
      workMode: "远程",
    };
    for (const [field, example] of Object.entries(examples)) {
      expectEmptyInputWithTitleHint(`offer-confirm-${field}`, `例如：${example}`);
    }
    for (const field of ["directManager", "probationSalary", "probationPeriod"]) {
      expectEmptyInputWithTitleHint(
        `offer-confirm-${field}`,
        field === "probationPeriod" ? "例如：2" : "待补充",
      );
    }
    expect(document.querySelector<HTMLInputElement>("#offer-position")?.placeholder).toBe("");
    expect(document.querySelector('label[for="offer-confirm-candidateCode"]')?.textContent).toBe(
      "候选人编码（选填）",
    );
    expect(document.querySelector<HTMLInputElement>("#offer-confirm-candidateCode")?.required).toBe(
      false,
    );
    const recordCode = document.querySelector<HTMLInputElement>("#offer-confirm-systemRecordCode");
    expect(recordCode?.value).toBe("candidate-1");
    expect(recordCode?.readOnly).toBe(true);
    await next();
    expect(document.body.textContent).toContain("系统记录编码：candidate-1");
    expect(document.body.textContent).toContain("候选人编码：未填写");
    await click("确认创建");
    await vi.waitFor(() => expect(onSaved).toHaveBeenCalledOnce());
    expect(mocks.create).toHaveBeenCalledWith(
      "demo",
      "candidate-1",
      expect.objectContaining({
        confirmationInfo: expect.objectContaining({
          candidateCode: null,
          gender: "女",
          jobLevel: "P3",
          managementSequence: "个人",
          personnelType: "直属",
          workLocation: "中国",
          workMode: "远程",
        }),
      }),
    );
    const payload = mocks.create.mock.lastCall?.at(-1);
    expect(payload?.confirmationInfo).not.toHaveProperty("systemRecordCode");
    expect(payload?.confirmationInfo).not.toHaveProperty("candidateRecordId");
  });

  it("loads all editable information on opening and reviews it without writing or annual-bonus input", async () => {
    const { onOpenChange } = renderDialog();
    await ready();
    expect(mocks.context).toHaveBeenCalledExactlyOnceWith("demo", "candidate-1");
    expect((document.querySelector("#offer-confirm-candidateName") as HTMLInputElement).value).toBe(
      "候选人甲",
    );
    expect(document.querySelector<HTMLInputElement>("#offer-confirm-workLocation")?.value).toBe("");
    const gender = document.querySelector<HTMLSelectElement>("select#offer-confirm-gender");
    expect(gender?.value).toBe("女");
    expect(Array.from(gender?.options ?? [], (option) => option.value)).toEqual(["", "男", "女"]);
    expectEmptyInputWithTitleHint("offer-confirm-jobLevel", "例如：P3");
    fill("offer-confirm-gender", "男");
    fill("offer-confirm-gender", "");
    expect(document.querySelector("#offer-confirm-probationSalary")).not.toBeNull();
    expect(document.querySelector("#offer-confirm-probationPeriod")).not.toBeNull();
    const period = document.querySelector<HTMLSelectElement>(
      "select#offer-confirm-probationPeriod",
    );
    expect(period?.value).toBe("");
    expect([...(period?.options ?? [])].slice(1).map((option) => option.text)).toEqual(
      Array.from({ length: 12 }, (_value, index) => String(index + 1)),
    );
    expect(document.querySelector('label[for="offer-confirm-probationPeriod"]')?.textContent).toBe(
      "试用期期限（月，必填）",
    );
    fill("offer-confirm-probationPeriod", "2个月");
    fill("offer-confirm-probationPeriod", "");
    expect(document.body.textContent).toContain("转正薪资");
    expect(document.body.textContent).toContain("试用期期限");
    expect(document.body.textContent).not.toContain("年度奖金");
    expect(document.querySelector("#offer-bonus")).toBeNull();
    expect(mocks.create).not.toHaveBeenCalled();
    await next();
    expect(document.querySelector("#offer-confirm-candidateCode")).toBeNull();
    expect(document.querySelector("#offer-confirm-probationSalary")).toBeNull();
    const confirmationText = document.querySelector(
      'pre[aria-label="Offer 确认内容"]',
    )?.textContent;
    expect(confirmationText).not.toContain("待 SSC 确认");
    expect(confirmationText).toContain("建议职级：P3");
    expect(confirmationText).toContain("性别：女");
    expect(confirmationText).toContain("试用期：2个月");
    expect(confirmationText).toContain("试用薪资：25K");
    expect(confirmationText).toContain("期望上岗日期：2026-12-01");
    expect(document.body.textContent).not.toContain("offer审批已通过");
    expect(document.querySelector('input[type="file"]')).toBeNull();
    await click("取消");
    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it("keeps first-step details when returning from read-only review and creates only after confirmation", async () => {
    const { onSaved } = renderDialog();
    await ready();
    fill("offer-confirm-candidateCode", "EMP-001");
    fill("offer-confirm-probationSalary", "27000");
    fill("offer-confirm-probationPeriod", "2个月");
    fill("offer-expires", "2026-12-20");
    fill("offer-confirm-directManager", "确认直属上级");
    fill("offer-confirm-gender", "男");
    fill("offer-confirm-jobLevel", "P4");
    fill("offer-confirm-workLocation", "杭州");
    await next();
    expect(document.querySelector("#offer-confirm-candidateCode")).toBeNull();
    expect(document.body.textContent).toContain("EMP-001");
    expect(document.body.textContent).toContain("系统记录编码：candidate-1");
    expect(document.body.textContent).not.toContain("面试评价");
    expect(document.body.textContent).toContain("试用薪资：27K");
    expect(document.body.textContent).toContain("试用期：2个月");
    expect(document.body.textContent).toContain("性别：男");
    expect(document.body.textContent).toContain("建议职级：P4");
    expect(document.body.textContent).toContain("办公地区：杭州");
    await click("返回修改");
    expect((document.querySelector("#offer-base") as HTMLInputElement).value).toBe("30000");
    expect((document.querySelector("#offer-confirm-candidateCode") as HTMLInputElement).value).toBe(
      "EMP-001",
    );
    expect(
      (document.querySelector("#offer-confirm-probationSalary") as HTMLInputElement).value,
    ).toBe("27000");
    expect(
      (document.querySelector("#offer-confirm-probationPeriod") as HTMLSelectElement).value,
    ).toBe("2个月");
    expect((document.querySelector("#offer-expires") as HTMLInputElement).value).toBe("2026-12-20");
    expect(document.querySelector<HTMLSelectElement>("#offer-confirm-gender")?.value).toBe("男");
    expect(document.querySelector<HTMLInputElement>("#offer-confirm-jobLevel")?.value).toBe("P4");
    expect(document.querySelector<HTMLInputElement>("#offer-confirm-workLocation")?.value).toBe(
      "杭州",
    );
    expect(mocks.create).not.toHaveBeenCalled();
    fill("offer-base", "32000");
    await next();
    await click("确认创建");
    await vi.waitFor(() => expect(onSaved).toHaveBeenCalledOnce());
    expect(mocks.create).toHaveBeenCalledExactlyOnceWith(
      "demo",
      "candidate-1",
      expect.objectContaining({
        baseSalary: 32_000,
        confirmationInfo: expect.objectContaining({
          candidateCode: "EMP-001",
          directManager: "确认直属上级",
          gender: "男",
          interviewFeedback: null,
          interviewRoundId: null,
          jobLevel: "P4",
          mainInterviewerName: null,
          probationPeriod: "2个月",
          probationSalary: 27_000,
          workLocation: "杭州",
        }),
        expiresAt: "2026-12-20",
        joiningDate: "2026-12-01",
        position: "平台工程师",
        sendImmediately: false,
      }),
    );
    const payload = mocks.create.mock.lastCall?.at(-1);
    for (const field of ["bonus", "equity", "notes"]) {
      expect(payload).not.toHaveProperty(field);
    }
  });

  it("locks repeated submission and keeps reviewed information after a failed create for retry", async () => {
    const pending = Promise.withResolvers<unknown>();
    mocks.create.mockReturnValueOnce(pending.promise);
    const { onSaved } = renderDialog();
    await ready();
    fill("offer-confirm-candidateCode", "EMP-RETRY");
    await next();
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
    expect(document.body.textContent).toContain("EMP-RETRY");
    expect(onSaved).not.toHaveBeenCalled();
    await click("返回修改");
    expect((document.querySelector("#offer-confirm-candidateCode") as HTMLInputElement).value).toBe(
      "EMP-RETRY",
    );
    await next();
    await click("确认创建");
    await vi.waitFor(() => expect(onSaved).toHaveBeenCalledOnce());
    expect(mocks.create).toHaveBeenCalledTimes(2);
  });

  it("starts clean when reopened or switched to a different candidate", async () => {
    const { render } = renderDialog("");
    await ready();
    expect(document.querySelector<HTMLInputElement>("#offer-position")?.value).toBe("当前投递岗位");
    fill("offer-confirm-candidateCode", "OLD-CODE");
    render("candidate-1", false);
    render("candidate-1", true);
    await ready();
    expect((document.querySelector("#offer-confirm-candidateCode") as HTMLInputElement).value).toBe(
      "",
    );
    expect((document.querySelector("#offer-position") as HTMLInputElement).value).toBe(
      "当前投递岗位",
    );
    fill("offer-position", "新职位");
    fill("offer-base", "20000");
    mocks.context.mockResolvedValueOnce(creationContext("候选人乙", "候选人乙投递岗位"));
    render("candidate-2", true);
    await ready();
    expect((document.querySelector("#offer-position") as HTMLInputElement).value).toBe(
      "候选人乙投递岗位",
    );
    expect((document.querySelector("#offer-confirm-candidateCode") as HTMLInputElement).value).toBe(
      "",
    );
    expect((document.querySelector("#offer-confirm-candidateName") as HTMLInputElement).value).toBe(
      "候选人乙",
    );
    expect(document.querySelector<HTMLInputElement>("#offer-confirm-systemRecordCode")?.value).toBe(
      "candidate-2",
    );
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it("omits interview inputs and rejects invalid probation pay before review", async () => {
    mocks.context.mockResolvedValueOnce({
      ...creationContext(),
      interviewRounds: [],
      position: null,
      resume: { available: false, filename: null, mediaType: null },
    });
    const { onSaved } = renderDialog("");
    await ready();
    expect(document.querySelector<HTMLInputElement>("#offer-position")?.value).toBe("");
    fill("offer-position", "平台工程师");
    for (const field of ["interviewRoundId", "mainInterviewerName", "interviewFeedback"]) {
      expect(document.querySelector(`#offer-confirm-${field}`)).toBeNull();
    }
    expect(document.body.textContent).not.toContain("面试评价");
    fill("offer-confirm-probationSalary", "-1");
    await click("下一步：确认信息");
    expect(document.querySelector('[role="alert"]')?.textContent).toContain("试用薪资");
    expect(button("确认创建")).toBeUndefined();
    expect(mocks.create).not.toHaveBeenCalled();
    fill("offer-confirm-probationSalary", "25000");
    await next();
    await click("确认创建");
    await vi.waitFor(() => expect(onSaved).toHaveBeenCalledOnce());
    expect(mocks.create).toHaveBeenCalledWith(
      "demo",
      "candidate-1",
      expect.objectContaining({
        confirmationInfo: expect.objectContaining({
          interviewFeedback: null,
          mainInterviewerName: null,
          probationSalary: 25_000,
        }),
      }),
    );
  });

  it("keeps entered terms after automatic context loading fails and explicitly retries without creating", async () => {
    mocks.context.mockRejectedValueOnce(new Error("确认信息暂不可用"));
    renderDialog();
    await vi.waitFor(() =>
      expect(document.querySelector('[role="alert"]')?.textContent).toContain("确认信息暂不可用"),
    );
    expect((document.querySelector("#offer-base") as HTMLInputElement).value).toBe("30000");
    expect(mocks.create).not.toHaveBeenCalled();
    await click("重新加载资料");
    await ready();
    expect(mocks.context).toHaveBeenCalledTimes(2);
    expect((document.querySelector("#offer-base") as HTMLInputElement).value).toBe("30000");
    await next();
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it("prevents supplemental input during slow initial loading and keeps source defaults after it completes", async () => {
    const pending = Promise.withResolvers<ReturnType<typeof creationContext>>();
    mocks.context.mockReturnValueOnce(pending.promise);
    renderDialog();
    expect(mocks.context).toHaveBeenCalledExactlyOnceWith("demo", "candidate-1");
    const probation = document.querySelector<HTMLInputElement>("#offer-confirm-probationSalary");
    expect(probation === null || probation.matches(":disabled")).toBe(true);
    expect(button("确认创建")).toBeUndefined();
    expect(mocks.create).not.toHaveBeenCalled();
    await act(() => pending.resolve(creationContext()));
    await ready();
    expect((document.querySelector("#offer-confirm-candidateName") as HTMLInputElement).value).toBe(
      "候选人甲",
    );
    expect(
      (document.querySelector("#offer-confirm-hiringUnitName") as HTMLInputElement).value,
    ).toBe("研发中心");
    fill("offer-confirm-probationSalary", "25000");
    expect((document.querySelector("#offer-confirm-candidateName") as HTMLInputElement).value).toBe(
      "候选人甲",
    );
  });
  it("ignores a delayed automatic context from a previous candidate", async () => {
    const pending = Promise.withResolvers<ReturnType<typeof creationContext>>();
    mocks.context.mockReturnValueOnce(pending.promise);
    const { render } = renderDialog();
    mocks.context.mockResolvedValueOnce(creationContext("候选人乙", "候选人乙投递岗位"));
    render("candidate-2", true);
    await ready();
    await act(() => pending.resolve(creationContext("旧候选人")));
    expect((document.querySelector("#offer-confirm-candidateName") as HTMLInputElement).value).toBe(
      "候选人乙",
    );
    expect((document.querySelector("#offer-position") as HTMLInputElement).value).toBe(
      "候选人乙投递岗位",
    );
    expect(mocks.create).not.toHaveBeenCalled();
  });
});
