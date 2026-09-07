import { makePaginationSchema } from "@arc/ai-recruitment-copilot-backend/lib/server/db/pagination";

export const odcAssignmentPaginationSchema = makePaginationSchema(["createdAt"] as const);

export function parseOdcAssignmentPagination(params?: Record<string, unknown>) {
  return odcAssignmentPaginationSchema.parse(params ?? {});
}
