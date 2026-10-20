import type { IncomingMessage, ServerResponse } from "node:http";
import { isIP } from "node:net";

export function getWebRequestPeerIp(request: Request) {
  // The Vite boundary captures the original peer before Nitro's worker hop.
  const developmentPeer =
    process.env.NODE_ENV === "development" ? request.headers.get("x-arc-dev-peer-ip") : null;
  if (developmentPeer && isIP(developmentPeer)) {
    return developmentPeer;
  }
  // Nitro/srvx exposes the underlying connection IP on its ServerRequest.
  if ("ip" in request && typeof request.ip === "string" && isIP(request.ip)) {
    return request.ip;
  }
}

// Preserve the browser's peer across Nitro's development worker transport.
// Always overwrite this private header so a client cannot supply the fallback.
export function captureDevRequestIp(
  request: IncomingMessage,
  _response: ServerResponse,
  next: () => void,
) {
  delete request.headers["x-arc-dev-peer-ip"];
  const ip = request.socket.remoteAddress;
  if (ip && isIP(ip)) {
    request.headers["x-arc-dev-peer-ip"] = ip;
  }
  next();
}
