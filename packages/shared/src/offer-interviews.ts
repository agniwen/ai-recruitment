export interface OfferInterviewRound {
  label: string;
  status: string;
  sortOrder?: number;
  scheduledAt: string | null;
  feedback: string | null;
  interviewers: readonly { name: string | null }[];
}

const interviewTime = new Intl.DateTimeFormat("zh-CN", {
  day: "2-digit",
  hour: "2-digit",
  hourCycle: "h23",
  minute: "2-digit",
  month: "2-digit",
  timeZone: "Asia/Shanghai",
  year: "numeric",
});

function scheduledTime(value: string | null) {
  const time = value ? Date.parse(value) : Number.NaN;
  return Number.isFinite(time) ? time : Number.POSITIVE_INFINITY;
}

function describeInterviewTime(value: string | null) {
  const time = scheduledTime(value);
  if (!Number.isFinite(time)) {
    return "未记录";
  }
  const parts = interviewTime.formatToParts(new Date(time));
  const field = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value ?? "";
  return `${field("year")}-${field("month")}-${field("day")} ${field("hour")}:${field("minute")}（北京时间）`;
}

export function buildOfferInterviewText(rounds: readonly OfferInterviewRound[]) {
  const completed = rounds
    .map((round, index) => ({ index, round, time: scheduledTime(round.scheduledAt) }))
    .filter(({ round }) => round.status === "completed")
    .toSorted((a, b) => {
      if (a.time !== b.time) {
        return a.time - b.time;
      }
      return (a.round.sortOrder ?? 0) - (b.round.sortOrder ?? 0) || a.index - b.index;
    });
  if (completed.length === 0) {
    return "【面试情况】\n暂无已完成的真人面试记录。";
  }
  return `【面试情况】\n${completed
    .map(({ round }, index) => {
      const names = round.interviewers.map(({ name }) => name?.trim() || "未记录");
      return `第 ${index + 1} 轮：${round.label.trim() || "真人面试"}
面试时间：${describeInterviewTime(round.scheduledAt)}
面试官：${names.length ? names.join("、") : "未记录"}
面试点评：${round.feedback?.trim() || "未填写"}`;
    })
    .join("\n\n")}`;
}
