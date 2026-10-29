"use node";

import { randomBytes, createHash } from "node:crypto";
import { v, ConvexError } from "convex/values";
import { action, internalAction } from "./_generated/server";
import { internal } from "./_generated/api";
import { getAuthUserId } from "@convex-dev/auth/server";
import { getTripToInrRate } from "./lib/tripFxService";
import { tripDateWindow, candidatesInWindow } from "./lib/tripInference";
import { tripOwnerName } from "./lib/tripIdentity";

type Currency = "INR" | "USD" | "THB";
const currency = v.union(v.literal("INR"), v.literal("USD"), v.literal("THB"));
const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const code = () => Array.from(randomBytes(4), (byte) => ALPHABET[byte % ALPHABET.length]).join("");
const digest = (salt: string, passcode: string) => createHash("sha256").update(`${salt}:${passcode}`).digest("hex");
const publicUrl = () => (process.env.APP_PUBLIC_URL || process.env.SITE_URL || "http://localhost:3000").replace(/\/+$/, "");
const escapeHtml = (value: string) => value.replace(/[&<>]/g, (ch) => ch === "&" ? "&amp;" : ch === "<" ? "&lt;" : "&gt;");

async function rateFor(currencyCode: Currency, date: string) {
  const result = await getTripToInrRate(currencyCode, date);
  return { rateToInr: result.rate, fxSource: "service" as const, fxDate: result.date };
}

export const refreshActiveTripFx = internalAction({
  args: {},
  handler: async (ctx): Promise<{ updated: number; dates: number; failedDates: string[] }> => {
    const inputs = await ctx.runQuery((internal as any).tripReports.getActiveTripFxInputs, {}) as {
      entries: Array<{ id: any; date: string; currency: Currency }>;
      payments: Array<{ id: any; date: string; currency: Currency }>;
    };
    const rates = new Map<string, Awaited<ReturnType<typeof rateFor>>>();
    const failedDates: string[] = [];
    for (const row of [...inputs.entries, ...inputs.payments]) {
      const key = `${row.currency}:${row.date}`;
      if (rates.has(key) || failedDates.includes(key)) continue;
      try { rates.set(key, await rateFor(row.currency, row.date)); }
      catch { failedDates.push(key); }
    }
    const withRate = <T extends { date: string; currency: Currency }>(row: T) => {
      const { rateToInr, fxDate } = rates.get(`${row.currency}:${row.date}`)!;
      return { ...row, rateToInr, fxDate };
    };
    const entries = inputs.entries.filter((row) => rates.has(`${row.currency}:${row.date}`)).map(withRate);
    const payments = inputs.payments.filter((row) => rates.has(`${row.currency}:${row.date}`)).map(withRate);
    let updated = 0;
    for (let offset = 0; offset < Math.max(entries.length, payments.length); offset += 100) {
      updated += await ctx.runMutation((internal as any).tripReports.applyTripFxRefresh, {
        entries: entries.slice(offset, offset + 100), payments: payments.slice(offset, offset + 100),
      }) as number;
    }
    return { updated, dates: rates.size, failedDates };
  },
});

type Candidate = { id: string; date: string; note: string; amount: number; currency: Currency };

async function modelMatches(apiKey: string, place: string, rows: Candidate[], anchors: Candidate[], window: ReturnType<typeof tripDateWindow>) {
  if (!rows.length) return [] as Array<{ id: string; paidBy?: string }>;
  const matches: Array<{ id: string; paidBy?: string }> = [];
  for (let offset = 0; offset < rows.length; offset += 40) {
    const batch = rows.slice(offset, offset + 40);
    const response = await fetch("https://generativelanguage.googleapis.com/v1beta/openai/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: process.env.GOOGLE_AI_TRIP_MODEL || "gemini-3.5-flash",
        temperature: 0, max_tokens: 1800,
        messages: [
          { role: "system", content: `Identify expenses from one trip to ${place}. The anchor notes explicitly mention the place. All candidate rows are from the surrounding trip dates (${window?.startDate || "unknown"} to ${window?.endDate || "unknown"}, end exclusive). Include plausible trip spending even when a candidate note omits the place: meals, cafes, rides, Grab from hostel, accommodation, activities, and shared purchases such as a dessert paid by a companion. Use the dates and anchor notes as context. Exclude obvious regular bills, subscriptions, and expenses explicitly in another place. Return ONLY JSON {"matches":[{"id":"record id","paidBy":"person name or empty string"}]}. Extract paidBy only when the note explicitly names who paid, such as "paid by Kartik". Do not infer a payer from an account name. Use only supplied IDs.` },
          { role: "user", content: JSON.stringify({ anchors: anchors.slice(0, 12), candidates: batch }) },
        ],
      }),
    });
    if (!response.ok) throw new Error(`Trip selection model HTTP ${response.status}`);
    const payload = await response.json();
    const raw = payload?.choices?.[0]?.message?.content;
    if (typeof raw !== "string") throw new Error("Trip selection model returned no content");
    const json = raw.match(/\{[\s\S]*\}/)?.[0];
    const parsed = json ? JSON.parse(json) : null;
    if (!parsed || !Array.isArray(parsed.matches)) throw new Error("Trip selection model returned invalid JSON");
    const ids = new Set(batch.map((row) => row.id));
    for (const match of parsed.matches) {
      if (match && typeof match.id === "string" && ids.has(match.id)) {
        matches.push({ id: match.id, paidBy: typeof match.paidBy === "string" ? match.paidBy.trim().slice(0, 60) : undefined });
      }
    }
  }
  return matches;
}

async function selectTripExpenses(apiKey: string, place: string, candidates: Candidate[]) {
  const window = tripDateWindow(place, candidates);
  if (!window) throw new ConvexError(`No dated ${place} expense found to anchor this trip. Add one place-labeled expense first.`);
  const nearby = candidatesInWindow(candidates, window);
  const direct = nearby.filter((row) => row.note.toLowerCase().includes(place.toLowerCase()));
  let selected: Array<{ id: string; paidBy?: string }> = [];
  try { selected = await modelMatches(apiKey, place, nearby, direct, window); }
  catch (error) { console.error("[trip] Selection failed; using contextual notes", error); }
  const selectedIds = new Map(selected.map((row) => [row.id, row.paidBy]));
  for (const row of nearby) {
    const namedPayer = /\bpaid by ([a-z][a-z '-]{1,35}?)(?:\s+(?:for|at|on|with)\b|[,.!?]|$)/i.exec(row.note)?.[1]?.trim();
    if (namedPayer && selectedIds.has(row.id) && !selectedIds.get(row.id)) selectedIds.set(row.id, namedPayer);
  }
  for (const row of direct) if (!selectedIds.has(row.id)) selectedIds.set(row.id, undefined);
  for (const row of nearby) {
    if (!selectedIds.has(row.id) && /\b(?:hostel|guesthouse|hotel|grab|tuk[ -]?tuk|paid by [a-z][a-z '-]{1,35})\b/i.test(row.note)) {
      selectedIds.set(row.id, /\bpaid by ([a-z][a-z '-]{1,35})\b/i.exec(row.note)?.[1]?.trim());
    }
  }
  return { rows: nearby.filter((row) => selectedIds.has(row.id)), selectedIds, window };
}

async function draftDetectedEntries(place: string, rows: Candidate[], selectedIds: Map<string, string | undefined>) {
  const rates = new Map<string, Awaited<ReturnType<typeof rateFor>>>();
  const entries = [];
  for (const row of rows) {
    const key = `${row.currency}:${row.date}`;
    if (!rates.has(key)) rates.set(key, await rateFor(row.currency, row.date));
    entries.push({
      expenseId: row.id, date: row.date, note: row.note, amount: row.amount, currency: row.currency,
      ...rates.get(key)!, paidBy: selectedIds.get(row.id) || "",
      payerInferred: !selectedIds.get(row.id),
      matchInferred: !row.note.toLowerCase().includes(place.toLowerCase()),
    });
  }
  return entries;
}

export const createFromTelegram = internalAction({
  args: { profileId: v.id("profiles"), place: v.string(), ownerDisplayName: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const place = args.place.trim().replace(/\s+/g, " ").slice(0, 80);
    if (!place) throw new ConvexError("Name a place for the trip");
    const source = await ctx.runQuery((internal as any).tripReports.getCreationCandidates, { profileId: args.profileId }) as {
      ownerUserId: any; ownerName: string; accountName?: string; chatId: string; truncated: boolean;
      candidates: Array<{ id: any; date: string; note: string; amount: number; currency: Currency }>;
    };
    const runtimeAi = await ctx.runQuery((internal as any).aiSettings.resolveRuntimeAiKey, { userId: source.ownerUserId }) as { apiKey: string | null };
    if (!runtimeAi.apiKey) throw new ConvexError("AI is not configured for this account");
    const ownerName = tripOwnerName(source.ownerName, source.accountName, args.ownerDisplayName);
    if (!ownerName) throw new ConvexError("Your Telegram first name is required to create this report");
    const { rows, selectedIds } = await selectTripExpenses(runtimeAi.apiKey, place, source.candidates);
    const participants = [...new Set([ownerName, ...rows.map((row) => selectedIds.get(row.id) || "")].filter(Boolean))];
    const entries = (await draftDetectedEntries(place, rows, selectedIds)).map((entry) => ({
      ...entry, paidBy: entry.paidBy || ownerName,
    }));
    const passcode = code();
    const salt = randomBytes(16).toString("hex");
    const slug = randomBytes(12).toString("hex");
    await ctx.runMutation((internal as any).tripReports.createDraft, {
      profileId: args.profileId, slug, title: `${place} trip expenses`, place,
      passcodeHash: `${salt}:${digest(salt, passcode)}`,
      ownerName, ownerUserId: source.ownerUserId,
      participants, candidateTruncated: source.truncated, entries,
    });
    return { url: `${publicUrl()}/trip/${slug}`, passcode, count: entries.length, truncated: source.truncated };
  },
});

export const repairLegacyOwnerNames = internalAction({
  args: {},
  handler: async (ctx): Promise<{ repaired: number; unresolved: number }> => {
    const reports = await ctx.runQuery((internal as any).tripReports.getPlaceholderOwners, {}) as Array<{
      reportId: any; chatId?: string; profileName?: string; accountName?: string;
    }>;
    const botToken = process.env.TELEGRAM_BOT_TOKEN;
    let repaired = 0;
    let unresolved = 0;
    for (const report of reports) {
      let name = tripOwnerName(report.profileName, report.accountName);
      if (!name && botToken && report.chatId) {
        try {
          const response = await fetch(`https://api.telegram.org/bot${botToken}/getChat?chat_id=${encodeURIComponent(report.chatId)}`);
          if (response.ok) {
            const result = await response.json();
            name = tripOwnerName(undefined, undefined, result?.result?.first_name);
          }
        } catch {
          // Leave the report untouched if Telegram is unavailable.
        }
      }
      if (name && await ctx.runMutation((internal as any).tripReports.repairPlaceholderOwner, { reportId: report.reportId, name })) repaired++;
      else unresolved++;
    }
    return { repaired, unresolved };
  },
});

export const unlock = action({
  args: { slug: v.string(), passcode: v.string() },
  handler: async (ctx, args): Promise<{ ok: boolean; reason?: string; token?: string }> => {
    const passcode = args.passcode.trim().toUpperCase();
    if (!/^[A-HJ-NP-Z2-9]{4}$/.test(passcode)) return { ok: false, reason: "incorrect" } as const;
    const stored = await ctx.runQuery((internal as any).tripReports.getPasscodeDigest, { slug: args.slug }) as string[] | null;
    if (!stored?.length) return { ok: false, reason: "expired" } as const;
    const hash = stored.map((value) => { const [salt] = value.split(":"); return `${salt}:${digest(salt!, passcode)}`; }).find((candidate) => stored.includes(candidate)) || `${stored[0]!.split(":")[0]}:${digest(stored[0]!.split(":")[0]!, passcode)}`;
    const token = randomBytes(32).toString("hex");
    return await ctx.runMutation((internal as any).tripReports.unlockWithHash, { slug: args.slug, passcodeHash: hash, token }) as { ok: boolean; reason?: string; token?: string };
  },
});

export const getShareText = action({
  args: { reportId: v.id("tripReports") },
  handler: async (ctx, args): Promise<string> => {
    if (!await getAuthUserId(ctx)) throw new ConvexError("Sign in to share this trip");
    const shareCode = code();
    const salt = randomBytes(16).toString("hex");
    const saved = await ctx.runMutation((internal as any).tripReports.ensureShareCode, {
      reportId: args.reportId, code: shareCode, hash: `${salt}:${digest(salt, shareCode)}`,
    }) as { code: string; title: string; slug: string };
    return `${saved.title}\n${publicUrl()}/trip/${saved.slug}\nPasscode: ${saved.code}`;
  },
});

export const recordSettlement = action({
  args: { reportId: v.id("tripReports"), date: v.string(), from: v.string(), to: v.string(), amount: v.number(), currency },
  handler: async (ctx, args): Promise<string> => {
    if (!await getAuthUserId(ctx)) throw new ConvexError("Sign in to record a payment");
    const owner = await ctx.runQuery((internal as any).tripReports.getOwnerSettlementReport, { reportId: args.reportId }) as { ownerUserId: any };
    const fx = await rateFor(args.currency, args.date);
    return await ctx.runMutation((internal as any).tripReports.insertSettlement, {
      ...args, ownerUserId: owner.ownerUserId, rateToInr: fx.rateToInr, fxDate: fx.fxDate,
    }) as string;
  },
});

export const recordSettlementFromTelegram = internalAction({
  args: { ownerUserId: v.id("users"), profileId: v.id("profiles"), trip: v.string(), date: v.string(), from: v.string(), to: v.string(), amount: v.number(), currency },
  handler: async (ctx, args): Promise<{ title?: string; error?: string }> => {
    const match = await ctx.runQuery((internal as any).tripReports.findTelegramSettlementReport, {
      ownerUserId: args.ownerUserId, profileId: args.profileId, trip: args.trip,
    }) as { reportId: any | null; matches: string[] };
    if (!match.reportId) return { error: match.matches.length ? `More than one trip matched. Use the full trip name: ${match.matches.join(", ")}` : "No active trip report matched that name." };
    const fx = await rateFor(args.currency, args.date);
    await ctx.runMutation((internal as any).tripReports.insertSettlement, {
      reportId: match.reportId, ownerUserId: args.ownerUserId, date: args.date,
      from: args.from, to: args.to, amount: args.amount, currency: args.currency, rateToInr: fx.rateToInr, fxDate: fx.fxDate,
    });
    return { title: match.matches[0] };
  },
});

export const addOwnerExpense = action({
  args: { reportId: v.id("tripReports"), expenseId: v.id("expenseEntries") },
  handler: async (ctx, args): Promise<string> => {
    const entry = await ctx.runQuery((internal as any).tripReports.getOwnerExpense, args) as { date: string; note: string; amount: number; currency: Currency; ownerName: string };
    const fx = await rateFor(entry.currency, entry.date);
    return await ctx.runMutation((internal as any).tripReports.addLinkedExpense, {
      ...args, entry: { expenseId: args.expenseId, date: entry.date, note: entry.note,
        amount: entry.amount, currency: entry.currency, paidBy: entry.ownerName, payerInferred: true, ...fx },
    }) as string;
  },
});

export const refreshLinkedExpenseFx = internalAction({
  args: { expenseId: v.id("expenseEntries") },
  handler: async (ctx, { expenseId }) => {
    const source = await ctx.runQuery((internal as any).tripReports.getLinkedExpenseFx, { expenseId }) as null | { date: string; currency: Currency };
    if (!source) return;
    const fx = await rateFor(source.currency, source.date);
    await ctx.runMutation((internal as any).tripReports.setLinkedExpenseFx, { expenseId, date: source.date, currency: source.currency, ...fx });
  },
});

export const submitGuestExpense = action({
  args: { slug: v.string(), token: v.string(), submittedBy: v.string(), date: v.string(), note: v.string(), amount: v.number(), currency },
  handler: async (ctx, args): Promise<string> => {
    if (!(await ctx.runQuery((internal as any).tripReports.isSessionValid, { slug: args.slug, token: args.token }))) throw new ConvexError("Unlock the report first");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(args.date) || !Number.isFinite(args.amount) || args.amount <= 0 || args.amount > 10000000) throw new ConvexError("Check the expense details");
    const fx = await rateFor(args.currency, args.date);
    return await ctx.runMutation((internal as any).tripReports.addGuestProposal, {
      slug: args.slug, token: args.token, submittedBy: args.submittedBy,
      entry: { date: args.date, note: args.note, amount: args.amount, currency: args.currency, paidBy: args.submittedBy, payerInferred: false, ...fx },
    }) as string;
  },
});

export const notifyOwner = internalAction({
  args: { entryId: v.id("tripReportEntries") },
  handler: async (ctx, { entryId }) => {
    const info = await ctx.runQuery((internal as any).tripReports.getProposalNotification, { entryId }) as null | { chatId: string; title: string; submittedBy: string; note: string; amount: number; currency: Currency; status: string };
    const token = process.env.TELEGRAM_BOT_TOKEN;
    if (!info || info.status !== "pending" || !token) return;
    const response = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: info.chatId, parse_mode: "HTML",
        text: `🧾 <b>${escapeHtml(info.title)}</b>\n${escapeHtml(info.submittedBy)} added ${escapeHtml(info.currency)} ${info.amount.toFixed(2)} for ${escapeHtml(info.note)}. Approve this guest expense?`,
        reply_markup: { inline_keyboard: [[
          { text: "✅ Approve", callback_data: `trip:a:${entryId}` },
          { text: "✕ Decline", callback_data: `trip:r:${entryId}` },
        ]] },
      }),
    });
    if (!response.ok) throw new Error(`Telegram approval message HTTP ${response.status}`);
  },
});

export const handleApprovalCallback = internalAction({
  args: { callbackId: v.string(), chatId: v.string(), fromId: v.string(), messageId: v.number(), data: v.string() },
  handler: async (ctx, args) => {
    const match = /^trip:([ar]):([A-Za-z0-9_-]+)$/.exec(args.data);
    if (!match) return;
    let answer = "Could not process this request";
    try {
      answer = await ctx.runMutation((internal as any).tripReports.resolveGuestProposal, {
        entryId: match[2] as any, chatId: args.chatId, fromId: args.fromId, approve: match[1] === "a",
      });
    } catch (error) {
      console.error("[trip] Approval callback failed", error);
    }
    const botToken = process.env.TELEGRAM_BOT_TOKEN;
    if (!botToken) return;
    try {
      await fetch(`https://api.telegram.org/bot${botToken}/answerCallbackQuery`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ callback_query_id: args.callbackId, text: answer, show_alert: false }),
      });
    } catch (error) {
      console.error("[trip] Could not acknowledge approval button", error);
    }
    if (!Number.isSafeInteger(args.messageId) || args.messageId <= 0 || !["Approved and added to the trip", "Declined", "Already approved", "Already rejected"].includes(answer)) return;
    const info = await ctx.runQuery((internal as any).tripReports.getProposalNotification, { entryId: match[2] as any }) as null | { chatId: string; title: string; submittedBy: string; note: string; amount: number; currency: Currency; status: string };
    if (!info || info.chatId !== args.chatId || !["approved", "rejected"].includes(info.status)) return;
    const status = info.status === "approved" ? "✅ Approved and added to the trip" : "✕ Declined";
    const response = await fetch(`https://api.telegram.org/bot${botToken}/editMessageText`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: args.chatId, message_id: args.messageId, parse_mode: "HTML",
        text: `🧾 <b>${escapeHtml(info.title)}</b>\n${escapeHtml(info.submittedBy)} added ${escapeHtml(info.currency)} ${info.amount.toFixed(2)} for ${escapeHtml(info.note)}.\n\n${status}` }),
    });
    if (!response.ok) console.error("[trip] Could not update approval message", response.status);
  },
});

// Run once after release to preserve the current webhook and enable the
// callback_query updates used by the approval buttons.
export const ensureApprovalCallbacks = internalAction({
  args: {},
  handler: async () => {
    const botToken = process.env.TELEGRAM_BOT_TOKEN;
    const secret = process.env.TELEGRAM_WEBHOOK_SECRET;
    if (!botToken || !secret) throw new Error("Telegram webhook configuration is missing");
    const infoResponse = await fetch(`https://api.telegram.org/bot${botToken}/getWebhookInfo`);
    if (!infoResponse.ok) throw new Error(`getWebhookInfo HTTP ${infoResponse.status}`);
    const info = (await infoResponse.json())?.result;
    if (!info?.url) throw new Error("No Telegram webhook is configured");
    const allowed = Array.isArray(info.allowed_updates) ? info.allowed_updates as string[] : null;
    if (!allowed || allowed.includes("callback_query")) return { changed: false, callbacksEnabled: true };
    const response = await fetch(`https://api.telegram.org/bot${botToken}/setWebhook`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url: info.url, secret_token: secret, allowed_updates: [...new Set([...allowed, "callback_query"])] }),
    });
    if (!response.ok || !(await response.json())?.ok) throw new Error(`setWebhook HTTP ${response.status}`);
    return { changed: true, callbacksEnabled: true };
  },
});
