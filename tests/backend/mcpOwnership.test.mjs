import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { requireMcpProfileOwner, requireMcpEndpointOwner } from "../../convex/lib/mcpOwnership.ts";

test("MCP profile access is bound to the token's account, even for family members", () => {
  const accountA = { id: "user_A", profile: { userId: "user_A" } };
  const accountB = { id: "user_B", profile: { userId: "user_B" } };
  assert.doesNotThrow(() => requireMcpProfileOwner(accountA.id, accountA.profile));
  assert.doesNotThrow(() => requireMcpProfileOwner(accountB.id, accountB.profile));
  assert.throws(() => requireMcpProfileOwner(accountA.id, accountB.profile), /not owned/);
  assert.throws(() => requireMcpProfileOwner(accountB.id, accountA.profile), /not owned/);
  const query = readFileSync(new URL("../../convex/mcpExpenses.ts", import.meta.url), "utf8");
  assert.match(query, /requireMcpProfileOwner\(userId, profile\)/);
});

test("OAuth approval cannot bind one account to another account's personal URL", () => {
  const endpointA = { userId: "user_A", slug: "a".repeat(43) };
  const resource = `https://mcp.ankan.app/u/${endpointA.slug}`;
  assert.doesNotThrow(() => requireMcpEndpointOwner("user_A", endpointA, resource, "https://mcp.ankan.app"));
  assert.throws(() => requireMcpEndpointOwner("user_B", endpointA, resource, "https://mcp.ankan.app"));
  assert.throws(() => requireMcpEndpointOwner("user_A", endpointA, `${resource}/extra`, "https://mcp.ankan.app"));
});
