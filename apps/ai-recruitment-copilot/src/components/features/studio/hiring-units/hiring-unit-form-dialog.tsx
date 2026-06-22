"use client";

import type { HiringUnitFormValues, HiringUnitRecord } from "@arc/shared/hiring-units";
import { hiringUnitFormSchema } from "@arc/shared/hiring-units";
import { rpc } from "@/lib/client/rpc";
import { useWorkspaceSlug } from "@/lib/client/workspace-context";
import { toast } from "sonner";
import { Field, FieldContent, FieldError, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { TextareaCounter } from "@/components/ui/textarea-counter";
import { EntityFormDialog } from "@/components/features/studio/entity-form-dialog";
import { useEntityForm } from "@/components/features/studio/entity-form";
import { hasFieldErrors, toFieldErrors } from "../interviews/interview-form";

const NAME_MAX_LENGTH = 120;
const DESCRIPTION_MAX_LENGTH = 500;

function defaultValues(): HiringUnitFormValues {
  return { description: "", name: "" };
}

function toFormValues(record: HiringUnitRecord): HiringUnitFormValues {
  return {
    description: record.description ?? "",
    name: record.name,
  };
}

export function HiringUnitFormDialog({
  open,
  onOpenChange,
  record,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  record: HiringUnitRecord | null;
  onSaved: () => void;
}) {
  const slug = useWorkspaceSlug();
  const isEdit = record !== null;

  const { form, isSubmitting } = useEntityForm<HiringUnitFormValues>({
    buildValues: () => (record ? toFormValues(record) : defaultValues()),
    onSubmit: async (value) => {
      const body = {
        description: value.description?.trim() || "",
        name: value.name.trim(),
      };

      const response = isEdit
        ? await rpc.api.w[":slug"].studio["hiring-units"][":id"].$patch({
            json: body,
            param: { id: record.id, slug },
          })
        : await rpc.api.w[":slug"].studio["hiring-units"].$post({
            json: body,
            param: { slug },
          });

      const payload = (await response.json().catch(() => null)) as {
        error?: string;
      } | null;

      if (!response.ok) {
        toast.error(payload?.error ?? (isEdit ? "更新失败" : "创建失败"));
        return;
      }

      toast.success(isEdit ? "用人组织已更新" : "用人组织已创建");
      onSaved();
      onOpenChange(false);
    },
    open,
    schema: hiringUnitFormSchema,
  });

  return (
    <EntityFormDialog
      description="用人组织用于承载业务侧招聘需求，后续可作为招聘组负责范围的基础。"
      formId="hiring-unit-form"
      isEdit={isEdit}
      isSubmitting={isSubmitting}
      onOpenChange={onOpenChange}
      onSubmit={() => void form.handleSubmit()}
      open={open}
      size="md"
      title={isEdit ? "编辑用人组织" : "新建用人组织"}
    >
      <form.Field name="name">
        {(field) => {
          const errors = toFieldErrors(field.state.meta.errors);
          return (
            <Field data-invalid={hasFieldErrors(field.state.meta.errors) || undefined}>
              <FieldLabel htmlFor={field.name}>
                用人组织名称 <span className="text-destructive">*</span>
              </FieldLabel>
              <FieldContent className="gap-2">
                <Input
                  aria-invalid={!!errors?.length}
                  id={field.name}
                  maxLength={NAME_MAX_LENGTH}
                  onBlur={field.handleBlur}
                  onChange={(event) => field.handleChange(event.target.value)}
                  placeholder="如：商业化事业部、上海研发中心"
                  value={field.state.value}
                />
                <FieldError errors={errors} />
              </FieldContent>
            </Field>
          );
        }}
      </form.Field>

      <form.Field name="description">
        {(field) => {
          const errors = toFieldErrors(field.state.meta.errors);
          return (
            <Field data-invalid={hasFieldErrors(field.state.meta.errors) || undefined}>
              <FieldLabel htmlFor={field.name}>描述（可选）</FieldLabel>
              <FieldContent className="gap-2">
                <div className="relative">
                  <Textarea
                    aria-invalid={!!errors?.length}
                    className="max-h-48 min-h-24 resize-none pb-6"
                    id={field.name}
                    maxLength={DESCRIPTION_MAX_LENGTH}
                    onBlur={field.handleBlur}
                    onChange={(event) => field.handleChange(event.target.value)}
                    placeholder="简要说明该用人组织的业务范围或招聘边界"
                    rows={3}
                    value={field.state.value ?? ""}
                  />
                  <TextareaCounter maxLength={DESCRIPTION_MAX_LENGTH} value={field.state.value} />
                </div>
                <FieldError errors={errors} />
              </FieldContent>
            </Field>
          );
        }}
      </form.Field>
    </EntityFormDialog>
  );
}
