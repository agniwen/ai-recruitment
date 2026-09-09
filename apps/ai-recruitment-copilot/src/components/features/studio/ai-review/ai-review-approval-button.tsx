import { useId, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Modal } from "@/components/ui/modal";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { Textarea } from "@/components/ui/textarea";
import { rpc } from "@/lib/client/rpc";
import { rpcFetch } from "@/lib/client/api/rpc-fetch";
import { useWorkspaceSlug } from "@/lib/client/workspace-context";

export function AiReviewApprovalButton({
  recordId,
  disabled,
  onConfirm,
  label = "审批通过",
}: {
  recordId: string;
  disabled?: boolean;
  onConfirm: (approvalNote: string, notificationUserId: string) => Promise<unknown>;
  label?: string;
}) {
  const id = useId();
  const slug = useWorkspaceSlug();
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState("");
  const [notificationUserId, setNotificationUserId] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const recipientsQuery = useQuery({
    enabled: open,
    queryFn: ({ signal }) =>
      rpcFetch<{
        recipients: { userId: string; name: string; email: string; telegramBound: boolean }[];
      }>(
        rpc.api.w[":slug"].studio["ai-review"][":id"]["notification-recipients"].$get(
          { param: { id: recordId, slug } },
          { init: { signal } },
        ),
        "加载通知人员失败",
      ),
    queryKey: ["ai-review-approvals", slug, "notification-recipients", recordId],
  });
  const recipients = recipientsQuery.data?.recipients ?? [];
  const selectedRecipient = recipients.find(
    (recipient) => recipient.userId === notificationUserId && recipient.telegramBound,
  );
  const canSubmit =
    !pending &&
    !disabled &&
    !recipientsQuery.isFetching &&
    !recipientsQuery.isError &&
    Boolean(selectedRecipient);

  async function submit() {
    if (!canSubmit || !selectedRecipient) {
      return;
    }
    setPending(true);
    try {
      await onConfirm(note.trim(), selectedRecipient.userId);
      setOpen(false);
    } catch {
      // The caller displays the request error; retain the inputs for retry.
    } finally {
      setPending(false);
    }
  }
  return (
    <>
      <Button
        size="sm"
        disabled={disabled || pending}
        onClick={() => {
          setNote("");
          setNotificationUserId(null);
          setOpen(true);
        }}
      >
        {label}
      </Button>
      <Modal
        open={open}
        onOpenChange={setOpen}
        dismissible={!pending}
        title="AI 分析审批通过"
        footer={
          <>
            <Button variant="outline" disabled={pending} onClick={() => setOpen(false)}>
              取消
            </Button>
            <Button disabled={!canSubmit} onClick={() => void submit()}>
              {pending ? "提交中..." : "确认审批通过"}
            </Button>
          </>
        }
      >
        <FieldGroup>
          <p className="text-sm text-muted-foreground">
            审批通过后进入简历筛选，并向通知人员发送 Telegram 消息。
          </p>
          <Field>
            <FieldLabel htmlFor={`${id}-recipient`}>推送给ODC，简历评估</FieldLabel>
            <SearchableSelect
              id={`${id}-recipient`}
              required
              disabled={pending || recipientsQuery.isPending || recipientsQuery.isError}
              value={notificationUserId}
              onChange={setNotificationUserId}
              options={recipients.map((recipient) => ({
                description: recipient.telegramBound
                  ? recipient.email
                  : `${recipient.email} · 未绑定 Telegram`,
                disabled: !recipient.telegramBound,
                label: recipient.name,
                value: recipient.userId,
              }))}
              placeholder={recipientsQuery.isPending ? "加载通知人员..." : "请选择通知人员"}
              emptyMessage="暂无可选的 ODC 用户"
            />
            <FieldDescription>
              仅可选择该候选人关联来源下、已绑定 Telegram 的 ODC 用户。
            </FieldDescription>
            {recipientsQuery.isError ? (
              <div role="alert" className="flex items-center gap-2 text-sm text-destructive">
                {recipientsQuery.error.message}
                <Button size="sm" variant="outline" onClick={() => void recipientsQuery.refetch()}>
                  重试
                </Button>
              </div>
            ) : null}
            {recipientsQuery.isSuccess &&
            !recipients.some((recipient) => recipient.telegramBound) ? (
              <FieldDescription>
                暂无可通知人员，请先配置来源的 ODC 用户并完成 Telegram 绑定。
              </FieldDescription>
            ) : null}
          </Field>
          <Field>
            <FieldLabel htmlFor={`${id}-note`}>审批说明（选填）</FieldLabel>
            <Textarea
              id={`${id}-note`}
              value={note}
              onChange={(event) => setNote(event.target.value)}
              maxLength={2000}
              rows={4}
              disabled={pending}
              placeholder="可补充审批通过的依据"
            />
            <FieldDescription>说明将记录在候选人的活动记录中。</FieldDescription>
          </Field>
        </FieldGroup>
      </Modal>
    </>
  );
}
