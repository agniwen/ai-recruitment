import { RESUME_POOL_PAGE_ENABLED } from "@arc/shared/permissions";
import { createFileRoute, notFound } from "@tanstack/react-router";
import { redirectToActiveWorkspace } from "@/lib/start/workspace-redirect";

function LegacyStudioResumePoolRoute() {
  return null;
}

export const Route = createFileRoute("/studio/resume-pool")({
  // 暂时隐藏页面，保留实现；恢复时开启 RESUME_POOL_PAGE_ENABLED。
  beforeLoad: () => {
    if (!RESUME_POOL_PAGE_ENABLED) {
      throw notFound();
    }
  },
  component: LegacyStudioResumePoolRoute,
  loader: async () =>
    await redirectToActiveWorkspace({
      callbackPath: "/studio/resume-pool",
      getDestination: (slug) => `/w/${slug}/studio/resume-pool`,
    }),
});
