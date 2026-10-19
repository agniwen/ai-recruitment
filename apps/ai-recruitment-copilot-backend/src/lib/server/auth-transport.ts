interface AuthTransportInput {
  baseURL: string;
  localHttpAuthEnabled?: string;
  nodeEnv?: string;
}

function isPrivateHttpOrigin(baseURL: string): boolean {
  try {
    const url = new URL(baseURL);
    const literalHost = /^http:\/\/(\d{1,3}(?:\.\d{1,3}){3})(?::\d+)?(?:\/|$)/u.exec(baseURL)?.[1];
    if (url.protocol !== "http:" || url.username || url.password || literalHost !== url.hostname) {
      return false;
    }
    const [first, second] = url.hostname.split(".").map(Number);
    return (
      first === 10 ||
      first === 127 ||
      (first === 172 && second >= 16 && second <= 31) ||
      (first === 192 && second === 168) ||
      (first === 100 && second >= 64 && second <= 127)
    );
  } catch {
    return false;
  }
}

export function getAuthTransportOptions({
  baseURL,
  localHttpAuthEnabled,
  nodeEnv,
}: AuthTransportInput) {
  if (nodeEnv !== "production") {
    return;
  }
  // This opt-in belongs only to the separate private-IP debug deployment.
  // Keep HTTPS and every unrecognized/public origin on secure cookies.
  const privateHttp = localHttpAuthEnabled === "true" && isPrivateHttpOrigin(baseURL);
  return {
    ipAddress: { ipAddressHeaders: ["cf-connecting-ip"] },
    trustedProxyHeaders: !privateHttp,
    useSecureCookies: !privateHttp,
  };
}
