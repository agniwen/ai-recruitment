import { Actions, Card, CardText, Field, Fields, LinkButton } from "chat";
import { humanInterviewFormatMeta } from "@arc/db-schema/studio-interviews";
import { buildCandidateDetailUrl } from "./candidate-stage-notification";
import {
  buildInterviewerInviteToken,
  buildInviteExpiry,
} from "../dao/human-interview-meeting-access";
import type { HumanInterviewReminder } from "../dao/human-interview-reminders";
import type { HumanInterviewReminderRecipient } from "../dao/human-interview-reminder-recipients";

export function buildHumanInterviewReminderMessage(
  reminders: HumanInterviewReminder[],
  recipient: HumanInterviewReminderRecipient,
) {
  const [reminder] = reminders;
  const baseUrl = process.env.NEXT_PUBLIC_BASE_URL?.trim() || process.env.BETTER_AUTH_URL?.trim();
  // Only include rounds for which this recipient was resolved; never expose other candidates.
  const links = reminders.flatMap((row) => {
    const detailUrl = buildCandidateDetailUrl(
      row.candidateId,
      row.organizationSlug,
      Boolean(recipient.interviewer?.external),
    );
    return detailUrl
      ? [
          LinkButton({
            label: reminders.length === 1 ? "查看候选人详情" : `查看 ${row.candidateName}`,
            url: detailUrl,
          }),
        ]
      : [];
  });
  if (baseUrl && reminder.meetingId && recipient.interviewer) {
    const token = buildInterviewerInviteToken({
      ...recipient.interviewer,
      exp: buildInviteExpiry(),
      meetingId: reminder.meetingId,
    });
    links.unshift(
      LinkButton({
        label: "进入面试",
        url: new URL(
          `/human-interview/interviewer/${encodeURIComponent(token)}`,
          baseUrl,
        ).toString(),
      }),
    );
  }
  const time = new Intl.DateTimeFormat("zh-CN", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Asia/Shanghai",
  }).format(reminder.scheduledAt);
  return Card({
    children: [
      CardText("面试将在 10 分钟内开始，请提前做好准备。"),
      Fields([
        ...reminders.flatMap((row) => [
          Field({ label: "候选人", value: row.candidateName }),
          Field({ label: "岗位", value: row.jobName ?? "未关联岗位" }),
          Field({ label: "面试轮次", value: row.title }),
        ]),
        Field({ label: "招聘主体", value: reminder.organizationName }),
        Field({ label: "开始时间", value: `${time}（北京时间）` }),
        Field({ label: "面试形式", value: humanInterviewFormatMeta[reminder.format].label }),
        ...(reminder.location ? [Field({ label: "地点", value: reminder.location })] : []),
        Field({ label: "通知身份", value: recipient.roles.join("、") }),
      ]),
      ...(links.length ? [Actions(links)] : []),
    ],
    title: "⏰ 真人面试即将开始",
  });
}
