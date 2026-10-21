import { Actions, Button, Card, Field, Fields, LinkButton } from "chat";
import type { ActionsElement } from "chat";
import { getOfferSscConfirmationMeta } from "@arc/db-schema/studio-interviews";
import type { PipelineStage } from "@arc/db-schema/studio-interviews";
import type { OfferDraftRecord } from "@arc/shared/studio-pipeline-stages";

export interface TelegramOfferCardContext {
  draft: Pick<
    OfferDraftRecord,
    "id" | "position" | "version" | "sscConfirmationStatus" | "sscRevision" | "status"
  >;
  candidateName: string;
  pipelineStage: PipelineStage;
  canReceive: boolean;
  canConfirm: boolean;
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
    Field({ label: "候选人", value: context.candidateName }),
    Field({ label: "岗位", value: draft.position || "未填写" }),
    Field({ label: "Offer 版本", value: String(draft.version) }),
    Field({
      label: "SSC 状态",
      value: status ? getOfferSscConfirmationMeta(status).label : "历史 Offer，无 SSC 确认记录",
    }),
    ...(options.feedbackLabel ? [Field({ label: "本次反馈", value: options.feedbackLabel })] : []),
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
  return Card({
    children: actions.length > 0 ? [fields, Actions(actions)] : [fields],
    title: options.title ?? (status === "pending" ? "Offer新增" : "Offer SSC 确认"),
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
  } = {},
) {
  return Card({
    children: [
      Fields([
        Field({ label: "候选人", value: context.candidateName }),
        Field({ label: "岗位", value: context.draft.position || "未填写" }),
        Field({ label: "Offer 版本", value: String(context.draft.version) }),
        ...(options.feedbackLabel
          ? [Field({ label: "本次流转", value: options.feedbackLabel })]
          : []),
        Field({
          label: "内部审批",
          value: "请确认该 Offer 的内部审批已完成。确认后系统将记录操作人和完成时间。",
        }),
        Field({
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
    ],
    title: options.screenshotReceived ? "审批截图已收到，请确认完成" : "确认完成 SSC 审核",
  });
}
