import type { serve } from "@hono/node-server";
import { runWithRequestPeerIp } from "../lib/server/request-ip-context";

type NodeFetch = Parameters<typeof serve>[0]["fetch"];

export function createNodeRequestHandler(fetch: NodeFetch): NodeFetch {
  return (request, bindings) =>
    runWithRequestPeerIp(bindings.incoming.socket.remoteAddress, () => fetch(request, bindings));
}
