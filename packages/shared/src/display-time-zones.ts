export interface DisplayTimeZone {
  label: string;
  timeZone: string;
}

/**
 * Product-wide time zones shown when a user inspects a timestamp.
 * Keep the China reference first because scheduling inputs currently use
 * Asia/Shanghai wall-clock time.
 */
export const DISPLAY_TIME_ZONES: readonly DisplayTimeZone[] = [
  { label: "中国标准时间", timeZone: "Asia/Shanghai" },
  { label: "英国时间", timeZone: "Europe/London" },
  { label: "日本时间", timeZone: "Asia/Tokyo" },
  { label: "美国太平洋时间（洛杉矶）", timeZone: "America/Los_Angeles" },
];
