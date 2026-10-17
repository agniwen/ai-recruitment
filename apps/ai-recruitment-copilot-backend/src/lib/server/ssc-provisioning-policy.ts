export type SscMemberSyncStatus =
  | "empty_email"
  | "unregistered"
  | "ambiguous_email"
  | "banned"
  | "administrator_preserved"
  | "unchanged"
  | "created"
  | "updated"
  | "role_conflict";

export interface SscMemberRoleDecision {
  allowExistingRoleUpdate: boolean;
  banned: boolean;
  desiredRole: string;
  existingRole: string | null;
}

export function decideSscMemberRole({
  allowExistingRoleUpdate,
  banned,
  desiredRole,
  existingRole,
}: SscMemberRoleDecision): SscMemberSyncStatus {
  if (banned) {
    return "banned";
  }
  const existing = new Set(existingRole?.split(",").map((role) => role.trim()));
  if (existing.has("owner") || existing.has("admin")) {
    return "administrator_preserved";
  }
  if (existing.has("noAccess")) {
    return "role_conflict";
  }
  if (!existingRole) {
    return "created";
  }
  if (existingRole === desiredRole) {
    return "unchanged";
  }
  return allowExistingRoleUpdate ? "updated" : "role_conflict";
}
