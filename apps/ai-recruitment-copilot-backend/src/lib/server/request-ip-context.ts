import { AsyncLocalStorage } from "node:async_hooks";
import { isIP } from "node:net";

const peerIpStore = new AsyncLocalStorage<string | undefined>();

// oxlint-disable-next-line promise/prefer-await-to-callbacks -- Scope the transport value across asynchronous request handling.
export function runWithRequestPeerIp<T>(ip: string | undefined, callback: () => T): T {
  return peerIpStore.run(ip && isIP(ip) ? ip : undefined, callback);
}

export function getRequestPeerIp() {
  return peerIpStore.getStore();
}
