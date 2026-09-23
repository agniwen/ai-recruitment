import type { ExternalInterviewerInput } from "@arc/db-schema/studio-interviews";

export function externalInterviewerUsername(value: string): string | null {
  const username = value.trim().replace(/^@/u, "").toLowerCase();
  return /^[a-z0-9_]{5,32}$/u.test(username) && !/^\d+$/u.test(username) ? username : null;
}

// Preserve names without handles so HR can fill them in. Ambiguous grouped names stay editable.
export function parseRequesterInterviewers(value: string | null): ExternalInterviewerInput[] {
  if (!value?.trim()) {
    return [];
  }
  const text = value.trim().replaceAll(/["“”]/gu, "");
  const matches = [...text.matchAll(/@([a-zA-Z0-9_]+)/gu)];
  if (matches.length === 0) {
    return text
      .split(/[\n/、；;]+/u)
      .map((name) => ({ name: name.trim(), telegram: "" }))
      .filter((item) => item.name);
  }
  const lastMatch = matches.at(-1);
  const groupedNames = text
    .slice(0, matches[0].index)
    .trim()
    .split(/[/、]+/u)
    .map((name) => name.trim())
    .filter(Boolean);
  if (
    lastMatch &&
    groupedNames.length === matches.length &&
    groupedNames.length > 1 &&
    matches
      .slice(1)
      .every((match, index) =>
        /^[\s/、；;]*$/u.test(
          text.slice(matches[index].index + matches[index][0].length, match.index),
        ),
      ) &&
    !text.slice(lastMatch.index + lastMatch[0].length).trim()
  ) {
    return matches.map((match, index) => ({ name: groupedNames[index], telegram: match[0] }));
  }
  const result: ExternalInterviewerInput[] = [];
  let previousEnd = 0;
  for (const match of matches) {
    const [telegram] = match;
    const name = text
      .slice(previousEnd, match.index)
      .replaceAll(/^[\s/、；;,-]+|[\s/、；;,-]+$/gu, "");
    result.push({ name: name || telegram, telegram });
    previousEnd = match.index + telegram.length;
  }
  const trailing = text.slice(previousEnd).replaceAll(/^[\s/、；;,-]+|[\s/、；;,-]+$/gu, "");
  if (trailing) {
    result.push({ name: trailing, telegram: "" });
  }
  const seen = new Set<string>();
  return result.filter((item) => {
    const key = item.telegram.toLowerCase() || item.name;
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

export interface ExternalInterviewerBindingStatus extends ExternalInterviewerInput {
  bound: boolean;
}
