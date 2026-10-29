import test from "node:test";
import assert from "node:assert/strict";
import { tripOwnerName } from "../../convex/lib/tripIdentity.ts";

test("uses the real profile first name before account or Telegram names", () => {
  assert.equal(tripOwnerName("Bharat Kashyap", "Other Person", "Telegram"), "Bharat");
});

test("replaces the default Me profile with an actual first name", () => {
  assert.equal(tripOwnerName("Me", "Bharat Kashyap", "Telegram"), "Bharat");
  assert.equal(tripOwnerName("Me", undefined, "Bharat"), "Bharat");
  assert.equal(tripOwnerName("Me", undefined, undefined), null);
});
