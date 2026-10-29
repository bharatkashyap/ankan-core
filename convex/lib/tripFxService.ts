type Currency = "INR" | "USD" | "THB";

const API_BASE = "https://api.frankfurter.dev/v2/rate";
const DAY_MS = 24 * 60 * 60 * 1000;
const cache = new Map<string, { rate: number; date: string; expiresAt: number }>();

export async function getTripToInrRate(currency: Currency, requestedDate: string): Promise<{ rate: number; date: string }> {
  if (currency === "INR") return { rate: 1, date: requestedDate };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(requestedDate)) throw new Error("Invalid trip exchange-rate date");

  const key = `${currency}:${requestedDate}`;
  const cached = cache.get(key);
  if (cached && cached.expiresAt > Date.now()) return { rate: cached.rate, date: cached.date };

  const url = `${API_BASE}/${currency.toLowerCase()}/inr?date=${requestedDate}`;
  const response = await fetch(url, { signal: AbortSignal.timeout(5000) });
  if (!response.ok) throw new Error(`Trip exchange rate unavailable (${response.status})`);
  const body = await response.json() as { date?: string; base?: string; quote?: string; rate?: number };
  const rateDate = body.date;
  if (body.base?.toUpperCase() !== currency || body.quote?.toUpperCase() !== "INR" ||
      !rateDate || !/^\d{4}-\d{2}-\d{2}$/.test(rateDate) || rateDate > requestedDate ||
      Date.parse(`${requestedDate}T00:00:00Z`) - Date.parse(`${rateDate}T00:00:00Z`) > 7 * DAY_MS ||
      !Number.isFinite(body.rate) || !body.rate || body.rate <= 0) {
    throw new Error("Trip exchange rate response was invalid or too old");
  }

  const rate = body.rate;
  const ttl = requestedDate >= new Date().toISOString().slice(0, 10) ? 15 * 60 * 1000 : DAY_MS;
  cache.set(key, { rate, date: rateDate, expiresAt: Date.now() + ttl });
  return { rate, date: rateDate };
}
