"use client";

import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { rpcFetch } from "@/lib/client/api";
import { runAsyncAction } from "@/lib/client/async-control";
import { rpc } from "@/lib/client/rpc";
import { useWorkspaceSlug } from "@/lib/client/workspace-context";
import type { MemberRow } from "./members-page-model";

interface EditMemberNameDialogProps {
  member: MemberRow | null;
  onOpenChange: (open: boolean) => void;
  onUpdated: () => Promise<unknown>;
}

export function EditMemberNameDialog({
  member,
  onOpenChange,
  onUpdated,
}: EditMemberNameDialogProps) {
  const slug = useWorkspaceSlug();
  const [name, setName] = useState("");
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (member) {
      setName(member.name);
      setFieldError(null);
    }
  }, [member]);

  const trimmedName = name.trim();
  const canSubmit = Boolean(member) && trimmedName !== member?.name.trim() && !submitting;

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!member) {
      return;
    }
    if (!trimmedName) {
      setFieldError("请输入用户名称。");
      return;
    }
    if (trimmedName.length > 100) {
      setFieldError("用户名称不能超过 100 个字符。");
      return;
    }

    setSubmitting(true);
    setFieldError(null);
    await runAsyncAction({
      cleanup: () => setSubmitting(false),
      onError: (error) => {
        const message = error instanceof Error ? error.message : "更新用户名称失败";
        setFieldError(message);
        toast.error(message);
      },
      operation: async () => {
        await rpcFetch(
          rpc.api.w[":slug"].studio.workspace.members[":userId"].name.$patch({
            json: { name: trimmedName },
            param: { slug, userId: member.userId },
          }),
          "更新用户名称失败",
        );
        await onUpdated();
        toast.success("用户名称已更新");
        onOpenChange(false);
      },
    });
  }

  return (
    <Dialog onOpenChange={onOpenChange} open={Boolean(member)}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>修改用户名称</DialogTitle>
          <DialogDescription>修改该成员在系统中显示的名称。</DialogDescription>
        </DialogHeader>
        <form className="flex flex-col gap-4" id="edit-member-name-form" onSubmit={onSubmit}>
          <FieldGroup>
            <Field data-invalid={Boolean(fieldError)}>
              <FieldLabel htmlFor="member-name">用户名称</FieldLabel>
              <Input
                aria-describedby={
                  fieldError
                    ? "member-name-description member-name-error"
                    : "member-name-description"
                }
                aria-invalid={Boolean(fieldError)}
                autoComplete="off"
                autoFocus
                disabled={submitting}
                id="member-name"
                maxLength={100}
                name="name"
                onChange={(event) => {
                  setName(event.target.value);
                  setFieldError(null);
                }}
                value={name}
              />
              <FieldDescription id="member-name-description">
                请输入 1–100 个字符。
              </FieldDescription>
              <FieldError id="member-name-error">{fieldError}</FieldError>
            </Field>
          </FieldGroup>
        </form>
        <DialogFooter>
          <DialogClose
            render={
              <Button disabled={submitting} type="button" variant="outline">
                取消
              </Button>
            }
          />
          <Button disabled={!canSubmit} form="edit-member-name-form" type="submit">
            {submitting ? <Spinner data-icon="inline-start" /> : null}
            {submitting ? "保存中..." : "保存"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
