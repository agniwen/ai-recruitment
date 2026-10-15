import type { z } from "zod";
import type {
  createSmartResumeTaskSchema,
  smartResumeTaskDraftSchema,
  SmartResumeTaskDetail,
  SmartResumeTaskSummary,
} from "@arc/shared/smart-resume-upload";
import { rpc } from "@/lib/client/rpc";
import { rpcFetch } from "../rpc-fetch";

const api = rpc.api.w[":slug"].studio["smart-resume-tasks"];

export function listSmartResumeTasks(slug: string) {
  return rpcFetch<{ tasks: SmartResumeTaskSummary[] }>(
    api.$get({ param: { slug } }),
    "加载待提交任务失败",
  );
}

export function createSmartResumeTask(
  slug: string,
  input: z.infer<typeof createSmartResumeTaskSchema>,
) {
  return rpcFetch<{ id: string; queued: boolean }>(
    api.$post({ json: input, param: { slug } }),
    "创建智能上传任务失败",
  );
}

export function getSmartResumeTask(slug: string, id: string) {
  return rpcFetch<SmartResumeTaskDetail>(
    api[":id"].$get({ param: { id, slug } }),
    "加载智能上传任务失败",
  );
}

export function saveSmartResumeTaskDraft(
  slug: string,
  id: string,
  input: z.infer<typeof smartResumeTaskDraftSchema>,
) {
  return rpcFetch(api[":id"].$patch({ json: input, param: { id, slug } }), "保存任务失败");
}

export function submitSmartResumeTask(slug: string, id: string) {
  return rpcFetch<{ recordIds: string[] }>(
    api[":id"].submit.$post({ param: { id, slug } }),
    "提交任务失败",
  );
}

export function retrySmartResumeTask(slug: string, id: string) {
  return rpcFetch(api[":id"].retry.$post({ param: { id, slug } }), "重试任务失败");
}
