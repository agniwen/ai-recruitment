"use client";

import { IconCopy } from "@tabler/icons-react";
import type { MouseEvent, PointerEvent, ReactNode } from "react";
import { toast } from "sonner";
import { cn } from "@arc/shared/utils";
import { formatResumeRecordDisplayId } from "@/components/features/resume/resume-record-display-id";
import { copyTextToClipboard } from "@/lib/client/clipboard";

export async function copyResumeRecordId(id: string): Promise<void> {
  const result = await copyTextToClipboard(id);
  if (result === "copied") {
    toast.success("已复制候选人 ID");
    return;
  }
  if (result === "manual") {
    toast.info("已打开手动复制窗口");
    return;
  }
  toast.error("复制失败，请手动复制");
}

function stopInteractiveBubble(event: MouseEvent | PointerEvent) {
  event.preventDefault();
  event.stopPropagation();
}

/**
 * Masked candidate/record id with a copy control. Clicks never bubble so
 * surrounding card / name buttons stay inert.
 */
export function CopyableResumeRecordId({
  id,
  className,
  displayIdClassName,
  parentheses = false,
  showDisplayId = true,
}: {
  id: string;
  className?: string;
  displayIdClassName?: string;
  parentheses?: boolean;
  showDisplayId?: boolean;
}) {
  const display = formatResumeRecordDisplayId(id);
  const label = parentheses ? `(${display})` : display;

  return (
    <span
      className={cn("inline-flex max-w-full items-center gap-0.5 align-middle", className)}
      data-resume-card-interactive="true"
    >
      {showDisplayId ? (
        <span
          className={cn(
            "min-w-0 truncate font-normal text-muted-foreground/60 text-xs tabular-nums",
            displayIdClassName,
          )}
          title={id}
        >
          {label}
        </span>
      ) : null}
      <button
        aria-label="复制候选人 ID"
        className={cn(
          "inline-flex size-5 shrink-0 items-center justify-center rounded-sm",
          "text-muted-foreground/65 transition-colors",
          "hover:bg-muted hover:text-foreground",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50",
        )}
        data-resume-card-interactive="true"
        onClick={(event) => {
          stopInteractiveBubble(event);
          void copyResumeRecordId(id);
        }}
        onPointerDown={stopInteractiveBubble}
        title="复制候选人 ID"
        type="button"
      >
        <IconCopy className="size-3" stroke={1.75} />
      </button>
    </span>
  );
}

/** Name + masked id + copy icon, for titles and identity rows. */
export function ResumeCandidateTitleWithCopyableId({
  name,
  id,
  className,
  nameClassName,
  idClassName,
  trailing,
}: {
  name: string;
  id: string;
  className?: string;
  nameClassName?: string;
  idClassName?: string;
  trailing?: ReactNode;
}) {
  return (
    <span className={cn("inline-flex min-w-0 max-w-full items-center gap-1", className)}>
      <span className={cn("min-w-0 truncate", nameClassName)}>{name}</span>
      <CopyableResumeRecordId
        className="shrink-0"
        displayIdClassName={idClassName}
        id={id}
        parentheses
      />
      {trailing}
    </span>
  );
}
