import type { ExternalInterviewerInput } from "@arc/db-schema/studio-interviews";
import type { ExternalInterviewerBindingStatus } from "@arc/shared/external-interviewers";
import { rpc } from "@/lib/client/rpc";
import { rpcFetch } from "../rpc-fetch";

export function getExternalInterviewerDefaults(slug: string, candidateId: string) {
  return rpcFetch<ExternalInterviewerInput[]>(
    rpc.api.w[":slug"].studio.interviews["human-interview-meetings"]["external-interviewers"].$get({
      param: { slug },
      query: { candidateId },
    }),
    "加载需求发起人失败",
  );
}
export function checkExternalInterviewerBindings(
  slug: string,
  interviewers: ExternalInterviewerInput[],
) {
  return rpcFetch<ExternalInterviewerBindingStatus[]>(
    rpc.api.w[":slug"].studio.interviews["human-interview-meetings"][
      "external-interviewers"
    ].check.$post({ json: { interviewers }, param: { slug } }),
    "检查外部面试官 TG 绑定失败",
  );
}
