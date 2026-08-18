import { db } from "@arc/ai-recruitment-copilot-backend/lib/server/db";
import { interviewAuditLog } from "@arc/db-schema/schema";

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

export interface CandidateActivityInput {
  action: string;
  detail?: Record<string, unknown>;
  interviewRecordId: string;
  operatorId: string | null;
  operatorRole?: string | null;
  organizationId: string;
  scheduleEntryId?: string | null;
  source?: "agent" | "api" | "import" | "manual" | "system";
}

function buildCandidateActivityValues({
  action,
  detail = {},
  interviewRecordId,
  operatorId,
  operatorRole = null,
  organizationId,
  scheduleEntryId = null,
  source = "manual",
}: CandidateActivityInput) {
  return {
    action,
    createdAt: new Date(),
    detail,
    id: crypto.randomUUID(),
    interviewRecordId,
    operatorId,
    operatorRole,
    organizationId,
    scheduleEntryId,
    source,
  };
}

export async function recordCandidateActivity(input: CandidateActivityInput) {
  await db.insert(interviewAuditLog).values(buildCandidateActivityValues(input));
}

export async function recordCandidateActivityInTransaction(tx: Tx, input: CandidateActivityInput) {
  await tx.insert(interviewAuditLog).values(buildCandidateActivityValues(input));
}
