import { useRouter } from "@tanstack/react-router";
import { useCallback } from "react";
import { platformMfaReturnTo } from "@arc/shared/platform-security";
import { AdminMfaForm } from "./admin-mfa-form";

export function PlatformMfaGate({ returnTo }: { returnTo?: string }) {
  const router = useRouter();
  const onVerified = useCallback(async () => {
    await router.invalidate({ forcePending: true, sync: true });
    if (returnTo) {
      await router.navigate({ href: platformMfaReturnTo(returnTo), replace: true });
    }
  }, [returnTo, router]);
  return (
    <main className="mx-auto max-w-md space-y-5 px-5 py-16">
      <h1 className="text-xl font-semibold">平台后台 · 两步验证</h1>
      <AdminMfaForm onVerified={onVerified} />
    </main>
  );
}
