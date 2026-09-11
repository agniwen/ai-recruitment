import { useId, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Field, FieldLabel } from "@/components/ui/field";
import { Modal } from "@/components/ui/modal";
import { Textarea } from "@/components/ui/textarea";
import { rpc } from "@/lib/client/rpc";
import { rpcFetch } from "@/lib/client/api/rpc-fetch";
import { useWorkspaceSlug } from "@/lib/client/workspace-context";

export function AiReviewRejectionButton({
  recordId,
  disabled,
}: {
  recordId: string;
  disabled?: boolean;
}) {
  const id = useId();
  const slug = useWorkspaceSlug();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState("");
  const [pending, setPending] = useState(false);
  async function submit() {
    if (pending || disabled) {
      return;
    }
    setPending(true);
    try {
      await rpcFetch(
        rpc.api.w[":slug"].studio["ai-review"][":id"].reject.$post({
          json: { approvalNote: note.trim() },
          param: { id: recordId, slug },
        }),
        "审批失败",
      );
      toast.success("审批未通过，保留在 AI 评价审核阶段");
      setOpen(false);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["ai-review-approvals", slug] }),
        queryClient.invalidateQueries({ queryKey: ["studio-resumes"] }),
      ]);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "审批失败");
    } finally {
      setPending(false);
    }
  }
  return (
    <>
      <Button
        size="sm"
        variant="outline"
        disabled={disabled || pending}
        onClick={() => {
          setNote("");
          setOpen(true);
        }}
      >
        审批不通过
      </Button>
      <Modal
        open={open}
        onOpenChange={setOpen}
        dismissible={!pending}
        title="AI 分析审批不通过"
        footer={
          <>
            <Button variant="outline" disabled={pending} onClick={() => setOpen(false)}>
              取消
            </Button>
            <Button
              variant="destructive"
              disabled={pending || disabled}
              onClick={() => void submit()}
            >
              {pending ? "提交中..." : "确认审批不通过"}
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <p className="text-sm text-muted-foreground">
            候选人将保留在 AI 评价审核阶段，子状态变为“未通过”。
          </p>
          <Field>
            <FieldLabel htmlFor={id}>审批说明（选填）</FieldLabel>
            <Textarea
              id={id}
              value={note}
              onChange={(event) => setNote(event.target.value)}
              maxLength={2000}
              rows={4}
              disabled={pending}
              placeholder="可补充审批不通过的原因"
            />
          </Field>
        </div>
      </Modal>
    </>
  );
}
