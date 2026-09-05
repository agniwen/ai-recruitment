"use client";

import { IconClipboardList, IconPlus } from "@tabler/icons-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import {
  actionsColumn,
  customColumn,
  DataGrid,
  dateColumn,
  textColumn,
  useDataGridState,
} from "@/components/data-grid";
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
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { SearchableSelect } from "@/components/ui/searchable-select";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { rpcFetch } from "@/lib/client/api";
import { useWorkspaceSlug } from "@/lib/client/workspace-context";
import { rpc } from "@/lib/client/rpc";

type RecruitingRole = "recruitingSupervisor" | "recruitingLead" | "hr";

interface StudioPreRegistrationRecord {
  createdAt: string;
  directManagerEmail: string | null;
  directManagerName: string | null;
  displayName: string;
  email: string;
  id: string;
  recruitingGroupNames: string[];
  recruitingRole: RecruitingRole;
  registeredUserId: string | null;
  telegram: string;
  workspaceRole: string;
  updatedAt: string;
  workspaceSlug: string;
}

interface StudioPreRegistrationsResult {
  page: number;
  pageSize: number;
  records: StudioPreRegistrationRecord[];
  total: number;
  totalPages: number;
}

interface ManagerOption {
  displayName: string;
  email: string;
  source: "both" | "pre_registration" | "registered";
}

interface EditorForm {
  directManagerEmail: string | null;
  displayName: string;
  email: string;
  recruitingGroupNames: string;
  recruitingRole: RecruitingRole;
  telegram: string;
  workspaceRole: string;
}

const EMPTY_FORM: EditorForm = {
  directManagerEmail: null,
  displayName: "",
  email: "",
  recruitingGroupNames: "",
  recruitingRole: "hr",
  telegram: "",
  workspaceRole: "member",
};

const ROLE_LABELS: Record<RecruitingRole, string> = {
  hr: "招聘专员",
  recruitingLead: "招聘组长",
  recruitingSupervisor: "招聘主管",
};

function managerSourceLabel(source: ManagerOption["source"]) {
  if (source === "both") {
    return "已预录入 / 已注册";
  }
  return source === "registered" ? "已注册" : "已预录入";
}

function toEditorForm(record: StudioPreRegistrationRecord | null): EditorForm {
  if (!record) {
    return EMPTY_FORM;
  }
  return {
    directManagerEmail: record.directManagerEmail,
    displayName: record.displayName,
    email: record.email,
    recruitingGroupNames: record.recruitingGroupNames.join("，"),
    recruitingRole: record.recruitingRole,
    telegram: record.telegram,
    workspaceRole: record.workspaceRole,
  };
}

function parseGroupNames(value: string) {
  return [
    ...new Set(
      value
        .split(/[，,]/)
        .map((name) => name.trim())
        .filter(Boolean),
    ),
  ];
}

function PreRegistrationEditorDialog({
  roleOptions,
  managerOptions,
  onOpenChange,
  onSaved,
  open,
  record,
}: {
  managerOptions: ManagerOption[];
  roleOptions: { label: string; value: string }[];
  onOpenChange: (open: boolean) => void;
  onSaved: () => void;
  open: boolean;
  record: StudioPreRegistrationRecord | null;
}) {
  const slug = useWorkspaceSlug();
  const [form, setForm] = useState<EditorForm>(() => toEditorForm(record));
  const selectableManagers = useMemo(
    () =>
      managerOptions
        .filter((option) => option.email.toLowerCase() !== form.email.trim().toLowerCase())
        .map((option) => ({
          description: `${option.email} · ${managerSourceLabel(option.source)}`,
          label: option.displayName,
          searchValue: `${option.displayName} ${option.email}`,
          value: option.email,
        })),
    [form.email, managerOptions],
  );
  const groupNames = parseGroupNames(form.recruitingGroupNames);
  const canSubmit =
    form.displayName.trim().length > 0 &&
    form.email.trim().length > 0 &&
    form.telegram.trim().length > 0 &&
    groupNames.length > 0 &&
    roleOptions.some((option) => option.value === form.workspaceRole);
  const mutation = useMutation({
    mutationFn: () => {
      const json = {
        directManagerEmail: form.directManagerEmail,
        displayName: form.displayName,
        email: form.email,
        recruitingGroupNames: groupNames,
        recruitingRole: form.recruitingRole,
        telegram: form.telegram,
        workspaceRole: form.workspaceRole,
      };
      if (record) {
        return rpcFetch<{ id: string }>(
          rpc.api.w[":slug"].studio["pre-registrations"][":id"].$patch({
            json,
            param: { id: record.id, slug },
          }),
          "预录入信息更新失败",
        );
      }
      return rpcFetch<{ id: string }>(
        rpc.api.w[":slug"].studio["pre-registrations"].$post({ json, param: { slug } }),
        "预录入信息创建失败",
      );
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : "预录入信息保存失败");
    },
    onSuccess: () => {
      toast.success(record ? "预录入信息已更新" : "预录入信息已创建");
      onSaved();
      onOpenChange(false);
    },
  });

  return (
    <Dialog onOpenChange={onOpenChange} open={open}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{record ? "编辑预录入信息" : "新增预录入信息"}</DialogTitle>
          <DialogDescription>
            用户注册后会自动加入当前工作区，并应用工作区角色、招聘组、直属上级和 TG。
          </DialogDescription>
        </DialogHeader>
        <form
          className="flex flex-col gap-5"
          onSubmit={(event) => {
            event.preventDefault();
            if (canSubmit) {
              mutation.mutate();
            }
          }}
        >
          <FieldGroup className="gap-5">
            <Field data-disabled={mutation.isPending}>
              <FieldLabel htmlFor="pre-registration-email">Gmail</FieldLabel>
              <Input
                autoComplete="email"
                disabled={mutation.isPending}
                id="pre-registration-email"
                onChange={(event) => {
                  const email = event.target.value;
                  setForm((current) => ({
                    ...current,
                    directManagerEmail:
                      current.directManagerEmail?.toLowerCase() === email.trim().toLowerCase()
                        ? null
                        : current.directManagerEmail,
                    email,
                  }));
                }}
                placeholder="name@gmail.com"
                type="email"
                value={form.email}
              />
            </Field>
            <Field data-disabled={mutation.isPending}>
              <FieldLabel htmlFor="pre-registration-display-name">花名</FieldLabel>
              <Input
                disabled={mutation.isPending}
                id="pre-registration-display-name"
                onChange={(event) =>
                  setForm((current) => ({ ...current, displayName: event.target.value }))
                }
                value={form.displayName}
              />
            </Field>
            <Field data-disabled={mutation.isPending}>
              <FieldLabel htmlFor="pre-registration-telegram">TG</FieldLabel>
              <Input
                disabled={mutation.isPending}
                id="pre-registration-telegram"
                onChange={(event) =>
                  setForm((current) => ({ ...current, telegram: event.target.value }))
                }
                placeholder="@username"
                value={form.telegram}
              />
            </Field>
            <Field data-disabled={mutation.isPending}>
              <FieldLabel htmlFor="pre-registration-groups">招聘组</FieldLabel>
              <Input
                disabled={mutation.isPending}
                id="pre-registration-groups"
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    recruitingGroupNames: event.target.value,
                  }))
                }
                placeholder="多个招聘组用逗号分隔"
                value={form.recruitingGroupNames}
              />
              <FieldDescription>
                若当前工作区中不存在对应招聘组，注册时会自动创建。
              </FieldDescription>
            </Field>
            <Field data-disabled={mutation.isPending}>
              <FieldLabel htmlFor="pre-registration-workspace-role">工作区角色</FieldLabel>
              <Select
                disabled={mutation.isPending}
                value={form.workspaceRole}
                onValueChange={(value) => {
                  if (value) {
                    setForm((current) => ({ ...current, workspaceRole: value }));
                  }
                }}
              >
                <SelectTrigger className="w-full" id="pre-registration-workspace-role">
                  <SelectValue placeholder="选择工作区角色">
                    {roleOptions.find((option) => option.value === form.workspaceRole)?.label ??
                      "请选择角色"}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    {roleOptions.map((option) => (
                      <SelectItem key={option.value} value={option.value}>
                        {option.label}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                </SelectContent>
              </Select>
              <FieldDescription>
                首次加入工作区时自动设置；已有成员的工作区角色保持不变。
              </FieldDescription>
            </Field>
            <Field data-disabled={mutation.isPending}>
              <FieldLabel htmlFor="pre-registration-role">招聘角色</FieldLabel>
              <Select
                disabled={mutation.isPending}
                onValueChange={(value) =>
                  setForm((current) => ({
                    ...current,
                    recruitingRole: value as RecruitingRole,
                  }))
                }
                value={form.recruitingRole}
              >
                <SelectTrigger className="w-full" id="pre-registration-role">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    {Object.entries(ROLE_LABELS).map(([value, label]) => (
                      <SelectItem key={value} value={value}>
                        {label}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                </SelectContent>
              </Select>
            </Field>
            <Field data-disabled={mutation.isPending}>
              <FieldLabel htmlFor="pre-registration-manager">直属上级</FieldLabel>
              <SearchableSelect
                clearable
                disabled={mutation.isPending}
                emptyMessage="没有匹配的人员"
                id="pre-registration-manager"
                onChange={(directManagerEmail) =>
                  setForm((current) => ({ ...current, directManagerEmail }))
                }
                options={selectableManagers}
                placeholder="无直属上级"
                searchPlaceholder="搜索花名或邮箱…"
                value={form.directManagerEmail}
              />
            </Field>
          </FieldGroup>
          <DialogFooter>
            <Button
              disabled={mutation.isPending}
              onClick={() => onOpenChange(false)}
              type="button"
              variant="outline"
            >
              取消
            </Button>
            <Button disabled={!canSubmit || mutation.isPending} type="submit">
              {mutation.isPending ? "保存中…" : "保存"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function StudioPreRegistrationsGrid() {
  const slug = useWorkspaceSlug();
  const queryClient = useQueryClient();
  const [editorOpen, setEditorOpen] = useState(false);
  const [editingRecord, setEditingRecord] = useState<StudioPreRegistrationRecord | null>(null);
  const [deletingRecord, setDeletingRecord] = useState<StudioPreRegistrationRecord | null>(null);
  const roleOptionsQuery = useQuery({
    queryFn: () =>
      rpcFetch<{ records: { label: string; value: string }[] }>(
        rpc.api.w[":slug"].studio["pre-registrations"]["role-options"].$get({ param: { slug } }),
        "加载工作区角色失败",
      ),
    queryKey: ["studio-pre-registration-role-options", slug],
  });
  const managerOptionsQuery = useQuery({
    queryFn: () =>
      rpcFetch<{ records: ManagerOption[] }>(
        rpc.api.w[":slug"].studio["pre-registrations"]["manager-options"].$get({ param: { slug } }),
        "加载直属上级候选失败",
      ),
    queryKey: ["studio-pre-registration-manager-options", slug],
    staleTime: 30_000,
  });
  const grid = useDataGridState<StudioPreRegistrationRecord, Record<string, never>>({
    allowedSortIds: ["displayName", "email", "createdAt"],
    defaultPageSize: 20,
    defaultSorting: [{ desc: false, id: "displayName" }],
    initialFilters: {},
    queryFn: (params): Promise<StudioPreRegistrationsResult> =>
      rpcFetch<StudioPreRegistrationsResult>(
        rpc.api.w[":slug"].studio["pre-registrations"].$get({
          param: { slug },
          query: {
            page: String(params.page),
            pageSize: String(params.pageSize),
            ...(params.search ? { search: params.search } : {}),
            sortBy: (params.sortBy as "displayName" | "email" | "createdAt") ?? "displayName",
            sortOrder: params.sortOrder ?? "asc",
          },
        }),
        "加载预录入信息失败",
      ),
    queryKeyBase: ["studio-pre-registrations", slug],
  });
  const deleteMutation = useMutation({
    mutationFn: (id: string) =>
      rpcFetch<{ success: boolean }>(
        rpc.api.w[":slug"].studio["pre-registrations"][":id"].$delete({ param: { id, slug } }),
        "删除预录入信息失败",
      ),
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : "删除预录入信息失败");
    },
    onSuccess: () => {
      toast.success("预录入信息已删除");
      setDeletingRecord(null);
      void queryClient.invalidateQueries({
        queryKey: ["studio-pre-registration-manager-options", slug],
      });
      grid.invalidate();
    },
  });
  const columns = useMemo(
    () => [
      textColumn<StudioPreRegistrationRecord>({
        key: "displayName",
        primary: true,
        title: "花名",
      }),
      textColumn<StudioPreRegistrationRecord>({ key: "email", title: "Gmail" }),
      textColumn<StudioPreRegistrationRecord>({ key: "telegram", title: "TG" }),
      customColumn<StudioPreRegistrationRecord>({
        cell: (row) => (
          <div className="flex flex-wrap gap-1">
            {row.recruitingGroupNames.map((name) => (
              <Badge key={name} variant="outline">
                {name}
              </Badge>
            ))}
          </div>
        ),
        key: "recruitingGroupNames",
        title: "招聘组",
      }),
      customColumn<StudioPreRegistrationRecord>({
        cell: (row) => ROLE_LABELS[row.recruitingRole],
        key: "recruitingRole",
        title: "招聘角色",
      }),
      customColumn<StudioPreRegistrationRecord>({
        cell: (row) =>
          roleOptionsQuery.data?.records.find((option) => option.value === row.workspaceRole)
            ?.label ?? row.workspaceRole,
        key: "workspaceRole",
        title: "工作区角色",
      }),
      textColumn<StudioPreRegistrationRecord>({
        fallback: "—",
        key: "directManagerName",
        title: "直属上级",
      }),
      customColumn<StudioPreRegistrationRecord>({
        cell: (row) => (
          <Badge variant={row.registeredUserId ? "success" : "secondary"}>
            {row.registeredUserId ? "已注册" : "待注册"}
          </Badge>
        ),
        key: "registeredUserId",
        title: "状态",
      }),
      dateColumn<StudioPreRegistrationRecord>({
        key: "createdAt",
        sortable: true,
        title: "创建时间",
      }),
      actionsColumn<StudioPreRegistrationRecord>({
        inline: [
          {
            label: "编辑",
            onClick: (row) => {
              setEditingRecord(row);
              setEditorOpen(true);
            },
          },
        ],
        menu: [
          {
            label: "删除",
            onClick: setDeletingRecord,
            variant: "destructive",
          },
        ],
      }),
    ],
    [roleOptionsQuery.data],
  );

  function handleSaved() {
    grid.invalidate();
    void queryClient.invalidateQueries({
      queryKey: ["studio-pre-registration-manager-options", slug],
    });
  }

  return (
    <>
      <DataGrid<StudioPreRegistrationRecord>
        {...grid.bind}
        columnPinning={{ end: ["actions"] }}
        columns={columns}
        empty={
          <Empty className="border-border">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <IconClipboardList />
              </EmptyMedia>
              <EmptyTitle>{grid.search ? "没有匹配的预录入信息" : "暂无预录入信息"}</EmptyTitle>
              <EmptyDescription>
                {grid.search ? "调整搜索关键词后重试。" : "新增信息后，用户注册时会自动完成配置。"}
              </EmptyDescription>
            </EmptyHeader>
          </Empty>
        }
        filters={[
          {
            key: "search",
            minWidth: "20rem",
            placeholder: "搜索花名、邮箱、TG 或招聘组",
            type: "search",
          },
        ]}
        getRowId={(row) => row.id}
        toolbarRight={
          <Button
            onClick={() => {
              setEditingRecord(null);
              setEditorOpen(true);
            }}
          >
            <IconPlus data-icon="inline-start" />
            新增预录入
          </Button>
        }
      />

      {editorOpen ? (
        <PreRegistrationEditorDialog
          key={editingRecord?.id ?? "new"}
          roleOptions={roleOptionsQuery.data?.records ?? []}
          managerOptions={managerOptionsQuery.data?.records ?? []}
          onOpenChange={setEditorOpen}
          onSaved={handleSaved}
          open={editorOpen}
          record={editingRecord}
        />
      ) : null}

      <AlertDialog
        onOpenChange={(open) => {
          if (!open && !deleteMutation.isPending) {
            setDeletingRecord(null);
          }
        }}
        open={deletingRecord !== null}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>删除预录入信息？</AlertDialogTitle>
            <AlertDialogDescription>
              {deletingRecord
                ? `删除 ${deletingRecord.displayName}（${deletingRecord.email}）后，将不再自动应用注册配置。`
                : "删除后将不再自动应用注册配置。"}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleteMutation.isPending}>取消</AlertDialogCancel>
            <AlertDialogAction
              disabled={deleteMutation.isPending}
              onClick={() => {
                if (deletingRecord) {
                  deleteMutation.mutate(deletingRecord.id);
                }
              }}
              variant="destructive"
            >
              {deleteMutation.isPending ? "删除中…" : "删除"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
