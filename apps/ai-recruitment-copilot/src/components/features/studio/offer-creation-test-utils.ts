import { act } from "react";
import { expect } from "vitest";
import type { OfferDraftRecord } from "@arc/shared/studio-pipeline-stages";

export const defaults = {
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
const completeInfo = {
  ...defaults,
  directManager: "直属上级甲",
  jobType: "技术",
  managementSequence: "个人",
  personnelType: "直属",
  probationPeriod: "2个月",
  probationSalary: 25_000,
  workMode: "远程",
};
export function creationContext(name = "候选人甲") {
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
export function savedDraft(): OfferDraftRecord {
  return {
    approvalAttachment: null,
    baseSalary: 30_000,
    bonus: null,
    candidateCounter: null,
    confirmationInfo: {
      ...completeInfo,
      candidateCode: "EMP-SAVED",
      interviewFeedback: "已保存的面试评价",
    },
    createdAt: "2026-10-21T00:00:00.000Z",
    currency: "CNY",
    equity: null,
    expiresAt: null,
    id: "offer-saved",
    interviewRecordId: "candidate-1",
    joiningDate: "2026-12-01",
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

export function fill(id: string, value: string) {
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

export function fillMissingRequired(prefix = "offer") {
  const values: Record<string, string> = {
    [`${prefix}-joining`]: "2026-12-01",
    [`${prefix}-confirm-gender`]: "女",
    [`${prefix}-confirm-hiringUnitName`]: "研发中心",
    [`${prefix}-confirm-serviceUnit`]: "研发服务单位",
    [`${prefix}-confirm-personnelType`]: "直属",
    [`${prefix}-confirm-departmentName`]: "平台部",
    [`${prefix}-confirm-directManager`]: "直属上级甲",
    [`${prefix}-confirm-jobType`]: "技术",
    [`${prefix}-confirm-jobLevel`]: "P3",
    [`${prefix}-confirm-managementSequence`]: "个人",
    [`${prefix}-confirm-workMode`]: "远程",
    [`${prefix}-confirm-workLocation`]: "中国",
    [`${prefix}-confirm-probationSalary`]: "25000",
    [`${prefix}-confirm-probationPeriod`]: "2个月",
  };
  for (const [id, value] of Object.entries(values)) {
    if (!document.querySelector<HTMLInputElement | HTMLSelectElement>(`#${id}`)?.value) {
      fill(id, value);
    }
  }
}

export function expectEmptyInputWithTitleHint(id: string, text: string) {
  const input = document.querySelector<HTMLInputElement | HTMLSelectElement>(`#${id}`);
  if (!input) {
    throw new Error(`Missing input ${id}`);
  }
  expect(input.getAttribute("placeholder")).toBeNull();
  expect(input.value).toBe("");
  const hint = document.querySelector(`[id="${input.getAttribute("aria-describedby")}"]`);
  expect(hint?.textContent).toBe(text);
  expect(hint?.parentElement?.querySelector("label")?.htmlFor).toBe(id);
}
