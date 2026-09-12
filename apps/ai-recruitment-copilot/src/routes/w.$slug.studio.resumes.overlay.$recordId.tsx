import { createFileRoute, getRouteApi, useRouter } from "@tanstack/react-router";
import { useCallback } from "react";
import {
  RecruiterResumeDetailPage,
  RecruiterResumeDetailSkeleton,
} from "@/components/features/studio/resumes/recruiter-resume-detail-page";
import {
  coerceSearchParams,
  listSearchFromDetailSearch,
} from "@/components/features/studio/resumes/recruiter-resume-detail-search";
import { formatDocumentTitle } from "@/lib/start/document-title";
import { StudioContentRouteOverlay } from "@/components/features/studio/studio-content-route-overlay";

const routeApi = getRouteApi("/w/$slug/studio/resumes/overlay/$recordId");

function ResumeDetailRoute() {
  const { recordId, slug } = routeApi.useParams();
  const routeSearch = routeApi.useSearch();
  const navigate = routeApi.useNavigate();
  const router = useRouter();
  const onBack = useCallback(() => {
    if (router.state.location.state.fromRecruiterResumeList && router.history.canGoBack()) {
      router.history.back();
      return;
    }
    void navigate({
      params: { slug },
      search: listSearchFromDetailSearch(routeSearch),
      to: "/w/$slug/studio/resumes",
      resetScroll: false,
    });
  }, [navigate, routeSearch, router, slug]);

  return (
    <StudioContentRouteOverlay>
      <RecruiterResumeDetailPage onBack={onBack} recordId={recordId} routeSearch={routeSearch} />
    </StudioContentRouteOverlay>
  );
}

function ResumeDetailPending() {
  return (
    <StudioContentRouteOverlay>
      <RecruiterResumeDetailSkeleton />
    </StudioContentRouteOverlay>
  );
}

export const Route = createFileRoute("/w/$slug/studio/resumes/overlay/$recordId")({
  validateSearch: coerceSearchParams,
  head: () => ({ meta: [{ title: formatDocumentTitle("候选人详情") }] }),
  component: ResumeDetailRoute,
  pendingComponent: ResumeDetailPending,
});
