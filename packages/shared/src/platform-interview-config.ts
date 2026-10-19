import { z } from "zod";

export const DEFAULT_HUMAN_INTERVIEW_LOCK_HOURS = 48;

export const platformInterviewConfigSchema = z.object({
  humanInterviewLockHours: z.number().int().min(1).max(8760),
});

export type PlatformInterviewConfig = z.infer<typeof platformInterviewConfigSchema>;
