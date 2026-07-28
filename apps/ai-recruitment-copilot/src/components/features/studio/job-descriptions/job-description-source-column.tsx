"use client";

import type { JobDescriptionListRecord } from "@arc/shared/job-descriptions";
import { customColumn } from "@/components/data-grid";
import { Badge } from "@/components/ui/badge";

export const jobDescriptionSourceColumn = customColumn<JobDescriptionListRecord>({
  cell: (record) => (
    <Badge variant={record.creationSource === "google_sheets" ? "secondary" : "outline"}>
      {record.creationSource === "google_sheets" ? "Google 文档" : "手动创建"}
    </Badge>
  ),
  key: "creationSource",
  size: 120,
  title: "来源",
});
