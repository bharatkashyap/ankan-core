import type { IndiaFYConfig } from "../types";

/**
 * FY_CURRENT represents the last enacted law.
 * As of now: New Regime slabs as per Budget 2025 (FY 2025–26 onwards).
 * Old Regime unchanged.
 */
export const FY_CURRENT: IndiaFYConfig = {
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
    },
  },
};
