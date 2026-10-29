import test from "node:test";
import assert from "node:assert/strict";
import { sumMealMacros } from "../../convex/lib/healthMacroTotals.ts";

test("macro totals use only meals and flag missing breakdowns", () => {
  assert.deepEqual(sumMealMacros([
    { kind: "meal", calories: 600, proteinGrams: 25, carbsGrams: 80, fatGrams: 18 },
    { kind: "meal", calories: 300 },
    { kind: "exercise", calories: 200 },
  ]), {
    meals: 2,
    calories: { amount: 900, recorded: 2 },
    protein: { amount: 25, recorded: 1 },
    carbs: { amount: 80, recorded: 1 },
    fat: { amount: 18, recorded: 1 },
    incompleteMacros: 1,
  });
});
