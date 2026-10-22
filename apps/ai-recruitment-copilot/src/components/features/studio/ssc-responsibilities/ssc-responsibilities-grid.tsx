"use client";

import { IconArrowsSort, IconFileImport, IconPlus } from "@tabler/icons-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import {
  actionsColumn,
  customColumn,
  DataGrid,
  dateColumn,
  textColumn,
  useDataGridState,
} from "@/components/data-grid";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SearchableSelect } from "@/components/ui/searchable-select";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { rpcFetch } from "@/lib/client/api";
import { rpc } from "@/lib/client/rpc";
import { useWorkspaceSlug } from "@/lib/client/workspace-context";
import { EntityDeleteDialog } from "../entity-delete-dialog";
import { PageHeader } from "../page-header";
import { invalidateSscResponsibilityQueries } from "./ssc-responsibility-queries";
import { SscResponsibilityImportDialog } from "./import-dialog";
import { SscScopeFields } from "./ssc-scope-fields";
import type { SscResponsibilityScope, SscResponsibilityScopeOptions } from "./ssc-scope-fields";

export interface SscResponsibilitySource {
  id: string;
  name: string;
}

export interface SscResponsibilityRecord {
  id: string;
  demandOwner: string;
  centerName: string;
  serviceUnit: string | null;
  departmentId: string | null;
  departmentName: string | null;
  resumeSourceId: string | null;
  resumeSourceName: string | null;
  sscName: string;
  telegram: string;
  email: string;
  notes: string;
  createdAt: string;
  updatedAt: string;
  workspaceRole: string | null;
  workspaceRoleName: string | null;
}

type EditorForm = Pick<
  SscResponsibilityRecord,
  | "demandOwner"
  | "centerName"
  | "serviceUnit"
  | "departmentId"
  | "sscName"
  | "telegram"
  | "email"
  | "notes"
  | "resumeSourceId"
  | "workspaceRole"
>;
interface SscResponsibilityOptions extends SscResponsibilityScopeOptions {
  roles: { value: string; label: string }[];
  resumeSources: { id: string; name: string }[];
}
const EMPTY_FORM: EditorForm = {
  centerName: "",
  demandOwner: "",
  departmentId: null,
  email: "",
  notes: "",
  resumeSourceId: null,
  serviceUnit: null,
  sscName: "",
  telegram: "",
  workspaceRole: null,
};
const INPUT_FIELDS = [
  { key: "demandOwner", label: "需求对接负责人", maxLength: 100 },
  { key: "sscName", label: "SSC 花名", maxLength: 100 },
  { key: "telegram", label: "SSC TG", maxLength: 120 },
  { key: "email", label: "SSC 邮箱", maxLength: 254 },
] as const;

function resolveEditorAssociations(
  form: EditorForm,
  record: SscResponsibilityRecord | null,
  options: SscResponsibilityOptions | undefined,
) {
  const sources = options?.resumeSources ?? [];
  const roles = options?.roles ?? [];
  const selectedSource = sources.find((source) => source.id === form.resumeSourceId);
  const roleValue = form.workspaceRole ?? (roles.length === 1 ? roles[0]?.value : null);
  const selectedRole = roles.find((role) => role.value === roleValue);
  const keepOriginalCenter = Boolean(
    record &&
    !record.resumeSourceId &&
    !form.resumeSourceId &&
    form.centerName === record.centerName,
  );
  return { keepOriginalCenter, roles, selectedRole, selectedSource, sources };
}

function buildSscResponsibilityInput(
  form: EditorForm,
  selectedSource: SscResponsibilityOptions["resumeSources"][number] | undefined,
  selectedRole: SscResponsibilityOptions["roles"][number] | undefined,
) {
  if (!selectedRole) {
    throw new Error("请选择 SSC 工作区角色。");
  }
  return {
    centerName: selectedSource?.name ?? form.centerName,
    demandOwner: form.demandOwner.trim(),
    departmentId: form.departmentId,
    email: form.email.trim().toLowerCase(),
    notes: form.notes.trim(),
    resumeSourceId: selectedSource?.id ?? null,
    serviceUnit: form.serviceUnit?.trim() || null,
    sscName: form.sscName.trim(),
    telegram: form.telegram.trim(),
    workspaceRole: selectedRole.value,
  };
}

function SscSourceField({
  value,
  originalName,
  sources,
  disabled,
  loading,
  onChange,
  fixedName,
}: {
  value: string | null;
  originalName: string | undefined;
  sources: SscResponsibilityOptions["resumeSources"];
  disabled: boolean;
  loading: boolean;
  onChange: (source: SscResponsibilityOptions["resumeSources"][number]) => void;
  fixedName?: string;
}) {
  if (fixedName !== undefined) {
    return (
      <div className="grid gap-1.5 sm:col-span-2">
        <Label htmlFor="ssc-fixed-source">中心/部门</Label>
        <Input id="ssc-fixed-source" readOnly value={fixedName} />
      </div>
    );
  }
  return (
    <div className="grid gap-1.5 sm:col-span-2">
      <Label htmlFor="ssc-resumeSourceId">中心/部门 *</Label>
      {originalName ? (
        <p className="flex items-center gap-2 text-sm">
          原始名称：{originalName}
          <Badge variant="warning">待关联</Badge>
        </p>
      ) : null}
      <SearchableSelect
        id="ssc-resumeSourceId"
        value={value}
        options={sources.map((source) => ({ label: source.name, value: source.id }))}
        disabled={disabled}
        required
        placeholder={loading ? "加载中心/部门中…" : "选择中心/部门"}
        searchPlaceholder="搜索中心/部门"
        emptyMessage="暂无匹配的中心/部门"
        onChange={(id) => {
          const source = sources.find((item) => item.id === id);
          if (source) {
            onChange(source);
          }
        }}
      />
      {originalName ? (
        <p className="text-xs text-muted-foreground">
          可保留原名称修改联系方式，也可选择对应的中心/部门完成关联。
        </p>
      ) : null}
    </div>
  );
}

function SscRoleField({
  role,
  roles,
  disabled,
  loading,
  failed,
  onChange,
}: {
  role: SscResponsibilityOptions["roles"][number] | undefined;
  roles: SscResponsibilityOptions["roles"];
  disabled: boolean;
  loading: boolean;
  failed: boolean;
  onChange: (value: string) => void;
}) {
  return (
    <div className="grid gap-1.5 sm:col-span-2">
      <Label htmlFor="ssc-workspaceRole">工作区角色 *</Label>
      <Select
        value={role?.value ?? null}
        disabled={disabled || !roles.length}
        onValueChange={(value) => {
          if (value) {
            onChange(value);
          }
        }}
      >
        <SelectTrigger id="ssc-workspaceRole" className="w-full">
          <SelectValue placeholder="待设置角色">{role?.label ?? "待设置角色"}</SelectValue>
        </SelectTrigger>
        <SelectContent>
          <SelectGroup>
            {roles.map((item) => (
              <SelectItem key={item.value} value={item.value}>
                {item.label}
              </SelectItem>
            ))}
          </SelectGroup>
        </SelectContent>
      </Select>
      {!loading && !failed && !roles.length ? (
        <p className="text-xs text-muted-foreground">
          当前工作区暂无 SSC 角色，请先在角色与权限中配置。
        </p>
      ) : null}
      <p className="text-xs text-muted-foreground">
        SSC 在新 Offer 待接收后，才可查看负责中心/部门的相关候选人。
      </p>
    </div>
  );
}

export function SscResponsibilityEditorDialog({
  open,
  record,
  onOpenChange,
  onSaved,
  fixedSource,
  initialScope,
}: {
  open: boolean;
  record: SscResponsibilityRecord | null;
  onOpenChange: (open: boolean) => void;
  onSaved: () => void;
  fixedSource?: SscResponsibilitySource;
  initialScope?: SscResponsibilityScope;
}) {
  const slug = useWorkspaceSlug();
  const queryClient = useQueryClient();
  const initialForm = useMemo(
    () =>
      fixedSource
        ? {
            ...(record ?? { ...EMPTY_FORM, ...initialScope }),
            centerName: fixedSource.name,
            resumeSourceId: fixedSource.id,
          }
        : (record ?? { ...EMPTY_FORM, ...initialScope }),
    [record, fixedSource, initialScope],
  );
  const [form, setForm] = useState<EditorForm>(initialForm);
  const optionsQuery = useQuery({
    enabled: open,
    queryFn: () =>
      rpcFetch<SscResponsibilityOptions>(
        rpc.api.w[":slug"].studio["ssc-responsibilities"].options.$get({ param: { slug } }),
        "加载中心/部门与 SSC 角色失败",
      ),
    queryKey: ["studio-ssc-responsibility-options", slug],
    staleTime: 30_000,
  });
  const { sources, roles, selectedSource, selectedRole, keepOriginalCenter } =
    resolveEditorAssociations(form, record, optionsQuery.data);
  useEffect(() => {
    if (open) {
      setForm(initialForm);
    }
  }, [open, initialForm]);
  const canSubmit =
    Boolean(selectedRole && (selectedSource || keepOriginalCenter)) &&
    !optionsQuery.isPending &&
    !optionsQuery.isError;
  const mutation = useMutation({
    mutationFn: () => {
      const json = buildSscResponsibilityInput(form, selectedSource, selectedRole);
      const api = rpc.api.w[":slug"].studio["ssc-responsibilities"];
      return rpcFetch<{ id: string }>(
        record
          ? api[":id"].$patch({ json, param: { id: record.id, slug } })
          : api.$post({ json, param: { slug } }),
        "保存 SSC 负责组织失败",
      );
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : "保存失败"),
    onSuccess: async () => {
      toast.success(record ? "SSC 负责组织已更新" : "SSC 负责组织已新增");
      await invalidateSscResponsibilityQueries(queryClient, slug);
      onSaved();
      onOpenChange(false);
    },
  });
  return (
    <Dialog
      open={open}
      onOpenChange={(value) => {
        if (!mutation.isPending) {
          onOpenChange(value);
        }
      }}
    >
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-xl">
        <form
          onSubmit={(event) => {
            event.preventDefault();
            if (canSubmit && !mutation.isPending) {
              mutation.mutate();
            }
          }}
        >
          <DialogHeader>
            <DialogTitle>{record ? "编辑 SSC 负责组织" : "新增 SSC 负责组织"}</DialogTitle>
            <DialogDescription>
              按候选人所选岗位匹配 SSC，优先使用服务单位、部门细分范围，未细分时使用通用范围。SSC
              无需先注册，联系方式可后续补充。
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-5 sm:grid-cols-2">
            <SscSourceField
              value={form.resumeSourceId}
              originalName={keepOriginalCenter ? record?.centerName : undefined}
              fixedName={fixedSource ? (selectedSource?.name ?? fixedSource.name) : undefined}
              sources={sources}
              disabled={mutation.isPending || optionsQuery.isPending || optionsQuery.isError}
              loading={optionsQuery.isPending}
              onChange={(source) =>
                setForm((previous) => ({
                  ...previous,
                  centerName: source.name,
                  resumeSourceId: source.id,
                }))
              }
            />
            <SscRoleField
              role={selectedRole}
              roles={roles}
              disabled={mutation.isPending || optionsQuery.isPending || optionsQuery.isError}
              loading={optionsQuery.isPending}
              failed={optionsQuery.isError}
              onChange={(value) => setForm((previous) => ({ ...previous, workspaceRole: value }))}
            />
            <SscScopeFields
              value={form}
              options={optionsQuery.data}
              disabled={mutation.isPending || optionsQuery.isPending || optionsQuery.isError}
              onChange={(scope) => setForm((previous) => ({ ...previous, ...scope }))}
            />
            {optionsQuery.isError ? (
              <div className="sm:col-span-2">
                <p role="alert" className="text-sm text-destructive">
                  中心/部门与角色加载失败，请重试。
                </p>
                <Button type="button" variant="outline" onClick={() => void optionsQuery.refetch()}>
                  重试加载
                </Button>
              </div>
            ) : null}
            {INPUT_FIELDS.map((field) => (
              <div className="grid gap-1.5" key={field.key}>
                <Label htmlFor={`ssc-${field.key}`}>
                  {field.label}
                  （可选）
                </Label>
                <Input
                  id={`ssc-${field.key}`}
                  value={form[field.key]}
                  maxLength={field.maxLength}
                  type={field.key === "email" ? "email" : "text"}
                  disabled={mutation.isPending}
                  onChange={(event) =>
                    setForm((previous) => ({ ...previous, [field.key]: event.target.value }))
                  }
                />
              </div>
            ))}
            <div className="grid gap-1.5 sm:col-span-2">
              <Label htmlFor="ssc-notes">备注（可选）</Label>
              <Textarea
                id="ssc-notes"
                value={form.notes}
                maxLength={4000}
                disabled={mutation.isPending}
                onChange={(event) =>
                  setForm((previous) => ({ ...previous, notes: event.target.value }))
                }
                rows={3}
              />
            </div>
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              disabled={mutation.isPending}
              onClick={() => onOpenChange(false)}
            >
              取消
            </Button>
            <Button type="submit" disabled={!canSubmit || mutation.isPending}>
              {mutation.isPending ? "保存中…" : "保存"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function sortKey(value: string | undefined): "centerName" | "sscName" | "email" | "createdAt" {
  return value === "sscName" || value === "email" || value === "createdAt" ? value : "centerName";
}

function sortableTextColumn(options: {
  key: "centerName" | "sscName" | "email";
  fallback?: string;
  primary?: boolean;
  title: string;
}) {
  return customColumn<SscResponsibilityRecord>({
    accessorKey: options.key,
    cell: (row) =>
      options.key === "centerName" ? (
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-medium">{row.resumeSourceName ?? row.centerName}</span>
          <Badge variant={row.resumeSourceId && row.resumeSourceName ? "success" : "warning"}>
            {row.resumeSourceId && row.resumeSourceName ? "已关联" : "待关联"}
          </Badge>
        </div>
      ) : (
        <span className={options.primary ? "font-medium" : undefined}>
          {row[options.key] || options.fallback || ""}
        </span>
      ),
    enableSorting: true,
    key: options.key,
    title: ({ column }) => (
      <Button
        aria-label={`${options.title}排序`}
        className="h-5 px-1 text-muted-foreground text-xs"
        onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}
        size="xs"
        variant="ghost"
      >
        {options.title}
        <IconArrowsSort className="size-3.5" />
      </Button>
    ),
  });
}

export function SscResponsibilitiesGrid() {
  const slug = useWorkspaceSlug();
  const queryClient = useQueryClient();
  const [editorOpen, setEditorOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [editingRecord, setEditingRecord] = useState<SscResponsibilityRecord | null>(null);
  const [deletingRecord, setDeletingRecord] = useState<SscResponsibilityRecord | null>(null);
  const grid = useDataGridState<SscResponsibilityRecord, Record<string, never>>({
    allowedSortIds: ["centerName", "sscName", "email", "createdAt"],
    defaultPageSize: 20,
    defaultSorting: [{ desc: false, id: "centerName" }],
    initialFilters: {},
    keywordSearch: true,
    queryFn: (params) =>
      rpcFetch<{ records: SscResponsibilityRecord[]; total: number; totalPages: number }>(
        rpc.api.w[":slug"].studio["ssc-responsibilities"].$get(
          {
            param: { slug },
            query: {
              page: String(params.page),
              pageSize: String(params.pageSize),
              search: params.search || undefined,
              sortBy: sortKey(params.sortBy),
              sortOrder: params.sortOrder ?? "asc",
            },
          },
          { init: { signal: params.signal } },
        ),
        "加载 SSC 负责组织失败",
      ),
    queryKeyBase: ["studio-ssc-responsibilities", slug],
  });
  const deletion = useMutation({
    mutationFn: (id: string) =>
      rpcFetch<{ success: boolean }>(
        rpc.api.w[":slug"].studio["ssc-responsibilities"][":id"].$delete({ param: { id, slug } }),
        "删除 SSC 负责组织失败",
      ),
    onError: (error) => toast.error(error instanceof Error ? error.message : "删除失败"),
    onSuccess: async () => {
      toast.success("SSC 负责组织已删除");
      setDeletingRecord(null);
      await invalidateSscResponsibilityQueries(queryClient, slug);
    },
  });
  const columns = useMemo(
    () => [
      textColumn<SscResponsibilityRecord>({ key: "demandOwner", title: "需求对接负责人" }),
      sortableTextColumn({ key: "centerName", primary: true, title: "中心/部门" }),
      textColumn<SscResponsibilityRecord>({
        fallback: "不限",
        key: "serviceUnit",
        title: "服务单位",
      }),
      textColumn<SscResponsibilityRecord>({
        fallback: "不限",
        key: "departmentName",
        title: "部门",
      }),
      textColumn<SscResponsibilityRecord>({
        fallback: "待设置角色",
        key: "workspaceRoleName",
        title: "工作区角色",
      }),
      sortableTextColumn({ fallback: "待补充", key: "sscName", title: "SSC 花名" }),
      textColumn<SscResponsibilityRecord>({ fallback: "待补充", key: "telegram", title: "SSC TG" }),
      sortableTextColumn({ fallback: "待补充", key: "email", title: "SSC 邮箱" }),
      textColumn<SscResponsibilityRecord>({ key: "notes", title: "备注" }),
      dateColumn<SscResponsibilityRecord>({ key: "createdAt", sortable: true, title: "创建时间" }),
      actionsColumn<SscResponsibilityRecord>({
        inline: [
          {
            label: "编辑",
            onClick: (row) => {
              setEditingRecord(row);
              setEditorOpen(true);
            },
          },
          { label: "删除", onClick: setDeletingRecord },
        ],
      }),
    ],
    [],
  );
  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="SSC 负责组织"
        description="按候选人所选岗位匹配 SSC，细分范围优先，未细分时使用通用范围。"
      />
      <DataGrid<SscResponsibilityRecord>
        {...grid.bind}
        columns={columns}
        columnPinning={{ end: ["actions"] }}
        getRowId={(row) => row.id}
        filters={[
          {
            key: "search",
            minWidth: "20rem",
            placeholder: "搜索负责人、中心、服务单位、部门、SSC 或联系方式",
            type: "search",
          },
        ]}
        toolbarRight={
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="outline" onClick={() => setImportOpen(true)}>
              <IconFileImport data-icon="inline-start" />
              数据导入
            </Button>
            <Button
              onClick={() => {
                setEditingRecord(null);
                setEditorOpen(true);
              }}
            >
              <IconPlus data-icon="inline-start" />
              新增 SSC 负责组织
            </Button>
          </div>
        }
        empty={
          <Empty className="border-border">
            <EmptyHeader>
              <EmptyTitle>
                {grid.search ? "没有匹配的 SSC 负责组织" : "暂无 SSC 负责组织"}
              </EmptyTitle>
              <EmptyDescription>
                {grid.search ? "调整搜索关键词后重试。" : "新增关系，提前记录 SSC 负责的组织。"}
              </EmptyDescription>
            </EmptyHeader>
          </Empty>
        }
      />
      {importOpen ? <SscResponsibilityImportDialog onClose={() => setImportOpen(false)} /> : null}
      {editorOpen ? (
        <SscResponsibilityEditorDialog
          key={editingRecord?.id ?? "new"}
          open={editorOpen}
          record={editingRecord}
          onOpenChange={setEditorOpen}
          onSaved={() => setEditorOpen(false)}
        />
      ) : null}
      <EntityDeleteDialog
        record={deletingRecord}
        isPending={deletion.isPending}
        onClose={() => setDeletingRecord(null)}
        onConfirm={() => {
          if (deletingRecord) {
            deletion.mutate(deletingRecord.id);
          }
        }}
        title="删除 SSC 负责组织？"
        description={(row) =>
          `确定删除 ${row.resumeSourceName ?? row.centerName} 的 SSC 预录入关系？`
        }
      />
    </div>
  );
}
