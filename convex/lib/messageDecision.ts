export type MessageDecision =
  | { target: "mutation"; mutation: "parse_and_apply" }
  | { target: "mutation"; mutation: "create_trip_report"; place: string }
  | { target: "mutation"; mutation: "record_trip_payment"; trip: string; from: string; to: string; amount: number; currency: "INR" | "USD" | "THB" }
  | { target: "subagent"; subagent: "records" }
  | { target: "reject" };

export function normalizeMessageDecision(raw: unknown): MessageDecision {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error("Invalid decision");
  const value = raw as Record<string, unknown>;
  if (value.target === "subagent" && value.subagent === "records") return { target: "subagent", subagent: "records" };
  if (value.target === "reject") return { target: "reject" };
  if (value.target !== "mutation") throw new Error("Unknown decision target");
  if (value.mutation === "parse_and_apply") return { target: "mutation", mutation: "parse_and_apply" };
  const clean = (item: unknown) => typeof item === "string" ? item.trim().slice(0, 100) : "";
  if (value.mutation === "create_trip_report" && clean(value.place)) return { target: "mutation", mutation: "create_trip_report", place: clean(value.place) };
  if (value.mutation === "record_trip_payment" && clean(value.trip) && clean(value.from) && clean(value.to)
    && typeof value.amount === "number" && Number.isFinite(value.amount) && value.amount > 0
    && (value.currency === "INR" || value.currency === "USD" || value.currency === "THB")) {
    return { target: "mutation", mutation: "record_trip_payment", trip: clean(value.trip), from: clean(value.from), to: clean(value.to), amount: value.amount, currency: value.currency };
  }
  throw new Error("Incomplete mutation decision");
}
