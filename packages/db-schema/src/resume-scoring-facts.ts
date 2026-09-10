/* oxlint-disable promise/prefer-await-to-then -- Zod catch defines synchronous field defaults, not Promise handlers. */
import { z } from "zod";

function factList<T extends z.ZodType>(item: T) {
  return z.preprocess((value) => {
    const entries = Array.isArray(value) ? value : [value];
    return entries.flatMap((entry) => {
      const parsed = item.safeParse(entry);
      return parsed.success ? [parsed.data] : [];
    });
  }, z.array(item));
}

const monthSchema = z
  .string()
  .regex(/^\d{4}-(0[1-9]|1[0-2])$/)
  .nullable()
  .catch(null);
const evidenceQuotesSchema = factList(z.string().trim().min(1));
const sourceIndexSchema = z.preprocess(
  (value) => (typeof value === "string" && /^\d+$/.test(value.trim()) ? Number(value) : value),
  z.number().int().min(0),
);

export const resumeEmploymentFactSchema = z.object({
  currentStatus: z.enum(["current", "ended", "unknown"]).catch("unknown"),
  endMonth: monthSchema,
  evidence: evidenceQuotesSchema,
  gapExplanation: z.string().trim().min(1).nullable().catch(null),
  primaryStatus: z.enum(["concurrent", "primary", "unresolved"]).catch("unresolved"),
  sourceIndex: sourceIndexSchema,
  startMonth: monthSchema,
});

export const resumeProjectFactSchema = z.object({
  currentStatus: z.enum(["current", "ended", "unknown"]).catch("unknown"),
  endMonth: monthSchema,
  evidence: evidenceQuotesSchema,
  sourceIndex: sourceIndexSchema,
  startMonth: monthSchema,
});

export const resumeSkillFactSchema = z.object({
  evidence: evidenceQuotesSchema,
  evidenceLevel: z.enum(["applied", "mentioned", "unknown"]).catch("unknown"),
  normalizedSkill: z.string().trim().min(1),
});

const scoringFactsObjectSchema = z.object({
  additionalEvidence: evidenceQuotesSchema,
  employmentEpisodes: factList(resumeEmploymentFactSchema),
  projects: factList(resumeProjectFactSchema),
  skillFacts: factList(resumeSkillFactSchema),
  version: z.literal(1).default(1),
});

// Unknown versions are not interpreted as v1 evidence; core resume fields remain usable.
export const resumeScoringFactsSchema = z.preprocess((value) => {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return {};
  }
  if ("version" in value && value.version !== undefined && value.version !== 1) {
    return {};
  }
  return value;
}, scoringFactsObjectSchema);

export type ResumeScoringFacts = z.infer<typeof resumeScoringFactsSchema>;

function uniqueTrimmed(values: readonly string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

export function normalizeResumeScoringFacts(input: {
  facts?: ResumeScoringFacts;
  projectExperienceCount: number;
  skills: readonly string[];
  workExperienceCount: number;
}): ResumeScoringFacts {
  const facts = input.facts ?? {
    additionalEvidence: [],
    employmentEpisodes: [],
    projects: [],
    skillFacts: [],
    version: 1 as const,
  };
  const employmentByIndex = new Map(
    facts.employmentEpisodes
      .filter((fact) => fact.sourceIndex < input.workExperienceCount)
      .map((fact) => [fact.sourceIndex, fact]),
  );
  const projectsByIndex = new Map(
    facts.projects
      .filter((fact) => fact.sourceIndex < input.projectExperienceCount)
      .map((fact) => [fact.sourceIndex, fact]),
  );
  const skillsByName = new Map(
    facts.skillFacts.map((fact) => [fact.normalizedSkill.toLocaleLowerCase("zh-CN"), fact]),
  );

  return {
    additionalEvidence: uniqueTrimmed(facts.additionalEvidence),
    employmentEpisodes: Array.from({ length: input.workExperienceCount }, (_, sourceIndex) => {
      const fact = employmentByIndex.get(sourceIndex);
      return {
        currentStatus: fact?.currentStatus ?? "unknown",
        endMonth: fact?.endMonth ?? null,
        evidence: uniqueTrimmed(fact?.evidence ?? []),
        gapExplanation: fact?.gapExplanation?.trim() || null,
        primaryStatus: fact?.primaryStatus ?? "unresolved",
        sourceIndex,
        startMonth: fact?.startMonth ?? null,
      };
    }),
    projects: Array.from({ length: input.projectExperienceCount }, (_, sourceIndex) => {
      const fact = projectsByIndex.get(sourceIndex);
      return {
        currentStatus: fact?.currentStatus ?? "unknown",
        endMonth: fact?.endMonth ?? null,
        evidence: uniqueTrimmed(fact?.evidence ?? []),
        sourceIndex,
        startMonth: fact?.startMonth ?? null,
      };
    }),
    skillFacts: uniqueTrimmed(input.skills).map((normalizedSkill) => {
      const fact = skillsByName.get(normalizedSkill.toLocaleLowerCase("zh-CN"));
      return {
        evidence: uniqueTrimmed(fact?.evidence ?? []),
        evidenceLevel: fact?.evidenceLevel ?? "unknown",
        normalizedSkill,
      };
    }),
    version: 1,
  };
}
