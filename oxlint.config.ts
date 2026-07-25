import { defineConfig } from "oxlint";

import core from "ultracite/oxlint/core";
import next from "ultracite/oxlint/next";
import react from "ultracite/oxlint/react";

export default defineConfig({
  extends: [core, react, next],
  ignorePatterns: [
    "**/src/components/agents-ui/**",
    "**/src/hooks/agents-ui/**",
    "**/src/components/ui/**",
    "**/src/components/react-bits/**",
    "**/src/components/reui/**",
    "**/src/components/spell-ui/**",
    "apps/ai-recruitment-copilot/src/routeTree.gen.ts",
    "apps/ai-recruitment-copilot-worker/dist/**",
  ],
  overrides: [
    {
      files: ["packages/db-schema/src/schema.ts"],
      rules: {
        "max-lines": "off",
      },
    },
    {
      files: [
        "packages/adapter-feishu/src/index.ts",
        "apps/ai-recruitment-copilot-backend/src/server/routes/studio/routes/job-descriptions/dao.ts",
        "apps/ai-recruitment-copilot-backend/src/server/routes/studio/routes/resume-pool/__tests__/dao.test.ts",
        "apps/ai-recruitment-copilot-backend/src/server/routes/studio/routes/resumes/dao/resumes.ts",
        "apps/ai-recruitment-copilot/src/components/features/studio/studio-person-edit-dialog.tsx",
      ],
      rules: {
        "max-lines": "off",
      },
    },
    {
      files: ["apps/ai-recruitment-copilot/src/routes/**/*.{ts,tsx}"],
      rules: {
        "nextjs/no-head-element": "off",
      },
    },
    {
      files: ["apps/ai-recruitment-copilot/src/app/_components/home/footer.tsx"],
      rules: {
        "nextjs/no-html-link-for-pages": "off",
      },
    },
  ],
  rules: {
    "func-style": "off",
    "max-lines": [
      "error",
      {
        max: 800,
        skipBlankLines: false,
        skipComments: false,
      },
    ],
  },
});
