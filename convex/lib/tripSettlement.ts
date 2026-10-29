export type SettlementEntry = {
  amount: number;
  currency: "INR" | "USD" | "THB";
  rateToInr: number;
  paidBy: string;
  splitWith: string[];
};

export type RecordedSettlement = {
  id?: string;
  from: string;
  to: string;
  amount: number;
  currency: "INR" | "USD" | "THB";
  rateToInr: number;
};

export function calculateTripSettlement(entries: SettlementEntry[], separateCurrencies: boolean, payments: RecordedSettlement[] = []) {
  const groups = new Map<string, { totalMinor: number; totalInrMinor: number; balances: Map<string, number> }>();
  for (const entry of entries) {
    if (!Number.isFinite(entry.amount) || entry.amount <= 0 || !Number.isFinite(entry.rateToInr) || entry.rateToInr <= 0 || !entry.splitWith.length) continue;
    const currency = separateCurrencies ? entry.currency : "INR";
    const amountMinor = Math.round(entry.amount * (separateCurrencies ? 1 : entry.rateToInr) * 100);
    if (amountMinor <= 0) continue;
    const group = groups.get(currency) || { totalMinor: 0, totalInrMinor: 0, balances: new Map<string, number>() };
    groups.set(currency, group);
    group.totalMinor += amountMinor;
    group.totalInrMinor += separateCurrencies ? Math.round(entry.amount * entry.rateToInr * 100) : amountMinor;
    group.balances.set(entry.paidBy, (group.balances.get(entry.paidBy) || 0) + amountMinor);
    const people = [...new Set(entry.splitWith)].sort();
    const base = Math.floor(amountMinor / people.length);
    let remainder = amountMinor % people.length;
    for (const person of people) {
      const share = base + (remainder-- > 0 ? 1 : 0);
      group.balances.set(person, (group.balances.get(person) || 0) - share);
    }
  }
  const unappliedPayments: Array<{ id?: string; from: string; to: string; amount: number; currency: string }> = [];
  for (const payment of payments) {
    if (!Number.isFinite(payment.amount) || payment.amount <= 0 || !Number.isFinite(payment.rateToInr) || payment.rateToInr <= 0 || payment.from === payment.to) continue;
    let remainingInrMinor = Math.round(payment.amount * payment.rateToInr * 100);
    if (remainingInrMinor <= 0) continue;
    const candidates = [...groups].filter(([, group]) => (group.balances.get(payment.from) || 0) < 0)
      .sort(([currencyA, groupA], [currencyB, groupB]) =>
        Number(currencyB === payment.currency) - Number(currencyA === payment.currency)
        || Number((groupB.balances.get(payment.to) || 0) > 0) - Number((groupA.balances.get(payment.to) || 0) > 0)
        || (groupA.balances.get(payment.from) || 0) - (groupB.balances.get(payment.from) || 0));
    for (const [currency, group] of candidates) {
      const fromBalance = group.balances.get(payment.from) || 0;
      if (fromBalance >= 0) continue;
      const rateToInr = group.totalInrMinor / group.totalMinor;
      const availableMinor = currency === payment.currency
        ? Math.round(remainingInrMinor / payment.rateToInr)
        : Math.round(remainingInrMinor / rateToInr);
      const appliedMinor = Math.min(-fromBalance, availableMinor);
      if (appliedMinor <= 0) continue;
      group.balances.set(payment.from, fromBalance + appliedMinor);
      group.balances.set(payment.to, (group.balances.get(payment.to) || 0) - appliedMinor);
      remainingInrMinor -= Math.round(appliedMinor * (currency === payment.currency ? payment.rateToInr : rateToInr));
      if (remainingInrMinor <= 1) break;
    }
    if (remainingInrMinor > 1) unappliedPayments.push({
      id: payment.id, from: payment.from, to: payment.to,
      amount: Math.round(remainingInrMinor / payment.rateToInr) / 100, currency: payment.currency,
    });
  }
  const settlements = [...groups].sort(([a], [b]) => a.localeCompare(b)).map(([currency, group]) => {
    const debtors = [...group.balances].filter(([, value]) => value < 0).map(([name, value]) => ({ name, remaining: -value })).sort((a, b) => b.remaining - a.remaining);
    const creditors = [...group.balances].filter(([, value]) => value > 0).map(([name, value]) => ({ name, remaining: value })).sort((a, b) => b.remaining - a.remaining);
    const transfers: Array<{ from: string; to: string; amount: number }> = [];
    let i = 0;
    let j = 0;
    while (i < debtors.length && j < creditors.length) {
      const debtor = debtors[i]!;
      const creditor = creditors[j]!;
      const amount = Math.min(debtor.remaining, creditor.remaining);
      if (amount > 0) transfers.push({ from: debtor.name, to: creditor.name, amount: amount / 100 });
      debtor.remaining -= amount;
      creditor.remaining -= amount;
      if (debtor.remaining === 0) i++;
      if (creditor.remaining === 0) j++;
    }
    return { currency, total: group.totalMinor / 100, transfers };
  });
  return { settlements, unappliedPayments };
}
