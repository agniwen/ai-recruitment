"use client";

import { IconAlertCircle, IconLock } from "@tabler/icons-react";
import { cn } from "@arc/shared/utils";
import { Button } from "@/components/ui/button";
import { isApiError } from "@/lib/client/api/errors";

export function ListAccessDenied({ compact = false }: { compact?: boolean }) {
  return (
    <div
      className={cn(
        "flex rounded-lg border border-border",
        compact
          ? "items-center gap-3 px-4 py-3 text-left"
          : "min-h-48 flex-col items-center justify-center gap-3 px-6 text-center",
      )}
    >
      <IconLock className={cn("shrink-0 text-muted-foreground", compact ? "size-5" : "size-6")} />
      <div className="space-y-1">
        <p className="font-medium text-sm">暂无查看权限</p>
        <p className="text-muted-foreground text-sm">
          你当前没有查看这些数据的权限。如需访问，请联系工作区管理员开通相应的查看权限。
        </p>
      </div>
    </div>
  );
}

function errorMessage(error: unknown): string {
  return error instanceof Error && error.message ? error.message : "加载列表失败，请稍后重试。";
}

export function ListLoadError({
  compact = false,
  error,
  onRetry,
}: {
  compact?: boolean;
  error: unknown;
  onRetry?: () => void;
}) {
  if (isApiError(error) && error.status === 403) {
    return <ListAccessDenied compact={compact} />;
  }
  return (
    <div
      className={cn(
        "flex rounded-lg border border-border",
        compact
          ? "items-center gap-3 px-4 py-3 text-left"
          : "min-h-48 flex-col items-center justify-center gap-3 px-6 text-center",
      )}
      role="alert"
    >
      <IconAlertCircle className={cn("shrink-0 text-destructive", compact ? "size-5" : "size-6")} />
      <div className={cn("space-y-1", compact && "min-w-0 flex-1")}>
        <p className="font-medium text-sm">列表加载失败</p>
        <p className="text-muted-foreground text-sm">{errorMessage(error)}</p>
      </div>
      {onRetry ? (
        <Button onClick={onRetry} size="sm" variant="outline">
          重试
        </Button>
      ) : null}
    </div>
  );
}
