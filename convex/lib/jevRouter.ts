import type { MessageDecision } from "./messageDecision.js";

export type ReadPeriod = "today" | "yesterday" | "this_week" | "last_week" | "this_month" | "last_month";
export type FocusedMutation = "expense" | "meal" | "workout";
export type JevDecision = { decision: MessageDecision; readPeriod?: ReadPeriod; focusedMutation?: FocusedMutation };

export const JEV_MODEL = "jev-1.13.0";
export const JEV_TIMEOUT_MS = 1800;

export function jevRequest(text: string) {
  return {
    model: JEV_MODEL,
    state: text.slice(0, 2000),
    questions: {
      route: {
        type: "choice",
        instructions: "Choose the next action for the Ankan personal records assistant.",
        criteria: {
          mutation: "Log, add, update, correct, or delete a personal record. Terse statements with an amount and a purchase, merchant, transport, or item count as an expense to log, even without a verb; for example 1694inr on codex. Also includes meals and workouts just completed, and nutrition for a named food to remember for future portions.",
          records: "Ask to read, total, summarize, compare, or answer a question about saved personal records, balances, meals, health, or spending.",
          trip_report: "Request creation of a shareable trip expense report.",
          trip_payment: "Record that a trip participant settled a debt or transferred money to another participant for the trip.",
          reject: "Unrelated to personal records.",
        },
      },
      read_kind: {
        type: "choice",
        instructions: "If this message asks about existing logged records, which read operation can answer it exactly? Choose complex for any context, filtering, or interpretation beyond a simple time period.",
        criteria: {
          meal_totals: "Read a total of logged meal protein, carbs, fat, or calories for a simple time period, with no other filters.",
          complex: "All other requests, including new meal logs, place or person analysis, and exercise records.",
        },
      },
      time_scope: {
        type: "choice",
        instructions: "Which explicit time period does the requested read cover?",
        criteria: { today: "Today only.", yesterday: "Yesterday only.", this_week: "Current calendar week.", last_week: "Previous calendar week.", this_month: "Current calendar month.", last_month: "Previous calendar month.", other: "No explicit period or a different period." },
      },
      mutation_kind: {
        type: "choice",
        instructions: "If this message changes a saved record, choose its domain. Treat terse amounts spent on a merchant or item as expenses. Choose other for mixed or uncertain messages.",
        criteria: { expense: "A completed purchase or expense, or editing or deleting one.", meal: "Logging food eaten or saving a named food's calories or nutrition for future portions.", workout: "Logging a workout or exercise.", other: "Income, balances, accounts, tax, mixed actions, or no mutation." },
      },
    },
  };
}

export function interpretJevResponse(payload: any): JevDecision | null {
  const answer = payload?.answers?.route;
  const confidence = answer?.confidence;
  if (typeof confidence !== "number" || !Number.isFinite(confidence)) return null;
  const read = payload?.answers?.read_kind;
  const scope = payload?.answers?.time_scope;
  const period = ["today", "yesterday", "this_week", "last_week", "this_month", "last_month"].includes(scope?.choice) && scope?.confidence >= 0.9 ? scope.choice as ReadPeriod : undefined;
  if (read?.choice === "meal_totals" && read?.confidence >= 0.9 && period && answer.choice !== "reject") {
    return { decision: { target: "subagent", subagent: "records" }, readPeriod: period };
  }
  if (answer.choice === "mutation" && confidence >= 0.8) {
    const kind = payload?.answers?.mutation_kind;
    const focusedMutation = ["expense", "meal", "workout"].includes(kind?.choice) && kind?.confidence >= 0.92 ? kind.choice as FocusedMutation : undefined;
    return { decision: { target: "mutation", mutation: "parse_and_apply" }, focusedMutation };
  }
  if (answer.choice === "records" && confidence >= 0.85) return { decision: { target: "subagent", subagent: "records" } };
  if (answer.choice === "reject" && confidence >= 0.95) return { decision: { target: "reject" } };
  return null;
}

export async function decideWithJev(text: string, apiKey: string, fetcher: typeof fetch = fetch): Promise<JevDecision | null> {
  const response = await fetcher("https://api.typesafe.ai/v1/systemone", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
    signal: AbortSignal.timeout(JEV_TIMEOUT_MS),
    body: JSON.stringify(jevRequest(text)),
  });
  if (!response.ok) throw new Error(`Jev router returned HTTP ${response.status}`);
  return interpretJevResponse(await response.json());
}
