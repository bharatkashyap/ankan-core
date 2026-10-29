import test from "node:test";
import assert from "node:assert/strict";
import { entriesInHealthDay, entriesInWorkoutSession } from "../../convex/lib/healthSessions.ts";

test("changing a workout date selects every exercise in its session across dates", () => {
  const entry = { id: "squat", kind: "exercise", profileId: "mine", sessionId: "session-a", date: "2026-10-24" };
  const otherExercise = { id: "press", kind: "exercise", profileId: "mine", sessionId: "session-a", date: "2026-10-23" };
  const anotherWorkout = { id: "run", kind: "exercise", profileId: "mine", sessionId: "session-b", date: "2026-10-24" };
  const anotherProfile = { id: "private", kind: "exercise", profileId: "theirs", sessionId: "session-a", date: "2026-10-24" };
  assert.deepEqual(entriesInWorkoutSession(entry, [entry, otherExercise, anotherWorkout, anotherProfile]).map((item) => item.id), ["squat", "press"]);
});

test("a manual exercise without a session ID moves alone", () => {
  const entry = { id: "manual", kind: "exercise", profileId: "mine", date: "2026-10-24" };
  assert.deepEqual(entriesInWorkoutSession(entry, [entry]), [entry]);
});

test("moving a workout day keeps every session intact and excludes meals and other profiles", () => {
  const rows = [
    { id: "squat", kind: "exercise", profileId: "mine", sessionId: "a", date: "2026-10-24" },
    { id: "press", kind: "exercise", profileId: "mine", sessionId: "a", date: "2026-10-23" },
    { id: "curl", kind: "exercise", profileId: "mine", sessionId: "b", date: "2026-10-24" },
    { id: "run", kind: "exercise", profileId: "mine", date: "2026-10-24" },
    { id: "other-day", kind: "exercise", profileId: "mine", sessionId: "c", date: "2026-10-22" },
    { id: "meal", kind: "meal", profileId: "mine", date: "2026-10-24" },
    { id: "private", kind: "exercise", profileId: "theirs", sessionId: "a", date: "2026-10-24" },
  ];
  const dayEntries = rows.filter((row) => row.profileId === "mine" && row.date === "2026-10-24");
  assert.deepEqual(entriesInHealthDay(dayEntries, rows, "mine", "exercise", "2026-10-24").map((row) => row.id), ["squat", "press", "curl", "run"]);
});

test("moving a meal day affects its meals only", () => {
  const rows = [
    { id: "breakfast", kind: "meal", profileId: "mine", date: "2026-10-24" },
    { id: "lunch", kind: "meal", profileId: "mine", date: "2026-10-24" },
    { id: "dinner", kind: "meal", profileId: "mine", date: "2026-10-23" },
    { id: "workout", kind: "exercise", profileId: "mine", date: "2026-10-24" },
  ];
  assert.deepEqual(entriesInHealthDay(rows.slice(0, 2), rows, "mine", "meal", "2026-10-24").map((row) => row.id), ["breakfast", "lunch"]);
});
