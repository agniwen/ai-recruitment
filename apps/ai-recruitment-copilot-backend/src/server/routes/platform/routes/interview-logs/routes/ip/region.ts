import IP2Region from "ip2region";
import { normalizeWebRtcAddress } from "@arc/shared/interview-webrtc";

let database: IP2Region | undefined;

export function lookupIpRegion(ip: string): string | null {
  const address = normalizeWebRtcAddress(ip);
  if (!address) {
    return null;
  }
  try {
    if (!database) {
      // Native Node keeps this CommonJS package's nested default; Vite unwraps it.
      const Searcher = ("default" in IP2Region ? IP2Region.default : IP2Region) as typeof IP2Region;
      database = new Searcher();
    }
    const result = database.search(address);
    if (!result) {
      return null;
    }
    const places = [result.country, result.province, result.city]
      .map((part) => part.trim())
      .filter((part) => part && part !== "0" && part !== "未知");
    if (!places.length) {
      return null;
    }
    return [...new Set([...places, result.isp.trim()].filter(Boolean))].join(" · ");
  } catch {
    // A missing database or lookup failure must not prevent viewing the IP itself.
    return null;
  }
}
