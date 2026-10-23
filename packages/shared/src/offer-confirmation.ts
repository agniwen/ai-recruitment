import type { OfferConfirmationDetails } from "@arc/db-schema/offer-confirmation";
import type { OfferCompletionInfo } from "@arc/db-schema/offer-completion";
import type { OfferSscConfirmationStatus } from "@arc/db-schema/studio-interviews";
import { buildOfferInterviewText } from "./offer-interviews";
import type { OfferInterviewRound } from "./offer-interviews";

export type { OfferConfirmationDetails } from "@arc/db-schema/offer-confirmation";

export interface OfferCreationContext {
  defaults: OfferConfirmationDetails;
  interviewRounds: {
    id: string;
    label: string;
    feedback: string | null;
    interviewers: { id: string; name: string }[];
  }[];
  resume: {
    filename: string | null;
    mediaType: string | null;
    available: boolean;
  };
}

const sscStatusText: Record<OfferSscConfirmationStatus, string> = {
  completed: "offer审批已通过",
  confirming: "",
  pending: "",
};

function textOrMissing(value: string | null | undefined, emptyText = "待补充") {
  return value?.trim() || emptyText;
}

function salaryOrMissing(value: number | null | undefined) {
  return value === null || value === undefined ? "待补充" : `${value / 1000}K`;
}

function recordCodeLine(candidateRecordId: string | null | undefined) {
  const code = candidateRecordId?.trim();
  return code ? `\n系统记录编码：${code}` : "";
}

function privateTelegramLine(info: OfferConfirmationDetails | null | undefined) {
  const telegram = info?.candidatePrivateTelegram?.trim();
  return telegram ? `\n候选人私人 TG：${telegram}` : "";
}

function legacyInterviewSection(info: OfferConfirmationDetails | null | undefined) {
  if (!info?.mainInterviewerName?.trim() && !info?.interviewFeedback?.trim()) {
    return "";
  }
  return `#面试评价：\n主要面试官：${textOrMissing(info?.mainInterviewerName)}\n面试评价：${textOrMissing(info?.interviewFeedback)}\n\n`;
}

function completionSections(
  info: OfferCompletionInfo | null | undefined,
  status: OfferSscConfirmationStatus | null | undefined,
) {
  if (!info || (status !== "confirming" && status !== "completed")) {
    return "";
  }
  const recruiterContact = info.recruiterTelegram?.trim();
  return `3️⃣招聘信息
招聘渠道：${textOrMissing(info.recruitingGroupNames.join("、"))}
简历来源：${textOrMissing(info.resumeSource)}
招聘通道：${textOrMissing(info.recruitmentChannel)}
招聘专员／内推人联系方式：${recruiterContact ? `TG—${recruiterContact}` : "待补充"}

4️⃣入职信息
候选人编码：${textOrMissing(info.candidateCode, "未填写")}
候选人姓名：${textOrMissing(info.candidateName)}
入职日期：${textOrMissing(info.preboardingDate)}
候选人联系方式：${textOrMissing(info.candidatePrivateTelegram)}

`;
}

export function buildOfferConfirmationText({
  info,
  candidateRecordId,
  completionInfo,
  position,
  baseSalary,
  currency,
  interviewRounds,
  sscConfirmationStatus,
}: {
  info?: OfferConfirmationDetails | null;
  candidateRecordId?: string | null;
  completionInfo?: OfferCompletionInfo | null;
  position: string | null | undefined;
  baseSalary: number | null | undefined;
  currency: string | null | undefined;
  interviewRounds?: readonly OfferInterviewRound[];
  sscConfirmationStatus?: OfferSscConfirmationStatus | null;
}) {
  return `【offer信息】
候选人编码：${textOrMissing(info?.candidateCode, "未填写")}${recordCodeLine(candidateRecordId)}
简历名：${textOrMissing(info?.candidateName)}
性别：${textOrMissing(info?.gender)}${privateTelegramLine(info)}

1️⃣编制信息：
入职编制组织：${textOrMissing(info?.hiringUnitName)}
入职服务单位：${textOrMissing(info?.serviceUnit)}
人员性质：${textOrMissing(info?.personnelType)}
入职部门：${textOrMissing(info?.departmentName)}
直属上级：${textOrMissing(info?.directManager)}
岗位类型：${textOrMissing(info?.jobType)}
职位：${textOrMissing(position)}
建议职级：${textOrMissing(info?.jobLevel)}
管理序列：${textOrMissing(info?.managementSequence)}
办公方式：${textOrMissing(info?.workMode)}
办公地区：${textOrMissing(info?.workLocation)}

2️⃣薪资信息
薪资货币：${textOrMissing(currency)}
转正薪资：${salaryOrMissing(baseSalary)}
试用期：${textOrMissing(info?.probationPeriod)}
试用薪资：${salaryOrMissing(info?.probationSalary)}

${completionSections(completionInfo, sscConfirmationStatus)}${interviewRounds === undefined ? legacyInterviewSection(info) : `${buildOfferInterviewText(interviewRounds)}\n\n`}${sscStatusText[sscConfirmationStatus ?? "pending"]}`.trimEnd();
}
