"use client";

import { IconAlertCircle, IconLoader2 } from "@tabler/icons-react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { LocalDateTimeText } from "@/components/features/display/local-date-time-text";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { getHistoricalResumeImportPage } from "@/lib/client/api/endpoints/bulk-resume-upload";
import { useWorkspaceSlug } from "@/lib/client/workspace-context";

export function HistoricalResumeImportTableDialog({
  onOpenChange,
  open,
}: {
  onOpenChange: (open: boolean) => void;
  open: boolean;
}) {
  const slug = useWorkspaceSlug();
  const [page, setPage] = useState(1);
  const query = useQuery({
    enabled: open,
    placeholderData: keepPreviousData,
    queryFn: () => getHistoricalResumeImportPage(slug, page),
    queryKey: ["historical-resume-imports", slug, page],
    refetchInterval: open ? 5000 : false,
    staleTime: 3000,
  });

  useEffect(() => {
    if (open) {
      setPage(1);
    }
  }, [open, slug]);

  const result = query.data;
  return (
    <Modal
      bodyClassName="p-0"
      description="正在解析的简历优先显示；已完成记录按完成时间倒序排列。"
      footer={
        <div className="flex w-full items-center justify-between gap-3">
          <span className="text-muted-foreground text-sm">
            {result ? `第 ${result.page} / ${result.totalPages} 页，共 ${result.total} 条` : ""}
          </span>
          <div className="flex gap-2">
            <Button
              disabled={!result || result.page <= 1 || query.isFetching}
              onClick={() => setPage((current) => Math.max(1, current - 1))}
              type="button"
              variant="outline"
            >
              上一页
            </Button>
            <Button
              disabled={!result || result.page >= result.totalPages || query.isFetching}
              onClick={() => setPage((current) => current + 1)}
              type="button"
              variant="outline"
            >
              下一页
            </Button>
          </div>
        </div>
      }
      onOpenChange={onOpenChange}
      open={open}
      size="3xl"
      title="历史简历导入记录"
    >
      {query.isPending ? (
        <div className="flex h-64 items-center justify-center gap-2 text-muted-foreground text-sm">
          <IconLoader2 className="animate-spin" />
          正在加载导入记录
        </div>
      ) : null}
      {query.isError ? (
        <div className="flex h-64 flex-col items-center justify-center gap-3 text-center">
          <IconAlertCircle className="text-destructive" />
          <p className="text-sm">加载失败，请稍后重试</p>
          <Button onClick={() => void query.refetch()} type="button" variant="outline">
            重新加载
          </Button>
        </div>
      ) : null}
      {result && !query.isError ? (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>状态</TableHead>
              <TableHead>文件名</TableHead>
              <TableHead>来源文件夹</TableHead>
              <TableHead>开始时间</TableHead>
              <TableHead>结束时间</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {result.records.length === 0 ? (
              <TableRow>
                <TableCell className="h-40 text-center text-muted-foreground" colSpan={5}>
                  暂无正在解析或已成功的历史简历
                </TableCell>
              </TableRow>
            ) : null}
            {result.records.map((record) => (
              <TableRow key={record.id}>
                <TableCell>
                  <Badge variant={record.status === "processing" ? "info" : "success"}>
                    {record.status === "processing" ? "解析中" : "已成功"}
                  </Badge>
                  {record.status === "processing" && record.currentStep ? (
                    <p className="mt-1 text-muted-foreground text-xs">{record.currentStep}</p>
                  ) : null}
                </TableCell>
                <TableCell className="max-w-72 truncate font-medium" title={record.filename}>
                  {record.filename}
                </TableCell>
                <TableCell
                  className="max-w-72 truncate text-muted-foreground"
                  title={record.sourceFolder}
                >
                  {record.sourceFolder}
                </TableCell>
                <TableCell>
                  {record.startedAt ? (
                    <LocalDateTimeText format="compact-zh" value={record.startedAt} />
                  ) : (
                    "—"
                  )}
                </TableCell>
                <TableCell>
                  {record.finishedAt ? (
                    <LocalDateTimeText format="compact-zh" value={record.finishedAt} />
                  ) : (
                    <span className="text-muted-foreground">处理中</span>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      ) : null}
    </Modal>
  );
}
