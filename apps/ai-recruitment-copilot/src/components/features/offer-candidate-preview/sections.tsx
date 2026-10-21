import {
  humanInterviewFormatMeta,
  humanInterviewRoundOutcomeMeta,
} from "@arc/db-schema/studio-interviews";
import type { OfferCandidatePreview } from "@arc/shared/offer-candidate-preview";
import { DataField } from "@/components/features/display/data-field";
import { DataFields } from "@/components/features/display/data-fields";
import { ResumeReviewStructuredView } from "@/components/features/studio/resumes/resume-overview-panel";
import { OfferConfirmationText } from "@/components/features/studio/offer-creation-confirmation";
import { Badge } from "@/components/ui/badge";

const SSC_STATUS_LABELS = {
  completed: "已完成 SSC 确认",
  confirming: "确认中",
  pending: "待 SSC 接收",
} as const;

const SCREENING_STATUS_LABELS = {
  fail: "未满足",
  pass: "满足",
  unknown: "待核实",
} as const;
const SCREENING_SEVERITY_LABELS = {
  blocking: "阻断",
  info: "信息",
  warning: "提醒",
} as const;
const SCREENING_RECOMMENDATION_LABELS = {
  flag: "需人工核实",
  hold: "暂缓推进",
  pass: "通过",
} as const;
const SCREENING_STATUS_ORDER = { fail: 0, pass: 2, unknown: 1 } as const;

function salary(value: number | null, currency: string) {
  return value === null ? null : `${currency} ${value.toLocaleString("zh-CN")}`;
}

export function OfferDetails({ offer }: { offer: OfferCandidatePreview["offer"] }) {
  return (
    <section aria-labelledby="offer-title" className="rounded-xl border bg-card p-5 sm:p-6">
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <h2 className="font-semibold text-lg" id="offer-title">
          本次 Offer · v{offer.version}
        </h2>
        <Badge variant="outline">{SSC_STATUS_LABELS[offer.sscConfirmationStatus]}</Badge>
      </div>
      <DataFields columns={2}>
        <DataField label="Offer 职位" value={offer.position} />
        <DataField label="Base 月薪" value={salary(offer.baseSalary, offer.currency)} />
        <DataField label="年度奖金" value={salary(offer.bonus, offer.currency)} />
        <DataField label="股权" value={offer.equity} />
        <DataField kind="date" label="预计入职日期" value={offer.joiningDate} />
        <DataField kind="datetime" label="Offer 有效期至" value={offer.expiresAt} />
        <DataField kind="datetime" label="SSC 接收时间" value={offer.sscReceivedAt} />
        <DataField kind="datetime" label="SSC 完成时间" value={offer.sscCompletedAt} />
        <DataField
          label="备注"
          span="full"
          value={offer.notes}
          valueClassName="whitespace-pre-wrap"
        />
      </DataFields>
      {offer.confirmationInfo ? (
        <div className="mt-5 min-w-0">
          <OfferConfirmationText
            info={offer.confirmationInfo}
            position={offer.position}
            baseSalary={offer.baseSalary}
            currency={offer.currency}
            sscConfirmationStatus={offer.sscConfirmationStatus}
          />
        </div>
      ) : null}
    </section>
  );
}

function ScreeningDetails({ screening }: { screening: OfferCandidatePreview["screening"] }) {
  const { result } = screening;
  const rules = (result?.ruleResults ?? []).toSorted(
    (a, b) => SCREENING_STATUS_ORDER[a.status] - SCREENING_STATUS_ORDER[b.status],
  );
  let emptyMessage = "未评估";
  if (result?.policyEmpty) {
    emptyMessage = "该岗位未启用具体筛选规则。";
  } else if (screening.status === "processing") {
    emptyMessage = "正在检查岗位规则，完成后会在这里展示。";
  } else if (screening.status === "failed") {
    emptyMessage = "岗位规则检查暂不可用。";
  }
  return (
    <section aria-labelledby="screening-title" className="rounded-xl border bg-card p-5 sm:p-6">
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <h2 className="font-semibold text-lg" id="screening-title">
          岗位规则检查
        </h2>
        {result ? (
          <Badge variant="outline">{SCREENING_RECOMMENDATION_LABELS[result.recommendation]}</Badge>
        ) : null}
      </div>
      {rules.length > 0 ? (
        <ul className="divide-y divide-border/50">
          {rules.map((rule, index) => (
            <li className="space-y-2 py-4 first:pt-0 last:pb-0" key={`${rule.label}-${index}`}>
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant="outline">{SCREENING_STATUS_LABELS[rule.status]}</Badge>
                <Badge variant="outline">{SCREENING_SEVERITY_LABELS[rule.severity]}</Badge>
                <h3 className="font-medium text-sm">{rule.label}</h3>
              </div>
              <p className="whitespace-pre-wrap text-muted-foreground text-sm leading-6">
                {rule.reason}
              </p>
              {rule.evidence.length > 0 ? (
                <ul className="space-y-1 text-muted-foreground text-xs leading-5">
                  {rule.evidence.map((evidence, evidenceIndex) => (
                    <li key={evidenceIndex}>
                      {evidence.quote ? `“${evidence.quote}”` : evidence.explanation}
                    </li>
                  ))}
                </ul>
              ) : null}
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-muted-foreground text-sm">{emptyMessage}</p>
      )}
    </section>
  );
}

export function AiReviewDetails({ data }: { data: OfferCandidatePreview }) {
  return (
    <div className="space-y-6">
      <ResumeReviewStructuredView review={data.aiReview.review} status={data.aiReview.status} />
      <ScreeningDetails screening={data.screening} />
      {data.aiReview.generatedAt ? (
        <DataFields columns={1}>
          <DataField kind="datetime" label="AI 评分生成时间" value={data.aiReview.generatedAt} />
        </DataFields>
      ) : null}
    </div>
  );
}

function roundStatus(round: OfferCandidatePreview["humanInterviews"][number]) {
  if (round.status === "cancelled") {
    return "已取消";
  }
  if (round.status === "completed") {
    return round.outcome
      ? `已完成 · ${humanInterviewRoundOutcomeMeta[round.outcome].label}`
      : "已完成";
  }
  return round.scheduledAt ? "待面试" : "待安排";
}

export function HumanInterviewDetails({
  rounds,
}: {
  rounds: OfferCandidatePreview["humanInterviews"];
}) {
  if (rounds.length === 0) {
    return (
      <section className="rounded-xl border bg-card p-5 sm:p-6">
        <h2 className="mb-3 font-semibold text-lg">真人复面记录</h2>
        <p className="text-muted-foreground text-sm">暂无真人复面记录。</p>
      </section>
    );
  }
  return (
    <div className="space-y-4">
      {rounds.map((round, index) => (
        <section
          aria-labelledby={`interview-title-${index}`}
          className="rounded-xl border bg-card p-5 sm:p-6"
          key={`${round.sortOrder}-${index}`}
        >
          <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
            <h2 className="font-semibold text-lg" id={`interview-title-${index}`}>
              第 {round.sortOrder + 1} 轮 · {round.label}
            </h2>
            <Badge variant="outline">{roundStatus(round)}</Badge>
          </div>
          <DataFields columns={2}>
            <DataField label="面试形式" value={humanInterviewFormatMeta[round.format].label} />
            <DataField
              label="面试官"
              value={round.interviewers.map((interviewer) => interviewer.name).join("、")}
            />
            <DataField kind="datetime" label="面试时间" value={round.scheduledAt} />
            <DataField kind="datetime" label="完成时间" value={round.completedAt} />
            <DataField kind="number" label="评分" value={round.score} />
            {round.cancelledAt ? (
              <DataField kind="datetime" label="取消时间" value={round.cancelledAt} />
            ) : null}
            <DataField
              label="面试反馈"
              span="full"
              value={round.feedback}
              valueClassName="whitespace-pre-wrap"
            />
          </DataFields>
        </section>
      ))}
    </div>
  );
}
