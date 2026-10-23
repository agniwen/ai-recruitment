import type { ResumeProtectionIdentity } from "@arc/db-schema/resume-protection";

export function normalizeProtectionIdentity(
  input: ResumeProtectionIdentity,
): ResumeProtectionIdentity {
  const rawPhone = input.phone?.replaceAll(/[^\d+]/g, "").replace(/^00/, "+") || null;
  const phone = rawPhone?.replace(/^\+?86(?=1\d{10}$)/, "") || null;
  const email = input.email?.trim().toLowerCase() || null;
  return {
    contentHash: input.contentHash?.trim() || null,
    email: email && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : null,
    name: input.name?.normalize("NFKC").replaceAll(/\s+/g, "").toLowerCase() || null,
    phone: phone && /^\+?\d{7,15}$/.test(phone) ? phone : null,
  };
}

// Semantic resemblance is a duplicate warning, never proof of identity.
export function protectionIdentityMatch(
  a: ResumeProtectionIdentity,
  b: ResumeProtectionIdentity,
): string | null {
  if (a.contentHash && a.contentHash === b.contentHash) {
    return "简历文件内容一致";
  }
  if (!a.name || a.name !== b.name) {
    return null;
  }
  if ((a.email && b.email && a.email !== b.email) || (a.phone && b.phone && a.phone !== b.phone)) {
    return null;
  }
  if (a.phone && a.phone === b.phone) {
    return "姓名及手机号一致";
  }
  return a.email && a.email === b.email ? "姓名及邮箱一致" : null;
}
