import { useState } from "react";
import { offerCurrencySchema } from "@arc/db-schema/studio-interviews";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectGroup,
  SelectItem,
} from "@/components/ui/select";

const currencies = [
  { code: "CNY", label: "人民币 CNY", symbol: "¥" },
  { code: "USD", label: "美元 USD", symbol: "$" },
  { code: "GBP", label: "英镑 GBP", symbol: "£" },
];

export function parseOfferCurrency(value: string) {
  const result = offerCurrencySchema.safeParse(value);
  if (!result.success) {
    throw new Error(result.error.issues[0].message);
  }
  return result.data;
}

export function offerCurrencySymbol(currency = "CNY") {
  return currencies.find((item) => item.code === currency)?.symbol ?? currency;
}

export function formatOfferMoney(amount: number | null | undefined, currency = "CNY") {
  return amount === null || amount === undefined
    ? null
    : `${offerCurrencySymbol(currency)} ${amount.toLocaleString("zh-CN")}`;
}

export function OfferCurrencySelect({
  id,
  value,
  onChange,
}: {
  id: string;
  value: string;
  onChange: (currency: string) => void;
}) {
  const [otherSelected, setOtherSelected] = useState(false);
  const isOther = otherSelected || !currencies.some((item) => item.code === value);
  return (
    <div className="space-y-2">
      <Select
        value={isOther ? "other" : value}
        onValueChange={(next) => {
          if (next) {
            setOtherSelected(next === "other");
            onChange(next === "other" ? "" : next);
          }
        }}
      >
        <SelectTrigger id={id} className="w-full">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectGroup>
            {currencies.map((item) => (
              <SelectItem key={item.code} value={item.code}>
                {item.label}（{item.symbol}）
              </SelectItem>
            ))}
            <SelectItem value="other">其他（文字说明）</SelectItem>
          </SelectGroup>
        </SelectContent>
      </Select>
      {isOther && (
        <div className="space-y-2">
          <Label htmlFor={`${id}-description`}>币种说明（必填）</Label>
          <Input
            id={`${id}-description`}
            value={value}
            onChange={(event) => onChange(event.target.value)}
            placeholder="请输入币种名称或说明，如：港币 HKD"
            maxLength={100}
            required
          />
        </div>
      )}
    </div>
  );
}
