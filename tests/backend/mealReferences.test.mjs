import test from "node:test";
import assert from "node:assert/strict";
import { mealReferencePrompt, scaleMealReference } from "../../convex/lib/mealReferences.ts";

const burrito = {
  id: "meal-1",
  name: "Sarnies Cantina's breakfast burrito with queso panela and no eggs",
  calories: 750,
  proteinGrams: 25,
  carbsGrams: 90,
  fatGrams: 32,
  nutritionEstimated: true,
};

test("saved meal portions scale calories and all available macros", () => {
  assert.deepEqual(scaleMealReference(burrito, 0.5), {
    calories: 375,
    proteinGrams: 12.5,
    carbsGrams: 45,
    fatGrams: 16,
    nutritionEstimated: true,
  });
  assert.equal(scaleMealReference(burrito, 0), null);
  assert.equal(scaleMealReference(burrito, Number.POSITIVE_INFINITY), null);
});

test("meal prompt gives parser the exact reference ID and variant", () => {
  const prompt = mealReferencePrompt([burrito]);
  assert.match(prompt, /meal-1/);
  assert.match(prompt, /no eggs/);
});
