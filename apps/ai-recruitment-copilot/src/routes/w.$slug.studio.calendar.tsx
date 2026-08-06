import { createFileRoute, useParams } from "@tanstack/react-router";
import { StudioCalendarPage } from "@/components/features/studio/calendar/studio-calendar-page";
import { formatDocumentTitle } from "@/lib/start/document-title";

function StudioCalendarRoute() {
  const { slug } = useParams({ from: "/w/$slug/studio/calendar" });
  return <StudioCalendarPage slug={slug} />;
}

export const Route = createFileRoute("/w/$slug/studio/calendar")({
  head: () => ({
    meta: [{ title: formatDocumentTitle("面试日程") }],
  }),
  component: StudioCalendarRoute,
});
