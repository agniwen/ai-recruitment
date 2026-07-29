import { and, eq, inArray, sql } from "drizzle-orm";
import { db } from "@arc/ai-recruitment-copilot-backend/lib/server/db";
import { department, hiringUnit, jobDescription } from "@arc/db-schema/schema";
import {
  createDefaultResumeScreeningPolicy,
  jobDescriptionCodeSchema,
} from "@arc/shared/job-descriptions";
import type {
  JobDescriptionGoogleSheetsSyncResult,
  JobDescriptionGoogleSheetsSyncSkippedRow,
  JobDescriptionGoogleSheetsSyncWarning,
  JobDescriptionPriority,
} from "@arc/shared/job-descriptions";
import { computeResumeScreeningPolicyHash } from "@arc/shared/resume-screening";

const HEADERS = {
  code: "稳定唯一值",
  controlCategory: "岗位管控分类",
  departmentName: "部门",
  expectedOnboardDate: "期望到岗日期",
  gapCount: "缺口",
  headcount: "HC",
  hiringUnitName: "编制组织",
  jobLevel: "职级",
  jobSeries: "序列",
  name: "岗位名称",
  notes: "备注说明\n非远程岗位请备注说明工作地点",
  offeredPendingOnboardCount: "已发offer待入职",
  onboardedCount: "已到岗",
  priority: "优先级",
  prompt: "JD(必填) 岗位职责+任职要求",
  recruitmentStatus: "招聘状态",
  requestedDate: "提需日期",
  requester: "需求发起人",
  resumeContact: "简历对接人\n (花名 & @TG)",
  salaryRangeRaw: "薪资范围",
  serviceUnit: "服务单位",
  sourceSheet: "来源表格",
  workLocation: "工作地点",
} as const;

/** Sheet rows with an empty 部门 cell fall back to this existing department name. */
export const DEFAULT_GOOGLE_SHEET_DEPARTMENT_NAME = "默认部门";

const REQUIRED_HEADERS = Object.values(HEADERS);

type NullableMappedValue = number | string | null | undefined;

export interface GoogleSheetJobRecord {
  code: string;
  controlCategory: string | null;
  /**
   * Resolved department name for creates when the sheet cell is empty
   * (`DEFAULT_GOOGLE_SHEET_DEPARTMENT_NAME`). See `departmentSpecified`.
   */
  departmentName: string;
  /**
   * true when the sheet 部门 cell is non-empty.
   * false when empty — create uses 默认部门; update keeps the existing departmentId.
   */
  departmentSpecified: boolean;
  expectedOnboardDate: string | null | undefined;
  gapCount: number | null | undefined;
  headcount: number | null | undefined;
  hiringUnitName: string;
  jobLevel: string | null;
  jobSeries: string | null;
  name: string;
  notes: string | null;
  offeredPendingOnboardCount: number | null | undefined;
  onboardedCount: number | null | undefined;
  priority: JobDescriptionPriority | undefined;
  prompt: string;
  recruitmentStatus: string | null;
  requestedDate: string | null | undefined;
  requester: string | null;
  resumeContact: string | null;
  rowNumber: number;
  salaryRangeRaw: string | null;
  serviceUnit: string | null;
  sourceSheet: string | null;
  workLocation: string | null;
}

export interface GoogleSheetJobValues {
  controlCategory: string | null;
  /**
   * undefined = do not write departmentId (update keeps existing when sheet 部门 is empty).
   */
  departmentId: string | undefined;
  expectedOnboardDate: string | null | undefined;
  gapCount: number | null | undefined;
  headcount: number | null | undefined;
  /** Direct job-level 编制组织 from sheet column (not via department). */
  hiringUnitId: string;
  jobLevel: string | null;
  jobSeries: string | null;
  name: string;
  notes: string | null;
  offeredPendingOnboardCount: number | null | undefined;
  onboardedCount: number | null | undefined;
  priority: JobDescriptionPriority | undefined;
  prompt: string;
  recruitmentStatus: string | null;
  requestedDate: string | null | undefined;
  requester: string | null;
  resumeContact: string | null;
  salaryRangeRaw: string | null;
  serviceUnit: string | null;
  sourceSheet: string | null;
  workLocation: string | null;
}

export class GoogleSheetFormatError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GoogleSheetFormatError";
  }
}

function cellText(row: unknown[], index: number | undefined): string {
  if (index === undefined) {
    return "";
  }
  const value = row[index];
  return typeof value === "string" || typeof value === "number" ? String(value).trim() : "";
}

function nullableText(value: string): string | null {
  return value || null;
}

function normalizeIdentity(value: string): string {
  return value.normalize("NFKC").replaceAll(/\s+/g, " ").trim().toLocaleLowerCase("zh-CN");
}

function normalizeDate(value: string): string | null | undefined {
  if (!value) {
    return null;
  }
  const match = /^(\d{4})[-./](\d{1,2})[-./](\d{1,2})$/.exec(value);
  if (!match) {
    return;
  }
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return;
  }
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function normalizeCount(value: string): number | null | undefined {
  if (!value) {
    return null;
  }
  if (!/^\d+$/.test(value)) {
    return;
  }
  return Number(value);
}

function normalizePriority(value: string): JobDescriptionPriority | undefined {
  const match = /^(P[0-2])/.exec(value.toUpperCase());
  return match?.[1] as JobDescriptionPriority | undefined;
}

function hasAnyValue(row: unknown[]): boolean {
  return row.some((value) => String(value ?? "").trim());
}

function findMissingRequiredFields(fields: [label: string, value: string][]): string[] {
  return fields.filter(([, value]) => value === "").map(([label]) => label);
}

export function parseGoogleSheetJobRows(values: unknown[][]): {
  records: GoogleSheetJobRecord[];
  skipped: JobDescriptionGoogleSheetsSyncSkippedRow[];
  warnings: JobDescriptionGoogleSheetsSyncWarning[];
} {
  const rawHeaders = values[0] ?? [];
  const headerIndexes = new Map(
    rawHeaders.map((header, index) => [String(header ?? "").trim(), index]),
  );
  const missingHeaders = REQUIRED_HEADERS.filter((header) => !headerIndexes.has(header));
  if (missingHeaders.length > 0) {
    throw new GoogleSheetFormatError(`汇总表缺少字段：${missingHeaders.join("、")}`);
  }

  const rows = values
    .slice(1)
    .map((row, index) => ({ row, rowNumber: index + 2 }))
    .filter(({ row }) => hasAnyValue(row));
  const validCodesByRow = new Map<number, string>();
  const codeRows = new Map<string, number[]>();
  for (const { row, rowNumber } of rows) {
    const rawCode = cellText(row, headerIndexes.get(HEADERS.code));
    const parsedCode = jobDescriptionCodeSchema.safeParse(rawCode);
    if (!parsedCode.success || !parsedCode.data) {
      continue;
    }
    validCodesByRow.set(rowNumber, parsedCode.data);
    codeRows.set(parsedCode.data, [...(codeRows.get(parsedCode.data) ?? []), rowNumber]);
  }
  const duplicateCodes = new Set(
    [...codeRows.entries()].filter(([, rowNumbers]) => rowNumbers.length > 1).map(([code]) => code),
  );

  const records: GoogleSheetJobRecord[] = [];
  const skipped: JobDescriptionGoogleSheetsSyncSkippedRow[] = [];
  const warnings: JobDescriptionGoogleSheetsSyncWarning[] = [];

  for (const { row, rowNumber } of rows) {
    const code = validCodesByRow.get(rowNumber);
    if (!code) {
      skipped.push({
        code: nullableText(cellText(row, headerIndexes.get(HEADERS.code))),
        reason: "稳定唯一值缺失或格式无效。",
        rowNumber,
      });
      continue;
    }
    if (duplicateCodes.has(code)) {
      skipped.push({ code, reason: "稳定唯一值在表格中重复。", rowNumber });
      continue;
    }

    const name = cellText(row, headerIndexes.get(HEADERS.name));
    const hiringUnitName = cellText(row, headerIndexes.get(HEADERS.hiringUnitName));
    const rawDepartmentName = cellText(row, headerIndexes.get(HEADERS.departmentName));
    const departmentSpecified = Boolean(rawDepartmentName);
    const departmentName = rawDepartmentName || DEFAULT_GOOGLE_SHEET_DEPARTMENT_NAME;
    // JD/prompt is optional on sheet sync; DB column is NOT NULL so store "".
    const prompt = cellText(row, headerIndexes.get(HEADERS.prompt));
    const missingRequired = findMissingRequiredFields([
      ["岗位名称", name],
      ["编制组织", hiringUnitName],
    ]);
    if (missingRequired.length > 0) {
      skipped.push({
        code,
        reason: `缺少必填字段：${missingRequired.join("、")}。`,
        rowNumber,
      });
      continue;
    }
    if (!departmentSpecified) {
      warnings.push({
        code,
        field: HEADERS.departmentName,
        message: `部门为空：新建岗位归入「${DEFAULT_GOOGLE_SHEET_DEPARTMENT_NAME}」，已有岗位保留本系统部门；编制组织仍按表格写入。`,
        rowNumber,
      });
    }
    if (!prompt) {
      warnings.push({
        code,
        field: HEADERS.prompt,
        message: "JD 为空，已按空岗位说明导入。",
        rowNumber,
      });
    }

    const rawRequestedDate = cellText(row, headerIndexes.get(HEADERS.requestedDate));
    const requestedDate = normalizeDate(rawRequestedDate);
    const rawExpectedOnboardDate = cellText(row, headerIndexes.get(HEADERS.expectedOnboardDate));
    const expectedOnboardDate = normalizeDate(rawExpectedOnboardDate);
    const rawPriority = cellText(row, headerIndexes.get(HEADERS.priority));
    const priority = normalizePriority(rawPriority);
    const countFields = [
      [HEADERS.headcount, "headcount"],
      [HEADERS.onboardedCount, "onboardedCount"],
      [HEADERS.gapCount, "gapCount"],
      [HEADERS.offeredPendingOnboardCount, "offeredPendingOnboardCount"],
    ] as const;
    const counts = Object.fromEntries(
      countFields.map(([header, field]) => [
        field,
        normalizeCount(cellText(row, headerIndexes.get(header))),
      ]),
    ) as Pick<
      GoogleSheetJobRecord,
      "gapCount" | "headcount" | "offeredPendingOnboardCount" | "onboardedCount"
    >;

    for (const [header, field] of countFields) {
      const rawValue = cellText(row, headerIndexes.get(header));
      if (rawValue && counts[field] === undefined) {
        warnings.push({
          code,
          field: header,
          message: `无法识别整数“${rawValue}”，新岗位将留空，已有岗位保留原值。`,
          rowNumber,
        });
      }
    }
    for (const [header, rawValue, normalizedValue] of [
      [HEADERS.requestedDate, rawRequestedDate, requestedDate],
      [HEADERS.expectedOnboardDate, rawExpectedOnboardDate, expectedOnboardDate],
    ] as const) {
      if (rawValue && normalizedValue === undefined) {
        warnings.push({
          code,
          field: header,
          message: `无法识别日期“${rawValue}”，新岗位将留空，已有岗位保留原值。`,
          rowNumber,
        });
      }
    }
    if (rawPriority && priority === undefined) {
      warnings.push({
        code,
        field: HEADERS.priority,
        message: `无法识别优先级“${rawPriority}”，新岗位使用 P0，已有岗位保留原值。`,
        rowNumber,
      });
    }

    records.push({
      ...counts,
      code,
      controlCategory: nullableText(cellText(row, headerIndexes.get(HEADERS.controlCategory))),
      departmentName,
      departmentSpecified,
      expectedOnboardDate,
      hiringUnitName,
      jobLevel: nullableText(cellText(row, headerIndexes.get(HEADERS.jobLevel))),
      jobSeries: nullableText(cellText(row, headerIndexes.get(HEADERS.jobSeries))),
      name,
      notes: nullableText(cellText(row, headerIndexes.get(HEADERS.notes))),
      priority,
      prompt,
      recruitmentStatus: nullableText(cellText(row, headerIndexes.get(HEADERS.recruitmentStatus))),
      requestedDate,
      requester: nullableText(cellText(row, headerIndexes.get(HEADERS.requester))),
      resumeContact: nullableText(cellText(row, headerIndexes.get(HEADERS.resumeContact))),
      rowNumber,
      salaryRangeRaw: nullableText(cellText(row, headerIndexes.get(HEADERS.salaryRangeRaw))),
      serviceUnit: nullableText(cellText(row, headerIndexes.get(HEADERS.serviceUnit))),
      sourceSheet: nullableText(cellText(row, headerIndexes.get(HEADERS.sourceSheet))),
      workLocation: nullableText(cellText(row, headerIndexes.get(HEADERS.workLocation))),
    });
  }

  return { records, skipped, warnings };
}

/**
 * Build sheet → job field patch.
 * - `departmentId: undefined` means "do not touch department" (empty sheet 部门 on update).
 * - `hiringUnitId` is always the sheet 编制组织 (job-level, not via department).
 */
export function buildGoogleSheetJobValues(
  record: GoogleSheetJobRecord,
  departmentId: string | undefined,
  hiringUnitId: string,
): GoogleSheetJobValues {
  return {
    controlCategory: record.controlCategory,
    departmentId,
    expectedOnboardDate: record.expectedOnboardDate,
    gapCount: record.gapCount,
    headcount: record.headcount,
    hiringUnitId,
    jobLevel: record.jobLevel,
    jobSeries: record.jobSeries,
    name: record.name,
    notes: record.notes,
    offeredPendingOnboardCount: record.offeredPendingOnboardCount,
    onboardedCount: record.onboardedCount,
    priority: record.priority,
    prompt: record.prompt,
    recruitmentStatus: record.recruitmentStatus,
    requestedDate: record.requestedDate,
    requester: record.requester,
    resumeContact: record.resumeContact,
    salaryRangeRaw: record.salaryRangeRaw,
    serviceUnit: record.serviceUnit,
    sourceSheet: record.sourceSheet,
    workLocation: record.workLocation,
  };
}

export function hasGoogleSheetJobChanges(
  existing: Partial<Record<keyof GoogleSheetJobValues, NullableMappedValue>>,
  next: GoogleSheetJobValues,
): boolean {
  return Object.entries(next).some(
    ([field, value]) =>
      value !== undefined && existing[field as keyof GoogleSheetJobValues] !== value,
  );
}

function definedJobValues(values: GoogleSheetJobValues) {
  return Object.fromEntries(
    Object.entries(values).filter(([, value]) => value !== undefined),
  ) as Omit<GoogleSheetJobValues, "expectedOnboardDate" | "priority" | "requestedDate"> &
    Partial<Pick<GoogleSheetJobValues, "expectedOnboardDate" | "priority" | "requestedDate">>;
}

export async function syncGoogleSheetJobDescriptions({
  actorUserId,
  organizationId,
  values,
}: {
  actorUserId: string | null | undefined;
  organizationId: string;
  values: unknown[][];
}): Promise<JobDescriptionGoogleSheetsSyncResult & { changedJobIds: string[] }> {
  const parsed = parseGoogleSheetJobRows(values);
  const now = new Date();
  const changedJobIds: string[] = [];
  const counts = await db.transaction(
    // oxlint-disable-next-line complexity -- the transaction deliberately keeps hierarchy and job writes atomic.
    async (tx) => {
      await tx.execute(
        sql`SELECT pg_advisory_xact_lock(hashtextextended(${`google-sheets-job-sync:${organizationId}`}, 0))`,
      );

      const hiringUnitRows = await tx
        .select({ id: hiringUnit.id, name: hiringUnit.name })
        .from(hiringUnit)
        .where(eq(hiringUnit.organizationId, organizationId));
      const hiringUnitsByName = new Map<string, { id: string; name: string }>();
      for (const row of hiringUnitRows) {
        const key = normalizeIdentity(row.name);
        if (!hiringUnitsByName.has(key)) {
          hiringUnitsByName.set(key, row);
        }
      }

      const departmentRows = await tx
        .select({
          hiringUnitId: department.hiringUnitId,
          id: department.id,
          name: department.name,
        })
        .from(department)
        .where(eq(department.organizationId, organizationId));
      // Keyed by hiringUnitId + department name. Empty sheet departments map to
      //「默认部门」under that sheet row's 编制组织 — never borrow a default dept
      // from another hiring unit (编制组织 is written on the job itself).
      const departmentsByName = new Map<string, { id: string; name: string }>();
      for (const row of departmentRows) {
        if (!row.hiringUnitId) {
          continue;
        }
        const key = `${row.hiringUnitId}\u0000${normalizeIdentity(row.name)}`;
        if (!departmentsByName.has(key)) {
          departmentsByName.set(key, row);
        }
      }

      const existingJobs = await tx
        .select({
          code: jobDescription.code,
          controlCategory: jobDescription.controlCategory,
          creationSource: jobDescription.creationSource,
          departmentId: jobDescription.departmentId,
          expectedOnboardDate: jobDescription.expectedOnboardDate,
          gapCount: jobDescription.gapCount,
          googleSheetDeleted: jobDescription.googleSheetDeleted,
          headcount: jobDescription.headcount,
          hiringUnitId: jobDescription.hiringUnitId,
          id: jobDescription.id,
          jobLevel: jobDescription.jobLevel,
          jobSeries: jobDescription.jobSeries,
          name: jobDescription.name,
          notes: jobDescription.notes,
          offeredPendingOnboardCount: jobDescription.offeredPendingOnboardCount,
          onboardedCount: jobDescription.onboardedCount,
          priority: jobDescription.priority,
          prompt: jobDescription.prompt,
          recruitmentStatus: jobDescription.recruitmentStatus,
          requestedDate: jobDescription.requestedDate,
          requester: jobDescription.requester,
          resumeContact: jobDescription.resumeContact,
          salaryRangeRaw: jobDescription.salaryRangeRaw,
          serviceUnit: jobDescription.serviceUnit,
          sourceSheet: jobDescription.sourceSheet,
          workLocation: jobDescription.workLocation,
        })
        .from(jobDescription)
        .where(eq(jobDescription.organizationId, organizationId));
      const jobsByCode = new Map(
        existingJobs.flatMap((row) => (row.code ? [[row.code, row] as const] : [])),
      );
      const sheetCodes = new Set(parsed.records.map((record) => record.code));

      let hiringUnitsCreated = 0;
      let departmentsCreated = 0;
      let jobsCreated = 0;
      let jobsUpdated = 0;
      let jobsUnchanged = 0;
      const defaultPolicy = createDefaultResumeScreeningPolicy();
      const defaultPolicyHash = computeResumeScreeningPolicyHash(defaultPolicy);

      for (const record of parsed.records) {
        const hiringUnitKey = normalizeIdentity(record.hiringUnitName);
        let unit = hiringUnitsByName.get(hiringUnitKey);
        if (!unit) {
          unit = { id: crypto.randomUUID(), name: record.hiringUnitName };
          await tx.insert(hiringUnit).values({
            createdAt: now,
            createdBy: actorUserId ?? null,
            description: null,
            id: unit.id,
            name: unit.name,
            organizationId,
            updatedAt: now,
          });
          hiringUnitsByName.set(hiringUnitKey, unit);
          hiringUnitsCreated += 1;
        }

        // Resolve department only when we need to write it:
        // - sheet 部门 has a value → resolve/create under this 编制组织
        // - sheet 部门 empty + create →「默认部门」under this 编制组织
        // - sheet 部门 empty + update → leave existing departmentId untouched
        const existing = jobsByCode.get(record.code);
        const shouldWriteDepartment = record.departmentSpecified || !existing;
        let departmentIdForWrite: string | undefined;
        if (shouldWriteDepartment) {
          const departmentKey = `${unit.id}\u0000${normalizeIdentity(record.departmentName)}`;
          let departmentRow = departmentsByName.get(departmentKey);
          if (!departmentRow) {
            departmentRow = { id: crypto.randomUUID(), name: record.departmentName };
            await tx.insert(department).values({
              createdAt: now,
              createdBy: actorUserId ?? null,
              description: null,
              hiringUnitId: unit.id,
              id: departmentRow.id,
              name: departmentRow.name,
              organizationId,
              updatedAt: now,
            });
            departmentsByName.set(departmentKey, departmentRow);
            departmentsCreated += 1;
          }
          departmentIdForWrite = departmentRow.id;
        }

        // Sync semantics (sheet is source of truth for mapped fields only):
        // - present in sheet → googleSheetDeleted=false, hiringUnitId=sheet 编制组织
        // - missing from sheet → google_sheets jobs get googleSheetDeleted=true (below)
        // - empty sheet 部门 on update does not clobber an existing departmentId
        const mappedValues = buildGoogleSheetJobValues(record, departmentIdForWrite, unit.id);
        if (existing) {
          const needsDeletedFlagClear = existing.googleSheetDeleted !== false;
          if (!hasGoogleSheetJobChanges(existing, mappedValues) && !needsDeletedFlagClear) {
            jobsUnchanged += 1;
            continue;
          }
          const updateValues = definedJobValues(mappedValues);
          await tx
            .update(jobDescription)
            .set({ ...updateValues, googleSheetDeleted: false, updatedAt: now })
            .where(
              and(
                eq(jobDescription.id, existing.id),
                eq(jobDescription.organizationId, organizationId),
              ),
            );
          existing.googleSheetDeleted = false;
          existing.hiringUnitId = unit.id;
          if (departmentIdForWrite) {
            existing.departmentId = departmentIdForWrite;
          }
          jobsUpdated += 1;
          changedJobIds.push(existing.id);
          continue;
        }

        if (!departmentIdForWrite) {
          // Create path must always have a department (NOT NULL column).
          throw new Error(`Google 同步缺少部门：${record.code}`);
        }

        const id = crypto.randomUUID();
        const insertValues = definedJobValues(mappedValues);
        await tx.insert(jobDescription).values({
          ...insertValues,
          aiInterviewDisabled: true,
          allowCrossDepartmentInterviewers: false,
          code: record.code,
          createdAt: now,
          createdBy: actorUserId ?? null,
          creationSource: "google_sheets",
          departmentId: departmentIdForWrite,
          description: null,
          expectedOnboardDate: record.expectedOnboardDate ?? null,
          feishuChatBoundAt: null,
          feishuChatBoundBy: null,
          feishuChatId: null,
          gapCount: record.gapCount ?? null,
          googleSheetDeleted: false,
          headcount: record.headcount ?? null,
          hiringUnitId: unit.id,
          id,
          offeredPendingOnboardCount: record.offeredPendingOnboardCount ?? null,
          onboardedCount: record.onboardedCount ?? null,
          organizationId,
          presetQuestions: [],
          priority: record.priority ?? "P0",
          requestedDate: record.requestedDate ?? null,
          resumeScreeningPolicy: defaultPolicy,
          resumeScreeningPolicyHash: defaultPolicyHash,
          resumeScreeningPolicyVersion: defaultPolicy.version,
          salaryCurrency: null,
          salaryMaxAmount: null,
          salaryMinAmount: null,
          updatedAt: now,
          workEndTime: null,
          workStartTime: null,
          workTimezone: null,
        });
        jobsByCode.set(record.code, {
          ...mappedValues,
          code: record.code,
          creationSource: "google_sheets" as const,
          departmentId: departmentIdForWrite,
          expectedOnboardDate: record.expectedOnboardDate ?? null,
          gapCount: record.gapCount ?? null,
          googleSheetDeleted: false,
          headcount: record.headcount ?? null,
          hiringUnitId: unit.id,
          id,
          offeredPendingOnboardCount: record.offeredPendingOnboardCount ?? null,
          onboardedCount: record.onboardedCount ?? null,
          priority: record.priority ?? "P0",
          requestedDate: record.requestedDate ?? null,
        });
        jobsCreated += 1;
        changedJobIds.push(id);
      }

      // Only Google-synced rows: code exists here but not in this sheet snapshot → deleted on Google.
      // Manual jobs with unrelated codes are left alone (googleSheetDeleted stays null).
      const deletedJobIds = existingJobs
        .filter(
          (job) =>
            job.creationSource === "google_sheets" &&
            Boolean(job.code) &&
            !sheetCodes.has(job.code as string) &&
            job.googleSheetDeleted !== true,
        )
        .map((job) => job.id);
      if (deletedJobIds.length > 0) {
        await tx
          .update(jobDescription)
          .set({ googleSheetDeleted: true, updatedAt: now })
          .where(
            and(
              eq(jobDescription.organizationId, organizationId),
              inArray(jobDescription.id, deletedJobIds),
            ),
          );
        for (const id of deletedJobIds) {
          if (!changedJobIds.includes(id)) {
            changedJobIds.push(id);
          }
        }
      }

      return {
        departmentsCreated,
        hiringUnitsCreated,
        jobsCreated,
        jobsUnchanged,
        jobsUpdated,
      };
    },
  );

  return {
    ...counts,
    changedJobIds,
    processedRows: parsed.records.length + parsed.skipped.length,
    skipped: parsed.skipped,
    warnings: parsed.warnings,
  };
}
