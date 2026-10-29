import test from "node:test";
import assert from "node:assert/strict";
import { decideWithJev, interpretJevResponse, jevRequest, JEV_MODEL, JEV_TIMEOUT_MS } from "../../convex/lib/jevRouter.ts";

const answer = (choice, confidence = 0.99, extras = {}) => ({ answers: { route: { choice, confidence }, ...extras } });

test("Jev request covers all Ankan routes and uses a bounded message", () => {
  const request = jevRequest("x".repeat(3000));
  assert.equal(request.model, JEV_MODEL);
  assert.equal(request.state.length, 2000);
  assert.deepEqual(Object.keys(request.questions.route.criteria), ["mutation", "records", "trip_report", "trip_payment", "reject"]);
});

test("Jev decisions preserve mutation, records, and fallback boundaries", () => {
  assert.deepEqual(interpretJevResponse(answer("mutation", 0.99, { mutation_kind: { choice: "expense", confidence: 0.99 } })), {
    decision: { target: "mutation", mutation: "parse_and_apply" }, focusedMutation: "expense",
  });
  assert.deepEqual(interpretJevResponse(answer("records")), { decision: { target: "subagent", subagent: "records" } });
  assert.deepEqual(interpretJevResponse(answer("mutation", 0.94, {
    read_kind: { choice: "meal_totals", confidence: 0.99 }, time_scope: { choice: "today", confidence: 0.99 },
  })), { decision: { target: "subagent", subagent: "records" }, readPeriod: "today" });
  for (const route of ["trip_report", "trip_payment"]) assert.equal(interpretJevResponse(answer(route)), null);
  assert.equal(interpretJevResponse(answer("mutation", 0.5)), null);
  assert.equal(interpretJevResponse(answer("reject", 0.96))?.decision.target, "reject");
});

test("fast path makes one bounded Jev request without Gemini verification", async () => {
  let calls = 0;
  const started = performance.now();
  const result = await decideWithJev("1694inr on codex", "test-key", async (url, options) => {
    calls++;
    assert.equal(url, "https://api.typesafe.ai/v1/systemone");
    assert.equal(options.signal.reason, undefined);
    assert.equal(JSON.parse(options.body).model, JEV_MODEL);
    return { ok: true, json: async () => answer("mutation", 0.99) };
  });
  assert.equal(calls, 1);
  assert.equal(result.decision.mutation, "parse_and_apply");
  assert.ok(performance.now() - started < 200, "mocked fast path should add negligible local latency");
  assert.equal(JEV_TIMEOUT_MS, 1800);
});
