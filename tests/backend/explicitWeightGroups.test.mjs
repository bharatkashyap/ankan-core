import assert from "node:assert/strict";
import test from "node:test";
import { explicitWeightGroups } from "../../convex/lib/explicitWeightGroups.ts";

test("keeps separate weights for explicit set groups", () => {
  assert.deepEqual(
    explicitWeightGroups("Bench Press: one set at 30 kg and two at 40 kg", "Bench Press", ["Bench Press"]),
    [{ sets: 1, weight: 30 }, { sets: 2, weight: 40 }],
  );
  assert.deepEqual(
    explicitWeightGroups("Bench Press: one set at 30 kg and two at 40", "Bench Press", ["Bench Press"]),
    [{ sets: 1, weight: 30 }, { sets: 2, weight: 40 }],
  );
  assert.deepEqual(
    explicitWeightGroups("Bench Press 1 set at 30 and 1 set at 40", "Bench Press", ["Bench Press"]),
    [{ sets: 1, weight: 30 }, { sets: 1, weight: 40 }],
  );
  assert.deepEqual(
    explicitWeightGroups("1 set at 30 and 1 set at 40", "Workout", ["Workout"]),
    [{ sets: 1, weight: 30 }, { sets: 1, weight: 40 }],
  );
});

test("does not take weight groups from a different exercise", () => {
  const message = "Squat one set at 60 kg and two at 70 kg. Bench Press one set at 30 kg and two at 40 kg";
  assert.deepEqual(
    explicitWeightGroups(message, "Squat", ["Squat", "Bench Press"]),
    [{ sets: 1, weight: 60 }, { sets: 2, weight: 70 }],
  );
  assert.deepEqual(
    explicitWeightGroups(message, "Bench Press", ["Squat", "Bench Press"]),
    [{ sets: 1, weight: 30 }, { sets: 2, weight: 40 }],
  );
});

test("leaves ordinary single-weight messages to existing parsing", () => {
  assert.equal(explicitWeightGroups("Bench Press 3 sets at 40 kg", "Bench Press", ["Bench Press"]), undefined);
});
