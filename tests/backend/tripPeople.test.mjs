import test from "node:test";
import assert from "node:assert/strict";
import { renameTripPerson } from "../../convex/lib/tripPeople.ts";
import { calculateTripSettlement } from "../../convex/lib/tripSettlement.ts";

test("renaming an alias merges it with an existing participant", () => {
  const { replace, names } = renameTripPerson("barcash", "Bharat");
  assert.deepEqual(names(["Bharat", "barcash", "Kartik"]), ["Bharat", "Kartik"]);
  assert.equal(replace("barcash"), "Bharat");
  assert.deepEqual(names(["barcash", "Kartik", "Bharat"]), ["Bharat", "Kartik"]);
  const entry = { amount: 600, currency: "INR", rateToInr: 1,
    paidBy: replace("barcash"), splitWith: names(["Bharat", "barcash", "Kartik"]) };
  assert.deepEqual(calculateTripSettlement([entry], false).settlements[0].transfers,
    [{ from: "Kartik", to: "Bharat", amount: 300 }]);
});
