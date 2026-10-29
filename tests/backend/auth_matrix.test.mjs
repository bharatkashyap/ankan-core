import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const ROOT = process.cwd();

function extractBalancedBlock(content, openBraceIndex) {
  let depth = 0;
  for (let i = openBraceIndex; i < content.length; i += 1) {
    const ch = content[i];
    if (ch === "{") depth += 1;
    if (ch === "}") depth -= 1;
    if (depth === 0) {
      return content.slice(openBraceIndex, i + 1);
    }
  }
  return null;
}

function functionBlock(filePath, fnName) {
  const fullPath = resolve(ROOT, filePath);
  const content = readFileSync(fullPath, "utf8");
  const fnRegex = new RegExp(
    `export const ${fnName}\\s*=\\s*(query|mutation|action)\\s*\\(\\s*\\{`,
    "m",
  );
  const match = fnRegex.exec(content);
  assert.ok(match, `Function ${fnName} not found in ${filePath}`);
  const openBraceAt = content.indexOf("{", match.index);
  assert.ok(openBraceAt >= 0, `No opening brace found for ${filePath}.${fnName}`);
  const block = extractBalancedBlock(content, openBraceAt);
  assert.ok(block, `Could not parse function block for ${filePath}.${fnName}`);
  return block;
}

test("admin public surface is removed", () => {
  assert.equal(
    existsSync(resolve(ROOT, "convex/admin.ts")),
    false,
    "convex/admin.ts should not exist",
  );
  const apiDts = readFileSync(resolve(ROOT, "convex/_generated/api.d.ts"), "utf8");
  assert.doesNotMatch(apiDts, /\badmin:\s/);
});

test("protected finance/profile functions require auth markers", () => {
  const protectedFns = [
    ["convex/accounts.ts", "listByProfile", "requireProfileAccess("],
    ["convex/accounts.ts", "create", "requireProfileAccess("],
    ["convex/expenses.ts", "add", "requireProfileAccess("],
    ["convex/expenses.ts", "update", "requireExpenseEntryAccess("],
    ["convex/income.ts", "add", "requireProfileAccess("],
    ["convex/income.ts", "update", "requireIncomeEntryAccess("],
    ["convex/health.ts", "listMealReferences", "requireProfileAccess("],
    ["convex/health.ts", "updateWorkoutSessionDate", "requireProfileAccess("],
    ["convex/health.ts", "updateDayDate", "requireProfileAccess("],
    ["convex/tax.ts", "getTaxStatusByFiscalYear", "requireProfileAccess("],
    ["convex/tax.ts", "setTaxPaidForFiscalYear", "requireProfileAccess("],
    ["convex/aiSettings.ts", "setMode", "requireAuth("],
    ["convex/aiSettings.ts", "setByokKey", "requireAuth("],
    ["convex/expenses.ts", "listCategories", "requireAuth("],
    ["convex/expenses.ts", "listCategoriesGrouped", "requireAuth("],
    ["convex/income.ts", "listCategories", "requireAuth("],
    ["convex/income.ts", "listCategoriesGrouped", "requireAuth("],
    ["convex/tax.ts", "calculateIndiaTax", "requireAuth("],
    ["convex/tax.ts", "calculateUSTax", "requireAuth("],
    ["convex/tax.ts", "calculateThailandTax", "requireAuth("],
  ];

  for (const [filePath, fnName, marker] of protectedFns) {
    const block = functionBlock(filePath, fnName);
    assert.match(
      block,
      new RegExp(marker.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")),
      `${filePath}.${fnName} must include ${marker}`,
    );
  }
});

test("cross-profile guard logic remains present in auth helper", () => {
  const authFile = readFileSync(resolve(ROOT, "convex/lib/auth.ts"), "utf8");
  assert.match(authFile, /if \(profile\.userId === userId\)/);
  assert.match(authFile, /query\("familyMembers"\)/);
  assert.match(authFile, /m\.role === "owner"/);
  assert.match(authFile, /Access denied: You don't own this profile/);
});

test("telegram webhook secret check is fail-closed", () => {
  const telegramFile = readFileSync(resolve(ROOT, "convex/telegram.ts"), "utf8");
  assert.match(telegramFile, /if \(!expectedSecret\)/);
  assert.match(telegramFile, /return new Response\("Unauthorized", \{ status: 401 \}\)/);
});

test("telegram webhook does not log raw update payloads", () => {
  const telegramFile = readFileSync(resolve(ROOT, "convex/telegram.ts"), "utf8");
  assert.doesNotMatch(telegramFile, /JSON\.stringify\(update/);
  assert.doesNotMatch(telegramFile, /Received update:",/);
  assert.doesNotMatch(
    telegramFile,
    /console\.(log|info|warn|error)\([^;]*(message\.text|message\.caption|text,|caption,)/s,
  );
});

test("telegram bot error logs do not include parsed financial payloads", () => {
  const telegramBotFile = readFileSync(resolve(ROOT, "convex/telegramBot.ts"), "utf8");
  assert.doesNotMatch(telegramBotFile, /Failed to process action:",\s*parsed/);
});
