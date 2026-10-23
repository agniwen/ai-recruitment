import { describe, expect, it } from "vitest";
import { getOfferRequiredFieldIssues } from "../offer-required-fields";

const complete = {
  baseSalary: 12_000,
  confirmationInfo: {
    candidateCode: null,
    departmentName: "研发部",
    directManager: "上级甲",
    gender: "男",
    hiringUnitName: "研发中心",
    jobLevel: "P3",
    jobType: "技术",
    managementSequence: "个人",
    personnelType: "直属",
    probationPeriod: "2个月",
    probationSalary: 10_000,
    serviceUnit: "技术服务单位",
    workLocation: "中国",
    workMode: "远程",
  },
  currency: "CNY",
  joiningDate: "2026-11-01",
  position: "工程师",
};

describe("ODC required Offer fields", () => {
  it("requires every requested field without requiring the business code or an expiry", () => {
    expect(getOfferRequiredFieldIssues(complete)).toEqual([]);
    const paths = getOfferRequiredFieldIssues({}).map(({ path }) => path);
    expect(paths).toEqual(
      expect.arrayContaining([
        "position",
        "joiningDate",
        "currency",
        "baseSalary",
        "confirmationInfo.gender",
        "confirmationInfo.hiringUnitName",
        "confirmationInfo.serviceUnit",
        "confirmationInfo.personnelType",
        "confirmationInfo.departmentName",
        "confirmationInfo.directManager",
        "confirmationInfo.jobType",
        "confirmationInfo.jobLevel",
        "confirmationInfo.managementSequence",
        "confirmationInfo.workMode",
        "confirmationInfo.workLocation",
        "confirmationInfo.probationSalary",
        "confirmationInfo.probationPeriod",
      ]),
    );
    expect(paths).toHaveLength(17);
  });

  it("rejects whitespace in organization information", () => {
    const input = {
      ...complete,
      confirmationInfo: { ...complete.confirmationInfo, directManager: "  " },
    };
    expect(getOfferRequiredFieldIssues(input)).toEqual([
      { message: "请填写直属上级", path: "confirmationInfo.directManager" },
    ]);
  });

  it.each([null, "未记录", "其他"])("requires a male or female selection for %s", (gender) => {
    const issues = getOfferRequiredFieldIssues({
      ...complete,
      confirmationInfo: { ...complete.confirmationInfo, gender },
    });
    expect(issues).toEqual([{ message: "请选择性别（男或女）", path: "confirmationInfo.gender" }]);
  });

  it.each(["2026-2-03", "2026-02-29", "2026-04-31", "0000-01-01", "2026-11-01T00:00:00Z"])(
    "rejects an invalid expected joining date %s",
    (joiningDate) => {
      expect(getOfferRequiredFieldIssues({ ...complete, joiningDate })).toEqual([
        { message: expect.stringContaining("期望上岗日期"), path: "joiningDate" },
      ]);
    },
  );

  it("accepts a valid leap day and a zero probation salary", () => {
    expect(
      getOfferRequiredFieldIssues({
        ...complete,
        confirmationInfo: { ...complete.confirmationInfo, probationSalary: 0 },
        joiningDate: "2028-02-29",
      }),
    ).toEqual([]);
  });

  it.each([-1, 1.5, Number.POSITIVE_INFINITY])(
    "rejects invalid probation salary %s",
    (probationSalary) => {
      expect(
        getOfferRequiredFieldIssues({
          ...complete,
          confirmationInfo: { ...complete.confirmationInfo, probationSalary },
        }),
      ).toEqual([
        { message: expect.stringContaining("试用薪资"), path: "confirmationInfo.probationSalary" },
      ]);
    },
  );
});
