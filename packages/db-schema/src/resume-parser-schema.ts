import { z } from "zod";

// Missing resume information must not become invented values. Keep the output
// shape stable for consumers: unknown scalars are null and absent lists are [].
function resumeList<T extends z.ZodType>(item: T) {
  return z.preprocess((value) => value ?? [], z.array(item));
}

const timelineSummarySchema = z.object({
  currentStatus: z.string().nullable().default(null),
  dateRanges: resumeList(z.string()),
  estimatedExperienceYears: z.number().nullable().default(null),
  riskSignals: resumeList(z.string()),
});

const workExperienceSchema = z.object({
  company: z.string().nullable().default(null),
  period: z.string().nullable().default(null),
  role: z.string().nullable().default(null),
  summary: z.string().nullable().default(null),
});

const projectExperienceSchema = z.object({
  name: z.string().nullable().default(null),
  period: z.string().nullable().default(null),
  role: z.string().nullable().default(null),
  summary: z.string().nullable().default(null),
  techStack: resumeList(z.string()),
});

const educationExperienceSchema = z.object({
  degree: z.string().nullable().default(null),
  educationLevel: z.string().nullable().default(null),
  graduationYear: z.string().nullable().default(null),
  major: z.string().nullable().default(null),
  period: z.string().nullable().default(null),
  school: z.string().nullable().default(null),
  summary: z.string().nullable().default(null),
});

export const structuredSchema = z.object({
  age: z.number().nullable().default(null),
  degree: z.string().nullable().default(null),
  education: z.string().nullable().default(null),
  educationExperiences: resumeList(educationExperienceSchema),
  email: z.string().nullable().default(null),
  gender: z.string().nullable().default(null),
  graduationYear: z.string().nullable().default(null),
  links: resumeList(z.string()),
  major: z.string().nullable().default(null),
  name: z.string().nullable().default(null),
  personalStrengths: resumeList(z.string()),
  phone: z.string().nullable().default(null),
  projectExperiences: resumeList(projectExperienceSchema),
  schools: resumeList(z.string()),
  skills: resumeList(z.string()),
  targetRoles: resumeList(z.string()),
  timelineSummary: z.preprocess((value) => value ?? {}, timelineSummarySchema),
  workExperiences: resumeList(workExperienceSchema),
  workYears: z.number().nullable().default(null),
});

export type ResumeParserStructured = z.infer<typeof structuredSchema>;
