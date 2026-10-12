import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { useHasPermission } from "@/hooks/use-has-permission";
import { useWorkspaceSlug } from "@/lib/client/workspace-context";
import { authClient } from "@/lib/client/auth-client";
import { rpc } from "@/lib/client/rpc";
import { rpcFetch } from "@/lib/client/api";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { TimeDisplay } from "@/components/features/display/time-display";
import type { InferResponseType } from "hono/client";

const endpoint = rpc.api.w[":slug"].studio.resumes[":id"]["entry-credentials"];
type EntryPolicy = InferResponseType<typeof endpoint.$get, 200>;

export function CandidateEntryCredentialSetting({
  candidateId,
  disabled = false,
}: {
  candidateId: string;
  disabled?: boolean;
}) {
  const slug = useWorkspaceSlug();
  const { data: session, isPending: sessionPending } = authClient.useSession();
  const isAdmin = !sessionPending && session?.user.role === "admin";
  const canRead = useHasPermission("resumeLibrary", "read");
  const canUpdate = useHasPermission("resumeLibrary", "update");
  const [open, setOpen] = useState(false);
  const [nextEnabled, setNextEnabled] = useState(false);
  const [reason, setReason] = useState("");
  const client = useQueryClient();
  const queryKey = ["candidate-entry-policy", slug, candidateId];
  const param = { id: candidateId, slug };
  const query = useQuery({
    enabled: isAdmin && canRead,
    queryFn: () => rpcFetch<EntryPolicy>(endpoint.$get({ param }), "加载候选人入场设置失败"),
    queryKey,
  });
  const mutation = useMutation({
    mutationFn: (enabled: boolean) =>
      rpcFetch(endpoint.$patch({ json: { enabled, reason }, param }), "保存候选人入场设置失败"),
    onError: (error) => toast.error(error.message),
    onSuccess: async () => {
      await Promise.all([
        client.invalidateQueries({ queryKey }),
        client.invalidateQueries({ queryKey: ["studio-resumes", slug, "timeline", candidateId] }),
      ]);
      setOpen(false);
      setReason("");
      toast.success("候选人入场设置已更新");
    },
  });
  if (!isAdmin || !canRead) {
    return null;
  }
  if (!query.data) {
    return query.isError ? (
      <div role="alert" className="text-sm text-destructive">
        {query.error.message}
        <Button
          variant="ghost"
          onClick={() => {
            void query.refetch();
          }}
        >
          重试
        </Button>
      </div>
    ) : (
      <p className="text-sm text-muted-foreground">加载入场设置…</p>
    );
  }
  const policy = query.data;
  const action = nextEnabled ? "开启入场凭据验证" : "关闭入场凭据验证";
  return (
    <section className="space-y-2 rounded-lg border p-3 text-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <label htmlFor="candidate-entry-credential-switch">
          入场凭据验证：{policy.enabled ? "已开启" : "已关闭"}
        </label>
        <div className="flex items-center gap-2">
          {mutation.isPending ? <Spinner /> : null}
          <Switch
            id="candidate-entry-credential-switch"
            checked={policy.enabled}
            disabled={disabled || !canUpdate || mutation.isPending}
            onCheckedChange={(checked) => {
              setNextEnabled(checked);
              setReason("");
              setOpen(true);
            }}
          />
        </div>
      </div>
      <p className="text-xs text-muted-foreground">
        默认关闭，仅平台管理员可调整。开启后，该候选人须验证通行密钥才能进入真人面试。
      </p>
      {policy.reason ? (
        <p className="text-xs text-muted-foreground">
          最近调整：{policy.updatedByName ?? "已删除的成员"} ·{" "}
          <TimeDisplay value={policy.updatedAt} /> · {policy.reason}
        </p>
      ) : null}
      <Dialog
        open={open}
        onOpenChange={(value) => {
          if (!mutation.isPending) {
            setOpen(value);
          }
        }}
      >
        <DialogContent showCloseButton={!mutation.isPending}>
          <DialogHeader>
            <DialogTitle>{action}</DialogTitle>
            <DialogDescription>
              设置适用于该候选人当前及后续的真人面试，面试官不受影响。请填写调整原因，系统会记录本次操作。
            </DialogDescription>
          </DialogHeader>
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor="entry-credential-reason">调整原因</FieldLabel>
              <Textarea
                id="entry-credential-reason"
                value={reason}
                maxLength={500}
                disabled={mutation.isPending}
                onChange={(event) => setReason(event.target.value)}
                placeholder={
                  nextEnabled
                    ? "请说明为该候选人开启验证的原因"
                    : "例如：候选人的浏览器无法使用通行密钥"
                }
              />
            </Field>
          </FieldGroup>
          <DialogFooter>
            <Button variant="outline" disabled={mutation.isPending} onClick={() => setOpen(false)}>
              取消
            </Button>
            <Button
              disabled={mutation.isPending || !reason.trim()}
              onClick={() => mutation.mutate(nextEnabled)}
            >
              {mutation.isPending ? <Spinner /> : null}确认{nextEnabled ? "开启" : "关闭"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}
