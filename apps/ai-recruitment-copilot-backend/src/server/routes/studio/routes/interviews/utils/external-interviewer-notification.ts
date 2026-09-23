import type { HumanInterviewMeetingRecord } from "@arc/shared/studio-pipeline-stages";
import {
  isTelegramBotConfigured,
  postTelegramDirectMessage,
} from "@arc/ai-recruitment-copilot-backend/server/routes/telegram/utils/bot";
import { resolveExternalInterviewerBindings } from "../dao/external-interviewers";
import {
  buildInterviewerInviteToken,
  buildInviteExpiry,
} from "../dao/human-interview-meeting-access";

export async function notifyExternalInterviewers(
  meeting: HumanInterviewMeetingRecord,
): Promise<string[]> {
  const external = meeting.interviewers.filter((item) => item.external);
  if (!external.length) {
    return [];
  }
  try {
    const recipients = await resolveExternalInterviewerBindings(
      meeting.organizationId,
      external.map((item) => ({ name: item.name, telegram: item.telegram ?? "" })),
    );
    const failed: string[] = [];
    const baseUrl = process.env.NEXT_PUBLIC_BASE_URL?.trim() || process.env.BETTER_AUTH_URL?.trim();
    for (const [index, recipient] of recipients.entries()) {
      if (!recipient.chatId) {
        continue;
      }
      try {
        if (!baseUrl || !isTelegramBotConfigured()) {
          throw new Error("Telegram notification configuration missing");
        }
        const token = buildInterviewerInviteToken({
          exp: buildInviteExpiry(),
          external: true,
          meetingId: meeting.id,
          role: "interviewer",
          userId: external[index].id,
        });
        const url = new URL(
          `/human-interview/interviewer/${encodeURIComponent(token)}`,
          baseUrl,
        ).toString();
        const time = meeting.scheduledAt
          ? new Intl.DateTimeFormat("zh-CN", {
              dateStyle: "medium",
              timeStyle: "short",
              timeZone: "Asia/Shanghai",
            }).format(new Date(meeting.scheduledAt))
          : "待定";
        await postTelegramDirectMessage(
          recipient.chatId,
          `${recipient.name}，你有一场真人面试邀请。\n面试：${meeting.title}\n时间：${time}（北京时间）\n面试链接：${url}\n无需登录，面试开始前 5 分钟可进入。`,
        );
      } catch {
        failed.push(recipient.name);
      }
    }
    return failed;
  } catch {
    // Scheduling is already committed; notification failures must not cause duplicate retries.
    return external.map((item) => item.name);
  }
}
