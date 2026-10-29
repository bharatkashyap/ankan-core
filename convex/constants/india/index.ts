import type { IndiaFYConfig } from "./types";
import { FY2023_24 } from "./fy/fy2023_24";
import { FY2024_25 } from "./fy/fy2024_25";
import { FY_CURRENT } from "./fy/fy_current";

export const INDIA_HEALTH_EDU_CESS_RATE = 0.04;
export const INDIA_44ADA_RECEIPTS_LIMIT = 7_500_000;
export const INDIA_44ADA_TAXABLE_RATIO = 0.5;

function parseStartYear(fiscalYear?: string): number {
  if (!fiscalYear) {
    return new Date().getMonth() + 1 >= 4
      ? new Date().getFullYear()
      : new Date().getFullYear() - 1;
  }
  const start = Number(fiscalYear.split("-")[0]);
  return Number.isFinite(start) ? start : new Date().getFullYear();
}

export function getIndiaFYConfig(fiscalYear?: string): IndiaFYConfig {
  const startYear = parseStartYear(fiscalYear);
  if (startYear <= 2023) return FY2023_24;
  if (startYear === 2024) return FY2024_25;
  return FY_CURRENT;
}

export {
  FY2023_24,
  FY2024_25,
  FY_CURRENT,
};
