import { useId, useState } from "react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Modal } from "@/components/ui/modal";
import { Textarea } from "@/components/ui/textarea";

export function AiReviewApprovalButton({
  disabled,
  onConfirm,
  label = "审批通过",
}: {
  disabled?: boolean;
  onConfirm: (approvalNote: string) => Promise<unknown>;
  label?: string;
}) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState("");
  const [pending, setPending] = useState(false);
  async function submit() {
    if (pending || disabled || !note.trim()) {
      return;
    }
    setPending(true);
    try {
      await onConfirm(note.trim());
      setOpen(false);
    } catch {
      // The caller displays the request error; retain the explanation for retry.
    } finally {
      setPending(false);
    }
  }
  return (
    <>
      <Button
        disabled={disabled || pending}
        onClick={() => {
          setNote("");
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
            <Button disabled={pending || disabled || !note.trim()} onClick={() => void submit()}>
              {pending ? "提交中..." : "确认审批通过"}
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          <p className="text-sm text-muted-foreground">
            审批通过后进入简历筛选，说明将记录在候选人的活动记录中。
          </p>
          <Label htmlFor={id}>审批说明（必填）</Label>
          <Textarea
            id={id}
            value={note}
            onChange={(event) => setNote(event.target.value)}
            required
            maxLength={2000}
            rows={4}
            disabled={pending}
            placeholder="请说明审批通过的依据"
          />
        </div>
      </Modal>
    </>
  );
}
