import type { TaxSlab } from "../shared/types";

/**
 * Thailand Personal Income Tax (PIT) rates.
 * Progressive tax system based on net taxable income.
 */
export const THAILAND_PIT_SLABS: TaxSlab[] = [
  { upTo: 150_000, rate: 0.0 },
  { upTo: 300_000, rate: 0.05 },
  { upTo: 500_000, rate: 0.1 },
  { upTo: 750_000, rate: 0.15 },
  { upTo: 1_000_000, rate: 0.2 },
  { upTo: 2_000_000, rate: 0.25 },
  { upTo: 5_000_000, rate: 0.3 },
  { upTo: Infinity, rate: 0.35 },
];

export const THAILAND_PERSONAL_ALLOWANCE = {
  personal: 60_000,
  spouse: 60_000,
  child: 30_000,
};

// Current implementation assumptions for salary-based taxable income estimation.
export const THAILAND_EMPLOYMENT_DEDUCTION_RATE = 0.5;
export const THAILAND_EMPLOYMENT_DEDUCTION_MAX = 100_000;
