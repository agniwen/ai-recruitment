import { describe, expect, it } from "vitest";
import { externalInterviewerUsername, parseRequesterInterviewers } from "../external-interviewers";

describe("external interviewer defaults", () => {
  it.each([
    [
      "李杰@JackLil/野火@yezhu803",
      [
        { name: "李杰", telegram: "@JackLil" },
        { name: "野火", telegram: "@yezhu803" },
      ],
    ],
    ["知禾\n@Zhihe7149", [{ name: "知禾", telegram: "@Zhihe7149" }]],
    ["杜克", [{ name: "杜克", telegram: "" }]],
    [
      "李杰-@JackLil\n肖小粥",
      [
        { name: "李杰", telegram: "@JackLil" },
        { name: "肖小粥", telegram: "" },
      ],
    ],
    ["@JackLil", [{ name: "@JackLil", telegram: "@JackLil" }]],
    [
      "安迪/Faith\n@Alexa_L123/@Faith032026",
      [
        { name: "安迪", telegram: "@Alexa_L123" },
        { name: "Faith", telegram: "@Faith032026" },
      ],
    ],
    [
      "葛兵、liz\n@liko188、@liz3572",
      [
        { name: "葛兵", telegram: "@liko188" },
        { name: "liz", telegram: "@liz3572" },
      ],
    ],
    [null, []],
  ])("prefills editable names and handles from %s", (text, expected) => {
    expect(parseRequesterInterviewers(text)).toEqual(expected);
  });
  it("matches full valid usernames only", () => {
    expect(externalInterviewerUsername(" @JackLil ")).toBe("jacklil");
    expect(externalInterviewerUsername("12345678")).toBeNull();
    expect(externalInterviewerUsername("a".repeat(33))).toBeNull();
    expect(externalInterviewerUsername("张三@JackLil")).toBeNull();
  });
});
