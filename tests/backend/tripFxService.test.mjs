import test from "node:test";
import assert from "node:assert/strict";
import { getTripToInrRate } from "../../convex/lib/tripFxService.ts";

test("trip rates use the latest published market reference date", async () => {
  const previousFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url) => {
    calls.push(String(url));
    return { ok: true, json: async () => ({ date: "2026-10-20", base: "THB", quote: "INR", rate: 2.8237 }) };
  };
  try {
    assert.deepEqual(await getTripToInrRate("THB", "2026-10-21"), { rate: 2.8237, date: "2026-10-20" });
    assert.equal(calls[0], "https://api.frankfurter.dev/v2/rate/thb/inr?date=2026-10-21");
    assert.deepEqual(await getTripToInrRate("INR", "2026-10-21"), { rate: 1, date: "2026-10-21" });
    assert.equal(calls.length, 1);
  } finally {
    globalThis.fetch = previousFetch;
  }
});

test("trip rates reject missing or stale data instead of using a hard-coded conversion", async () => {
  const previousFetch = globalThis.fetch;
  try {
    globalThis.fetch = async () => ({ ok: false, status: 404 });
    await assert.rejects(getTripToInrRate("USD", "2026-10-19"), /unavailable/);
    globalThis.fetch = async () => ({ ok: true, json: async () => ({ date: "2026-09-01", base: "THB", quote: "INR", rate: 2.8 }) });
    await assert.rejects(getTripToInrRate("THB", "2026-10-18"), /too old/);
  } finally {
    globalThis.fetch = previousFetch;
  }
});
