import {
  query,
  mutation,
  internalAction,
  internalQuery,
  internalMutation,
} from "./_generated/server";
import { v } from "convex/values";
import type { Id } from "./_generated/dataModel";
import { requireAuth, requireProfileAccess } from "./lib/auth";
import { internal } from "./_generated/api";
import {
  getIndiaFYConfig,
  INDIA_HEALTH_EDU_CESS_RATE,
  INDIA_44ADA_RECEIPTS_LIMIT,
  INDIA_44ADA_TAXABLE_RATIO,
} from "./constants/india";
import type { RegimeConfig } from "./constants/india/types";
import {
  THAILAND_PIT_SLABS,
  THAILAND_PERSONAL_ALLOWANCE,
  THAILAND_EMPLOYMENT_DEDUCTION_RATE,
  THAILAND_EMPLOYMENT_DEDUCTION_MAX,
} from "./constants/thailand/pit";
import type { TaxSlab } from "./constants/shared/types";
import {
  RESIDENT_TAX_POLICIES,
  getCurrencyForCountry,
  getForeignTaxCreditMethod,
  type CountryCode,
  type ForeignTaxCreditMethod,
} from "./lib/tax/policies";
import { getTtbToInrRateWithMeta } from "./lib/tax/fxService";
import { fiscalYearFromDateForJurisdiction } from './income';
import {
  decryptNumberWithFallback,
  decryptSalaryDetailsWithFallback,
  decryptStringWithFallback,
  encryptSalaryDetails,
  encryptNumber,
  encryptOptionalString,
} from "./lib/fieldEncryption";

async function hydrateIncomeAmounts<T extends {
  amount?: number;
  amountEnc?: string;
  salaryDetails?: any;
  salaryDetailsEnc?: any;
  note?: string;
  noteEnc?: string;
}>(row: T) {
  return {
    ...row,
    amount: await decryptNumberWithFallback(
      row.amountEnc,
      row.amount,
      "incomeEntries.amount",
    ),
    salaryDetails: await decryptSalaryDetailsWithFallback(
      row.salaryDetailsEnc,
      row.salaryDetails,
    ),
    note: await decryptStringWithFallback(row.noteEnc, row.note),
  };
}

async function hydrateTaxPaymentAmount<
  T extends {
    amount?: number;
    amountEnc?: string;
    note?: string;
    noteEnc?: string;
  },
>(row: T) {
  return {
    ...row,
    amount: await decryptNumberWithFallback(
      row.amountEnc,
      row.amount,
      "taxPayments.amount",
    ),
    note: await decryptStringWithFallback(row.noteEnc, row.note),
  };
}

async function hydrateTaxResidencyNote<
  T extends {
    note?: string;
    noteEnc?: string;
  },
>(row: T) {
  return {
    ...row,
    note: await decryptStringWithFallback(row.noteEnc, row.note),
  };
}

// Helper to calculate progressive tax
function calculateProgressiveTax(
  income: number,
  slabs: TaxSlab[],
): number {
  let tax = 0;
  let previousLimit = 0;

  for (const slab of slabs) {
    if (income <= previousLimit) break;

    const taxableInThisSlab = Math.min(income, slab.upTo) - previousLimit;
    if (taxableInThisSlab > 0) {
      tax += taxableInThisSlab * slab.rate;
    }
    previousLimit = slab.upTo;
  }

  return tax;
}

type SlabComputationRow = {
  from: number;
  to: number;
  taxable: number;
  rate: number;
  tax: number;
};

function buildSlabComputationRows(
  income: number,
  slabs: TaxSlab[],
): SlabComputationRow[] {
  const rows: SlabComputationRow[] = [];
  let previousLimit = 0;
  for (const slab of slabs) {
    if (income <= previousLimit) break;
    const taxable = Math.max(0, Math.min(income, slab.upTo) - previousLimit);
    if (taxable > 0) {
      rows.push({
        from: previousLimit,
        to: slab.upTo,
        taxable,
        rate: slab.rate,
        tax: taxable * slab.rate,
      });
    }
    previousLimit = slab.upTo;
  }
  return rows;
}

function getFallbackOldRegimeConfig(): RegimeConfig {
  return {
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
  };
}

function calculateIndiaRegimeTax(
  taxableIncome: number,
  regime: RegimeConfig,
): { baseTax: number; cess: number; totalTax: number } {
  let baseTax = calculateProgressiveTax(taxableIncome, regime.slabs);
  if (regime.rebate87A && taxableIncome <= regime.rebate87A.incomeLimit) {
    baseTax = Math.max(0, baseTax - regime.rebate87A.maxAmount);
  }
  let surcharge = 0;
  if (regime.surcharge && regime.surcharge.length > 0) {
    const sorted = [...regime.surcharge].sort(
      (a, b) => a.incomeOver - b.incomeOver,
    );
    let selectedRate = 0;
    for (const bracket of sorted) {
      if (taxableIncome > bracket.incomeOver) selectedRate = bracket.rate;
    }
    surcharge = baseTax * selectedRate;
  }

  const taxWithSurcharge = baseTax + surcharge;
  const cess = taxWithSurcharge * INDIA_HEALTH_EDU_CESS_RATE;
  return {
    baseTax,
    cess,
    totalTax: Math.round(taxWithSurcharge + cess),
  };
}

// Calculate India tax (New Regime FY 2025-26)
export const calculateIndiaTax = query({
  args: {
    grossIncome: v.number(),
    isSalaried: v.boolean(),
    professionalIncome: v.optional(v.number()),
    fiscalYear: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await requireAuth(ctx);
    const fyConfig = getIndiaFYConfig(args.fiscalYear);
    const newRegime = fyConfig.regimes.new || fyConfig.regimes.old;
    const oldRegime = fyConfig.regimes.old || getFallbackOldRegimeConfig();
    if (!newRegime) throw new Error("No India tax regime configured");

    const professionalIncome = Math.max(0, args.professionalIncome || 0);
    const nonProfessionalIncome = Math.max(0, args.grossIncome - professionalIncome);
    const professionalTaxableIncome =
      professionalIncome <= INDIA_44ADA_RECEIPTS_LIMIT
        ? professionalIncome * INDIA_44ADA_TAXABLE_RATIO
        : professionalIncome;

    const taxableIncomeNewRegime = Math.max(
      0,
      nonProfessionalIncome +
        professionalTaxableIncome -
        (args.isSalaried ? newRegime.standardDeduction : 0),
    );
    const taxableIncomeOldRegime = Math.max(
      0,
      nonProfessionalIncome +
        professionalTaxableIncome -
        (args.isSalaried ? oldRegime.standardDeduction : 0),
    );

    const newTax = calculateIndiaRegimeTax(taxableIncomeNewRegime, newRegime);
    const oldTax = calculateIndiaRegimeTax(taxableIncomeOldRegime, oldRegime);

    return {
      grossIncome: args.grossIncome,
      standardDeduction: args.isSalaried ? newRegime.standardDeduction : 0,
      standardDeductionOldRegime: args.isSalaried ? oldRegime.standardDeduction : 0,
      taxableIncome: taxableIncomeNewRegime,
      taxableIncomeOldRegime,
      baseTax: newTax.baseTax,
      cess: newTax.cess,
      totalTax: newTax.totalTax,
      totalTaxNewRegime: newTax.totalTax,
      totalTaxOldRegime: oldTax.totalTax,
      effectiveRate:
        args.grossIncome > 0
          ? ((newTax.totalTax / args.grossIncome) * 100).toFixed(2) + "%"
          : "0%",
    };
  },
});

// Calculate US Federal tax (Single Filer 2025)
export const calculateUSTax = query({
  args: {
    grossIncome: v.number(),
    filingStatus: v.literal("single"),
  },
  handler: async (ctx, args) => {
    await requireAuth(ctx);
    return {
      grossIncome: args.grossIncome,
      standardDeduction: 0,
      taxableIncome: 0,
      federalTax: 0,
      effectiveRate: "0%",
    };
  },
});

// Calculate Thailand tax
export const calculateThailandTax = query({
  args: {
    grossIncome: v.number(),
    isEmployment: v.boolean(),
  },
  handler: async (ctx, args) => {
    await requireAuth(ctx);
    let taxableIncome = args.grossIncome;

    if (args.isEmployment) {
      const employmentDeduction = Math.min(
        args.grossIncome * THAILAND_EMPLOYMENT_DEDUCTION_RATE,
        THAILAND_EMPLOYMENT_DEDUCTION_MAX,
      );
      taxableIncome -= employmentDeduction;
    }

    taxableIncome -= THAILAND_PERSONAL_ALLOWANCE.personal;
    taxableIncome = Math.max(0, taxableIncome);

    const tax = calculateProgressiveTax(taxableIncome, THAILAND_PIT_SLABS);

    return {
      grossIncome: args.grossIncome,
      personalAllowance: THAILAND_PERSONAL_ALLOWANCE.personal,
      employmentDeduction: args.isEmployment
        ? Math.min(args.grossIncome * 0.5, THAILAND_EMPLOYMENT_DEDUCTION_MAX)
        : 0,
      taxableIncome,
      tax: Math.round(tax),
      effectiveRate:
        args.grossIncome > 0
          ? ((tax / args.grossIncome) * 100).toFixed(2) + "%"
          : "0%",
    };
  },
});

// Get tax summary for a profile
export const getTaxSummary = query({
  args: { profileId: v.id("profiles") },
  handler: async (ctx, args) => {
    await requireProfileAccess(ctx, args.profileId);

    const incomeEntries = await ctx.db
      .query("incomeEntries")
      .withIndex("by_profile", (q) => q.eq("profileId", args.profileId))
      .collect();
    const hydratedIncomeEntries = await Promise.all(
      incomeEntries.map(hydrateIncomeAmounts),
    );

    const incomeByJurisdiction: Record<
      string,
      { total: number; salary: number; business: number }
    > = {
      IN: { total: 0, salary: 0, business: 0 },
      US: { total: 0, salary: 0, business: 0 },
      TH: { total: 0, salary: 0, business: 0 },
    };

    for (const entry of hydratedIncomeEntries) {
      const jurisdiction = incomeByJurisdiction[entry.jurisdiction];
      if (jurisdiction) {
        jurisdiction.total += entry.amount;
        if (entry.incomeType === "salary") {
          jurisdiction.salary += entry.amount;
        } else if (entry.incomeType === "business") {
          jurisdiction.business += entry.amount;
        }
      }
    }

    return { incomeByJurisdiction };
  },
});

// Get tax payments for a profile
export const getTaxPayments = query({
  args: {
    profileId: v.id("profiles"),
    fiscalYear: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await requireProfileAccess(ctx, args.profileId);

    let query = ctx.db
      .query("taxPayments")
      .withIndex("by_profile", (q) => q.eq("profileId", args.profileId));

    const paymentsRaw = await query.collect();
    const payments = await Promise.all(paymentsRaw.map(hydrateTaxPaymentAmount));

    if (args.fiscalYear) {
      return payments.filter((p) => p.fiscalYear === args.fiscalYear);
    }

    return payments;
  },
});

// Get tax payments grouped by jurisdiction
export const getTaxPaymentsByJurisdiction = query({
  args: {
    profileId: v.id("profiles"),
    fiscalYear: v.string(),
  },
  handler: async (ctx, args) => {
    await requireProfileAccess(ctx, args.profileId);

    const payments = await ctx.db
      .query("taxPayments")
      .withIndex("by_profile", (q) => q.eq("profileId", args.profileId))
      .collect();
    const hydratedPayments = await Promise.all(
      payments.map(hydrateTaxPaymentAmount),
    );

    const byJurisdiction: Record<
      string,
      { total: number; payments: typeof payments }
    > = {
      IN: { total: 0, payments: [] },
      US: { total: 0, payments: [] },
      TH: { total: 0, payments: [] },
    };

    for (const payment of hydratedPayments) {
      if (
        !isPaymentInJurisdictionFiscalYear(
          payment,
          args.fiscalYear,
          payment.jurisdiction,
        )
      ) {
        continue;
      }
      const jurisdiction = byJurisdiction[payment.jurisdiction];
      if (jurisdiction) {
        jurisdiction.total += payment.amount;
        jurisdiction.payments.push(payment);
      }
    }

    return byJurisdiction;
  },
});

// Add a tax payment
export const addTaxPayment = mutation({
  args: {
    profileId: v.id("profiles"),
    jurisdiction: v.union(v.literal("IN"), v.literal("US"), v.literal("TH")),
    paymentType: v.union(
      v.literal("advance_tax"),
      v.literal("tds"),
      v.literal("withholding"),
      v.literal("self_assessment"),
    ),
    amount: v.number(),
    currency: v.union(v.literal("INR"), v.literal("USD"), v.literal("THB")),
    date: v.string(),
    fiscalYear: v.string(),
    note: v.optional(v.string()),
    source: v.union(v.literal("manual"), v.literal("bot")),
  },
  handler: async (ctx, args) => {
    await requireProfileAccess(ctx, args.profileId);
    const normalizedFY = normalizeFiscalYearForJurisdiction(
      args.fiscalYear,
      args.jurisdiction,
    );
    return await ctx.db.insert("taxPayments", {
      profileId: args.profileId,
      jurisdiction: args.jurisdiction,
      paymentType: args.paymentType,
      currency: args.currency,
      date: args.date,
      noteEnc: await encryptOptionalString(args.note),
      source: args.source,
      amountEnc: await encryptNumber(args.amount),
      fiscalYear: normalizedFY,
    });
  },
});

// Delete a tax payment
export const deleteTaxPayment = mutation({
  args: { paymentId: v.id("taxPayments") },
  handler: async (ctx, args) => {
    const payment = await ctx.db.get(args.paymentId);
    if (!payment) return;
    await requireProfileAccess(ctx, payment.profileId);

    const paymentNote = await decryptStringWithFallback(
      payment.noteEnc,
      payment.note,
    );
    const linkedEntryId = getAutoWithholdingEntryId(paymentNote);
    if (linkedEntryId) {
      const linkedIncomeEntry = await ctx.db.get(
        linkedEntryId as Id<"incomeEntries">,
      );
      if (
        linkedIncomeEntry &&
        linkedIncomeEntry.profileId === payment.profileId &&
        (linkedIncomeEntry.salaryDetails || (linkedIncomeEntry as any).salaryDetailsEnc)
      ) {
        const nextSalaryDetails = {
          ...(await decryptSalaryDetailsWithFallback(
            (linkedIncomeEntry as any).salaryDetailsEnc,
            linkedIncomeEntry.salaryDetails,
          )),
          taxWithheldAmount: 0,
        };
        await ctx.db.patch(linkedIncomeEntry._id, {
          salaryDetailsEnc: await encryptSalaryDetails(nextSalaryDetails),
        });
      }
    }

    await ctx.db.delete(args.paymentId);
  },
});

// Update a manual tax payment amount.
export const updateTaxPayment = mutation({
  args: {
    paymentId: v.id("taxPayments"),
    amount: v.number(),
  },
  handler: async (ctx, args) => {
    const payment = await ctx.db.get(args.paymentId);
    if (!payment) {
      throw new Error("Tax payment not found");
    }
    await requireProfileAccess(ctx, payment.profileId);

    const note =
      (await decryptStringWithFallback(payment.noteEnc, payment.note)) || "";
    if (note.startsWith(AUTO_WITHHOLDING_NOTE_PREFIX)) {
      throw new Error(
        "This tax payment is derived from income. Edit the income entry instead.",
      );
    }
    if (!Number.isFinite(args.amount) || args.amount < 0) {
      throw new Error("Amount must be a non-negative number");
    }

    await ctx.db.patch(args.paymentId, {
      amountEnc: await encryptNumber(args.amount),
    });
  },
});

// Set/replace resident country for a profile + fiscal year.
export const setTaxResidencyForFiscalYear = mutation({
  args: {
    profileId: v.id("profiles"),
    fiscalYear: v.string(),
    jurisdiction: v.union(v.literal("IN"), v.literal("US"), v.literal("TH")),
    isResident: v.boolean(),
    note: v.optional(v.string()),
    source: v.union(v.literal("manual"), v.literal("bot")),
  },
  handler: async (ctx, args) => {
    await requireProfileAccess(ctx, args.profileId);

    const existing = await ctx.db
      .query("taxResidency")
      .withIndex("by_profile_year_jurisdiction", (q) =>
        q.eq("profileId", args.profileId).eq("fiscalYear", args.fiscalYear),
      )
      .collect();

    for (const row of existing) {
      if (row.jurisdiction === args.jurisdiction) {
        await ctx.db.delete(row._id);
      }
    }

    const residencyId = await ctx.db.insert("taxResidency", {
      profileId: args.profileId,
      fiscalYear: args.fiscalYear,
      jurisdiction: args.jurisdiction,
      isResident: args.isResident,
      noteEnc: await encryptOptionalString(args.note),
      source: args.source,
    });
    return {
      residencyId,
      jurisdiction: args.jurisdiction,
      isResident: args.isResident,
    };
  },
});

function getRule115SpecifiedDate(
  entryDate: string,
  incomeType: "salary" | "business" | "investment" | "other",
  residentFiscalYear: string,
  residentJurisdiction: "IN" | "US" | "TH",
): string {
  if (residentJurisdiction !== "IN") return entryDate;
  if (incomeType === "salary") {
    const d = new Date(`${entryDate}T00:00:00`);
    const prevMonthLastDay = new Date(d.getFullYear(), d.getMonth(), 0);
    return prevMonthLastDay.toISOString().slice(0, 10);
  }
  const { end } = getFiscalYearRange(residentFiscalYear, "IN");
  return end;
}

function getRule128SpecifiedDate(
  paymentDate: string,
  residentJurisdiction: "IN" | "US" | "TH",
): string {
  if (residentJurisdiction !== "IN") return paymentDate;
  const d = new Date(`${paymentDate}T00:00:00`);
  const prevMonthLastDay = new Date(d.getFullYear(), d.getMonth(), 0);
  return prevMonthLastDay.toISOString().slice(0, 10);
}

function getFiscalYearRange(
  fiscalYear: string,
  jurisdiction: "IN" | "US" | "TH",
): { start: string; end: string } {
  if (jurisdiction === "IN") {
    const startYear = Number(fiscalYear.split("-")[0]);
    if (Number.isFinite(startYear)) {
      return {
        start: `${startYear}-04-01`,
        end: `${startYear + 1}-03-31`,
      };
    }
  }

  const year = Number(fiscalYear.split("-")[0]);
  const normalizedYear = Number.isFinite(year) ? year : new Date().getFullYear();
  return {
    start: `${normalizedYear}-01-01`,
    end: `${normalizedYear}-12-31`,
  };
}

function normalizeFiscalYearForJurisdiction(
  fiscalYear: string,
  jurisdiction: "IN" | "US" | "TH",
): string {
  const startYear = Number(fiscalYear.split("-")[0]);
  const safeYear = Number.isFinite(startYear)
    ? startYear
    : new Date().getFullYear();

  if (jurisdiction === "IN") {
    return `${safeYear}-${String((safeYear + 1) % 100).padStart(2, "0")}`;
  }
  return String(safeYear);
}

function isPaymentInJurisdictionFiscalYear(
  payment: {
    jurisdiction: "IN" | "US" | "TH";
    fiscalYear: string;
    date: string;
  },
  fiscalYear: string,
  jurisdiction: "IN" | "US" | "TH",
) {
  if (payment.jurisdiction !== jurisdiction) return false;

  const targetFY = normalizeFiscalYearForJurisdiction(fiscalYear, jurisdiction);
  const { start, end } = getFiscalYearRange(targetFY, jurisdiction);
  const inDateRange = payment.date >= start && payment.date <= end;
  if (!inDateRange) return false;

  const rawPaymentFY = (payment.fiscalYear || "").trim();
  // For legacy rows without explicit fiscalYear, rely on date-range only.
  if (rawPaymentFY.length === 0) return true;

  const paymentFY = normalizeFiscalYearForJurisdiction(
    rawPaymentFY,
    jurisdiction,
  );
  return paymentFY === targetFY;
}

const FALLBACK_FX_TO_INR: Record<"INR" | "USD" | "THB", number> = {
  INR: 1,
  USD: 83,
  THB: 2.3,
};
const AUTO_WITHHOLDING_NOTE_PREFIX = "[auto_withholding_income_entry]";
const MANUAL_FY_TAX_PAID_NOTE_PREFIX = "[manual_fy_tax_paid]";
type TaxPaymentRowLike = {
  jurisdiction: "IN" | "US" | "TH";
  paymentType?: "advance_tax" | "tds" | "withholding" | "self_assessment";
  amount: number;
  currency: "INR" | "USD" | "THB";
  date: string;
  fiscalYear: string;
  note?: string;
  paymentId?: Id<"taxPayments">;
  entryId?: Id<"incomeEntries">;
  isAutoWithholding?: boolean;
};

type FxRateRow = {
  currency: "INR" | "USD" | "THB";
  date: string;
  rateToInr: number;
  source: "service" | "fallback";
  endpoint?: string;
  status?: number;
};

function getAutoWithholdingEntryId(note?: string) {
  if (!note) return null;
  const prefix = `${AUTO_WITHHOLDING_NOTE_PREFIX}:`;
  return note.startsWith(prefix) ? note.slice(prefix.length) : null;
}

function autoWithholdingNoteFromEntryId(entryId: string) {
  return `${AUTO_WITHHOLDING_NOTE_PREFIX}:${entryId}`;
}

function buildTaxPaymentDedupKey(row: TaxPaymentRowLike) {
  return [
    row.jurisdiction,
    row.paymentType || "",
    row.currency,
    row.date,
    row.amount.toFixed(2),
  ].join("|");
}

function fxKey(currency: "INR" | "USD" | "THB", date: string) {
  return `${currency}:${date}`;
}

function getCachedRateWithMeta(
  fxMap: Map<string, FxRateRow>,
  currency: "INR" | "USD" | "THB",
  date: string,
) {
  if (currency === "INR") {
    return {
      rate: 1,
      meta: {
        source: "service" as const,
        cache: "hit" as const,
        endpoint: null,
        status: 200,
        requestedDate: date,
      },
    };
  }
  const cached = fxMap.get(fxKey(currency, date));
  if (!cached) {
    return {
      rate: FALLBACK_FX_TO_INR[currency],
      meta: {
        source: "fallback" as const,
        cache: "miss" as const,
        endpoint: null,
        status: null,
        requestedDate: date,
      },
    };
  }
  return {
    rate: cached.rateToInr,
    meta: {
      source: cached.source,
      cache: "hit" as const,
      endpoint: cached.endpoint || null,
      status: cached.status ?? 200,
      requestedDate: date,
    },
  };
}

function convertAmountForTaxFromCacheWithMeta(
  fxMap: Map<string, FxRateRow>,
  amount: number,
  fromCurrency: "INR" | "USD" | "THB",
  toCurrency: "INR" | "USD" | "THB",
  date: string,
) {
  if (fromCurrency === toCurrency) {
    return {
      convertedAmount: amount,
      fromRateMeta: null,
      toRateMeta: null,
      fromRateToInr: 1,
      toRateToInr: 1,
    };
  }
  const fromRate = getCachedRateWithMeta(fxMap, fromCurrency, date);
  const toRate = getCachedRateWithMeta(fxMap, toCurrency, date);
  const inrAmount = amount * fromRate.rate;
  return {
    convertedAmount: inrAmount / toRate.rate,
    fromRateMeta: fromRate.meta,
    toRateMeta: toRate.meta,
    fromRateToInr: fromRate.rate,
    toRateToInr: toRate.rate,
  };
}

function calculateTaxForJurisdiction(
  jurisdiction: "IN" | "US" | "TH",
  grossIncome: number,
  salaryIncome: number,
  businessIncome: number,
  india44AdaEligibleBusinessIncome: number,
  fiscalYear?: string,
  extraDeduction?: number,
) {
  if (jurisdiction === "IN") {
    const isSalaried = salaryIncome > 0;
    const fyConfig = getIndiaFYConfig(fiscalYear);
    const newRegime = fyConfig.regimes.new || fyConfig.regimes.old;
    const oldRegime = fyConfig.regimes.old || getFallbackOldRegimeConfig();
    if (!newRegime) {
      return {
        taxableIncome: 0,
        taxableIncomeOldRegime: 0,
        taxDue: 0,
        taxDueNewRegime: 0,
        taxDueOldRegime: 0,
        grossIncomeConsidered: 0,
        standardDeductionApplied: 0,
        section44adaDeduction: 0,
      };
    }

    const professionalIncome = Math.max(0, india44AdaEligibleBusinessIncome);
    const nonProfessionalIncome = Math.max(0, grossIncome - professionalIncome);
    const professionalTaxableIncome =
      professionalIncome <= INDIA_44ADA_RECEIPTS_LIMIT
        ? professionalIncome * INDIA_44ADA_TAXABLE_RATIO
        : professionalIncome;

    const taxableIncomeNewRegime = Math.max(
      0,
      nonProfessionalIncome +
        professionalTaxableIncome -
        (isSalaried ? newRegime.standardDeduction : 0),
    );
    const taxableIncomeOldRegime = Math.max(
      0,
      nonProfessionalIncome +
        professionalTaxableIncome -
        (isSalaried ? oldRegime.standardDeduction : 0),
    );
    const newTax = calculateIndiaRegimeTax(taxableIncomeNewRegime, newRegime);
    const oldTax = calculateIndiaRegimeTax(taxableIncomeOldRegime, oldRegime);
    return {
      taxableIncome: taxableIncomeNewRegime,
      taxableIncomeOldRegime,
      taxDue: newTax.totalTax,
      taxDueNewRegime: newTax.totalTax,
      taxDueOldRegime: oldTax.totalTax,
      grossIncomeConsidered: grossIncome,
      standardDeductionApplied: isSalaried ? newRegime.standardDeduction : 0,
      section44adaDeduction: Math.max(
        0,
        professionalIncome - professionalTaxableIncome,
      ),
    };
  }

  if (jurisdiction === "US") {
    // Temporarily disabled per product requirement; state/federal modeling TBD.
    return {
      taxableIncome: 0,
      taxDue: 0,
      grossIncomeConsidered: grossIncome,
      standardDeductionApplied: 0,
      section44adaDeduction: 0,
    };
  }

  const isEmployment = salaryIncome >= businessIncome;

  let taxableIncome = grossIncome;
  if (isEmployment) {
    taxableIncome -= Math.min(
      grossIncome * THAILAND_EMPLOYMENT_DEDUCTION_RATE,
      THAILAND_EMPLOYMENT_DEDUCTION_MAX,
    );
  }
  taxableIncome -= THAILAND_PERSONAL_ALLOWANCE.personal;
  const socialSecurityDeduction = Math.min(9000, Math.max(0, extraDeduction || 0));
  taxableIncome -= socialSecurityDeduction;
  taxableIncome = Math.max(0, taxableIncome);
  const taxDue = Math.round(calculateProgressiveTax(taxableIncome, THAILAND_PIT_SLABS));
  const employmentDeduction = isEmployment
    ? Math.min(
        grossIncome * THAILAND_EMPLOYMENT_DEDUCTION_RATE,
        THAILAND_EMPLOYMENT_DEDUCTION_MAX,
      )
    : 0;
  return {
    taxableIncome,
    taxDue,
    grossIncomeConsidered: grossIncome,
    standardDeductionApplied:
      employmentDeduction + THAILAND_PERSONAL_ALLOWANCE.personal + socialSecurityDeduction,
    section44adaDeduction: 0,
  };
}

// Dedicated tax status page data: due vs paid by jurisdiction and fiscal year.
export const getTaxStatusByFiscalYear = query({
  args: {
    profileId: v.id("profiles"),
    fiscalYear: v.string(),
  },
  handler: async (ctx, args) => {
    await requireProfileAccess(ctx, args.profileId);

    const [incomeEntries, taxPayments, residencyRows] = await Promise.all([
      ctx.db
        .query("incomeEntries")
        .withIndex("by_profile", (q) => q.eq("profileId", args.profileId))
        .collect(),
      ctx.db
        .query("taxPayments")
        .withIndex("by_profile", (q) => q.eq("profileId", args.profileId))
        .collect(),
      ctx.db
        .query("taxResidency")
        .withIndex("by_profile_year", (q) =>
          q.eq("profileId", args.profileId).eq("fiscalYear", args.fiscalYear),
        )
        .collect(),
    ]);
    const hydratedIncomeEntries = await Promise.all(
      incomeEntries.map(hydrateIncomeAmounts),
    );
    const hydratedTaxPayments = await Promise.all(
      taxPayments.map(hydrateTaxPaymentAmount),
    );
    const hydratedResidencyRows = await Promise.all(
      residencyRows.map(hydrateTaxResidencyNote),
    );
    const fxRates = await ctx.db.query("fxRates").collect();
    const fxMap = new Map<string, FxRateRow>();
    for (const row of fxRates) {
      fxMap.set(
        fxKey(row.currency, row.date),
        {
          currency: row.currency,
          date: row.date,
          rateToInr: row.rateToInr,
          source: row.source,
          endpoint: row.endpoint,
          status: row.status,
        },
      );
    }

    const jurisdictions: CountryCode[] = ["IN", "US", "TH"];
    const currencyByJurisdiction: Record<CountryCode, "INR" | "USD" | "THB"> = {
      IN: "INR",
      US: "USD",
      TH: "THB",
    };
    const withholdingFromIncomeRows: TaxPaymentRowLike[] = hydratedIncomeEntries
      .map((entry): TaxPaymentRowLike | null => {
        const taxWithheld = Math.max(
          0,
          Number(entry.salaryDetails?.taxWithheldAmount || 0),
        );
        if (taxWithheld <= 0) return null;
        return {
          jurisdiction: entry.jurisdiction,
          paymentType: entry.jurisdiction === "IN" ? "tds" : "withholding",
          amount: taxWithheld,
          currency:
            (entry.currency as "INR" | "USD" | "THB" | undefined) ||
            currencyByJurisdiction[entry.jurisdiction],
          date: entry.date,
          fiscalYear: fiscalYearFromDateForJurisdiction(
            entry.date,
            entry.jurisdiction,
          ),
          note: AUTO_WITHHOLDING_NOTE_PREFIX,
          entryId: entry._id,
          isAutoWithholding: true,
        };
      })
      .filter((row): row is TaxPaymentRowLike => !!row);
    const withholdingFromIncomeKeys = new Set(
      withholdingFromIncomeRows.map(buildTaxPaymentDedupKey),
    );
    const nonAutoTaxPayments: TaxPaymentRowLike[] = hydratedTaxPayments
      .filter((row) => {
        const note = row.note || "";
        if (note.startsWith(AUTO_WITHHOLDING_NOTE_PREFIX)) {
          return false;
        }
        // Older flows could leave a manual withholding row that exactly matches
        // the withholding already derived from the income entry for that date.
        return !withholdingFromIncomeKeys.has(buildTaxPaymentDedupKey(row));
      })
      .map((row) => ({
        jurisdiction: row.jurisdiction,
        paymentType: row.paymentType,
        amount: row.amount,
        currency: row.currency,
        date: row.date,
        fiscalYear: row.fiscalYear,
        note: row.note,
        paymentId: row._id,
        isAutoWithholding: false,
      }));
    const effectiveTaxPayments: TaxPaymentRowLike[] = [
      ...nonAutoTaxPayments,
      ...withholdingFromIncomeRows,
    ];

    const residencyByJurisdiction: Record<CountryCode, boolean> = {
      IN: true,
      US: false,
      TH: false,
    };
    for (const row of hydratedResidencyRows) {
      residencyByJurisdiction[row.jurisdiction as CountryCode] = row.isResident;
    }

    const incomeByCountry: Record<CountryCode, { income: number; salary: number; business: number }> = {
      IN: { income: 0, salary: 0, business: 0 },
      US: { income: 0, salary: 0, business: 0 },
      TH: { income: 0, salary: 0, business: 0 },
    };
    const thaiSocialSecurityByYear = new Map<string, number>();

    for (const country of jurisdictions) {
      const { start, end } = getFiscalYearRange(args.fiscalYear, country);
      const inRange = hydratedIncomeEntries.filter(
        (entry) =>
          entry.jurisdiction === country && entry.date >= start && entry.date <= end,
      );
      if (country === "TH") {
        const totalSS = inRange.reduce(
          (sum, entry) =>
            sum + Math.max(0, Number(entry.salaryDetails?.socialSecurityEmployeeAmount || 0)),
          0,
        );
        thaiSocialSecurityByYear.set(args.fiscalYear, totalSS);
      }
      incomeByCountry[country] = {
        income: inRange.reduce((sum, e) => sum + e.amount, 0),
        salary: inRange
          .filter((e) => e.incomeType === "salary")
          .reduce((sum, e) => sum + e.amount, 0),
        business: inRange
          .filter((e) => e.incomeType === "business")
          .reduce((sum, e) => sum + e.amount, 0),
      };
    }

    const result: Record<
      CountryCode,
      {
        income: number;
        isResident: boolean;
        worldwideTaxation: boolean;
        domesticIncome: number;
        foreignIncomeIncluded: number;
        foreignTaxCreditAllowed: number;
        foreignTaxCreditCurrency: "INR" | "USD" | "THB";
        foreignTaxCreditBreakdown: Array<{
          sourceCountry: CountryCode;
          method: ForeignTaxCreditMethod;
          foreignIncome: number;
          foreignTaxPaid: number;
          foreignTaxPaidResidentCurrency: number;
          attributableTax: number;
          creditAllowed: number;
          taxPaymentLines: Array<{
            date: string;
            rateDate: string;
            paymentType: "advance_tax" | "tds" | "withholding" | "self_assessment";
            originalAmount: number;
            originalCurrency: "INR" | "USD" | "THB";
            convertedAmount: number;
            convertedCurrency: "INR" | "USD" | "THB";
            rateToInr: number;
            fxSource: "service" | "fallback";
            fxCache: "hit" | "miss";
            fxRequestedDate: string;
            fxEndpoint: string | null;
            fxStatus: number | null;
          }>;
          fxEvidence: {
            serviceCalls: number;
            fallbackCalls: number;
            cacheHits: number;
            samples: Array<{
              kind: "foreign_income" | "foreign_tax_paid";
              fromCurrency: "INR" | "USD" | "THB";
              requestedDate: string;
              rateToInr: number;
              source: "service" | "fallback";
              cache: "hit" | "miss";
              endpoint: string | null;
              status: number | null;
            }>;
          };
        }>;
        incomeBreakdownByMonth: Array<{
          month: string;
          domesticIncome: number;
          foreignIncomeIncluded: number;
          totalIncomeConsidered: number;
        }>;
        foreignIncomeEntryLines: Array<{
          date: string;
          rateDate: string;
          sourceJurisdiction: CountryCode;
          originalAmount: number;
          originalCurrency: "INR" | "USD" | "THB";
          convertedAmount: number;
          convertedCurrency: "INR" | "USD" | "THB";
          rateToInr: number;
          fxSource: "service" | "fallback";
          fxCache: "hit" | "miss";
          fxRequestedDate: string;
          fxEndpoint: string | null;
          fxStatus: number | null;
        }>;
        grossIncomeConsidered: number;
        standardDeductionApplied: number;
        section44adaDeduction: number;
        taxComputationRows: Array<{
          from: number;
          to: number;
          taxable: number;
          rate: number;
          tax: number;
        }>;
        taxComputationSlabTax: number;
        taxComputationAdjustment: number;
        taxableIncome: number;
        taxableIncomeOldRegime?: number;
        taxDue: number;
        taxDueNewRegime?: number;
        taxDueOldRegime?: number;
        taxPaid: number;
        netDue: number;
        netDueNewRegime?: number;
        netDueOldRegime?: number;
        fxEvidenceSummary: {
          serviceCalls: number;
          fallbackCalls: number;
          cacheHits: number;
          samples: Array<{
            kind: "foreign_income" | "foreign_tax_paid";
            fromCurrency: "INR" | "USD" | "THB";
            requestedDate: string;
            rateToInr: number;
            source: "service" | "fallback";
            cache: "hit" | "miss";
            endpoint: string | null;
            status: number | null;
          }>;
        };
        currency: "INR" | "USD" | "THB";
      }
    > = {
      IN: {
        income: 0,
        isResident: true,
        worldwideTaxation: true,
        domesticIncome: 0,
        foreignIncomeIncluded: 0,
        foreignTaxCreditAllowed: 0,
        foreignTaxCreditCurrency: "INR",
        foreignTaxCreditBreakdown: [],
        incomeBreakdownByMonth: [],
        foreignIncomeEntryLines: [],
        grossIncomeConsidered: 0,
        standardDeductionApplied: 0,
        section44adaDeduction: 0,
        taxComputationRows: [],
        taxComputationSlabTax: 0,
        taxComputationAdjustment: 0,
        taxableIncome: 0,
        taxableIncomeOldRegime: 0,
        taxDue: 0,
        taxDueNewRegime: 0,
        taxDueOldRegime: 0,
        taxPaid: 0,
        netDue: 0,
        netDueNewRegime: 0,
        netDueOldRegime: 0,
        fxEvidenceSummary: {
          serviceCalls: 0,
          fallbackCalls: 0,
          cacheHits: 0,
          samples: [],
        },
        currency: "INR",
      },
      US: {
        income: 0,
        isResident: false,
        worldwideTaxation: false,
        domesticIncome: 0,
        foreignIncomeIncluded: 0,
        foreignTaxCreditAllowed: 0,
        foreignTaxCreditCurrency: "USD",
        foreignTaxCreditBreakdown: [],
        incomeBreakdownByMonth: [],
        foreignIncomeEntryLines: [],
        grossIncomeConsidered: 0,
        standardDeductionApplied: 0,
        section44adaDeduction: 0,
        taxComputationRows: [],
        taxComputationSlabTax: 0,
        taxComputationAdjustment: 0,
        taxableIncome: 0,
        taxDue: 0,
        taxPaid: 0,
        netDue: 0,
        fxEvidenceSummary: {
          serviceCalls: 0,
          fallbackCalls: 0,
          cacheHits: 0,
          samples: [],
        },
        currency: "USD",
      },
      TH: {
        income: 0,
        isResident: false,
        worldwideTaxation: false,
        domesticIncome: 0,
        foreignIncomeIncluded: 0,
        foreignTaxCreditAllowed: 0,
        foreignTaxCreditCurrency: "THB",
        foreignTaxCreditBreakdown: [],
        incomeBreakdownByMonth: [],
        foreignIncomeEntryLines: [],
        grossIncomeConsidered: 0,
        standardDeductionApplied: 0,
        section44adaDeduction: 0,
        taxComputationRows: [],
        taxComputationSlabTax: 0,
        taxComputationAdjustment: 0,
        taxableIncome: 0,
        taxDue: 0,
        taxPaid: 0,
        netDue: 0,
        fxEvidenceSummary: {
          serviceCalls: 0,
          fallbackCalls: 0,
          cacheHits: 0,
          samples: [],
        },
        currency: "THB",
      },
    };

    for (const jurisdiction of jurisdictions) {
      const income = incomeByCountry[jurisdiction].income;
      const isResident = residencyByJurisdiction[jurisdiction];
      const residentPolicy = RESIDENT_TAX_POLICIES[jurisdiction];
      const residentCurrency = getCurrencyForCountry(jurisdiction);
      const residentRange = getFiscalYearRange(args.fiscalYear, jurisdiction);

      const domesticIncome = incomeByCountry[jurisdiction].income;
      const foreignIncomeBySource: Record<CountryCode, number> = {
        IN: 0,
        US: 0,
        TH: 0,
      };
      const foreignSalaryBySource: Record<CountryCode, number> = {
        IN: 0,
        US: 0,
        TH: 0,
      };
      const foreignBusinessBySource: Record<CountryCode, number> = {
        IN: 0,
        US: 0,
        TH: 0,
      };
      const foreignIncomeEntryLines: Array<{
        date: string;
        rateDate: string;
        sourceJurisdiction: CountryCode;
        originalAmount: number;
        originalCurrency: "INR" | "USD" | "THB";
        convertedAmount: number;
        convertedCurrency: "INR" | "USD" | "THB";
        rateToInr: number;
        fxSource: "service" | "fallback";
        fxCache: "hit" | "miss";
        fxRequestedDate: string;
        fxEndpoint: string | null;
        fxStatus: number | null;
      }> = [];
      const domesticIncomeByMonth = new Map<string, number>();
      const foreignIncomeByMonth = new Map<string, number>();
      for (const entry of hydratedIncomeEntries) {
        if (
          entry.jurisdiction === jurisdiction &&
          entry.date >= residentRange.start &&
          entry.date <= residentRange.end
        ) {
          const month = entry.date.slice(0, 7);
          domesticIncomeByMonth.set(
            month,
            (domesticIncomeByMonth.get(month) || 0) + entry.amount,
          );
        }
      }
      for (const source of jurisdictions) {
        if (source === jurisdiction) continue;
        if (!(isResident && residentPolicy.worldwideTaxation)) continue;

        const foreignEntries = hydratedIncomeEntries.filter(
          (entry) =>
            entry.jurisdiction === source &&
            entry.date >= residentRange.start &&
            entry.date <= residentRange.end,
        );

        let converted = 0;
        for (const entry of foreignEntries) {
          const fromCurrency =
            (entry.currency as "INR" | "USD" | "THB" | undefined) ||
            currencyByJurisdiction[source];
          const specifiedDate = getRule115SpecifiedDate(
            entry.date,
            entry.incomeType,
            args.fiscalYear,
            jurisdiction,
          );
          const convertedRow = convertAmountForTaxFromCacheWithMeta(
            fxMap,
            entry.amount,
            fromCurrency,
            residentCurrency,
            specifiedDate,
          );
          converted += convertedRow.convertedAmount;
          foreignIncomeEntryLines.push({
            date: entry.date,
            rateDate: specifiedDate,
            sourceJurisdiction: source,
            originalAmount: entry.amount,
            originalCurrency: fromCurrency,
            convertedAmount: convertedRow.convertedAmount,
            convertedCurrency: residentCurrency,
            rateToInr: convertedRow.fromRateToInr,
            fxSource: convertedRow.fromRateMeta?.source || "fallback",
            fxCache: convertedRow.fromRateMeta?.cache || "miss",
            fxRequestedDate:
              convertedRow.fromRateMeta?.requestedDate || specifiedDate,
            fxEndpoint: convertedRow.fromRateMeta?.endpoint || null,
            fxStatus: convertedRow.fromRateMeta?.status ?? null,
          });
          if (entry.incomeType === "salary") {
            foreignSalaryBySource[source] += convertedRow.convertedAmount;
          } else if (entry.incomeType === "business") {
            foreignBusinessBySource[source] += convertedRow.convertedAmount;
          }
        }
        foreignIncomeBySource[source] = converted;
      }
      const foreignIncomeIncluded =
        isResident && residentPolicy.worldwideTaxation
          ? Object.values(foreignIncomeBySource).reduce((a, b) => a + b, 0)
          : 0;
      const foreignSalaryIncluded =
        isResident && residentPolicy.worldwideTaxation
          ? Object.values(foreignSalaryBySource).reduce((a, b) => a + b, 0)
          : 0;
      const foreignBusinessIncluded =
        isResident && residentPolicy.worldwideTaxation
          ? Object.values(foreignBusinessBySource).reduce((a, b) => a + b, 0)
          : 0;
      const salaryIncomeForCalc =
        incomeByCountry[jurisdiction].salary + foreignSalaryIncluded;
      const businessIncomeForCalc =
        incomeByCountry[jurisdiction].business + foreignBusinessIncluded;
      const india44AdaEligibleBusinessIncome =
        jurisdiction === "IN" ? incomeByCountry.IN.business : businessIncomeForCalc;

      const taxPaid = effectiveTaxPayments
        .filter((payment) =>
          isPaymentInJurisdictionFiscalYear(payment, args.fiscalYear, jurisdiction),
        )
        .reduce((sum, payment) => sum + payment.amount, 0);

      const calc = calculateTaxForJurisdiction(
        jurisdiction,
        domesticIncome + foreignIncomeIncluded,
        salaryIncomeForCalc,
        businessIncomeForCalc,
        india44AdaEligibleBusinessIncome,
        jurisdiction === "IN" ? args.fiscalYear : undefined,
        jurisdiction === "TH" ? thaiSocialSecurityByYear.get(args.fiscalYear) || 0 : 0,
      );

      let foreignTaxCreditAllowed = 0;
      const fxEvidenceSummary = {
        serviceCalls: 0,
        fallbackCalls: 0,
        cacheHits: 0,
        samples: [] as Array<{
          kind: "foreign_income" | "foreign_tax_paid";
          fromCurrency: "INR" | "USD" | "THB";
          requestedDate: string;
          rateToInr: number;
          source: "service" | "fallback";
          cache: "hit" | "miss";
          endpoint: string | null;
          status: number | null;
        }>,
      };
      const foreignTaxCreditBreakdown: Array<{
        sourceCountry: CountryCode;
        method: ForeignTaxCreditMethod;
        foreignIncome: number;
        foreignTaxPaid: number;
        foreignTaxPaidResidentCurrency: number;
        attributableTax: number;
        creditAllowed: number;
        taxPaymentLines: Array<{
          date: string;
          rateDate: string;
          paymentId?: Id<"taxPayments">;
          isAutoWithholding?: boolean;
          paymentType: "advance_tax" | "tds" | "withholding" | "self_assessment";
          originalAmount: number;
          originalCurrency: "INR" | "USD" | "THB";
          convertedAmount: number;
          convertedCurrency: "INR" | "USD" | "THB";
          rateToInr: number;
          fxSource: "service" | "fallback";
          fxCache: "hit" | "miss";
          fxRequestedDate: string;
          fxEndpoint: string | null;
          fxStatus: number | null;
        }>;
        fxEvidence: {
          serviceCalls: number;
          fallbackCalls: number;
          cacheHits: number;
          samples: Array<{
            kind: "foreign_income" | "foreign_tax_paid";
            fromCurrency: "INR" | "USD" | "THB";
            requestedDate: string;
            rateToInr: number;
            source: "service" | "fallback";
            cache: "hit" | "miss";
            endpoint: string | null;
            status: number | null;
          }>;
        };
      }> = [];

      if (isResident && residentPolicy.worldwideTaxation) {
        const taxPaymentByEntryId = new Map<string, Id<"taxPayments">>();
        for (const payment of taxPayments) {
          const entryId = getAutoWithholdingEntryId(payment.note);
          if (entryId) {
            taxPaymentByEntryId.set(entryId, payment._id);
          }
        }
        for (const sourceCountry of jurisdictions) {
          if (sourceCountry === jurisdiction) continue;
          const foreignIncome = foreignIncomeBySource[sourceCountry];
          if (foreignIncome <= 0) continue;

          const method = getForeignTaxCreditMethod(jurisdiction, sourceCountry);
          const matchingTaxPaymentRows = effectiveTaxPayments.filter(
            (r) =>
              r.jurisdiction === sourceCountry &&
              r.date >= residentRange.start &&
              r.date <= residentRange.end,
          );
          const foreignTaxPaid = matchingTaxPaymentRows.reduce(
            (sum, r) => sum + r.amount,
            0,
          );
          const rowFxEvidence = {
            serviceCalls: 0,
            fallbackCalls: 0,
            cacheHits: 0,
            samples: [] as Array<{
              kind: "foreign_income" | "foreign_tax_paid";
              fromCurrency: "INR" | "USD" | "THB";
              requestedDate: string;
              rateToInr: number;
              source: "service" | "fallback";
              cache: "hit" | "miss";
              endpoint: string | null;
              status: number | null;
            }>,
          };

          const recordFxSample = (
            kind: "foreign_income" | "foreign_tax_paid",
            fromCurrency: "INR" | "USD" | "THB",
            meta: {
              source: "service" | "fallback";
              cache: "hit" | "miss";
              endpoint: string | null;
              status: number | null;
              requestedDate: string;
            } | null,
            rateToInr: number,
          ) => {
            if (!meta) return;
            if (meta.source === "service") {
              rowFxEvidence.serviceCalls += 1;
              fxEvidenceSummary.serviceCalls += 1;
            } else {
              rowFxEvidence.fallbackCalls += 1;
              fxEvidenceSummary.fallbackCalls += 1;
            }
            if (meta.cache === "hit") {
              rowFxEvidence.cacheHits += 1;
              fxEvidenceSummary.cacheHits += 1;
            }
            const sample = {
              kind,
              fromCurrency,
              requestedDate: meta.requestedDate,
              rateToInr,
              source: meta.source,
              cache: meta.cache,
              endpoint: meta.endpoint,
              status: meta.status,
            };
            const pushSample = (
              bucket: Array<{
                kind: "foreign_income" | "foreign_tax_paid";
                fromCurrency: "INR" | "USD" | "THB";
                requestedDate: string;
                rateToInr: number;
                source: "service" | "fallback";
                cache: "hit" | "miss";
                endpoint: string | null;
                status: number | null;
              }>,
              max: number,
            ) => {
              if (bucket.length < max) {
                bucket.push(sample);
                return;
              }
              if (kind === "foreign_tax_paid") {
                const existingTaxPaidIdx = bucket.findIndex(
                  (s) => s.kind === "foreign_tax_paid",
                );
                if (existingTaxPaidIdx === -1) {
                  const replaceIdx = bucket.findIndex(
                    (s) => s.kind === "foreign_income",
                  );
                  if (replaceIdx >= 0) {
                    bucket[replaceIdx] = sample;
                  }
                }
              }
            };
            pushSample(rowFxEvidence.samples, 6);
            pushSample(fxEvidenceSummary.samples, 10);
          };

          for (const entry of hydratedIncomeEntries) {
            if (
              entry.jurisdiction !== sourceCountry ||
              entry.date < residentRange.start ||
              entry.date > residentRange.end
            ) {
              continue;
            }
            const fromCurrency =
              (entry.currency as "INR" | "USD" | "THB" | undefined) ||
              currencyByJurisdiction[sourceCountry];
            const specifiedDate = getRule115SpecifiedDate(
              entry.date,
              entry.incomeType,
              args.fiscalYear,
              jurisdiction,
            );
            const converted = convertAmountForTaxFromCacheWithMeta(
              fxMap,
              entry.amount,
              fromCurrency,
              residentCurrency,
              specifiedDate,
            );
            const month = entry.date.slice(0, 7);
            foreignIncomeByMonth.set(
              month,
              (foreignIncomeByMonth.get(month) || 0) + converted.convertedAmount,
            );
            recordFxSample(
              "foreign_income",
              fromCurrency,
              converted.fromRateMeta,
              converted.fromRateToInr,
            );
          }

          let foreignTaxPaidResidentCurrency = 0;
          const taxPaymentLines: Array<{
          date: string;
          rateDate: string;
          paymentId?: Id<"taxPayments">;
          isAutoWithholding?: boolean;
          paymentType: "advance_tax" | "tds" | "withholding" | "self_assessment";
          originalAmount: number;
          originalCurrency: "INR" | "USD" | "THB";
          convertedAmount: number;
            convertedCurrency: "INR" | "USD" | "THB";
            rateToInr: number;
            fxSource: "service" | "fallback";
            fxCache: "hit" | "miss";
            fxRequestedDate: string;
            fxEndpoint: string | null;
            fxStatus: number | null;
          }> = [];
          for (const row of matchingTaxPaymentRows) {
            const specifiedDate = getRule128SpecifiedDate(row.date, jurisdiction);
            const converted = convertAmountForTaxFromCacheWithMeta(
              fxMap,
              row.amount,
              row.currency,
              residentCurrency,
              specifiedDate,
            );
            foreignTaxPaidResidentCurrency += converted.convertedAmount;
            const paymentId =
              row.paymentId ||
              (row.entryId ? taxPaymentByEntryId.get(row.entryId) : undefined);
            taxPaymentLines.push({
              date: row.date,
              rateDate: specifiedDate,
              paymentId,
              isAutoWithholding: row.isAutoWithholding,
              paymentType:
                row.paymentType || (sourceCountry === "IN" ? "tds" : "withholding"),
              originalAmount: row.amount,
              originalCurrency: row.currency,
              convertedAmount: converted.convertedAmount,
              convertedCurrency: residentCurrency,
              rateToInr: converted.fromRateToInr,
              fxSource: converted.fromRateMeta?.source || "fallback",
              fxCache: converted.fromRateMeta?.cache || "miss",
              fxRequestedDate: converted.fromRateMeta?.requestedDate || specifiedDate,
              fxEndpoint: converted.fromRateMeta?.endpoint || null,
              fxStatus: converted.fromRateMeta?.status ?? null,
            });
            recordFxSample(
              "foreign_tax_paid",
              row.currency,
              converted.fromRateMeta,
              converted.fromRateToInr,
            );
          }

          let attributableTax = 0;
          if (method === "ordinary_credit_cap") {
            const globalIncome = Math.max(0, domesticIncome + foreignIncomeIncluded);
            const indiaTaxBase = calc.taxDueNewRegime || calc.taxDue;
            attributableTax =
              globalIncome > 0 ? (indiaTaxBase * foreignIncome) / globalIncome : 0;
          }

          const creditAllowed =
            method === "ordinary_credit_cap"
              ? Math.max(
                  0,
                  Math.min(foreignTaxPaidResidentCurrency, attributableTax),
                )
              : 0;

          foreignTaxCreditAllowed += creditAllowed;
          foreignTaxCreditBreakdown.push({
            sourceCountry,
            method,
            foreignIncome,
            foreignTaxPaid,
            foreignTaxPaidResidentCurrency,
            attributableTax,
            creditAllowed,
            taxPaymentLines,
            fxEvidence: rowFxEvidence,
          });
        }
      }

      const allMonths = new Set<string>([
        ...Array.from(domesticIncomeByMonth.keys()),
        ...Array.from(foreignIncomeByMonth.keys()),
      ]);
      const incomeBreakdownByMonth = Array.from(allMonths)
        .sort()
        .map((month) => {
          const domestic = domesticIncomeByMonth.get(month) || 0;
          const foreignIncluded = foreignIncomeByMonth.get(month) || 0;
          return {
            month,
            domesticIncome: domestic,
            foreignIncomeIncluded: foreignIncluded,
            totalIncomeConsidered: domestic + foreignIncluded,
          };
        });
      const netDueBase = Math.max(0, calc.taxDue - foreignTaxCreditAllowed - taxPaid);
      const netDueNew = Math.max(
        0,
        (calc.taxDueNewRegime || calc.taxDue) - foreignTaxCreditAllowed - taxPaid,
      );
      const netDueOld = Math.max(
        0,
        (calc.taxDueOldRegime || calc.taxDue) - foreignTaxCreditAllowed - taxPaid,
      );
      let slabsForComputation: TaxSlab[] = [];
      if (jurisdiction === "IN") {
        const fyConfig = getIndiaFYConfig(args.fiscalYear);
        const newRegime = fyConfig.regimes.new || fyConfig.regimes.old;
        slabsForComputation = newRegime?.slabs || [];
      } else if (jurisdiction === "TH") {
        slabsForComputation = THAILAND_PIT_SLABS;
      }
      const taxComputationRows = buildSlabComputationRows(
        calc.taxableIncome,
        slabsForComputation,
      );
      const taxComputationSlabTax = taxComputationRows.reduce(
        (sum, row) => sum + row.tax,
        0,
      );
      const preReliefTax =
        jurisdiction === "IN" ? calc.taxDueNewRegime || calc.taxDue : calc.taxDue;
      const taxComputationAdjustment = preReliefTax - taxComputationSlabTax;

      result[jurisdiction] = {
        income,
        isResident,
        worldwideTaxation: residentPolicy.worldwideTaxation,
        domesticIncome,
        foreignIncomeIncluded,
        foreignTaxCreditAllowed,
        foreignTaxCreditCurrency: residentCurrency,
        foreignTaxCreditBreakdown,
        grossIncomeConsidered: calc.grossIncomeConsidered,
        standardDeductionApplied: calc.standardDeductionApplied,
        section44adaDeduction: calc.section44adaDeduction,
        taxComputationRows,
        taxComputationSlabTax,
        taxComputationAdjustment,
        incomeBreakdownByMonth,
        foreignIncomeEntryLines,
        taxableIncome: calc.taxableIncome,
        taxableIncomeOldRegime:
          jurisdiction === "IN" ? calc.taxableIncomeOldRegime || 0 : undefined,
        taxDue: calc.taxDue,
        taxDueNewRegime:
          jurisdiction === "IN" ? calc.taxDueNewRegime || calc.taxDue : undefined,
        taxDueOldRegime:
          jurisdiction === "IN" ? calc.taxDueOldRegime || calc.taxDue : undefined,
        taxPaid,
        netDue: netDueBase,
        netDueNewRegime: jurisdiction === "IN" ? netDueNew : undefined,
        netDueOldRegime: jurisdiction === "IN" ? netDueOld : undefined,
        fxEvidenceSummary,
        currency: currencyByJurisdiction[jurisdiction],
      };
    }

    return {
      fiscalYear: args.fiscalYear,
      residencyByJurisdiction,
      jurisdictions: result,
    };
  },
});

export const _getFxRefreshInputs = internalQuery({
  args: {
    profileId: v.id("profiles"),
    fiscalYear: v.string(),
  },
  handler: async (ctx, args) => {
    const [incomeEntries, taxPayments, residencyRows] = await Promise.all([
      ctx.db
        .query("incomeEntries")
        .withIndex("by_profile", (q) => q.eq("profileId", args.profileId))
        .collect(),
      ctx.db
        .query("taxPayments")
        .withIndex("by_profile", (q) => q.eq("profileId", args.profileId))
        .collect(),
      ctx.db
        .query("taxResidency")
        .withIndex("by_profile_year", (q) =>
          q.eq("profileId", args.profileId).eq("fiscalYear", args.fiscalYear),
        )
        .collect(),
    ]);
    const hydratedIncomeEntries = await Promise.all(
      incomeEntries.map(hydrateIncomeAmounts),
    );
    const hydratedTaxPayments = await Promise.all(
      taxPayments.map(hydrateTaxPaymentAmount),
    );
    const hydratedResidencyRows = await Promise.all(
      residencyRows.map(hydrateTaxResidencyNote),
    );
    return {
      incomeEntries: hydratedIncomeEntries,
      taxPayments: hydratedTaxPayments,
      residencyRows: hydratedResidencyRows,
    };
  },
});

export const _upsertFxRates = internalMutation({
  args: {
    rows: v.array(
      v.object({
        currency: v.union(v.literal("INR"), v.literal("USD"), v.literal("THB")),
        date: v.string(),
        rateToInr: v.number(),
        source: v.union(v.literal("service"), v.literal("fallback")),
        endpoint: v.optional(v.string()),
        status: v.optional(v.number()),
      }),
    ),
  },
  handler: async (ctx, args) => {
    let upserts = 0;
    for (const row of args.rows) {
      const existing = await ctx.db
        .query("fxRates")
        .withIndex("by_currency_date", (q) =>
          q.eq("currency", row.currency).eq("date", row.date),
        )
        .collect();
      const payload = {
        currency: row.currency,
        date: row.date,
        rateToInr: row.rateToInr,
        source: row.source,
        endpoint: row.endpoint,
        status: row.status,
        fetchedAt: Date.now(),
      };
      if (existing.length > 0) {
        await ctx.db.patch(existing[0]._id, payload);
      } else {
        await ctx.db.insert("fxRates", payload);
      }
      upserts += 1;
    }
    return { upserts };
  },
});

export const _refreshFxRatesForFiscalYearInternal = internalAction({
  args: {
    profileId: v.id("profiles"),
    fiscalYear: v.string(),
  },
  handler: async (
    ctx,
    args,
  ): Promise<{ requested: number; upserts: number }> => {
    const input = await ctx.runQuery((internal as any).tax._getFxRefreshInputs, {
      profileId: args.profileId,
      fiscalYear: args.fiscalYear,
    });

    const jurisdictions: CountryCode[] = ["IN", "US", "TH"];
    const currencyByJurisdiction: Record<CountryCode, "INR" | "USD" | "THB"> = {
      IN: "INR",
      US: "USD",
      TH: "THB",
    };

    const residencyByJurisdiction: Record<CountryCode, boolean> = {
      IN: true,
      US: false,
      TH: false,
    };
    for (const row of input.residencyRows) {
      residencyByJurisdiction[row.jurisdiction as CountryCode] = row.isResident;
    }

    const requestedPairs = new Set<string>();
    const addPair = (currency: "INR" | "USD" | "THB", date: string) => {
      if (currency === "INR") return;
      requestedPairs.add(fxKey(currency, date));
    };

    for (const resident of jurisdictions) {
      if (!(residencyByJurisdiction[resident] && RESIDENT_TAX_POLICIES[resident].worldwideTaxation)) {
        continue;
      }
      const residentCurrency = getCurrencyForCountry(resident);
      const residentRange = getFiscalYearRange(args.fiscalYear, resident);

      for (const source of jurisdictions) {
        if (source === resident) continue;

        for (const entry of input.incomeEntries) {
          if (
            entry.jurisdiction !== source ||
            entry.date < residentRange.start ||
            entry.date > residentRange.end
          ) {
            continue;
          }
          const fromCurrency =
            (entry.currency as "INR" | "USD" | "THB" | undefined) ||
            currencyByJurisdiction[source];
          const specifiedDate = getRule115SpecifiedDate(
            entry.date,
            entry.incomeType,
            args.fiscalYear,
            resident,
          );
          addPair(fromCurrency, specifiedDate);
          addPair(residentCurrency, specifiedDate);
        }

        for (const payment of input.taxPayments) {
          if (
            payment.jurisdiction !== source ||
            payment.date < residentRange.start ||
            payment.date > residentRange.end
          ) {
            continue;
          }
          const specifiedDate = getRule128SpecifiedDate(payment.date, resident);
          addPair(payment.currency, specifiedDate);
          addPair(residentCurrency, specifiedDate);
        }
      }
    }

    const rows: Array<{
      currency: "INR" | "USD" | "THB";
      date: string;
      rateToInr: number;
      source: "service" | "fallback";
      endpoint?: string;
      status?: number;
    }> = [];

    for (const key of requestedPairs) {
      const [currency, date] = key.split(":");
      const result = await getTtbToInrRateWithMeta(
        currency as "INR" | "USD" | "THB",
        date,
      );
      rows.push({
        currency: currency as "INR" | "USD" | "THB",
        date,
        rateToInr: result.rate,
        source: result.meta.source,
        endpoint: result.meta.endpoint || undefined,
        status: result.meta.status ?? undefined,
      });
    }

    const upsertResult: { upserts: number } = await ctx.runMutation(
      (internal as any).tax._upsertFxRates,
      {
        rows,
      },
    );

    return {
      requested: requestedPairs.size,
      upserts: upsertResult.upserts,
    };
  },
});

export const requestFxRefreshForFiscalYear = mutation({
  args: {
    profileId: v.id("profiles"),
    fiscalYear: v.string(),
  },
  handler: async (ctx, args) => {
    await requireProfileAccess(ctx, args.profileId);
    await ctx.scheduler.runAfter(
      0,
      (internal as any).tax._refreshFxRatesForFiscalYearInternal,
      {
        profileId: args.profileId,
        fiscalYear: args.fiscalYear,
      },
    );
    return { queued: true };
  },
});

// Set/replace total tax paid for a jurisdiction + fiscal year.
export const setTaxPaidForFiscalYear = mutation({
  args: {
    profileId: v.id("profiles"),
    jurisdiction: v.union(v.literal("IN"), v.literal("US"), v.literal("TH")),
    fiscalYear: v.string(),
    amount: v.number(),
    date: v.optional(v.string()),
    note: v.optional(v.string()),
    source: v.union(v.literal("manual"), v.literal("bot")),
  },
  handler: async (ctx, args) => {
    await requireProfileAccess(ctx, args.profileId);

    const normalizedFY = normalizeFiscalYearForJurisdiction(
      args.fiscalYear,
      args.jurisdiction,
    );
    console.info("[tax] setTaxPaidForFiscalYear request", {
      profileId: args.profileId,
      jurisdiction: args.jurisdiction,
      fiscalYearInput: args.fiscalYear,
      normalizedFY,
      amount: args.amount,
      date: args.date ?? null,
      source: args.source,
    });

    const existing = await ctx.db
      .query("taxPayments")
      .withIndex("by_profile", (q) => q.eq("profileId", args.profileId))
      .collect();
    const hydratedExisting = await Promise.all(
      existing.map(hydrateTaxPaymentAmount),
    );

    let deletedCount = 0;
    for (const payment of hydratedExisting) {
      const note = payment.note || "";
      if (note.startsWith(AUTO_WITHHOLDING_NOTE_PREFIX)) continue;
      if (
        isPaymentInJurisdictionFiscalYear(
          payment,
          normalizedFY,
          args.jurisdiction,
        )
      ) {
        await ctx.db.delete(payment._id);
        deletedCount += 1;
      }
    }

    if (args.amount <= 0) {
      console.info("[tax] setTaxPaidForFiscalYear deleted-only", {
        profileId: args.profileId,
        jurisdiction: args.jurisdiction,
        normalizedFY,
        deletedCount,
      });
      return { deleted: true, amount: 0 };
    }

    const currencyByJurisdiction = {
      IN: "INR",
      US: "USD",
      TH: "THB",
    } as const;

    const paymentTypeByJurisdiction = {
      IN: "tds",
      US: "withholding",
      TH: "withholding",
    } as const;

    const { end } = getFiscalYearRange(normalizedFY, args.jurisdiction);
    const paymentId = await ctx.db.insert("taxPayments", {
      profileId: args.profileId,
      jurisdiction: args.jurisdiction,
      paymentType: paymentTypeByJurisdiction[args.jurisdiction],
      amountEnc: await encryptNumber(args.amount),
      currency: currencyByJurisdiction[args.jurisdiction],
      date: args.date || end,
      fiscalYear: normalizedFY,
      noteEnc: await encryptOptionalString(
        `${MANUAL_FY_TAX_PAID_NOTE_PREFIX}:${normalizedFY}${args.note ? ` ${args.note}` : ""}`,
      ),
      source: args.source,
    });

    console.info("[tax] setTaxPaidForFiscalYear upserted", {
      profileId: args.profileId,
      jurisdiction: args.jurisdiction,
      normalizedFY,
      deletedCount,
      paymentId,
      insertedAmount: args.amount,
      insertedDate: args.date || end,
    });

    return { paymentId, amount: args.amount };
  },
});
