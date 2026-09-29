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
  return (
    <Select
      value={value}
      onValueChange={(next) => {
        if (next) {
          onChange(next);
        }
      }}
    >
      <SelectTrigger id={id} className="w-full">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectGroup>
          {currencies.some((item) => item.code === value) ? null : (
            <SelectItem value={value}>{value}</SelectItem>
          )}
          {currencies.map((item) => (
            <SelectItem key={item.code} value={item.code}>
              {item.label}（{item.symbol}）
            </SelectItem>
          ))}
        </SelectGroup>
      </SelectContent>
    </Select>
  );
}
