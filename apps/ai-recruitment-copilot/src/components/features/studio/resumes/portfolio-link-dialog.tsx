"use client";

import { useId, useState } from "react";
import { IconPlus, IconX } from "@tabler/icons-react";
import { portfolioLinkInputSchema } from "@arc/shared/bulk-resume-upload";
import type { PortfolioLinkInput } from "@arc/shared/bulk-resume-upload";
import { Button } from "@/components/ui/button";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Modal } from "@/components/ui/modal";

export function PortfolioLinkDialog({
  initialLink,
  maxLinks,
  onClose,
  onSubmit,
}: {
  initialLink?: PortfolioLinkInput;
  maxLinks: number;
  onClose: () => void;
  onSubmit: (links: PortfolioLinkInput[]) => void | Promise<void>;
}) {
  const prefix = useId();
  const [rows, setRows] = useState(() => [
    { id: crypto.randomUUID(), name: initialLink?.name ?? "", url: initialLink?.url ?? "" },
  ]);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saveError, setSaveError] = useState("");
  const [saving, setSaving] = useState(false);
  function updateRow(id: string, field: "name" | "url", value: string) {
    setRows((current) => current.map((row) => (row.id === id ? { ...row, [field]: value } : row)));
    setErrors((current) => ({ ...current, [id]: "" }));
  }
  async function submit() {
    if (saving) {
      return;
    }
    const nextErrors: Record<string, string> = {};
    const links: PortfolioLinkInput[] = [];
    for (const row of rows) {
      const parsed = portfolioLinkInputSchema.safeParse(row);
      if (parsed.success) {
        links.push({ ...parsed.data, name: parsed.data.name || parsed.data.url.slice(0, 500) });
      } else {
        nextErrors[row.id] = parsed.error.issues[0]?.message ?? "请输入有效网址";
      }
    }
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length || !links.length) {
      return;
    }
    setSaving(true);
    setSaveError("");
    try {
      await onSubmit(links);
      onClose();
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : "保存链接失败，请重试");
    } finally {
      setSaving(false);
    }
  }
  const submitLabel = initialLink ? "保存" : `添加 ${rows.length} 个链接`;
  return (
    <Modal
      open
      onOpenChange={(open) => {
        if (!open && !saving) {
          onClose();
        }
      }}
      dismissible={!saving}
      showCloseButton={!saving}
      title={initialLink ? "编辑作品链接" : "添加作品链接"}
      description={
        initialLink
          ? "修改链接地址或显示名称。"
          : "可一次添加多个链接，每个链接单独作为一项作品集。"
      }
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="outline" disabled={saving} onClick={onClose}>
            取消
          </Button>
          <Button disabled={saving} onClick={() => void submit()}>
            {saving ? "保存中…" : submitLabel}
          </Button>
        </div>
      }
    >
      <div className="flex flex-col gap-4">
        {rows.map((row, index) => (
          <div className="flex gap-2 border-b pb-4 last:border-b-0" key={row.id}>
            <FieldGroup className="flex-1">
              <Field data-invalid={Boolean(errors[row.id])}>
                <FieldLabel htmlFor={`${prefix}-${row.id}-url`}>
                  链接地址 <span className="text-destructive">*</span>
                </FieldLabel>
                <Input
                  autoFocus={index === 0}
                  id={`${prefix}-${row.id}-url`}
                  aria-label={`链接地址 ${index + 1}`}
                  aria-invalid={Boolean(errors[row.id])}
                  aria-describedby={errors[row.id] ? `${prefix}-${row.id}-error` : undefined}
                  disabled={saving}
                  value={row.url}
                  onChange={(event) => updateRow(row.id, "url", event.target.value)}
                  placeholder="https://"
                  type="url"
                />
              </Field>
              <Field>
                <FieldLabel htmlFor={`${prefix}-${row.id}-name`}>显示名称（选填）</FieldLabel>
                <Input
                  id={`${prefix}-${row.id}-name`}
                  aria-label={`显示名称 ${index + 1}`}
                  disabled={saving}
                  value={row.name}
                  onChange={(event) => updateRow(row.id, "name", event.target.value)}
                  placeholder="例如：个人作品网站、GitHub 项目"
                  maxLength={500}
                />
              </Field>
              {errors[row.id] ? (
                <p
                  className="text-sm text-destructive"
                  role="alert"
                  id={`${prefix}-${row.id}-error`}
                >
                  {errors[row.id]}
                </p>
              ) : null}
            </FieldGroup>
            {!initialLink && rows.length > 1 ? (
              <Button
                aria-label={`移除链接 ${index + 1}`}
                variant="ghost"
                size="icon-sm"
                disabled={saving}
                onClick={() => setRows((current) => current.filter((item) => item.id !== row.id))}
              >
                <IconX />
              </Button>
            ) : null}
          </div>
        ))}
        {!initialLink && rows.length < maxLinks ? (
          <Button
            className="self-start"
            variant="link"
            disabled={saving}
            onClick={() =>
              setRows((current) => [...current, { id: crypto.randomUUID(), name: "", url: "" }])
            }
          >
            <IconPlus />
            再添加一个链接
          </Button>
        ) : null}
        <p className="text-xs text-muted-foreground">
          未填写名称时显示网址。仅支持 http 或 https 链接。
        </p>
        {saveError ? (
          <p role="alert" className="text-sm text-destructive">
            {saveError}
          </p>
        ) : null}
      </div>
    </Modal>
  );
}
