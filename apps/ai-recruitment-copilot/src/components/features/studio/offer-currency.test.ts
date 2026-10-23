import { describe, expect, it } from "vitest";
import {
  candidateExpectationsMetaSchema,
  offerDraftInputSchema,
} from "@arc/db-schema/studio-interviews";
import { offerConfirmationDetailsSchema } from "@arc/db-schema/offer-confirmation";
import { formatOfferMoney } from "./offer-currency";
import { buildOfferDraftPayload, createBlankOfferFormState } from "./offer-stage-form";

const requiredFormValues = {
  confirmationInfo: offerConfirmationDetailsSchema.parse({
    departmentName: "平台部",
    directManager: "上级甲",
    gender: "女",
    hiringUnitName: "研发中心",
    jobLevel: "P3",
    jobType: "技术",
    managementSequence: "个人",
    personnelType: "直属",
    probationPeriod: "2个月",
    probationSalary: 25_000,
    serviceUnit: "研发服务单位",
    workLocation: "中国",
    workMode: "远程",
  }),
  joiningDate: "2026-12-01",
};

describe("offer currencies", () => {
  it.each([
    ["CNY", "¥"],
    ["USD", "$"],
    ["GBP", "£"],
    ["港币 HKD（按约定汇率结算）", "港币 HKD（按约定汇率结算）"],
  ])("formats %s amounts and preserves currency in saved data", (currency, symbol) => {
    expect(formatOfferMoney(30_000, currency)).toBe(`${symbol} 30,000`);
    expect(formatOfferMoney(0, currency)).toBe(`${symbol} 0`);
    const payload = buildOfferDraftPayload({
      ...createBlankOfferFormState(),
      ...requiredFormValues,
      baseSalary: "30000",
      bonus: "5000",
      currency,
      position: "工程师",
    });
    expect(offerDraftInputSchema.parse(payload).currency).toBe(currency);
    expect(
      candidateExpectationsMetaSchema.parse({ currency, currentSalary: 0, expectedSalary: 30_000 })
        .currency,
    ).toBe(currency);
  });
  it("trims custom currency descriptions before saving", () => {
    const payload = buildOfferDraftPayload({
      ...createBlankOfferFormState(),
      ...requiredFormValues,
      baseSalary: "30000",
      currency: "  港币 HKD  ",
      position: "工程师",
    });
    expect(payload.currency).toBe("港币 HKD");
  });
  it.each(["", "   ", "字".repeat(101)])("rejects invalid currency descriptions", (currency) => {
    expect(() =>
      buildOfferDraftPayload({
        ...createBlankOfferFormState(),
        ...requiredFormValues,
        baseSalary: "30000",
        currency,
        position: "工程师",
      }),
    ).toThrow(/币种说明|薪资货币/);
    expect(offerDraftInputSchema.partial().safeParse({ currency }).success).toBe(false);
    expect(candidateExpectationsMetaSchema.safeParse({ currency }).success).toBe(false);
  });
  it("defaults new offers to CNY while keeping omitted update currency absent", () => {
    const form = {
      ...createBlankOfferFormState(),
      ...requiredFormValues,
      baseSalary: "30000",
      position: "工程师",
    };
    expect(form.currency).toBe("CNY");
    expect(offerDraftInputSchema.parse(buildOfferDraftPayload(form)).currency).toBe("CNY");
    expect(offerDraftInputSchema.partial().parse({ position: "工程师" })).not.toHaveProperty(
      "currency",
    );
  });
  it("preserves legacy CNY amounts and missing values", () => {
    expect(formatOfferMoney(100)).toBe("¥ 100");
    expect(formatOfferMoney(null, "USD")).toBeNull();
    expect(formatOfferMoney(undefined, "GBP")).toBeNull();
  });
});
