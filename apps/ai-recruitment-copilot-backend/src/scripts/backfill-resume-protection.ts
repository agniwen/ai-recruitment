import { readFile } from "node:fs/promises";
import { parseArgs } from "node:util";
import { z } from "zod";
import { loadStandaloneEnv } from "../standalone/env";

const { values } = parseArgs({
  options: {
    apply: { default: false, type: "boolean" },
    input: { type: "string" },
    workspace: { type: "string" },
  },
});
if (!values.input || !values.workspace) {
  throw new Error(
    "用法：tsx src/scripts/backfill-resume-protection.ts --workspace 工作区ID --input 已核实推荐.json [--apply]",
  );
}
const records = z
  .array(
    z.object({
      durationDays: z.number().int().min(1).max(365),
      recommendedAt: z.iso
        .datetime({ offset: true })
        .refine((value) => new Date(value) <= new Date(), "推荐时间不能在未来"),
      recordId: z.string().min(1),
    }),
  )
  .min(1)
  .max(5000)
  .parse(JSON.parse(await readFile(values.input, "utf-8")))
  .toSorted((a, b) => Date.parse(a.recommendedAt) - Date.parse(b.recommendedAt));
if (new Set(records.map((row) => row.recordId)).size !== records.length) {
  throw new Error("补录清单包含重复记录。");
}
const workspaceId = values.workspace;
loadStandaloneEnv();
const { db, closeDatabase } = await import("../lib/server/db/index");
const { importVerifiedResumeProtection } =
  await import("../server/routes/studio/routes/resumes/dao/protection");
const report: { recordId: string; status: string }[] = [];
const dryRunRollback = new Error("dry-run-rollback");
try {
  await db.transaction(async (tx) => {
    for (const record of records) {
      const status = await importVerifiedResumeProtection(tx, {
        ...record,
        organizationId: workspaceId,
        recommendedAt: new Date(record.recommendedAt),
      });
      report.push({ recordId: record.recordId, status });
    }
    if (!values.apply) {
      throw dryRunRollback;
    }
  });
} catch (error) {
  if (error !== dryRunRollback) {
    throw error;
  }
} finally {
  await closeDatabase();
}
console.log(
  JSON.stringify({ applied: values.apply, records: report, workspace: values.workspace }, null, 2),
);
