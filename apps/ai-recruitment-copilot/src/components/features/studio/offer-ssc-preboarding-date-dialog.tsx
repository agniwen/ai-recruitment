"use client";

import { useId, useState } from "react";
import { offerPreboardingDateSchema } from "@arc/shared/offer-preboarding";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export function OfferSscPreboardingDateDialog({
  onClose,
  onConfirm,
  preboardingDate,
}: {
  onClose: () => void;
  onConfirm: (preboardingDate: string) => Promise<unknown>;
  preboardingDate: string | null;
}) {
  const id = useId();
  const [value, setValue] = useState(preboardingDate ?? "");
  const [errorMessage, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function confirmDate() {
    if (submitting) {
      return;
    }
    const parsed = offerPreboardingDateSchema.safeParse(value);
    if (!parsed.success) {
      setError("请输入有效的预入职日期，格式为 YYYY-MM-DD，例如：2026-11-01。");
      return;
    }
    setError(null);
    setSubmitting(true);
    try {
      await onConfirm(parsed.data);
      onClose();
    } catch (error) {
      setError(error instanceof Error ? error.message : "预入职日期确认失败，请重试。");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !submitting) {
          onClose();
        }
      }}
    >
      <DialogContent className="sm:max-w-md" showCloseButton={!submitting}>
        <form
          className="space-y-4"
          onSubmit={(event) => {
            event.preventDefault();
            void confirmDate();
          }}
        >
          <DialogHeader>
            <DialogTitle>完成预入职时间确认</DialogTitle>
            <DialogDescription>
              请录入与候选人沟通确认的预入职日期，保存后会同步到当前 Offer。
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-2">
            <Label htmlFor={id}>预入职日期</Label>
            <Input
              aria-describedby={`${id}-hint`}
              aria-label="预入职日期"
              disabled={submitting}
              id={id}
              inputMode="numeric"
              maxLength={10}
              onChange={(event) => setValue(event.target.value)}
              value={value}
            />
            <p className="text-muted-foreground text-xs" id={`${id}-hint`}>
              格式：YYYY-MM-DD，例如：2026-11-01。
            </p>
            {errorMessage ? (
              <p className="text-destructive text-sm" role="alert">
                {errorMessage}
              </p>
            ) : null}
          </div>
          <DialogFooter>
            <Button disabled={submitting} onClick={onClose} type="button" variant="outline">
              取消
            </Button>
            <Button disabled={submitting} type="submit">
              {submitting ? "保存中…" : "确认预入职日期"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
