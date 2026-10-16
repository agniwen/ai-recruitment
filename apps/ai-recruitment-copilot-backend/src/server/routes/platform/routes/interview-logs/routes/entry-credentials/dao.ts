import { and, eq, desc, count, countDistinct, max } from "drizzle-orm";
import { db } from "@arc/ai-recruitment-copilot-backend/lib/server/db";
import { candidateEntryCredentialUse as uses } from "@arc/db-schema/schema";
import { hideStoredIp } from "@arc/ai-recruitment-copilot-backend/lib/server/ip-encryption";

// Only successful, server-verified uses are evidence. Never expose credential material or proof hashes.
export async function loadMeetingEntryCredentials(meetingId: string) {
  const groups = await db
    .select({
      credentialRef: uses.credentialRef,
      lastSeen: max(uses.createdAt),
      organizationId: uses.organizationId,
    })
    .from(uses)
    .where(eq(uses.meetingId, meetingId))
    .groupBy(uses.credentialRef, uses.organizationId)
    .orderBy(desc(max(uses.createdAt)))
    .limit(21);
  const records = await Promise.all(
    groups.slice(0, 20).map(async (group) => {
      const condition = and(
        eq(uses.credentialRef, group.credentialRef),
        eq(uses.organizationId, group.organizationId),
      );
      const [[summary], associations] = await Promise.all([
        db
          .select({
            browsers: countDistinct(uses.browserId),
            candidates: countDistinct(uses.candidateId),
            fingerprints: countDistinct(uses.fingerprintId),
            meetings: countDistinct(uses.meetingId),
            uses: count(),
          })
          .from(uses)
          .where(condition),
        db
          .select({
            browserId: uses.browserId,
            candidateId: uses.candidateId,
            candidateName: uses.candidateName,
            createdAt: uses.createdAt,
            fingerprintId: uses.fingerprintId,
            id: uses.id,
            ip: uses.ip,
            meetingId: uses.meetingId,
            method: uses.method,
            properties: uses.properties,
            userAgent: uses.userAgent,
            visitId: uses.visitId,
          })
          .from(uses)
          .where(condition)
          .orderBy(desc(uses.createdAt), desc(uses.id))
          .limit(50),
      ]);
      return {
        associations: associations.map((row) => ({
          ...hideStoredIp(row),
          createdAt: row.createdAt.toISOString(),
        })),
        credentialRef: group.credentialRef,
        organizationId: group.organizationId,
        summary,
        truncated: summary.uses > associations.length,
      };
    }),
  );
  return { records, truncated: groups.length > 20 };
}
