import { z } from "zod";

export const webRtcServers = {
  bilibili: "stun:stun.chat.bilibili.com:3478",
  hitv: "stun:stun.hitv.com:3478",
} as const;
export type WebRtcServer = keyof typeof webRtcServers;
export const webRtcServerLabels: Record<WebRtcServer, string> = {
  bilibili: "Bilibili",
  hitv: "HiTV",
};
const ipv4 = z.ipv4();
const ipv6 = z.ipv6();

function ipv4Number(value: string) {
  return value.split(".").reduce((total, part) => total * 256 + Number(part), 0);
}
const nonPublicIpv4Ranges = [
  "0.0.0.0/8",
  "10.0.0.0/8",
  "100.64.0.0/10",
  "127.0.0.0/8",
  "169.254.0.0/16",
  "172.16.0.0/12",
  "192.0.0.0/24",
  "192.0.2.0/24",
  "192.88.99.0/24",
  "192.168.0.0/16",
  "198.18.0.0/15",
  "198.51.100.0/24",
  "203.0.113.0/24",
  "224.0.0.0/3",
].map((range) => {
  const [network, prefix] = range.split("/");
  const start = ipv4Number(network);
  return [start, start + 2 ** (32 - Number(prefix)) - 1];
});

// Deliberately exclude private, special-purpose and documentation ranges.
export function normalizeWebRtcAddress(value: string): string | null {
  if (ipv4.safeParse(value).success) {
    const address = ipv4Number(value);
    return nonPublicIpv4Ranges.some(([start, end]) => address >= start && address <= end)
      ? null
      : value;
  }
  if (!ipv6.safeParse(value).success) {
    return null;
  }
  const normalized = new URL(`http://[${value}]/`).hostname.slice(1, -1);
  const [first, second] = normalized.split(":");
  // Currently allocated global unicast space, excluding special-use 2001 ranges.
  if (
    !/^[23][\da-f]{3}$/.test(first) ||
    (first === "2001" && (Number.parseInt(second || "0", 16) < 512 || second === "db8")) ||
    first === "3fff"
  ) {
    return null;
  }
  return normalized;
}

export const webRtcAddressSchema = z
  .string()
  .max(45)
  .refine((value) => normalizeWebRtcAddress(value) !== null, "WebRTC 地址必须为公网 IP");
