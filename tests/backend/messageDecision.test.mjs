import test from "node:test";
import assert from "node:assert/strict";
import { normalizeMessageDecision } from "../../convex/lib/messageDecision.ts";

test("dispatcher accepts only named mutations and subagents", () => {
  assert.deepEqual(normalizeMessageDecision({ target: "mutation", mutation: "parse_and_apply" }), { target: "mutation", mutation: "parse_and_apply" });
  assert.deepEqual(normalizeMessageDecision({ target: "subagent", subagent: "records" }), { target: "subagent", subagent: "records" });
  assert.throws(() => normalizeMessageDecision({ target: "subagent", subagent: "arbitrary" }));
  assert.throws(() => normalizeMessageDecision({ target: "mutation", mutation: "add_expense" }));
});
