import type { ResumeProfile } from "@arc/db-schema/interview/types";
import { structuredSchema } from "@arc/db-schema/resume-parser-schema";

// Use at read boundaries too: older cached profiles may predate normalization.
export function normalizeResumeProfile(value: unknown): ResumeProfile {
  const structured = structuredSchema.parse(value ?? {});
  return {
    age: structured.age,
    educationExperiences: structured.educationExperiences ?? [],
    email: structured.email,
    gender: structured.gender,
    name: structured.name?.trim() || "未发现信息",
    personalStrengths: structured.personalStrengths,
    phone: structured.phone,
    projectExperiences: structured.projectExperiences,
    schools: structured.schools,
    skills: structured.skills,
    targetRoles: structured.targetRoles,
    workExperiences: structured.workExperiences,
    workYears: structured.workYears,
  };
}
