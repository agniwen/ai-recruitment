import { z } from "zod";
import { humanInterviewMeetingInputSchema } from "@arc/db-schema/studio-interviews";

export const humanInterviewConflictInputSchema = humanInterviewMeetingInputSchema
  .pick({ interviewerIds: true, scheduledAt: true, validUntil: true })
  .extend({ excludeRoundIds: z.array(z.string().trim().min(1)).max(20).optional() });

export type HumanInterviewConflictInput = z.infer<typeof humanInterviewConflictInputSchema>;

// Availability only: do not expose candidates or meetings outside the creator's visibility.
export interface HumanInterviewConflict {
  interviewerId: string;
  interviewerName: string;
  startAt: string;
  endAt: string;
}
