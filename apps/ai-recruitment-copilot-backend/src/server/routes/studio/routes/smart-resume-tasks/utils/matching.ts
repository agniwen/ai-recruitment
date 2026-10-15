import type { ResumeProfile } from "@arc/db-schema/interview/types";
import type { JobMatchingProfile } from "@arc/db-schema/job-matching";
import { evaluateResumeScreening, resumeScreeningPolicySchema } from "@arc/shared/resume-screening";

function normalize(text: string) {
  const value = text.toLowerCase().replaceAll(/[\s._-]/g, "");
  const aliases: Record<string, string> = {
    golang: "go",
    js: "javascript",
    nodejs: "node",
    reactjs: "react",
    ts: "typescript",
    vuejs: "vue",
  };
  return aliases[value] ?? value;
}

export function resumeMatchingFacts(resume: ResumeProfile) {
  return [
    ...resume.skills.map((quote, i) => ({ field: `skills.${i}`, quote })),
    ...resume.targetRoles.map((quote, i) => ({ field: `targetRoles.${i}`, quote })),
    ...resume.workExperiences.flatMap((work, i) => [
      { field: `workExperiences.${i}.role`, quote: work.role ?? "" },
      { field: `workExperiences.${i}.period`, quote: work.period ?? "" },
      { field: `workExperiences.${i}.summary`, quote: work.summary ?? "" },
    ]),
    ...resume.projectExperiences.flatMap((project, i) => [
      { field: `projectExperiences.${i}.role`, quote: project.role ?? "" },
      { field: `projectExperiences.${i}.period`, quote: project.period ?? "" },
      { field: `projectExperiences.${i}.summary`, quote: project.summary ?? "" },
      ...project.techStack.map((quote, j) => ({
        field: `projectExperiences.${i}.techStack.${j}`,
        quote,
      })),
    ]),
  ].filter((fact) => fact.quote && fact.quote !== "未发现信息");
}

export function buildResumeMatchingText(resume: ResumeProfile) {
  return [
    `工作年限：${resume.workYears ?? "未知"}`,
    `学历：${
      (resume.educationExperiences ?? [])
        .map((edu) => edu.educationLevel ?? edu.degree)
        .filter(Boolean)
        .join("、") || "未知"
    }`,
    ...resumeMatchingFacts(resume).map((fact) => `${fact.field}: ${fact.quote}`),
    ...(resume.scoringFacts?.skillFacts ?? []).map(
      (fact) => `技能证据 ${fact.normalizedSkill}: ${fact.evidenceLevel}`,
    ),
  ]
    .join("\n")
    .slice(0, 12_000);
}

export function rankJobEvidence(resume: ResumeProfile, profile: JobMatchingProfile) {
  const facts = resumeMatchingFacts(resume);
  const skillTokens = new Set(
    [...resume.skills, ...resume.projectExperiences.flatMap((p) => p.techStack)].map(normalize),
  );
  const matchedSkills = [
    ...new Set([...profile.requiredSkills, ...profile.preferredSkills]),
  ].filter((skill) => skillTokens.has(normalize(skill)));
  const terms = [...matchedSkills, profile.roleFamily, ...profile.domains]
    .filter(Boolean)
    .map(normalize);
  const evidence = facts
    .filter((fact) => terms.some((term) => normalize(fact.quote).includes(term)))
    .toSorted((a, b) => Number(b.field.endsWith(".summary")) - Number(a.field.endsWith(".summary")))
    .slice(0, 4);
  return { evidence, matchedSkills };
}

export function checkExistingScreeningPolicy(resume: ResumeProfile, policy: unknown) {
  const parsed = resumeScreeningPolicySchema.safeParse(policy);
  if (!parsed.success || !parsed.data.enabled) {
    return { blocked: false, warnings: [] as string[] };
  }
  const result = evaluateResumeScreening({ policy: parsed.data, resumeProfile: resume });
  return {
    blocked: result.ruleResults.some(
      (rule) => rule.severity === "blocking" && rule.status === "fail",
    ),
    warnings: result.ruleResults
      .filter((rule) => rule.status !== "pass")
      .map((rule) => rule.reason),
  };
}

const educationLevels = ["专科", "本科", "硕士", "博士"];

export function checkJobRequirements(
  resume: ResumeProfile,
  profile: JobMatchingProfile,
  confirmed: boolean,
) {
  const warnings: string[] = [];
  let blocked = false;
  if (profile.minimumWorkYears !== null) {
    if (resume.workYears === null) {
      warnings.push("工作年限待确认");
    } else if (resume.workYears < profile.minimumWorkYears) {
      warnings.push(`工作年限低于岗位要求的 ${profile.minimumWorkYears} 年`);
      blocked = confirmed;
    }
  }
  if (profile.minimumEducation) {
    const levels = (resume.educationExperiences ?? [])
      .map((edu) => {
        const text = `${edu.educationLevel ?? ""} ${edu.degree ?? ""}`;
        return educationLevels.findIndex((level) => text.includes(level));
      })
      .filter((level) => level >= 0);
    if (!levels.length) {
      warnings.push("学历信息待确认");
    } else if (Math.max(...levels) < educationLevels.indexOf(profile.minimumEducation)) {
      warnings.push(`学历低于岗位要求的${profile.minimumEducation}`);
      blocked ||= confirmed;
    }
  }
  const { matchedSkills } = rankJobEvidence(resume, profile);
  const unknown = profile.requiredSkills.filter((skill) => !matchedSkills.includes(skill));
  if (unknown.length) {
    warnings.push(`核心技能需核实：${unknown.slice(0, 5).join("、")}`);
  }
  return { blocked, warnings };
}

export function buildJobMatchingText(
  job: { name: string; prompt: string; description: string | null },
  profile?: JobMatchingProfile,
) {
  return [
    `岗位：${job.name}`,
    profile ? `结构化要求：${JSON.stringify(profile)}` : "",
    job.description ?? "",
    `岗位原文：${job.prompt}`,
  ]
    .filter(Boolean)
    .join("\n")
    .slice(0, 12_000);
}
