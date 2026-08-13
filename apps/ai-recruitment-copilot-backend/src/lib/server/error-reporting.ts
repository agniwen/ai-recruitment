interface SafeErrorEntry {
  code?: string;
  message?: string;
  name?: string;
  stack?: string;
  status?: number;
}

const MAX_ERROR_CHAIN_DEPTH = 6;
const MAX_ERROR_MESSAGE_LENGTH = 2000;
const MAX_ERROR_STACK_LENGTH = 8000;

function nonEmptyString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function nextError(value: Record<string, unknown>): unknown {
  if (value.cause) {
    return value.cause;
  }
  if (value.error) {
    return value.error;
  }
  return Array.isArray(value.errors) ? value.errors[0] : null;
}

function errorChain(error: unknown): unknown[] {
  const chain: unknown[] = [];
  const visited = new Set<unknown>();
  let current = error;
  while (current && !visited.has(current) && chain.length < MAX_ERROR_CHAIN_DEPTH) {
    visited.add(current);
    chain.push(current);
    current =
      typeof current === "object" && current !== null
        ? nextError(current as Record<string, unknown>)
        : null;
  }
  return chain;
}

export function describeError(error: unknown, fallback: string): string {
  for (const current of errorChain(error)) {
    if (typeof current === "string" && current.trim()) {
      return current.trim();
    }
    if (typeof current === "object" && current !== null) {
      const message = nonEmptyString((current as Record<string, unknown>).message);
      if (message) {
        return message;
      }
    }
  }
  return fallback;
}

function safeErrorEntry(value: unknown): SafeErrorEntry {
  if (typeof value !== "object" || value === null) {
    return { message: String(value).slice(0, MAX_ERROR_MESSAGE_LENGTH) };
  }
  const record = value as Record<string, unknown>;
  const code = nonEmptyString(record.code);
  const message = nonEmptyString(record.message);
  const name = nonEmptyString(record.name);
  const stack = nonEmptyString(record.stack);
  const status = typeof record.status === "number" ? record.status : undefined;
  return {
    ...(code ? { code } : {}),
    ...(message ? { message: message.slice(0, MAX_ERROR_MESSAGE_LENGTH) } : {}),
    ...(name ? { name } : {}),
    ...(stack ? { stack: stack.slice(0, MAX_ERROR_STACK_LENGTH) } : {}),
    ...(status === undefined ? {} : { status }),
  };
}

export function serializeErrorDetails(error: unknown): { chain: SafeErrorEntry[] } {
  return { chain: errorChain(error).map(safeErrorEntry) };
}
