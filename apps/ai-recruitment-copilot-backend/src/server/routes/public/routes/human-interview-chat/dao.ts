import { and, asc, eq } from "drizzle-orm";
import { studioHumanInterviewMeetingChatMessage } from "@arc/db-schema/schema";
import { db } from "../../../../../lib/server/db/index";

type ChatMessageRow = typeof studioHumanInterviewMeetingChatMessage.$inferSelect;

function toChatMessage(row: ChatMessageRow) {
  return {
    id: row.id,
    message: row.content,
    participantIdentity: row.participantIdentity,
    senderName: row.senderName,
    timestamp: row.createdAt.toISOString(),
  };
}

export async function listHumanInterviewChatMessages(input: {
  meetingId: string;
  organizationId: string;
}) {
  const rows = await db
    .select()
    .from(studioHumanInterviewMeetingChatMessage)
    .where(
      and(
        eq(studioHumanInterviewMeetingChatMessage.meetingId, input.meetingId),
        eq(studioHumanInterviewMeetingChatMessage.organizationId, input.organizationId),
      ),
    )
    .orderBy(
      asc(studioHumanInterviewMeetingChatMessage.createdAt),
      asc(studioHumanInterviewMeetingChatMessage.id),
    );
  return rows.map(toChatMessage);
}

export async function saveHumanInterviewChatMessage(input: {
  id: string;
  meetingId: string;
  organizationId: string;
  participantIdentity: string;
  senderName: string;
  message: string;
}) {
  const [inserted] = await db
    .insert(studioHumanInterviewMeetingChatMessage)
    .values({
      content: input.message,
      id: input.id,
      meetingId: input.meetingId,
      organizationId: input.organizationId,
      participantIdentity: input.participantIdentity,
      senderName: input.senderName,
    })
    .onConflictDoNothing()
    .returning();
  if (inserted) {
    return toChatMessage(inserted);
  }
  const [existing] = await db
    .select()
    .from(studioHumanInterviewMeetingChatMessage)
    .where(eq(studioHumanInterviewMeetingChatMessage.id, input.id))
    .limit(1);
  if (
    !existing ||
    existing.meetingId !== input.meetingId ||
    existing.organizationId !== input.organizationId ||
    existing.participantIdentity !== input.participantIdentity ||
    existing.content !== input.message
  ) {
    return null;
  }
  return toChatMessage(existing);
}
