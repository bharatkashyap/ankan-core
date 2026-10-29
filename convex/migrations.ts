import { internalMutation } from "./_generated/server";
import { v } from "convex/values";
import {
  encryptNumber,
  encryptOptionalNumber,
  encryptOptionalString,
  encryptSalaryDetails,
} from "./lib/fieldEncryption";

export const backfillEncryptedFinancialFields = internalMutation({
  args: {
    limitPerTable: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const limit = Math.max(1, Math.min(5000, args.limitPerTable || 1000));
    let scanned = 0;
    let patched = 0;

    const balances = await ctx.db.query("balanceHistory").collect();
    let patchedBalances = 0;
    for (const row of balances) {
      if (patchedBalances >= limit) break;
      scanned += 1;
      if (row.amountEnc || row.amount === undefined || !Number.isFinite(row.amount)) {
        continue;
      }
      await ctx.db.patch(row._id, {
        amountEnc: await encryptNumber(row.amount),
      });
      patched += 1;
      patchedBalances += 1;
    }

    const expenses = await ctx.db.query("expenseEntries").collect();
    let patchedExpenses = 0;
    for (const row of expenses) {
      if (patchedExpenses >= limit) break;
      scanned += 1;
      if (row.amountEnc || row.amount === undefined || !Number.isFinite(row.amount)) {
        continue;
      }
      await ctx.db.patch(row._id, {
        amountEnc: await encryptNumber(row.amount),
      });
      patched += 1;
      patchedExpenses += 1;
    }

    const incomes = await ctx.db.query("incomeEntries").collect();
    let patchedIncomes = 0;
    for (const row of incomes) {
      if (patchedIncomes >= limit) break;
      scanned += 1;
      const patch: Record<string, unknown> = {};
      if (
        !row.amountEnc &&
        row.amount !== undefined &&
        Number.isFinite(row.amount)
      ) {
        patch.amountEnc = await encryptNumber(row.amount);
      }
      if (
        !row.netReceivedAmountEnc &&
        row.netReceivedAmount !== undefined &&
        Number.isFinite(row.netReceivedAmount)
      ) {
        patch.netReceivedAmountEnc = await encryptOptionalNumber(row.netReceivedAmount);
      }
      if (!row.salaryDetailsEnc && row.salaryDetails) {
        patch.salaryDetailsEnc = await encryptSalaryDetails(row.salaryDetails);
      }
      if (Object.keys(patch).length > 0) {
        await ctx.db.patch(row._id, patch);
        patched += 1;
        patchedIncomes += 1;
      }
    }

    const taxPayments = await ctx.db.query("taxPayments").collect();
    let patchedTaxPayments = 0;
    for (const row of taxPayments) {
      if (patchedTaxPayments >= limit) break;
      scanned += 1;
      if (row.amountEnc || row.amount === undefined || !Number.isFinite(row.amount)) {
        continue;
      }
      await ctx.db.patch(row._id, {
        amountEnc: await encryptNumber(row.amount),
      });
      patched += 1;
      patchedTaxPayments += 1;
    }

    return {
      scanned,
      patched,
      limitPerTable: limit,
    };
  },
});

export const clearPlaintextFinancialAmounts = internalMutation({
  args: {
    limitPerTable: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const limit = Math.max(1, Math.min(5000, args.limitPerTable || 1000));
    let patched = 0;

    const balances = await ctx.db.query("balanceHistory").collect();
    let patchedBalances = 0;
    for (const row of balances) {
      if (patchedBalances >= limit) break;
      if (!row.amountEnc || row.amount === undefined) continue;
      await ctx.db.patch(row._id, { amount: undefined });
      patched += 1;
      patchedBalances += 1;
    }

    const expenses = await ctx.db.query("expenseEntries").collect();
    let patchedExpenses = 0;
    for (const row of expenses) {
      if (patchedExpenses >= limit) break;
      if (!row.amountEnc || row.amount === undefined) continue;
      await ctx.db.patch(row._id, { amount: undefined });
      patched += 1;
      patchedExpenses += 1;
    }

    const incomes = await ctx.db.query("incomeEntries").collect();
    let patchedIncomes = 0;
    for (const row of incomes) {
      if (patchedIncomes >= limit) break;
      const patch: Record<string, unknown> = {};
      if (row.amountEnc && row.amount !== undefined) patch.amount = undefined;
      if (row.netReceivedAmountEnc && row.netReceivedAmount !== undefined) {
        patch.netReceivedAmount = undefined;
      }
      if (row.salaryDetailsEnc && row.salaryDetails !== undefined) {
        patch.salaryDetails = undefined;
      }
      if (Object.keys(patch).length > 0) {
        await ctx.db.patch(row._id, patch);
        patched += 1;
        patchedIncomes += 1;
      }
    }

    const taxPayments = await ctx.db.query("taxPayments").collect();
    let patchedTaxPayments = 0;
    for (const row of taxPayments) {
      if (patchedTaxPayments >= limit) break;
      if (!row.amountEnc || row.amount === undefined) continue;
      await ctx.db.patch(row._id, { amount: undefined });
      patched += 1;
      patchedTaxPayments += 1;
    }

    return { patched, limitPerTable: limit };
  },
});

export const backfillEncryptedNotes = internalMutation({
  args: {
    limitPerTable: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const limit = Math.max(1, Math.min(5000, args.limitPerTable || 1000));
    let scanned = 0;
    let patched = 0;

    const patchTableNotes = async (
      tableName:
        | "balanceHistory"
        | "expenseEntries"
        | "incomeEntries"
        | "taxPayments"
        | "taxResidency",
    ) => {
      const rows = await ctx.db.query(tableName).collect();
      let patchedTable = 0;
      for (const row of rows) {
        if (patchedTable >= limit) break;
        scanned += 1;
        if (row.noteEnc || row.note === undefined) continue;
        const noteEnc = await encryptOptionalString(row.note);
        const patch: Record<string, unknown> = { note: undefined };
        if (noteEnc) patch.noteEnc = noteEnc;
        await ctx.db.patch(row._id, patch);
        patched += 1;
        patchedTable += 1;
      }
    };

    await patchTableNotes("balanceHistory");
    await patchTableNotes("expenseEntries");
    await patchTableNotes("incomeEntries");
    await patchTableNotes("taxPayments");
    await patchTableNotes("taxResidency");

    return { scanned, patched, limitPerTable: limit };
  },
});

export const clearPlaintextNotes = internalMutation({
  args: {
    limitPerTable: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const limit = Math.max(1, Math.min(5000, args.limitPerTable || 1000));
    let patched = 0;

    const patchTableNotes = async (
      tableName:
        | "balanceHistory"
        | "expenseEntries"
        | "incomeEntries"
        | "taxPayments"
        | "taxResidency",
    ) => {
      const rows = await ctx.db.query(tableName).collect();
      let patchedTable = 0;
      for (const row of rows) {
        if (patchedTable >= limit) break;
        if (row.note === undefined || !row.noteEnc) continue;
        await ctx.db.patch(row._id, { note: undefined });
        patched += 1;
        patchedTable += 1;
      }
    };

    await patchTableNotes("balanceHistory");
    await patchTableNotes("expenseEntries");
    await patchTableNotes("incomeEntries");
    await patchTableNotes("taxPayments");
    await patchTableNotes("taxResidency");

    return { patched, limitPerTable: limit };
  },
});
