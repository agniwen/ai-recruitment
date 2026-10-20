import { rpcFetch } from "../rpc-fetch";
import { rpc } from "@/lib/client/rpc";

export function checkHumanInterviewCandidateLock(slug: string, candidateId: string) {
  return rpcFetch<{ lock: { hiringUnitName: string; message: string; unlockAt: string } | null }>(
    rpc.api.w[":slug"].studio.interviews[":id"]["human-interview-lock"].$get({
      param: { id: candidateId, slug },
    }),
    "检查候选人约面状态失败，请重试",
  );
}
