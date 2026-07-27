"use client";

import type { DepartmentFormValues, DepartmentRecord } from "@arc/shared/departments";
import { departmentFormSchema } from "@arc/shared/departments";
import { useQuery } from "@tanstack/react-query";
import { useCallback } from "react";
import { rpc } from "@/lib/client/rpc";
import { useWorkspaceSlug } from "@/lib/client/workspace-context";
import { toast } from "sonner";
import { Field, FieldContent, FieldError, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { TextareaCounter } from "@/components/ui/textarea-counter";
import { EntityFormDialog } from "@/components/features/studio/entity-form-dialog";
import { useEntityForm } from "@/components/features/studio/entity-form";
import { hasFieldErrors, toFieldErrors } from "../interviews/interview-form";

const NAME_MAX_LENGTH = 120;
const DESCRIPTION_MAX_LENGTH = 500;
const PUBLIC_HIRING_UNIT_VALUE = "__public__";

function defaultValues(): DepartmentFormValues {
  return { description: "", hiringUnitId: null, name: "" };
}

function toFormValues(record: DepartmentRecord): DepartmentFormValues {
  return {
    description: record.description ?? "",
    hiringUnitId: record.hiringUnitId,
    name: record.name,
  };
}

export function DepartmentFormDialog({
  open,
  onOpenChange,
  record,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  record: DepartmentRecord | null;
  onSaved: () => void;
}) {
  const slug = useWorkspaceSlug();
  const isEdit = record !== null;
  const buildValues = useCallback(
    () => (record ? toFormValues(record) : defaultValues()),
    [record],
  );
  const { data: hiringUnits = [] } = useQuery({
    enabled: open,
    queryFn: async () => {
      const response = await rpc.api.w[":slug"].studio["hiring-units"].all.$get({
        param: { slug },
      });
      const payload = (await response.json().catch(() => null)) as
        | { records: { id: string; name: string }[] }
        | { error?: string; message?: string }
        | null;
      if (!response.ok || !payload || !("records" in payload)) {
        throw new Error("加载用人组织失败");
      }
      return payload.records;
    },
    queryKey: ["hiring-units", slug, "all"],
    refetchOnWindowFocus: false,
  });

  const { form, isSubmitting } = useEntityForm<DepartmentFormValues>({
    buildValues,
    onSubmit: async (value) => {
      const body = {
        description: value.description?.trim() || "",
        hiringUnitId: value.hiringUnitId || null,
        name: value.name.trim(),
      };

      const response = isEdit
        ? await rpc.api.w[":slug"].studio.departments[":id"].$patch({
            json: body,
            param: { id: record.id, slug },
          })
        : await rpc.api.w[":slug"].studio.departments.$post({ json: body, param: { slug } });

      const payload = (await response.json().catch(() => null)) as {
        error?: string;
      } | null;

      if (!response.ok) {
        toast.error(payload?.error ?? (isEdit ? "更新失败" : "创建失败"));
        return;
      }

      toast.success(isEdit ? "部门已更新" : "部门已创建");
      onSaved();
      onOpenChange(false);
    },
    open,
    schema: departmentFormSchema,
  });

  return (
    <EntityFormDialog
      description="部门用于对面试官和在招岗位进行组织分组。"
      formId="department-form"
      isEdit={isEdit}
      isSubmitting={isSubmitting}
      onOpenChange={onOpenChange}
      onSubmit={() => void form.handleSubmit()}
      open={open}
      size="md"
      title={isEdit ? "编辑部门" : "新建部门"}
    >
      <form.Field name="name">
        {(field) => {
          const errors = toFieldErrors(field.state.meta.errors);
          return (
            <Field data-invalid={hasFieldErrors(field.state.meta.errors) || undefined}>
              <FieldLabel htmlFor={field.name}>
                部门名称 <span className="text-destructive">*</span>
              </FieldLabel>
              <FieldContent className="gap-2">
                <Input
                  aria-invalid={!!errors?.length}
                  id={field.name}
                  maxLength={NAME_MAX_LENGTH}
                  onBlur={field.handleBlur}
                  onChange={(event) => field.handleChange(event.target.value)}
                  placeholder="如：研发部、产品部"
                  value={field.state.value}
                />
                <FieldError errors={errors} />
              </FieldContent>
            </Field>
          );
        }}
      </form.Field>

      <form.Field name="hiringUnitId">
        {(field) => {
          const errors = toFieldErrors(field.state.meta.errors);
          return (
            <Field data-invalid={hasFieldErrors(field.state.meta.errors) || undefined}>
              <FieldLabel htmlFor={field.name}>所属用人组织（可选）</FieldLabel>
              <FieldContent className="gap-2">
                <Select
                  onValueChange={(value) =>
                    field.handleChange(value === PUBLIC_HIRING_UNIT_VALUE ? null : value)
                  }
                  value={field.state.value ?? PUBLIC_HIRING_UNIT_VALUE}
                >
                  <SelectTrigger className="w-full" aria-invalid={!!errors?.length} id={field.name}>
                    <SelectValue placeholder="不指定" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={PUBLIC_HIRING_UNIT_VALUE}>
                      不指定（所有招聘组可访问）
                    </SelectItem>
                    {hiringUnits.map((unit) => (
                      <SelectItem key={unit.id} value={unit.id}>
                        {unit.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
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
                    placeholder="简要说明该部门的职责或定位"
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
