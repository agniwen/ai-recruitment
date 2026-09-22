"use client";

import type { ResumeAvailableTimeSlot } from "@arc/shared/studio-resumes";
import { cn } from "@arc/shared/utils";
import { DATE_TIME_DISPLAY_OPTIONS, TimeDisplay } from "@/components/features/display/time-display";
import { Card, CardContent } from "@/components/ui/card";

export function HumanInterviewAvailableTimeSlots({
  className,
  description = "安排面试时优先参考以下时间段。",
  slots,
  title = "候选人可接受的预约时间",
}: {
  className?: string;
  description?: string;
  slots: ResumeAvailableTimeSlot[];
  title?: string;
}) {
  if (slots.length === 0) {
    return null;
  }

  return (
    <Card className={cn("w-full rounded-lg bg-muted/20 shadow-none", className)}>
      <CardContent className="px-3 py-2.5">
        <p className="font-medium text-foreground text-sm">{title}</p>
        <p className="mt-0.5 text-muted-foreground text-xs">{description}</p>
        <ul className="mt-2 space-y-1">
          {slots.map((slot, index) => (
            <li
              className="flex flex-wrap items-center gap-1.5 text-muted-foreground text-xs"
              key={`${slot.startAt}-${slot.endAt}-${index}`}
            >
              <TimeDisplay
                as="span"
                className="text-foreground"
                options={DATE_TIME_DISPLAY_OPTIONS}
                value={slot.startAt}
              />
              <span aria-hidden>至</span>
              <TimeDisplay
                as="span"
                className="text-foreground"
                options={DATE_TIME_DISPLAY_OPTIONS}
                value={slot.endAt}
              />
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}

export function HumanInterviewAvailableTimeSlotsInline({
  className,
  slots,
}: {
  className?: string;
  slots: ResumeAvailableTimeSlot[];
}) {
  if (slots.length === 0) {
    return null;
  }

  return (
    <span
      className={cn(
        "inline-flex flex-wrap items-center gap-x-1.5 gap-y-1 text-muted-foreground text-sm",
        className,
      )}
    >
      <span className="font-medium">候选人可预约时间：</span>
      {slots.map((slot, index) => (
        <span
          className="inline-flex items-center gap-1.5"
          key={`${slot.startAt}-${slot.endAt}-${index}`}
        >
          {index > 0 ? <span className="text-muted-foreground">、</span> : null}
          <TimeDisplay as="span" options={DATE_TIME_DISPLAY_OPTIONS} value={slot.startAt} />
          <span aria-hidden className="text-muted-foreground">
            至
          </span>
          <TimeDisplay as="span" options={DATE_TIME_DISPLAY_OPTIONS} value={slot.endAt} />
        </span>
      ))}
    </span>
  );
}
