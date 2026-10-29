import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

test("Telegram reserves one quota slot before any AI work", () => {
  const source = readFileSync(new URL("../../convex/telegramBot.ts", import.meta.url), "utf8");
  const handleMessage = source.slice(source.indexOf("export const handleMessage"));
  const mediaPreflight = handleMessage.indexOf("await getMessageMedia(");
  const reserve = handleMessage.indexOf("aiSettings.consumeDailyQuota");
  const denied = handleMessage.indexOf("if (!quota.allowed)");
  const firstRouterCall = handleMessage.indexOf("await decideMessage(");
  const firstModelAction = handleMessage.indexOf("recordsAgent.answer");

  assert.ok(mediaPreflight >= 0 && reserve > mediaPreflight && denied > reserve);
  assert.ok(firstRouterCall > denied);
  assert.ok(firstModelAction > denied);
  assert.equal(handleMessage.match(/aiSettings\.consumeDailyQuota/g)?.length, 1);
  assert.match(handleMessage.slice(0, reserve), /if \(media\?\.aborted\) return/);
});
