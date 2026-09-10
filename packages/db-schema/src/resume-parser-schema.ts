import { z } from "zod";
import { resumeScoringFactsSchema } from "./resume-scoring-facts";

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

const structuredObjectSchema = z.object({
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
  scoringFacts: resumeScoringFactsSchema.optional(),
  skills: resumeList(z.string()),
  sourceFileName: z.preprocess(
    (value) => (typeof value === "string" ? value : undefined),
    z.string().optional(),
  ),
  targetRoles: resumeList(z.string()),
  timelineSummary: z.preprocess(
    (value) => (typeof value === "object" && value !== null && !Array.isArray(value) ? value : {}),
    timelineSummarySchema,
  ),
  workExperiences: resumeList(workExperienceSchema),
  workYears: resumeNumber,
});

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function remapFactIndexes(experiences: unknown, facts: unknown, schema: z.ZodType): unknown {
  const source = Array.isArray(experiences) ? experiences : [experiences];
  const indexes = new Map<number, number>();
  for (const [index, experience] of source.entries()) {
    if (schema.safeParse(experience).success) {
      indexes.set(index, indexes.size);
    }
  }
  const entries = Array.isArray(facts) ? facts : [facts];
  return entries.flatMap((fact) => {
    if (!isRecord(fact)) {
      return [];
    }
    const index =
      typeof fact.sourceIndex === "string" && /^\d+$/.test(fact.sourceIndex.trim())
        ? Number(fact.sourceIndex)
        : fact.sourceIndex;
    const sourceIndex = typeof index === "number" ? indexes.get(index) : undefined;
    return sourceIndex === undefined ? [] : [{ ...fact, sourceIndex }];
  });
}

// Dropping malformed experiences must not move another company's evidence onto a surviving row.
function normalizeFactIndexes(value: unknown): unknown {
  if (!isRecord(value) || !isRecord(value.scoringFacts)) {
    return value;
  }
  return {
    ...value,
    scoringFacts: {
      ...value.scoringFacts,
      employmentEpisodes: remapFactIndexes(
        value.workExperiences,
        value.scoringFacts.employmentEpisodes,
        workExperienceSchema,
      ),
      projects: remapFactIndexes(
        value.projectExperiences,
        value.scoringFacts.projects,
        projectExperienceSchema,
      ),
    },
  };
}

export const resumeParserFieldNames = Object.keys(structuredObjectSchema.shape);

export const structuredSchema = z.preprocess(normalizeFactIndexes, structuredObjectSchema);
export const resumeParserGenerationSchema = z.preprocess(
  normalizeFactIndexes,
  structuredObjectSchema.omit({ sourceFileName: true }),
);

export type ResumeParserStructured = z.infer<typeof structuredSchema>;

export function normalizeResumeStructuredSourceFileName(fileName: string): string {
  return fileName.slice(0, 255);
}

export function isResumeStructuredSourceFileNameCompatible(
  structured: unknown,
  fileName: string,
): boolean {
  const parsed = structuredSchema.safeParse(structured);
  const normalized = normalizeResumeStructuredSourceFileName(fileName);
  return Boolean(normalized) && parsed.success && parsed.data.sourceFileName === normalized;
}
