import { and, eq, inArray, ne, or, sql } from "drizzle-orm";
import { db } from "@arc/ai-recruitment-copilot-backend/lib/server/db";
import {
  jobDescription,
  resumeSource,
  sscResponsibility,
  studioInterview,
  telegramRecipientBinding,
} from "@arc/db-schema/schema";
import { resolveExternalInterviewerBindings } from "../studio/routes/interviews/dao/external-interviewers";
import { normalizeTelegramUsername } from "./utils/identity";

/** Notification delivery uses the source ledger and verified chat, never an approval identity. */
export async function listSourceSscNotificationRecipients(input: {
  organizationId: string;
  interviewRecordId: string;
}) {
  const rows = await db
    .selectDistinct({
      candidateName: studioInterview.candidateName,
      chatId: telegramRecipientBinding.chatId,
      pipelineStage: studioInterview.pipelineStage,
      responsibilityId: sscResponsibility.id,
      sscName: sscResponsibility.sscName,
      telegram: sscResponsibility.telegram,
    })
    .from(studioInterview)
    .innerJoin(
      jobDescription,
      and(
        eq(jobDescription.id, studioInterview.jobDescriptionId),
        eq(jobDescription.organizationId, studioInterview.organizationId),
      ),
    )
    .innerJoin(
      resumeSource,
      and(
        eq(resumeSource.id, jobDescription.resumeSourceId),
        eq(resumeSource.organizationId, studioInterview.organizationId),
      ),
    )
    .innerJoin(
      sscResponsibility,
      and(
        eq(sscResponsibility.resumeSourceId, resumeSource.id),
        eq(sscResponsibility.organizationId, studioInterview.organizationId),
      ),
    )
    .leftJoin(
      telegramRecipientBinding,
      sql`lower(btrim(trim(leading '@' from btrim(${sscResponsibility.telegram})))) = ${telegramRecipientBinding.username}`,
    )
    .where(
      and(
        eq(studioInterview.organizationId, input.organizationId),
        eq(studioInterview.id, input.interviewRecordId),
        ne(studioInterview.pipelineStage, "closed"),
      ),
    );
  const assignments = rows.flatMap((row) => {
    const username = normalizeTelegramUsername(row.telegram);
    return username && /^[a-zA-Z0-9_]{5,32}$/u.test(username) ? [{ ...row, username }] : [];
  });
  const missing = assignments.filter((row) => !row.chatId);
  // Older verified private-chat records remain usable as transport addresses.
  // They neither create a user nor decide which account can approve the Offer.
  const legacy = missing.length
    ? await resolveExternalInterviewerBindings(
        input.organizationId,
        missing.map((row) => ({ name: row.username, telegram: row.username })),
      )
    : [];
  const legacyChatIds = legacy.flatMap((row) => (row.chatId ? [row.chatId] : []));
  const current = legacyChatIds.length
    ? await db
        .select()
        .from(telegramRecipientBinding)
        .where(
          or(
            inArray(telegramRecipientBinding.chatId, legacyChatIds),
            inArray(
              telegramRecipientBinding.username,
              missing.map((row) => row.username),
            ),
          ),
        )
    : [];
  const seen = new Set<string>();
  return assignments.flatMap((row) => {
    const old = legacy.find((entry) => entry.telegram === row.username);
    const chatId = row.chatId ?? old?.chatId;
    if (
      !chatId ||
      !/^[1-9]\d*$/u.test(chatId) ||
      seen.has(chatId) ||
      (!row.chatId &&
        current.some(
          (binding) =>
            (binding.chatId === chatId && binding.username !== row.username) ||
            (binding.username === row.username && binding.chatId !== chatId),
        ))
    ) {
      return [];
    }
    seen.add(chatId);
    return [
      {
        candidateName: row.candidateName,
        chatId,
        pipelineStage: row.pipelineStage,
        responsibilityId: row.responsibilityId,
        sscName: row.sscName,
        username: row.username,
      },
    ];
  });
}
