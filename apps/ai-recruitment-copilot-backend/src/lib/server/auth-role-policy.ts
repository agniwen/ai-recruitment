export function attemptsDynamicRoleIdentifierUpdate(path: string, body: unknown): boolean {
  if (path !== "/organization/update-role" || !body || typeof body !== "object") {
    return false;
  }

  const data = "data" in body ? body.data : null;
  return Boolean(data && typeof data === "object" && "roleName" in data);
}

export function hasConflictingRoleClassifications(
  patch: unknown,
  current: { isOdc?: boolean; isSsc?: boolean } = {},
): boolean {
  const fields = patch && typeof patch === "object" ? patch : {};
  const isOdc =
    "isOdc" in fields && typeof fields.isOdc === "boolean" ? fields.isOdc : current.isOdc;
  const isSsc =
    "isSsc" in fields && typeof fields.isSsc === "boolean" ? fields.isSsc : current.isSsc;
  return isOdc === true && isSsc === true;
}
