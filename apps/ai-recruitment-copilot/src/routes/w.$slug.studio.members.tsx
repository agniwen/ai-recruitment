import { createFileRoute } from "@tanstack/react-router";

import { MembersManagementPage } from "@/components/features/studio/members/members-page";
import { coerceWorkspaceManagementSearch } from "@/components/features/studio/members/members-page-model";
import { MembersPageSkeleton } from "@/components/features/studio/studio-page-skeletons";
import { formatDocumentTitle } from "@/lib/start/document-title";

export const Route = createFileRoute("/w/$slug/studio/members")({
  validateSearch: (search: Record<string, unknown>) => coerceWorkspaceManagementSearch(search),
  head: () => ({
    meta: [{ title: formatDocumentTitle("成员与招聘组") }],
  }),
  component: MembersManagementPage,
  pendingComponent: MembersPageSkeleton,
});
