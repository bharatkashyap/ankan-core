import { query, mutation, internalMutation, internalQuery } from "./_generated/server";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import {
  requireAuth,
  requireProfileAccess,
  requireExpenseEntryAccess,
} from "./lib/auth";
import {
  decryptNumberWithFallback,
  decryptStringWithFallback,
  encryptNumber,
  encryptOptionalString,
} from "./lib/fieldEncryption";

type ExpenseCleanupRule = { from: string; to: string };

async function hydrateExpenseEntry<
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
      "expenseEntries.amount",
    ),
    note: await decryptStringWithFallback(row.noteEnc, row.note),
  };
}

function normalizeExpenseCategoryName(name: string) {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ");
}

const DEFAULT_EXPENSE_MERGE_RULES: ExpenseCleanupRule[] = [
  { from: "Ordering In", to: "Food Delivery" },
  { from: "Metro", to: "Public Transit" },
  { from: "Auto/Taxi", to: "Cabs & Rideshare" },
  { from: "Vehicle Service", to: "Vehicle Maintenance" },
  { from: "Mobile", to: "Phone" },
  { from: "Doctor", to: "Medical" },
  { from: "Health Insurance", to: "Insurance" },
  { from: "Gym", to: "Gym & Fitness" },
  { from: "Movies", to: "Entertainment" },
  { from: "Events", to: "Events & Activities" },
  { from: "Books", to: "Books & Learning" },
  { from: "Charity", to: "Charity & Donations" },
  { from: "Credit Card Fees", to: "Credit Card Interest" },

  // subscriptions collapse
  { from: "Netflix", to: "Streaming" },
  { from: "Amazon Prime", to: "Streaming" },
  { from: "Hotstar", to: "Streaming" },
  { from: "YouTube Premium", to: "Streaming" },
  { from: "Sony LIV", to: "Streaming" },
  { from: "Apple Music", to: "Music" },
  { from: "Spotify", to: "Music" },
  { from: "Apple One", to: "Streaming" },
  { from: "iCloud", to: "Cloud Storage" },
  { from: "Google One", to: "Cloud Storage" },
  { from: "Cursor", to: "Software" },
  { from: "ChatGPT", to: "Software" },
  { from: "Other Software", to: "Software" },
];

function canonicalTargetForExpenseCategoryName(name: string): string | null {
  const n = normalizeExpenseCategoryName(name);
  if (/\border(ing)? in|food delivery\b/.test(n)) return "Food Delivery";
  if (/\bmetro|public transit\b/.test(n)) return "Public Transit";
  if (/\bauto taxi|taxi|cab|rideshare\b/.test(n)) return "Cabs & Rideshare";
  if (/\bvehicle (service|maintenance)\b/.test(n)) return "Vehicle Maintenance";
  if (/\bmobile|phone\b/.test(n)) return "Phone";
  if (/\bdoctor|medical\b/.test(n)) return "Medical";
  if (/\bhealth insurance|insurance\b/.test(n)) return "Insurance";
  if (/\bgym|fitness\b/.test(n)) return "Gym & Fitness";
  if (/\bmovies?\b/.test(n)) return "Entertainment";
  if (/\bevents?\b/.test(n)) return "Events & Activities";
  if (/\bbooks?\b/.test(n)) return "Books & Learning";
  if (/\bcharity|donation\b/.test(n)) return "Charity & Donations";
  if (/\bcredit card fee|credit card interest\b/.test(n)) return "Credit Card Interest";
  if (/\bnetflix|prime|hotstar|youtube premium|sony liv|apple one|streaming\b/.test(n)) {
    return "Streaming";
  }
  if (/\bapple music|spotify|music\b/.test(n)) return "Music";
  if (/\bicloud|google one|cloud storage\b/.test(n)) return "Cloud Storage";
  if (/\bcursor|chatgpt|software\b/.test(n)) return "Software";
  return null;
}

// Get all expense categories
export const listCategories = query({
  args: {},
  handler: async (ctx) => {
    await requireAuth(ctx);
    return await ctx.db
      .query("expenseCategories")
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
      .query("expenseCategories")
      .filter((q) => q.eq(q.field("isActive"), true))
      .collect();

    const grouped: Record<string, typeof categories> = {};
    for (const cat of categories) {
      if (!grouped[cat.groupName]) {
        grouped[cat.groupName] = [];
      }
      grouped[cat.groupName]!.push(cat);
    }
    return grouped;
  },
});

// Get expense entries for a profile by month
export const listByMonth = query({
  args: {
    profileId: v.id("profiles"),
    monthYear: v.string(), // Format: "YYYY-MM"
  },
  handler: async (ctx, args) => {
    await requireProfileAccess(ctx, args.profileId);

    const entries = await ctx.db
      .query("expenseEntries")
      .withIndex("by_profile_date", (q) => q.eq("profileId", args.profileId))
      .collect();

    const filtered = entries.filter((e) => e.date.startsWith(args.monthYear));
    return await Promise.all(filtered.map(hydrateExpenseEntry));
  },
});

// Get expense entries with category info
export const listByMonthWithCategories = query({
  args: {
    profileId: v.id("profiles"),
    monthYear: v.string(),
  },
  handler: async (ctx, args) => {
    await requireProfileAccess(ctx, args.profileId);

    const entries = await ctx.db
      .query("expenseEntries")
      .withIndex("by_profile_date", (q) => q.eq("profileId", args.profileId))
      .collect();

    const filtered = entries.filter((e) => e.date.startsWith(args.monthYear));

    const enriched = await Promise.all(
      filtered.map(async (entry) => {
        const hydrated = await hydrateExpenseEntry(entry);
        const category = await ctx.db.get(entry.categoryId);
        return {
          ...hydrated,
          categoryName: category?.name || "Unknown",
          groupName: category?.groupName || "Other",
        };
      }),
    );

    return enriched;
  },
});

// Get total expenses by month
export const getTotalByMonth = query({
  args: {
    profileId: v.id("profiles"),
    monthYear: v.string(),
  },
  handler: async (ctx, args) => {
    await requireProfileAccess(ctx, args.profileId);

    const entries = await ctx.db
      .query("expenseEntries")
      .withIndex("by_profile_date", (q) => q.eq("profileId", args.profileId))
      .collect();

    const filtered = entries.filter((e) => e.date.startsWith(args.monthYear));
    let total = 0;
    for (const entry of filtered) {
      const hydrated = await hydrateExpenseEntry(entry);
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
      .query("expenseEntries")
      .withIndex("by_profile_date", (q) => q.eq("profileId", args.profileId))
      .collect();

    const filtered = entries.filter((e) => e.date.startsWith(args.monthYear));

    const byCurrency = {
      INR: 0,
      USD: 0,
      THB: 0,
    };

    for (const entry of filtered) {
      const hydrated = await hydrateExpenseEntry(entry);
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
      .query("expenseEntries")
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
      const hydrated = await hydrateExpenseEntry(entry);
      const month = entry.date.substring(0, 7);
      const bucket = byMonth.get(month);
      if (!bucket) continue;
      const currency = (entry.currency || "INR") as "INR" | "USD" | "THB";
      bucket[currency] += hydrated.amount;
    }
    return months.map((month) => ({ month, totals: byMonth.get(month)! }));
  },
});

// Get available months with expenses
export const getAvailableMonths = query({
  args: { profileId: v.id("profiles") },
  handler: async (ctx, args) => {
    await requireProfileAccess(ctx, args.profileId);

    const entries = await ctx.db
      .query("expenseEntries")
      .withIndex("by_profile", (q) => q.eq("profileId", args.profileId))
      .collect();

    const months = new Set<string>();
    for (const entry of entries) {
      months.add(entry.date.substring(0, 7));
    }
    return Array.from(months).sort().reverse();
  },
});

// Add expense entry
export const add = mutation({
  args: {
    profileId: v.id("profiles"),
    categoryId: v.id("expenseCategories"),
    amount: v.number(),
    currency: v.optional(
      v.union(v.literal("INR"), v.literal("USD"), v.literal("THB")),
    ),
    date: v.string(),
    note: v.optional(v.string()),
    source: v.union(
      v.literal("manual"),
      v.literal("bot"),
      v.literal("csv_import"),
    ),
  },
  handler: async (ctx, args) => {
    await requireProfileAccess(ctx, args.profileId);

    return await ctx.db.insert("expenseEntries", {
      profileId: args.profileId,
      categoryId: args.categoryId,
      date: args.date,
      noteEnc: await encryptOptionalString(args.note),
      source: args.source,
      amountEnc: await encryptNumber(args.amount),
      currency: args.currency || "INR", // Default to INR
    });
  },
});

// Update expense entry
export const update = mutation({
  args: {
    entryId: v.id("expenseEntries"),
    amount: v.optional(v.number()),
    note: v.optional(v.string()),
    date: v.optional(v.string()),
    categoryId: v.optional(v.id("expenseCategories")),
  },
  handler: async (ctx, args) => {
    await requireExpenseEntryAccess(ctx, args.entryId);
    const { entryId, ...updates } = args;
    // Remove undefined fields so we don't overwrite with undefined
    const patch: Record<string, unknown> = {};
    if (updates.amount !== undefined) {
      patch.amountEnc = await encryptNumber(updates.amount);
    }
    if (updates.note !== undefined) {
      patch.noteEnc = await encryptOptionalString(updates.note);
      patch.note = undefined;
    }
    if (updates.date !== undefined) patch.date = updates.date;
    if (updates.categoryId !== undefined) patch.categoryId = updates.categoryId;
    await ctx.db.patch(entryId, patch);
    if (updates.date !== undefined) await ctx.scheduler.runAfter(0, (internal as any).tripReportActions.refreshLinkedExpenseFx, { expenseId: entryId });
  },
});

// Delete expense entry
export const remove = mutation({
  args: { entryId: v.id("expenseEntries") },
  handler: async (ctx, args) => {
    await requireExpenseEntryAccess(ctx, args.entryId);
    await ctx.db.delete(args.entryId);
  },
});

// Bulk add expenses - for importing from CSV
export const bulkAdd = mutation({
  args: {
    profileId: v.id("profiles"),
    entries: v.array(
      v.object({
        categoryName: v.string(),
        amount: v.number(),
        currency: v.optional(
          v.union(v.literal("INR"), v.literal("USD"), v.literal("THB")),
        ),
        date: v.string(),
        note: v.optional(v.string()),
      }),
    ),
  },
  handler: async (ctx, args) => {
    await requireProfileAccess(ctx, args.profileId);

    // Get all categories for lookup
    const categories = await ctx.db.query("expenseCategories").collect();
    const categoryMap = new Map(categories.map((c) => [c.name, c._id]));

    let inserted = 0;
    let skipped = 0;

    for (const entry of args.entries) {
      const categoryId = categoryMap.get(entry.categoryName);
      if (!categoryId) {
        console.warn(`Category not found: ${entry.categoryName}`);
        skipped++;
        continue;
      }

      await ctx.db.insert("expenseEntries", {
        profileId: args.profileId,
        categoryId,
        amountEnc: await encryptNumber(entry.amount),
        currency: entry.currency || "INR",
        date: entry.date,
        noteEnc: await encryptOptionalString(entry.note),
        source: "csv_import",
      });
      inserted++;
    }

    return { inserted, skipped };
  },
});

// INTERNAL ONLY: Wipe all expense entries (Dashboard only)
export const wipeAllEntries = internalMutation({
  args: {},
  handler: async (ctx) => {
    const entries = await ctx.db.query("expenseEntries").collect();
    for (const entry of entries) {
      await ctx.db.delete(entry._id);
    }
    return { deleted: entries.length };
  },
});

// INTERNAL ONLY: Wipe all categories and reseed with clean list (Dashboard only)
export const wipeAndReseedCategories = internalMutation({
  args: {},
  handler: async (ctx) => {
    // Delete all existing categories
    const existing = await ctx.db.query("expenseCategories").collect();
    for (const cat of existing) {
      await ctx.db.delete(cat._id);
    }

    // Comprehensive category list with specific sub-categories for tracking
    const categories = [
      // Housing & Home
      { name: "Rent", groupName: "Housing", isActive: true },
      { name: "Maintenance", groupName: "Housing", isActive: true },
      { name: "Domestic Help", groupName: "Housing", isActive: true },
      { name: "Home Repairs", groupName: "Housing", isActive: true },

      // Food & Dining
      { name: "Grocery", groupName: "Food & Dining", isActive: true },
      { name: "Dining Out", groupName: "Food & Dining", isActive: true },
      { name: "Ordering In", groupName: "Food & Dining", isActive: true },
      { name: "Coffee & Snacks", groupName: "Food & Dining", isActive: true },

      // Transport
      { name: "Fuel", groupName: "Transport", isActive: true },
      { name: "Metro", groupName: "Transport", isActive: true },
      { name: "Auto/Taxi", groupName: "Transport", isActive: true },
      { name: "Parking", groupName: "Transport", isActive: true },
      { name: "Vehicle Service", groupName: "Transport", isActive: true },
      { name: "Cabs & Rideshare", groupName: "Transport", isActive: true },

      // Utilities & Bills
      { name: "Electricity", groupName: "Utilities", isActive: true },
      { name: "Water", groupName: "Utilities", isActive: true },
      { name: "Gas", groupName: "Utilities", isActive: true },
      { name: "Internet", groupName: "Utilities", isActive: true },
      { name: "Mobile", groupName: "Utilities", isActive: true },

      // Streaming & Entertainment Subscriptions
      { name: "Netflix", groupName: "Subscriptions", isActive: true },
      { name: "Amazon Prime", groupName: "Subscriptions", isActive: true },
      { name: "Hotstar", groupName: "Subscriptions", isActive: true },
      { name: "YouTube Premium", groupName: "Subscriptions", isActive: true },
      { name: "Sony LIV", groupName: "Subscriptions", isActive: true },
      { name: "Apple Music", groupName: "Subscriptions", isActive: true },
      { name: "Spotify", groupName: "Subscriptions", isActive: true },
      { name: "Apple One", groupName: "Subscriptions", isActive: true },

      // Software & Cloud Subscriptions
      { name: "iCloud", groupName: "Subscriptions", isActive: true },
      { name: "Google One", groupName: "Subscriptions", isActive: true },
      { name: "Cursor", groupName: "Subscriptions", isActive: true },
      { name: "ChatGPT", groupName: "Subscriptions", isActive: true },
      { name: "Other Software", groupName: "Subscriptions", isActive: true },

      // Health & Wellness
      { name: "Doctor", groupName: "Health", isActive: true },
      { name: "Pharmacy", groupName: "Health", isActive: true },
      { name: "Health Insurance", groupName: "Health", isActive: true },
      { name: "Gym", groupName: "Health", isActive: true },
      { name: "Personal Care", groupName: "Health", isActive: true },

      // Entertainment & Leisure
      { name: "Movies", groupName: "Entertainment", isActive: true },
      { name: "Events", groupName: "Entertainment", isActive: true },
      { name: "Travel", groupName: "Entertainment", isActive: true },
      { name: "Hobbies", groupName: "Entertainment", isActive: true },
      { name: "Books", groupName: "Entertainment", isActive: true },

      // Shopping
      { name: "Clothing", groupName: "Shopping", isActive: true },
      { name: "Electronics", groupName: "Shopping", isActive: true },
      { name: "Home & Kitchen", groupName: "Shopping", isActive: true },
      { name: "Gifts", groupName: "Shopping", isActive: true },

      // Financial
      { name: "Bank Fees", groupName: "Financial", isActive: true },
      { name: "Loan EMI", groupName: "Financial", isActive: true },
      { name: "Credit Card Fees", groupName: "Financial", isActive: true },
      { name: "Investment", groupName: "Financial", isActive: true },

      // Other
      { name: "Charity", groupName: "Other", isActive: true },
      { name: "Education", groupName: "Other", isActive: true },
      { name: "Miscellaneous", groupName: "Other", isActive: true },
    ];

    for (const cat of categories) {
      await ctx.db.insert("expenseCategories", cat);
    }

    return { deleted: existing.length, created: categories.length };
  },
});

// INTERNAL ONLY: Seed default expense categories (Dashboard only)
export const seedCategories = internalMutation({
  args: {},
  handler: async (ctx) => {
    // Clean, comprehensive category list - deduplicated and organized
    const categories = [
      // Housing & Home
      { name: "Rent", groupName: "Housing", isActive: true },
      { name: "Maintenance", groupName: "Housing", isActive: true },
      { name: "Domestic Help", groupName: "Housing", isActive: true },
      { name: "Home Repairs", groupName: "Housing", isActive: true },

      // Food & Dining
      { name: "Grocery", groupName: "Food & Dining", isActive: true },
      { name: "Dining Out", groupName: "Food & Dining", isActive: true },
      { name: "Food Delivery", groupName: "Food & Dining", isActive: true },
      { name: "Coffee & Snacks", groupName: "Food & Dining", isActive: true },

      // Transport
      { name: "Fuel", groupName: "Transport", isActive: true },
      { name: "Public Transit", groupName: "Transport", isActive: true },
      { name: "Cabs & Rideshare", groupName: "Transport", isActive: true },
      { name: "Parking", groupName: "Transport", isActive: true },
      { name: "Vehicle Maintenance", groupName: "Transport", isActive: true },

      // Utilities & Bills
      { name: "Electricity", groupName: "Utilities", isActive: true },
      { name: "Water", groupName: "Utilities", isActive: true },
      { name: "Gas", groupName: "Utilities", isActive: true },
      { name: "Internet", groupName: "Utilities", isActive: true },
      { name: "Phone", groupName: "Utilities", isActive: true },

      // Subscriptions & Digital
      { name: "Streaming", groupName: "Subscriptions", isActive: true },
      { name: "Music", groupName: "Subscriptions", isActive: true },
      { name: "Cloud Storage", groupName: "Subscriptions", isActive: true },
      { name: "Software", groupName: "Subscriptions", isActive: true },
      { name: "News & Magazines", groupName: "Subscriptions", isActive: true },

      // Health & Wellness
      { name: "Medical", groupName: "Health", isActive: true },
      { name: "Pharmacy", groupName: "Health", isActive: true },
      { name: "Insurance", groupName: "Health", isActive: true },
      { name: "Gym & Fitness", groupName: "Health", isActive: true },
      { name: "Personal Care", groupName: "Health", isActive: true },

      // Entertainment & Leisure
      { name: "Entertainment", groupName: "Entertainment", isActive: true },
      { name: "Travel", groupName: "Entertainment", isActive: true },
      { name: "Hobbies", groupName: "Entertainment", isActive: true },
      { name: "Books & Learning", groupName: "Entertainment", isActive: true },
      {
        name: "Events & Activities",
        groupName: "Entertainment",
        isActive: true,
      },

      // Shopping
      { name: "Clothing", groupName: "Shopping", isActive: true },
      { name: "Electronics", groupName: "Shopping", isActive: true },
      { name: "Home & Kitchen", groupName: "Shopping", isActive: true },
      { name: "Gifts", groupName: "Shopping", isActive: true },

      // Financial
      { name: "Bank Fees", groupName: "Financial", isActive: true },
      { name: "Loan EMI", groupName: "Financial", isActive: true },
      { name: "Credit Card Interest", groupName: "Financial", isActive: true },

      // Other
      { name: "Charity & Donations", groupName: "Other", isActive: true },
      { name: "Education", groupName: "Other", isActive: true },
      { name: "Miscellaneous", groupName: "Other", isActive: true },
    ];

    for (const cat of categories) {
      const existing = await ctx.db
        .query("expenseCategories")
        .filter((q) => q.eq(q.field("name"), cat.name))
        .first();

      if (!existing) {
        await ctx.db.insert("expenseCategories", cat);
      }
    }
  },
});

// INTERNAL ONLY: Reset categories (Dashboard only)
export const resetCategories = internalMutation({
  args: {},
  handler: async (ctx) => {
    // The canonical list of category names we want to keep active
    const keepActive = new Set([
      // Housing
      "Rent",
      "Maintenance",
      "Domestic Help",
      "Home Repairs",
      // Food & Dining
      "Grocery",
      "Dining Out",
      "Food Delivery",
      "Coffee & Snacks",
      // Transport
      "Fuel",
      "Public Transit",
      "Cabs & Rideshare",
      "Parking",
      "Vehicle Maintenance",
      // Utilities
      "Electricity",
      "Water",
      "Gas",
      "Internet",
      "Phone",
      // Subscriptions
      "Streaming",
      "Music",
      "Cloud Storage",
      "Software",
      "News & Magazines",
      // Health
      "Medical",
      "Pharmacy",
      "Insurance",
      "Gym & Fitness",
      "Personal Care",
      // Entertainment
      "Entertainment",
      "Travel",
      "Hobbies",
      "Books & Learning",
      "Events & Activities",
      // Shopping
      "Clothing",
      "Electronics",
      "Home & Kitchen",
      "Gifts",
      // Financial
      "Bank Fees",
      "Loan EMI",
      "Credit Card Interest",
      // Other
      "Charity & Donations",
      "Education",
      "Miscellaneous",
    ]);

    // Get all categories
    const allCategories = await ctx.db.query("expenseCategories").collect();

    // Get all expense entries to check which categories are in use
    const allEntries = await ctx.db.query("expenseEntries").collect();
    const categoriesWithEntries = new Set(
      allEntries.map((e) => e.categoryId.toString()),
    );

    let deactivated = 0;
    let kept = 0;

    for (const cat of allCategories) {
      const hasEntries = categoriesWithEntries.has(cat._id.toString());
      const isInCleanList = keepActive.has(cat.name);

      if (isInCleanList) {
        // Ensure it's active
        if (!cat.isActive) {
          await ctx.db.patch(cat._id, { isActive: true });
        }
        kept++;
      } else if (hasEntries) {
        // Has entries but not in clean list - keep active (user data)
        kept++;
      } else {
        // No entries and not in clean list - deactivate
        if (cat.isActive) {
          await ctx.db.patch(cat._id, { isActive: false });
          deactivated++;
        }
      }
    }

    return { deactivated, kept };
  },
});

// INTERNAL ONLY: Preview duplicate expense categories and usage
export const previewExpenseCategoryCleanup = internalQuery({
  args: {},
  handler: async (ctx) => {
    const [categories, entries] = await Promise.all([
      ctx.db.query("expenseCategories").collect(),
      ctx.db.query("expenseEntries").collect(),
    ]);

    const usageByCategory = new Map<string, number>();
    for (const entry of entries) {
      const key = String(entry.categoryId);
      usageByCategory.set(key, (usageByCategory.get(key) || 0) + 1);
    }

    const byNormalized = new Map<string, typeof categories>();
    for (const category of categories) {
      const key = normalizeExpenseCategoryName(category.name);
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

// INTERNAL ONLY: Merge duplicate/redundant expense categories and re-point entries
export const cleanupExpenseCategories = internalMutation({
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
    const explicitRules: ExpenseCleanupRule[] =
      args.mergeRules && args.mergeRules.length > 0
        ? args.mergeRules
        : DEFAULT_EXPENSE_MERGE_RULES;

    const [categories, entries] = await Promise.all([
      ctx.db.query("expenseCategories").collect(),
      ctx.db.query("expenseEntries").collect(),
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
      const newId = await ctx.db.insert("expenseCategories", {
        name,
        groupName: fallbackGroup || "Other",
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

    // 1) explicit rules
    for (const rule of explicitRules) {
      const from = findCategoryByName(rule.from);
      if (!from) continue;
      const to = await ensureTargetCategory(rule.to, from.groupName || "Other");
      if (!to) continue;
      await moveCategory(String(from._id), String(to._id), "explicit_rule");
    }

    // 2) exact normalized duplicates
    const byNormalized = new Map<string, string[]>();
    for (const cat of categoryById.values()) {
      const key = normalizeExpenseCategoryName(cat.name);
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

    // 3) pattern canonicalization
    const categorySnapshot = Array.from(categoryById.values());
    for (const cat of categorySnapshot) {
      const targetName = canonicalTargetForExpenseCategoryName(cat.name);
      if (!targetName) continue;
      if (cat.name.trim().toLowerCase() === targetName.trim().toLowerCase()) {
        continue;
      }
      const target = await ensureTargetCategory(targetName, cat.groupName || "Other");
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
