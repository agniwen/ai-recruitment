import type { InterviewEventDetails } from "@arc/shared/interview-telemetry";

function recordTransport(
  row: Record<string, unknown>,
  stats: Map<string, Record<string, unknown>>,
  result: InterviewEventDetails,
) {
  if (
    row.type === "candidate-pair" &&
    row.state === "succeeded" &&
    (row.nominated || row.selected)
  ) {
    if (typeof row.currentRoundTripTime === "number") {
      result.rttMs = row.currentRoundTripTime * 1000;
    }
    result.candidatePairId = String(row.id).slice(0, 200);
    const local = stats.get(String(row.localCandidateId));
    const remote = stats.get(String(row.remoteCandidateId));
    if (typeof local?.protocol === "string") {
      result.protocol = local.protocol;
    }
    if (typeof local?.candidateType === "string") {
      result.localCandidateType = local.candidateType;
    }
    if (typeof remote?.candidateType === "string") {
      result.remoteCandidateType = remote.candidateType;
    }
  }
}

export function summarizeRtcStats(reports: RTCStatsReport[]): InterviewEventDetails {
  const stats = new Map<string, Record<string, unknown>>();
  for (const report of reports) {
    for (const row of report.values()) {
      stats.set(row.id, row);
    }
  }
  const result: InterviewEventDetails = { sampleAvailable: stats.size > 0 };
  const add = (
    key: "bytesSent" | "bytesReceived" | "packetsLost" | "packetsReceived",
    value: unknown,
  ) => {
    if (typeof value === "number" && Number.isFinite(value)) {
      result[key] = (result[key] ?? 0) + Math.max(0, value);
    }
  };
  for (const row of stats.values()) {
    if (row.type === "outbound-rtp" && !row.isRemote) {
      add("bytesSent", row.bytesSent);
    }
    if (row.type === "inbound-rtp" && !row.isRemote) {
      add("bytesReceived", row.bytesReceived);
      add("packetsLost", row.packetsLost);
      add("packetsReceived", row.packetsReceived);
      if (typeof row.jitter === "number") {
        result.jitterMs = Math.max(result.jitterMs ?? 0, row.jitter * 1000);
      }
    }
    recordTransport(row, stats, result);
  }

  return result;
}
