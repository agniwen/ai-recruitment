import { z } from "zod";

const tags = z.array(z.string().trim().min(1).max(120)).max(30);

export const jobMatchingProfileSchema = z.object({
  domains: tags,
  minimumEducation: z.enum(["专科", "本科", "硕士", "博士"]).nullable(),
  minimumWorkYears: z.number().min(0).max(60).nullable(),
  preferredSkills: tags,
  requiredSkills: tags,
  responsibilities: tags,
  roleFamily: z.string().trim().max(120),
  seniority: z.string().trim().max(120),
});

export type JobMatchingProfile = z.infer<typeof jobMatchingProfileSchema>;

export interface SmartJobRecommendation {
  jobDescriptionId: string;
  score: number;
  matchedSkills: string[];
  warnings: string[];
  evidence: { field: string; quote: string }[];
  profileHash: string;
}

export interface SmartRecommendationResult {
  version: "smart-upload-v1";
  model: string;
  tokenUsage: number;
  eligibleCount: number;
  rerankedCount: number;
  retrieval: "direct" | "hybrid" | "keyword_fallback";
  recommendations: SmartJobRecommendation[];
}
