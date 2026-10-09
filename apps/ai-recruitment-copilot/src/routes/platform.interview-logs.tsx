import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { InterviewLogsPage } from "@/components/features/platform/interview-logs/interview-logs-page";
import { formatDocumentTitle } from "@/lib/start/document-title";

export const Route = createFileRoute("/platform/interview-logs")({
  validateSearch: z.object({ meetingId: z.string().max(100).optional() }),
  component: InterviewLogsPage,
  head: () => ({ meta: [{ title: formatDocumentTitle("平台 · 面试日志") }] }),
});
