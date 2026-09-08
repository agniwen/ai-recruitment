"use client";

import { rpcFetch } from "@/lib/client/api/rpc-fetch";

import type { ResumeSourceFormValues, ResumeSourceRecord } from "@arc/shared/resume-sources";
import { resumeSourceFormSchema } from "@arc/shared/resume-sources";
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

function defaultValues(): ResumeSourceFormValues {
  return { description: "", name: "" };
}

function toFormValues(record: ResumeSourceRecord): ResumeSourceFormValues {
  return {
    description: record.description ?? "",
    name: record.name,
  };
}

export function ResumeSourceFormDialog({
  open,
  onOpenChange,
  record,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  record: ResumeSourceRecord | null;
  onSaved: () => void;
}) {
  const slug = useWorkspaceSlug();
  const isEdit = record !== null;

  const { form, isSubmitting } = useEntityForm<ResumeSourceFormValues>({
    buildValues: () => (record ? toFormValues(record) : defaultValues()),
    onSubmit: async (value) => {
      const body = {
        description: value.description?.trim() || "",
        name: value.name.trim(),
      };

      try {
        await rpcFetch(
          isEdit
            ? rpc.api.w[":slug"].studio["resume-sources"][":id"].$patch({
                json: body,
                param: { id: record.id, slug },
              })
            : rpc.api.w[":slug"].studio["resume-sources"].$post({ json: body, param: { slug } }),
          isEdit ? "更新简历来源失败" : "创建简历来源失败",
        );
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "保存简历来源失败");
        return;
      }

      toast.success(isEdit ? "简历来源已更新" : "简历来源已创建");
      onSaved();
      onOpenChange(false);
    },
    open,
    schema: resumeSourceFormSchema,
  });

  return (
    <EntityFormDialog
      description="简历来源是用人组织的上级；ODC 在此层级统一设置。"
      formId="resume-source-form"
      isEdit={isEdit}
      isSubmitting={isSubmitting}
      onOpenChange={onOpenChange}
      onSubmit={() => void form.handleSubmit()}
      open={open}
      size="md"
      title={isEdit ? "编辑简历来源" : "新建简历来源"}
    >
      <form.Field name="name">
        {(field) => {
          const errors = toFieldErrors(field.state.meta.errors);
          return (
            <Field data-invalid={hasFieldErrors(field.state.meta.errors) || undefined}>
              <FieldLabel htmlFor={field.name}>
                简历来源名称 <span className="text-destructive">*</span>
              </FieldLabel>
              <FieldContent className="gap-2">
                <Input
                  aria-invalid={!!errors?.length}
                  id={field.name}
                  maxLength={NAME_MAX_LENGTH}
                  onBlur={field.handleBlur}
                  onChange={(event) => field.handleChange(event.target.value)}
                  placeholder="请输入简历来源名称"
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
                    placeholder="简要说明该简历来源的业务范围或招聘边界"
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
