import type { HumanInterviewMeetingRecord } from "@arc/shared/studio-pipeline-stages";
import { Actions, Card, CardText, Field, Fields, LinkButton } from "chat";
import {
  isTelegramBotConfigured,
  postTelegramDirectMessage,
} from "@arc/ai-recruitment-copilot-backend/server/routes/telegram/utils/bot";
import {
  loadExternalInterviewCandidates,
  resolveExternalInterviewerBindings,
} from "../dao/external-interviewers";
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
    const candidates = await loadExternalInterviewCandidates(meeting.id, meeting.organizationId);
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
          Card({
            children: [
              Fields([
                Field({ label: "面试官", value: recipient.name }),
                Field({ label: "面试", value: meeting.title }),
                Field({ label: "时间", value: `${time}（北京时间）` }),
              ]),
              ...candidates.map((candidate) =>
                Fields([
                  Field({ label: "候选人", value: candidate.candidateName }),
                  Field({ label: "岗位", value: candidate.jobDescriptionName ?? "未关联岗位" }),
                  Field({ label: "用人组织", value: candidate.hiringUnitName ?? "未分配用人组织" }),
                  Field({ label: "部门", value: candidate.departmentName ?? "未关联部门" }),
                ]),
              ),
              CardText("进入面试无需登录，面试开始前 5 分钟可进入。查看候选人详情需登录。"),
              Actions([
                LinkButton({ label: "进入面试", url }),
                ...candidates.map((candidate) =>
                  LinkButton({
                    label:
                      candidates.length === 1
                        ? "查看候选人详情"
                        : `查看${candidate.candidateName}详情`,
                    url: new URL(
                      `/resume-review/${encodeURIComponent(candidate.organizationSlug)}/${encodeURIComponent(candidate.id)}`,
                      baseUrl,
                    ).toString(),
                  }),
                ),
              ]),
            ],
            title: "真人面试邀请",
          }),
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
