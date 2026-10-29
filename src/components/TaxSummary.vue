<script setup lang="ts">
import { computed, reactive, ref } from "vue";
import { useRouter } from "vue-router";
import {
  useTaxPayments,
  useTaxStatusByFiscalYear,
  type Id,
} from "@/composables/useConvex";
import { useAuthStore } from "@/stores/auth";
import { storeToRefs } from "pinia";
import { ExternalLink, Info, Loader2 } from "lucide-vue-next";
import PageHeader from "@/components/PageHeader.vue";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";

type SlabBreakdownRow = {
  from: number;
  to: number;
  taxable: number;
  rate: number;
  tax: number;
};

const TTB_REPO_BASE =
  "https://github.com/bharatkashyap/sbi-ttb-json/blob/main/data/by-date";

const buildTtJsonUrl = (date: string) => `${TTB_REPO_BASE}/${date}.json`;

const now = new Date();
const currentYear = now.getFullYear();
const currentMonth = now.getMonth() + 1;
const defaultFiscalYear =
  currentMonth >= 4
    ? `${currentYear}-${String((currentYear + 1) % 100).padStart(2, "0")}`
    : `${currentYear - 1}-${String(currentYear % 100).padStart(2, "0")}`;

const selectedFiscalYear = ref(defaultFiscalYear);
const {
  status,
  setTaxResidencyForFiscalYear,
  addTaxPayment,
  isRefreshingFxRates,
  isLoading,
} = useTaxStatusByFiscalYear(() => selectedFiscalYear.value);
const {
  paymentsByJurisdiction,
  deleteTaxPayment,
} = useTaxPayments(() => selectedFiscalYear.value);
const auth = useAuthStore();
const router = useRouter();
const { profileId: activeProfileId } = storeToRefs(auth);
const savingResidencyByJurisdiction = reactive<Record<"IN" | "US" | "TH", boolean>>({
  IN: false,
  US: false,
  TH: false,
});
const detailsOpen = ref(false);
const detailsJurisdiction = ref<"IN" | "US" | "TH" | null>(null);

const creditAmountByJurisdiction = reactive<Record<"IN" | "US" | "TH", string>>({
  IN: "",
  US: "",
  TH: "",
});
const creditTypeByJurisdiction = reactive<
  Record<"IN" | "US" | "TH", "tds" | "advance_tax" | "withholding">
>({
  IN: "tds",
  US: "withholding",
  TH: "withholding",
});
const saving = reactive<Record<"IN" | "US" | "TH", boolean>>({
  IN: false,
  US: false,
  TH: false,
});
const editingTaxPaymentId = ref<Id<"taxPayments"> | null>(null);
const editingTaxPaymentAmount = ref("");
const savingTaxPaymentId = ref<Id<"taxPayments"> | null>(null);
const deletingTaxPaymentId = ref<Id<"taxPayments"> | null>(null);

const fiscalYearOptions = computed(() => {
  const options: string[] = [];
  for (let y = currentYear + 1; y >= currentYear - 6; y--) {
    options.push(`${y}-${String((y + 1) % 100).padStart(2, "0")}`);
  }
  if (!options.includes(selectedFiscalYear.value)) {
    options.unshift(selectedFiscalYear.value);
  }
  return options;
});

const formatCurrency = (amount: number, currency: string) => {
  const locale =
    currency === "INR" ? "en-IN" : currency === "THB" ? "th-TH" : "en-US";
  return new Intl.NumberFormat(locale, {
    style: "currency",
    currency,
    maximumFractionDigits: 0,
  }).format(amount);
};

const formatCurrencyExact = (amount: number, currency: string) => {
  const locale =
    currency === "INR" ? "en-IN" : currency === "THB" ? "th-TH" : "en-US";
  return new Intl.NumberFormat(locale, {
    style: "currency",
    currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amount);
};

const totalDueByCurrency = computed(() => {
  const result = { INR: 0, USD: 0, THB: 0 };
  result.INR = status.value.jurisdictions.IN.netDue;
  result.USD = status.value.jurisdictions.US.netDue;
  result.THB = status.value.jurisdictions.TH.netDue;
  return result;
});

const jurisdictionsWithIncome = computed(() => {
  const all = [
    { key: "IN" as const, name: "India" },
    { key: "US" as const, name: "United States" },
    { key: "TH" as const, name: "Thailand" },
  ];
  return all.filter((j) => status.value.jurisdictions[j.key].income > 0);
});

const saveResidency = async (jurisdiction: "IN" | "US" | "TH", isResident: boolean) => {
  if (!activeProfileId.value) return;
  savingResidencyByJurisdiction[jurisdiction] = true;
  try {
    await setTaxResidencyForFiscalYear({
      profileId: activeProfileId.value,
      fiscalYear: selectedFiscalYear.value,
      jurisdiction,
      isResident,
      source: "manual",
      note: "Updated from tax dashboard",
    });
  } finally {
    savingResidencyByJurisdiction[jurisdiction] = false;
  }
};

const openDetails = (jurisdiction: "IN" | "US" | "TH") => {
  detailsJurisdiction.value = jurisdiction;
  detailsOpen.value = true;
};

const closeDetails = () => {
  detailsOpen.value = false;
};

const detailsTitle = computed(() => {
  if (detailsJurisdiction.value === "IN") return "India";
  if (detailsJurisdiction.value === "US") return "United States";
  if (detailsJurisdiction.value === "TH") return "Thailand";
  return "";
});

const saveTaxCredit = async (jurisdiction: "IN" | "US" | "TH") => {
  const raw = creditAmountByJurisdiction[jurisdiction].replace(/,/g, "").trim();
  const amount = Number.parseFloat(raw);
  if (!Number.isFinite(amount) || amount < 0) return;
  if (!activeProfileId.value) return;

  const currencyByJurisdiction = {
    IN: "INR",
    US: "USD",
    TH: "THB",
  } as const;
  const today = new Date().toISOString().slice(0, 10);

  saving[jurisdiction] = true;
  try {
    await addTaxPayment({
      profileId: activeProfileId.value,
      jurisdiction,
      paymentType: creditTypeByJurisdiction[jurisdiction],
      amount,
      currency: currencyByJurisdiction[jurisdiction],
      date: today,
      fiscalYear: selectedFiscalYear.value,
      source: "manual",
      note: "Added from tax dashboard",
    });
    creditAmountByJurisdiction[jurisdiction] = "";
  } finally {
    saving[jurisdiction] = false;
  }
};

type TaxPaymentEntry = {
  _id: Id<"taxPayments">;
  jurisdiction: "IN" | "US" | "TH";
  amount: number;
  currency: "INR" | "USD" | "THB";
  date: string;
  paymentType: "advance_tax" | "tds" | "withholding" | "self_assessment";
  note?: string;
  source: "manual" | "bot";
};

const AUTO_WITHHOLDING_NOTE_PREFIX = "[auto_withholding_income_entry]";

const isAutoWithholdingPayment = (payment: TaxPaymentEntry) =>
  (payment.note || "").startsWith(AUTO_WITHHOLDING_NOTE_PREFIX);

const taxPaymentsForJurisdiction = (
  jurisdiction: "IN" | "US" | "TH",
): TaxPaymentEntry[] => {
  const payments = paymentsByJurisdiction.value[jurisdiction]?.payments || [];
  return [...payments].sort((a, b) => b.date.localeCompare(a.date));
};

const taxPaymentTotalForJurisdiction = (jurisdiction: "IN" | "US" | "TH") =>
  taxPaymentsForJurisdiction(jurisdiction).reduce(
    (sum, payment) => sum + payment.amount,
    0,
  );

const taxPaidFromComputationForJurisdiction = (jurisdiction: "IN" | "US" | "TH") =>
  status.value.jurisdictions[jurisdiction].taxPaid || 0;

const inferredWithholdingFromIncomeForJurisdiction = (
  jurisdiction: "IN" | "US" | "TH",
) =>
  Math.max(
    0,
    taxPaidFromComputationForJurisdiction(jurisdiction) -
      taxPaymentTotalForJurisdiction(jurisdiction),
  );

const startTaxPaymentEdit = (payment: TaxPaymentEntry) => {
  editingTaxPaymentId.value = payment._id;
  editingTaxPaymentAmount.value = `${payment.amount}`;
};

const cancelTaxPaymentEdit = () => {
  editingTaxPaymentId.value = null;
  editingTaxPaymentAmount.value = "";
};

const saveTaxPaymentEdit = async () => {
  if (!editingTaxPaymentId.value) return;
  const parsed = Number.parseFloat(
    editingTaxPaymentAmount.value.replace(/,/g, "").trim(),
  );
  if (!Number.isFinite(parsed) || parsed < 0) return;

  const paymentId = editingTaxPaymentId.value;
  let currentPayment: TaxPaymentEntry | null = null;
  for (const jurisdiction of ["IN", "US", "TH"] as const) {
    const found = taxPaymentsForJurisdiction(jurisdiction).find(
      (payment) => payment._id === paymentId,
    );
    if (found) {
      currentPayment = found;
      break;
    }
  }
  if (!currentPayment || !activeProfileId.value) return;

  savingTaxPaymentId.value = paymentId;
  try {
    await addTaxPayment({
      profileId: activeProfileId.value,
      jurisdiction: currentPayment.jurisdiction,
      paymentType: currentPayment.paymentType,
      amount: parsed,
      currency: currentPayment.currency,
      date: currentPayment.date,
      fiscalYear: selectedFiscalYear.value,
      source: currentPayment.source,
      note: currentPayment.note,
    });
    await deleteTaxPayment({ paymentId });
    cancelTaxPaymentEdit();
  } finally {
    savingTaxPaymentId.value = null;
  }
};

const removeTaxPayment = async (paymentId: Id<"taxPayments">) => {
  deletingTaxPaymentId.value = paymentId;
  try {
    await deleteTaxPayment({ paymentId });
  } finally {
    deletingTaxPaymentId.value = null;
    if (editingTaxPaymentId.value === paymentId) {
      cancelTaxPaymentEdit();
    }
  }
};

const selectedDetails = computed(() => {
  const key = detailsJurisdiction.value;
  if (!key) return null;
  return status.value.jurisdictions[key];
});

const selectedPreReliefTax = computed(() => {
  if (!selectedDetails.value) return 0;
  if (detailsJurisdiction.value === "IN") {
    return status.value.jurisdictions.IN.taxDueNewRegime || selectedDetails.value.taxDue;
  }
  return selectedDetails.value.taxDue;
});

const selectedMonthlyBreakdown = computed(
  () => selectedDetails.value?.incomeBreakdownByMonth || [],
);
const selectedForeignIncomeEntryLines = computed(
  () => selectedDetails.value?.foreignIncomeEntryLines || [],
);
const foreignRatesByMonth = computed(() => {
  const map = new Map<string, string>();
  for (const line of selectedForeignIncomeEntryLines.value) {
    const month = line.date.slice(0, 7);
    const rate = line.rateToInr.toFixed(4);
    const existing = map.get(month);
    if (!existing) {
      map.set(month, rate);
      continue;
    }
    const parts = existing.split(", ");
    if (!parts.includes(rate)) {
      parts.push(rate);
      map.set(month, parts.join(", "));
    }
  }
  return map;
});

const foreignRateDateByMonth = computed(() => {
  const map = new Map<string, string>();
  for (const line of selectedForeignIncomeEntryLines.value) {
    const month = line.date.slice(0, 7);
    if (!map.has(month)) {
      map.set(month, line.rateDate || line.fxRequestedDate || line.date);
    }
  }
  return map;
});

const domesticIncomeBreakdownTotal = computed(() =>
  selectedMonthlyBreakdown.value.reduce((sum, row) => sum + row.domesticIncome, 0),
);

const foreignIncomeBreakdownTotal = computed(() =>
  selectedMonthlyBreakdown.value.reduce(
    (sum, row) => sum + row.foreignIncomeIncluded,
    0,
  ),
);

const selectedFtcApplied = computed(() => {
  if (!selectedDetails.value || detailsJurisdiction.value !== "IN") return 0;
  return selectedDetails.value.foreignTaxCreditAllowed;
});
const selectedFtcRows = computed(
  () => selectedDetails.value?.foreignTaxCreditBreakdown || [],
);
const selectedTaxBaseBeforeDeductions = computed(() => {
  if (!selectedDetails.value) return 0;
  return (
    selectedDetails.value.domesticIncome + selectedDetails.value.foreignIncomeIncluded
  );
});

const selectedTaxableIncomeFromFormula = computed(() => {
  if (!selectedDetails.value) return 0;
  return Math.max(
    0,
    selectedTaxBaseBeforeDeductions.value -
      selectedDetails.value.standardDeductionApplied -
      selectedDetails.value.section44adaDeduction,
  );
});

const selectedSlabRows = computed(() => {
  const rows = selectedDetails.value?.taxComputationRows || [];
  return rows as SlabBreakdownRow[];
});

const selectedSlabTaxTotal = computed(
  () =>
    selectedDetails.value?.taxComputationSlabTax ??
    selectedSlabRows.value.reduce((sum, row) => sum + row.tax, 0),
);

const selectedPreTaxAdjustment = computed(
  () =>
    selectedDetails.value?.taxComputationAdjustment ??
    selectedPreReliefTax.value - selectedSlabTaxTotal.value,
);

const taxDueFromFormula = computed(() => {
  if (!selectedDetails.value) return 0;
  const preRelief = selectedPreReliefTax.value;
  const paid = selectedDetails.value.taxPaid || 0;
  const ftc = selectedFtcApplied.value;
  return Math.max(0, preRelief - ftc - paid);
});

const formatMonth = (month: string) => {
  const [y, m] = month.split("-");
  const year = Number(y);
  const mon = Number(m);
  if (!Number.isFinite(year) || !Number.isFinite(mon)) return month;
  return new Date(year, mon - 1, 1).toLocaleDateString("en-IN", {
    month: "short",
    year: "numeric",
  });
};

const formatTaxSlabRange = (row: SlabBreakdownRow, currency: string) => {
  const from = formatCurrencyExact(row.from, currency);
  const to =
    row.to === Infinity ? "and above" : formatCurrencyExact(row.to, currency);
  return `${from} - ${to}`;
};

const openIncomeMonth = (month: string) => {
  router.push({ path: "/income", query: { month } });
};

type FtcPaymentLine = {
  date: string;
  rateDate?: string;
  paymentId?: Id<"taxPayments">;
  isAutoWithholding?: boolean;
  paymentType: string;
  originalAmount: number;
  originalCurrency: string;
  convertedAmount: number;
  convertedCurrency: string;
  rateToInr?: number;
  fxSource?: "service" | "fallback";
  fxCache?: "hit" | "miss";
  fxRequestedDate?: string;
  fxEndpoint?: string | null;
  fxStatus?: number | null;
};

const hasFtcPaymentLines = (
  row: unknown,
): row is { taxPaymentLines: FtcPaymentLine[] } => {
  if (!row || typeof row !== "object" || !("taxPaymentLines" in row)) return false;
  const lines = (row as { taxPaymentLines?: unknown }).taxPaymentLines;
  return Array.isArray(lines);
};

const getFtcPaymentLines = (row: unknown): FtcPaymentLine[] =>
  hasFtcPaymentLines(row) ? row.taxPaymentLines : [];

const formatPaymentTypeLabel = (paymentType: string) =>
  paymentType.replace(/_/g, " ");

const RULE_115_URL =
  "https://www.legitquest.com/act/income-tax-rules-1962/7b04";
const RULE_128_URL =
  "https://cleartax.in/s/section-90-90a-91-of-income-tax-act";

const indiaTaxDueNew = computed(
  () =>
    status.value.jurisdictions.IN.taxDueNewRegime ||
    status.value.jurisdictions.IN.taxDue,
);
const indiaTaxDueOld = computed(
  () =>
    status.value.jurisdictions.IN.taxDueOldRegime ||
    status.value.jurisdictions.IN.taxDue,
);
const indiaNetDueNew = computed(
  () =>
    status.value.jurisdictions.IN.netDueNewRegime ||
    status.value.jurisdictions.IN.netDue,
);
const indiaNetDueOld = computed(
  () =>
    status.value.jurisdictions.IN.netDueOldRegime ||
    status.value.jurisdictions.IN.netDue,
);

const foreignTaxPaidForJurisdiction = (jurisdiction: "IN" | "US" | "TH") => {
  if (jurisdiction !== "IN") return 0;
  const rows = status.value.jurisdictions.IN.foreignTaxCreditBreakdown || [];
  return rows.reduce(
    (sum, row) => sum + (row.foreignTaxPaidResidentCurrency || 0),
    0,
  );
};
</script>

<template>
  <div class="max-w-5xl">
    <PageHeader
      label="Tax Due (Net)"
      :totals="totalDueByCurrency"
      :is-loading="isLoading || isRefreshingFxRates"
    />

    <div class="flex flex-wrap items-center gap-3 mb-6">
      <label class="text-sm text-muted-foreground">Fiscal Year</label>
      <select
        v-model="selectedFiscalYear"
        class="h-9 px-3 text-sm border rounded bg-background focus:outline-none focus:ring-2 focus:ring-primary"
      >
        <option v-for="fy in fiscalYearOptions" :key="fy" :value="fy">
          {{ fy }}
        </option>
      </select>
    </div>

    <div
      v-if="jurisdictionsWithIncome.length > 0"
      class="grid md:grid-cols-3 gap-4"
    >
      <div
        v-for="j in jurisdictionsWithIncome"
        :key="j.key"
        class="border rounded-lg p-4 space-y-3"
      >
        <div class="flex items-center justify-between">
          <p class="font-medium">{{ j.name }}</p>
          <div class="flex items-center gap-2">
            <button
              @click="saveResidency(j.key as 'IN' | 'US' | 'TH', !status.residencyByJurisdiction[j.key as 'IN' | 'US' | 'TH'])"
              :disabled="savingResidencyByJurisdiction[j.key as 'IN' | 'US' | 'TH']"
              class="text-xs text-muted-foreground hover:text-foreground inline-flex items-center gap-1"
              :title="'Toggle residency for selected FY in this jurisdiction'"
            >
              <Loader2
                v-if="savingResidencyByJurisdiction[j.key as 'IN' | 'US' | 'TH']"
                class="h-3 w-3 animate-spin"
              />
              <span v-else>
                Resident:
                {{
                  status.residencyByJurisdiction[j.key as 'IN' | 'US' | 'TH']
                    ? "Yes"
                    : "No"
                }}
              </span>
            </button>
            <Loader2
              v-if="isLoading || isRefreshingFxRates"
              class="h-4 w-4 animate-spin text-muted-foreground"
            />
            <button
              @click="openDetails(j.key as 'IN' | 'US' | 'TH')"
              class="text-xs text-muted-foreground hover:text-foreground"
            >
              View calculation
            </button>
          </div>
        </div>

        <div class="space-y-1 text-sm">
          <div class="flex justify-between text-muted-foreground">
            <span>Income</span>
            <span class="tabular-nums">{{
              formatCurrency(
                status.jurisdictions[j.key as 'IN' | 'US' | 'TH']
                  .grossIncomeConsidered,
                status.jurisdictions[j.key as 'IN' | 'US' | 'TH'].currency,
              )
            }}</span>
          </div>
          <div class="flex justify-between border-t pt-1">
            <span>{{ j.key === "IN" ? "Tax Due (New Regime)" : "Tax Due" }}</span>
            <span class="tabular-nums font-medium">{{
              formatCurrency(
                j.key === "IN"
                  ? indiaTaxDueNew
                  : status.jurisdictions[j.key as 'US' | 'TH'].taxDue,
                status.jurisdictions[j.key as 'IN' | 'US' | 'TH'].currency,
              )
            }}</span>
          </div>
          <div v-if="j.key === 'IN'" class="flex justify-between text-muted-foreground">
            <span>Tax Due (Old Regime)</span>
            <span class="tabular-nums">{{
              formatCurrency(
                indiaTaxDueOld,
                status.jurisdictions.IN.currency,
              )
            }}</span>
          </div>
          <div class="flex justify-between">
            <span>Tax Paid</span>
            <span class="tabular-nums">{{
              formatCurrency(
                status.jurisdictions[j.key as 'IN' | 'US' | 'TH'].taxPaid,
                status.jurisdictions[j.key as 'IN' | 'US' | 'TH'].currency,
              )
            }}</span>
          </div>
          <div v-if="j.key === 'IN'" class="flex justify-between text-muted-foreground">
            <span>Foreign tax paid (FTC)</span>
            <span class="tabular-nums">{{
              formatCurrency(
                foreignTaxPaidForJurisdiction('IN'),
                status.jurisdictions.IN.foreignTaxCreditCurrency,
              )
            }}</span>
          </div>
          <div class="flex justify-between border-t pt-1 font-medium">
            <span>{{ j.key === "IN" ? "Net Due (New)" : "Net Due" }}</span>
            <span class="tabular-nums">{{
              formatCurrency(
                j.key === "IN"
                  ? indiaNetDueNew
                  : status.jurisdictions[j.key as 'US' | 'TH'].netDue,
                status.jurisdictions[j.key as 'IN' | 'US' | 'TH'].currency,
              )
            }}</span>
          </div>
          <div v-if="j.key === 'IN'" class="flex justify-between text-muted-foreground">
            <span>Net Due (Old)</span>
            <span class="tabular-nums">{{
              formatCurrency(
                indiaNetDueOld,
                status.jurisdictions.IN.currency,
              )
            }}</span>
          </div>
        </div>

        <div class="pt-2 border-t">
          <p class="text-xs text-muted-foreground mb-2">
            Add tax credit entry
          </p>
          <p class="text-[11px] text-muted-foreground mb-2">
            Adds to tax paid for this FY. Does not overwrite existing entries.
          </p>
          <div class="grid grid-cols-1 sm:grid-cols-[auto_1fr_auto] items-center gap-2">
            <select
              v-model="creditTypeByJurisdiction[j.key as 'IN' | 'US' | 'TH']"
              class="h-8 px-2 text-xs border rounded bg-background focus:outline-none focus:ring-2 focus:ring-primary w-full sm:w-auto"
            >
              <template v-if="j.key === 'IN'">
                <option value="tds">TDS</option>
                <option value="advance_tax">Advance Tax</option>
              </template>
              <template v-else>
                <option value="withholding">Withholding</option>
                <option value="advance_tax">Advance Tax</option>
              </template>
            </select>
            <input
              v-model="creditAmountByJurisdiction[j.key as 'IN' | 'US' | 'TH']"
              type="text"
              inputmode="decimal"
              placeholder="0"
              class="w-full min-w-0 h-8 px-2 text-sm border rounded bg-background focus:outline-none focus:ring-2 focus:ring-primary tabular-nums"
            />
            <button
              @click="saveTaxCredit(j.key as 'IN' | 'US' | 'TH')"
              :disabled="saving[j.key as 'IN' | 'US' | 'TH']"
              class="h-8 px-3 text-xs rounded bg-foreground text-background disabled:opacity-40 w-full sm:w-auto"
            >
              <Loader2
                v-if="saving[j.key as 'IN' | 'US' | 'TH']"
                class="h-3 w-3 animate-spin"
              />
              <span v-else>Add</span>
            </button>
          </div>
          <details class="border rounded mt-3">
            <summary class="cursor-pointer select-none px-3 py-2 text-xs text-muted-foreground">
              Manual tax entries this FY ·
              {{
                formatCurrency(
                  taxPaymentTotalForJurisdiction(j.key as 'IN' | 'US' | 'TH'),
                  status.jurisdictions[j.key as 'IN' | 'US' | 'TH'].currency,
                )
              }}
            </summary>
            <div class="border-t">
              <div class="px-3 py-2 text-[11px] text-muted-foreground border-b bg-muted/30 space-y-1">
                <div class="flex justify-between">
                  <span>Total tax paid used in computation</span>
                  <span class="tabular-nums">
                    {{
                      formatCurrency(
                        taxPaidFromComputationForJurisdiction(
                          j.key as 'IN' | 'US' | 'TH',
                        ),
                        status.jurisdictions[j.key as 'IN' | 'US' | 'TH'].currency,
                      )
                    }}
                  </span>
                </div>
                <div
                  v-if="inferredWithholdingFromIncomeForJurisdiction(j.key as 'IN' | 'US' | 'TH') > 0"
                  class="flex justify-between"
                >
                  <span>Included from income withholding</span>
                  <span class="tabular-nums">
                    {{
                      formatCurrency(
                        inferredWithholdingFromIncomeForJurisdiction(
                          j.key as 'IN' | 'US' | 'TH',
                        ),
                        status.jurisdictions[j.key as 'IN' | 'US' | 'TH'].currency,
                      )
                    }}
                  </span>
                </div>
              </div>
              <div
                class="grid grid-cols-[1fr_auto_auto] gap-2 px-3 py-2 text-[11px] uppercase tracking-wide text-muted-foreground bg-muted/40"
              >
                <span>Date · Type</span>
                <span class="text-right">Amount</span>
                <span class="text-right">Action</span>
              </div>
              <div
                v-for="payment in taxPaymentsForJurisdiction(j.key as 'IN' | 'US' | 'TH')"
                :key="payment._id"
                class="grid grid-cols-[1fr_auto_auto] gap-2 px-3 py-2 text-xs border-t items-center"
              >
                <div class="min-w-0">
                  <p class="truncate">{{ payment.date }}</p>
                  <p class="uppercase text-muted-foreground truncate">
                    {{ formatPaymentTypeLabel(payment.paymentType) }}
                    <span
                      v-if="isAutoWithholdingPayment(payment)"
                      class="normal-case text-[10px]"
                    >
                      · from income
                    </span>
                  </p>
                </div>
                <div class="text-right">
                  <input
                    v-if="editingTaxPaymentId === payment._id"
                    v-model="editingTaxPaymentAmount"
                    type="text"
                    inputmode="decimal"
                    class="w-24 h-7 px-2 text-xs text-right border rounded bg-background focus:outline-none focus:ring-2 focus:ring-primary tabular-nums"
                    @keydown.enter.prevent="saveTaxPaymentEdit"
                    @keydown.escape.prevent="cancelTaxPaymentEdit"
                  />
                  <span v-else class="tabular-nums">{{
                    formatCurrency(payment.amount, payment.currency)
                  }}</span>
                </div>
                <div class="flex items-center justify-end gap-1">
                  <template
                    v-if="
                      editingTaxPaymentId === payment._id &&
                      !isAutoWithholdingPayment(payment)
                    "
                  >
                    <button
                      @click="saveTaxPaymentEdit"
                      :disabled="savingTaxPaymentId === payment._id"
                      class="px-2 py-1 text-[10px] rounded border hover:bg-accent disabled:opacity-40"
                    >
                      <Loader2
                        v-if="savingTaxPaymentId === payment._id"
                        class="h-3 w-3 animate-spin"
                      />
                      <span v-else>Save</span>
                    </button>
                    <button
                      @click="cancelTaxPaymentEdit"
                      class="px-2 py-1 text-[10px] rounded border hover:bg-accent"
                    >
                      Cancel
                    </button>
                  </template>
                  <template v-else>
                    <button
                      v-if="!isAutoWithholdingPayment(payment)"
                      @click="startTaxPaymentEdit(payment)"
                      class="px-2 py-1 text-[10px] rounded border hover:bg-accent"
                    >
                      Edit
                    </button>
                    <button
                      @click="removeTaxPayment(payment._id)"
                      :disabled="deletingTaxPaymentId === payment._id"
                      class="px-2 py-1 text-[10px] rounded border hover:bg-accent disabled:opacity-40"
                    >
                      <Loader2
                        v-if="deletingTaxPaymentId === payment._id"
                        class="h-3 w-3 animate-spin"
                      />
                      <span v-else>{{
                        isAutoWithholdingPayment(payment) ? "Clear" : "Delete"
                      }}</span>
                    </button>
                  </template>
                </div>
              </div>
              <p
                v-if="taxPaymentsForJurisdiction(j.key as 'IN' | 'US' | 'TH').length === 0"
                class="px-3 py-2 text-xs text-muted-foreground border-t"
              >
                No tax paid entries for this FY.
              </p>
            </div>
          </details>
        </div>
      </div>
    </div>
    <div v-else class="text-sm text-muted-foreground">No income data yet.</div>

    <Sheet :open="detailsOpen" @update:open="(v) => !v && closeDetails()">
      <SheetContent class="w-full sm:w-[760px] sm:max-w-[760px] overflow-y-auto">
        <SheetHeader class="pr-8">
          <SheetTitle>{{ detailsTitle }} Tax Calculation</SheetTitle>
          <SheetDescription>
            FY {{ selectedFiscalYear }} ·
            {{ detailsJurisdiction === "IN" ? "Apr 1 - Mar 31" : "Calendar year" }}
          </SheetDescription>
        </SheetHeader>

        <div v-if="selectedDetails" class="space-y-4 text-sm">
          <div class="border rounded p-3 space-y-3">
            <div class="flex items-center justify-between">
              <p class="font-medium">Tax base</p>
              <span
                v-if="detailsJurisdiction === 'IN'"
                class="text-[11px] px-2 py-0.5 rounded-full border text-muted-foreground"
              >
                New regime
              </span>
            </div>

            <div class="flex justify-between">
              <span class="text-muted-foreground">Domestic income considered</span>
              <span class="tabular-nums font-medium">{{
                formatCurrency(selectedDetails.domesticIncome, selectedDetails.currency)
              }}</span>
            </div>
            <details v-if="selectedMonthlyBreakdown.length > 0" class="border rounded">
              <summary class="cursor-pointer select-none px-3 py-2 text-xs text-muted-foreground">
                Linked domestic breakup by month
              </summary>
              <div class="border-t">
                <div
                  class="grid grid-cols-2 gap-2 px-3 py-2 text-[11px] uppercase tracking-wide text-muted-foreground bg-muted/40"
                >
                  <span>Month</span>
                  <span class="text-right">Amount</span>
                </div>
                <div
                  v-for="row in selectedMonthlyBreakdown"
                  :key="`d-${row.month}`"
                  class="grid grid-cols-2 gap-2 px-3 py-2 text-xs border-t items-center"
                >
                  <button
                    class="text-left underline underline-offset-2 text-primary"
                    @click="openIncomeMonth(row.month)"
                    :title="`Open income for ${formatMonth(row.month)}`"
                  >
                    {{ formatMonth(row.month) }}
                  </button>
                  <span class="text-right tabular-nums">{{
                    formatCurrencyExact(row.domesticIncome, selectedDetails.currency)
                  }}</span>
                </div>
                <div class="grid grid-cols-2 gap-2 px-3 py-2 text-xs border-t">
                  <span class="font-medium">Sum</span>
                  <span class="text-right tabular-nums font-medium">{{
                    formatCurrencyExact(
                      domesticIncomeBreakdownTotal,
                      selectedDetails.currency,
                    )
                  }}</span>
                </div>
              </div>
            </details>

            <div class="flex justify-between">
              <span class="text-muted-foreground">Foreign income considered</span>
              <span class="tabular-nums font-medium">{{
                formatCurrency(selectedDetails.foreignIncomeIncluded, selectedDetails.currency)
              }}</span>
            </div>
            <details v-if="selectedMonthlyBreakdown.length > 0" class="border rounded">
              <summary
                class="cursor-pointer select-none px-3 py-2 text-xs text-muted-foreground flex items-center justify-between"
              >
                <span>Linked foreign breakup by month</span>
                <Tooltip>
                  <TooltipTrigger as-child>
                    <button
                      type="button"
                      class="inline-flex items-center justify-center rounded p-1 text-muted-foreground hover:text-foreground"
                      aria-label="TT rate policy"
                    >
                      <Info class="h-3.5 w-3.5" />
                    </button>
                  </TooltipTrigger>
                  <TooltipContent class="max-w-[240px] text-xs">
                    <div class="space-y-1">
                      <p>TT rate basis: Rule 115 (TT buying rate).</p>
                      <a
                        :href="RULE_115_URL"
                        target="_blank"
                        rel="noopener noreferrer"
                        class="inline-flex items-center gap-1 underline underline-offset-2"
                      >
                        Rule 115
                        <ExternalLink class="h-3 w-3" />
                      </a>
                    </div>
                  </TooltipContent>
                </Tooltip>
              </summary>
              <div class="border-t">
                <div
                  class="grid grid-cols-3 gap-2 px-3 py-2 text-[11px] uppercase tracking-wide text-muted-foreground bg-muted/40"
                >
                  <span>Month</span>
                  <span class="text-right">TT rate(s)</span>
                  <span class="text-right">Amount</span>
                </div>
                <div
                  v-for="row in selectedMonthlyBreakdown"
                  :key="`f-${row.month}`"
                  class="grid grid-cols-3 gap-2 px-3 py-2 text-xs border-t items-center"
                >
                  <button
                    class="text-left underline underline-offset-2 text-primary"
                    @click="openIncomeMonth(row.month)"
                    :title="`Open income for ${formatMonth(row.month)}`"
                  >
                    {{ formatMonth(row.month) }}
                  </button>
                  <span class="text-right tabular-nums inline-flex items-center justify-end gap-1">
                    {{ foreignRatesByMonth.get(row.month) || "-" }}
                    <a
                      v-if="foreignRateDateByMonth.get(row.month)"
                      :href="buildTtJsonUrl(foreignRateDateByMonth.get(row.month)!)"
                      target="_blank"
                      rel="noopener noreferrer"
                      :title="`Open TT JSON for ${foreignRateDateByMonth.get(row.month)}`"
                    >
                      <ExternalLink class="h-3.5 w-3.5 text-muted-foreground" />
                    </a>
                  </span>
                  <span class="text-right tabular-nums">{{
                    formatCurrencyExact(
                      row.foreignIncomeIncluded,
                      selectedDetails.currency,
                    )
                  }}</span>
                </div>
                <div class="grid grid-cols-3 gap-2 px-3 py-2 text-xs border-t">
                  <span class="font-medium">Sum</span>
                  <span />
                  <span class="text-right tabular-nums font-medium">{{
                    formatCurrencyExact(
                      foreignIncomeBreakdownTotal,
                      selectedDetails.currency,
                    )
                  }}</span>
                </div>
              </div>
            </details>
            <div class="grid grid-cols-2 gap-2 border-t pt-2">
              <span class="text-muted-foreground">Gross tax base</span>
              <span class="text-right tabular-nums">{{
                formatCurrency(selectedTaxBaseBeforeDeductions, selectedDetails.currency)
              }}</span>
              <span class="text-muted-foreground">Less standard deduction / allowances</span>
              <span class="text-right tabular-nums">- {{
                formatCurrency(selectedDetails.standardDeductionApplied, selectedDetails.currency)
              }}</span>
              <span
                v-if="detailsJurisdiction === 'IN' && selectedDetails.section44adaDeduction > 0"
                class="text-muted-foreground"
              >
                Less Section 44ADA deduction
              </span>
              <span
                v-if="detailsJurisdiction === 'IN' && selectedDetails.section44adaDeduction > 0"
                class="text-right tabular-nums"
              >
                - {{ formatCurrency(selectedDetails.section44adaDeduction, selectedDetails.currency) }}
              </span>
              <span class="font-medium border-t pt-1">Taxable income</span>
              <span class="text-right tabular-nums font-medium border-t pt-1">{{
                formatCurrency(selectedTaxableIncomeFromFormula, selectedDetails.currency)
              }}</span>
            </div>
          </div>

          <div class="border rounded p-3 space-y-3">
            <p class="font-medium">Tax payable calculation</p>
            <div class="grid grid-cols-2 gap-2 text-sm">
              <span class="text-muted-foreground">Tax on taxable income</span>
              <span class="text-right tabular-nums">{{
                formatCurrency(selectedPreReliefTax, selectedDetails.currency)
              }}</span>
            </div>

            <details class="border rounded">
              <summary class="cursor-pointer select-none px-3 py-2 text-xs text-muted-foreground">
                Show slab-wise working
              </summary>
              <div class="border-t">
                <div
                  class="grid grid-cols-4 gap-2 px-3 py-2 text-[11px] uppercase tracking-wide text-muted-foreground bg-muted/40"
                >
                  <span>Slab</span>
                  <span class="text-right">Taxable</span>
                  <span class="text-right">Rate</span>
                  <span class="text-right">Tax</span>
                </div>
                <div
                  v-for="(row, index) in selectedSlabRows"
                  :key="`${index}-${row.from}-${row.to}`"
                  class="grid grid-cols-4 gap-2 px-3 py-2 text-xs border-t"
                >
                  <span>{{ formatTaxSlabRange(row, selectedDetails.currency) }}</span>
                  <span class="text-right tabular-nums">{{
                    formatCurrencyExact(row.taxable, selectedDetails.currency)
                  }}</span>
                  <span class="text-right tabular-nums">{{ (row.rate * 100).toFixed(0) }}%</span>
                  <span class="text-right tabular-nums">{{
                    formatCurrencyExact(row.tax, selectedDetails.currency)
                  }}</span>
                </div>
                <div class="grid grid-cols-2 gap-2 px-3 py-2 text-xs border-t">
                  <span class="font-medium">Tax from slabs</span>
                  <span class="text-right tabular-nums font-medium">{{
                    formatCurrencyExact(selectedSlabTaxTotal, selectedDetails.currency)
                  }}</span>
                </div>
                <div v-if="Math.abs(selectedPreTaxAdjustment) >= 0.5" class="grid grid-cols-2 gap-2 px-3 py-2 text-xs border-t">
                  <span class="text-muted-foreground">
                    {{ selectedPreTaxAdjustment > 0 ? "Cess / surcharge / adjustment" : "Rebate / adjustment" }}
                  </span>
                  <span class="text-right tabular-nums">{{
                    formatCurrencyExact(selectedPreTaxAdjustment, selectedDetails.currency)
                  }}</span>
                </div>
                <div class="grid grid-cols-2 gap-2 px-3 py-2 text-xs border-t">
                  <span class="font-medium">Total tax on taxable income</span>
                  <span class="text-right tabular-nums font-medium">{{
                    formatCurrency(selectedPreReliefTax, selectedDetails.currency)
                  }}</span>
                </div>
              </div>
            </details>

            <div class="grid grid-cols-2 gap-2 text-sm">
              <span
                v-if="detailsJurisdiction === 'IN'"
                class="text-muted-foreground"
              >
                Less foreign tax credit (FTC)
              </span>
              <span
                v-if="detailsJurisdiction === 'IN'"
                class="text-right tabular-nums"
              >
                - {{ formatCurrency(selectedDetails.foreignTaxCreditAllowed, "INR") }}
              </span>
              <div
                v-if="detailsJurisdiction === 'IN' && selectedFtcRows.length > 0"
                class="col-span-2 border rounded"
              >
                <details>
                  <summary class="cursor-pointer select-none px-3 py-2 text-xs text-muted-foreground">
                    FTC calculation table
                  </summary>
                  <div class="border-t">
                    <div
                      class="grid grid-cols-5 gap-2 px-3 py-2 text-[11px] uppercase tracking-wide text-muted-foreground bg-muted/40"
                    >
                      <span>Source</span>
                      <span class="text-right">Foreign income</span>
                      <span class="text-right">Foreign tax paid</span>
                      <span class="text-right">India attributable tax</span>
                      <span class="text-right">FTC allowed</span>
                    </div>
                    <div
                      v-for="(row, idx) in selectedFtcRows"
                      :key="`${row.sourceCountry}-${idx}`"
                      class="border-t"
                    >
                      <div class="grid grid-cols-5 gap-2 px-3 py-2 text-xs">
                        <span>{{ row.sourceCountry }}</span>
                        <span class="text-right tabular-nums">{{
                          formatCurrency(row.foreignIncome, selectedDetails.foreignTaxCreditCurrency)
                        }}</span>
                        <span class="text-right tabular-nums">{{
                          formatCurrency(
                            row.foreignTaxPaidResidentCurrency,
                            selectedDetails.foreignTaxCreditCurrency,
                          )
                        }}</span>
                        <span class="text-right tabular-nums">{{
                          formatCurrency(row.attributableTax, selectedDetails.foreignTaxCreditCurrency)
                        }}</span>
                        <span class="text-right tabular-nums font-medium">{{
                          formatCurrency(row.creditAllowed, selectedDetails.foreignTaxCreditCurrency)
                        }}</span>
                      </div>
                      <details
                        v-if="getFtcPaymentLines(row).length > 0"
                        class="px-3 pb-2"
                      >
                        <summary
                          class="cursor-pointer select-none text-[11px] text-muted-foreground flex items-center justify-between"
                        >
                          <span>Tax entries used</span>
                          <Tooltip>
                            <TooltipTrigger as-child>
                              <button
                                type="button"
                                class="inline-flex items-center justify-center rounded p-1 text-muted-foreground hover:text-foreground"
                                aria-label="TT rate policy"
                              >
                                <Info class="h-3.5 w-3.5" />
                              </button>
                            </TooltipTrigger>
                            <TooltipContent class="max-w-[240px] text-xs">
                              <div class="space-y-1">
                                <p>TT rate for foreign tax paid: Rule 128 (TT buying rate).</p>
                                <a
                                  :href="RULE_128_URL"
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  class="inline-flex items-center gap-1 underline underline-offset-2"
                                >
                                  Rule 128
                                  <ExternalLink class="h-3 w-3" />
                                </a>
                              </div>
                            </TooltipContent>
                          </Tooltip>
                        </summary>
                        <div class="mt-2 border rounded">
                        <div
                          class="grid grid-cols-6 gap-2 px-2 py-1.5 text-[10px] uppercase tracking-wide text-muted-foreground bg-muted/40"
                        >
                          <span>Date</span>
                          <span>Type</span>
                          <span class="text-right">Original</span>
                          <span class="text-right">TT rate</span>
                          <span class="text-right">INR used</span>
                          <span class="text-right">Action</span>
                        </div>
                          <div
                            v-for="(line, lineIdx) in getFtcPaymentLines(row)"
                            :key="`${idx}-${lineIdx}`"
                            class="grid grid-cols-6 gap-2 px-2 py-1.5 text-[11px] border-t items-center"
                          >
                            <button
                              class="text-left underline underline-offset-2 text-primary"
                              @click="openIncomeMonth(line.date.slice(0, 7))"
                              :title="`Open income for ${formatMonth(line.date.slice(0, 7))}`"
                            >
                              {{ line.date }}
                            </button>
                            <span class="uppercase">{{ formatPaymentTypeLabel(line.paymentType) }}</span>
                            <span class="text-right tabular-nums">{{
                              formatCurrency(line.originalAmount, line.originalCurrency)
                            }}</span>
                            <span class="text-right tabular-nums inline-flex items-center justify-end gap-1">
                              {{ (line.rateToInr || 0).toFixed(4) }}
                              <a
                                :href="buildTtJsonUrl(line.rateDate || line.fxRequestedDate || line.date)"
                                target="_blank"
                                rel="noopener noreferrer"
                                :title="`Open TT JSON for ${line.rateDate || line.fxRequestedDate || line.date}`"
                              >
                                <ExternalLink class="h-3.5 w-3.5 text-muted-foreground" />
                              </a>
                            </span>
                            <span class="text-right tabular-nums">{{
                              formatCurrency(line.convertedAmount, line.convertedCurrency)
                            }}</span>
                            <span class="text-right">
                              <button
                                v-if="line.paymentId"
                                @click="removeTaxPayment(line.paymentId)"
                                :disabled="deletingTaxPaymentId === line.paymentId"
                                class="px-2 py-1 text-[10px] rounded border hover:bg-accent disabled:opacity-40"
                              >
                                <Loader2
                                  v-if="deletingTaxPaymentId === line.paymentId"
                                  class="h-3 w-3 animate-spin"
                                />
                                <span v-else>{{
                                  line.isAutoWithholding ? "Clear" : "Delete"
                                }}</span>
                              </button>
                            </span>
                          </div>
                        </div>
                      </details>
                    </div>
                  </div>
                </details>
              </div>

              <span class="text-muted-foreground">Tax already paid</span>
              <span class="text-right tabular-nums">- {{
                formatCurrency(selectedDetails.taxPaid, selectedDetails.currency)
              }}</span>

              <span class="font-medium border-t pt-1">Tax due</span>
              <span class="text-right tabular-nums font-medium border-t pt-1">{{
                formatCurrency(taxDueFromFormula, selectedDetails.currency)
              }}</span>
            </div>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  </div>
</template>
