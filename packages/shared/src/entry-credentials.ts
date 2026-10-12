import { z } from "zod";

export const candidateEntryCredentialSettingSchema = z.object({
  enabled: z.boolean(),
  reason: z.string().trim().min(1, "请填写调整原因").max(500),
});
export const entryCredentialOptionsSchema = z.object({
  kind: z.enum(["register", "authenticate"]),
});
const encoded = z
  .string()
  .min(1)
  .max(60_000)
  .regex(/^[A-Za-z0-9_-]+$/);
const credential = {
  authenticatorAttachment: z.enum(["platform", "cross-platform"]).optional(),
  clientExtensionResults: z.object({
    credProps: z.object({ rk: z.boolean().optional() }).optional(),
  }),
  id: encoded,
  rawId: encoded,
  type: z.literal("public-key"),
};
export const entryCredentialVerificationSchema = z.discriminatedUnion("kind", [
  z.object({
    challengeId: z.uuid(),
    kind: z.literal("register"),
    response: z.object({
      ...credential,
      response: z.object({ attestationObject: encoded, clientDataJSON: encoded }),
    }),
  }),
  z.object({
    challengeId: z.uuid(),
    kind: z.literal("authenticate"),
    response: z.object({
      ...credential,
      response: z.object({
        authenticatorData: encoded,
        clientDataJSON: encoded,
        signature: encoded,
        userHandle: encoded,
      }),
    }),
  }),
]);
export type EntryCredentialVerification = z.infer<typeof entryCredentialVerificationSchema>;
