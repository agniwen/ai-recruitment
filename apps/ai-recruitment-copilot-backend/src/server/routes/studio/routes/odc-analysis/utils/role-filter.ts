import { eq, isNull } from "drizzle-orm";
import type { SQL, SQLWrapper } from "drizzle-orm";
import { ODC_ANALYSIS_UNKNOWN_ROLE } from "@arc/shared/odc-analysis";

export function roleCondition(column: SQLWrapper, selectedRole?: string): SQL | undefined {
  if (!selectedRole) {
    return undefined;
  }
  return selectedRole === ODC_ANALYSIS_UNKNOWN_ROLE ? isNull(column) : eq(column, selectedRole);
}

export function matchesSelectedRole(
  value: string | null | undefined,
  selectedRole?: string,
): boolean {
  if (!selectedRole) {
    return true;
  }
  return selectedRole === ODC_ANALYSIS_UNKNOWN_ROLE
    ? value === null || value === undefined
    : value === selectedRole;
}
