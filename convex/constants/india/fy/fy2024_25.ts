import type { IndiaFYConfig } from "../types";

export const FY2024_25: IndiaFYConfig = {
  regimes: {
    old: {
      slabs: [
        { upTo: 250_000, rate: 0 },
        { upTo: 500_000, rate: 0.05 },
        { upTo: 1_000_000, rate: 0.2 },
        { upTo: Infinity, rate: 0.3 },
      ],
      standardDeduction: 50_000,
      rebate87A: {
        incomeLimit: 500_000,
        maxAmount: 12_500,
      },
      surcharge: [
        { incomeOver: 5_000_000, rate: 0.1 },
        { incomeOver: 10_000_000, rate: 0.15 },
        { incomeOver: 20_000_000, rate: 0.25 },
        { incomeOver: 50_000_000, rate: 0.37 },
      ],
    },
    new: {
      slabs: [
        { upTo: 400_000, rate: 0 },
        { upTo: 800_000, rate: 0.05 },
        { upTo: 1_200_000, rate: 0.1 },
        { upTo: 1_600_000, rate: 0.15 },
        { upTo: 2_000_000, rate: 0.2 },
        { upTo: 2_400_000, rate: 0.25 },
        { upTo: Infinity, rate: 0.3 },
      ],
      standardDeduction: 75_000,
      rebate87A: {
        incomeLimit: 1_200_000,
        maxAmount: 60_000,
      },
      surcharge: [
        { incomeOver: 5_000_000, rate: 0.1 },
        { incomeOver: 10_000_000, rate: 0.15 },
        { incomeOver: 20_000_000, rate: 0.25 },
        { incomeOver: 50_000_000, rate: 0.25 },
      ],
    },
  },
  oldByAge: {
    non_senior: {
      slabs: [
        { upTo: 250_000, rate: 0 },
        { upTo: 500_000, rate: 0.05 },
        { upTo: 1_000_000, rate: 0.2 },
        { upTo: Infinity, rate: 0.3 },
      ],
      standardDeduction: 50_000,
      rebate87A: {
        incomeLimit: 500_000,
        maxAmount: 12_500,
      },
      surcharge: [
        { incomeOver: 5_000_000, rate: 0.1 },
        { incomeOver: 10_000_000, rate: 0.15 },
        { incomeOver: 20_000_000, rate: 0.25 },
        { incomeOver: 50_000_000, rate: 0.37 },
      ],
    },
    senior: {
      slabs: [
        { upTo: 300_000, rate: 0 },
        { upTo: 500_000, rate: 0.05 },
        { upTo: 1_000_000, rate: 0.2 },
        { upTo: Infinity, rate: 0.3 },
      ],
      standardDeduction: 50_000,
      rebate87A: {
        incomeLimit: 500_000,
        maxAmount: 12_500,
      },
      surcharge: [
        { incomeOver: 5_000_000, rate: 0.1 },
        { incomeOver: 10_000_000, rate: 0.15 },
        { incomeOver: 20_000_000, rate: 0.25 },
        { incomeOver: 50_000_000, rate: 0.37 },
      ],
    },
    super_senior: {
      slabs: [
        { upTo: 500_000, rate: 0 },
        { upTo: 1_000_000, rate: 0.2 },
        { upTo: Infinity, rate: 0.3 },
      ],
      standardDeduction: 50_000,
      rebate87A: {
        incomeLimit: 500_000,
        maxAmount: 12_500,
      },
      surcharge: [
        { incomeOver: 5_000_000, rate: 0.1 },
        { incomeOver: 10_000_000, rate: 0.15 },
        { incomeOver: 20_000_000, rate: 0.25 },
        { incomeOver: 50_000_000, rate: 0.37 },
      ],
    },
  },
};
