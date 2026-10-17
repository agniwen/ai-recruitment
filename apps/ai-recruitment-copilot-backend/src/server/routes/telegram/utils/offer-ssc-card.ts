import { Actions, Button, Card, Field, Fields, LinkButton } from "chat";
import type { ActionsElement } from "chat";
import { getOfferSscConfirmationMeta } from "@arc/db-schema/studio-interviews";
import type { PipelineStage } from "@arc/db-schema/studio-interviews";
import type { OfferDraftRecord } from "@arc/shared/studio-pipeline-stages";

interface TelegramOfferCardContext {
  draft: Pick<
    OfferDraftRecord,
    "id" | "position" | "version" | "sscConfirmationStatus" | "sscRevision" | "status"
  >;
  candidateName: string;
  pipelineStage: PipelineStage;
  canReceive: boolean;
  canConfirm: boolean;
}

function callbackValue(draftId: string, revision: number): string {
  // Chat SDK adds a JSON envelope; compact values keep PG integer revisions below 64 bytes.
  return `${draftId.replaceAll("-", "")}:${revision.toString(36)}`;
}

export function buildTelegramOfferCard(
  context: TelegramOfferCardContext,
  options: { detailUrl?: string | null; feedbackLabel?: string; title?: string } = {},
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
        value: callbackValue(draft.id, draft.sscRevision ?? 1),
      }),
    );
  } else if (canOperate && status === "confirming" && context.canConfirm) {
    actions.push(
      Button({
        id: "osc",
        label: "完成确认",
        value: callbackValue(draft.id, draft.sscRevision ?? 1),
      }),
    );
  }
  if (options.detailUrl) {
    actions.push(LinkButton({ label: "查看候选人详情", url: options.detailUrl }));
  }
  return Card({
    children: actions.length > 0 ? [fields, Actions(actions)] : [fields],
    title: options.title ?? "Offer SSC 确认",
  });
}
