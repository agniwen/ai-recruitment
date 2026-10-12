// Synthetic authenticator for exercising the real WebAuthn verifier; never used by production.
import { createHash, generateKeyPairSync, randomBytes, sign } from "node:crypto";
import { isoCBOR } from "@simplewebauthn/server/helpers";

const hash = (value: string | Buffer) => createHash("sha256").update(value).digest();
function clientData(type: string, challenge: string, origin: string) {
  return Buffer.from(JSON.stringify({ challenge, crossOrigin: false, origin, type }));
}
export function testAuthenticator(backupEligible = true) {
  const { publicKey, privateKey } = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
  const key = publicKey.export({ format: "jwk" });
  const credentialId = randomBytes(32);
  const cose = isoCBOR.encode(
    new Map<number, number | Uint8Array>([
      [1, 2],
      [3, -7],
      [-1, 1],
      [-2, Buffer.from(key.x ?? "", "base64url")],
      [-3, Buffer.from(key.y ?? "", "base64url")],
    ]),
  );
  const base = {
    clientExtensionResults: { credProps: { rk: true } },
    id: credentialId.toString("base64url"),
    rawId: credentialId.toString("base64url"),
    type: "public-key" as const,
  };
  function authData(rpId: string, counter: number, registration = false) {
    const count = Buffer.alloc(4);
    count.writeUInt32BE(counter);
    const flags = 0x05 + (backupEligible ? 0x18 : 0) + (registration ? 0x40 : 0);
    const prefix = Buffer.concat([hash(rpId), Buffer.from([flags]), count]);
    const length = Buffer.alloc(2);
    length.writeUInt16BE(credentialId.length);
    return registration
      ? Buffer.concat([prefix, Buffer.alloc(16), length, credentialId, cose])
      : prefix;
  }
  return {
    authenticate(
      challenge: string,
      userHandle: string,
      counter = 0,
      origin = "https://interview.example.test",
      rpId = "interview.example.test",
    ) {
      const data = clientData("webauthn.get", challenge, origin);
      const authenticatorData = authData(rpId, counter);
      return {
        ...base,
        response: {
          authenticatorData: authenticatorData.toString("base64url"),
          clientDataJSON: data.toString("base64url"),
          signature: sign(
            "sha256",
            Buffer.concat([authenticatorData, hash(data)]),
            privateKey,
          ).toString("base64url"),
          userHandle,
        },
      };
    },
    register(
      challenge: string,
      origin = "https://interview.example.test",
      rpId = "interview.example.test",
    ) {
      const attestation = isoCBOR.encode(
        new Map<string, string | Uint8Array | Map<string, string>>([
          ["fmt", "none"],
          ["attStmt", new Map()],
          ["authData", authData(rpId, 0, true)],
        ]),
      );
      return {
        ...base,
        response: {
          attestationObject: Buffer.from(attestation).toString("base64url"),
          clientDataJSON: clientData("webauthn.create", challenge, origin).toString("base64url"),
        },
      };
    },
  };
}
