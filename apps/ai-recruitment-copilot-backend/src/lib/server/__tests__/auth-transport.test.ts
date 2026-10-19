import { describe, expect, it } from "vitest";
import { getAuthTransportOptions } from "../auth-transport";

describe("authentication transport", () => {
  it.each([
    "http://10.0.0.1:3001",
    "http://172.16.0.1:3001",
    "http://172.31.255.254:3001",
    "http://192.168.3.97:3001",
    "http://100.64.0.1:3001",
    "http://100.96.37.48:3001",
    "http://100.127.255.254:3001",
    "http://127.0.0.1:3001",
  ])("allows explicitly enabled private HTTP cookies for %s", (baseURL) => {
    expect(
      getAuthTransportOptions({
        baseURL,
        localHttpAuthEnabled: "true",
        nodeEnv: "production",
      }),
    ).toMatchObject({ trustedProxyHeaders: false, useSecureCookies: false });
  });

  it.each([undefined, "", "false", "1", "TRUE"])(
    "keeps private HTTP cookies secure without the exact opt-in %s",
    (localHttpAuthEnabled) => {
      expect(
        getAuthTransportOptions({
          baseURL: "http://100.96.37.48:3001",
          localHttpAuthEnabled,
          nodeEnv: "production",
        }),
      ).toMatchObject({ useSecureCookies: true });
    },
  );

  it.each([
    "http://8.8.8.8:3001",
    "http://100.63.255.254:3001",
    "http://100.128.0.1:3001",
    "http://172.15.255.254:3001",
    "http://172.32.0.1:3001",
    "http://169.254.1.1:3001",
    "http://192.168.3.97.example.com:3001",
    "http://localhost:3001",
    "http://[::1]:3001",
    "http://127.1:3001",
    "http://0x7f000001:3001",
    "http://192.168.3.97@public.example.com:3001",
    "http://user:password@192.168.3.97:3001",
    "not-a-url",
  ])("does not relax production cookies for %s", (baseURL) => {
    expect(
      getAuthTransportOptions({
        baseURL,
        localHttpAuthEnabled: "true",
        nodeEnv: "production",
      }),
    ).toMatchObject({ useSecureCookies: true });
  });

  it("keeps HTTPS proxy and cookie settings intact even with the HTTP opt-in", () => {
    expect(
      getAuthTransportOptions({
        baseURL: "https://sheldon-thinkpad-t430.tail8cca5b.ts.net:8443",
        localHttpAuthEnabled: "true",
        nodeEnv: "production",
      }),
    ).toEqual({
      ipAddress: { ipAddressHeaders: ["cf-connecting-ip"] },
      trustedProxyHeaders: true,
      useSecureCookies: true,
    });
  });

  it("preserves the existing development configuration", () => {
    expect(
      getAuthTransportOptions({
        baseURL: "http://127.0.0.1:3000",
        localHttpAuthEnabled: "true",
        nodeEnv: "development",
      }),
    ).toBeUndefined();
  });
});
