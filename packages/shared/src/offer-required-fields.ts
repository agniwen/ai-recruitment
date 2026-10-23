import type { OfferConfirmationDetails } from "@arc/db-schema/offer-confirmation";
import { offerPreboardingDateSchema } from "./offer-preboarding";

export interface OfferRequiredFieldInput {
  position?: string | null;
  baseSalary?: number | null;
  currency?: string | null;
  joiningDate?: string | null;
  confirmationInfo?: Partial<OfferConfirmationDetails> | null;
}

export interface OfferRequiredFieldIssue {
  path: string;
  message: string;
}

const requiredOrganizationFields = [
  ["hiringUnitName", "入职编制组织"],
  ["serviceUnit", "入职服务单位"],
  ["personnelType", "人员性质"],
  ["departmentName", "入职部门"],
  ["directManager", "直属上级"],
  ["jobType", "岗位类型"],
  ["jobLevel", "建议职级"],
  ["managementSequence", "管理序列"],
  ["workMode", "办公方式"],
  ["workLocation", "办公地区"],
] as const;

function salaryIssues(
  value: number | null | undefined,
  path: string,
  label: string,
  minimum: number,
): OfferRequiredFieldIssue[] {
  if (value === null || value === undefined) {
    return [{ message: `请填写${label}`, path }];
  }
  if (!Number.isInteger(value) || value < minimum) {
    return [{ message: `${label}需为${minimum === 0 ? "非负" : "正"}整数`, path }];
  }
  return [];
}

/** Required ODC form fields; legacy Offer snapshots remain readable. */
export function getOfferRequiredFieldIssues(
  input: OfferRequiredFieldInput,
): OfferRequiredFieldIssue[] {
  const issues: OfferRequiredFieldIssue[] = [];
  const info = input.confirmationInfo;
  if (info?.gender !== "男" && info?.gender !== "女") {
    issues.push({ message: "请选择性别（男或女）", path: "confirmationInfo.gender" });
  }
  for (const [key, label] of requiredOrganizationFields) {
    if (!info?.[key]?.trim()) {
      issues.push({ message: `请填写${label}`, path: `confirmationInfo.${key}` });
    }
  }
  if (!input.position?.trim()) {
    issues.push({ message: "请填写职位", path: "position" });
  }
  if (!input.joiningDate?.trim()) {
    issues.push({ message: "请填写期望上岗日期", path: "joiningDate" });
  } else if (!offerPreboardingDateSchema.safeParse(input.joiningDate).success) {
    issues.push({ message: "期望上岗日期请输入有效日期，格式：YYYY-MM-DD", path: "joiningDate" });
  }
  if (!input.currency?.trim()) {
    issues.push({ message: "请填写薪资货币", path: "currency" });
  }
  issues.push(...salaryIssues(input.baseSalary, "baseSalary", "转正薪资（月薪）", 1));
  issues.push(
    ...salaryIssues(
      info?.probationSalary,
      "confirmationInfo.probationSalary",
      "试用薪资（月薪）",
      0,
    ),
  );
  if (!/^(?:[1-9]|1[0-2])个月$/u.test(info?.probationPeriod ?? "")) {
    issues.push({ message: "请选择试用期期限（月）", path: "confirmationInfo.probationPeriod" });
  }
  return issues;
}
