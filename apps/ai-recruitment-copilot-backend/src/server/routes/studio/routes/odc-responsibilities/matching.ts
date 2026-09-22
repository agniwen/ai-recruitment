export function normalizeScopeName(value: string) {
  return value.normalize("NFKC").trim().replaceAll(/\s+/g, " ").toLowerCase();
}

export function matchDepartments(
  text: string,
  departments: { id: string; name: string }[],
): { departmentIds: string[]; allDepartments: boolean; error?: string } {
  const value = normalizeScopeName(text);
  if (["全部部门", "全中心", "不分小组"].includes(value)) {
    return { allDepartments: true, departmentIds: [] };
  }
  // Prefer an exact department name before interpreting separators such as 和.
  const exact = departments.filter((d) => normalizeScopeName(d.name) === value);
  const tokens = exact.length
    ? [text]
    : text
        .split(/[,，、;；\n]+/)
        .flatMap((part) =>
          departments.some((d) => normalizeScopeName(d.name) === normalizeScopeName(part))
            ? [part]
            : part.split("和"),
        );
  const ids: string[] = [];
  for (const token of tokens) {
    const matches = departments.filter(
      (d) => normalizeScopeName(d.name) === normalizeScopeName(token),
    );
    if (matches.length !== 1) {
      return {
        allDepartments: false,
        departmentIds: [],
        error: matches.length
          ? `部门「${token}」存在重名，请在页面选择具体部门`
          : `未找到部门「${token}」，请核对名称或拆分说明文字`,
      };
    }
    ids.push(matches[0].id);
  }
  return { allDepartments: false, departmentIds: [...new Set(ids)] };
}
