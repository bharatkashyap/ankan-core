export type TaxSlab = {
  upTo: number;
  rate: number;
};

export type Rebate87A = {
  incomeLimit: number;
  maxAmount: number;
};

export type SurchargeBracket = {
  incomeOver: number;
  rate: number;
};

export type AgeCategory = "non_senior" | "senior" | "super_senior";

export type RegimeConfig = {
  slabs: TaxSlab[];
  standardDeduction: number;
  rebate87A: Rebate87A | null;
  surcharge?: SurchargeBracket[];
};

export type IndiaFYConfig = {
  regimes: {
    old?: RegimeConfig;
    new?: RegimeConfig;
  };
  oldByAge?: Partial<Record<AgeCategory, RegimeConfig>>;
};
