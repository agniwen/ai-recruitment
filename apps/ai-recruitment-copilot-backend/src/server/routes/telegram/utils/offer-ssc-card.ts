import {
  Actions,
  Button,
  Card,
  Field,
  Fields,
  LinkButton,
  CardText,
  cardChildToFallbackText,
  paragraph,
  root,
  stringifyMarkdown,
  text as markdownText,
} from "chat";
import type { ActionsElement } from "chat";
import { offerConfirmationDetailsSchema } from "@arc/db-schema/offer-confirmation";
import { buildOfferConfirmationText } from "@arc/shared/offer-confirmation";
import { getOfferSscConfirmationMeta } from "@arc/db-schema/studio-interviews";
import type { PipelineStage } from "@arc/db-schema/studio-interviews";
import type { OfferSscActivity } from "@arc/ai-recruitment-copilot-backend/server/routes/studio/routes/interviews/dao/offer-ssc-activity";
import type { OfferDraftRecord } from "@arc/shared/studio-pipeline-stages";

export interface TelegramOfferCardContext {
  draft: Pick<
    OfferDraftRecord,
    "id" | "position" | "version" | "sscConfirmationStatus" | "sscRevision" | "status"
  > &
    Partial<
      Pick<OfferDraftRecord, "baseSalary" | "confirmationInfo" | "currency" | "interviewRecordId">
    >;
  candidateName: string;
  pipelineStage: PipelineStage;
  canReceive: boolean;
  canConfirm: boolean;
  activity?: OfferSscActivity[];
}

const blankConfirmationInfo = offerConfirmationDetailsSchema.parse({});

function offerConfirmationText(context: TelegramOfferCardContext) {
  const { draft } = context;
  if (draft.baseSalary === undefined || draft.currency === undefined) {
    return null;
  }
  return buildOfferConfirmationText({
    baseSalary: draft.baseSalary,
    candidateRecordId: draft.interviewRecordId,
    currency: draft.currency,
    info: draft.confirmationInfo ?? {
      ...blankConfirmationInfo,
      candidateName: context.candidateName,
    },
    position: draft.position,
    sscConfirmationStatus: draft.sscConfirmationStatus,
  });
}

function plainMarkdown(value: string) {
  // The Card transport parses Markdown again: stringify a text-only AST so saved fields
  // stay literal, including backticks, list markers and Markdown-looking multiline values.
  return stringifyMarkdown(root([paragraph([markdownText(value)])])).replace(/\n$/u, "");
}

function literalField(props: { label: string; value: string }) {
  return Field({ ...props, value: plainMarkdown(props.value) });
}

function copyInformationActions(detailUrl: string | null | undefined) {
  if (!detailUrl) {
    return [];
  }
  const url = new URL(detailUrl);
  url.hash = "offer-confirmation-info";
  return [Actions([LinkButton({ label: "复制完整 Offer 信息", url: url.href })])];
}

function offerCopySections(
  context: TelegramOfferCardContext,
  header: string,
  detailUrl: string | null | undefined,
) {
  const text = offerConfirmationText(context);
  if (text === null) {
    return [];
  }
  const hint = CardText(
    detailUrl
      ? "完整 Offer 信息如下，可点击下方按钮复制全文。"
      : "完整 Offer 信息如下，可选择正文复制。",
  );
  // The Telegram transport can escape every plain-text character in MarkdownV2.
  // Reserve separators and the explanatory line before the adapter's 4096-character limit.
  const budget = (header.length + text.length) * 2 + 256;
  if (budget > 4096) {
    return [
      CardText(
        detailUrl
          ? "Offer 信息较长，请打开“复制完整 Offer 信息”查看并复制全文。"
          : "Offer 信息较长，未配置可用详情地址，请在系统中查看并复制全文。",
      ),
    ];
  }
  return [hint, CardText(plainMarkdown(text))];
}

const activityTime = new Intl.DateTimeFormat("zh-CN", {
  day: "2-digit",
  hour: "2-digit",
  hour12: false,
  minute: "2-digit",
  month: "2-digit",
  timeZone: "Asia/Shanghai",
});

function operationFields(activity: OfferSscActivity[] | undefined) {
  return activity?.length
    ? [
        literalField({
          label: "最近操作记录",
          value: activity
            .map(
              (entry) =>
                `${entry.label}：${entry.operator} · ${activityTime.format(new Date(entry.occurredAt))}`,
            )
            .join("\n"),
        }),
      ]
    : [];
}

export function telegramOfferCallbackValue(draftId: string, revision: number): string {
  // Chat SDK adds a JSON envelope; compact values keep PG integer revisions below 64 bytes.
  return `${draftId.replaceAll("-", "")}:${revision.toString(36)}`;
}

export function buildTelegramOfferCard(
  context: TelegramOfferCardContext,
  options: {
    detailLabel?: string;
    detailUrl?: string | null;
    feedbackLabel?: string;
    title?: string;
  } = {},
) {
  const { draft } = context;
  const status = draft.sscConfirmationStatus;
  const canOperate = draft.status === "draft" && context.pipelineStage !== "closed";
  const fields = Fields([
    literalField({ label: "候选人", value: context.candidateName }),
    literalField({ label: "岗位", value: draft.position || "未填写" }),
    literalField({ label: "Offer 版本", value: String(draft.version) }),
    literalField({
      label: "SSC 状态",
      value: status ? getOfferSscConfirmationMeta(status).label : "历史 Offer，无 SSC 确认记录",
    }),
    ...(options.feedbackLabel
      ? [literalField({ label: "本次反馈", value: options.feedbackLabel })]
      : []),
    ...operationFields(context.activity),
  ]);
  const actions: ActionsElement["children"] = [];
  if (canOperate && status === "pending" && context.canReceive) {
    actions.push(
      Button({
        id: "osr",
        label: "接收确认",
        value: telegramOfferCallbackValue(draft.id, draft.sscRevision ?? 1),
      }),
    );
  } else if (canOperate && status === "confirming" && context.canConfirm) {
    actions.push(
      Button({
        id: "osc",
        label: "完成确认",
        value: telegramOfferCallbackValue(draft.id, draft.sscRevision ?? 1),
      }),
    );
  }
  if (options.detailUrl) {
    actions.push(
      LinkButton({ label: options.detailLabel ?? "查看候选人详情", url: options.detailUrl }),
    );
  }
  const title = options.title ?? (status === "pending" ? "Offer新增" : "Offer SSC 确认");
  return Card({
    children: [
      ...offerCopySections(
        context,
        `${title}\n${cardChildToFallbackText(fields) ?? ""}`,
        options.detailUrl,
      ),
      fields,
      ...(actions.length > 0 ? [Actions(actions)] : []),
      ...copyInformationActions(options.detailUrl),
    ],
    title,
  });
}

export function buildTelegramOfferCompletionCard(
  context: TelegramOfferCardContext,
  token: string,
  options: {
    screenshotReceived?: boolean;
    detailUrl?: string | null;
    feedbackLabel?: string;
    persistent?: boolean;
    operatorLabel?: string;
  } = {},
) {
  return Card({
    children: [
      Fields([
        literalField({ label: "候选人", value: context.candidateName }),
        literalField({ label: "岗位", value: context.draft.position || "未填写" }),
        literalField({ label: "Offer 版本", value: String(context.draft.version) }),
        ...operationFields(context.activity),
        ...(options.operatorLabel
          ? [literalField({ label: "当前操作人", value: options.operatorLabel })]
          : []),
        ...(options.feedbackLabel
          ? [literalField({ label: "本次流转", value: options.feedbackLabel })]
          : []),
        literalField({
          label: "内部审批",
          value: "请确认该 Offer 的内部审批已完成。确认后系统将记录操作人和完成时间。",
        }),
        literalField({
          label: "审批截图（选填）",
          value: options.screenshotReceived
            ? "审批截图已收到，确认完成后将保存到本次 Offer。请确认内部审批已完成，再点击下方“确认完成”。"
            : `可点击上传截图发送一张 JPEG、PNG 或 WebP 图片（最多 10 MB），也可直接完成确认。上传后会显示新的确认卡片。${options.persistent ? "以当前 Offer 版本和状态为准。" : "本次操作 30 分钟内有效。"}`,
        }),
      ]),
      Actions([Button({ id: "osf", label: "确认完成", value: token })]),
      Actions([
        Button({
          id: "osu",
          label: options.screenshotReceived ? "重新上传截图" : "上传截图（选填）",
          value: token,
        }),
        Button({ id: "osx", label: "取消", value: token }),
      ]),
      ...(options.detailUrl
        ? [Actions([LinkButton({ label: "查看候选人详情", url: options.detailUrl })])]
        : []),
      ...copyInformationActions(options.detailUrl),
    ],
    title: options.screenshotReceived ? "审批截图已收到，请确认完成" : "确认完成 SSC 审核",
  });
}
