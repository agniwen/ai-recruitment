export const resumeRecruitmentSources = [
  "boss",
  "zhilian",
  "liepin",
  "xiaohongshu",
  "tg",
  "referral",
  "other",
] as const;

export type ResumeRecruitmentSource = (typeof resumeRecruitmentSources)[number];
