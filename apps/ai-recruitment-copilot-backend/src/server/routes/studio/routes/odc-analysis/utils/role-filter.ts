import { sql } from "drizzle-orm";
import type { SQL, SQLWrapper } from "drizzle-orm";

export function odcRoleCondition(column: SQLWrapper, odcRoles: readonly string[]): SQL {
  if (odcRoles.length === 0) {
    return sql`false`;
  }

  const roleValues = sql.join(
    odcRoles.map((role) => sql`${role}`),
    sql`, `,
  );
  return sql`regexp_split_to_array(coalesce(${column}, ''), E'\\s*,\\s*') && ARRAY[${roleValues}]::text[]`;
}

export function matchesOdcRole(
  value: string | null | undefined,
  odcRoles: readonly string[],
): boolean {
  if (!value || odcRoles.length === 0) {
    return false;
  }

  return value
    .split(",")
    .map((role) => role.trim())
    .some((role) => odcRoles.includes(role));
}
