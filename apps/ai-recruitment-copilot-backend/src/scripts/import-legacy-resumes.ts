import { parseArgs } from "node:util";
import { closeDatabase } from "@arc/ai-recruitment-copilot-backend/lib/server/db";
import { importLegacyResumes } from "@arc/ai-recruitment-copilot-backend/server/routes/studio/routes/resume-upload-batches/utils/legacy-import";
import { closeResumeParseQueue } from "@arc/resume-parse-queue/resume-parse";
import { loadStandaloneEnv } from "../standalone/env";

async function main() {
  const { values } = parseArgs({
    options: {
      commit: { default: false, type: "boolean" },
      "user-email": { type: "string" },
      workspace: { type: "string" },
    },
    strict: true,
  });
  loadStandaloneEnv();
  if (values.commit && process.env.ENABLE_LEGACY_PARSE?.trim().toLowerCase() !== "true") {
    throw new Error("ENABLE_LEGACY_PARSE 必须设置为 true 才能创建历史简历任务。");
  }
  if (!(values.workspace && values["user-email"])) {
    throw new Error("必须提供 --workspace 和 --user-email。");
  }
  const result = await importLegacyResumes({
    commit: values.commit,
    uploaderEmail: values["user-email"],
    workspaceSlug: values.workspace,
  });
  console.info("[legacy-resume-import] discovery", result);
  if (!values.commit) {
    console.info("[legacy-resume-import] dry run only; add --commit to create jobs");
  }
}

try {
  await main();
} finally {
  await closeResumeParseQueue();
  await closeDatabase();
}
