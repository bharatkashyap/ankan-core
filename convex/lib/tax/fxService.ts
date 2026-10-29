type CurrencyCode = "INR" | "USD" | "THB";

const FALLBACK_FX_TO_INR: Record<CurrencyCode, number> = {
  INR: 1,
  USD: 83,
  THB: 2.3,
};

const FX_CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const cache = new Map<string, { value: number; expiresAt: number }>();

export type FxRateMeta = {
  source: "service" | "fallback";
  cache: "hit" | "miss";
  endpoint: string | null;
  status: number | null;
  requestedDate: string;
};

function getFxServiceUrl(): string | null {
  const raw = process.env.FX_SERVICE_URL;
  if (!raw) return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const withScheme =
    trimmed.startsWith("http://") || trimmed.startsWith("https://")
      ? trimmed
      : `https://${trimmed}`;
  return withScheme.endsWith("/") ? withScheme.slice(0, -1) : withScheme;
}

function getFxServiceApiKey(): string | null {
  const raw = process.env.FX_SERVICE_API_KEY;
  if (!raw) return null;
  return raw.trim() || null;
}

function cacheKey(currency: CurrencyCode, date: string) {
  return `${currency}:${date}`;
}

export async function getTtbToInrRate(
  currency: CurrencyCode,
  date: string,
): Promise<number> {
  const result = await getTtbToInrRateWithMeta(currency, date);
  return result.rate;
}

export async function getTtbToInrRateWithMeta(
  currency: CurrencyCode,
  date: string,
): Promise<{ rate: number; meta: FxRateMeta }> {
  if (currency === "INR") {
    return {
      rate: 1,
      meta: {
        source: "service",
        cache: "hit",
        endpoint: null,
        status: 200,
        requestedDate: date,
      },
    };
  }

  const key = cacheKey(currency, date);
  const now = Date.now();
  const cached = cache.get(key);
  const baseUrl = getFxServiceUrl();
  const endpoint = baseUrl
    ? `${baseUrl}/ttb?currency=${encodeURIComponent(currency)}&date=${encodeURIComponent(date)}`
    : null;

  if (cached && cached.expiresAt > now) {
    return {
      rate: cached.value,
      meta: {
        source: baseUrl ? "service" : "fallback",
        cache: "hit",
        endpoint,
        status: 200,
        requestedDate: date,
      },
    };
  }

  if (!baseUrl) {
    console.info("[fx] fallback: FX_SERVICE_URL not configured", {
      currency,
      date,
      fallbackRate: FALLBACK_FX_TO_INR[currency],
    });
    return {
      rate: FALLBACK_FX_TO_INR[currency],
      meta: {
        source: "fallback",
        cache: "miss",
        endpoint: null,
        status: null,
        requestedDate: date,
      },
    };
  }

  try {
    const url = endpoint!;
    const apiKey = getFxServiceApiKey();
    const headers: Record<string, string> = {};
    if (apiKey) headers["x-fx-api-key"] = apiKey;
    const res = await fetch(url, { headers });
    if (!res.ok) {
      console.warn("[fx] fallback: worker returned non-200", {
        currency,
        date,
        url,
        status: res.status,
        fallbackRate: FALLBACK_FX_TO_INR[currency],
      });
      return {
        rate: FALLBACK_FX_TO_INR[currency],
        meta: {
          source: "fallback",
          cache: "miss",
          endpoint: url,
          status: res.status,
          requestedDate: date,
        },
      };
    }
    const body = (await res.json()) as { ttbBuyingInr?: number };
    const rate = body.ttbBuyingInr;
    if (!Number.isFinite(rate) || !rate || rate <= 0) {
      console.warn("[fx] fallback: invalid payload from worker", {
        currency,
        date,
        url,
        status: res.status,
        payload: body,
        fallbackRate: FALLBACK_FX_TO_INR[currency],
      });
      return {
        rate: FALLBACK_FX_TO_INR[currency],
        meta: {
          source: "fallback",
          cache: "miss",
          endpoint: url,
          status: res.status,
          requestedDate: date,
        },
      };
    }
    cache.set(key, { value: rate, expiresAt: now + FX_CACHE_TTL_MS });
    console.info("[fx] service rate fetched", {
      currency,
      date,
      url,
      status: res.status,
      rate,
    });
    return {
      rate,
      meta: {
        source: "service",
        cache: "miss",
        endpoint: url,
        status: res.status,
        requestedDate: date,
      },
    };
  } catch (error) {
    console.error("[fx] fallback: request threw", {
      currency,
      date,
      endpoint,
      fallbackRate: FALLBACK_FX_TO_INR[currency],
      error: error instanceof Error ? error.message : String(error),
    });
    return {
      rate: FALLBACK_FX_TO_INR[currency],
      meta: {
        source: "fallback",
        cache: "miss",
        endpoint,
        status: null,
        requestedDate: date,
      },
    };
  }
}

export async function convertAmountForTax(
  amount: number,
  fromCurrency: CurrencyCode,
  toCurrency: CurrencyCode,
  date: string,
): Promise<number> {
  const result = await convertAmountForTaxWithMeta(
    amount,
    fromCurrency,
    toCurrency,
    date,
  );
  return result.convertedAmount;
}

export async function convertAmountForTaxWithMeta(
  amount: number,
  fromCurrency: CurrencyCode,
  toCurrency: CurrencyCode,
  date: string,
): Promise<{
  convertedAmount: number;
  fromRateMeta: FxRateMeta | null;
  toRateMeta: FxRateMeta | null;
  fromRateToInr: number;
  toRateToInr: number;
}> {
  if (fromCurrency === toCurrency) {
    return {
      convertedAmount: amount,
      fromRateMeta: null,
      toRateMeta: null,
      fromRateToInr: 1,
      toRateToInr: 1,
    };
  }

  const fromRate = await getTtbToInrRateWithMeta(fromCurrency, date);
  const toRate = await getTtbToInrRateWithMeta(toCurrency, date);
  const fromToInr = fromRate.rate;
  const toToInr = toRate.rate;
  const inrAmount = amount * fromToInr;
  return {
    convertedAmount: inrAmount / toToInr,
    fromRateMeta: fromRate.meta,
    toRateMeta: toRate.meta,
    fromRateToInr: fromToInr,
    toRateToInr: toToInr,
  };
}
