import type {
  PublicHumanInterviewMeetingPreview,
  PublicHumanInterviewInterviewerPreview,
  HumanInterviewMeetingTokenResponse,
} from "@arc/shared/studio-pipeline-stages";
import { rpc } from "@/lib/client/rpc";
import { ApiError, rpcFetch } from "@/lib/client/api";

export function fetchCandidateToken(inviteToken: string, headers: Record<string, string>) {
  return rpcFetch<HumanInterviewMeetingTokenResponse>(
    rpc.api.public["human-interview-meetings"][":inviteToken"]["livekit-token"].$post(
      { param: { inviteToken } },
      { headers },
    ),
    "进入会议失败",
  );
}

export function fetchInterviewerToken(inviteToken: string, headers: Record<string, string>) {
  return rpcFetch<HumanInterviewMeetingTokenResponse>(
    rpc.api.public["human-interview-meetings"].interviewer[":inviteToken"]["livekit-token"].$post(
      { param: { inviteToken } },
      { headers },
    ),
    "进入会议失败",
  );
}

export async function endInterviewerMeeting(
  inviteToken: string,
  headers: Record<string, string>,
): Promise<void> {
  await rpcFetch(
    rpc.api.public["human-interview-meetings"].interviewer[":inviteToken"].end.$post(
      { param: { inviteToken } },
      { headers },
    ),
    "结束会议失败",
  );
}

export function fetchMeetingPreview(mode: "candidate" | "interviewer", inviteToken: string) {
  const options = { init: { cache: "no-store" as const } };
  if (mode === "interviewer") {
    return rpcFetch<PublicHumanInterviewInterviewerPreview>(
      rpc.api.public["human-interview-meetings"].interviewer[":inviteToken"].$get(
        { param: { inviteToken } },
        options,
      ),
      "检查入会状态失败，请重试",
    );
  }
  return rpcFetch<PublicHumanInterviewMeetingPreview>(
    rpc.api.public["human-interview-meetings"][":inviteToken"].$get(
      { param: { inviteToken } },
      options,
    ),
    "检查入会状态失败，请重试",
  );
}

export function tokenErrorCode(error: unknown) {
  if (!(error instanceof ApiError)) {
    return "transport_error";
  }
  const { payload } = error;
  return payload &&
    typeof payload === "object" &&
    "code" in payload &&
    typeof payload.code === "string"
    ? payload.code
    : error.status;
}
