import test from "node:test";
import assert from "node:assert/strict";
import {
  encryptNumber, decryptNumberWithFallback, encryptSalaryDetails,
  decryptSalaryDetailsWithFallback, encryptSecretString,
} from "../../convex/lib/fieldEncryption.ts";

test("self-hosted records work without an application encryption key", async () => {
  const previous = process.env.DATA_ENCRYPTION_MASTER_KEY;
  delete process.env.DATA_ENCRYPTION_MASTER_KEY;
  try {
    const amount = await encryptNumber(125.5);
    assert.equal(amount, "125.5");
    assert.equal(await decryptNumberWithFallback(amount, undefined, "amount"), 125.5);
    const details = await encryptSalaryDetails({ baseAmount: 100, taxWithheldAmount: 25 });
    assert.deepEqual(await decryptSalaryDetailsWithFallback(details, undefined), { baseAmount: 100, taxWithheldAmount: 25 });
    assert.equal(await encryptSecretString("  local-key  "), "local-key");
  } finally {
    if (previous === undefined) delete process.env.DATA_ENCRYPTION_MASTER_KEY;
    else process.env.DATA_ENCRYPTION_MASTER_KEY = previous;
  }
});
