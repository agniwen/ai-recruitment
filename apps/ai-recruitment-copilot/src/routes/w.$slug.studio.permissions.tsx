import { createFileRoute } from "@tanstack/react-router";
import { PageHeader } from "@/components/features/studio/page-header";
import { WorkspacePermissionsSection } from "@/components/features/studio/members/workspace-permissions-section";
import { PermissionsPageSkeleton } from "@/components/features/studio/studio-page-skeletons";
import { formatDocumentTitle } from "@/lib/start/document-title";

function StudioPermissionsRoute() {
  return (
    <div className="mx-auto w-full max-w-[96rem]">
      <WorkspacePermissionsSection
        headerRender={({ actionRender }) => (
          <PageHeader
            actionRender={actionRender}
            description="设置不同角色可访问的页面和可执行的操作。"
            title="角色与权限"
          />
        )}
      />
    </div>
  );
}

export const Route = createFileRoute("/w/$slug/studio/permissions")({
  component: StudioPermissionsRoute,
  head: () => ({
    meta: [{ title: formatDocumentTitle("角色与权限") }],
  }),
  pendingComponent: PermissionsPageSkeleton,
});
