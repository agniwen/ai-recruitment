import { describe, expect, it } from "vitest";
import type { ResumeProfile } from "@arc/db-schema/interview/types";
import { syncResumeProfileIdentity } from "@arc/ai-recruitment-copilot-backend/server/routes/studio/routes/resumes/utils/profile-sync";

const baseProfile: ResumeProfile = {
  age: null,
  email: "old@example.com",
  gender: null,
  name: "旧姓名",
  personalStrengths: [],
  phone: "13800000000",
  projectExperiences: [],
  schools: [],
  skills: ["React"],
  targetRoles: ["前端工程师", "全栈工程师"],
  workExperiences: [],
  workYears: null,
};

describe("syncResumeProfileIdentity", () => {
  it("syncs edited identity fields into resumeProfile", () => {
    const synced = syncResumeProfileIdentity(baseProfile, {
      age: 31,
      candidateEmail: " new@example.com ",
      candidateName: " 新姓名 ",
      candidatePhone: " 13900000000 ",
      gender: " 女 ",
      targetRole: " 后端工程师 ",
      workYears: 8.5,
    });

    expect(synced).toMatchObject({
      age: 31,
      email: "new@example.com",
      gender: "女",
      name: "新姓名",
      phone: "13900000000",
      targetRoles: ["后端工程师"],
      workYears: 8.5,
    });
    expect(synced?.skills).toEqual(["React"]);
  });

  it("preserves required profile fields when editable values are blank", () => {
    const synced = syncResumeProfileIdentity(
      { ...baseProfile, gender: "男" },
      {
        candidateEmail: "",
        candidateName: "",
        candidatePhone: "",
        gender: "",
        targetRole: "",
      },
    );

    expect(synced).toMatchObject({
      age: null,
      email: null,
      gender: "男",
      name: "旧姓名",
      phone: null,
      targetRoles: [],
      workYears: null,
    });
  });

  it("does not synthesize a profile for rows without structured information", () => {
    expect(
      syncResumeProfileIdentity(null, {
        candidateEmail: "new@example.com",
        candidateName: "新姓名",
        candidatePhone: "13900000000",
        targetRole: "后端工程师",
      }),
    ).toBeNull();
  });
});
