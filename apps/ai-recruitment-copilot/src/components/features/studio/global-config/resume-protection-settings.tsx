"use client";

import { useState } from "react";
import { toast } from "sonner";
import type { GlobalConfigRecord } from "@arc/shared/global-config";
import { resumeProtectionConfigSchema } from "@arc/shared/global-config";
import { Button } from "@/components/ui/button";
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field";
import { InputGroup, InputGroupAddon, InputGroupInput } from "@/components/ui/input-group";
import { Separator } from "@/components/ui/separator";
import { rpcFetch } from "@/lib/client/api";
import { rpc } from "@/lib/client/rpc";
import { useWorkspaceSlug, useWorkspaceCan } from "@/lib/client/workspace-context";

export function ResumeProtectionSettings({ initial }: { initial: GlobalConfigRecord }) {
  const slug = useWorkspaceSlug();
  const canUpdate = useWorkspaceCan("globalConfig", "update");
  const [saved, setSaved] = useState(initial);
  const [days, setDays] = useState(String(initial.resumeProtectionDays ?? 15));
  const [saving, setSaving] = useState(false);
  const parsed = resumeProtectionConfigSchema.safeParse({ days: Number(days) });
  const validationError = parsed.success ? null : parsed.error.issues[0]?.message;
  const save = async () => {
    if (!parsed.success || saving) {
      return;
    }
    setSaving(true);
    try {
      const result = await rpcFetch<GlobalConfigRecord>(
        rpc.api.w[":slug"].studio["global-config"]["resume-protection"].$put({
          json: parsed.data,
          param: { slug },
        }),
        "保存保护期失败。",
      );
      const previous = saved.resumeProtectionDays ?? 15;
      setSaved(result);
      toast.success(
        `推荐保护期已从 ${previous} 天调整为 ${result.resumeProtectionDays} 天，已有周期截止时间保持不变。`,
      );
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "保存保护期失败。");
    } finally {
      setSaving(false);
    }
  };
  return (
    <>
      <Separator />
      <FieldGroup className="gap-4">
        <Field data-invalid={Boolean(validationError)}>
          <FieldLabel htmlFor="resume-protection-days">简历推荐保护期</FieldLabel>
          <FieldDescription>
            同一工作区内，其他推荐人在保护期内不能重复推荐。修改仅影响新周期，已有周期截止时间保持不变。
          </FieldDescription>
          <InputGroup className="max-w-48">
            <InputGroupInput
              aria-invalid={Boolean(validationError)}
              aria-describedby="resume-protection-days-help"
              id="resume-protection-days"
              type="number"
              min={1}
              max={365}
              step={1}
              value={days}
              onChange={(event) => setDays(event.target.value)}
              disabled={saving || !canUpdate}
            />
            <InputGroupAddon align="inline-end">天</InputGroupAddon>
          </InputGroup>
          <FieldDescription id="resume-protection-days-help">
            {validationError || "支持 1–365 个连续日，每天按 24 小时计算。"}
          </FieldDescription>
        </Field>
        <Button
          className="self-start"
          disabled={
            saving ||
            !canUpdate ||
            !parsed.success ||
            Number(days) === (saved.resumeProtectionDays ?? 15)
          }
          onClick={save}
        >
          {saving ? "保存中…" : "保存保护期"}
        </Button>
        {saved.resumeProtectionUpdatedAt ? (
          <p className="text-xs text-muted-foreground">
            最近修改：{saved.resumeProtectionUpdatedByName || "配置管理员"} ·
            {new Date(saved.resumeProtectionUpdatedAt).toLocaleString("zh-CN", {
              timeZone: "Asia/Shanghai",
            })}
          </p>
        ) : null}
      </FieldGroup>
    </>
  );
}
