import { useState } from "react";
import { SscImportPreview } from "./import-preview";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { InferResponseType } from "hono/client";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Modal } from "@/components/ui/modal";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

import { rpc } from "@/lib/client/rpc";
import { rpcFetch } from "@/lib/client/api";
import { useWorkspaceSlug } from "@/lib/client/workspace-context";
import { downloadSscResponsibilityTemplate } from "./download-template";
import { readSscResponsibilityFile } from "./import-file";
import type { SscResponsibilityImportRow } from "./import-file";
import { invalidateSscResponsibilityQueries } from "./ssc-responsibility-queries";

function defaultSscRole(role: string, roles: { value: string }[]) {
  if (role) {
    return role;
  }
  return roles.length === 1 ? roles[0].value : "";
}

export function SscResponsibilityImportDialog({ onClose }: { onClose: () => void }) {
  const slug = useWorkspaceSlug();
  const client = useQueryClient();
  const api = rpc.api.w[":slug"].studio["ssc-responsibilities"];
  type Preview = InferResponseType<typeof api.preview.$post, 200>;
  type Options = InferResponseType<typeof api.options.$get, 200>;
  type Imported = InferResponseType<typeof api.import.$post, 200>;
  const options = useQuery({
    queryFn: () => rpcFetch<Options>(api.options.$get({ param: { slug } }), "加载 SSC 角色失败"),
    queryKey: ["studio-ssc-responsibility-options", slug],
  });
  const [role, setRole] = useState("");
  const [rows, setRows] = useState<SscResponsibilityImportRow[]>([]);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [pending, setPending] = useState(false);
  const [fileError, setFileError] = useState("");
  const roles = options.data?.roles ?? [];
  const selectedRole = defaultSscRole(role, roles);
  const hasRole = roles.some((item) => item.value === selectedRole);
  const added = preview?.rows.filter((row) => row.status === "new").length ?? 0;
  const invalid = preview?.rows.filter((row) => row.status === "invalid").length ?? 0;

  async function upload(file: File) {
    setPending(true);
    setFileError("");
    setRows([]);
    setPreview(null);
    try {
      const input = await readSscResponsibilityFile(file);
      const result = await rpcFetch<Preview>(
        api.preview.$post({
          json: { rows: input, workspaceRole: selectedRole },
          param: { slug },
        }),
        "导入预览失败",
      );
      setRows(input);
      setPreview(result);
    } catch (error) {
      setFileError(error instanceof Error ? error.message : "读取文件失败，请检查表格格式。");
    } finally {
      setPending(false);
    }
  }

  async function confirm() {
    if (!preview) {
      return;
    }
    setPending(true);
    setFileError("");
    try {
      const result = await rpcFetch<Imported>(
        api.import.$post({
          json: { previewHash: preview.previewHash, rows, workspaceRole: selectedRole },
          param: { slug },
        }),
        "导入失败，请重新上传预览",
      );
      await invalidateSscResponsibilityQueries(client, slug);
      toast.success(`已导入 ${result.added} 条，跳过 ${result.skipped} 条重复关系`);
      onClose();
    } catch (error) {
      setPreview(null);
      setRows([]);
      setFileError(error instanceof Error ? error.message : "导入失败，请重新上传预览。");
    } finally {
      setPending(false);
    }
  }

  return (
    <Modal
      open
      size="3xl"
      title="导入 SSC 负责组织"
      dismissible={!pending}
      onOpenChange={(open) => {
        if (!open && !pending) {
          onClose();
        }
      }}
      footer={
        <>
          <Button variant="outline" disabled={pending} onClick={onClose}>
            取消
          </Button>
          <Button
            disabled={pending || !hasRole || !preview || invalid > 0 || added === 0}
            onClick={() => void confirm()}
          >
            {pending ? "处理中…" : "确认导入"}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <p className="text-sm text-muted-foreground">
          支持 Excel (.xlsx) 和 TSV，最多 500 行 / 5 MB。按当前页面字段导入，联系方式可留空。
          部门/中心唯一同名时自动关联，未找到时保留为“待关联”；重复关系跳过，已有资料保留。
        </p>
        <div className="grid gap-2">
          <Label htmlFor="ssc-import-role">工作区角色</Label>
          <Select
            value={selectedRole}
            disabled={pending || options.isPending}
            onValueChange={(value) => {
              setRole(value ?? "");
              setRows([]);
              setPreview(null);
              setFileError("");
            }}
          >
            <SelectTrigger id="ssc-import-role">
              <SelectValue placeholder="选择 SSC 审核角色" />
            </SelectTrigger>
            <SelectContent>
              {roles.map((item) => (
                <SelectItem key={item.value} value={item.value}>
                  {item.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {!options.isPending && !roles.length && !options.isError ? (
            <p role="alert" className="text-sm text-destructive">
              请先在“角色与权限”中设置 SSC 审核角色。
            </p>
          ) : null}
          {options.isError ? (
            <div role="alert" className="flex items-center gap-2 text-sm text-destructive">
              {options.error.message}
              <Button variant="outline" size="sm" onClick={() => void options.refetch()}>
                重试
              </Button>
            </div>
          ) : null}
        </div>
        <div className="flex flex-col gap-2">
          <Button
            variant="outline"
            className="w-fit"
            disabled={pending}
            onClick={async () => {
              try {
                await downloadSscResponsibilityTemplate();
              } catch (error) {
                toast.error(error instanceof Error ? error.message : "下载模板失败");
              }
            }}
          >
            下载导入模板 (.xlsx)
          </Button>
          <Label htmlFor="ssc-import-file">上传文件并预览</Label>
          <Input
            id="ssc-import-file"
            type="file"
            accept=".xlsx,.tsv"
            disabled={pending || !hasRole}
            onChange={(event) => {
              const file = event.target.files?.[0];
              event.target.value = "";
              if (file) {
                void upload(file);
              }
            }}
          />
        </div>
        {fileError ? (
          <p role="alert" className="text-sm text-destructive">
            {fileError}
          </p>
        ) : null}
        {preview ? <SscImportPreview preview={preview} /> : null}
      </div>
    </Modal>
  );
}
