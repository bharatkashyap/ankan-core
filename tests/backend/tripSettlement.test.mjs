import test from "node:test";
import assert from "node:assert/strict";
import { calculateTripSettlement } from "../../convex/lib/tripSettlement.ts";

test("equal splits produce a minimal transfer in converted INR", () => {
  const result = calculateTripSettlement([
    { amount: 1000, currency: "THB", rateToInr: 2.3, paidBy: "Bharat", splitWith: ["Bharat", "Kartik"] },
    { amount: 500, currency: "INR", rateToInr: 1, paidBy: "Kartik", splitWith: ["Bharat", "Kartik"] },
  ], false);
  assert.deepEqual(result.settlements, [{ currency: "INR", total: 2800, transfers: [{ from: "Kartik", to: "Bharat", amount: 900 }] }]);
});

test("separate currencies do not net unlike money", () => {
  const result = calculateTripSettlement([
    { amount: 100, currency: "THB", rateToInr: 2.3, paidBy: "Bharat", splitWith: ["Bharat", "Kartik"] },
    { amount: 100, currency: "INR", rateToInr: 1, paidBy: "Kartik", splitWith: ["Bharat", "Kartik"] },
  ], true);
  assert.deepEqual(result.settlements, [
    { currency: "INR", total: 100, transfers: [{ from: "Bharat", to: "Kartik", amount: 50 }] },
    { currency: "THB", total: 100, transfers: [{ from: "Kartik", to: "Bharat", amount: 50 }] },
  ]);
});

test("rounding preserves every cent across three participants", () => {
  const result = calculateTripSettlement([
    { amount: 10, currency: "INR", rateToInr: 1, paidBy: "Bharat", splitWith: ["Bharat", "Kartik", "Asha"] },
  ], true);
  assert.equal(result.settlements[0].transfers.reduce((sum, transfer) => sum + transfer.amount, 0), 6.67);
});

test("recorded payments reduce the remaining debt without changing trip spending", () => {
  const result = calculateTripSettlement(
    [{ amount: 1000, currency: "THB", rateToInr: 2.3, paidBy: "Bharat", splitWith: ["Bharat", "Kartik"] }],
    false,
    [{ from: "Kartik", to: "Bharat", amount: 200, currency: "THB", rateToInr: 2.3 }],
  );
  assert.deepEqual(result.settlements, [{ currency: "INR", total: 2300, transfers: [{ from: "Kartik", to: "Bharat", amount: 690 }] }]);
});

test("an INR payment settles THB debt without creating a zero-spend INR debt", () => {
  const entries = [{ amount: 1000, currency: "THB", rateToInr: 2.5, paidBy: "Bharat", splitWith: ["Bharat", "Shmi"] }];
  const payments = [{ id: "payment-1", from: "Shmi", to: "Bharat", amount: 500, currency: "INR", rateToInr: 1 }];
  const separate = calculateTripSettlement(entries, true, payments);
  assert.deepEqual(separate.settlements, [
    { currency: "THB", total: 1000, transfers: [{ from: "Shmi", to: "Bharat", amount: 300 }] },
  ]);
  assert.deepEqual(separate.unappliedPayments, []);
  assert.deepEqual(calculateTripSettlement(entries, false, payments).settlements, [
    { currency: "INR", total: 2500, transfers: [{ from: "Shmi", to: "Bharat", amount: 750 }] },
  ]);
});

test("a payment larger than the remaining debt is shown as unapplied, not reverse debt", () => {
  const result = calculateTripSettlement(
    [{ amount: 100, currency: "THB", rateToInr: 2.5, paidBy: "Bharat", splitWith: ["Bharat", "Shmi"] }],
    true,
    [{ id: "payment-2", from: "Shmi", to: "Bharat", amount: 200, currency: "INR", rateToInr: 1 }],
  );
  assert.deepEqual(result.settlements, [{ currency: "THB", total: 100, transfers: [] }]);
  assert.deepEqual(result.unappliedPayments, [{ id: "payment-2", from: "Shmi", to: "Bharat", amount: 75, currency: "INR" }]);
});

test("a payment clears matching-currency debt before another currency", () => {
  const result = calculateTripSettlement([
    { amount: 100, currency: "INR", rateToInr: 1, paidBy: "Bharat", splitWith: ["Bharat", "Shmi"] },
    { amount: 100, currency: "THB", rateToInr: 2.5, paidBy: "Bharat", splitWith: ["Bharat", "Shmi"] },
  ], true, [{ from: "Shmi", to: "Bharat", amount: 100, currency: "INR", rateToInr: 1 }]);
  assert.deepEqual(result.settlements, [
    { currency: "INR", total: 100, transfers: [] },
    { currency: "THB", total: 100, transfers: [{ from: "Shmi", to: "Bharat", amount: 30 }] },
  ]);
  assert.deepEqual(result.unappliedPayments, []);
});

test("one person's cross-currency payment does not alter another person's debt", () => {
  const result = calculateTripSettlement([
    { amount: 1000, currency: "THB", rateToInr: 2.5, paidBy: "Bharat", splitWith: ["Bharat", "Kartik"] },
    { amount: 200, currency: "THB", rateToInr: 2.5, paidBy: "Bharat", splitWith: ["Bharat", "Shmi"] },
  ], true, [{ from: "Shmi", to: "Bharat", amount: 250, currency: "INR", rateToInr: 1 }]);
  assert.deepEqual(result.settlements, [{
    currency: "THB", total: 1200, transfers: [{ from: "Kartik", to: "Bharat", amount: 500 }],
  }]);
});
