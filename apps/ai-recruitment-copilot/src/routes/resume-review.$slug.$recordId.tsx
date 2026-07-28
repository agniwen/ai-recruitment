import { useQuery } from "@tanstack/react-query";
import {
  createFileRoute,
  notFound,
  redirect,
  useLoaderData,
  useParams,
} from "@tanstack/react-router";
import { StudioPersonDetailPanel } from "@/components/features/studio/studio-person-detail-panel";
import { ResumeReviewEvaluationBar } from "@/components/features/studio/resumes/resume-evaluation-dialog";
import { fetchStudioResumeReview } from "@/lib/client/api";
import { WorkspaceSlugProvider, useWorkspaceSlug } from "@/lib/client/workspace-context";
import { getResumeReviewAccessState } from "@/lib/start/auth-session";
import { formatDocumentTitle } from "@/lib/start/document-title";

const RESUME_REVIEW_WORKSPACE_PERMISSIONS = {};

function resumeReviewDetailQueryKey(slug: string, recordId: string) {
  return ["studio-resumes", slug, "detail", recordId, "review"] as const;
}

function ResumeReviewDetailContent({ recordId }: { recordId: string }) {
  const slug = useWorkspaceSlug();
  const detailQuery = useQuery({
    queryFn: () => fetchStudioResumeReview(slug, recordId),
    queryKey: resumeReviewDetailQueryKey(slug, recordId),
    staleTime: 30_000,
  });
  const detail = detailQuery.data ?? null;

  return (
    <>
      <main className="mx-auto flex w-full max-w-[96rem] flex-col px-4 pt-5 pb-[calc(7rem+env(safe-area-inset-bottom))] sm:px-6 lg:px-8">
        <StudioPersonDetailPanel
          accessMode="review"
          layoutMode="page"
          mode="resume"
          recordId={recordId}
          shell={({ body, title }) => (
            <div className="flex flex-col gap-4">
              <header className="border-b pb-4">
                <h1 className="font-semibold text-xl tracking-normal">{title}</h1>
              </header>
              <div>{body}</div>
            </div>
          )}
        />
      </main>

      <ResumeReviewEvaluationBar
        hasJobDescription={Boolean(detail?.jobDescriptionId)}
        isLoading={detailQuery.isLoading}
        recordId={recordId}
        status={detail?.resumeEvaluationStatus}
      />
    </>
  );
}

function ResumeReviewDetailPage() {
  const state = useLoaderData({ from: "/resume-review/$slug/$recordId" });
  const { recordId } = useParams({ from: "/resume-review/$slug/$recordId" });

  if (state.status !== "ready") {
    return null;
  }

  return (
    <WorkspaceSlugProvider
      id={state.workspace.id}
      memberRole={state.member.role}
      permissions={RESUME_REVIEW_WORKSPACE_PERMISSIONS}
      refreshPermissions={false}
      slug={state.workspace.slug}
    >
      <ResumeReviewDetailContent recordId={recordId} />
    </WorkspaceSlugProvider>
  );
}

export const Route = createFileRoute("/resume-review/$slug/$recordId")({
  loader: async (loaderContext) => {
    const { location, params } = loaderContext as unknown as {
      location: { pathname: string };
      params: { recordId: string; slug: string };
    };
    const state = await getResumeReviewAccessState({ data: { slug: params.slug } });
    if (state.status === "unauthenticated") {
      throw redirect({
        href: `/login?callbackURL=${encodeURIComponent(location.pathname)}`,
      });
    }
    if (state.status === "not_found") {
      throw notFound();
    }
    return state;
  },
  head: () => ({
    meta: [{ title: formatDocumentTitle("简历评估") }],
  }),
  component: ResumeReviewDetailPage,
});
