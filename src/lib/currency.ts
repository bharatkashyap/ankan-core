export type CurrencyCode = "INR" | "USD" | "THB";

export type CurrencyTotals = {
  INR: number;
  USD: number;
  THB: number;
};

export function formatCurrency(amount: number, currency: CurrencyCode = "INR") {
  if (currency === "THB")
    return new Intl.NumberFormat("th-TH", {
      style: "currency",
      currency: "THB",
      maximumFractionDigits: 0,
    }).format(amount);
  if (currency === "USD")
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD",
      maximumFractionDigits: 0,
    }).format(amount);
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0,
  }).format(amount);
}

export function formatCurrencyWithSign(
  amount: number,
  currency: CurrencyCode = "INR",
) {
  return formatCurrency(amount, currency);
}
