import type { OfferConfirmationDetails } from "@arc/db-schema/offer-confirmation";
import type { OfferSscConfirmationStatus } from "@arc/db-schema/studio-interviews";

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
  confirming: "SSC 确认中",
  pending: "待 SSC 确认",
};

function textOrMissing(value: string | null | undefined) {
  return value?.trim() || "待补充";
}

function salaryOrMissing(value: number | null | undefined) {
  return value === null || value === undefined ? "待补充" : `${value / 1000}K`;
}

export function buildOfferConfirmationText({
  info,
  position,
  baseSalary,
  currency,
  sscConfirmationStatus,
}: {
  info?: OfferConfirmationDetails | null;
  position: string | null | undefined;
  baseSalary: number | null | undefined;
  currency: string | null | undefined;
  sscConfirmationStatus?: OfferSscConfirmationStatus | null;
}) {
  return `【offer信息】
候选人编码：${textOrMissing(info?.candidateCode)}
简历名：${textOrMissing(info?.candidateName)}
性别：${textOrMissing(info?.gender)}

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

#面试评价：
主要面试官：${textOrMissing(info?.mainInterviewerName)}
面试评价：${textOrMissing(info?.interviewFeedback)}

${sscStatusText[sscConfirmationStatus ?? "pending"]}`;
}
