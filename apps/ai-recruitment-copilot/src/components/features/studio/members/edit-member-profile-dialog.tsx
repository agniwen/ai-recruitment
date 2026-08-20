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
import { USER_TELEGRAM_MAX_LENGTH } from "@arc/shared/user-profile";
import type { MemberRow } from "./members-page-model";

interface EditMemberProfileDialogProps {
  member: MemberRow | null;
  onOpenChange: (open: boolean) => void;
  onUpdated: () => Promise<unknown>;
}

export function EditMemberProfileDialog({
  member,
  onOpenChange,
  onUpdated,
}: EditMemberProfileDialogProps) {
  const slug = useWorkspaceSlug();
  const [name, setName] = useState("");
  const [telegram, setTelegram] = useState("");
  const [fieldErrors, setFieldErrors] = useState<{ name?: string; telegram?: string }>({});
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (member) {
      setName(member.name);
      setTelegram(member.telegram ?? "");
      setFieldErrors({});
    }
  }, [member]);

  const trimmedName = name.trim();
  const trimmedTelegram = telegram.trim();
  const canSubmit =
    Boolean(member) &&
    (trimmedName !== member?.name.trim() || trimmedTelegram !== (member?.telegram ?? "")) &&
    !submitting;

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!member) {
      return;
    }
    if (!trimmedName) {
      setFieldErrors({ name: "请输入用户名称。" });
      return;
    }
    if (trimmedName.length > 100) {
      setFieldErrors({ name: "用户名称不能超过 100 个字符。" });
      return;
    }
    if (trimmedTelegram.length > USER_TELEGRAM_MAX_LENGTH) {
      setFieldErrors({ telegram: `TG 号不能超过 ${USER_TELEGRAM_MAX_LENGTH} 个字符。` });
      return;
    }

    setSubmitting(true);
    setFieldErrors({});
    await runAsyncAction({
      cleanup: () => setSubmitting(false),
      onError: (error) => {
        const message = error instanceof Error ? error.message : "更新成员资料失败";
        setFieldErrors({ name: message });
        toast.error(message);
      },
      operation: async () => {
        await rpcFetch(
          rpc.api.w[":slug"].studio.workspace.members[":userId"].profile.$patch({
            json: { name: trimmedName, telegram: trimmedTelegram || null },
            param: { slug, userId: member.userId },
          }),
          "更新成员资料失败",
        );
        await onUpdated();
        toast.success("成员资料已更新");
        onOpenChange(false);
      },
    });
  }

  return (
    <Dialog onOpenChange={onOpenChange} open={Boolean(member)}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>编辑成员资料</DialogTitle>
          <DialogDescription>修改该成员在系统中显示的名称和 TG 号。</DialogDescription>
        </DialogHeader>
        <form className="flex flex-col gap-4" id="edit-member-profile-form" onSubmit={onSubmit}>
          <FieldGroup>
            <Field data-invalid={Boolean(fieldErrors.name)}>
              <FieldLabel htmlFor="member-name">用户名称</FieldLabel>
              <Input
                aria-describedby={
                  fieldErrors.name
                    ? "member-name-description member-name-error"
                    : "member-name-description"
                }
                aria-invalid={Boolean(fieldErrors.name)}
                autoComplete="off"
                autoFocus
                disabled={submitting}
                id="member-name"
                maxLength={100}
                name="name"
                onChange={(event) => {
                  setName(event.target.value);
                  setFieldErrors((current) => ({ ...current, name: undefined }));
                }}
                value={name}
              />
              <FieldDescription id="member-name-description">
                请输入 1–100 个字符。
              </FieldDescription>
              <FieldError id="member-name-error">{fieldErrors.name}</FieldError>
            </Field>
            <Field data-invalid={Boolean(fieldErrors.telegram)}>
              <FieldLabel htmlFor="member-telegram">TG 号（可选）</FieldLabel>
              <Input
                aria-describedby={
                  fieldErrors.telegram
                    ? "member-telegram-description member-telegram-error"
                    : "member-telegram-description"
                }
                aria-invalid={Boolean(fieldErrors.telegram)}
                autoComplete="off"
                disabled={submitting}
                id="member-telegram"
                maxLength={USER_TELEGRAM_MAX_LENGTH}
                name="telegram"
                onChange={(event) => {
                  setTelegram(event.target.value);
                  setFieldErrors((current) => ({ ...current, telegram: undefined }));
                }}
                placeholder="例如 @username"
                value={telegram}
              />
              <FieldDescription id="member-telegram-description">
                可填写 Telegram 用户名，最多 120 个字符。
              </FieldDescription>
              <FieldError id="member-telegram-error">{fieldErrors.telegram}</FieldError>
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
          <Button disabled={!canSubmit} form="edit-member-profile-form" type="submit">
            {submitting ? <Spinner data-icon="inline-start" /> : null}
            {submitting ? "保存中..." : "保存"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
