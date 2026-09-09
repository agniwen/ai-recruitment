import { describe, expect, it } from "vitest";
import { canManagePoolRecord } from "../resume-pool-page-model";
describe("administrator pool actions", () => {
  const record = { createdBy: "uploader", scope: "private" as const };
  it.each(["admin", "owner"])("allows %s to manage another uploader's private resume", (role) => {
    expect(canManagePoolRecord(record, "reviewer", role)).toBe(true);
  });
  it.each(["member", "custom", "noAccess", null])(
    "keeps non-admin %s restricted to their own private resumes",
    (role) => {
      expect(canManagePoolRecord(record, "reviewer", role)).toBe(false);
      expect(canManagePoolRecord(record, "uploader", role)).toBe(true);
    },
  );
  it("does not enable actions for missing records", () => {
    expect(canManagePoolRecord(null, "admin", "admin")).toBe(false);
  });
});
