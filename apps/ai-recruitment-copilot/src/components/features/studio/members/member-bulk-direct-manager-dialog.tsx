import { useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import type { MemberRow } from "@/components/features/studio/members/members-page-model";
import { workspaceMemberHierarchyQueryKey } from "@/components/features/studio/members/member-direct-manager-control";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { rpcFetch } from "@/lib/client/api";
import { runAsyncAction } from "@/lib/client/async-control";
import { rpc } from "@/lib/client/rpc";
import { useWorkspaceSlug } from "@/lib/client/workspace-context";

export function MemberBulkDirectManagerDialog({
  allMembers,
  clearSelection,
  selectedMembers,
}: {
  allMembers: readonly MemberRow[];
  clearSelection: () => void;
  selectedMembers: readonly MemberRow[];
}) {
  const slug = useWorkspaceSlug();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [directManagerUserId, setDirectManagerUserId] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const selectedUserIds = useMemo(
    () => new Set(selectedMembers.map((member) => member.userId)),
    [selectedMembers],
  );
  const managerOptions = useMemo(
    () =>
      allMembers
        .filter((member) => !selectedUserIds.has(member.userId))
        .map((member) => ({
          avatarUrl: member.image,
          description: member.email,
          label: member.name,
          searchValue: `${member.name} ${member.email}`,
          value: member.userId,
        })),
    [allMembers, selectedUserIds],
  );
  const canSubmit =
    !submitting &&
    directManagerUserId !== null &&
    managerOptions.some((option) => option.value === directManagerUserId);

  function handleOpenChange(nextOpen: boolean) {
    if (submitting) {
      return;
    }
    setOpen(nextOpen);
    if (!nextOpen) {
      setDirectManagerUserId(null);
    }
  }

  function submit() {
    if (!canSubmit) {
      return;
    }
    setSubmitting(true);
    void runAsyncAction({
      cleanup: () => setSubmitting(false),
      onError: (error) =>
        toast.error(error instanceof Error ? error.message : "批量设置直属上级失败"),
      operation: async () => {
        await rpcFetch<{ success: boolean }>(
          rpc.api.w[":slug"].studio.workspace.members["direct-manager"].batch.$patch({
            json: {
              directManagerUserId,
              userIds: selectedMembers.map((member) => member.userId),
            },
            param: { slug },
          }),
          "批量设置直属上级失败",
        );
        await queryClient.invalidateQueries({
          queryKey: workspaceMemberHierarchyQueryKey(slug),
        });
        clearSelection();
        setOpen(false);
        setDirectManagerUserId(null);
        toast.success(`已为 ${selectedMembers.length} 位成员设置直属上级`);
      },
    });
  }

  return (
    <Dialog onOpenChange={handleOpenChange} open={open}>
      <DialogTrigger
        render={<Button variant="outline">批量设置上级（{selectedMembers.length}）</Button>}
      />
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>批量设置直属上级</DialogTitle>
          <DialogDescription>
            为已选择的 {selectedMembers.length} 位成员设置同一位直属上级。
          </DialogDescription>
        </DialogHeader>
        <FieldGroup>
          <Field data-disabled={submitting}>
            <FieldLabel htmlFor="bulk-direct-manager">直属上级</FieldLabel>
            <SearchableSelect
              disabled={submitting}
              emptyMessage="没有可选成员"
              id="bulk-direct-manager"
              onChange={setDirectManagerUserId}
              options={managerOptions}
              placeholder="请选择直属上级"
              required
              searchPlaceholder="搜索姓名或邮箱…"
              value={directManagerUserId}
            />
            <FieldDescription>已勾选的成员不会出现在直属上级候选列表中。</FieldDescription>
          </Field>
        </FieldGroup>
        <DialogFooter>
          <DialogClose
            render={
              <Button disabled={submitting} type="button" variant="outline">
                取消
              </Button>
            }
          />
          <Button disabled={!canSubmit} onClick={submit} type="button">
            {submitting ? "设置中…" : "确认设置"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
