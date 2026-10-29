/**
 * Telegram Bot Internal Queries and Mutations
 *
 * These are run by the telegramBot action via ctx.runQuery/runMutation.
 * Separated from the Node.js action file because Convex requires
 * Node.js files to only contain actions.
 */

import { v } from "convex/values";
import { internalMutation, internalQuery } from "./_generated/server";
import { internal } from "./_generated/api";
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
const MANUAL_FY_TAX_PAID_NOTE_PREFIX = "[manual_fy_tax_paid]";

/**
 * Atomically reserve an inbound Telegram message. Telegram retries slow
 * webhooks, so this prevents a retry from sending duplicate error replies or
 * applying the same parsed transaction twice.
 */
export const claimMessageReceipt = internalMutation({
  args: {
    chatId: v.string(),
    messageId: v.string(),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("telegramMessageReceipts")
      .withIndex("by_chat_message", (q) =>
        q.eq("chatId", args.chatId).eq("messageId", args.messageId),
      )
      .first();
    if (existing) return false;

    await ctx.db.insert("telegramMessageReceipts", {
      chatId: args.chatId,
      messageId: args.messageId,
      createdAt: Date.now(),
    });
    return true;
  },
});

function autoWithholdingNote(entryId: string) {
  return `${AUTO_WITHHOLDING_NOTE_PREFIX}:${entryId}`;
}

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

async function hydrateTaxPayment<
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

async function hydrateBalanceRecord<
  T extends { amount?: number; amountEnc?: string; note?: string; noteEnc?: string },
>(row: T) {
  return {
    ...row,
    amount: await decryptNumberWithFallback(
      row.amountEnc,
      row.amount,
      "balanceHistory.amount",
    ),
    note: await decryptStringWithFallback(row.noteEnc, row.note),
  };
}

function fiscalYearFromDateForJurisdiction(
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

  await ctx.db.insert("taxPayments", {
    profileId: args.profileId,
    jurisdiction: args.jurisdiction,
    paymentType: args.jurisdiction === "IN" ? "tds" : "withholding",
    amountEnc: await encryptNumber(amount),
    currency: args.currency,
    date: args.date,
    fiscalYear: fiscalYearFromDateForJurisdiction(args.date, args.jurisdiction),
    noteEnc: await encryptOptionalString(marker),
    source: "bot",
  });
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
  const paymentFY = normalizeFiscalYearForJurisdiction(
    payment.fiscalYear,
    jurisdiction,
  );
  if (paymentFY === targetFY) return true;

  const { start, end } = getFiscalYearRange(targetFY, jurisdiction);
  return payment.date >= start && payment.date <= end;
}

// ============================================================================
// Database Operations
// ============================================================================

export const getUserByChatId = internalQuery({
  args: { chatId: v.string() },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("users")
      .withIndex("by_telegram", (q) => q.eq("telegramChatId", args.chatId))
      .first();
  },
});

async function getOwnerAccessibleProfiles(ctx: any, userId: any) {
  const ownProfiles = await ctx.db
    .query("profiles")
    .withIndex("by_user", (q: any) => q.eq("userId", userId))
    .collect();

  const memberships = await ctx.db
    .query("familyMembers")
    .withIndex("by_user", (q: any) => q.eq("userId", userId))
    .collect();
  const ownerFamilyIds = memberships
    .filter((m: any) => m.role === "owner")
    .map((m: any) => m.familyId);

  if (ownerFamilyIds.length === 0) {
    return ownProfiles.map((p: any) => ({ ...p, familyName: "Personal" }));
  }

  const ownerFamilyRows = await Promise.all(
    ownerFamilyIds.map((familyId: any) => ctx.db.get(familyId)),
  );
  const familyMembers = await Promise.all(
    ownerFamilyIds.map((familyId: any) =>
      ctx.db
        .query("familyMembers")
        .withIndex("by_family", (q: any) => q.eq("familyId", familyId))
        .collect(),
    ),
  );

  const visibleUserIds = new Set<any>([userId]);
  const userFamilyName = new Map<any, string>();
  familyMembers.forEach((rows: any[], idx: number) => {
    const familyName = ownerFamilyRows[idx]?.name || "Family";
    for (const row of rows) {
      visibleUserIds.add(row.userId);
      if (!userFamilyName.has(row.userId)) {
        userFamilyName.set(row.userId, familyName);
      }
    }
  });

  const allProfiles = await ctx.db.query("profiles").collect();
  const visibleUsers = await Promise.all(
    Array.from(visibleUserIds).map((id) => ctx.db.get(id)),
  );
  const userEmailById = new Map<any, string>();
  for (const user of visibleUsers) {
    if (user?._id && user?.email) {
      userEmailById.set(user._id, user.email);
    }
  }

  return allProfiles
    .filter((p: any) => visibleUserIds.has(p.userId))
    .map((p: any) => ({
      ...p,
      familyName: userFamilyName.get(p.userId) || "Personal",
      userEmail: userEmailById.get(p.userId) || null,
    }));
}

export const getUserActiveProfile = internalQuery({
  args: { userId: v.id("users") },
  handler: async (ctx, args) => {
    const user = await ctx.db.get(args.userId);
    if (!user) return null;

    const accessibleProfiles = await getOwnerAccessibleProfiles(ctx, args.userId);

    // Try active profile first if still accessible.
    if (user.activeProfileId) {
      const active = accessibleProfiles.find(
        (p: any) => p._id === user.activeProfileId,
      );
      if (active) return active;
    }

    // Fallback to own default profile, then first accessible profile.
    const ownDefault = accessibleProfiles.find(
      (p: any) => p.userId === args.userId && p.isDefault,
    );
    if (ownDefault) return ownDefault;
    return accessibleProfiles[0] || null;
  },
});

export const canReadBotProfile = internalQuery({
  args: { userId: v.id("users"), profileId: v.id("profiles") },
  handler: async (ctx, args) => {
    const profiles = await getOwnerAccessibleProfiles(ctx, args.userId);
    return profiles.some((profile: any) => profile._id === args.profileId);
  },
});

export const getUserProfiles = internalQuery({
  args: { userId: v.id("users") },
  handler: async (ctx, args) => await getOwnerAccessibleProfiles(ctx, args.userId),
});

export const setActiveProfile = internalMutation({
  args: {
    userId: v.id("users"),
    profileId: v.id("profiles"),
  },
  handler: async (ctx, args) => {
    const profile = await ctx.db.get(args.profileId);
    if (!profile) {
      throw new Error("Profile not found");
    }

    const accessibleProfiles = await getOwnerAccessibleProfiles(ctx, args.userId);
    const canAccess = accessibleProfiles.some((p: any) => p._id === args.profileId);
    if (!canAccess) {
      throw new Error("Profile not found");
    }
    await ctx.db.patch(args.userId, { activeProfileId: args.profileId });
    return profile;
  },
});

// Get expense categories (for AI context)
export const getExpenseCategories = internalQuery({
  args: {},
  handler: async (ctx) => {
    const cats = await ctx.db
      .query("expenseCategories")
      .filter((q) => q.eq(q.field("isActive"), true))
      .collect();
    return cats.map((c) => ({ id: c._id, name: c.name, group: c.groupName }));
  },
});

// Get income categories (for AI context)
export const getIncomeCategories = internalQuery({
  args: {},
  handler: async (ctx) => {
    const cats = await ctx.db
      .query("incomeCategories")
      .filter((q) => q.eq(q.field("isActive"), true))
      .collect();
    return cats.map((c) => ({ id: c._id, name: c.name, group: c.groupName }));
  },
});

// Get accounts for a profile (for AI context)
export const getProfileAccounts = internalQuery({
  args: { profileId: v.id("profiles") },
  handler: async (ctx, args) => {
    const accounts = await ctx.db
      .query("accounts")
      .withIndex("by_profile", (q) => q.eq("profileId", args.profileId))
      .filter((q) => q.eq(q.field("isActive"), true))
      .collect();
    return accounts.map((a) => ({
      id: a._id,
      name: a.name,
      category: a.category,
      currency: a.currency,
    }));
  },
});

export const getRecentExpenseEntries = internalQuery({
  args: {
    profileId: v.id("profiles"),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const entries = await ctx.db
      .query("expenseEntries")
      .withIndex("by_profile_date", (q) => q.eq("profileId", args.profileId))
      .collect();
    const sorted = entries
      .slice()
      .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
    const limited = sorted.slice(0, Math.max(1, args.limit || 40));
    const hydrated = await Promise.all(limited.map(hydrateExpenseEntry));
    return hydrated.map((e) => ({
      id: e._id,
      amount: e.amount,
      currency: e.currency,
      date: e.date,
      note: e.note || "",
    }));
  },
});

// The conversational layer only receives a compact, already-decrypted view of
// the caller's own ledger. It never gets database access or other profiles.
export const getExpenseConversationContext = internalQuery({
  args: { profileId: v.id("profiles"), startDate: v.optional(v.string()), endDate: v.optional(v.string()), limit: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const limit = Math.min(Math.max(args.limit || 500, 1), 500);
    const rows = await ctx.db
      .query("expenseEntries")
      .withIndex("by_profile_date", (q) => {
        const range = q.eq("profileId", args.profileId);
        if (args.startDate && args.endDate) return range.gte("date", args.startDate).lt("date", args.endDate);
        if (args.startDate) return range.gte("date", args.startDate);
        if (args.endDate) return range.lt("date", args.endDate);
        return range;
      })
      .order("desc")
      .take(limit + 1);
    const recent = rows.slice(0, limit);
    const hydrated = await Promise.all(recent.map(async (row) => {
      const hydrated = await hydrateExpenseEntry(row);
      const category = await ctx.db.get(row.categoryId);
      return {
        id: String(row._id),
        amount: hydrated.amount,
        currency: row.currency || "INR",
        date: row.date,
        note: hydrated.note || "",
        category: category?.name || "Uncategorized",
      };
    }));
    return { rows: hydrated, truncated: rows.length > limit };
  },
});

export const getHealthConversationContext = internalQuery({
  args: { profileId: v.id("profiles"), startDate: v.optional(v.string()), endDate: v.optional(v.string()), limit: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const limit = Math.min(Math.max(args.limit || 500, 1), 500);
    const rows = await ctx.db
      .query("healthEntries")
      .withIndex("by_profile_date", (q) => {
        const range = q.eq("profileId", args.profileId);
        if (args.startDate && args.endDate) return range.gte("date", args.startDate).lt("date", args.endDate);
        if (args.startDate) return range.gte("date", args.startDate);
        if (args.endDate) return range.lt("date", args.endDate);
        return range;
      })
      .order("desc")
      .take(limit + 1);
    const recent = rows.slice(0, limit);
    const hydrated = await Promise.all(
      recent.map(async (row) => {
        const note = await decryptStringWithFallback(row.noteEnc, undefined);
        return {
          id: String(row._id),
          kind: row.kind,
          date: row.date,
          workoutType: row.workoutType,
          sets: row.sets,
          weight: row.weight,
          weightGroups: row.weightGroups,
          durationMinutes: row.durationMinutes,
          calories: row.calories,
          proteinGrams: row.proteinGrams,
          carbsGrams: row.carbsGrams,
          fatGrams: row.fatGrams,
          note: note || "",
        };
      }),
    );
    return { rows: hydrated, truncated: rows.length > limit };
  },
});

export const getBalanceConversationContext = internalQuery({
  args: { profileId: v.id("profiles") },
  handler: async (ctx, args) => {
    const accounts = await ctx.db
      .query("accounts")
      .withIndex("by_profile", (q) => q.eq("profileId", args.profileId))
      .collect();
    const active = accounts.filter((account) => account.isActive);
    const snapshots = await Promise.all(
      active.map(async (account) => {
        const history = await ctx.db
          .query("balanceHistory")
          .withIndex("by_account_date", (q) => q.eq("accountId", account._id))
          .collect();
        const latest = history.sort((a, b) => b.date.localeCompare(a.date))[0];
        if (!latest) {
          return {
            account: account.name,
            category: account.category,
            currency: account.currency,
            amount: undefined as number | undefined,
            date: undefined as string | undefined,
            note: "",
          };
        }
        const hydrated = await hydrateBalanceRecord(latest);
        return {
          account: account.name,
          category: account.category,
          currency: account.currency,
          amount: hydrated.amount,
          date: latest.date,
          note: hydrated.note || "",
        };
      }),
    );
    return snapshots.filter((row) => row.amount !== undefined);
  },
});

export const getIncomeConversationContext = internalQuery({
  args: { profileId: v.id("profiles"), startDate: v.optional(v.string()), endDate: v.optional(v.string()), limit: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const limit = Math.min(Math.max(args.limit || 500, 1), 500);
    const rows = await ctx.db
      .query("incomeEntries")
      .withIndex("by_profile_date", (q) => {
        const range = q.eq("profileId", args.profileId);
        if (args.startDate && args.endDate) return range.gte("date", args.startDate).lt("date", args.endDate);
        if (args.startDate) return range.gte("date", args.startDate);
        if (args.endDate) return range.lt("date", args.endDate);
        return range;
      })
      .order("desc")
      .take(limit + 1);
    const hydrated = await Promise.all(rows.slice(0, limit).map(async (row) => {
      const [hydrated, category] = await Promise.all([
        hydrateIncomeEntry(row),
        ctx.db.get(row.categoryId),
      ]);
      return {
        id: String(row._id),
        amount: hydrated.amount,
        currency: row.currency || "INR",
        date: row.date,
        note: hydrated.note || "",
        category: category?.name || "Other",
        jurisdiction: row.jurisdiction,
      };
    }));
    return { rows: hydrated, truncated: rows.length > limit };
  },
});

export const addHealthEntry = internalMutation({
  args: {
    profileId: v.id("profiles"),
    kind: v.union(v.literal("exercise"), v.literal("meal")),
    sessionId: v.optional(v.string()),
    calories: v.optional(v.number()),
    proteinGrams: v.optional(v.number()),
    carbsGrams: v.optional(v.number()),
    fatGrams: v.optional(v.number()),
    nutritionEstimated: v.optional(v.boolean()),
    durationMinutes: v.optional(v.number()),
    workoutType: v.optional(v.string()),
    sets: v.optional(v.number()),
    weight: v.optional(v.number()),
    weightGroups: v.optional(v.array(v.object({ sets: v.number(), weight: v.number() }))),
    note: v.optional(v.string()),
    date: v.string(),
  },
  handler: async (ctx, args) => {
    if (args.kind === "meal") {
      if (args.calories === undefined || !Number.isFinite(args.calories) || args.calories <= 0) {
        throw new Error("Meal calories must be greater than zero");
      }
      const macros = [args.proteinGrams, args.carbsGrams, args.fatGrams];
      if (macros.some((value) => value !== undefined) &&
          (macros.some((value) => value === undefined) || macros.some((value) => !Number.isFinite(value) || value! < 0))) {
        throw new Error("Meal macros must contain non-negative protein, carbs, and fat values");
      }
    }
    return await ctx.db.insert("healthEntries", {
      profileId: args.profileId,
      kind: args.kind,
      sessionId: args.sessionId,
      calories: args.calories,
      proteinGrams: args.proteinGrams,
      carbsGrams: args.carbsGrams,
      fatGrams: args.fatGrams,
      nutritionEstimated: args.nutritionEstimated,
      durationMinutes: args.durationMinutes,
      workoutType: args.workoutType,
      sets: args.sets,
      weight: args.weight,
      weightGroups: args.weightGroups,
      noteEnc: await encryptOptionalString(args.note),
      date: args.date,
      source: "bot",
    });
  },
});

const mealReferenceName = (name: string) => name.trim().replace(/\s+/g, " ").toLocaleLowerCase();

export const listMealReferences = internalQuery({
  args: { profileId: v.id("profiles") },
  handler: async (ctx, { profileId }) => {
    const rows = await ctx.db.query("mealReferences")
      .withIndex("by_profile", (q) => q.eq("profileId", profileId)).collect();
    const references = await Promise.all(rows.map(async (row) => ({
      id: row._id,
      name: (await decryptStringWithFallback(row.nameEnc, undefined)) || "",
      calories: row.calories,
      proteinGrams: row.proteinGrams,
      carbsGrams: row.carbsGrams,
      fatGrams: row.fatGrams,
      nutritionEstimated: row.nutritionEstimated,
      timesUsed: row.timesUsed,
      updatedAt: row.updatedAt,
    })));
    return references.sort((a, b) => b.updatedAt - a.updatedAt).slice(0, 80);
  },
});

export const saveMealReference = internalMutation({
  args: {
    profileId: v.id("profiles"), name: v.string(), calories: v.number(),
    proteinGrams: v.optional(v.number()), carbsGrams: v.optional(v.number()),
    fatGrams: v.optional(v.number()), nutritionEstimated: v.boolean(),
    consumed: v.boolean(),
  },
  handler: async (ctx, args) => {
    const name = args.name.trim().replace(/\s+/g, " ");
    if (name.length < 3 || name.length > 160 || !Number.isFinite(args.calories) || args.calories <= 0) throw new Error("Invalid meal reference");
    const macros = [args.proteinGrams, args.carbsGrams, args.fatGrams];
    if (macros.some((value) => value !== undefined) &&
      (macros.some((value) => value === undefined) || macros.some((value) => !Number.isFinite(value) || value! < 0))) {
      throw new Error("Meal reference macros must be complete and non-negative");
    }
    const rows = await ctx.db.query("mealReferences")
      .withIndex("by_profile", (q) => q.eq("profileId", args.profileId)).collect();
    for (const row of rows) {
      const existingName = await decryptStringWithFallback(row.nameEnc, undefined);
      if (existingName && mealReferenceName(existingName) === mealReferenceName(name)) {
        await ctx.db.patch(row._id, {
          nameEnc: (await encryptOptionalString(name))!, calories: args.calories,
          proteinGrams: args.proteinGrams, carbsGrams: args.carbsGrams, fatGrams: args.fatGrams,
          nutritionEstimated: args.nutritionEstimated,
          timesUsed: row.timesUsed + (args.consumed ? 1 : 0), updatedAt: Date.now(),
        });
        return row._id;
      }
    }
    return await ctx.db.insert("mealReferences", {
      profileId: args.profileId, nameEnc: (await encryptOptionalString(name))!,
      calories: args.calories, proteinGrams: args.proteinGrams,
      carbsGrams: args.carbsGrams, fatGrams: args.fatGrams,
      nutritionEstimated: args.nutritionEstimated,
      timesUsed: args.consumed ? 1 : 0, updatedAt: Date.now(),
    });
  },
});

export const markMealReferenceUsed = internalMutation({
  args: { profileId: v.id("profiles"), referenceId: v.id("mealReferences") },
  handler: async (ctx, args) => {
    const row = await ctx.db.get(args.referenceId);
    if (!row || row.profileId !== args.profileId) throw new Error("Meal reference not found");
    await ctx.db.patch(row._id, { timesUsed: row.timesUsed + 1, updatedAt: Date.now() });
  },
});

export const getRecentIncomeEntries = internalQuery({
  args: {
    profileId: v.id("profiles"),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const entries = await ctx.db
      .query("incomeEntries")
      .withIndex("by_profile_date", (q) => q.eq("profileId", args.profileId))
      .collect();
    const sorted = entries
      .slice()
      .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
    const limited = sorted.slice(0, Math.max(1, args.limit || 40));
    const hydrated = await Promise.all(limited.map(hydrateIncomeEntry));
    return hydrated.map((e) => ({
      id: e._id,
      amount: e.amount,
      currency: e.currency,
      date: e.date,
      note: e.note || "",
    }));
  },
});

export const ensureAccountForBalance = internalMutation({
  args: {
    profileId: v.id("profiles"),
    name: v.string(),
    currency: v.union(v.literal("INR"), v.literal("USD"), v.literal("THB")),
    category: v.union(v.literal("asset"), v.literal("liability")),
    type: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const normalized = args.name.trim().toLowerCase();
    const existing = await ctx.db
      .query("accounts")
      .withIndex("by_profile", (q) => q.eq("profileId", args.profileId))
      .filter((q) => q.eq(q.field("isActive"), true))
      .collect();

    const matched = existing.find(
      (a) => a.name.trim().toLowerCase() === normalized && a.currency === args.currency,
    );
    if (matched) {
      return { accountId: matched._id, created: false, name: matched.name, currency: matched.currency };
    }

    const nextDisplayOrder =
      existing.reduce((max, a) => Math.max(max, a.displayOrder || 0), 0) + 1;
    const accountId = await ctx.db.insert("accounts", {
      profileId: args.profileId,
      name: args.name.trim(),
      category: args.category,
      type: args.type,
      currency: args.currency,
      isActive: true,
      displayOrder: nextDisplayOrder,
    });
    return { accountId, created: true, name: args.name.trim(), currency: args.currency };
  },
});

export const updateAccountMeta = internalMutation({
  args: {
    profileId: v.id("profiles"),
    accountId: v.id("accounts"),
    name: v.optional(v.string()),
    category: v.optional(v.union(v.literal("asset"), v.literal("liability"))),
    type: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const account = await ctx.db.get(args.accountId);
    if (!account || account.profileId !== args.profileId) {
      throw new Error("Account not found");
    }
    const patch: Record<string, unknown> = {};
    if (args.name !== undefined && args.name.trim()) patch.name = args.name.trim();
    if (args.category !== undefined) patch.category = args.category;
    if (args.type !== undefined) patch.type = args.type;
    if (Object.keys(patch).length > 0) {
      await ctx.db.patch(args.accountId, patch);
    }
    return { accountId: args.accountId };
  },
});

export const deactivateAccount = internalMutation({
  args: {
    profileId: v.id("profiles"),
    accountId: v.id("accounts"),
  },
  handler: async (ctx, args) => {
    const account = await ctx.db.get(args.accountId);
    if (!account || account.profileId !== args.profileId) {
      throw new Error("Account not found");
    }
    await ctx.db.patch(args.accountId, { isActive: false });
    return { accountId: args.accountId };
  },
});

export const createLinkCode = internalMutation({
  args: { chatId: v.string() },
  handler: async (ctx, args) => {
    // Delete any existing codes for this chatId
    const existing = await ctx.db
      .query("telegramLinkCodes")
      .withIndex("by_chatId", (q) => q.eq("chatId", args.chatId))
      .collect();

    for (const code of existing) {
      await ctx.db.delete(code._id);
    }

    // Generate 6-character alphanumeric code
    const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // No O/0/I/1 for clarity
    let code = "";
    for (let i = 0; i < 6; i++) {
      code += chars[Math.floor(Math.random() * chars.length)];
    }

    // Store with 5-minute expiry
    await ctx.db.insert("telegramLinkCodes", {
      code,
      chatId: args.chatId,
      expiresAt: Date.now() + 5 * 60 * 1000,
    });

    return code;
  },
});

export const verifyAndLinkCode = internalMutation({
  args: {
    code: v.string(),
    userId: v.id("users"),
  },
  handler: async (ctx, args) => {
    const linkCode = await ctx.db
      .query("telegramLinkCodes")
      .withIndex("by_code", (q) => q.eq("code", args.code.toUpperCase()))
      .first();

    if (!linkCode) {
      return { success: false, error: "Invalid code" };
    }

    if (linkCode.expiresAt < Date.now()) {
      await ctx.db.delete(linkCode._id);
      return { success: false, error: "Code expired" };
    }

    // Link the Telegram account to the user
    await ctx.db.patch(args.userId, {
      telegramChatId: linkCode.chatId,
    });

    // Clean up the code
    await ctx.db.delete(linkCode._id);

    return { success: true, chatId: linkCode.chatId };
  },
});

export const addExpense = internalMutation({
  args: {
    profileId: v.id("profiles"),
    amount: v.number(),
    note: v.optional(v.string()),
    date: v.string(),
    categoryId: v.optional(v.id("expenseCategories")),
    currency: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    let categoryId = args.categoryId;

    // If no category provided, fall back to Uncategorized or first active
    if (!categoryId) {
      const fallback = await ctx.db
        .query("expenseCategories")
        .filter((q) => q.eq(q.field("name"), "Uncategorized"))
        .first();
      categoryId = fallback?._id;

      if (!categoryId) {
        const any = await ctx.db
          .query("expenseCategories")
          .filter((q) => q.eq(q.field("isActive"), true))
          .first();
        if (!any) throw new Error("No expense categories found");
        categoryId = any._id;
      }
    }

    const currency =
      args.currency === "USD" || args.currency === "THB"
        ? args.currency
        : "INR";

    return await ctx.db.insert("expenseEntries", {
      profileId: args.profileId,
      categoryId,
      amountEnc: await encryptNumber(args.amount),
      currency,
      date: args.date,
      noteEnc: await encryptOptionalString(args.note),
      source: "bot",
    });
  },
});

export const deleteExpenseEntry = internalMutation({
  args: {
    ownerUserId: v.id("users"),
    profileId: v.id("profiles"),
    entryId: v.id("expenseEntries"),
  },
  handler: async (ctx, args) => {
    const profile = await ctx.db.get(args.profileId);
    if (!profile || profile.userId !== args.ownerUserId) {
      throw new Error("Only your own expenses can be deleted through the bot");
    }
    const row = await ctx.db.get(args.entryId);
    if (!row || row.profileId !== args.profileId) {
      throw new Error("Expense entry not found");
    }
    await ctx.db.delete(args.entryId);
    return { entryId: args.entryId };
  },
});

export const updateExpenseEntry = internalMutation({
  args: {
    profileId: v.id("profiles"),
    entryId: v.id("expenseEntries"),
    amount: v.optional(v.number()),
    note: v.optional(v.string()),
    date: v.optional(v.string()),
    categoryId: v.optional(v.id("expenseCategories")),
  },
  handler: async (ctx, args) => {
    const row = await ctx.db.get(args.entryId);
    if (!row || row.profileId !== args.profileId) {
      throw new Error("Expense entry not found");
    }
    const patch: Record<string, unknown> = {};
    if (args.amount !== undefined) {
      patch.amountEnc = await encryptNumber(args.amount);
    }
    if (args.note !== undefined) {
      patch.noteEnc = await encryptOptionalString(args.note);
      patch.note = undefined;
    }
    if (args.date !== undefined) patch.date = args.date;
    if (args.categoryId !== undefined) patch.categoryId = args.categoryId;
    if (Object.keys(patch).length > 0) {
      await ctx.db.patch(args.entryId, patch);
    }
    if (args.date !== undefined) await ctx.scheduler.runAfter(0, (internal as any).tripReportActions.refreshLinkedExpenseFx, { expenseId: args.entryId });
    return { entryId: args.entryId };
  },
});

export const addIncome = internalMutation({
  args: {
    profileId: v.id("profiles"),
    amount: v.number(),
    netReceivedAmount: v.optional(v.number()),
    salaryDetails: v.optional(salaryDetailsValidator),
    note: v.optional(v.string()),
    date: v.string(),
    categoryId: v.optional(v.id("incomeCategories")),
    currency: v.optional(v.string()),
    jurisdiction: v.optional(v.string()),
    incomeType: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    let categoryId = args.categoryId;

    if (!categoryId) {
      const fallback = await ctx.db
        .query("incomeCategories")
        .filter((q) => q.eq(q.field("isActive"), true))
        .first();
      if (!fallback) throw new Error("No income categories found");
      categoryId = fallback._id;
    }

    const currency =
      args.currency === "USD" || args.currency === "THB"
        ? args.currency
        : "INR";

    // Enforce deterministic mapping so stale AI output can't create mismatched rows.
    const jurisdiction =
      currency === "USD" ? "US" : currency === "THB" ? "TH" : "IN";

    const incomeType =
      args.incomeType === "salary" ||
      args.incomeType === "business" ||
      args.incomeType === "investment"
        ? args.incomeType
        : ("other" as const);

    const entryId = await ctx.db.insert("incomeEntries", {
      profileId: args.profileId,
      categoryId,
      amountEnc: await encryptNumber(args.amount),
      netReceivedAmountEnc: await encryptOptionalNumber(args.netReceivedAmount),
      salaryDetailsEnc: await encryptSalaryDetails(args.salaryDetails),
      currency,
      date: args.date,
      jurisdiction,
      incomeType,
      noteEnc: await encryptOptionalString(args.note),
      source: "bot",
    });
    await syncAutoWithholdingTaxPayment(ctx, {
      entryId,
      profileId: args.profileId,
      jurisdiction,
      currency: currency as "INR" | "USD" | "THB",
      date: args.date,
      taxWithheldAmount: args.salaryDetails?.taxWithheldAmount,
    });
    return entryId;
  },
});

export const upsertIncomeByNaturalKey = internalMutation({
  args: {
    profileId: v.id("profiles"),
    amount: v.number(),
    netReceivedAmount: v.optional(v.number()),
    salaryDetails: v.optional(salaryDetailsValidator),
    note: v.optional(v.string()),
    date: v.string(),
    categoryId: v.optional(v.id("incomeCategories")),
    currency: v.optional(v.string()),
    jurisdiction: v.optional(v.string()),
    incomeType: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    let categoryId = args.categoryId;
    if (!categoryId) {
      const fallback = await ctx.db
        .query("incomeCategories")
        .filter((q) => q.eq(q.field("isActive"), true))
        .first();
      if (!fallback) throw new Error("No income categories found");
      categoryId = fallback._id;
    }

    const currency =
      args.currency === "USD" || args.currency === "THB"
        ? args.currency
        : "INR";
    const jurisdiction =
      currency === "USD" ? "US" : currency === "THB" ? "TH" : "IN";
    const incomeType =
      args.incomeType === "salary" ||
      args.incomeType === "business" ||
      args.incomeType === "investment"
        ? args.incomeType
        : ("other" as const);

    const sameDateEntries = await ctx.db
      .query("incomeEntries")
      .withIndex("by_profile_date", (q) =>
        q.eq("profileId", args.profileId).gte("date", args.date).lte("date", args.date),
      )
      .collect();
    const existing = sameDateEntries.find(
      (entry) =>
        entry.date === args.date &&
        entry.categoryId === categoryId &&
        (entry.currency || "INR") === currency &&
        entry.jurisdiction === jurisdiction &&
        entry.incomeType === incomeType,
    );

    const nextNote = args.note || "";
    if (existing) {
      await ctx.db.patch(existing._id, {
        amountEnc: await encryptNumber(args.amount),
        netReceivedAmountEnc: await encryptOptionalNumber(args.netReceivedAmount),
        salaryDetailsEnc: await encryptSalaryDetails(args.salaryDetails),
        noteEnc: await encryptOptionalString(nextNote),
        note: undefined,
        categoryId,
      });
      await syncAutoWithholdingTaxPayment(ctx, {
        entryId: existing._id,
        profileId: existing.profileId,
        jurisdiction: existing.jurisdiction,
        currency: (existing.currency || "INR") as "INR" | "USD" | "THB",
        date: existing.date,
        taxWithheldAmount: args.salaryDetails?.taxWithheldAmount,
      });
      return { entryId: existing._id, created: false };
    }

    const entryId = await ctx.db.insert("incomeEntries", {
      profileId: args.profileId,
      categoryId,
      amountEnc: await encryptNumber(args.amount),
      netReceivedAmountEnc: await encryptOptionalNumber(args.netReceivedAmount),
      salaryDetailsEnc: await encryptSalaryDetails(args.salaryDetails),
      currency,
      date: args.date,
      jurisdiction,
      incomeType,
      noteEnc: await encryptOptionalString(nextNote),
      source: "bot",
    });
    await syncAutoWithholdingTaxPayment(ctx, {
      entryId,
      profileId: args.profileId,
      jurisdiction,
      currency: currency as "INR" | "USD" | "THB",
      date: args.date,
      taxWithheldAmount: args.salaryDetails?.taxWithheldAmount,
    });
    return { entryId, created: true };
  },
});

export const deleteIncomeEntry = internalMutation({
  args: {
    ownerUserId: v.id("users"),
    profileId: v.id("profiles"),
    entryId: v.id("incomeEntries"),
  },
  handler: async (ctx, args) => {
    const profile = await ctx.db.get(args.profileId);
    if (!profile || profile.userId !== args.ownerUserId) {
      throw new Error("Only your own income can be deleted through the bot");
    }
    const row = await ctx.db.get(args.entryId);
    if (!row || row.profileId !== args.profileId) {
      throw new Error("Income entry not found");
    }
    await syncAutoWithholdingTaxPayment(ctx, {
      entryId: args.entryId,
      profileId: args.profileId,
      jurisdiction: row.jurisdiction,
      currency: row.currency as "INR" | "USD" | "THB",
      date: row.date,
      taxWithheldAmount: 0,
    });
    await ctx.db.delete(args.entryId);
    return { entryId: args.entryId };
  },
});

export const updateIncomeEntry = internalMutation({
  args: {
    profileId: v.id("profiles"),
    entryId: v.id("incomeEntries"),
    amount: v.optional(v.number()),
    netReceivedAmount: v.optional(v.number()),
    salaryDetails: v.optional(salaryDetailsValidator),
    note: v.optional(v.string()),
    date: v.optional(v.string()),
    categoryId: v.optional(v.id("incomeCategories")),
  },
  handler: async (ctx, args) => {
    const row = await ctx.db.get(args.entryId);
    if (!row || row.profileId !== args.profileId) {
      throw new Error("Income entry not found");
    }

    const patch: Record<string, unknown> = {};
    if (args.amount !== undefined) {
      patch.amountEnc = await encryptNumber(args.amount);
    }
    if (args.netReceivedAmount !== undefined) {
      patch.netReceivedAmountEnc = await encryptOptionalNumber(
        args.netReceivedAmount,
      );
    }
    if (args.salaryDetails !== undefined) {
      patch.salaryDetailsEnc = await encryptSalaryDetails(args.salaryDetails);
    }
    if (args.note !== undefined) {
      patch.noteEnc = await encryptOptionalString(args.note);
      patch.note = undefined;
    }
    if (args.date !== undefined) patch.date = args.date;
    if (args.categoryId !== undefined) patch.categoryId = args.categoryId;
    if (Object.keys(patch).length > 0) {
      await ctx.db.patch(args.entryId, patch);
    }

    const nextDate = args.date ?? row.date;
    const hydratedRow = await hydrateIncomeEntry(row);
    const nextSalaryDetails =
      args.salaryDetails !== undefined ? args.salaryDetails : hydratedRow.salaryDetails;
    await syncAutoWithholdingTaxPayment(ctx, {
      entryId: args.entryId,
      profileId: row.profileId,
      jurisdiction: row.jurisdiction,
      currency: row.currency as "INR" | "USD" | "THB",
      date: nextDate,
      taxWithheldAmount: nextSalaryDetails?.taxWithheldAmount,
    });

    return { entryId: args.entryId };
  },
});

export const updateBalance = internalMutation({
  args: {
    accountId: v.id("accounts"),
    amount: v.number(),
    date: v.string(),
    note: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    return await ctx.db.insert("balanceHistory", {
      accountId: args.accountId,
      amountEnc: await encryptNumber(args.amount),
      date: args.date,
      noteEnc: await encryptOptionalString(args.note),
    });
  },
});

export const applyBalanceDeltas = internalMutation({
  args: {
    profileId: v.id("profiles"),
    items: v.array(
      v.object({
        accountId: v.id("accounts"),
        delta: v.number(),
        date: v.string(),
        note: v.optional(v.string()),
      }),
    ),
  },
  handler: async (ctx, args) => {
    if (args.items.length === 0) {
      return { applied: [] };
    }

    const accountState = new Map<
      string,
      {
        accountId: any;
        accountName: string;
        currency: "INR" | "USD" | "THB";
        currentAmount: number;
      }
    >();
    const planned: Array<{
      accountId: any;
      accountName: string;
      currency: "INR" | "USD" | "THB";
      delta: number;
      previousAmount: number;
      newAmount: number;
      date: string;
      note?: string;
    }> = [];

    for (const item of args.items) {
      if (!Number.isFinite(item.delta) || item.delta === 0) {
        throw new Error("Invalid delta: must be a finite non-zero number");
      }

      const accountKey = String(item.accountId);
      let state = accountState.get(accountKey);
      if (!state) {
        const account = await ctx.db.get(item.accountId);
        if (!account || !account.isActive || account.profileId !== args.profileId) {
          throw new Error("Account not found");
        }

        const latest = await ctx.db
          .query("balanceHistory")
          .withIndex("by_account_date", (q) => q.eq("accountId", item.accountId))
          .order("desc")
          .first();
        if (!latest) {
          throw new Error(
            `No baseline balance found for account "${account.name}". Set an absolute balance first.`,
          );
        }
        const hydrated = await hydrateBalanceRecord(latest);

        state = {
          accountId: item.accountId,
          accountName: account.name,
          currency: account.currency as "INR" | "USD" | "THB",
          currentAmount: hydrated.amount,
        };
        accountState.set(accountKey, state);
      }

      const previousAmount = state.currentAmount;
      const newAmount = previousAmount + item.delta;
      if (!Number.isFinite(newAmount)) {
        throw new Error(`Invalid resulting balance for account "${state.accountName}"`);
      }
      if (newAmount < 0) {
        throw new Error(
          `Delta would make balance negative for account "${state.accountName}"`,
        );
      }

      state.currentAmount = newAmount;
      planned.push({
        accountId: item.accountId,
        accountName: state.accountName,
        currency: state.currency,
        delta: item.delta,
        previousAmount,
        newAmount,
        date: item.date,
        note: item.note,
      });
    }

    for (const item of planned) {
      await ctx.db.insert("balanceHistory", {
        accountId: item.accountId,
        amountEnc: await encryptNumber(item.newAmount),
        date: item.date,
        noteEnc: await encryptOptionalString(item.note),
      });
    }

    return {
      applied: planned.map((item) => ({
        accountId: item.accountId,
        accountName: item.accountName,
        currency: item.currency,
        delta: item.delta,
        previousAmount: item.previousAmount,
        newAmount: item.newAmount,
        date: item.date,
        note: item.note,
      })),
    };
  },
});

export const setTaxPaidForFiscalYear = internalMutation({
  args: {
    profileId: v.id("profiles"),
    jurisdiction: v.union(v.literal("IN"), v.literal("US"), v.literal("TH")),
    fiscalYear: v.string(),
    amount: v.number(),
    date: v.optional(v.string()),
    note: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const normalizedFY = normalizeFiscalYearForJurisdiction(
      args.fiscalYear,
      args.jurisdiction,
    );
    console.info("[tax][bot] setTaxPaidForFiscalYear request", {
      profileId: args.profileId,
      jurisdiction: args.jurisdiction,
      fiscalYearInput: args.fiscalYear,
      normalizedFY,
      amount: args.amount,
      date: args.date ?? null,
    });

    const existing = await ctx.db
      .query("taxPayments")
      .withIndex("by_profile", (q) => q.eq("profileId", args.profileId))
      .collect();
    const hydratedExisting = await Promise.all(existing.map(hydrateTaxPayment));

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
      console.info("[tax][bot] setTaxPaidForFiscalYear deleted-only", {
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
      source: "bot",
    });

    console.info("[tax][bot] setTaxPaidForFiscalYear upserted", {
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

export const addTaxPaymentEntry = internalMutation({
  args: {
    profileId: v.id("profiles"),
    jurisdiction: v.union(v.literal("IN"), v.literal("US"), v.literal("TH")),
    paymentType: v.optional(
      v.union(
        v.literal("advance_tax"),
        v.literal("tds"),
        v.literal("withholding"),
        v.literal("self_assessment"),
      ),
    ),
    fiscalYear: v.string(),
    amount: v.number(),
    date: v.optional(v.string()),
    note: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const normalizedFY = normalizeFiscalYearForJurisdiction(
      args.fiscalYear,
      args.jurisdiction,
    );
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
    const date = args.date || end;
    const paymentType = args.paymentType || paymentTypeByJurisdiction[args.jurisdiction];
    const amount = Math.max(0, args.amount);
    if (amount <= 0) {
      return { created: false };
    }

    const existing = await ctx.db
      .query("taxPayments")
      .withIndex("by_profile", (q) => q.eq("profileId", args.profileId))
      .collect();
    const hydratedExisting = await Promise.all(existing.map(hydrateTaxPayment));
    const duplicate = hydratedExisting.find(
      (row) =>
        row.jurisdiction === args.jurisdiction &&
        row.paymentType === paymentType &&
        row.fiscalYear === normalizedFY &&
        row.date === date &&
        Math.abs(row.amount - amount) < 0.01 &&
        (row.note || "") === (args.note || ""),
    );
    if (duplicate) {
      return { paymentId: duplicate._id, created: false };
    }

    const paymentId = await ctx.db.insert("taxPayments", {
      profileId: args.profileId,
      jurisdiction: args.jurisdiction,
      paymentType,
      amountEnc: await encryptNumber(amount),
      currency: currencyByJurisdiction[args.jurisdiction],
      date,
      fiscalYear: normalizedFY,
      noteEnc: await encryptOptionalString(args.note),
      source: "bot",
    });
    return { paymentId, created: true };
  },
});

/**
 * Fetch existing expenses + income for a profile within a date range.
 * Used for deduplication when bulk-importing from PDFs/statements.
 * Returns a flat list of {date, amount, currency, type} for matching.
 */
export const getExistingTransactions = internalQuery({
  args: {
    profileId: v.id("profiles"),
    startDate: v.string(), // YYYY-MM-DD
    endDate: v.string(), // YYYY-MM-DD
  },
  handler: async (ctx, args) => {
    // Fetch expenses in date range
    const expenses = await ctx.db
      .query("expenseEntries")
      .withIndex("by_profile_date", (q) =>
        q
          .eq("profileId", args.profileId)
          .gte("date", args.startDate)
          .lte("date", args.endDate),
      )
      .collect();
    const hydratedExpenses = await Promise.all(expenses.map(hydrateExpenseEntry));

    // Fetch income in date range
    const income = await ctx.db
      .query("incomeEntries")
      .withIndex("by_profile_date", (q) =>
        q
          .eq("profileId", args.profileId)
          .gte("date", args.startDate)
          .lte("date", args.endDate),
      )
      .collect();
    const hydratedIncome = await Promise.all(income.map(hydrateIncomeEntry));

    return [
      ...hydratedExpenses.map((e) => ({
        date: e.date,
        amount: e.amount,
        currency: e.currency || "INR",
        type: "expense" as const,
      })),
      ...hydratedIncome.map((i) => ({
        date: i.date,
        amount: i.amount,
        currency: i.currency || "INR",
        type: "income" as const,
      })),
    ];
  },
});
