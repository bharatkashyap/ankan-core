"use node";

import { v } from "convex/values";
import { internalAction } from "./_generated/server";
import { internal } from "./_generated/api";
import { sumMealMacros } from "./lib/healthMacroTotals.js";

const endpoint = "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions";

const datePattern = /^\d{4}-\d{2}-\d{2}$/;
const tools = [
  { type: "function", function: { name: "get_expenses", description: "Read saved expenses with decrypted notes, categories, amounts, currencies, and dates. Use date bounds to narrow results.", parameters: { type: "object", properties: { startDate: { type: "string", description: "Inclusive YYYY-MM-DD" }, endDate: { type: "string", description: "Exclusive YYYY-MM-DD" }, limit: { type: "integer", description: "1 to 200" } } } } },
  { type: "function", function: { name: "get_income", description: "Read saved income entries with notes, categories, amounts, currencies, and dates.", parameters: { type: "object", properties: { startDate: { type: "string" }, endDate: { type: "string" }, limit: { type: "integer" } } } } },
  { type: "function", function: { name: "get_health_entries", description: "Read saved meals and exercises with dates, notes, calories, macros, and exercise measurements.", parameters: { type: "object", properties: { startDate: { type: "string" }, endDate: { type: "string" }, limit: { type: "integer" } } } } },
  { type: "function", function: { name: "get_meal_totals", description: "Calculate exact protein, carb, fat, and calorie totals from saved meals in a date range. Reports missing macro data.", parameters: { type: "object", properties: { startDate: { type: "string", description: "Inclusive YYYY-MM-DD" }, endDate: { type: "string", description: "Exclusive YYYY-MM-DD" } } } } },
  { type: "function", function: { name: "get_balances", description: "Read current account balance snapshots.", parameters: { type: "object", properties: {} } } },
  { type: "function", function: { name: "sum_selected_money", description: "Sum amounts of expense or income IDs returned by prior tool calls, keeping currencies separate.", parameters: { type: "object", properties: { ids: { type: "array", items: { type: "string" } } }, required: ["ids"] } } },
] as const;

type Row = { id: string; amount: number; currency: string };
type Message = { role: "system" | "user" | "assistant" | "tool"; content?: string | null; tool_calls?: unknown; tool_call_id?: string };

function readArgs(raw: string): Record<string, unknown> {
  try { const parsed = JSON.parse(raw); return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {}; }
  catch { return {}; }
}

function readRange(args: Record<string, unknown>) {
  const startDate = typeof args.startDate === "string" && datePattern.test(args.startDate) ? args.startDate : undefined;
  const endDate = typeof args.endDate === "string" && datePattern.test(args.endDate) ? args.endDate : undefined;
  if (startDate && endDate && startDate >= endDate) throw new Error("endDate must follow startDate");
  const limit = typeof args.limit === "number" && Number.isInteger(args.limit) ? Math.min(Math.max(args.limit, 1), 200) : 150;
  return { startDate, endDate, limit };
}

export const answer = internalAction({
  args: { profileId: v.id("profiles"), userId: v.id("users"), question: v.string() },
  handler: async (ctx, args): Promise<string> => {
    if (!(await ctx.runQuery(internal.telegramInternal.canReadBotProfile, {
      userId: args.userId, profileId: args.profileId,
    }))) throw new Error("Profile access denied");
    const runtimeAi = await ctx.runQuery(internal.aiSettings.resolveRuntimeAiKey, { userId: args.userId });
    if (!runtimeAi?.hasKey || !runtimeAi.apiKey) throw new Error("No AI key available for records agent");
    const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Bangkok", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
    const messages: Message[] = [
      { role: "system", content: `You are Ankan's records agent. Today in Asia/Bangkok is ${today}. Answer the user's question only from tools you call. Call the relevant read tools before answering; never claim to have seen unreturned data. Use get_meal_totals for meal nutrition sums and sum_selected_money for selected financial rows. For place or person questions, inspect notes and select rows by context, including transactions within a trip window whose notes omit the city. Keep currencies separate. If a tool result is truncated, narrow the date range or say the total is incomplete. A missing macro breakdown makes macro totals partial. Give a concise answer with the period and explicit units: exercise weight is kg, money needs its currency, meal totals need g or kcal.` },
      { role: "user", content: args.question.slice(0, 2000) },
    ];
    const seenMoney = new Map<string, Row>();
    let usedTool = false;
    for (let turn = 0; turn < 6; turn++) {
      let payload: any;
      let lastError: Error | undefined;
      for (const model of new Set([process.env.GOOGLE_AI_RECORDS_AGENT_MODEL || "gemini-3-flash-preview", "gemini-2.5-flash"])) {
        try {
          const response = await fetch(endpoint, {
            method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${runtimeAi.apiKey}` },
            body: JSON.stringify({ model, temperature: 0, max_tokens: 2000, messages, tools, tool_choice: "auto" }),
          });
          if (!response.ok) {
            lastError = new Error(`Records agent ${model} returned HTTP ${response.status}`);
            if (response.status === 429 || response.status >= 500) continue;
            throw lastError;
          }
          payload = await response.json();
          break;
        } catch (error) {
          lastError = error instanceof Error ? error : new Error("Records agent request failed");
          if (/returned HTTP (400|401|403|404)/.test(lastError.message)) throw lastError;
        }
      }
      if (!payload) throw lastError || new Error("Records agent unavailable");
      const reply = payload?.choices?.[0]?.message;
      if (!reply) throw new Error("Records agent returned no message");
      const calls = Array.isArray(reply.tool_calls) ? reply.tool_calls : [];
      if (!calls.length) {
        if (usedTool && typeof reply.content === "string" && reply.content.trim()) return reply.content.trim().slice(0, 1500);
        messages.push({ role: "assistant", content: typeof reply.content === "string" ? reply.content : "" });
        messages.push({ role: "user", content: "Use at least one read tool before answering. If no saved records support this, say so." });
        continue;
      }
      messages.push({ role: "assistant", content: reply.content || null, tool_calls: calls });
      for (const call of calls.slice(0, 4)) {
        const name = call?.function?.name;
        const params = readArgs(String(call?.function?.arguments || "{}"));
        let result: unknown;
        try {
          if (name === "get_expenses" || name === "get_income" || name === "get_health_entries") {
            const range = readRange(params);
            const query = name === "get_expenses" ? internal.telegramInternal.getExpenseConversationContext
              : name === "get_income" ? internal.telegramInternal.getIncomeConversationContext
              : internal.telegramInternal.getHealthConversationContext;
            const page = await ctx.runQuery(query as any, { profileId: args.profileId, ...range }) as { rows: Array<Row>; truncated: boolean };
            if (name !== "get_health_entries") for (const row of page.rows) seenMoney.set(row.id, row);
            result = page;
          } else if (name === "get_meal_totals") {
            const range = readRange(params);
            const page = await ctx.runQuery(internal.telegramInternal.getHealthConversationContext, { profileId: args.profileId, ...range, limit: 500 });
            result = { ...sumMealMacros(page.rows), truncated: page.truncated, startDate: range.startDate, endDate: range.endDate };
          } else if (name === "get_balances") {
            result = await ctx.runQuery(internal.telegramInternal.getBalanceConversationContext, { profileId: args.profileId });
          } else if (name === "sum_selected_money") {
            const ids = Array.isArray(params.ids) ? params.ids.filter((id): id is string => typeof id === "string").slice(0, 500) : [];
            const totals: Record<string, number> = {};
            let found = 0;
            for (const id of new Set(ids)) {
              const row = seenMoney.get(id);
              if (!row) continue;
              totals[row.currency] = Math.round(((totals[row.currency] || 0) + row.amount) * 100) / 100;
              found++;
            }
            result = { totals, selected: found, requested: ids.length };
          } else result = { error: "Unknown tool" };
        } catch (error) { result = { error: error instanceof Error ? error.message : "Tool failed" }; }
        usedTool = true;
        messages.push({ role: "tool", tool_call_id: String(call.id || ""), content: JSON.stringify(result) });
      }
    }
    throw new Error("Records agent exceeded its tool budget");
  },
});
