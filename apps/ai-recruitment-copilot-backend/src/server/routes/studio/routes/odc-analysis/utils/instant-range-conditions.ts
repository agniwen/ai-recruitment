import { gte, lt } from "drizzle-orm";
import type { SQL, SQLWrapper } from "drizzle-orm";
import type { InstantRange } from "../date-range";

export function instantRangeConditions(
  column: SQLWrapper,
  range: InstantRange,
): (SQL | undefined)[] {
  return [
    range.start ? gte(column, range.start) : undefined,
    range.end ? lt(column, range.end) : undefined,
  ];
}
