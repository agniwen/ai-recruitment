import dayjs from "dayjs";
import timezone from "dayjs/plugin/timezone";
import utc from "dayjs/plugin/utc";
import { DISPLAY_TIME_ZONE } from "@arc/shared/utils/time";

dayjs.extend(utc);
dayjs.extend(timezone);

const DATE_TIME_LOCAL_FORMAT = "YYYY-MM-DDTHH:mm";

/**
 * Convert a `<input type="datetime-local">` value into an ISO instant.
 * The input is timezone-less wall-clock time; interpret it as China time.
 */
export function dateTimeLocalInputToISOString(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }

  const date = dayjs.tz(trimmed, DATE_TIME_LOCAL_FORMAT, DISPLAY_TIME_ZONE);
  if (!date.isValid()) {
    return null;
  }

  return date.toISOString();
}

export function isoStringToDateTimeLocalInput(value: string | null | undefined): string {
  if (!value) {
    return "";
  }
  const date = dayjs(value);
  if (!date.isValid()) {
    return "";
  }
  return date.tz(DISPLAY_TIME_ZONE).format(DATE_TIME_LOCAL_FORMAT);
}
