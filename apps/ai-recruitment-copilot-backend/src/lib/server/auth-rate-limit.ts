// Better Auth's built-in rule allows only 3 sign-in requests per IP every
// 10 seconds. That rejects legitimate bursts behind corporate NATs and also
// prevents the planned 50-user concurrency test. Keep the same short window,
// but allow the expected burst plus a small amount of scheduling headroom.
export const AUTH_RATE_LIMIT = {
  customRules: {
    "/sign-in/email": {
      max: 60,
      window: 10,
    },
  },
} as const;
