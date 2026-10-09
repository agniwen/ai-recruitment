import type {
  InterviewClientEvent,
  InterviewClientEventType,
  InterviewEventDetails,
} from "@arc/shared/interview-telemetry";
import { interviewEventDetailsSchema } from "@arc/shared/interview-telemetry";
import { rpc } from "@/lib/client/rpc";
import { rpcFetch } from "@/lib/client/api";
import { BUILD_TIME } from "@/lib/client/build-info";

export interface BrowserNetwork extends EventTarget {
  type?: string;
  effectiveType?: string;
  downlink?: number;
  rtt?: number;
  saveData?: boolean;
}

export function readNetwork(): InterviewEventDetails {
  const { connection } = navigator as Navigator & { connection?: BrowserNetwork };
  return {
    downlinkMbps: connection?.downlink,
    effectiveType: connection?.effectiveType,
    estimatedRttMs: connection?.rtt,
    networkType: connection?.type,
    online: navigator.onLine,
    saveData: connection?.saveData,
  };
}

function browserId() {
  try {
    const key = "arc-interview-browser-id";
    const saved = localStorage.getItem(key);
    if (saved && /^[\da-f]{8}(-[\da-f]{4}){3}-[\da-f]{12}$/i.test(saved)) {
      return saved;
    }
    const id = crypto.randomUUID();
    localStorage.setItem(key, id);
    return id;
  } catch {
    // Storage can be unavailable in private browsing; the page IDs still work.
  }
}

export type TelemetrySender = (
  events: InterviewClientEvent[],
  keepalive: boolean,
) => Promise<unknown>;

export function createTelemetryClient(
  mode: "candidate" | "interviewer",
  inviteToken: string,
  sender?: TelemetrySender,
) {
  // Fresh per page instance (not sessionStorage, which is cloned when duplicating a tab).
  const trace = {
    attemptId: undefined as string | undefined,
    tabId: crypto.randomUUID(),
    visitId: crypto.randomUUID(),
  };
  let room: { roomSid?: string; participantSid?: string } = {};
  let queue: InterviewClientEvent[] = [];
  let pending = false;
  let keepalivePending = 0;
  let disposed = false;
  let droppedEvents = 0;
  let clientSequence = 0;
  const send: TelemetrySender =
    sender ??
    ((events, keepalive) =>
      rpcFetch(
        rpc.api.public["interview-telemetry"].$post(
          { json: { events, mode } },
          {
            headers: { Authorization: `Bearer ${inviteToken}` },
            init: { keepalive, signal: AbortSignal.timeout(5000) },
          },
        ),
        "面试日志暂时无法上报",
      ));

  async function flush(keepalive = false): Promise<void> {
    if (!queue.length || (keepalive ? keepalivePending >= 4 : pending)) {
      return;
    }
    // Exit evidence must not wait behind a normal request that the browser may abort.
    if (keepalive) {
      keepalivePending += 1;
    } else {
      pending = true;
    }
    const batch: InterviewClientEvent[] = [];
    const encoder = new TextEncoder();
    while (queue.length && batch.length < 20) {
      const next = keepalive ? queue.at(-1) : queue[0];
      if (!next || encoder.encode(JSON.stringify([...batch, next])).byteLength > 12_000) {
        break;
      }
      if (keepalive) {
        queue.pop();
        batch.unshift(next);
      } else {
        queue.shift();
        batch.push(next);
      }
    }
    try {
      await send(batch, keepalive);
    } catch {
      const retry = [...batch, ...queue];
      droppedEvents += Math.max(0, retry.length - 200);
      queue = retry.slice(-200);
    } finally {
      if (keepalive) {
        keepalivePending -= 1;
      } else {
        pending = false;
      }
    }
  }

  function emit(type: InterviewClientEventType, details: InterviewEventDetails = {}) {
    if (disposed) {
      return;
    }
    const parsed = interviewEventDetailsSchema.safeParse(details);
    if (!parsed.success) {
      return;
    }
    if (queue.length >= 200) {
      queue.shift();
      droppedEvents += 1;
    }
    clientSequence += 1;
    queue.push({
      clientSequence,
      id: crypto.randomUUID(),
      ...trace,
      ...room,
      details: { ...parsed.data, droppedEvents },
      occurredAt: new Date().toISOString(),
      type,
    });
  }

  const interval = window.setInterval(() => {
    void flush();
  }, 3000);
  const heartbeat = window.setInterval(() => {
    emit("heartbeat", readNetwork());
  }, 30_000);
  return {
    dispose() {
      emit("component_unmounted", { reason: "meeting_page_unmounted" });
      disposed = true;
      clearInterval(interval);
      clearInterval(heartbeat);
      void flush(true);
    },
    emit,
    flush,
    headers() {
      return {
        "x-interview-tab-id": trace.tabId,
        "x-interview-visit-id": trace.visitId,
        ...(trace.attemptId ? { "x-interview-attempt-id": trace.attemptId } : {}),
      };
    },
    opened() {
      emit("page_opened", { ...readNetwork(), browserId: browserId(), release: BUILD_TIME });
      void flush();
    },
    setRoom(value: typeof room) {
      room = value;
    },
    startAttempt() {
      trace.attemptId = crypto.randomUUID();
      room = {};
      emit("join_requested");
      void flush();
    },
    trace,
  };
}

export type TelemetryClient = ReturnType<typeof createTelemetryClient>;
