import { v, ConvexError } from "convex/values";
import { query, mutation, internalQuery, internalMutation } from "./_generated/server";
import { internal } from "./_generated/api";
import { getAuthUserId } from "@convex-dev/auth/server";
import { requireProfileAccess } from "./lib/auth";
import { encryptNumber, encryptOptionalString, decryptNumberWithFallback, decryptStringWithFallback } from "./lib/fieldEncryption";
import { calculateTripSettlement } from "./lib/tripSettlement";
import { tripOwnerName } from "./lib/tripIdentity";
import { renameTripPerson } from "./lib/tripPeople";
import type { Id } from "./_generated/dataModel";

const currency = v.union(v.literal("INR"), v.literal("USD"), v.literal("THB"));
const draftedEntry = v.object({
  expenseId: v.optional(v.id("expenseEntries")),
  date: v.string(), note: v.string(), amount: v.number(), currency,
  rateToInr: v.number(), fxSource: v.union(v.literal("service"), v.literal("fallback")),
  fxDate: v.optional(v.string()),
  paidBy: v.string(), payerInferred: v.boolean(),
  matchInferred: v.optional(v.boolean()),
});
const isoDate = /^\d{4}-\d{2}-\d{2}$/;
const cleanName = (name: string) => name.trim().replace(/\s+/g, " ").slice(0, 60);

async function findReport(ctx: any, slug: string) {
  return await ctx.db.query("tripReports").withIndex("by_slug", (q: any) => q.eq("slug", slug)).unique();
}

async function mayRead(ctx: any, report: any, token?: string) {
  if (report.expiresAt <= Date.now()) return false;
  if (await getAuthUserId(ctx) === report.ownerUserId) return true;
  if (!token) return false;
  const session = await ctx.db.query("tripReportSessions").withIndex("by_token", (q: any) => q.eq("token", token)).unique();
  return !!session && session.reportId === report._id && session.expiresAt > Date.now();
}

export const getShell = query({
  args: { slug: v.string() },
  handler: async (ctx, { slug }) => {
    const report = await findReport(ctx, slug);
    return { exists: !!report && report.expiresAt > Date.now() };
  },
});

export const getReport = query({
  args: { slug: v.string(), token: v.optional(v.string()), viewSeparateCurrencies: v.optional(v.boolean()) },
  handler: async (ctx, { slug, token, viewSeparateCurrencies }) => {
    const report = await findReport(ctx, slug);
    if (!report || !(await mayRead(ctx, report, token))) return null;
    const userId = await getAuthUserId(ctx);
    const isOwner = userId === report.ownerUserId;
    const profile = await ctx.db.get(report.profileId as Id<"profiles">);
    const account = await ctx.db.get(report.ownerUserId as Id<"users">);
    const ownerName = tripOwnerName(report.ownerName, profile?.name, account?.name) || report.ownerName;
    const replaceOwner = (person: string) => person === report.ownerName ? ownerName : person;
    const stored = await ctx.db.query("tripReportEntries").withIndex("by_report", (q) => q.eq("reportId", report._id)).collect();
    const entries = (await Promise.all(stored.map(async (entry) => {
      const source = entry.expenseId ? await ctx.db.get(entry.expenseId) : null;
      // A deleted source expense must not keep contributing to the trip total.
      if (entry.expenseId && (!source || source.profileId !== report.profileId)) return null;
      const date = source?.date ?? entry.date;
      const currency = source?.currency ?? entry.currency;
      return {
        id: entry._id,
        expenseId: isOwner ? entry.expenseId : undefined,
        date,
        note: source ? await decryptStringWithFallback(source.noteEnc, source.note) || "" : await decryptStringWithFallback(entry.noteEnc, undefined) || "",
        amount: source ? await decryptNumberWithFallback(source.amountEnc, source.amount, "expenseEntries.amount") : await decryptNumberWithFallback(entry.amountEnc, undefined, "tripReportEntries.amount"),
        currency,
        rateToInr: currency === "INR" ? 1 : entry.rateToInr,
        fxSource: entry.fxSource,
        fxDate: entry.fxDate,
        fxOutdated: currency !== "INR" && (date !== entry.date || currency !== entry.currency),
        paidBy: replaceOwner(entry.paidBy),
        payerInferred: entry.payerInferred ?? entry.source !== "guest",
        matchInferred: entry.matchInferred ?? false,
        splitWith: entry.splitWith.map(replaceOwner),
        source: entry.source,
        status: entry.status,
        submittedBy: entry.submittedBy,
      };
    }))).filter((entry): entry is NonNullable<typeof entry> => entry !== null);
    const approved = entries.filter((entry) => entry.status === "approved");
    const storedPayments = await ctx.db.query("tripReportSettlements").withIndex("by_report", (q) => q.eq("reportId", report._id)).collect();
    const payments = await Promise.all(storedPayments.map(async (payment) => ({
      id: payment._id, date: payment.date, from: replaceOwner(payment.from), to: replaceOwner(payment.to),
      amount: await decryptNumberWithFallback(payment.amountEnc, undefined, "tripReportSettlements.amount"),
      currency: payment.currency, rateToInr: payment.rateToInr,
      fxDate: payment.fxDate,
    })));
    const separateCurrencies = viewSeparateCurrencies ?? report.separateCurrencies;
    const settlement = calculateTripSettlement(approved, separateCurrencies, payments);
    return {
      id: report._id, title: report.title, place: report.place,
      ownerName, participants: report.participants.map(replaceOwner),
      expiresAt: report.expiresAt, separateCurrencies,
      candidateTruncated: report.candidateTruncated, isOwner,
      entries: entries.filter((entry) => entry.status === "approved" || isOwner),
      payments,
      settlements: settlement.settlements,
      unappliedPayments: settlement.unappliedPayments,
      hasFallbackFx: approved.some((entry) => entry.currency !== "INR" && entry.fxSource === "fallback"),
      hasLegacyFx: approved.some((entry) => entry.currency !== "INR" && !entry.fxDate) || payments.some((payment) => payment.currency !== "INR" && !payment.fxDate),
      hasOutdatedFx: approved.some((entry) => entry.fxOutdated),
      hasInferredPayers: approved.some((entry) => entry.payerInferred),
    };
  },
});

export const getCreationCandidates = internalQuery({
  args: { profileId: v.id("profiles") },
  handler: async (ctx, { profileId }) => {
    const profile = await ctx.db.get(profileId);
    if (!profile) throw new ConvexError("Profile not found");
    const owner = await ctx.db.get(profile.userId);
    if (!owner?.telegramChatId) throw new ConvexError("Link Telegram before creating a trip report");
    const rows = await ctx.db.query("expenseEntries")
      .withIndex("by_profile_date", (q) => q.eq("profileId", profileId))
      .order("desc").take(501);
    const candidates = await Promise.all(rows.slice(0, 500).map(async (row) => ({
      id: row._id, date: row.date,
      amount: await decryptNumberWithFallback(row.amountEnc, row.amount, "expenseEntries.amount"),
      note: await decryptStringWithFallback(row.noteEnc, row.note) || "",
      currency: row.currency || "INR" as const,
    })));
    return { ownerUserId: profile.userId, ownerName: profile.name, accountName: owner.name, chatId: owner.telegramChatId, candidates, truncated: rows.length > 500 };
  },
});

export const getLinkedExpenseFx = internalQuery({
  args: { expenseId: v.id("expenseEntries") },
  handler: async (ctx, { expenseId }) => {
    const source = await ctx.db.get(expenseId);
    if (!source) return null;
    const linked = await ctx.db.query("tripReportEntries").withIndex("by_expense", (q) => q.eq("expenseId", expenseId)).collect();
    if (!linked.length) return null;
    return { date: source.date, currency: source.currency || "INR" as const };
  },
});

export const setLinkedExpenseFx = internalMutation({
  args: { expenseId: v.id("expenseEntries"), date: v.string(), currency, rateToInr: v.number(), fxSource: v.union(v.literal("service"), v.literal("fallback")), fxDate: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const source = await ctx.db.get(args.expenseId);
    if (!source || source.date !== args.date || (source.currency || "INR") !== args.currency) return;
    const linked = await ctx.db.query("tripReportEntries").withIndex("by_expense", (q) => q.eq("expenseId", args.expenseId)).collect();
    for (const entry of linked) await ctx.db.patch(entry._id, {
      date: args.date, currency: args.currency, rateToInr: args.rateToInr, fxSource: args.fxSource, fxDate: args.fxDate,
    });
  },
});

export const getActiveTripFxInputs = internalQuery({
  args: {},
  handler: async (ctx) => {
    const reports = (await ctx.db.query("tripReports").collect()).filter((report) => report.expiresAt > Date.now());
    const entries = [];
    const payments = [];
    for (const report of reports) {
      const reportEntries = await ctx.db.query("tripReportEntries").withIndex("by_report", (q) => q.eq("reportId", report._id)).collect();
      for (const entry of reportEntries) {
        const source = entry.expenseId ? await ctx.db.get(entry.expenseId) : null;
        if (entry.expenseId && (!source || source.profileId !== report.profileId)) continue;
        const currency = source?.currency || entry.currency;
        if (currency !== "INR") entries.push({ id: entry._id, date: source?.date || entry.date, currency });
      }
      const reportPayments = await ctx.db.query("tripReportSettlements").withIndex("by_report", (q) => q.eq("reportId", report._id)).collect();
      for (const payment of reportPayments) if (payment.currency !== "INR") payments.push({ id: payment._id, date: payment.date, currency: payment.currency });
    }
    return { entries, payments };
  },
});

const refreshedFx = { date: v.string(), currency, rateToInr: v.number(), fxDate: v.string() };

export const applyTripFxRefresh = internalMutation({
  args: {
    entries: v.array(v.object({ id: v.id("tripReportEntries"), ...refreshedFx })),
    payments: v.array(v.object({ id: v.id("tripReportSettlements"), ...refreshedFx })),
  },
  handler: async (ctx, args) => {
    let updated = 0;
    for (const row of args.entries) {
      const entry = await ctx.db.get(row.id);
      if (!entry) continue;
      const source = entry.expenseId ? await ctx.db.get(entry.expenseId) : null;
      if (entry.expenseId && !source) continue;
      if ((source?.date || entry.date) !== row.date || (source?.currency || entry.currency) !== row.currency) continue;
      if (!Number.isFinite(row.rateToInr) || row.rateToInr <= 0 || row.fxDate > row.date) continue;
      await ctx.db.patch(row.id, { date: row.date, currency: row.currency, rateToInr: row.rateToInr, fxSource: "service", fxDate: row.fxDate });
      updated++;
    }
    for (const row of args.payments) {
      const payment = await ctx.db.get(row.id);
      if (!payment || payment.date !== row.date || payment.currency !== row.currency) continue;
      if (!Number.isFinite(row.rateToInr) || row.rateToInr <= 0 || row.fxDate > row.date) continue;
      await ctx.db.patch(row.id, { rateToInr: row.rateToInr, fxDate: row.fxDate });
      updated++;
    }
    return updated;
  },
});

export const createDraft = internalMutation({
  args: {
    profileId: v.id("profiles"), slug: v.string(), title: v.string(), place: v.string(),
    passcodeHash: v.string(), ownerName: v.string(), ownerUserId: v.id("users"),
    participants: v.array(v.string()), candidateTruncated: v.boolean(), entries: v.array(draftedEntry),
  },
  handler: async (ctx, args) => {
    const reportId = await ctx.db.insert("tripReports", {
      profileId: args.profileId, ownerUserId: args.ownerUserId, slug: args.slug,
      title: args.title, place: args.place, ownerName: args.ownerName,
      participants: [...new Set(args.participants.map(cleanName).filter(Boolean))],
      passcodeHash: args.passcodeHash, expiresAt: Date.now() + 14 * 86400000,
      createdAt: Date.now(), failedAttempts: 0, separateCurrencies: false,
      candidateTruncated: args.candidateTruncated,
    });
    for (const entry of args.entries) {
      if (!isoDate.test(entry.date) || !Number.isFinite(entry.amount) || entry.amount <= 0) continue;
      await ctx.db.insert("tripReportEntries", {
        reportId, expenseId: entry.expenseId, date: entry.date,
        noteEnc: (await encryptOptionalString(entry.note || "Expense"))!, amountEnc: await encryptNumber(entry.amount),
        currency: entry.currency, rateToInr: entry.rateToInr, fxSource: entry.fxSource, fxDate: entry.fxDate,
        paidBy: cleanName(entry.paidBy) || args.ownerName,
        payerInferred: entry.payerInferred,
        matchInferred: entry.matchInferred,
        splitWith: [...new Set(args.participants.map(cleanName).filter(Boolean))],
        splitCustomized: false,
        source: "detected", status: "approved", createdAt: Date.now(),
      });
    }
    return reportId;
  },
});

export const unlockWithHash = internalMutation({
  args: { slug: v.string(), passcodeHash: v.string(), token: v.string() },
  handler: async (ctx, args) => {
    const report = await findReport(ctx, args.slug);
    if (!report || report.expiresAt <= Date.now()) return { ok: false, reason: "expired" };
    if (report.lockedUntil && report.lockedUntil > Date.now()) return { ok: false, reason: "locked" };
    if (report.passcodeHash !== args.passcodeHash && report.sharePasscodeHash !== args.passcodeHash) {
      const failedAttempts = report.failedAttempts + 1;
      await ctx.db.patch(report._id, {
        failedAttempts: failedAttempts >= 10 ? 0 : failedAttempts,
        lockedUntil: failedAttempts >= 10 ? Date.now() + 15 * 60000 : undefined,
      });
      return { ok: false, reason: "incorrect" };
    }
    await ctx.db.patch(report._id, { failedAttempts: 0, lockedUntil: undefined });
    await ctx.db.insert("tripReportSessions", { reportId: report._id, token: args.token, expiresAt: Math.min(report.expiresAt, Date.now() + 12 * 3600000) });
    return { ok: true, token: args.token };
  },
});

export const getPasscodeDigest = internalQuery({
  args: { slug: v.string() },
  handler: async (ctx, { slug }) => {
    const report = await findReport(ctx, slug);
    return report && report.expiresAt > Date.now() ? [report.passcodeHash, report.sharePasscodeHash].filter((value): value is string => !!value) : null;
  },
});

export const ensureShareCode = internalMutation({
  args: { reportId: v.id("tripReports"), code: v.string(), hash: v.string() },
  handler: async (ctx, args) => {
    const report = await ctx.db.get(args.reportId);
    if (!report || report.expiresAt <= Date.now()) throw new ConvexError("Report unavailable");
    const userId = await requireProfileAccess(ctx, report.profileId);
    if (userId !== report.ownerUserId) throw new ConvexError("Owner only");
    if (report.shareCodeEnc) return { code: await decryptStringWithFallback(report.shareCodeEnc, undefined) || "", title: report.title, slug: report.slug };
    await ctx.db.patch(report._id, { sharePasscodeHash: args.hash, shareCodeEnc: (await encryptOptionalString(args.code))! });
    return { code: args.code, title: report.title, slug: report.slug };
  },
});

export const getOwnerSettlementReport = internalQuery({
  args: { reportId: v.id("tripReports") },
  handler: async (ctx, { reportId }) => {
    const report = await ctx.db.get(reportId);
    if (!report || report.expiresAt <= Date.now()) throw new ConvexError("Report unavailable");
    const userId = await requireProfileAccess(ctx, report.profileId);
    if (userId !== report.ownerUserId) throw new ConvexError("Owner only");
    return { ownerUserId: userId, participants: report.participants };
  },
});

export const findTelegramSettlementReport = internalQuery({
  args: { ownerUserId: v.id("users"), profileId: v.id("profiles"), trip: v.string() },
  handler: async (ctx, args) => {
    const reports = await ctx.db.query("tripReports").withIndex("by_owner", (q) => q.eq("ownerUserId", args.ownerUserId)).collect();
    const active = reports.filter((report) => report.profileId === args.profileId && report.expiresAt > Date.now());
    const term = args.trip.trim().toLowerCase().replace(/\s+trip$/, "");
    const matches = active.filter((report) => report.title.toLowerCase().includes(term) || report.place.toLowerCase().includes(term));
    if (matches.length !== 1) return { reportId: null, matches: matches.map((report) => report.title) };
    return { reportId: matches[0]!._id, matches: matches.map((report) => report.title) };
  },
});

export const insertSettlement = internalMutation({
  args: {
    reportId: v.id("tripReports"), ownerUserId: v.id("users"), date: v.string(),
    from: v.string(), to: v.string(), amount: v.number(), currency, rateToInr: v.number(), fxDate: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const report = await ctx.db.get(args.reportId);
    if (!report || report.ownerUserId !== args.ownerUserId || report.expiresAt <= Date.now()) throw new ConvexError("Report unavailable");
    const from = report.participants.find((person) => person.toLowerCase() === cleanName(args.from).toLowerCase());
    const to = report.participants.find((person) => person.toLowerCase() === cleanName(args.to).toLowerCase());
    if (!from || !to || from === to) throw new ConvexError("Choose two different trip participants");
    if (!isoDate.test(args.date) || !Number.isFinite(args.amount) || args.amount <= 0 || args.amount > 10000000 || !Number.isFinite(args.rateToInr) || args.rateToInr <= 0) throw new ConvexError("Check the payment details");
    return await ctx.db.insert("tripReportSettlements", {
      reportId: report._id, date: args.date, from, to, amountEnc: await encryptNumber(args.amount),
      currency: args.currency, rateToInr: args.rateToInr, fxDate: args.fxDate, createdAt: Date.now(),
    });
  },
});

export const removeSettlement = mutation({
  args: { settlementId: v.id("tripReportSettlements") },
  handler: async (ctx, { settlementId }) => {
    const payment = await ctx.db.get(settlementId);
    if (!payment) throw new ConvexError("Payment not found");
    const report = await ctx.db.get(payment.reportId);
    if (!report) throw new ConvexError("Report not found");
    const userId = await requireProfileAccess(ctx, report.profileId);
    if (userId !== report.ownerUserId) throw new ConvexError("Owner only");
    await ctx.db.delete(settlementId);
  },
});

export const isSessionValid = internalQuery({
  args: { slug: v.string(), token: v.string() },
  handler: async (ctx, args) => {
    const report = await findReport(ctx, args.slug);
    return !!report && await mayRead(ctx, report, args.token);
  },
});

export const searchOwnerExpenses = query({
  args: { reportId: v.id("tripReports"), search: v.string(), cursor: v.optional(v.string()) },
  handler: async (ctx, { reportId, search, cursor }) => {
    const report = await ctx.db.get(reportId);
    if (!report) throw new ConvexError("Report not found");
    const userId = await requireProfileAccess(ctx, report.profileId);
    if (userId !== report.ownerUserId) throw new ConvexError("Owner only");
    const datePrefix = /^\d{4}-\d{2}(?:-\d{2})?$/.test(search.trim()) ? search.trim() : null;
    const startDate = datePrefix?.length === 7 ? `${datePrefix}-01` : datePrefix;
    const endDate = datePrefix?.length === 7
      ? new Date(Date.UTC(Number(datePrefix.slice(0, 4)), Number(datePrefix.slice(5, 7)), 1)).toISOString().slice(0, 10)
      : datePrefix ? new Date(Date.parse(`${datePrefix}T00:00:00Z`) + 86400000).toISOString().slice(0, 10) : null;
    const page = startDate && endDate
      ? await ctx.db.query("expenseEntries").withIndex("by_profile_date", (q) => q.eq("profileId", report.profileId).gte("date", startDate).lt("date", endDate)).order("desc").paginate({ cursor: cursor ?? null, numItems: 60 })
      : await ctx.db.query("expenseEntries").withIndex("by_profile_date", (q) => q.eq("profileId", report.profileId)).order("desc").paginate({ cursor: cursor ?? null, numItems: 60 });
    const linked = await ctx.db.query("tripReportEntries").withIndex("by_report", (q) => q.eq("reportId", reportId)).collect();
    const linkedIds = new Set(linked.map((entry) => entry.expenseId).filter(Boolean));
    const term = search.trim().toLowerCase();
    const result = await Promise.all(page.page.filter((row) => !linkedIds.has(row._id)).map(async (row) => {
      const note = await decryptStringWithFallback(row.noteEnc, row.note) || "";
      const amount = await decryptNumberWithFallback(row.amountEnc, row.amount, "expenseEntries.amount");
      return !term || note.toLowerCase().includes(term) || row.date.includes(term) || String(amount).includes(term)
        ? { id: row._id, date: row.date, note, amount, currency: row.currency || "INR" }
        : null;
    }));
    return { rows: result.filter((row) => row !== null), continueCursor: page.continueCursor, isDone: page.isDone };
  },
});

export const listActiveForProfile = query({
  args: { profileId: v.id("profiles") },
  handler: async (ctx, { profileId }) => {
    const userId = await requireProfileAccess(ctx, profileId);
    const reports = await ctx.db.query("tripReports").withIndex("by_owner", (q) => q.eq("ownerUserId", userId)).collect();
    return reports.filter((report) => report.profileId === profileId && report.expiresAt > Date.now())
      .map((report) => ({ id: report._id, title: report.title })).sort((a, b) => a.title.localeCompare(b.title));
  },
});

export const getOwnerExpense = internalQuery({
  args: { reportId: v.id("tripReports"), expenseId: v.id("expenseEntries") },
  handler: async (ctx, args) => {
    const report = await ctx.db.get(args.reportId);
    const expense = await ctx.db.get(args.expenseId);
    if (!report || !expense || expense.profileId !== report.profileId) throw new ConvexError("Expense unavailable");
    const userId = await requireProfileAccess(ctx, report.profileId);
    if (userId !== report.ownerUserId) throw new ConvexError("Owner only");
    return {
      date: expense.date, note: await decryptStringWithFallback(expense.noteEnc, expense.note) || "",
      amount: await decryptNumberWithFallback(expense.amountEnc, expense.amount, "expenseEntries.amount"),
      currency: expense.currency || "INR" as const,
      ownerName: report.ownerName,
    };
  },
});

export const addLinkedExpense = internalMutation({
  args: { reportId: v.id("tripReports"), expenseId: v.id("expenseEntries"), entry: draftedEntry },
  handler: async (ctx, args) => {
    const report = await ctx.db.get(args.reportId);
    if (!report || report.expiresAt <= Date.now()) throw new ConvexError("Report expired");
    const userId = await requireProfileAccess(ctx, report.profileId);
    if (userId !== report.ownerUserId) throw new ConvexError("Owner only");
    const expense = await ctx.db.get(args.expenseId);
    if (!expense || expense.profileId !== report.profileId) throw new ConvexError("Expense unavailable");
    const existing = await ctx.db.query("tripReportEntries").withIndex("by_report_expense", (q) => q.eq("reportId", args.reportId).eq("expenseId", args.expenseId)).first();
    if (existing) return existing._id;
    return await ctx.db.insert("tripReportEntries", {
      reportId: args.reportId, expenseId: args.expenseId,
      date: args.entry.date, noteEnc: (await encryptOptionalString(args.entry.note || "Expense"))!,
      amountEnc: await encryptNumber(args.entry.amount), currency: args.entry.currency,
      rateToInr: args.entry.rateToInr, fxSource: args.entry.fxSource, fxDate: args.entry.fxDate,
      paidBy: report.ownerName, splitWith: report.participants,
      payerInferred: false,
      splitCustomized: false,
      source: "owner", status: "approved", createdAt: Date.now(),
    });
  },
});

export const addGuestProposal = internalMutation({
  args: { slug: v.string(), token: v.string(), submittedBy: v.string(), entry: draftedEntry },
  handler: async (ctx, args) => {
    const report = await findReport(ctx, args.slug);
    if (!report || !(await mayRead(ctx, report, args.token))) throw new ConvexError("Unlock the report first");
    const submittedBy = cleanName(args.submittedBy);
    if (!submittedBy || !isoDate.test(args.entry.date) || args.entry.amount <= 0 || args.entry.amount > 10000000 || !Number.isFinite(args.entry.amount)) throw new ConvexError("Check the expense details");
    const recent = await ctx.db.query("tripReportEntries").withIndex("by_report", (q) => q.eq("reportId", report._id)).collect();
    if (recent.filter((entry) => entry.source === "guest" && entry.createdAt > Date.now() - 3600000).length >= 20) throw new ConvexError("Too many guest suggestions. Try again later");
    const note = args.entry.note.trim().slice(0, 200);
    if (!note) throw new ConvexError("Add a description");
    const entryId = await ctx.db.insert("tripReportEntries", {
      reportId: report._id, date: args.entry.date,
      noteEnc: (await encryptOptionalString(note))!, amountEnc: await encryptNumber(args.entry.amount),
      currency: args.entry.currency, rateToInr: args.entry.rateToInr, fxSource: args.entry.fxSource, fxDate: args.entry.fxDate,
      paidBy: submittedBy, splitWith: report.participants.includes(submittedBy) ? report.participants : [...report.participants, submittedBy],
      payerInferred: false,
      splitCustomized: false,
      source: "guest", status: "pending", submittedBy, createdAt: Date.now(),
    });
    await ctx.scheduler.runAfter(0, (internal as any).tripReportActions.notifyOwner, { entryId });
    return entryId;
  },
});

export const getProposalNotification = internalQuery({
  args: { entryId: v.id("tripReportEntries") },
  handler: async (ctx, { entryId }) => {
    const entry = await ctx.db.get(entryId);
    if (!entry || entry.source !== "guest") return null;
    const report = await ctx.db.get(entry.reportId);
    if (!report) return null;
    const owner = await ctx.db.get(report.ownerUserId);
    if (!owner?.telegramChatId) return null;
    return { chatId: owner.telegramChatId, title: report.title, submittedBy: entry.submittedBy || "Guest", note: await decryptStringWithFallback(entry.noteEnc, undefined) || "", amount: await decryptNumberWithFallback(entry.amountEnc, undefined, "tripReportEntries.amount"), currency: entry.currency, status: entry.status };
  },
});

export const resolveGuestProposal = internalMutation({
  args: { entryId: v.id("tripReportEntries"), chatId: v.string(), fromId: v.string(), approve: v.boolean() },
  handler: async (ctx, args) => {
    const entry = await ctx.db.get(args.entryId);
    if (!entry || entry.source !== "guest") return "Unavailable";
    const report = await ctx.db.get(entry.reportId);
    const owner = report && await ctx.db.get(report.ownerUserId);
    if (!owner?.telegramChatId || owner.telegramChatId !== args.chatId || args.fromId !== args.chatId) return "Only the report owner can decide";
    if (entry.status !== "pending") return `Already ${entry.status}`;
    await ctx.db.patch(entry._id, { status: args.approve ? "approved" : "rejected" });
    if (args.approve && !report!.participants.includes(entry.paidBy)) {
      await ctx.db.patch(report!._id, { participants: [...report!.participants, entry.paidBy] });
    }
    return args.approve ? "Approved and added to the trip" : "Declined";
  },
});

export const updateEntry = mutation({
  args: { entryId: v.id("tripReportEntries"), paidBy: v.string(), splitWith: v.array(v.string()), newPerson: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const entry = await ctx.db.get(args.entryId);
    if (!entry) throw new ConvexError("Entry not found");
    const report = await ctx.db.get(entry.reportId);
    if (!report) throw new ConvexError("Report not found");
    const userId = await requireProfileAccess(ctx, report.profileId);
    if (userId !== report.ownerUserId) throw new ConvexError("Owner only");
    const requestedPerson = cleanName(args.newPerson || "");
    const existingPerson = requestedPerson && report.participants.find((person) => person.toLowerCase() === requestedPerson.toLowerCase());
    const newPerson = requestedPerson && !existingPerson ? requestedPerson : null;
    if (newPerson && report.participants.length >= 30) throw new ConvexError("A trip can have up to 30 people");
    const canonicalName = (value: string) => {
      const name = cleanName(value);
      if (requestedPerson && name.toLowerCase() === requestedPerson.toLowerCase()) return existingPerson || newPerson || name;
      return report.participants.find((person) => person.toLowerCase() === name.toLowerCase()) || name;
    };
    const participants = newPerson ? [...report.participants, newPerson] : report.participants;
    const paidBy = canonicalName(args.paidBy);
    const splitWith = [...new Set(args.splitWith.map(canonicalName).filter(Boolean))];
    const personToAdd = existingPerson || newPerson;
    if (personToAdd && !splitWith.includes(personToAdd)) splitWith.push(personToAdd);
    if (!participants.includes(paidBy) || !splitWith.length || splitWith.some((name) => !participants.includes(name))) throw new ConvexError("Choose report participants");
    if (newPerson) await ctx.db.patch(report._id, { participants });
    await ctx.db.patch(entry._id, { paidBy, payerInferred: false, splitWith, splitCustomized: true });
  },
});

export const updateReport = mutation({
  args: { reportId: v.id("tripReports"), title: v.optional(v.string()), separateCurrencies: v.optional(v.boolean()), participants: v.optional(v.array(v.string())), includeInExistingExpenses: v.optional(v.boolean()) },
  handler: async (ctx, args) => {
    const report = await ctx.db.get(args.reportId);
    if (!report) throw new ConvexError("Report not found");
    const userId = await requireProfileAccess(ctx, report.profileId);
    if (userId !== report.ownerUserId) throw new ConvexError("Owner only");
    const patch: { title?: string; separateCurrencies?: boolean; participants?: string[] } = {};
    if (args.title !== undefined) {
      const title = args.title.trim().replace(/\s+/g, " ");
      if (!title || title.length > 80) throw new ConvexError("Enter a trip name under 80 characters");
      patch.title = title;
    }
    if (args.separateCurrencies !== undefined) patch.separateCurrencies = args.separateCurrencies;
    if (args.participants) {
      const participants = [...new Set(args.participants.map(cleanName).filter(Boolean))];
      if (!participants.length || participants.length > 30) throw new ConvexError("Add 1 to 30 people");
      if (report.participants.some((person) => !participants.includes(person))) throw new ConvexError("Remove people individually from the trip");
      const entries = await ctx.db.query("tripReportEntries").withIndex("by_report", (q) => q.eq("reportId", report._id)).collect();
      if (entries.some((entry) => entry.status === "approved" && (!participants.includes(entry.paidBy) || entry.splitWith.some((person) => !participants.includes(person))))) throw new ConvexError("Keep people who appear in an approved expense");
      const payments = await ctx.db.query("tripReportSettlements").withIndex("by_report", (q) => q.eq("reportId", report._id)).collect();
      if (payments.some((payment) => !participants.includes(payment.from) || !participants.includes(payment.to))) throw new ConvexError("Keep people who appear in a payment");
      const added = participants.filter((person) => !report.participants.includes(person));
      if (args.includeInExistingExpenses && added.length) {
        for (const entry of entries) {
          if (entry.status !== "rejected") await ctx.db.patch(entry._id, { splitWith: [...new Set([...entry.splitWith, ...added])] });
        }
      }
      patch.participants = participants;
    }
    await ctx.db.patch(report._id, patch);
  },
});

export const renameParticipant = mutation({
  args: { reportId: v.id("tripReports"), from: v.string(), to: v.string() },
  handler: async (ctx, { reportId, from, to }) => {
    const report = await ctx.db.get(reportId);
    if (!report) throw new ConvexError("Report not found");
    const userId = await requireProfileAccess(ctx, report.profileId);
    if (userId !== report.ownerUserId) throw new ConvexError("Owner only");
    if (!report.participants.includes(from)) throw new ConvexError("Person not found on this trip");
    const nextName = cleanName(to);
    if (!nextName) throw new ConvexError("Enter a name");
    const { replace, names } = renameTripPerson(from, nextName);
    const participants = names(report.participants);
    const entries = await ctx.db.query("tripReportEntries").withIndex("by_report", (q) => q.eq("reportId", reportId)).collect();
    for (const entry of entries) await ctx.db.patch(entry._id, {
      paidBy: replace(entry.paidBy),
      splitWith: names(entry.splitWith),
      ...(entry.submittedBy === from ? { submittedBy: nextName } : {}),
    });
    const payments = await ctx.db.query("tripReportSettlements").withIndex("by_report", (q) => q.eq("reportId", reportId)).collect();
    for (const payment of payments) await ctx.db.patch(payment._id, { from: replace(payment.from), to: replace(payment.to) });
    await ctx.db.patch(reportId, { participants, ownerName: replace(report.ownerName) });
  },
});

export const removeParticipant = mutation({
  args: { reportId: v.id("tripReports"), person: v.string() },
  handler: async (ctx, { reportId, person }) => {
    const report = await ctx.db.get(reportId);
    if (!report) throw new ConvexError("Report not found");
    const userId = await requireProfileAccess(ctx, report.profileId);
    if (userId !== report.ownerUserId) throw new ConvexError("Owner only");
    if (!report.participants.includes(person)) throw new ConvexError("Person not found on this trip");
    if (person === report.ownerName) return { ok: false as const, reason: "The trip owner cannot be removed." };
    if (report.participants.length <= 1) return { ok: false as const, reason: "Keep at least one person on the trip." };

    const entries = await ctx.db.query("tripReportEntries").withIndex("by_report", (q) => q.eq("reportId", reportId)).collect();
    if (entries.some((entry) => entry.status !== "rejected" && entry.paidBy === person)) {
      return { ok: false as const, reason: `Change the payer on ${person}'s expenses before removing them.` };
    }
    const payments = await ctx.db.query("tripReportSettlements").withIndex("by_report", (q) => q.eq("reportId", reportId)).collect();
    if (payments.some((payment) => payment.from === person || payment.to === person)) {
      return { ok: false as const, reason: `Remove payments involving ${person} before removing them.` };
    }
    if (entries.some((entry) => entry.status !== "rejected" && entry.splitWith.length === 1 && entry.splitWith[0] === person)) {
      return { ok: false as const, reason: `Edit expenses split only with ${person} before removing them.` };
    }

    const participants = report.participants.filter((name) => name !== person);
    for (const entry of entries) {
      if (!entry.splitWith.includes(person)) continue;
      const splitWith = entry.splitWith.filter((name) => name !== person);
      await ctx.db.patch(entry._id, { splitWith });
    }
    await ctx.db.patch(reportId, { participants });
    return { ok: true as const };
  },
});

export const getPlaceholderOwners = internalQuery({
  args: {},
  handler: async (ctx) => {
    const reports = await ctx.db.query("tripReports").collect();
    const result = [];
    for (const report of reports) {
      if (report.expiresAt <= Date.now() || !/^(me|trip owner)$/i.test(report.ownerName)) continue;
      const owner = await ctx.db.get(report.ownerUserId);
      const profile = await ctx.db.get(report.profileId);
      result.push({ reportId: report._id, chatId: owner?.telegramChatId,
        accountName: owner?.name, profileName: profile?.name });
    }
    return result;
  },
});

export const repairPlaceholderOwner = internalMutation({
  args: { reportId: v.id("tripReports"), name: v.string() },
  handler: async (ctx, { reportId, name }) => {
    const report = await ctx.db.get(reportId);
    if (!report || !/^(me|trip owner)$/i.test(report.ownerName)) return false;
    const next = tripOwnerName(name);
    if (!next || report.participants.some((person) => person !== report.ownerName && person.toLowerCase() === next.toLowerCase())) return false;
    const replace = (person: string) => person === report.ownerName ? next : person;
    const entries = await ctx.db.query("tripReportEntries").withIndex("by_report", (q) => q.eq("reportId", reportId)).collect();
    for (const entry of entries) await ctx.db.patch(entry._id, {
      paidBy: replace(entry.paidBy), splitWith: entry.splitWith.map(replace),
    });
    await ctx.db.patch(reportId, { ownerName: next, participants: report.participants.map(replace) });
    return true;
  },
});

export const removeReportExpense = mutation({
  args: { entryId: v.id("tripReportEntries") },
  handler: async (ctx, { entryId }) => {
    const entry = await ctx.db.get(entryId);
    if (!entry || entry.status !== "approved") throw new ConvexError("Report expense not found");
    const report = await ctx.db.get(entry.reportId);
    if (!report) throw new ConvexError("Report not found");
    const userId = await requireProfileAccess(ctx, report.profileId);
    if (userId !== report.ownerUserId) throw new ConvexError("Owner only");
    if (entry.source === "detected" && entry.expenseId) await ctx.db.patch(report._id, {
      excludedExpenseIds: [...new Set([...(report.excludedExpenseIds || []), entry.expenseId])],
    });
    await ctx.db.delete(entryId);
  },
});
