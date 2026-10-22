import { z } from "zod";
import { candidatePrivateTelegramSchema } from "./offer-recruiter-contact";

const nullableText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((value) => value || null)
    .nullable()
    .default(null);

/** The content the recruiter confirmed for this Offer revision. */
export const offerConfirmationDetailsSchema = z.object({
  candidateCode: nullableText(120),
  candidateName: nullableText(200),
  candidatePrivateTelegram: candidatePrivateTelegramSchema.nullable().optional(),
  departmentName: nullableText(200),
  directManager: nullableText(200),
  gender: nullableText(30),
  hiringUnitName: nullableText(200),
  interviewFeedback: nullableText(5000),
  interviewRoundId: nullableText(200),
  jobLevel: nullableText(120),
  jobType: nullableText(120),
  mainInterviewerName: nullableText(200),
  managementSequence: nullableText(120),
  personnelType: nullableText(120),
  probationPeriod: nullableText(120),
  probationSalary: z.number().int().min(0, "试用薪资不能为负").nullable().default(null),
  serviceUnit: nullableText(200),
  workLocation: nullableText(200),
  workMode: nullableText(120),
});

export type OfferConfirmationDetails = z.infer<typeof offerConfirmationDetailsSchema>;
