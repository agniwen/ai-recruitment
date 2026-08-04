import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  createAiGeneratedJobDescriptionFormValues,
  createJobDescriptionFormValues,
} from "./job-description-form-values";

const formSource = readFileSync(
  new URL("job-description-form-dialog.tsx", import.meta.url),
  "utf-8",
);
const jobDescriptionsPageSource = readFileSync(
  new URL("job-description-management-page.tsx", import.meta.url),
  "utf-8",
);
const humanDialogSource = readFileSync(
  new URL("../human-interview-stage-dialogs.tsx", import.meta.url),
  "utf-8",
);
const humanPanelSource = readFileSync(
  new URL("../human-interview-stage-panel.tsx", import.meta.url),
  "utf-8",
);
const sidebarSource = readFileSync(
  new URL("../studio-sidebar-slots.tsx", import.meta.url),
  "utf-8",
);

describe("job description recruiting defaults", () => {
  it("renders priority, work schedule, AI interviewer, and human interviewer fields", () => {
    expect(formSource).toContain('<form.Field name="priority">');
    expect(formSource).toContain("P0（紧急/高）");
    expect(formSource).toContain("P1（中）");
    expect(formSource).toContain("P2（低）");
    expect(formSource).toContain('<form.Field name="workStartTime">');
    expect(formSource).toContain('<form.Field name="workEndTime">');
    expect(formSource).toContain('type="time"');
    expect(formSource).toContain('<form.Field name="workTimezone">');
    expect(formSource).toContain("WORK_TIMEZONE_OPTIONS");
    expect(formSource).toContain("Asia/Shanghai");
    expect(formSource).toContain("选择工作时区");
    expect(formSource).toContain('<form.Field name="requester">');
    expect(formSource).toContain('<form.Field name="resumeContact">');
    expect(formSource).toContain("CONTACT_MAX_LENGTH = 500");
    expect(formSource).toContain("AI面试官");
    expect(formSource).toContain("AI面试官（可选）");
    expect(formSource).toContain('<form.Field name="humanInterviewerIds">');
    expect(formSource).toContain("真人面试官（可选）");
  });

  it("exposes Google Sheet mapped fields on the basic tab", () => {
    for (const field of [
      "recruitmentStatus",
      "controlCategory",
      "jobSeries",
      "jobLevel",
      "serviceUnit",
      "workLocation",
      "sourceSheet",
      "salaryRangeRaw",
      "headcount",
      "onboardedCount",
      "gapCount",
      "offeredPendingOnboardCount",
      "requestedDate",
      "expectedOnboardDate",
      "notes",
    ]) {
      expect(formSource).toContain(`<form.Field name="${field}">`);
    }
    expect(formSource).toContain("基础信息");
    expect(formSource).toContain("招聘进度");
    expect(formSource).toContain("薪资范围");
    expect(formSource).toContain("备注说明");
    expect(formSource).toContain("DatePicker");
    expect(formSource).not.toContain('type="date"');
  });

  it("shows read-only hiring unit, preferring job-level Google sheet org", () => {
    expect(formSource).toContain("编制组织");
    expect(formSource).toContain("selectedDepartmentHiringUnitName");
    expect(formSource).toContain("record?.hiringUnitName");
    expect(formSource).toContain('creationSource === "google_sheets"');
    expect(formSource).toContain('id="job-description-hiring-unit"');
    expect(formSource).toContain("disabled");
    expect(formSource).toContain("readOnly");
    expect(formSource).not.toContain('<form.Field name="hiringUnitId">');
    expect(formSource).not.toContain('<form.Field name="hiringUnitName">');
  });

  it("shows hiring unit column on the job descriptions table", () => {
    expect(jobDescriptionsPageSource).toContain('title: "编制组织"');
    expect(jobDescriptionsPageSource).toContain('key: "hiringUnitName"');
    expect(jobDescriptionsPageSource).toContain("r.hiringUnitName");
  });

  it("shows google sheet deleted status on the table and as a read-only detail field", () => {
    expect(jobDescriptionsPageSource).toContain('key: "googleSheetDeleted"');
    expect(jobDescriptionsPageSource).toContain('title: "Google 文档"');
    expect(formSource).toContain("Google 文档是否已删除");
    expect(formSource).toContain('id="job-description-google-sheet-deleted"');
    expect(formSource).toContain("record?.googleSheetDeleted");
    expect(formSource).not.toContain('<form.Field name="googleSheetDeleted">');
  });

  it("shows scrollable full-content hover cards for long job fields", () => {
    expect(jobDescriptionsPageSource).toContain("JobDescriptionLongTextHoverCard");
    expect(jobDescriptionsPageSource).toContain("value={r.prompt}");
    expect(jobDescriptionsPageSource).toContain("value={r.notes}");
    expect(jobDescriptionsPageSource).toContain("value={r.description}");
  });

  it("keeps Google Sheet fields ordered and pins actions right of the stable id", () => {
    const columnsSource = jobDescriptionsPageSource.slice(
      jobDescriptionsPageSource.indexOf("const columns = useMemo"),
      jobDescriptionsPageSource.indexOf("const filtersConfig = useMemo"),
    );
    const sheetColumnKeys = [
      "name",
      "hiringUnitName",
      "recruitmentStatus",
      "controlCategory",
      "jobSeries",
      "jobLevel",
      "serviceUnit",
      "departmentName",
      "headcount",
      "onboardedCount",
      "gapCount",
      "offeredPendingOnboardCount",
      "requestedDate",
      "expectedOnboardDate",
      "priority",
      "requester",
      "resumeContact",
      "prompt",
      "salary",
      "notes",
      "sourceSheet",
      "workLocation",
    ];
    const positions = sheetColumnKeys.map((key) => columnsSource.indexOf(`key: "${key}"`));
    const lastSheetPosition = positions.at(-1) ?? -1;

    expect(positions.every((position) => position >= 0)).toBe(true);
    expect(positions).toEqual([...positions].toSorted((left, right) => left - right));
    for (const systemColumnMarker of [
      "jobDescriptionSourceColumn",
      'key: "googleSheetDeleted"',
      'key: "interviewers"',
      'key: "resumeCount"',
      'key: "description"',
      'key: "createdAt"',
      "actionsColumn<JobDescriptionListRecord>",
      'key: "code"',
    ]) {
      expect(columnsSource.indexOf(systemColumnMarker)).toBeGreaterThan(lastSheetPosition);
    }
    expect(columnsSource.indexOf("actionsColumn<JobDescriptionListRecord>")).toBeGreaterThan(
      columnsSource.indexOf('key: "code"'),
    );
    expect(jobDescriptionsPageSource).toContain('end: ["code", "actions"]');
    expect(jobDescriptionsPageSource).toContain('start: ["name", "hiringUnitName"]');
    expect(columnsSource).not.toContain('title: "HC/缺口"');
  });

  it("disables AI interviews by default for every new-job entry point", () => {
    expect(createJobDescriptionFormValues().aiInterviewDisabled).toBe(true);
    const aiDraft = createAiGeneratedJobDescriptionFormValues({
      departmentId: "department-1",
      description: "岗位描述",
      name: "前端工程师",
      prompt: "岗位要求",
    });
    expect(aiDraft.aiInterviewDisabled).toBe(true);
    expect(aiDraft).toMatchObject({
      controlCategory: null,
      requester: null,
      resumeContact: null,
      workEndTime: null,
      workStartTime: null,
      workTimezone: null,
    });
  });

  it("defaults new human interview rounds from the linked job", () => {
    expect(humanPanelSource).toContain(
      "defaultInterviewerIds={resumeJobDescriptionHumanInterviewerIds}",
    );
    expect(humanDialogSource).toContain("defaultInterviewerIds?: string[];");
    expect(humanDialogSource).toContain("setInterviewerIds([...defaultInterviewerIds])");
  });

  it("renames the interviewer navigation entry", () => {
    expect(sidebarSource).toContain('title: "AI面试官设置"');
  });
});
