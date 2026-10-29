<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { useElementSize } from "@vueuse/core";
import { useRouter } from "vue-router";
import {
  api,
  useAccounts,
  useConvexMutation,
  useConvexQuery,
  useExpenses,
  useExpensesTotalsByCurrency,
  useIncomeTotalsByCurrency,
} from "@/composables/useConvex";
import { useAuthStore } from "@/stores/auth";
import { Loader2, MessageCircle } from "lucide-vue-next";
import MultiCurrencyTotal from "@/components/MultiCurrencyTotal.vue";
import MonthlyNetChart from "@/components/MonthlyNetChart.vue";
import NetWorthProjectionChart from "@/components/NetWorthProjectionChart.vue";

type CurrencyTotals = { INR: number; USD: number; THB: number };
type CurrencyCode = keyof CurrencyTotals;

const currencyOrder: CurrencyCode[] = ["INR", "USD", "THB"];
const currencyMeta: Record<
  CurrencyCode,
  { symbol: string; locale: string; color: string }
> = {
  INR: { symbol: "₹", locale: "en-IN", color: "hsl(220, 15%, 18%)" },
  USD: { symbol: "$", locale: "en-US", color: "hsl(210, 70%, 45%)" },
  THB: { symbol: "฿", locale: "th-TH", color: "hsl(145, 35%, 40%)" },
};

const router = useRouter();
const auth = useAuthStore();
const { assets, liabilities, balances, netWorth, isLoading } = useAccounts();
const { availableMonths } = useExpenses();
const { data: currentUser } = useConvexQuery(
  api.users.currentUser,
  () => (auth.isAuthenticated ? {} : "skip"),
);
const { data: telegramStatus, isLoading: telegramStatusLoading } = useConvexQuery(
  api.users.getTelegramStatus,
  () => (auth.isAuthenticated ? {} : "skip"),
);
const { mutate: dismissTelegramOnboarding, isLoading: dismissOnboardingLoading } =
  useConvexMutation(api.users.dismissTelegramOnboarding);

const netWorthWindow = 12;
const savingsMonthList = computed(() => {
  const list: string[] = [];
  const now = new Date();
  const start = new Date(now.getFullYear(), 0, 1);
  const cursor = new Date(start);
  while (cursor.getFullYear() === now.getFullYear() && cursor.getMonth() <= now.getMonth()) {
    list.push(
      `${cursor.getFullYear()}-${String(cursor.getMonth() + 1).padStart(2, "0")}`,
    );
    cursor.setMonth(cursor.getMonth() + 1);
  }
  return list;
});

const savingsMonthRange = computed(() => {
  const list = savingsMonthList.value;
  return {
    start: list[0] || "",
    end: list[list.length - 1] || "",
  };
});

const { data: incomeMonthlyTotals } = useConvexQuery(
  api.income.getMonthlyTotalsByCurrency,
  () =>
    auth.profileId
      ? {
          profileId: auth.profileId,
          startMonth: savingsMonthRange.value.start,
          endMonth: savingsMonthRange.value.end,
        }
      : "skip",
);

const { data: expenseMonthlyTotals } = useConvexQuery(
  api.expenses.getMonthlyTotalsByCurrency,
  () =>
    auth.profileId
      ? {
          profileId: auth.profileId,
          startMonth: savingsMonthRange.value.start,
          endMonth: savingsMonthRange.value.end,
        }
      : "skip",
);

const { data: netWorthHistory } = useConvexQuery(
  api.accounts.getNetWorthHistoryByMonth,
  () =>
    auth.profileId
      ? { profileId: auth.profileId, months: netWorthWindow }
      : "skip",
);

const summary = computed(() => netWorth.value);
const currentMonth = computed(() => {
  if (availableMonths.value.length > 0) return availableMonths.value[0] ?? "";
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
});

// Expenses and Income for current month
const { totals: currentMonthExpenses, isLoading: expensesLoading } =
  useExpensesTotalsByCurrency(() => currentMonth.value ?? "");
const { totals: currentMonthIncome, isLoading: incomeLoading } =
  useIncomeTotalsByCurrency(() => currentMonth.value ?? "");

const now = new Date();
const currentYear = now.getFullYear();
const currentMonthNumber = now.getMonth() + 1;
const currentFiscalYear =
  currentMonthNumber >= 4
    ? `${currentYear}-${String((currentYear + 1) % 100).padStart(2, "0")}`
    : `${currentYear - 1}-${String(currentYear % 100).padStart(2, "0")}`;

const { data: taxStatus, isLoading: taxLoading } = useConvexQuery(
  api.tax.getTaxStatusByFiscalYear,
  () =>
    auth.profileId
      ? {
          profileId: auth.profileId,
          fiscalYear: currentFiscalYear,
        }
      : "skip",
);

const taxDueByCurrency = computed<CurrencyTotals>(() => {
  const status = taxStatus.value;
  if (!status) return { INR: 0, USD: 0, THB: 0 };
  const indiaDue = status.jurisdictions.IN.netDueNewRegime || status.jurisdictions.IN.netDue || 0;
  return {
    INR: indiaDue,
    USD: status.jurisdictions.US.netDue || 0,
    THB: status.jurisdictions.TH.netDue || 0,
  };
});

type TaxDueScope = {
  key: "IN" | "US" | "TH";
  label: string;
  periodLabel: string;
  amount: number;
  currency: "INR" | "USD" | "THB";
};

const taxDueScopes = computed<TaxDueScope[]>(() => {
  const status = taxStatus.value;
  if (!status) return [];
  const calendarYearLabel = String(now.getFullYear());
  const list: TaxDueScope[] = [
    {
      key: "IN",
      label: "India",
      periodLabel: `FY ${currentFiscalYear}`,
      amount: status.jurisdictions.IN.netDueNewRegime || status.jurisdictions.IN.netDue || 0,
      currency: "INR",
    },
    {
      key: "US",
      label: "US",
      periodLabel: calendarYearLabel,
      amount: status.jurisdictions.US.netDue || 0,
      currency: "USD",
    },
    {
      key: "TH",
      label: "Thailand",
      periodLabel: calendarYearLabel,
      amount: status.jurisdictions.TH.netDue || 0,
      currency: "THB",
    },
  ];
  return list.filter((row) => row.amount > 0);
});

const taxDueTitle = computed(() => {
  if (taxDueScopes.value.length === 1) {
    const only = taxDueScopes.value[0]!;
    return `Tax Due (${only.label} ${only.periodLabel})`;
  }
  if (taxDueScopes.value.length > 1) {
    return "Tax Due (Multiple)";
  }
  return `Tax Due (FY ${currentFiscalYear})`;
});

const overviewNetWorthByCurrency = computed<CurrencyTotals>(() => {
  const assetsByCurrency = summary.value.assetsByCurrency || { INR: 0, USD: 0, THB: 0 };
  const liabilitiesByCurrency = summary.value.liabilitiesByCurrency || {
    INR: 0,
    USD: 0,
    THB: 0,
  };
  return {
    INR:
      (assetsByCurrency.INR || 0) -
      (liabilitiesByCurrency.INR || 0) -
      (taxDueByCurrency.value.INR || 0),
    USD:
      (assetsByCurrency.USD || 0) -
      (liabilitiesByCurrency.USD || 0) -
      (taxDueByCurrency.value.USD || 0),
    THB:
      (assetsByCurrency.THB || 0) -
      (liabilitiesByCurrency.THB || 0) -
      (taxDueByCurrency.value.THB || 0),
  };
});

// Use latest balance-history date as the "as on" valuation date.
const asOnDate = computed(() => {
  const all = Object.values(balances.value || {});
  if (all.length === 0) return null;
  const latest = all.reduce<string | null>((max, row) => {
    if (!row?.date) return max;
    if (!max || row.date > max) return row.date;
    return max;
  }, null);
  if (!latest) return null;
  return new Date(`${latest}T00:00:00`);
});

const formatMonthYear = (monthYear: string) => {
  if (!monthYear) return "";
  const parts = monthYear.split("-");
  if (parts.length < 2) return "";
  const [year, month] = parts;
  return new Date(parseInt(year!), parseInt(month!) - 1).toLocaleDateString(
    "en-IN",
    {
      month: "short",
      year: "numeric",
    },
  );
};

const formatCurrency = (value: number, currency: "INR" | "USD" | "THB") => {
  const symbol = currencyMeta[currency].symbol;
  const locale = currencyMeta[currency].locale;
  return `${symbol}${Math.abs(value).toLocaleString(locale, { maximumFractionDigits: 0 })}`;
};


const netByMonthAll = computed(() => {
  const income = incomeMonthlyTotals.value || [];
  const expense = expenseMonthlyTotals.value || [];
  if (income.length === 0 && expense.length === 0) return [];
  const byMonth = new Map<string, { income: CurrencyTotals; expense: CurrencyTotals }>();
  for (const row of income) {
    byMonth.set(row.month, {
      income: row.totals,
      expense: { INR: 0, USD: 0, THB: 0 },
    });
  }
  for (const row of expense) {
    const existing = byMonth.get(row.month);
    if (existing) {
      existing.expense = row.totals;
    } else {
      byMonth.set(row.month, {
        income: { INR: 0, USD: 0, THB: 0 },
        expense: row.totals,
      });
    }
  }
  const months = savingsMonthList.value;
  const merged = months.map((month) => ({
    month,
    income: byMonth.get(month)?.income || { INR: 0, USD: 0, THB: 0 },
    expense: byMonth.get(month)?.expense || { INR: 0, USD: 0, THB: 0 },
  }));
  return merged.map((row) => ({
    month: row.month,
    income: row.income,
    expense: row.expense,
    net: {
      INR: (row.income.INR || 0) - (row.expense.INR || 0),
      USD: (row.income.USD || 0) - (row.expense.USD || 0),
      THB: (row.income.THB || 0) - (row.expense.THB || 0),
    },
  }));
});

const incomeCurrencies = computed<CurrencyCode[]>(() => {
  const income = incomeMonthlyTotals.value || [];
  return currencyOrder.filter((currency) =>
    income.some((row) => Math.abs(row.totals[currency] || 0) > 0),
  );
});

const chartCurrencies = computed<CurrencyCode[]>(() => {
  if (incomeCurrencies.value.length > 0) return incomeCurrencies.value;
  const history = netWorthHistory.value || [];
  const fromHistory = currencyOrder.filter((currency) =>
    history.some((row) => Math.abs(row.totals[currency] || 0) > 0),
  );
  return fromHistory.length > 0 ? fromHistory : ["INR"];
});

const netByMonthByCurrency = computed<
  Record<
    CurrencyCode,
    Array<{
      month: string;
      value: number;
      income: number;
      expense: number;
      currencyLabel: string;
    }>
  >
>(() => {
  const out: Record<
    CurrencyCode,
    Array<{
      month: string;
      value: number;
      income: number;
      expense: number;
      currencyLabel: string;
    }>
  > = {
    INR: [],
    USD: [],
    THB: [],
  };
  for (const currency of currencyOrder) {
    out[currency] = netByMonthAll.value.map((row) => ({
      month: row.month,
      value: row.net[currency] || 0,
      income: row.income[currency] || 0,
      expense: row.expense[currency] || 0,
      currencyLabel: currencyMeta[currency].symbol,
    }));
  }
  return out;
});

const avgNetFlowByCurrency = computed<Record<CurrencyCode, number | null>>(() => {
  const out: Record<CurrencyCode, number | null> = {
    INR: null,
    USD: null,
    THB: null,
  };
  for (const currency of currencyOrder) {
    const values = netByMonthByCurrency.value[currency].map((row) => row.value);
    if (values.length === 0) continue;
    out[currency] = values.reduce((sum, value) => sum + value, 0) / values.length;
  }
  return out;
});

const avgNetFlowEntries = computed(() =>
  chartCurrencies.value
    .map((currency) => ({
      currency,
      value: avgNetFlowByCurrency.value[currency],
    }))
    .filter(
      (row): row is { currency: CurrencyCode; value: number } => row.value !== null,
    ),
);

const hasSavingsHistory = computed(() =>
  chartCurrencies.value.some(
    (currency) => netByMonthByCurrency.value[currency].length > 0,
  ),
);

const savingsCurrencies = computed<CurrencyCode[]>(() => {
  if (incomeCurrencies.value.length > 0) return incomeCurrencies.value;
  return chartCurrencies.value;
});

const hasSavingsCurrencyToggle = computed(() => incomeCurrencies.value.length > 1);
const selectedSavingsCurrency = ref<CurrencyCode>("INR");
const savingsChartAreaRef = ref<HTMLElement | null>(null);
const { width: savingsChartAreaWidth } = useElementSize(savingsChartAreaRef);
const savingsChartHeight = computed(() =>
  Math.round(
    Math.min(
      260,
      Math.max(150, (savingsChartAreaWidth.value || 0) * 0.52),
    ),
  ),
);

watch(
  savingsCurrencies,
  (currencies) => {
    const fallback = currencies[0] || "INR";
    if (!currencies.includes(selectedSavingsCurrency.value)) {
      selectedSavingsCurrency.value = fallback;
    }
  },
  { immediate: true },
);

const netWorthSeries = computed(() => {
  const history = (netWorthHistory.value || []).slice().sort((a, b) =>
    a.month.localeCompare(b.month),
  );
  if (history.length === 0) return [];
  const currentYearPrefix = `${now.getFullYear()}-`;
  const currentMonthPadded = String(now.getMonth() + 1).padStart(2, "0");
  const ytd = history.filter((row) => {
    if (!row.month.startsWith(currentYearPrefix)) return false;
    const mm = row.month.slice(5, 7);
    return mm <= currentMonthPadded;
  });
  const source = ytd.length > 0 ? ytd : history;
  return source.map((row) => ({
    month: row.month,
    totals: {
      INR: row.totals.INR || 0,
      USD: row.totals.USD || 0,
      THB: row.totals.THB || 0,
    },
  }));
});

const netWorthSeriesByCurrency = computed<
  Record<CurrencyCode, Array<{ month: string; value: number }>>
>(() => ({
  INR: netWorthSeries.value.map((row) => ({
    month: row.month,
    value: row.totals.INR || 0,
  })),
  USD: netWorthSeries.value.map((row) => ({
    month: row.month,
    value: row.totals.USD || 0,
  })),
  THB: netWorthSeries.value.map((row) => ({
    month: row.month,
    value: row.totals.THB || 0,
  })),
}));

const buildProjection = (
  series: Array<{ month: string; value: number }>,
  averageNet: number | null,
) => {
  if (series.length === 0) return [];
  const last = series[series.length - 1]!;
  const [yearStr, monthStr] = last.month.split("-");
  const year = Number(yearStr);
  const month = Number(monthStr);
  if (!Number.isFinite(year) || !Number.isFinite(month)) return [];
  const monthsLeft = 12 - month;
  const monthlyDelta = averageNet ?? 0;
  const projection: Array<{ month: string; value: number }> = [];
  for (let i = 1; i <= monthsLeft; i += 1) {
    projection.push({
      month: `${year}-${String(month + i).padStart(2, "0")}`,
      value: last.value + monthlyDelta * i,
    });
  }
  return projection;
};

const projectedNetWorthByCurrency = computed<
  Record<CurrencyCode, Array<{ month: string; value: number }>>
>(() => ({
  INR: buildProjection(
    netWorthSeriesByCurrency.value.INR,
    avgNetFlowByCurrency.value.INR,
  ),
  USD: buildProjection(
    netWorthSeriesByCurrency.value.USD,
    avgNetFlowByCurrency.value.USD,
  ),
  THB: buildProjection(
    netWorthSeriesByCurrency.value.THB,
    avgNetFlowByCurrency.value.THB,
  ),
}));

const netWorthChartSeries = computed(() =>
  chartCurrencies.value
    .map((currency) => ({
      currency,
      actual: netWorthSeriesByCurrency.value[currency],
      projected: projectedNetWorthByCurrency.value[currency],
    }))
    .filter((row) => row.actual.length > 0),
);

const hasNetWorthTrend = computed(() =>
  netWorthChartSeries.value.some((row) => row.actual.length > 1),
);

const netWorthLegendCurrencies = computed(() =>
  netWorthChartSeries.value.map((row) => row.currency),
);

const currencyColor = (currency: CurrencyCode) => currencyMeta[currency].color;

const formatSignedFlow = (value: number, currency: CurrencyCode) => {
  const sign = value >= 0 ? "+" : "−";
  return `${sign}${formatCurrency(value, currency)}/mo`;
};

const formatMonthShort = (monthStr: string) => {
  const [year, month] = monthStr.split("-");
  const d = new Date(parseInt(year!, 10), parseInt(month!, 10) - 1, 1);
  return d.toLocaleDateString("en-IN", { month: "short", year: "2-digit" });
};

const projectedEndSummary = computed(() => {
  const entries = netWorthLegendCurrencies.value
    .map((currency) => {
      const projected =
        projectedNetWorthByCurrency.value[currency][
          projectedNetWorthByCurrency.value[currency].length - 1
        ];
      const actual =
        netWorthSeriesByCurrency.value[currency][
          netWorthSeriesByCurrency.value[currency].length - 1
        ];
      const point = projected || actual;
      if (!point) return null;
      return { currency, month: point.month, value: point.value };
    })
    .filter(
      (row): row is { currency: CurrencyCode; month: string; value: number } =>
        row !== null,
    );

  if (entries.length === 0) return null;

  const month = entries
    .map((row) => row.month)
    .sort((a, b) => a.localeCompare(b))
    .at(-1)!;

  return { month, entries };
});


const formatDate = (date: Date) => {
  return date.toLocaleDateString("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
};

const shouldShowTelegramOnboarding = computed(() => {
  if (!auth.isAuthenticated || telegramStatusLoading.value) return false;
  const linked = telegramStatus.value?.isLinked ?? false;
  const dismissed = !!currentUser.value?.telegramOnboardingDismissedAt;
  return !linked && !dismissed;
});

const dismissTelegramOnboardingCard = async () => {
  await dismissTelegramOnboarding({});
};
</script>

<template>
  <div class="max-w-4xl">
    <div
      v-if="shouldShowTelegramOnboarding"
      class="mb-8 rounded-xl border border-border/70 bg-card/60 p-4 sm:p-5"
    >
      <div class="flex items-start justify-between gap-4">
        <div class="min-w-0">
          <div class="flex items-center gap-2">
            <MessageCircle class="h-4 w-4 text-primary" />
            <p class="text-sm font-medium">Connect Telegram to start logging in chat</p>
          </div>
          <p class="mt-1 text-sm text-muted-foreground">
            Use the bot for quick entries from plain text and screenshots.
          </p>
          <div class="mt-3 flex flex-wrap gap-2">
            <button
              class="rounded-md bg-primary px-3 py-1.5 text-sm text-primary-foreground hover:bg-primary/90 transition-colors"
              @click="router.push('/link-telegram')"
            >
              Link Telegram
            </button>
            <button
              class="rounded-md border border-border px-3 py-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors disabled:opacity-50"
              :disabled="dismissOnboardingLoading"
              @click="dismissTelegramOnboardingCard"
            >
              Maybe later
            </button>
          </div>
        </div>
      </div>
    </div>

    <!-- Net Worth -->
    <div class="mb-12">
      <div class="flex items-baseline gap-3 mb-1">
        <p class="text-sm text-muted-foreground">Net Worth</p>
        <Loader2
          v-if="isLoading"
          class="h-3 w-3 animate-spin text-muted-foreground/50"
        />
        <p v-else-if="asOnDate" class="text-xs text-muted-foreground/70">
          as on {{ formatDate(asOnDate) }}
        </p>
      </div>
      <div :class="{ 'opacity-50': isLoading }">
        <MultiCurrencyTotal :totals="overviewNetWorthByCurrency" size="lg" />
      </div>
      <!-- TODO: Net Worth Sparkline placeholder - uncomment when data query is fixed
      <div v-if="netWorthHistory && netWorthHistory.length > 1" class="mt-4">
        <NetWorthSparkline :data="netWorthHistory" :height="64" />
      </div>
      -->
    </div>

    <!-- Summary Row: Assets, Liabilities, Tax Due -->
    <div class="grid grid-cols-2 gap-4 sm:grid-cols-3 sm:gap-8 mb-8">
      <button class="text-left group" @click="router.push('/assets')">
        <p class="text-xs text-muted-foreground mb-1 uppercase tracking-wide">
          Assets
        </p>
        <div
          class="group-hover:text-primary transition-colors"
          :class="{ 'opacity-50': isLoading }"
        >
          <MultiCurrencyTotal
            :totals="summary.assetsByCurrency || { INR: summary.assets }"
            size="md"
          />
        </div>
        <p class="text-xs text-muted-foreground mt-1">
          {{ assets.length }} accounts
        </p>
      </button>

      <button class="text-left group" @click="router.push('/liabilities')">
        <p class="text-xs text-muted-foreground mb-1 uppercase tracking-wide">
          Liabilities
        </p>
        <div
          class="group-hover:text-primary transition-colors"
          :class="{ 'opacity-50': isLoading }"
        >
          <MultiCurrencyTotal
            :totals="summary.liabilitiesByCurrency || { INR: summary.liabilities }"
            size="md"
          />
        </div>
        <p class="text-xs text-muted-foreground mt-1">
          {{ liabilities.length }} accounts
        </p>
      </button>

      <button class="text-left group" @click="router.push('/tax')">
        <p class="text-xs text-muted-foreground mb-1 uppercase tracking-wide">
          {{ taxDueTitle }}
        </p>
        <div
          class="group-hover:text-primary transition-colors"
          :class="{ 'opacity-50': taxLoading }"
        >
          <MultiCurrencyTotal :totals="taxDueByCurrency" size="md" />
        </div>
        <div
          v-if="taxDueScopes.length > 1"
          class="mt-1 space-y-0.5 text-[11px] text-muted-foreground"
        >
          <p
            v-for="row in taxDueScopes"
            :key="row.key"
            class="flex items-center justify-between gap-2 tabular-nums"
          >
            <span>{{ row.label }} {{ row.periodLabel }}</span>
            <span>{{ row.currency === "INR" ? "₹" : row.currency === "USD" ? "$" : "฿" }}{{ row.amount.toLocaleString("en-IN", { maximumFractionDigits: 0 }) }}</span>
          </p>
        </div>
        <p v-else class="text-xs text-muted-foreground mt-1">Net due</p>
      </button>
    </div>

    <!-- Income & Expenses Row -->
    <div class="grid grid-cols-2 gap-4 sm:gap-8 mb-12">
      <button class="text-left group" @click="router.push('/income')">
        <p class="text-xs text-muted-foreground mb-1 uppercase tracking-wide">
          Income {{ formatMonthYear(currentMonth) }}
        </p>
        <div
          class="group-hover:text-primary transition-colors"
          :class="{ 'opacity-50': incomeLoading }"
        >
          <MultiCurrencyTotal :totals="currentMonthIncome" size="md" />
        </div>
      </button>

      <button class="text-left group" @click="router.push('/expenses')">
        <p class="text-xs text-muted-foreground mb-1 uppercase tracking-wide">
          Spent {{ formatMonthYear(currentMonth) }}
        </p>
        <div
          class="group-hover:text-primary transition-colors"
          :class="{ 'opacity-50': expensesLoading }"
        >
          <MultiCurrencyTotal :totals="currentMonthExpenses" size="md" />
        </div>
      </button>
    </div>

    <div class="grid grid-cols-1 gap-4 sm:gap-8 sm:grid-cols-2 mb-10">
      <div class="rounded-xl border border-border/60 bg-card/40 p-3 sm:p-4 flex flex-col h-full">
        <div class="flex items-baseline justify-between gap-4 mb-3">
          <div>
            <p class="text-sm text-muted-foreground">Savings per month</p>
            <p class="text-xs text-muted-foreground/70">Income minus expense by currency</p>
          </div>
          <div
            v-if="hasSavingsCurrencyToggle"
            class="inline-flex rounded-md border border-border/80 p-0.5"
          >
            <button
              v-for="currency in savingsCurrencies"
              :key="`savings-toggle-${currency}`"
              class="px-2 py-1 text-[10px] rounded-sm transition-colors"
              :class="
                selectedSavingsCurrency === currency
                  ? 'bg-foreground text-background'
                  : 'text-muted-foreground hover:text-foreground'
              "
              @click="selectedSavingsCurrency = currency"
            >
              {{ currency }}
            </button>
          </div>
        </div>
        <div
          ref="savingsChartAreaRef"
          class="flex-1 min-h-0"
          :class="{ 'opacity-50': incomeLoading || expensesLoading }"
        >
          <div v-if="hasSavingsHistory" class="space-y-2">
            <div class="flex items-center justify-between text-[10px] text-muted-foreground/80">
              <span class="inline-flex items-center gap-1">
                <span
                  class="h-0.5 w-4 rounded-full"
                  :style="{ backgroundColor: currencyColor(selectedSavingsCurrency) }"
                />
                {{ selectedSavingsCurrency }}
              </span>
              <span v-if="avgNetFlowByCurrency[selectedSavingsCurrency] !== null">
                Avg {{
                  formatSignedFlow(
                    avgNetFlowByCurrency[selectedSavingsCurrency] || 0,
                    selectedSavingsCurrency,
                  )
                }}
              </span>
            </div>

            <MonthlyNetChart
              v-if="netByMonthByCurrency[selectedSavingsCurrency].length > 0"
              :data="netByMonthByCurrency[selectedSavingsCurrency]"
              :height="savingsChartHeight"
              :average="avgNetFlowByCurrency[selectedSavingsCurrency]"
            />
          </div>
          <p v-else class="text-xs text-muted-foreground">Not enough history yet.</p>
        </div>
      </div>

      <div class="rounded-xl border border-border/60 bg-card/40 p-3 sm:p-4">
        <div class="flex items-baseline justify-between gap-4 mb-3">
          <div>
            <p class="text-sm text-muted-foreground">Net worth trend</p>
            <p v-if="netWorthChartSeries.length > 0" class="text-xs text-muted-foreground/70">
              Projection based on average net flow
            </p>
            <p v-if="avgNetFlowEntries.length > 0" class="text-[10px] text-muted-foreground/70 mt-1">
              Avg net flow:
              <template
                v-for="(row, idx) in avgNetFlowEntries"
                :key="`avg-flow-${row.currency}`"
              >
                <span v-if="idx > 0"> · </span>
                <span>{{ formatSignedFlow(row.value, row.currency) }}</span>
              </template>
            </p>
          </div>
          <div class="flex items-center gap-3 text-[10px] text-muted-foreground/70">
            <span
              v-for="currency in netWorthLegendCurrencies"
              :key="`legend-${currency}`"
              class="inline-flex items-center gap-1"
            >
              <span class="h-0.5 w-4 rounded-full" :style="{ backgroundColor: currencyColor(currency) }" />
              {{ currency }}
            </span>
            <span class="inline-flex items-center gap-1">
              <span class="h-0.5 w-4 rounded-full border border-dashed border-muted-foreground/70" />
              Projection
            </span>
          </div>
        </div>
        <div :class="{ 'opacity-50': isLoading }">
          <NetWorthProjectionChart
            v-if="hasNetWorthTrend"
            :series="netWorthChartSeries"
            :height="savingsChartHeight"
          />
          <p
            v-if="projectedEndSummary"
            class="mt-2 text-[10px] text-muted-foreground/80"
          >
            {{ formatMonthShort(projectedEndSummary.month) }} projected total:
            <template
              v-for="(entry, idx) in projectedEndSummary.entries"
              :key="`projected-total-${entry.currency}`"
            >
              <span v-if="idx > 0"> · </span>
              <span>{{ entry.currency }} {{ formatCurrency(entry.value, entry.currency) }}</span>
            </template>
          </p>
          <p v-else class="text-xs text-muted-foreground">Not enough history yet.</p>
        </div>
      </div>
    </div>

    <!-- Quick Links -->
    <div class="border-t pt-8">
      <div class="flex gap-6">
        <button
          @click="router.push('/expenses')"
          class="text-sm text-muted-foreground hover:text-foreground transition-colors"
        >
          + Add expense
        </button>
        <button
          @click="router.push('/income')"
          class="text-sm text-muted-foreground hover:text-foreground transition-colors"
        >
          + Add income
        </button>
        <button
          @click="router.push('/assets')"
          class="text-sm text-muted-foreground hover:text-foreground transition-colors"
        >
          + Update balance
        </button>
      </div>
    </div>
  </div>
</template>
