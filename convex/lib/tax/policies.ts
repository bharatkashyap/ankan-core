export type CountryCode = "IN" | "US" | "TH";

export type ForeignTaxCreditMethod =
  | "ordinary_credit_cap"
  | "exemption"
  | "none";

export const RESIDENT_TAX_POLICIES: Record<
  CountryCode,
  { worldwideTaxation: boolean }
> = {
  IN: { worldwideTaxation: true },
  US: { worldwideTaxation: false },
  TH: { worldwideTaxation: false },
};

export const TREATY_CREDIT_POLICIES: Partial<
  Record<
    CountryCode,
    Partial<Record<CountryCode, ForeignTaxCreditMethod>>
  >
> = {
  IN: {
    TH: "ordinary_credit_cap",
    US: "ordinary_credit_cap",
  },
};

export function getForeignTaxCreditMethod(
  residentCountry: CountryCode,
  sourceCountry: CountryCode,
): ForeignTaxCreditMethod {
  if (residentCountry === sourceCountry) return "none";
  return TREATY_CREDIT_POLICIES[residentCountry]?.[sourceCountry] || "none";
}

export function getCurrencyForCountry(country: CountryCode): "INR" | "USD" | "THB" {
  if (country === "US") return "USD";
  if (country === "TH") return "THB";
  return "INR";
}
