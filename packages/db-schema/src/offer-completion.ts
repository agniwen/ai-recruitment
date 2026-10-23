import { z } from "zod";

/** Server-generated provenance and entry details saved at final SSC confirmation. */
export const offerCompletionInfoSchema = z.object({
  candidateCode: z.string().nullable(),
  candidateName: z.string(),
  candidatePrivateTelegram: z.string().nullable(),
  preboardingDate: z.iso.date(),
  recruiterTelegram: z.string().nullable(),
  recruitingGroupNames: z.array(z.string()),
  recruitmentChannel: z.string().nullable(),
  resumeSource: z.string().nullable(),
});

export type OfferCompletionInfo = z.infer<typeof offerCompletionInfoSchema>;

/** Read-only SSC display data; the date remains empty until SSC confirms it. */
export const offerCompletionPreviewSchema = offerCompletionInfoSchema.extend({
  preboardingDate: z.iso.date().nullable(),
});

export type OfferCompletionPreview = z.infer<typeof offerCompletionPreviewSchema>;
