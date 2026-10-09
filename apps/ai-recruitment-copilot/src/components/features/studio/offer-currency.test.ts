import { describe, expect, it } from "vitest";
import {
  candidateExpectationsMetaSchema,
  offerDraftInputSchema,
} from "@arc/db-schema/studio-interviews";
import { formatOfferMoney } from "./offer-currency";
import { buildOfferDraftPayload, createBlankOfferFormState } from "./offer-stage-form";

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
      baseSalary: "30000",
      currency: "  港币 HKD  ",
    });
    expect(payload.currency).toBe("港币 HKD");
  });
  it.each(["", "   ", "字".repeat(101)])("rejects invalid currency descriptions", (currency) => {
    expect(() =>
      buildOfferDraftPayload({
        ...createBlankOfferFormState(),
        baseSalary: "30000",
        currency,
      }),
    ).toThrow(/币种说明/);
    expect(offerDraftInputSchema.partial().safeParse({ currency }).success).toBe(false);
    expect(candidateExpectationsMetaSchema.safeParse({ currency }).success).toBe(false);
  });
  it("defaults new offers to USD while keeping omitted update currency absent", () => {
    expect(createBlankOfferFormState().currency).toBe("USD");
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
