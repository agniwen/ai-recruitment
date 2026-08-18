"use client";

import { IconDownload, IconLoader2 } from "@tabler/icons-react";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Field, FieldDescription, FieldLabel, FieldSet } from "@/components/ui/field";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import {
  DATA_EXPORT_LIMIT,
  normalizeExportColumnIds,
  readStoredExportColumnIds,
  takeExportRows,
  writeStoredExportColumnIds,
} from "./data-export-model";
import type { DataExportColumn, DataExportRange, DataExportSource } from "./data-export-model";
import { downloadDataExportXlsx } from "./xlsx-export";

export function DataExportDialog<T>({
  columns,
  currentRows,
  defaultColumnIds,
  fileName,
  getAllRows,
  limit = DATA_EXPORT_LIMIT,
  onOpenChange,
  open,
  sheetName,
  showRange = true,
  source,
  total,
}: {
  columns: readonly DataExportColumn<T>[];
  currentRows: readonly T[];
  defaultColumnIds: readonly string[];
  fileName: string;
  getAllRows: () => Promise<readonly T[]>;
  limit?: number;
  onOpenChange: (open: boolean) => void;
  open: boolean;
  sheetName: string;
  showRange?: boolean;
  source: DataExportSource;
  total: number;
}) {
  const supportedIds = useMemo(() => columns.map((column) => column.id), [columns]);
  const [range, setRange] = useState<DataExportRange>("current");
  const [step, setStep] = useState<"columns" | "range">(showRange ? "range" : "columns");
  const [selectedIds, setSelectedIds] = useState<string[]>([...defaultColumnIds]);
  const [exporting, setExporting] = useState(false);

  useEffect(() => {
    if (!open) {
      return;
    }
    setRange("current");
    setStep(showRange ? "range" : "columns");
    setSelectedIds(
      normalizeExportColumnIds(readStoredExportColumnIds(source), supportedIds, defaultColumnIds),
    );
  }, [defaultColumnIds, open, showRange, source, supportedIds]);

  const selectedColumns = columns.filter((column) => selectedIds.includes(column.id));

  function toggleColumn(id: string, checked: boolean) {
    setSelectedIds((current) =>
      checked ? [...current, id] : current.filter((columnId) => columnId !== id),
    );
  }

  async function handleExport() {
    if (selectedColumns.length === 0) {
      toast.error("请至少选择一列");
      return;
    }
    setExporting(true);
    try {
      const requestedRows = !showRange || range === "all" ? await getAllRows() : currentRows;
      const { rows, truncated } = takeExportRows(requestedRows, limit);
      if (rows.length === 0) {
        toast.error("当前筛选结果没有可导出的数据");
        return;
      }
      writeStoredExportColumnIds(source, selectedIds);
      await downloadDataExportXlsx({ columns: selectedColumns, fileName, rows, sheetName });
      onOpenChange(false);
      toast.success(`已导出 ${rows.length} 行数据`);
      if (truncated) {
        toast.warning(`符合条件的数据超过 ${limit} 行，本次仅导出前 ${limit} 行`);
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "导出失败，请稍后重试");
    } finally {
      setExporting(false);
    }
  }

  const allCount = Math.min(total, limit);
  const rememberedColumnsHint = "已记住本次列选择，下次打开导出时会自动恢复。";
  let description = rememberedColumnsHint;
  if (step === "range") {
    description = `每次最多导出 ${limit} 行，导出内容将生成 XLSX 文件。`;
  } else if (!showRange) {
    description = `每次最多导出 ${limit} 行。${rememberedColumnsHint}`;
  }

  return (
    <Dialog onOpenChange={onOpenChange} open={open}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{step === "range" ? "选择导出范围" : "选择导出列"}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>

        {step === "range" ? (
          <FieldSet>
            <RadioGroup
              aria-label="导出范围"
              onValueChange={(value) => setRange(value as DataExportRange)}
              value={range}
            >
              <FieldLabel>
                <Field orientation="horizontal">
                  <RadioGroupItem value="current" />
                  <div className="flex flex-1 flex-col gap-1">
                    <span>导出当前页</span>
                    <FieldDescription>导出当前表格中的 {currentRows.length} 行。</FieldDescription>
                  </div>
                </Field>
              </FieldLabel>
              <FieldLabel>
                <Field orientation="horizontal">
                  <RadioGroupItem value="all" />
                  <div className="flex flex-1 flex-col gap-1">
                    <span>导出全部筛选结果</span>
                    <FieldDescription>
                      导出符合当前筛选的 {allCount} 行
                      {total > limit ? `（共 ${total} 行，已按上限截取）` : ""}。
                    </FieldDescription>
                  </div>
                </Field>
              </FieldLabel>
            </RadioGroup>
          </FieldSet>
        ) : (
          <FieldSet>
            <div className="grid max-h-[50vh] grid-cols-1 gap-2 overflow-y-auto pr-1 sm:grid-cols-2">
              {columns.map((column) => {
                const checked = selectedIds.includes(column.id);
                return (
                  <FieldLabel className="w-full rounded-md border p-3" key={column.id}>
                    <Checkbox
                      aria-label={`导出列：${column.label}`}
                      checked={checked}
                      onCheckedChange={(value) => toggleColumn(column.id, Boolean(value))}
                    />
                    <span>{column.label}</span>
                  </FieldLabel>
                );
              })}
            </div>
          </FieldSet>
        )}

        <DialogFooter>
          <Button
            disabled={exporting}
            onClick={() =>
              step === "columns" && showRange ? setStep("range") : onOpenChange(false)
            }
            variant="outline"
          >
            {step === "columns" && showRange ? "上一步" : "取消"}
          </Button>
          {step === "range" ? (
            <Button
              disabled={currentRows.length === 0 && total === 0}
              onClick={() => setStep("columns")}
            >
              下一步
            </Button>
          ) : (
            <Button disabled={exporting || selectedIds.length === 0} onClick={handleExport}>
              {exporting ? (
                <IconLoader2 className="animate-spin" data-icon="inline-start" />
              ) : (
                <IconDownload data-icon="inline-start" />
              )}
              {exporting ? "正在生成" : "导出 XLSX"}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
