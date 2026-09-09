import { arrayCompatNormalize } from "drizzle-orm/pg-core/codecs";
import { postgresJsCodecs } from "drizzle-orm/postgres-js";

const LEGACY_UTC_TIMESTAMP = /^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}(?:\.\d+)?$/;

// Older timestamp columns store UTC without an offset, although the current
// schema declares timestamptz. Never interpret those values in the host timezone.
// Explicit offsets from real timestamptz columns must remain unchanged.
export function parseDatabaseTimestamp(value: string): Date {
  const timestamp = value.trim();
  return new Date(LEGACY_UTC_TIMESTAMP.test(timestamp) ? `${timestamp}Z` : timestamp);
}

export const databaseCodecs = {
  ...postgresJsCodecs,
  timestamptz: {
    ...postgresJsCodecs.timestamptz,
    normalize: parseDatabaseTimestamp,
    normalizeArray: arrayCompatNormalize(parseDatabaseTimestamp),
    normalizeArrayInJson: arrayCompatNormalize(parseDatabaseTimestamp),
    normalizeInJson: parseDatabaseTimestamp,
  },
};
