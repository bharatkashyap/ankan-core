import test from "node:test";
import assert from "node:assert/strict";
import { tripDateWindow, candidatesInWindow } from "../../convex/lib/tripInference.ts";

test("trip window includes contextual food and transport notes around place anchors", () => {
  const rows = [
    { date: "2026-09-05", note: "Chiang Mai hostel" },
    { date: "2026-09-06", note: "Grab from hostel" },
    { date: "2026-09-07", note: "Tiramisu paid by Kartik" },
    { date: "2026-09-09", note: "Chiang Mai market" },
    { date: "2026-10-20", note: "Bangkok lunch" },
  ];
  const window = tripDateWindow("Chiang Mai", rows);
  assert.deepEqual(candidatesInWindow(rows, window).map((row) => row.note), rows.slice(0, 4).map((row) => row.note));
  assert.equal(window.startDate, "2026-09-01");
  assert.equal(window.endDate, "2026-09-14");
});

test("separate visits choose the densest recent trip cluster", () => {
  const rows = [
    { date: "2026-01-02", note: "Chiang Mai hotel" },
    { date: "2026-09-05", note: "Chiang Mai hotel" },
    { date: "2026-09-07", note: "Chiang Mai cafe" },
  ];
  const window = tripDateWindow("Chiang Mai", rows);
  assert.deepEqual(window.anchorDates, ["2026-09-05", "2026-09-07"]);
});
