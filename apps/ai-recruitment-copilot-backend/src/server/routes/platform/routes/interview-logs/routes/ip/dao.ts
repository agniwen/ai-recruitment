import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { db } from "@arc/ai-recruitment-copilot-backend/lib/server/db";
import { decryptIp, ipContext } from "@arc/ai-recruitment-copilot-backend/lib/server/ip-encryption";
import {
  interviewTelemetryEvent as event,
  candidateEntryCredentialUse as use,
  interviewMediaAsset as asset,
  interviewMediaRoom as room,
  platformSecurityAudit as audit,
} from "@arc/db-schema/schema";
import type { IpReference } from "@arc/shared/platform-security";
import { requireRecentMfa } from "../../../../../security/mfa/service";
import type { SecurityPrincipal } from "../../../../../security/mfa/service";
import { lookupIpRegion } from "./region";

async function loadEncryptedIp(input: IpReference) {
  if (input.kind === "webrtc") {
    const [row] = await db
      .select({ details: event.details, organizationId: event.organizationId })
      .from(event)
      .where(and(eq(event.id, input.id), eq(event.meetingId, input.meetingId)))
      .limit(1);
    return row
      ? {
          ip: typeof row.details.webrtcAddress === "string" ? row.details.webrtcAddress : null,
          organizationId: row.organizationId,
        }
      : null;
  }
  if (input.kind === "media") {
    const [row] = await db
      .select({ environment: asset.environment, organizationId: room.organizationId })
      .from(asset)
      .innerJoin(room, and(eq(room.roomSid, asset.roomSid), eq(room.meetingId, asset.meetingId)))
      .where(and(eq(asset.id, input.id), eq(asset.meetingId, input.meetingId)))
      .limit(1);
    return row ? { ip: row.environment.ip, organizationId: row.organizationId } : null;
  }
  const table = input.kind === "telemetry" ? event : use;
  const [row] = await db
    .select({ ip: table.ip, organizationId: table.organizationId })
    .from(table)
    .where(and(eq(table.id, input.id), eq(table.meetingId, input.meetingId)))
    .limit(1);
  return row ?? null;
}

export async function revealStoredIp(
  input: IpReference,
  principal: SecurityPrincipal,
  headers: Headers,
) {
  const expiresAt = await requireRecentMfa(principal, headers);
  const row = await loadEncryptedIp(input);
  let ip: string | null = null;
  let failed = false;
  if (row?.ip) {
    try {
      ip = await decryptIp(row.ip, ipContext(input.kind, row.organizationId, input.id));
    } catch {
      failed = true;
    }
  }
  // Audit failure fails the read. Never record IP plaintext or ciphertext in the audit.
  let outcome = ip ? "success" : "missing";
  if (failed) {
    outcome = "failed";
  }
  await db.insert(audit).values({
    action: `ip.reveal.${input.kind}`,
    actorId: principal.userId,
    id: randomUUID(),
    organizationId: row?.organizationId,
    outcome,
    sessionId: principal.sessionId,
    targetId: input.id,
  });
  if (failed) {
    throw new Error("IP decryption unavailable");
  }
  return ip ? { expiresAt, ip, region: lookupIpRegion(ip) } : null;
}
