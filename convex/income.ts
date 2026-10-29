import { query, mutation, internalMutation, internalQuery } from "./_generated/server";
import { v } from "convex/values";
import {
  requireAuth,
  requireProfileAccess,
  requireIncomeEntryAccess,
} from "./lib/auth";
import {
  decryptNumberWithFallback,
  decryptSalaryDetailsWithFallback,
  decryptStringWithFallback,
  encryptNumber,
  encryptOptionalNumber,
  encryptOptionalString,
  encryptSalaryDetails,
} from "./lib/fieldEncryption";

const salaryDetailsValidator = v.object({
  baseAmount: v.optional(v.number()),
  bonusAmount: v.optional(v.number()),
  allowanceAmount: v.optional(v.number()),
  reimbursementAmount: v.optional(v.number()),
  otherTaxableBenefitsAmount: v.optional(v.number()),
  socialSecurityEmployeeAmount: v.optional(v.number()),
  taxWithheldAmount: v.optional(v.number()),
});

const AUTO_WITHHOLDING_NOTE_PREFIX = "[auto_withholding_income_entry]";

function autoWithholdingNote(entryId: string) {
  return `${AUTO_WITHHOLDING_NOTE_PREFIX}:${entryId}`;
}

async function hydrateIncomeEntry<
  T extends {
    amount?: number;
    amountEnc?: string;
    netReceivedAmount?: number;
    netReceivedAmountEnc?: string;
    salaryDetails?: any;
    salaryDetailsEnc?: any;
    note?: string;
    noteEnc?: string;
  },
>(row: T) {
  return {
    ...row,
    amount: await decryptNumberWithFallback(
      row.amountEnc,
      row.amount,
      "incomeEntries.amount",
    ),
    netReceivedAmount:
      row.netReceivedAmountEnc !== undefined
        ? await decryptNumberWithFallback(
            row.netReceivedAmountEnc,
            row.netReceivedAmount,
            "incomeEntries.netReceivedAmount",
          )
        : row.netReceivedAmount,
    salaryDetails: await decryptSalaryDetailsWithFallback(
      row.salaryDetailsEnc,
      row.salaryDetails,
    ),
    note: await decryptStringWithFallback(row.noteEnc, row.note),
  };
}

export function fiscalYearFromDateForJurisdiction(
  date: string,
  jurisdiction: "IN" | "US" | "TH",
) {
  const [yearRaw, monthRaw] = date.split("-");
  const year = Number(yearRaw);
  const month = Number(monthRaw);
  const safeYear = Number.isFinite(year) ? year : new Date().getFullYear();
  const safeMonth = Number.isFinite(month) ? month : 1;

  if (jurisdiction === "IN") {
    if (safeMonth >= 4) {
      return `${safeYear}-${String((safeYear + 1) % 100).padStart(2, "0")}`;
    }
    return `${safeYear - 1}-${String(safeYear % 100).padStart(2, "0")}`;
  }
  return String(safeYear);
}

async function syncAutoWithholdingTaxPayment(
  ctx: any,
  args: {
    entryId: string;
    profileId: any;
    jurisdiction: "IN" | "US" | "TH";
    currency: "INR" | "USD" | "THB";
    date: string;
    taxWithheldAmount?: number;
    source: "manual" | "bot" | "csv_import";
  },
) {
  const marker = autoWithholdingNote(args.entryId);
  const existing = await ctx.db
    .query("taxPayments")
    .withIndex("by_profile", (q: any) => q.eq("profileId", args.profileId))
    .collect();

  for (const row of existing) {
    const note = await decryptStringWithFallback(row.noteEnc, row.note);
    if (note === marker) await ctx.db.delete(row._id);
  }

  const amount = Math.max(0, args.taxWithheldAmount || 0);
  if (amount <= 0) return;

  const paymentType = args.jurisdiction === "IN" ? "tds" : "withholding";
  const fiscalYear = fiscalYearFromDateForJurisdiction(args.date, args.jurisdiction);

  await ctx.db.insert("taxPayments", {
    profileId: args.profileId,
    jurisdiction: args.jurisdiction,
    paymentType,
    amountEnc: await encryptNumber(amount),
    currency: args.currency,
    date: args.date,
    fiscalYear,
    noteEnc: await encryptOptionalString(marker),
    source: args.source === "bot" ? "bot" : "manual",
  });
}

// Get all income categories
export const listCategories = query({
  args: {},
  handler: async (ctx) => {
    await requireAuth(ctx);
    return await ctx.db
      .query("incomeCategories")
      .filter((q) => q.eq(q.field("isActive"), true))
      .collect();
  },
});

// Get categories grouped by group name
export const listCategoriesGrouped = query({
  args: {},
  handler: async (ctx) => {
    await requireAuth(ctx);
    const categories = await ctx.db
      .query("incomeCategories")
      .filter((q) => q.eq(q.field("isActive"), true))
      .collect();

    const grouped: Record<string, typeof categories> = {};
    for (const cat of categories) {
      const groupName = cat.groupName || "Other";
      if (!grouped[groupName]) {
        grouped[groupName] = [];
      }
      grouped[groupName].push(cat);
    }
    return grouped;
  },
});

// Get income entries by month with category info
export const listByMonthWithCategories = query({
  args: {
    profileId: v.id("profiles"),
    monthYear: v.string(),
  },
  handler: async (ctx, args) => {
    await requireProfileAccess(ctx, args.profileId);

    const entries = await ctx.db
      .query("incomeEntries")
      .withIndex("by_profile_date", (q) => q.eq("profileId", args.profileId))
      .collect();

    const filtered = entries.filter((e) => e.date.startsWith(args.monthYear));

    const enriched = await Promise.all(
      filtered.map(async (entry) => {
        const hydrated = await hydrateIncomeEntry(entry);
        const category = await ctx.db.get(entry.categoryId);
        return {
          ...hydrated,
          categoryName: category?.name || "Unknown",
          groupName: (category as any)?.groupName || "Other",
        };
      }),
    );

    return enriched;
  },
});

// Get total income by month
export const getTotalByMonth = query({
  args: {
    profileId: v.id("profiles"),
    monthYear: v.string(),
  },
  handler: async (ctx, args) => {
    await requireProfileAccess(ctx, args.profileId);

    const entries = await ctx.db
      .query("incomeEntries")
      .withIndex("by_profile_date", (q) => q.eq("profileId", args.profileId))
      .collect();

    const filtered = entries.filter((e) => e.date.startsWith(args.monthYear));
    let total = 0;
    for (const entry of filtered) {
      const hydrated = await hydrateIncomeEntry(entry);
      total += hydrated.amount;
    }
    return total;
  },
});

// Get totals by currency for a month
export const getTotalsByCurrency = query({
  args: {
    profileId: v.id("profiles"),
    monthYear: v.string(),
  },
  handler: async (ctx, args) => {
    await requireProfileAccess(ctx, args.profileId);

    const entries = await ctx.db
      .query("incomeEntries")
      .withIndex("by_profile_date", (q) => q.eq("profileId", args.profileId))
      .collect();

    const filtered = entries.filter((e) => e.date.startsWith(args.monthYear));

    const byCurrency = {
      INR: 0,
      USD: 0,
      THB: 0,
    };

    for (const entry of filtered) {
      const hydrated = await hydrateIncomeEntry(entry);
      const currency = entry.currency || "INR";
      if (currency in byCurrency) {
        byCurrency[currency as keyof typeof byCurrency] += hydrated.amount;
      }
    }

    return byCurrency;
  },
});

// Get monthly totals by currency for a range (YYYY-MM)
export const getMonthlyTotalsByCurrency = query({
  args: {
    profileId: v.id("profiles"),
    startMonth: v.string(),
    endMonth: v.string(),
  },
  handler: async (ctx, args) => {
    await requireProfileAccess(ctx, args.profileId);

    const months: string[] = [];
    const start = new Date(`${args.startMonth}-01T00:00:00`);
    const end = new Date(`${args.endMonth}-01T00:00:00`);
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return [];
    const cursor = new Date(start);
    while (cursor <= end) {
      const month = `${cursor.getFullYear()}-${String(cursor.getMonth() + 1).padStart(2, "0")}`;
      months.push(month);
      cursor.setMonth(cursor.getMonth() + 1);
    }

    const startDate = `${args.startMonth}-01`;
    const endDate = `${args.endMonth}-31`;
    const entries = await ctx.db
      .query("incomeEntries")
      .withIndex("by_profile_date", (q) => q.eq("profileId", args.profileId))
      .collect();

    const filtered = entries.filter(
      (e) => e.date >= startDate && e.date <= endDate,
    );
    const byMonth = new Map<string, { INR: number; USD: number; THB: number }>();
    for (const month of months) {
      byMonth.set(month, { INR: 0, USD: 0, THB: 0 });
    }
    for (const entry of filtered) {
      const hydrated = await hydrateIncomeEntry(entry);
      const month = entry.date.substring(0, 7);
      const bucket = byMonth.get(month);
      if (!bucket) continue;
      const currency = (entry.currency || "INR") as "INR" | "USD" | "THB";
      bucket[currency] += hydrated.amount;
    }
    return months.map((month) => ({ month, totals: byMonth.get(month)! }));
  },
});

// Get income entries for a profile
export const listByProfile = query({
  args: {
    profileId: v.id("profiles"),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    await requireProfileAccess(ctx, args.profileId);

    const rows = await ctx.db
      .query("incomeEntries")
      .withIndex("by_profile_date", (q) => q.eq("profileId", args.profileId))
      .order("desc")
      .take(args.limit || 50);
    return await Promise.all(rows.map(hydrateIncomeEntry));
  },
});

// Get income entries by jurisdiction
export const listByJurisdiction = query({
  args: {
    profileId: v.id("profiles"),
    jurisdiction: v.union(v.literal("IN"), v.literal("US"), v.literal("TH")),
  },
  handler: async (ctx, args) => {
    await requireProfileAccess(ctx, args.profileId);

    const rows = await ctx.db
      .query("incomeEntries")
      .withIndex("by_profile_jurisdiction", (q) =>
        q.eq("profileId", args.profileId).eq("jurisdiction", args.jurisdiction),
      )
      .collect();
    return await Promise.all(rows.map(hydrateIncomeEntry));
  },
});

// Get total income for a profile by jurisdiction
export const getTotalByJurisdiction = query({
  args: {
    profileId: v.id("profiles"),
    jurisdiction: v.union(v.literal("IN"), v.literal("US"), v.literal("TH")),
  },
  handler: async (ctx, args) => {
    await requireProfileAccess(ctx, args.profileId);

    const entries = await ctx.db
      .query("incomeEntries")
      .withIndex("by_profile_jurisdiction", (q) =>
        q.eq("profileId", args.profileId).eq("jurisdiction", args.jurisdiction),
      )
      .collect();
    const hydratedEntries = await Promise.all(entries.map(hydrateIncomeEntry));

    const byType = {
      salary: 0,
      business: 0,
      investment: 0,
      other: 0,
    };

    for (const entry of hydratedEntries) {
      byType[entry.incomeType] += entry.amount;
    }

    return {
      total: hydratedEntries.reduce((sum, e) => sum + e.amount, 0),
      byType,
    };
  },
});

// Add income entry
export const add = mutation({
  args: {
    profileId: v.id("profiles"),
    categoryId: v.id("incomeCategories"),
    amount: v.number(),
    netReceivedAmount: v.optional(v.number()),
    salaryDetails: v.optional(salaryDetailsValidator),
    currency: v.optional(
      v.union(v.literal("INR"), v.literal("USD"), v.literal("THB")),
    ),
    date: v.string(),
    jurisdiction: v.union(v.literal("IN"), v.literal("US"), v.literal("TH")),
    incomeType: v.union(
      v.literal("salary"),
      v.literal("business"),
      v.literal("investment"),
      v.literal("other"),
    ),
    note: v.optional(v.string()),
    source: v.union(
      v.literal("manual"),
      v.literal("bot"),
      v.literal("csv_import"),
    ),
  },
  handler: async (ctx, args) => {
    await requireProfileAccess(ctx, args.profileId);
    const entryId = await ctx.db.insert("incomeEntries", {
      profileId: args.profileId,
      categoryId: args.categoryId,
      date: args.date,
      jurisdiction: args.jurisdiction,
      incomeType: args.incomeType,
      noteEnc: await encryptOptionalString(args.note),
      source: args.source,
      amountEnc: await encryptNumber(args.amount),
      netReceivedAmountEnc: await encryptOptionalNumber(args.netReceivedAmount),
      salaryDetailsEnc: await encryptSalaryDetails(args.salaryDetails),
      currency: args.currency || "INR",
    });
    await syncAutoWithholdingTaxPayment(ctx, {
      entryId,
      profileId: args.profileId,
      jurisdiction: args.jurisdiction,
      currency: (args.currency || "INR") as "INR" | "USD" | "THB",
      date: args.date,
      taxWithheldAmount: args.salaryDetails?.taxWithheldAmount,
      source: args.source,
    });
    return entryId;
  },
});

// Update income entry
export const update = mutation({
  args: {
    entryId: v.id("incomeEntries"),
    amount: v.optional(v.number()),
    netReceivedAmount: v.optional(v.number()),
    salaryDetails: v.optional(salaryDetailsValidator),
    note: v.optional(v.string()),
    date: v.optional(v.string()),
    categoryId: v.optional(v.id("incomeCategories")),
  },
  handler: async (ctx, args) => {
    await requireIncomeEntryAccess(ctx, args.entryId);
    const existing = await ctx.db.get(args.entryId);
    if (!existing) return;
    const { entryId, ...updates } = args;
    const patch: Record<string, unknown> = {};
    if (updates.amount !== undefined) {
      patch.amountEnc = await encryptNumber(updates.amount);
    }
    if (updates.netReceivedAmount !== undefined) {
      patch.netReceivedAmountEnc = await encryptOptionalNumber(
        updates.netReceivedAmount,
      );
    }
    if (updates.salaryDetails !== undefined) {
      patch.salaryDetailsEnc = await encryptSalaryDetails(updates.salaryDetails);
    }
    if (updates.note !== undefined) {
      patch.noteEnc = await encryptOptionalString(updates.note);
      patch.note = undefined;
    }
    if (updates.date !== undefined) patch.date = updates.date;
    if (updates.categoryId !== undefined) patch.categoryId = updates.categoryId;
    await ctx.db.patch(entryId, patch);

    const hydratedExisting = await hydrateIncomeEntry(existing);
    const nextDate = updates.date ?? existing.date;
    const nextJurisdiction = existing.jurisdiction;
    const nextCurrency = (existing.currency || "INR") as "INR" | "USD" | "THB";
    const nextSource = existing.source as "manual" | "bot" | "csv_import";
    const nextSalaryDetails =
      updates.salaryDetails !== undefined
        ? updates.salaryDetails
        : hydratedExisting.salaryDetails;

    await syncAutoWithholdingTaxPayment(ctx, {
      entryId,
      profileId: existing.profileId,
      jurisdiction: nextJurisdiction,
      currency: nextCurrency,
      date: nextDate,
      taxWithheldAmount: nextSalaryDetails?.taxWithheldAmount,
      source: nextSource,
    });
  },
});

// Delete income entry
export const remove = mutation({
  args: { entryId: v.id("incomeEntries") },
  handler: async (ctx, args) => {
    await requireIncomeEntryAccess(ctx, args.entryId);
    const existing = await ctx.db.get(args.entryId);
    if (existing) {
      await syncAutoWithholdingTaxPayment(ctx, {
        entryId: args.entryId,
        profileId: existing.profileId,
        jurisdiction: existing.jurisdiction,
        currency: (existing.currency || "INR") as "INR" | "USD" | "THB",
        date: existing.date,
        taxWithheldAmount: 0,
        source: existing.source as "manual" | "bot" | "csv_import",
      });
    }
    await ctx.db.delete(args.entryId);
  },
});

// INTERNAL ONLY: Wipe all income entries (Dashboard only)
export const wipeAllEntries = internalMutation({
  args: {},
  handler: async (ctx) => {
    const entries = await ctx.db.query("incomeEntries").collect();
    for (const entry of entries) {
      await ctx.db.delete(entry._id);
    }
    return { deleted: entries.length };
  },
});

function normalizeCategoryName(name: string) {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ");
}

type CleanupRule = { from: string; to: string };

const DEFAULT_CANONICAL_MERGE_RULES: CleanupRule[] = [
  // Fold compensation fragments into Salary
  { from: "Bonus", to: "Salary" },
  { from: "Sign On Bonus", to: "Salary" },
  { from: "Joining Bonus", to: "Salary" },
  { from: "Reimbursement", to: "Salary" },
  { from: "WFH Allowance", to: "Salary" },
  { from: "WFH Allowances", to: "Salary" },
  { from: "Health Plan Income", to: "Salary" },
  { from: "Gross Up Income", to: "Salary" },
  { from: "Allowance", to: "Salary" },

  // Common duplicate variants
  { from: "Consulting", to: "Professional Services" },
  { from: "Consulting Fee", to: "Professional Services" },
  { from: "Consultancy Fee", to: "Professional Services" },
  { from: "Professional Income", to: "Professional Services" },
  { from: "Income from Profession", to: "Professional Services" },
  { from: "Profession Income", to: "Professional Services" },
  { from: "Freelance Income", to: "Freelance" },
  { from: "Freelancing Income", to: "Freelance" },
  { from: "Free", to: "Freelance" },

  // Investment duplicates
  { from: "Interest Income", to: "Interest" },
  { from: "Bank Interest", to: "Interest" },
  { from: "Savings Interest", to: "Interest" },
  { from: "STCG", to: "Short Term Capital Gains" },
  { from: "Short-term Capital Gains", to: "Short Term Capital Gains" },
  { from: "Short Term Capital Gain", to: "Short Term Capital Gains" },
  { from: "LTCG", to: "Long Term Capital Gains" },
  { from: "Long-term Capital Gains", to: "Long Term Capital Gains" },
  { from: "Long Term Capital Gain", to: "Long Term Capital Gains" },
];

const CANONICAL_TARGET_GROUP: Record<string, string> = {
  Salary: "Employment",
  "Professional Services": "Business",
  Freelance: "Business",
  Interest: "Investment",
  "Short Term Capital Gains": "Investment",
  "Long Term Capital Gains": "Investment",
};

function canonicalTargetForCategoryName(name: string): string | null {
  const normalized = normalizeCategoryName(name);

  // Fold compensation fragments into Salary
  if (
    /\b(bonus|sign on|joining|reimburs\w*|allowance|wfh|health plan|gross up)\b/.test(
      normalized,
    )
  ) {
    return "Salary";
  }

  // Fold consulting/profession variants into Professional Services (Business)
  if (
    (/\bconsult/.test(normalized) && normalized !== "consulting") ||
    /\bprofession/.test(normalized)
  ) {
    return "Professional Services";
  }

  // Fold freelance variants / obvious typo bucket
  if (
    /\bfreelanc/.test(normalized) ||
    normalized === "free" ||
    normalized === "freelance income"
  ) {
    return "Freelance";
  }

  // Fold interest variants (but keep capital gains separate)
  if (/\binterest\b/.test(normalized) && !/\bcapital gain|stcg|ltcg\b/.test(normalized)) {
    return "Interest";
  }

  // Fold STCG variants
  if (
    /\bstcg\b/.test(normalized) ||
    /\bshort term capital gain/.test(normalized) ||
    /\bshort term gain/.test(normalized)
  ) {
    return "Short Term Capital Gains";
  }

  // Fold LTCG variants
  if (
    /\bltcg\b/.test(normalized) ||
    /\blong term capital gain/.test(normalized) ||
    /\blong term gain/.test(normalized)
  ) {
    return "Long Term Capital Gains";
  }

  return null;
}

// INTERNAL ONLY: Preview duplicate income categories and usage
export const previewIncomeCategoryCleanup = internalQuery({
  args: {},
  handler: async (ctx) => {
    const [categories, entries] = await Promise.all([
      ctx.db.query("incomeCategories").collect(),
      ctx.db.query("incomeEntries").collect(),
    ]);

    const usageByCategory = new Map<string, number>();
    for (const entry of entries) {
      const key = String(entry.categoryId);
      usageByCategory.set(key, (usageByCategory.get(key) || 0) + 1);
    }

    const byNormalized = new Map<string, typeof categories>();
    for (const category of categories) {
      const key = normalizeCategoryName(category.name);
      if (!byNormalized.has(key)) byNormalized.set(key, []);
      byNormalized.get(key)!.push(category);
    }

    const duplicateGroups = Array.from(byNormalized.entries())
      .filter(([, cats]) => cats.length > 1)
      .map(([normalized, cats]) => ({
        normalized,
        categories: cats.map((cat) => ({
          id: cat._id,
          name: cat.name,
          groupName: cat.groupName,
          isActive: cat.isActive,
          usageCount: usageByCategory.get(String(cat._id)) || 0,
        })),
      }));

    return {
      totalCategories: categories.length,
      activeCategories: categories.filter((c) => c.isActive).length,
      duplicateGroups,
      categories: categories.map((cat) => ({
        id: cat._id,
        name: cat.name,
        groupName: cat.groupName,
        isActive: cat.isActive,
        usageCount: usageByCategory.get(String(cat._id)) || 0,
      })),
    };
  },
});

// INTERNAL ONLY: Merge duplicate/redundant income categories and re-point entries
export const cleanupIncomeCategories = internalMutation({
  args: {
    mergeRules: v.optional(
      v.array(
        v.object({
          from: v.string(),
          to: v.string(),
        }),
      ),
    ),
    dryRun: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const dryRun = !!args.dryRun;
    const explicitRules: CleanupRule[] =
      args.mergeRules && args.mergeRules.length > 0
        ? args.mergeRules
        : DEFAULT_CANONICAL_MERGE_RULES;

    const [categories, entries] = await Promise.all([
      ctx.db.query("incomeCategories").collect(),
      ctx.db.query("incomeEntries").collect(),
    ]);

    const categoryById = new Map(categories.map((c) => [String(c._id), c]));
    const entryIdsByCategory = new Map<string, string[]>();
    for (const entry of entries) {
      const key = String(entry.categoryId);
      if (!entryIdsByCategory.has(key)) entryIdsByCategory.set(key, []);
      entryIdsByCategory.get(key)!.push(String(entry._id));
    }

    const merges: Array<{
      fromId: string;
      fromName: string;
      toId: string;
      toName: string;
      movedEntries: number;
      reason: "explicit_rule" | "normalized_duplicate" | "canonical_pattern";
    }> = [];
    const deletedCategoryIds = new Set<string>();

    const findCategoryByName = (name: string) => {
      const normalized = name.trim().toLowerCase();
      return Array.from(categoryById.values()).find(
        (cat) => cat.name.trim().toLowerCase() === normalized,
      );
    };

    const ensureTargetCategory = async (name: string, fallbackGroup?: string) => {
      const existing = findCategoryByName(name);
      if (existing) return existing;
      if (dryRun) return null;
      const newId = await ctx.db.insert("incomeCategories", {
        name,
        groupName: CANONICAL_TARGET_GROUP[name] || fallbackGroup || "Other",
        isActive: true,
      });
      const created = await ctx.db.get(newId);
      if (!created) return null;
      categoryById.set(String(created._id), created);
      entryIdsByCategory.set(String(created._id), []);
      return created;
    };

    const moveCategory = async (
      fromId: string,
      toId: string,
      reason: "explicit_rule" | "normalized_duplicate" | "canonical_pattern",
    ) => {
      if (fromId === toId) return;
      const fromCategory = categoryById.get(fromId);
      const toCategory = categoryById.get(toId);
      if (!fromCategory || !toCategory) return;

      const movedEntryIds = entryIdsByCategory.get(fromId) || [];
      if (!dryRun) {
        for (const entryId of movedEntryIds) {
          await ctx.db.patch(entryId as any, { categoryId: toCategory._id });
        }
        await ctx.db.delete(fromCategory._id);
      }
      deletedCategoryIds.add(fromId);

      const targetEntries = entryIdsByCategory.get(toId) || [];
      entryIdsByCategory.set(toId, [...targetEntries, ...movedEntryIds]);
      entryIdsByCategory.set(fromId, []);
      categoryById.delete(fromId);

      merges.push({
        fromId,
        fromName: fromCategory.name,
        toId,
        toName: toCategory.name,
        movedEntries: movedEntryIds.length,
        reason,
      });
    };

    // 1) Apply explicit user-provided merge rules first
    for (const rule of explicitRules) {
      const from = findCategoryByName(rule.from);
      if (!from) continue;
      const to = await ensureTargetCategory(
        rule.to,
        CANONICAL_TARGET_GROUP[rule.to] || from.groupName || "Other",
      );
      if (!to) continue;
      await moveCategory(String(from._id), String(to._id), "explicit_rule");
    }

    // 2) Auto-merge exact normalized duplicates
    const byNormalized = new Map<string, string[]>();
    for (const cat of categoryById.values()) {
      const key = normalizeCategoryName(cat.name);
      if (!byNormalized.has(key)) byNormalized.set(key, []);
      byNormalized.get(key)!.push(String(cat._id));
    }

    for (const ids of byNormalized.values()) {
      if (ids.length < 2) continue;
      const ranked = ids
        .map((id) => ({
          id,
          cat: categoryById.get(id)!,
          usage: (entryIdsByCategory.get(id) || []).length,
        }))
        .sort((a, b) => {
          if (a.usage !== b.usage) return b.usage - a.usage;
          if (a.cat.isActive !== b.cat.isActive) return a.cat.isActive ? -1 : 1;
          return a.cat.name.localeCompare(b.cat.name);
        });

      const canonical = ranked[0];
      if (!canonical) continue;
      for (const dupe of ranked.slice(1)) {
        await moveCategory(dupe.id, canonical.id, "normalized_duplicate");
      }
    }

    // 3) Canonical pattern-based merge (handles near-duplicates/variants)
    const categorySnapshot = Array.from(categoryById.values());
    for (const cat of categorySnapshot) {
      const targetName = canonicalTargetForCategoryName(cat.name);
      if (!targetName) continue;
      if (cat.name.trim().toLowerCase() === targetName.trim().toLowerCase()) {
        continue;
      }
      const target = await ensureTargetCategory(
        targetName,
        CANONICAL_TARGET_GROUP[targetName] || cat.groupName || "Other",
      );
      if (!target) continue;
      await moveCategory(String(cat._id), String(target._id), "canonical_pattern");
    }

    return {
      dryRun,
      totalCategoriesBefore: categories.length,
      totalCategoriesAfter: categoryById.size,
      categoriesDeleted: deletedCategoryIds.size,
      mergesApplied: merges.length,
      entriesMoved: merges.reduce((sum, m) => sum + m.movedEntries, 0),
      merges,
    };
  },
});
