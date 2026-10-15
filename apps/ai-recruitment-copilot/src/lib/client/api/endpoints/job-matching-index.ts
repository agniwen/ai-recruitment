import type { JobMatchingIndexStatus } from "@arc/shared/job-matching-index";
import { rpc } from "@/lib/client/rpc";
import { rpcFetch } from "../rpc-fetch";

const endpoint = rpc.api.w[":slug"].studio["job-descriptions"]["matching-index"];

export function getJobMatchingIndexStatus(slug: string) {
  return rpcFetch<JobMatchingIndexStatus>(
    endpoint.$get({ param: { slug } }),
    "加载岗位向量状态失败",
  );
}

export function rebuildJobMatchingIndex(slug: string) {
  return rpcFetch<{ queued: number }>(
    endpoint.rebuild.$post({ param: { slug } }),
    "岗位向量任务未能入队",
  );
}
