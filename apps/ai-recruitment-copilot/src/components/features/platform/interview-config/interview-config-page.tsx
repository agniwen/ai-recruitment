import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { platformInterviewConfigSchema } from "@arc/shared/platform-interview-config";
import type { PlatformInterviewConfig } from "@arc/shared/platform-interview-config";
import { rpcFetch } from "@/lib/client/api";
import { rpc } from "@/lib/client/rpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field";

const queryKey = ["platform-interview-config"];

export function InterviewConfigPage() {
  const queryClient = useQueryClient();
  const [hours, setHours] = useState<string | null>(null);
  const config = useQuery({
    queryFn: () =>
      rpcFetch<PlatformInterviewConfig>(
        rpc.api.platform["interview-config"].$get(),
        "加载面试参数失败",
      ),
    queryKey,
  });
  const mutation = useMutation({
    mutationFn: (input: PlatformInterviewConfig) =>
      rpcFetch<PlatformInterviewConfig>(
        rpc.api.platform["interview-config"].$put({ json: input }),
        "保存面试参数失败",
      ),
    onError: (error) => toast.error(error instanceof Error ? error.message : "保存面试参数失败"),
    onSuccess: (data) => {
      queryClient.setQueryData(queryKey, data);
      setHours(null);
      toast.success("面试参数已保存");
    },
  });
  const value = hours ?? String(config.data?.humanInterviewLockHours ?? "");
  const validation = platformInterviewConfigSchema.safeParse({
    humanInterviewLockHours: Number(value),
  });

  return (
    <section className="mx-auto flex w-full max-w-2xl flex-col gap-6">
      <h1 className="text-xl font-semibold">面试参数</h1>
      {config.error ? <p role="alert">加载面试参数失败，请重试。</p> : null}
      <form
        className="flex flex-col gap-6"
        onSubmit={(event) => {
          event.preventDefault();
          if (validation.success) {
            mutation.mutate(validation.data);
          }
        }}
      >
        <FieldGroup>
          <Field data-invalid={value !== "" && !validation.success}>
            <FieldLabel htmlFor="human-interview-lock-hours">真人面试锁定时长（小时）</FieldLabel>
            <Input
              aria-describedby="human-interview-lock-description"
              aria-invalid={value !== "" && !validation.success}
              disabled={!config.data || mutation.isPending}
              id="human-interview-lock-hours"
              max={8760}
              min={1}
              onChange={(event) => setHours(event.target.value)}
              required
              step={1}
              type="number"
              value={value}
            />
            <FieldDescription id="human-interview-lock-description">
              默认 48
              小时，从真人面试创建时间计算。锁定期内存在未完成点评的面试时，其他用工单位无法约面；完成面试点评或取消面试后解除。预约的开始时间和有效期不影响锁定。修改仅影响之后新建的面试。
            </FieldDescription>
            {value !== "" && !validation.success ? (
              <p role="alert">请输入 1–8760 的整数小时。</p>
            ) : null}
          </Field>
        </FieldGroup>
        <Button
          className="self-start"
          disabled={!config.data || !validation.success || mutation.isPending}
          type="submit"
        >
          {mutation.isPending ? "保存中…" : "保存"}
        </Button>
      </form>
    </section>
  );
}
