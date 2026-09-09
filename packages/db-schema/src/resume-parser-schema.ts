import { z } from "zod";

// Normalize recoverable model output locally so one malformed field does not
// discard the rest of a resume. Unknown facts stay null rather than being guessed.
const resumeText = z.preprocess((value) => {
  if (typeof value === "string") {
    return value.trim() || null;
  }
  return typeof value === "number" && Number.isFinite(value) ? String(value) : null;
}, z.string().nullable());

const resumeNumber = z.preprocess((value) => {
  const number = typeof value === "string" && value.trim() ? Number(value) : value;
  return typeof number === "number" && Number.isFinite(number) ? number : null;
}, z.number().nullable());

function resumeList<T extends z.ZodType>(item: T) {
  return z.preprocess((value) => {
    const entries = Array.isArray(value) ? value : [value];
    return entries.flatMap((entry) => {
      const parsed = item.safeParse(entry);
      return parsed.success ? [parsed.data] : [];
    });
  }, z.array(item));
}

const timelineSummarySchema = z.object({
  currentStatus: resumeText,
  dateRanges: resumeList(z.string()),
  estimatedExperienceYears: resumeNumber,
  riskSignals: resumeList(z.string()),
});

const workExperienceSchema = z.object({
  company: resumeText,
  period: resumeText,
  role: resumeText,
  summary: resumeText,
});

const projectExperienceSchema = z.object({
  name: resumeText,
  period: resumeText,
  role: resumeText,
  summary: resumeText,
  techStack: resumeList(z.string()),
});

const educationExperienceSchema = z.object({
  degree: resumeText,
  educationLevel: resumeText,
  graduationYear: resumeText,
  major: resumeText,
  period: resumeText,
  school: resumeText,
  summary: resumeText,
});

export const structuredSchema = z.object({
  age: resumeNumber,
  degree: resumeText,
  education: resumeText,
  educationExperiences: resumeList(educationExperienceSchema),
  email: resumeText,
  gender: resumeText,
  graduationYear: resumeText,
  links: resumeList(z.string()),
  major: resumeText,
  name: resumeText,
  personalStrengths: resumeList(z.string()),
  phone: resumeText,
  projectExperiences: resumeList(projectExperienceSchema),
  schools: resumeList(z.string()),
  skills: resumeList(z.string()),
  targetRoles: resumeList(z.string()),
  timelineSummary: z.preprocess(
    (value) => (typeof value === "object" && value !== null && !Array.isArray(value) ? value : {}),
    timelineSummarySchema,
  ),
  workExperiences: resumeList(workExperienceSchema),
  workYears: resumeNumber,
});

export type ResumeParserStructured = z.infer<typeof structuredSchema>;
