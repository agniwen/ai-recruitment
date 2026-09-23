"use client";

import { useQuery } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { externalInterviewerInputSchema } from "@arc/db-schema/studio-interviews";
import type { ExternalInterviewerInput } from "@arc/db-schema/studio-interviews";
import type { ExternalInterviewerBindingStatus } from "@arc/shared/external-interviewers";
import {
  getExternalInterviewerDefaults,
  checkExternalInterviewerBindings,
} from "@/lib/client/api/endpoints/external-interviewers";
import { useWorkspaceSlug } from "@/lib/client/workspace-context";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field, FieldGroup, FieldLabel, FieldDescription } from "@/components/ui/field";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

type Entry = ExternalInterviewerInput & { key: string };
const EMPTY: Entry[] = [];

export function useExternalInterviewers(open: boolean, candidateId: string) {
  const slug = useWorkspaceSlug();
  const [draft, setDraft] = useState<Entry[] | null>(null);
  const [unbound, setUnbound] = useState<ExternalInterviewerBindingStatus[]>([]);
  const pending = useRef<((confirmed: boolean) => void) | null>(null);
  const active = useRef(open);
  const defaults = useQuery({
    enabled: open,
    queryFn: async () => {
      const values = await getExternalInterviewerDefaults(slug, candidateId);
      return values.map((item) => ({ ...item, key: crypto.randomUUID() }));
    },
    queryKey: ["external-interviewer-defaults", slug, candidateId],
    staleTime: 0,
  });
  useEffect(() => {
    active.current = open;
    setDraft(null);
    if (!open) {
      setUnbound([]);
      pending.current?.(false);
      pending.current = null;
    }
    return () => {
      active.current = false;
      pending.current?.(false);
      pending.current = null;
    };
  }, [open, candidateId]);
  const entries = draft ?? defaults.data ?? EMPTY;

  function resolveConfirmation(confirmed: boolean) {
    pending.current?.(confirmed);
    pending.current = null;
    setUnbound([]);
  }
  function input(): ExternalInterviewerInput[] {
    return entries.map(({ name, telegram }) =>
      externalInterviewerInputSchema.parse({ name, telegram }),
    );
  }
  async function confirm(): Promise<boolean> {
    const interviewers = input();
    if (!interviewers.length) {
      return true;
    }
    const statuses = await checkExternalInterviewerBindings(slug, interviewers);
    if (!active.current) {
      return false;
    }
    const missing = statuses.filter((item) => !item.bound);
    if (!missing.length) {
      return true;
    }
    setUnbound(missing);
    // oxlint-disable-next-line promise/avoid-new -- resolved by the explicit confirmation buttons.
    return new Promise<boolean>((resolve) => {
      pending.current = resolve;
    });
  }

  const fields = (
    <FieldGroup>
      <Field>
        <FieldLabel>外部面试官</FieldLabel>
        <FieldDescription>
          已从岗位需求发起人预填，可修改。无需系统账号；已绑定 TG
          的面试官会收到通知，其他人可手动转发邀请链接。
        </FieldDescription>
        {defaults.isLoading ? <output>正在加载需求发起人…</output> : null}
        {defaults.isError ? (
          <div role="alert">
            加载需求发起人失败。
            <Button onClick={() => void defaults.refetch()} type="button" variant="link">
              重试
            </Button>
          </div>
        ) : null}
        {entries.map((item, index) => (
          <div className="flex items-end gap-2" key={item.key}>
            <Field className="min-w-0 flex-1">
              <FieldLabel className="sr-only" htmlFor={`external-name-${item.key}`}>
                外部面试官 {index + 1} 姓名
              </FieldLabel>
              <Input
                id={`external-name-${item.key}`}
                maxLength={100}
                onChange={(event) =>
                  setDraft(
                    entries.map((row) =>
                      row.key === item.key ? { ...row, name: event.target.value } : row,
                    ),
                  )
                }
                placeholder="姓名"
                value={item.name}
              />
            </Field>
            <Field className="min-w-0 flex-1">
              <FieldLabel className="sr-only" htmlFor={`external-tg-${item.key}`}>
                外部面试官 {index + 1} TG 号
              </FieldLabel>
              <Input
                id={`external-tg-${item.key}`}
                maxLength={120}
                onChange={(event) =>
                  setDraft(
                    entries.map((row) =>
                      row.key === item.key ? { ...row, telegram: event.target.value } : row,
                    ),
                  )
                }
                placeholder="@用户名（可选）"
                value={item.telegram}
              />
            </Field>
            <Button
              aria-label={`删除外部面试官 ${index + 1}`}
              onClick={() => setDraft(entries.filter((row) => row.key !== item.key))}
              type="button"
              variant="outline"
            >
              删除
            </Button>
          </div>
        ))}
        <Button
          className="self-start"
          disabled={defaults.isFetching || entries.length >= 20}
          onClick={() =>
            setDraft([...entries, { key: crypto.randomUUID(), name: "", telegram: "" }])
          }
          size="sm"
          type="button"
          variant="outline"
        >
          添加外部面试官
        </Button>
      </Field>
    </FieldGroup>
  );
  const confirmation = (
    <AlertDialog
      onOpenChange={(next) => {
        if (!next) {
          resolveConfirmation(false);
        }
      }}
      open={unbound.length > 0}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>部分外部面试官无法接收 TG 通知</AlertDialogTitle>
          <AlertDialogDescription>
            继续创建后，仅向已绑定的面试官发送 TG
            通知。所有外部面试官都会生成邀请链接，你可以复制后手动转发。
          </AlertDialogDescription>
        </AlertDialogHeader>
        <ul className="flex max-h-64 flex-col gap-2 overflow-y-auto">
          {unbound.map((item, index) => (
            <li key={`${item.name}:${index}`}>
              {item.name} · {item.telegram ? `${item.telegram}（尚未绑定）` : "未填写 TG 号"}
            </li>
          ))}
        </ul>
        <AlertDialogFooter>
          <AlertDialogCancel>取消保存</AlertDialogCancel>
          <AlertDialogAction onClick={() => resolveConfirmation(true)}>继续创建</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
  return {
    confirm,
    confirmation,
    count: entries.length,
    fields,
    input,
    loading: defaults.isFetching || defaults.isError,
    valid: entries.every((entry) => entry.name.trim()),
  };
}
