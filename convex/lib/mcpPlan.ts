const DAY = 24 * 60 * 60_000;

export function mcpDailyLimit(createdAt: number, paidActive: boolean, now: number, trialDays = 15) {
  const pro = paidActive || now < createdAt + trialDays * DAY;
  return pro ? { plan: "Pro" as const, limit: 1000 } : { plan: "Free" as const, limit: 100 };
}
