import { z } from "zod";

export const ENTRY_CREDENTIAL_REGISTRATION_LIMIT = 2;
export const entryCredentialRegistrationSchema = z.object({
  canCreate: z.boolean(),
  createdCount: z.number().int().nonnegative(),
  limit: z.number().int().positive(),
});
export type EntryCredentialRegistration = z.infer<typeof entryCredentialRegistrationSchema>;
export const entryCredentialLimitErrorSchema = z.object({
  code: z.literal("entry_credential_registration_limit"),
  registration: entryCredentialRegistrationSchema,
});

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
  clientExtensionResults: z
    .object({
      credProps: z.object({ rk: z.boolean().optional() }).catchall(z.json()).optional(),
    })
    .catchall(z.json()),
  id: encoded,
  rawId: encoded,
  type: z.literal("public-key"),
};
export const entryCredentialVerificationSchema = z.discriminatedUnion("kind", [
  z.object({
    challengeId: z.uuid(),
    kind: z.literal("register"),
    response: z
      .object({
        ...credential,
        response: z
          .object({ attestationObject: encoded, clientDataJSON: encoded })
          .catchall(z.json()),
      })
      .catchall(z.json()),
  }),
  z.object({
    challengeId: z.uuid(),
    kind: z.literal("authenticate"),
    response: z
      .object({
        ...credential,
        response: z
          .object({
            authenticatorData: encoded,
            clientDataJSON: encoded,
            signature: encoded,
            userHandle: encoded,
          })
          .catchall(z.json()),
      })
      .catchall(z.json()),
  }),
]);
export type EntryCredentialVerification = z.infer<typeof entryCredentialVerificationSchema>;
