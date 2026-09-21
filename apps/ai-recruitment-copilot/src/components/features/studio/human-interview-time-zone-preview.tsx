"use client";

import { TimeDisplay } from "@/components/features/display/time-display";
import { cn } from "@arc/shared/utils";
import { dateTimeLocalInputToISOString } from "@/lib/client/datetime-local";

export function HumanInterviewTimeZonePreview({
  className,
  label,
  value,
}: {
  className?: string;
  label: string;
  value: string;
}) {
  const instant = dateTimeLocalInputToISOString(value);
  if (!instant) {
    return null;
  }

  return (
    <div className={cn("flex flex-wrap items-center gap-x-1.5 gap-y-1 text-xs", className)}>
      <span className="text-muted-foreground">{label}</span>
      <TimeDisplay as="span" className="text-foreground" value={instant} />
      <span className="text-muted-foreground">悬停查看其他地区</span>
    </div>
  );
}
