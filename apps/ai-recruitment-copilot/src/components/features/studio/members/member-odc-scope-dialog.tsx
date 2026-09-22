import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import type { MemberOdcScopeInput } from "@arc/db-schema/pre-registration";
import { PreRegistrationOdcFields } from "../pre-registrations/pre-registration-odc-fields";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { rpcFetch } from "@/lib/client/api";
import { rpc } from "@/lib/client/rpc";
import { useWorkspaceSlug } from "@/lib/client/workspace-context";
import { invalidateOdcScopeQueries, useMemberOdcScopes } from "./member-odc-scope-query";

export function MemberOdcScopeDialog({
  memberId,
  name,
  onClose,
}: {
  memberId: string;
  name: string;
  onClose: () => void;
}) {
  const slug = useWorkspaceSlug();
  const client = useQueryClient();
  const query = useMemberOdcScopes(true);
  const current = query.data?.records.find((row) => row.memberId === memberId);
  const [draft, setDraft] = useState<MemberOdcScopeInput | null>(null);
  const value = draft ?? current;
  const mutation = useMutation({
    mutationFn: async () => {
      if (!value || !current?.isOdc) {
        throw new Error("成员不存在或角色未标记为 ODC");
      }
      return await rpcFetch(
        rpc.api.w[":slug"].studio.workspace.members[":memberId"]["odc-scope"].$put({
          json: { odcAssignments: value.odcAssignments, odcScopeMode: value.odcScopeMode },
          param: { memberId, slug },
        }),
        "保存 ODC 负责范围失败",
      );
    },
    onError: (error) => toast.error(error.message),
    onSuccess: async () => {
      await invalidateOdcScopeQueries(client, slug);
      toast.success("ODC 负责范围已更新");
      onClose();
    },
  });
  let content;
  if (query.isError) {
    content = (
      <p role="alert">
        加载 ODC 负责范围失败。
        <Button variant="link" onClick={() => void query.refetch()}>
          重试
        </Button>
      </p>
    );
  } else if (query.isPending) {
    content = <output>加载中…</output>;
  } else if (!value || !current?.isOdc) {
    content = <p role="alert">成员不存在或角色未标记为 ODC。</p>;
  } else {
    content = (
      <PreRegistrationOdcFields
        assignments={value.odcAssignments}
        sources={query.data?.sources ?? []}
        disabled={mutation.isPending}
        loading={false}
        failed={false}
        scopeMode={value.odcScopeMode}
        onScopeModeChange={(odcScopeMode) => setDraft({ ...value, odcScopeMode })}
        onChange={(odcAssignments) => setDraft({ ...value, odcAssignments })}
      />
    );
  }
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !mutation.isPending) {
          onClose();
        }
      }}
    >
      <DialogContent className="max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>设置 ODC 负责范围</DialogTitle>
          <DialogDescription>{name} · 设置该成员在当前工作区负责的部门/中心。</DialogDescription>
        </DialogHeader>
        {content}
        <DialogFooter>
          <Button variant="outline" disabled={mutation.isPending} onClick={onClose}>
            取消
          </Button>
          <Button
            disabled={!query.isSuccess || !current?.isOdc || mutation.isPending}
            onClick={() => mutation.mutate()}
          >
            {mutation.isPending ? "保存中…" : "保存"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function MemberOdcScopeEditor({
  member,
  onClose,
}: {
  member: { id: string; name: string } | null;
  onClose: () => void;
}) {
  if (!member) {
    return null;
  }
  return (
    <MemberOdcScopeDialog
      key={member.id}
      memberId={member.id}
      name={member.name}
      onClose={onClose}
    />
  );
}
