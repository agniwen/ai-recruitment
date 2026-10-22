import type { InferResponseType } from "hono/client";
import type { rpc } from "@/lib/client/rpc";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

type Endpoint = (typeof rpc.api.w)[":slug"]["studio"]["ssc-responsibilities"]["preview"]["$post"];
type Preview = InferResponseType<Endpoint, 200>;

function resultLabel(row: Preview["rows"][number]) {
  if (row.error) {
    return row.error;
  }
  if (row.status === "existing") {
    return "已存在，跳过";
  }
  return row.input.resumeSourceId ? "新增并关联部门/中心" : "新增预录入，待关联";
}

export function SscImportPreview({ preview }: { preview: Preview }) {
  const added = preview.rows.filter((row) => row.status === "new").length;
  const skipped = preview.rows.filter((row) => row.status === "existing").length;
  const invalid = preview.rows.filter((row) => row.status === "invalid").length;
  return (
    <>
      <output className="text-sm">
        待新增 {added} 条 · 重复跳过 {skipped} 条 · 错误 {invalid} 条
      </output>
      <div className="max-h-80 overflow-auto rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>行号</TableHead>
              <TableHead>需求对接负责人</TableHead>
              <TableHead>中心/部门</TableHead>
              <TableHead>服务单位</TableHead>
              <TableHead>部门</TableHead>
              <TableHead>SSC 花名</TableHead>
              <TableHead>SSC TG</TableHead>
              <TableHead>SSC 邮箱</TableHead>
              <TableHead>备注</TableHead>
              <TableHead>导入结果</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {preview.rows.map((row, index) => (
              <TableRow key={`${row.row}:${index}`}>
                <TableCell>{row.row}</TableCell>
                <TableCell>{row.input.demandOwner || "—"}</TableCell>
                <TableCell className="whitespace-normal">
                  {row.input.centerName || "未填写"}
                </TableCell>
                <TableCell>{row.input.serviceUnit || "不限"}</TableCell>
                <TableCell>{row.departmentName || "不限"}</TableCell>
                <TableCell>{row.input.sscName || "待补充"}</TableCell>
                <TableCell>{row.input.telegram || "待补充"}</TableCell>
                <TableCell>{row.input.email || "待补充"}</TableCell>
                <TableCell className="max-w-48 whitespace-normal break-words">
                  {row.input.notes || "—"}
                </TableCell>
                <TableCell className="whitespace-normal">{resultLabel(row)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      {invalid > 0 ? (
        <p className="text-sm text-destructive">
          请修正错误行后重新上传；有错误时不会导入任何记录。
        </p>
      ) : null}
    </>
  );
}
