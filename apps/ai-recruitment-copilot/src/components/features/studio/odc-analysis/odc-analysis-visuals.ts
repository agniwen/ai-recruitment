import type { OdcAnalysisMetric } from "@arc/shared/odc-analysis";

export type OdcAnalysisSectionTone = "amber" | "blue" | "green";

export const ODC_ANALYSIS_UNIT_LABEL: Record<OdcAnalysisMetric["unit"], string> = {
  candidate: "人",
  headcount: "HC",
  job: "个岗位",
  offer: "个 Offer",
  round: "个环节",
};

export const ODC_ANALYSIS_TONE_STYLES: Record<
  OdcAnalysisSectionTone,
  { card: string; panel: string; subtle: string }
> = {
  amber: {
    card: "border-amber-200/70 bg-amber-50/55 dark:border-amber-900/60 dark:bg-amber-950/20",
    panel: "border-amber-200/60 bg-amber-50/30 dark:border-amber-900/50 dark:bg-amber-950/10",
    subtle: "border-amber-200/60 bg-amber-100/40 dark:border-amber-900/50 dark:bg-amber-950/30",
  },
  blue: {
    card: "border-blue-200/70 bg-blue-50/55 dark:border-blue-900/60 dark:bg-blue-950/20",
    panel: "border-blue-200/60 bg-blue-50/30 dark:border-blue-900/50 dark:bg-blue-950/10",
    subtle: "border-blue-200/60 bg-blue-100/40 dark:border-blue-900/50 dark:bg-blue-950/30",
  },
  green: {
    card: "border-emerald-200/70 bg-emerald-50/55 dark:border-emerald-900/60 dark:bg-emerald-950/20",
    panel:
      "border-emerald-200/60 bg-emerald-50/30 dark:border-emerald-900/50 dark:bg-emerald-950/10",
    subtle:
      "border-emerald-200/60 bg-emerald-100/40 dark:border-emerald-900/50 dark:bg-emerald-950/30",
  },
};
