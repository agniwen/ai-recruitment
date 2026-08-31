export function attemptsDynamicRoleIdentifierUpdate(path: string, body: unknown): boolean {
  if (path !== "/organization/update-role" || !body || typeof body !== "object") {
    return false;
  }

  const data = "data" in body ? body.data : null;
  return Boolean(data && typeof data === "object" && "roleName" in data);
}
