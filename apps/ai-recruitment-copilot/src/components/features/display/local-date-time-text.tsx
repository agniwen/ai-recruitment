"use client";

import { DISPLAY_TIME_ZONE } from "@arc/shared/utils/time";
import { useHydrated } from "@/hooks/use-hydrated";

type DateTimeValue = Date | string | null | undefined;
type LocalDateTimeFormat = "compact-zh" | "default" | "long-zh";

const FORMATTERS: Record<LocalDateTimeFormat, Intl.DateTimeFormat> = {
  "compact-zh": new Intl.DateTimeFormat("zh-CN", {
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    month: "2-digit",
    timeZone: DISPLAY_TIME_ZONE,
  }),
  default: new Intl.DateTimeFormat("zh-CN", {
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    month: "2-digit",
    second: "2-digit",
    timeZone: DISPLAY_TIME_ZONE,
    year: "numeric",
  }),
  "long-zh": new Intl.DateTimeFormat("zh-CN", {
    dateStyle: "long",
    timeStyle: "short",
    timeZone: DISPLAY_TIME_ZONE,
  }),
};

function normalizeDate(value: DateTimeValue) {
  if (!value) {
    return null;
  }
  return value instanceof Date ? value : new Date(value);
}

export function LocalDateTimeText({
  fallback = "—",
  format = "default",
  value,
}: {
  fallback?: string;
  format?: LocalDateTimeFormat;
  value: DateTimeValue;
}) {
  const isHydrated = useHydrated();
  const date = normalizeDate(value);

  if (!(isHydrated && date) || Number.isNaN(date.getTime())) {
    return <span>{fallback}</span>;
  }

  return <span>{FORMATTERS[format].format(date)}</span>;
}
