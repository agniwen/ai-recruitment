import type { InferResponseType } from "hono/client";
import type { rpc } from "@/lib/client/rpc";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import {
  Table,
  TableHeader,
  TableBody,
  TableHead,
  TableRow,
  TableCell,
} from "@/components/ui/table";

type Endpoint = (typeof rpc.api.w)[":slug"]["studio"]["odc-responsibilities"]["preview"]["$post"];
export type ImportPreviewData = InferResponseType<Endpoint, 200>;

export function ImportPreview({
  preview,
  pending,
  onClose,
  onConfirm,
}: {
  preview: ImportPreviewData | null;
  pending: boolean;
  onClose: () => void;
  onConfirm: () => void;
}) {
  return (
    <Modal
      open={preview !== null}
      dismissible={!pending}
      title="导入匹配预览"
      onOpenChange={(open) => {
        if (!open) {
          onClose();
        }
      }}
      footer={
        <>
          <Button variant="outline" disabled={pending} onClick={onClose}>
            取消
          </Button>
          <Button
            disabled={pending || !preview || preview.rows.some((r) => r.status === "invalid")}
            onClick={onConfirm}
          >
            确认新增负责关系
          </Button>
        </>
      }
    >
      <p className="mb-4 text-sm text-muted-foreground">
        按邮箱匹配现有成员。姓名差异请核对；有错误时请修改文件后重新上传。不会修改账号角色或 TG
        绑定。
      </p>
      <div className="max-h-96 overflow-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>行 / 账号</TableHead>
              <TableHead>中心 / 部门</TableHead>
              <TableHead>结果</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {preview?.rows.map((row) => (
              <TableRow key={row.row}>
                <TableCell>
                  {row.row} · {row.memberName || row.input.name}
                  <br />
                  {row.input.email}
                </TableCell>
                <TableCell className="whitespace-normal">
                  {row.input.center}
                  <br />
                  {row.input.departments}
                </TableCell>
                <TableCell className="whitespace-normal">
                  {row.error ||
                    (row.status === "existing" && "已存在，跳过") ||
                    (row.addsCenter && "新增中心挂靠及部门关系") ||
                    "新增部门关系"}
                  {row.nameMismatch ? "；表格姓名与账号姓名不同，请核对" : ""}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </Modal>
  );
}
