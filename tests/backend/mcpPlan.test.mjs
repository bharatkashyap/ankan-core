import test from "node:test";
import assert from "node:assert/strict";
import { mcpDailyLimit } from "../../convex/lib/mcpPlan.ts";

const day = 24 * 60 * 60_000;
test("MCP call limits follow Free, trial, and paid entitlement", () => {
  assert.deepEqual(mcpDailyLimit(0, false, 16 * day), { plan: "Free", limit: 100 });
  assert.deepEqual(mcpDailyLimit(0, false, 14 * day), { plan: "Pro", limit: 1000 });
  assert.deepEqual(mcpDailyLimit(0, true, 100 * day), { plan: "Pro", limit: 1000 });
});
