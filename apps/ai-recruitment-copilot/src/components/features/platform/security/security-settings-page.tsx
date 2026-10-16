import { useEffect, useState } from "react";
import type { MfaStatus } from "@arc/shared/platform-security";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { AdminMfaForm } from "./admin-mfa-form";
import { fetchMfaStatus } from "./api";

export function SecuritySettingsPage() {
  const [status, setStatus] = useState<MfaStatus | null>(null);
  const [operation, setOperation] = useState<"status" | "replacement">("status");
  const [revision, setRevision] = useState(0);
  const [errorMessage, setError] = useState("");
  useEffect(() => {
    const controller = new AbortController();
    async function load() {
      try {
        const result = await fetchMfaStatus(controller.signal);
        if (!controller.signal.aborted) {
          setStatus(result);
          setError("");
        }
      } catch (error) {
        if (!controller.signal.aborted) {
          setError(error instanceof Error ? error.message : "加载绑定状态失败");
        }
      }
    }
    void load();
    return () => controller.abort();
  }, [revision]);
  return (
    <section className="mx-auto w-full max-w-2xl space-y-6">
      <div className="space-y-2">
        <h1 className="text-xl font-semibold">后台两步验证</h1>
        <p className="text-sm text-muted-foreground">
          管理当前平台管理员的验证器。仅在进入平台管理后台时绑定或验证，日常业务登录沿用现有方式。
        </p>
      </div>
      {errorMessage ? (
        <p role="alert" className="text-sm text-destructive">
          {errorMessage}
        </p>
      ) : null}
      {operation === "status" ? (
        <div className="space-y-4 rounded-xl border p-5">
          <div className="flex items-center justify-between gap-3">
            <h2 className="font-medium">身份验证器</h2>
            <Badge variant="outline">{status?.enrolled ? "已绑定" : "等待验证状态"}</Badge>
          </div>
          <p className="text-sm text-muted-foreground">
            绑定成功后，后续进入后台只需输入验证码。更换验证器会生成新的恢复码，并使其他登录会话的后台授权失效。
          </p>
          <div className="flex flex-wrap gap-3">
            <Button disabled={!status} onClick={() => setOperation("replacement")}>
              更换验证器
            </Button>
          </div>
        </div>
      ) : (
        <div className="space-y-4 rounded-xl border p-5">
          <h2 className="font-medium">更换身份验证器</h2>
          <AdminMfaForm
            key={operation}
            purpose={operation}
            onVerified={() => {
              setOperation("status");
              setRevision((value) => value + 1);
            }}
          />
          <Button variant="ghost" onClick={() => setOperation("status")}>
            取消
          </Button>
        </div>
      )}
    </section>
  );
}
