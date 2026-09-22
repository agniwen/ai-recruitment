import { useState } from "react";
import type { InferResponseType } from "hono/client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { rpc } from "@/lib/client/rpc";
import { rpcFetch } from "@/lib/client/api";
import { useWorkspaceSlug, useWorkspaceMemberRole } from "@/lib/client/workspace-context";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field, FieldLabel, FieldDescription, FieldGroup } from "@/components/ui/field";
import { Modal } from "@/components/ui/modal";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { SearchableMultiSelect } from "@/components/ui/searchable-multi-select";
import { PageHeader } from "@/components/features/studio/page-header";
import {
  Table,
  TableHeader,
  TableHead,
  TableRow,
  TableBody,
  TableCell,
} from "@/components/ui/table";
import { readResponsibilityFile } from "./import-file";
import type { ResponsibilityImportRow } from "./import-file";
import { ImportPreview } from "./import-preview";
import { downloadResponsibilityTemplate } from "./download-template";
import { isWorkspaceAdministratorRole } from "@arc/shared/permissions";

interface Editor {
  memberId: string;
  resumeSourceId: string;
  departmentIds: string[];
  allDepartments: boolean;
}
function canSaveScope(editor: Editor | null, pending: boolean) {
  return Boolean(!pending && editor?.memberId && editor.resumeSourceId);
}

export function OdcResponsibilitiesPage() {
  const slug = useWorkspaceSlug();
  const role = useWorkspaceMemberRole();
  const canManage = isWorkspaceAdministratorRole(role);
  const client = useQueryClient();
  const api = rpc.api.w[":slug"].studio["odc-responsibilities"];
  type Catalog = InferResponseType<typeof api.$get, 200>;
  type Preview = InferResponseType<typeof api.preview.$post, 200>;
  const queryKey = ["odc-responsibilities", slug];
  const query = useQuery({
    enabled: canManage,
    queryFn: () => rpcFetch<Catalog>(api.$get({ param: { slug } }), "加载 ODC 负责范围失败"),
    queryKey,
  });
  const [search, setSearch] = useState("");
  const [editor, setEditor] = useState<Editor | null>(null);
  const [editingExisting, setEditingExisting] = useState(false);
  const [pending, setPending] = useState(false);
  const [importRows, setImportRows] = useState<ResponsibilityImportRow[]>([]);
  const [preview, setPreview] = useState<Awaited<ReturnType<typeof previewRows>> | null>(null);
  const [fileError, setFileError] = useState("");
  function previewRows(rows: ResponsibilityImportRow[]) {
    return rpcFetch<Preview>(
      api.preview.$post({ json: { rows }, param: { slug } }),
      "导入预览失败",
    );
  }
  async function save() {
    if (!editor) {
      return;
    }
    setPending(true);
    try {
      await rpcFetch(api.$put({ json: editor, param: { slug } }), "保存失败");
      await client.invalidateQueries({ queryKey });
      setEditor(null);
      toast.success("ODC 负责范围已保存");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "保存失败");
    } finally {
      setPending(false);
    }
  }
  async function importFile(file: File) {
    setPending(true);
    setPreview(null);
    setImportRows([]);
    setFileError("");
    try {
      const rows = await readResponsibilityFile(file);
      const result = await previewRows(rows);
      setImportRows(rows);
      setPreview(result);
    } catch (error) {
      setFileError(error instanceof Error ? error.message : "读取失败");
    } finally {
      setPending(false);
    }
  }
  async function confirmImport() {
    setPending(true);
    try {
      const result = await rpcFetch<InferResponseType<typeof api.import.$post, 200>>(
        api.import.$post({ json: { rows: importRows }, param: { slug } }),
        "导入失败",
      );
      await client.invalidateQueries({ queryKey });
      setPreview(null);
      setImportRows([]);
      toast.success(`已新增 ${result.added} 条负责关系，原有关系保留`);
    } catch (error) {
      setPreview(null);
      setFileError(error instanceof Error ? error.message : "导入失败，请重新上传预览");
    } finally {
      setPending(false);
    }
  }
  if (!canManage) {
    return <p>仅工作区管理员可以维护 ODC 负责范围。</p>;
  }
  const { data } = query;
  function selectScope(memberId: string, resumeSourceId: string) {
    const scope =
      data?.responsibilities.filter(
        (r) => r.memberId === memberId && r.resumeSourceId === resumeSourceId,
      ) ?? [];
    setEditor({
      allDepartments: scope.some((r) => r.departmentId === null),
      departmentIds: scope.flatMap((r) => (r.departmentId ? [r.departmentId] : [])),
      memberId,
      resumeSourceId,
    });
  }
  const rows =
    data?.assignments
      .flatMap((assignment) => {
        const person = data.members.find((m) => m.id === assignment.memberId);
        const center = data.centers.find((c) => c.id === assignment.resumeSourceId);
        if (!person || !center) {
          return [];
        }
        const scope = data.responsibilities.filter(
          (r) => r.memberId === person.id && r.resumeSourceId === center.id,
        );
        const allDepartments = scope.some((r) => r.departmentId === null);
        const departmentIds = scope.flatMap((r) => (r.departmentId ? [r.departmentId] : []));
        const departmentNames = data.departments
          .filter((d) => departmentIds.includes(d.id))
          .map((d) => d.name);
        return [
          {
            ...assignment,
            allDepartments,
            center,
            departmentIds,
            departmentNames: allDepartments
              ? "全部部门"
              : departmentNames.join("、") || "负责部门未配置",
            person,
          },
        ];
      })
      .filter((row) =>
        `${row.person.name} ${row.person.email} ${row.center.name} ${row.departmentNames}`
          .toLowerCase()
          .includes(search.toLowerCase()),
      ) ?? [];
  return (
    <div className="mx-auto flex w-full max-w-[96rem] flex-col gap-6">
      <PageHeader
        title="ODC 负责范围"
        description="关联现有账号、中心与负责部门，为候选人推荐对应 ODC。同中心其他人员仍可人工选择。"
        actionRender={
          <Button
            disabled={!data || pending}
            onClick={() => {
              setEditingExisting(false);
              selectScope("", "");
            }}
          >
            新增负责范围
          </Button>
        }
      />
      <FieldGroup>
        <Field>
          <FieldLabel htmlFor="odc-import">批量导入</FieldLabel>
          <Input
            id="odc-import"
            type="file"
            accept=".xlsx,.tsv"
            disabled={pending || !data}
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) {
                void importFile(file);
              }
              event.target.value = "";
            }}
          />
          <FieldDescription>
            支持 Excel (.xlsx) 和 TSV，最多 500 行 / 5
            MB。表头：姓名/花名、负责公司/团队/部门、负责部门/小组、邮箱。多部门用顿号分隔；全中心请填写“全部部门”。先预览后导入，仅新增缺失关系。
          </FieldDescription>
          <Button
            variant="link"
            className="w-fit"
            onClick={async () => {
              try {
                await downloadResponsibilityTemplate();
              } catch (error) {
                toast.error(error instanceof Error ? error.message : "下载失败");
              }
            }}
          >
            下载空白模板 (.xlsx)
          </Button>
          {fileError ? (
            <p role="alert" className="text-sm text-destructive">
              {fileError}
            </p>
          ) : null}
        </Field>
        <Field>
          <FieldLabel htmlFor="odc-search">搜索负责范围</FieldLabel>
          <Input
            id="odc-search"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="姓名、邮箱、中心或部门"
          />
        </Field>
      </FieldGroup>
      {query.isPending && <p>正在加载…</p>}
      {query.isError && (
        <div role="alert">
          <p>{query.error.message}</p>
          <Button onClick={() => void query.refetch()}>重试</Button>
        </div>
      )}
      {data && (
        <div className="overflow-x-auto rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                {[
                  "姓名/花名",
                  "邮箱",
                  "TG",
                  "负责中心",
                  "负责部门/小组",
                  "序列 / 服务单位",
                  "操作",
                ].map((h) => (
                  <TableHead key={h}>{h}</TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row) => (
                <TableRow key={row.memberId + row.resumeSourceId}>
                  <TableCell>
                    {row.person.name}
                    {row.person.isOdc ? "" : "（当前非 ODC）"}
                  </TableCell>
                  <TableCell>{row.person.email}</TableCell>
                  <TableCell>{row.person.telegram || "未填写"}</TableCell>
                  <TableCell>{row.center.name}</TableCell>
                  <TableCell className="max-w-sm whitespace-normal">
                    {row.departmentNames}
                  </TableCell>
                  <TableCell>
                    {row.jobSeries || "不限"} / {row.serviceUnit || "不限"}
                  </TableCell>
                  <TableCell>
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={!row.person.isOdc || pending}
                      onClick={() => {
                        setEditingExisting(true);
                        selectScope(row.memberId, row.resumeSourceId);
                      }}
                    >
                      维护
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
              {rows.length === 0 && (
                <TableRow>
                  <TableCell colSpan={7}>暂无匹配的负责范围，可新增或导入。</TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>
      )}
      <Modal
        open={editor !== null}
        onOpenChange={(open) => {
          if (!open) {
            setEditor(null);
          }
        }}
        dismissible={!pending}
        title="维护 ODC 负责范围"
        footer={
          <>
            <Button variant="outline" disabled={pending} onClick={() => setEditor(null)}>
              取消
            </Button>
            <Button disabled={!canSaveScope(editor, pending)} onClick={() => void save()}>
              {pending ? "保存中…" : "保存负责范围"}
            </Button>
          </>
        }
      >
        {editor && data ? (
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor="odc-account">ODC 账号</FieldLabel>
              <SearchableSelect
                id="odc-account"
                value={editor.memberId}
                disabled={pending || editingExisting}
                onChange={(value) => selectScope(value ?? "", editor.resumeSourceId)}
                options={data.members
                  .filter((m) => m.isOdc)
                  .map((m) => ({ description: m.email, label: m.name, value: m.id }))}
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="odc-center">负责中心</FieldLabel>
              <SearchableSelect
                id="odc-center"
                value={editor.resumeSourceId}
                disabled={pending || editingExisting}
                onChange={(value) => selectScope(editor.memberId, value ?? "")}
                options={data.centers.map((c) => ({ label: c.name, value: c.id }))}
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="odc-scope">负责范围</FieldLabel>
              <SearchableSelect
                id="odc-scope"
                value={editor.allDepartments ? "all" : "selected"}
                disabled={pending}
                onChange={(value) => setEditor({ ...editor, allDepartments: value === "all" })}
                options={[
                  { label: "指定部门", value: "selected" },
                  { label: "全部部门", value: "all" },
                ]}
              />
            </Field>
            {editor.allDepartments === false && (
              <Field>
                <FieldLabel htmlFor="odc-departments">负责部门（可多选）</FieldLabel>
                <SearchableMultiSelect
                  id="odc-departments"
                  value={editor.departmentIds}
                  disabled={pending}
                  onChange={(departmentIds) => setEditor({ ...editor, departmentIds })}
                  options={data.departments
                    .filter((d) => d.resumeSourceId === editor.resumeSourceId)
                    .map((d) => ({ description: d.hiringUnitName, label: d.name, value: d.id }))}
                />
                <FieldDescription>
                  清空并保存将移除这位 ODC 在所选中心的部门推荐配置，保留中心挂靠。
                </FieldDescription>
              </Field>
            )}
            <FieldDescription>
              保存会替换所选账号在此中心的部门配置。其他中心、原有序列和服务单位限制保持不变。
            </FieldDescription>
          </FieldGroup>
        ) : null}
      </Modal>
      <ImportPreview
        preview={preview}
        pending={pending}
        onClose={() => setPreview(null)}
        onConfirm={() => void confirmImport()}
      />
    </div>
  );
}
