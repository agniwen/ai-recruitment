"use client";

import type { JobDescriptionListRecord } from "@arc/shared/job-descriptions";
import { isJobDescriptionInactive } from "@arc/shared/job-descriptions";
import { customColumn } from "@/components/data-grid";
import { Badge } from "@/components/ui/badge";

export const jobDescriptionValidityColumn = customColumn<JobDescriptionListRecord>({
  cell: (record) => (
    <Badge variant={isJobDescriptionInactive(record) ? "danger" : "secondary"}>
      {isJobDescriptionInactive(record) ? "已失效" : "有效"}
    </Badge>
  ),
  key: "manuallyInactive",
  size: 100,
  title: "是否失效",
});
