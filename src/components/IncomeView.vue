<script setup lang="ts">
import { ref, computed, watch, nextTick } from "vue";
import { storeToRefs } from "pinia";
import { useRoute } from "vue-router";
import {
  useIncome,
  useIncomeByMonth,
  useIncomeTotalsByCurrency,
} from "@/composables/useConvex";
import type { Id } from "../../convex/_generated/dataModel";
import { useAuthStore } from "@/stores/auth";
import { ChevronDown, X, Plus, Loader2 } from "lucide-vue-next";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import PageHeader from "@/components/PageHeader.vue";
import MultiCurrencyTotal from "@/components/MultiCurrencyTotal.vue";

const auth = useAuthStore();
const route = useRoute();
const { profileId: activeProfileId } = storeToRefs(auth);
const {
  availableMonths,
  categoriesGrouped,
  addIncome,
  updateIncome,
  deleteIncome,
} = useIncome();

const currentIncomeMonth = ref("");

// Initialize with current month
watch(
  () => availableMonths.value,
  (_months) => {
    if (!currentIncomeMonth.value) {
      const now = new Date();
      currentIncomeMonth.value = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
    }
  },
  { immediate: true },
);

watch(
  () => route.query.month,
  (month) => {
    if (typeof month === "string" && /^\d{4}-\d{2}$/.test(month)) {
      currentIncomeMonth.value = month;
    }
  },
  { immediate: true },
);

const { income: monthlyIncome } = useIncomeByMonth(
  () => currentIncomeMonth.value,
);
const { totals: incomeTotals, isLoading: totalLoading } =
  useIncomeTotalsByCurrency(() => currentIncomeMonth.value);

// Active editing state
type IncomeCategoryRef = {
  id: Id<"incomeCategories">;
  name: string;
  group: string;
};

const getDefaultDateForViewedIncomeMonth = () => {
  if (/^\d{4}-\d{2}$/.test(currentIncomeMonth.value)) {
    return `${currentIncomeMonth.value}-01`;
  }
  return new Date().toISOString().slice(0, 10);
};

const activeCategory = ref<IncomeCategoryRef | null>(null);
const expressionInput = ref("");
const noteInput = ref("");
const selectedCurrency = ref<"INR" | "USD" | "THB">("INR");
const selectedDate = ref(getDefaultDateForViewedIncomeMonth());
const inputRef = ref<HTMLInputElement | null>(null);
const isSubmitting = ref(false);
const expandedCategories = ref<Set<string>>(new Set());
const deletingEntryId = ref<string | null>(null);
const editingEntryId = ref<string | null>(null);
const editingDate = ref("");
const editingAmountEntryId = ref<string | null>(null);
const editingAmount = ref("");
const editingNoteEntryId = ref<string | null>(null);
const editingNote = ref("");
const salaryDialogOpen = ref(false);
const salarySheetMode = ref<"add" | "edit">("edit");
const editingSalaryDetailsEntryId = ref<string | null>(null);
const salaryDetailsContext = ref<"salary" | "business">("salary");
const salaryDetailsForm = ref({
  netReceivedAmount: "",
  baseAmount: "",
  bonusAmount: "",
  allowanceAmount: "",
  reimbursementAmount: "",
  otherTaxableBenefitsAmount: "",
  socialSecurityEmployeeAmount: "",
  taxWithheldAmount: "",
});
const addSalaryDetailsForm = ref({
  netReceivedAmount: "",
  baseAmount: "",
  bonusAmount: "",
  allowanceAmount: "",
  reimbursementAmount: "",
  otherTaxableBenefitsAmount: "",
  socialSecurityEmployeeAmount: "",
  taxWithheldAmount: "",
});

const currencies = [
  { code: "INR" as const, symbol: "₹", name: "Rupee" },
  { code: "USD" as const, symbol: "$", name: "Dollar" },
  { code: "THB" as const, symbol: "฿", name: "Baht" },
];

// Map currency to jurisdiction for storage
const currencyToJurisdiction: Record<string, "IN" | "US" | "TH"> = {
  INR: "IN",
  USD: "US",
  THB: "TH",
};

// Map category name to income type
const getIncomeType = (
  categoryName: string,
  groupName: string,
): "salary" | "business" | "investment" | "other" => {
  const category = categoryName.toLowerCase();
  if (category.includes("salary")) return "salary";
  if (groupName === "Employment") return "salary";
  if (groupName === "Business") return "business";
  if (groupName === "Investment" || groupName === "Interest")
    return "investment";
  return "other";
};

const isSalaryCategory = (cat: { name: string; group: string } | null) => {
  if (!cat) return false;
  return getIncomeType(cat.name, cat.group) === "salary";
};

const isBusinessCategory = (cat: { name: string; group: string } | null) => {
  if (!cat) return false;
  return getIncomeType(cat.name, cat.group) === "business";
};

const isDetailsSupportedCategory = (
  cat: { name: string; group: string } | null,
) => {
  return isSalaryCategory(cat) || isBusinessCategory(cat);
};

const formatAmountMaybe = (raw: string, currency: "INR" | "USD" | "THB") => {
  const trimmed = raw.replace(/,/g, "").trim();
  if (!trimmed) return null;
  const parsed = Number.parseFloat(trimmed);
  if (!Number.isFinite(parsed) || parsed < 0) return null;
  return parsed === undefined ? null : formatCurrency(parsed, currency);
};

const addSalaryMetaPreview = computed(() => {
  const c = selectedCurrency.value;
  const parts: string[] = [];
  const net = formatAmountMaybe(addSalaryDetailsForm.value.netReceivedAmount, c);
  const tax = formatAmountMaybe(addSalaryDetailsForm.value.taxWithheldAmount, c);
  if (net) parts.push(`Net ${net}`);
  if (tax) parts.push(`Tax ${tax}`);
  if (isSalaryCategory(activeCategory.value)) {
    const base = formatAmountMaybe(addSalaryDetailsForm.value.baseAmount, c);
    const bonus = formatAmountMaybe(addSalaryDetailsForm.value.bonusAmount, c);
    const allowance = formatAmountMaybe(addSalaryDetailsForm.value.allowanceAmount, c);
    if (base) parts.push(`Base ${base}`);
    if (bonus) parts.push(`Bonus ${bonus}`);
    if (allowance) parts.push(`Allowance ${allowance}`);
  }
  return parts.join(" · ");
});

// Group income by category for the current month
const incomeByCategory = computed(() => {
  const grouped: Record<
    string,
    {
      totals: { INR: number; USD: number; THB: number };
      entries: typeof monthlyIncome.value;
    }
  > = {};
  for (const inc of monthlyIncome.value) {
    if (!grouped[inc.categoryId]) {
      grouped[inc.categoryId] = {
        totals: { INR: 0, USD: 0, THB: 0 },
        entries: [],
      };
    }
    const category = grouped[inc.categoryId];
    if (category) {
      const currency = (inc.currency || "INR") as "INR" | "USD" | "THB";
      category.totals[currency] += inc.amount;
      category.entries.push(inc);
    }
  }
  return grouped;
});

// Evaluate expression like "50000+25000"
const evaluateExpression = (expr: string): number | null => {
  const sanitized = expr.replace(/[^0-9+\-*/.() ]/g, "");
  if (!sanitized.trim()) return null;
  try {
    const result = new Function(`return ${sanitized}`)();
    return typeof result === "number" && !isNaN(result) ? result : null;
  } catch {
    return null;
  }
};

const computedAmount = computed(() => {
  return evaluateExpression(expressionInput.value);
});

// Start editing a category
const startEditing = async (cat: IncomeCategoryRef) => {
  activeCategory.value = cat;
  expressionInput.value = "";
  noteInput.value = "";
  addSalaryDetailsForm.value = {
    netReceivedAmount: "",
    baseAmount: "",
    bonusAmount: "",
    allowanceAmount: "",
    reimbursementAmount: "",
    otherTaxableBenefitsAmount: "",
    socialSecurityEmployeeAmount: "",
    taxWithheldAmount: "",
  };
  selectedDate.value = getDefaultDateForViewedIncomeMonth();
  // Double nextTick needed for v-if rendering
  await nextTick();
  await nextTick();
  const el = inputRef.value;
  if (el && typeof el.focus === "function") {
    el.focus();
  }
};

// Cancel editing
const cancelEditing = () => {
  activeCategory.value = null;
  expressionInput.value = "";
  noteInput.value = "";
};

// Smart blur: only cancel if focus leaves the entire editing area
const handleBlur = (e: FocusEvent) => {
  const related = e.relatedTarget as HTMLElement | null;
  const container = (e.currentTarget as HTMLElement)?.closest(
    "[data-editing-area]",
  );
  if (container && related && container.contains(related)) {
    return;
  }
  cancelEditing();
};

// Submit entry
const submitEntry = async (): Promise<boolean> => {
  const amount = computedAmount.value;
  if (!amount || amount <= 0 || !activeCategory.value || !activeProfileId.value)
    return false;

  isSubmitting.value = true;
  try {
    await addIncome({
      profileId: activeProfileId.value,
      categoryId: activeCategory.value.id,
      amount,
      netReceivedAmount: isDetailsSupportedCategory(activeCategory.value)
        ? parseOptionalAmount(addSalaryDetailsForm.value.netReceivedAmount)
        : undefined,
      salaryDetails: isDetailsSupportedCategory(activeCategory.value)
        ? buildSalaryDetailsFromAddForm()
        : undefined,
      currency: selectedCurrency.value,
      date: selectedDate.value || getDefaultDateForViewedIncomeMonth(),
      jurisdiction: currencyToJurisdiction[selectedCurrency.value] ?? "IN",
      incomeType: getIncomeType(
        activeCategory.value.name,
        activeCategory.value.group,
      ),
      note:
        noteInput.value.trim() ||
        (expressionInput.value.includes("+") || expressionInput.value.includes("-")
          ? expressionInput.value
          : undefined),
      source: "manual",
    });
    // Auto-expand category to show the new entry
    expandedCategories.value.add(activeCategory.value.id);
    expandedCategories.value = new Set(expandedCategories.value);
    expressionInput.value = "";
    noteInput.value = "";
    await nextTick();
    inputRef.value?.focus();
    return true;
  } finally {
    isSubmitting.value = false;
  }
};

// Handle keydown in input
const handleKeydown = (e: KeyboardEvent) => {
  if (e.key === "Enter") {
    submitEntry();
  } else if (e.key === "Escape") {
    cancelEditing();
  }
};

// Toggle category expansion to show individual entries
const toggleExpand = (categoryId: string) => {
  if (expandedCategories.value.has(categoryId)) {
    expandedCategories.value.delete(categoryId);
  } else {
    expandedCategories.value.add(categoryId);
  }
  expandedCategories.value = new Set(expandedCategories.value);
};

// Delete entry with loading state
const handleDelete = async (entryId: string) => {
  deletingEntryId.value = entryId;
  try {
    await deleteIncome({ entryId: entryId as any });
  } finally {
    deletingEntryId.value = null;
  }
};

const editingCategoryEntryId = ref<string | null>(null);

const startCategoryEdit = (entryId: string) => {
  editingCategoryEntryId.value = entryId;
};

const saveCategoryEdit = async (entryId: string, newCategoryId: string) => {
  try {
    await updateIncome({
      entryId: entryId as any,
      categoryId: newCategoryId as any,
    });
  } finally {
    editingCategoryEntryId.value = null;
  }
};

const cancelCategoryEdit = () => {
  editingCategoryEntryId.value = null;
};

const startDateEdit = (
  entryId: string,
  currentDate?: string | null,
) => {
  editingEntryId.value = entryId;
  editingDate.value = currentDate || "";
};

const saveDateEdit = async (entryId: string) => {
  if (!editingDate.value) return;
  try {
    await updateIncome({ entryId: entryId as any, date: editingDate.value });
  } finally {
    editingEntryId.value = null;
  }
};

const cancelDateEdit = () => {
  editingEntryId.value = null;
};

const startAmountEdit = (entryId: string, currentAmount: number) => {
  editingAmountEntryId.value = entryId;
  editingAmount.value = `${currentAmount}`;
};

const saveAmountEdit = async (entryId: string) => {
  const parsed = Number.parseFloat(editingAmount.value.replace(/,/g, "").trim());
  if (!Number.isFinite(parsed) || parsed <= 0) {
    editingAmountEntryId.value = null;
    editingAmount.value = "";
    return;
  }
  try {
    await updateIncome({ entryId: entryId as any, amount: parsed });
  } finally {
    editingAmountEntryId.value = null;
    editingAmount.value = "";
  }
};

const cancelAmountEdit = () => {
  editingAmountEntryId.value = null;
  editingAmount.value = "";
};

const startNoteEdit = (entryId: string, currentNote?: string | null) => {
  editingNoteEntryId.value = entryId;
  editingNote.value = currentNote || "";
};

const saveNoteEdit = async (entryId: string) => {
  const nextNote = editingNote.value.trim();
  try {
    await updateIncome({
      entryId: entryId as any,
      note: nextNote,
    });
  } finally {
    editingNoteEntryId.value = null;
    editingNote.value = "";
  }
};

const cancelNoteEdit = () => {
  editingNoteEntryId.value = null;
  editingNote.value = "";
};

const startSalaryDetailsEdit = (entry: any) => {
  salarySheetMode.value = "edit";
  editingSalaryDetailsEntryId.value = entry._id;
  salaryDetailsContext.value = entry.incomeType === "business" ? "business" : "salary";
  salaryDetailsForm.value = {
    netReceivedAmount:
      entry.netReceivedAmount !== undefined && entry.netReceivedAmount !== null
        ? `${entry.netReceivedAmount}`
        : "",
    baseAmount:
      entry.salaryDetails?.baseAmount !== undefined
        ? `${entry.salaryDetails.baseAmount}`
        : "",
    bonusAmount:
      entry.salaryDetails?.bonusAmount !== undefined
        ? `${entry.salaryDetails.bonusAmount}`
        : "",
    allowanceAmount:
      entry.salaryDetails?.allowanceAmount !== undefined
        ? `${entry.salaryDetails.allowanceAmount}`
        : "",
    reimbursementAmount:
      entry.salaryDetails?.reimbursementAmount !== undefined
        ? `${entry.salaryDetails.reimbursementAmount}`
        : "",
    otherTaxableBenefitsAmount:
      entry.salaryDetails?.otherTaxableBenefitsAmount !== undefined
        ? `${entry.salaryDetails.otherTaxableBenefitsAmount}`
        : "",
    socialSecurityEmployeeAmount:
      entry.salaryDetails?.socialSecurityEmployeeAmount !== undefined
        ? `${entry.salaryDetails.socialSecurityEmployeeAmount}`
        : "",
    taxWithheldAmount:
      entry.salaryDetails?.taxWithheldAmount !== undefined
        ? `${entry.salaryDetails.taxWithheldAmount}`
        : "",
  };
  salaryDialogOpen.value = true;
};

const parseOptionalAmount = (raw: string): number | undefined => {
  const trimmed = raw.replace(/,/g, "").trim();
  if (!trimmed) return undefined;
  const parsed = Number.parseFloat(trimmed);
  if (!Number.isFinite(parsed) || parsed < 0) return undefined;
  return parsed;
};

const buildSalaryDetailsFromAddForm = () => {
  const details = {
    baseAmount: parseOptionalAmount(addSalaryDetailsForm.value.baseAmount),
    bonusAmount: parseOptionalAmount(addSalaryDetailsForm.value.bonusAmount),
    allowanceAmount: parseOptionalAmount(addSalaryDetailsForm.value.allowanceAmount),
    reimbursementAmount: parseOptionalAmount(
      addSalaryDetailsForm.value.reimbursementAmount,
    ),
    otherTaxableBenefitsAmount: parseOptionalAmount(
      addSalaryDetailsForm.value.otherTaxableBenefitsAmount,
    ),
    socialSecurityEmployeeAmount: parseOptionalAmount(
      addSalaryDetailsForm.value.socialSecurityEmployeeAmount,
    ),
    taxWithheldAmount: parseOptionalAmount(
      addSalaryDetailsForm.value.taxWithheldAmount,
    ),
  };
  return Object.values(details).every((v) => v === undefined)
    ? undefined
    : details;
};

const buildSalaryDetailsFromSheetForm = () => {
  const details = {
    baseAmount: parseOptionalAmount(salaryDetailsForm.value.baseAmount),
    bonusAmount: parseOptionalAmount(salaryDetailsForm.value.bonusAmount),
    allowanceAmount: parseOptionalAmount(salaryDetailsForm.value.allowanceAmount),
    reimbursementAmount: parseOptionalAmount(
      salaryDetailsForm.value.reimbursementAmount,
    ),
    otherTaxableBenefitsAmount: parseOptionalAmount(
      salaryDetailsForm.value.otherTaxableBenefitsAmount,
    ),
    socialSecurityEmployeeAmount: parseOptionalAmount(
      salaryDetailsForm.value.socialSecurityEmployeeAmount,
    ),
    taxWithheldAmount: parseOptionalAmount(salaryDetailsForm.value.taxWithheldAmount),
  };
  return Object.values(details).every((v) => v === undefined)
    ? undefined
    : details;
};

const openAddSalaryDetailsSheet = () => {
  salaryDetailsContext.value = isBusinessCategory(activeCategory.value)
    ? "business"
    : "salary";
  salarySheetMode.value = "add";
  editingSalaryDetailsEntryId.value = null;
  salaryDetailsForm.value = { ...addSalaryDetailsForm.value };
  salaryDialogOpen.value = true;
};

const saveSalaryDetailsEdit = async () => {
  if (salarySheetMode.value === "add") {
    addSalaryDetailsForm.value = { ...salaryDetailsForm.value };
    const added = await submitEntry();
    if (added) {
      cancelSalaryDetailsEdit();
    }
    return;
  }

  if (!editingSalaryDetailsEntryId.value) {
    cancelSalaryDetailsEdit();
    return;
  }

  const patch: any = {
    entryId: editingSalaryDetailsEntryId.value as any,
    netReceivedAmount: parseOptionalAmount(salaryDetailsForm.value.netReceivedAmount),
    salaryDetails: buildSalaryDetailsFromSheetForm(),
  };

  try {
    await updateIncome(patch);
  } finally {
    cancelSalaryDetailsEdit();
  }
};

const cancelSalaryDetailsEdit = () => {
  salaryDialogOpen.value = false;
  editingSalaryDetailsEntryId.value = null;
  salaryDetailsForm.value = {
    netReceivedAmount: "",
    baseAmount: "",
    bonusAmount: "",
    allowanceAmount: "",
    reimbursementAmount: "",
    otherTaxableBenefitsAmount: "",
    socialSecurityEmployeeAmount: "",
    taxWithheldAmount: "",
  };
};

const formatSalaryMeta = (entry: any) => {
  if (entry?.incomeType !== "salary" && entry?.incomeType !== "business") return "";
  const c = entry.currency || "INR";
  const parts: string[] = [];
  if (entry.netReceivedAmount !== undefined && entry.netReceivedAmount !== null) {
    parts.push(`Net ${formatCurrency(entry.netReceivedAmount, c)}`);
  }
  if (entry?.incomeType === "salary") {
    if (entry.salaryDetails?.baseAmount !== undefined) {
      parts.push(`Base ${formatCurrency(entry.salaryDetails.baseAmount, c)}`);
    }
    if (entry.salaryDetails?.bonusAmount !== undefined) {
      parts.push(`Bonus ${formatCurrency(entry.salaryDetails.bonusAmount, c)}`);
    }
    if (entry.salaryDetails?.allowanceAmount !== undefined) {
      parts.push(
        `Allowance ${formatCurrency(entry.salaryDetails.allowanceAmount, c)}`,
      );
    }
  }
  if (entry.salaryDetails?.taxWithheldAmount !== undefined) {
    parts.push(
      `${entry?.incomeType === "business" ? "TDS" : "Tax"} ${formatCurrency(
        entry.salaryDetails.taxWithheldAmount,
        c,
      )}`,
    );
  }
  if (
    entry?.incomeType === "salary" &&
    entry.salaryDetails?.socialSecurityEmployeeAmount !== undefined
  ) {
    parts.push(
      `SS ${formatCurrency(entry.salaryDetails.socialSecurityEmployeeAmount, c)}`,
    );
  }
  return parts.join(" · ");
};

const prevMonth = () => {
  const parts = currentIncomeMonth.value.split("-").map(Number);
  const year = parts[0] ?? new Date().getFullYear();
  const month = parts[1] ?? 1;
  const d = new Date(year, month - 2, 1);
  currentIncomeMonth.value = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
};

const nextMonth = () => {
  const parts = currentIncomeMonth.value.split("-").map(Number);
  const year = parts[0] ?? new Date().getFullYear();
  const month = parts[1] ?? 1;
  const d = new Date(year, month, 1);
  currentIncomeMonth.value = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
};

const setMonth = (month: string) => {
  if (!month) return;
  currentIncomeMonth.value = month;
};

const formatCurrency = (amount: number, currency: string = "INR") => {
  const locale =
    currency === "INR" ? "en-IN" : currency === "THB" ? "th-TH" : "en-US";
  return new Intl.NumberFormat(locale, {
    style: "currency",
    currency,
    maximumFractionDigits: 0,
  }).format(amount);
};

const getEntryFlag = (entry: { currency?: string; jurisdiction?: string }) => {
  // Prefer currency because historical imports may have stale jurisdiction.
  if (entry.currency === "THB") return "🇹🇭";
  if (entry.currency === "USD") return "🇺🇸";
  if (entry.currency === "INR") return "🇮🇳";
  if (entry.jurisdiction === "US") return "🇺🇸";
  if (entry.jurisdiction === "TH") return "🇹🇭";
  return "🇮🇳";
};

const formatDate = (dateStr?: string | null) => {
  if (!dateStr) return "--";
  return new Date(dateStr).toLocaleDateString("en-IN", {
    day: "numeric",
    month: "short",
  });
};

// Categories with totals for current month
const categoriesWithTotals = computed(() => {
  const result: Record<
    string,
    Array<{
      id: string;
      name: string;
      group: string;
      totals: { INR: number; USD: number; THB: number };
      entries: any[];
    }>
  > = {};

  for (const [group, cats] of Object.entries(categoriesGrouped.value)) {
    if (!result[group]) result[group] = [];
    for (const cat of cats as any[]) {
      const catData = incomeByCategory.value[cat._id];
      result[group].push({
        id: cat._id,
        name: cat.name,
        group,
        totals: catData?.totals || { INR: 0, USD: 0, THB: 0 },
        entries: catData?.entries || [],
      });
    }
  }
  return result;
});

// Preferred order for groups
const groupOrder = [
  "Employment",
  "Business",
  "Investment",
  "Interest",
  "Property",
  "Other",
];

const sortedGroups = computed(() => {
  const groups = Object.keys(categoriesWithTotals.value);
  return groups.sort((a, b) => {
    const aIdx = groupOrder.indexOf(a);
    const bIdx = groupOrder.indexOf(b);
    if (aIdx === -1 && bIdx === -1) return a.localeCompare(b);
    if (aIdx === -1) return 1;
    if (bIdx === -1) return -1;
    return aIdx - bIdx;
  });
});
</script>

<template>
  <div class="max-w-4xl">
    <!-- Header -->
    <PageHeader
      label="Total Income"
      :totals="incomeTotals"
      :is-loading="totalLoading"
      show-month-nav
      :current-month="currentIncomeMonth"
      :month-options="availableMonths"
      @prev-month="prevMonth"
      @next-month="nextMonth"
      @set-month="setMonth"
    />

    <!-- Categories by Group -->
    <div class="space-y-8">
      <!-- Skeleton loading state -->
      <template v-if="Object.keys(categoriesGrouped).length === 0">
        <div v-for="i in 3" :key="i" class="space-y-3">
          <Skeleton class="h-4 w-24" />
          <div class="space-y-2">
            <div
              v-for="j in 3"
              :key="j"
              class="flex items-center justify-between py-2 px-3 -mx-3"
            >
              <Skeleton class="h-4 w-32" />
              <Skeleton class="h-4 w-16" />
            </div>
          </div>
        </div>
      </template>

      <template v-else>
        <div v-for="group in sortedGroups" :key="group">
          <h3
            class="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-3"
          >
            {{ group }}
          </h3>

          <div class="space-y-1">
            <div v-for="cat in categoriesWithTotals[group]" :key="cat.id">
              <!-- Category Row -->
              <div
                class="flex items-center gap-3 py-2 px-3 -mx-3 rounded-lg hover:bg-accent/50 transition-colors"
                :class="{ 'bg-accent': activeCategory?.id === cat.id }"
              >
                <!-- Expand button (only if has entries) -->
                <button
                  v-if="cat.entries.length > 0"
                  @click="toggleExpand(cat.id)"
                  class="p-0.5 hover:bg-accent rounded transition-colors"
                >
                  <ChevronDown
                    class="h-4 w-4 text-muted-foreground transition-transform"
                    :class="{ '-rotate-180': expandedCategories.has(cat.id) }"
                  />
                </button>
                <div v-else class="w-5" />

                <!-- Category name -->
                <span class="flex-1 text-sm">{{ cat.name }}</span>

                <!-- Inline input when active -->
                <div
                  v-if="activeCategory?.id === cat.id"
                  class="flex flex-col gap-1 items-end min-w-0"
                  data-editing-area
                >
                  <div class="flex items-center gap-1 sm:gap-2 min-w-0">
                    <!-- Currency toggle -->
                    <div
                      class="flex items-center border rounded overflow-hidden text-xs flex-shrink-0"
                    >
                      <button
                        v-for="curr in currencies"
                        :key="curr.code"
                        @mousedown.prevent="selectedCurrency = curr.code"
                        class="px-1.5 py-0.5 transition-colors"
                        :class="
                          selectedCurrency === curr.code
                            ? 'bg-foreground text-background'
                            : 'hover:bg-accent'
                        "
                      >
                        {{ curr.symbol }}
                      </button>
                    </div>
                    <input
                      ref="inputRef"
                      v-model="expressionInput"
                      type="text"
                      placeholder="50000+25000"
                      @keydown="handleKeydown"
                      @blur="handleBlur"
                      class="w-20 sm:w-32 min-w-0 bg-transparent text-right tabular-nums placeholder:text-muted-foreground/40 focus:outline-none border-b border-foreground pb-0.5 text-sm"
                    />
                    <span
                      v-if="computedAmount"
                      class="text-xs text-muted-foreground tabular-nums whitespace-nowrap hidden sm:inline"
                    >
                      = {{ formatCurrency(computedAmount, selectedCurrency) }}
                    </span>
                    <button
                      @mousedown.prevent="submitEntry"
                      :disabled="!computedAmount || isSubmitting"
                      class="text-xs bg-foreground text-background px-2 sm:px-3 py-1 rounded hover:opacity-90 disabled:opacity-30 flex-shrink-0"
                    >
                      <Loader2
                        v-if="isSubmitting"
                        class="h-3 w-3 animate-spin"
                      />
                      <span v-else>Add</span>
                    </button>
                  </div>
                  <!-- Date picker row -->
                  <input
                    v-model="selectedDate"
                    type="date"
                    @blur="handleBlur"
                    class="w-28 bg-transparent text-xs text-muted-foreground tabular-nums focus:outline-none border-b border-muted pb-0.5"
                  />
                  <input
                    v-model="noteInput"
                    type="text"
                    placeholder="Optional note"
                    @keydown="handleKeydown"
                    @blur="handleBlur"
                    class="w-full max-w-52 bg-transparent text-xs text-muted-foreground placeholder:text-muted-foreground/40 focus:outline-none border-b border-muted pb-0.5"
                  />
                  <div
                    v-if="isDetailsSupportedCategory(activeCategory)"
                    class="w-full pt-1 flex items-center justify-end gap-2"
                  >
                    <span
                      class="text-xs text-muted-foreground truncate max-w-[220px] sm:max-w-[360px]"
                    >
                      {{ addSalaryMetaPreview || "No salary details yet" }}
                    </span>
                    <button
                      type="button"
                      @mousedown.prevent="openAddSalaryDetailsSheet"
                      class="px-2 py-1 text-xs border rounded hover:bg-accent transition-colors"
                    >
                      Details
                    </button>
                  </div>
                </div>

                <!-- Amount or Add button when inactive -->
                <template v-else>
                  <button
                    v-if="
                      cat.totals.INR > 0 ||
                      cat.totals.USD > 0 ||
                      cat.totals.THB > 0
                    "
                    @click.stop="toggleExpand(cat.id)"
                    class="rounded px-1 py-0.5 hover:bg-accent transition-colors"
                    title="Tap amount to expand"
                  >
                    <MultiCurrencyTotal
                      :totals="cat.totals"
                      size="sm"
                      class="font-medium"
                    />
                  </button>
                  <button
                    @click="startEditing(cat)"
                    class="p-1 text-muted-foreground hover:text-foreground transition-colors"
                  >
                    <Plus class="h-4 w-4" />
                  </button>
                </template>
              </div>

              <!-- Expanded entries -->
              <div
                v-if="expandedCategories.has(cat.id) && cat.entries.length > 0"
                class="ml-8 pl-3 border-l border-border space-y-1 py-2"
              >
                <div
                  v-for="entry in cat.entries"
                  :key="entry._id"
                  class="py-1.5 text-sm space-y-1"
                >
                  <div class="flex items-center justify-between gap-2">
                    <div
                      class="flex items-center gap-1.5 text-muted-foreground min-w-0"
                    >
                      <span class="flex-shrink-0">{{ getEntryFlag(entry) }}</span>
                      <!-- Editable date -->
                      <input
                        v-if="editingEntryId === entry._id"
                        v-model="editingDate"
                        type="date"
                        @change="saveDateEdit(entry._id)"
                        @blur="cancelDateEdit"
                        @keydown.escape="cancelDateEdit"
                        class="w-28 bg-transparent text-xs tabular-nums focus:outline-none border-b border-foreground pb-0.5"
                        autofocus
                      />
                      <button
                        v-else
                        @click="startDateEdit(entry._id, entry.date)"
                        class="text-xs tabular-nums hover:text-foreground active:text-foreground transition-colors cursor-pointer flex-shrink-0"
                        title="Tap to edit date"
                      >
                        {{ formatDate(entry.date) }}
                      </button>
                      <span class="text-muted-foreground/30">·</span>
                      <!-- Editable category -->
                      <select
                        v-if="editingCategoryEntryId === entry._id"
                        :value="entry.categoryId"
                        @change="
                          saveCategoryEdit(
                            entry._id,
                            ($event.target as HTMLSelectElement).value,
                          )
                        "
                        @blur="cancelCategoryEdit"
                        class="text-xs bg-transparent focus:outline-none border-b border-foreground pb-0.5 max-w-[100px]"
                        autofocus
                      >
                        <template
                          v-for="(cats, group) in categoriesGrouped"
                          :key="group"
                        >
                          <optgroup :label="group">
                            <option
                              v-for="c in cats as any[]"
                              :key="c._id"
                              :value="c._id"
                            >
                              {{ c.name }}
                            </option>
                          </optgroup>
                        </template>
                      </select>
                      <button
                        v-else
                        @click="startCategoryEdit(entry._id)"
                        class="text-xs hover:text-foreground active:text-foreground transition-colors cursor-pointer truncate max-w-[80px] sm:max-w-[120px]"
                        title="Tap to change category"
                      >
                        {{ entry.categoryName }}
                      </button>
                    </div>
                    <div class="flex items-center gap-1.5 flex-shrink-0">
                      <input
                        v-if="editingAmountEntryId === entry._id"
                        v-model="editingAmount"
                        type="text"
                        inputmode="decimal"
                        @blur="saveAmountEdit(entry._id)"
                        @keydown.enter.prevent="saveAmountEdit(entry._id)"
                        @keydown.escape.prevent="cancelAmountEdit"
                        class="w-24 bg-transparent text-right tabular-nums text-sm focus:outline-none border-b border-foreground pb-0.5"
                        autofocus
                      />
                      <button
                        v-else
                        @click="startAmountEdit(entry._id, entry.amount)"
                        class="tabular-nums text-sm hover:text-foreground active:text-foreground transition-colors cursor-pointer"
                        title="Tap to edit gross taxable amount"
                      >
                        {{ formatCurrency(entry.amount, entry.currency || "INR") }}
                      </button>
                      <button
                        @click="handleDelete(entry._id)"
                        :disabled="deletingEntryId === entry._id"
                        class="p-1 -mr-1 text-muted-foreground/40 hover:text-destructive active:text-destructive transition-colors disabled:text-destructive"
                      >
                        <Loader2
                          v-if="deletingEntryId === entry._id"
                          class="h-3.5 w-3.5 animate-spin"
                        />
                        <X v-else class="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </div>
                  <div class="ml-5 text-xs text-muted-foreground min-h-5">
                    <input
                      v-if="editingNoteEntryId === entry._id"
                      v-model="editingNote"
                      type="text"
                      placeholder="Add note"
                      @blur="saveNoteEdit(entry._id)"
                      @keydown.enter.prevent="saveNoteEdit(entry._id)"
                      @keydown.escape.prevent="cancelNoteEdit"
                      class="w-full max-w-sm bg-transparent focus:outline-none border-b border-foreground pb-0.5"
                      autofocus
                    />
                    <button
                      v-else
                      @click="startNoteEdit(entry._id, entry.note)"
                      class="hover:text-foreground transition-colors text-left truncate max-w-sm"
                      :class="{ 'text-muted-foreground/70': !entry.note }"
                      :title="entry.note ? 'Tap to edit note' : 'Tap to add note'"
                    >
                      {{ entry.note ? `Note: ${entry.note}` : "Add note" }}
                    </button>
                  </div>

                  <div
                    v-if="entry.incomeType === 'salary' || entry.incomeType === 'business'"
                    class="ml-5 text-xs text-muted-foreground flex items-center justify-between gap-2"
                  >
                    <span class="truncate">{{ formatSalaryMeta(entry) || "No salary details yet" }}</span>
                    <button
                      @click="startSalaryDetailsEdit(entry)"
                      class="text-xs hover:text-foreground transition-colors whitespace-nowrap"
                    >
                      Edit details
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </template>
    </div>

    <!-- Empty state -->
    <div
      v-if="
        Object.keys(categoriesGrouped).length > 0 && sortedGroups.length === 0
      "
      class="text-center py-12 text-muted-foreground"
    >
      <p>No income this month.</p>
    </div>

    <Sheet :open="salaryDialogOpen" @update:open="(v) => !v && cancelSalaryDetailsEdit()">
      <SheetContent
        side="right"
        class="w-[calc(100%-0.75rem)] sm:w-[34rem] sm:max-w-[34rem] p-0 gap-0"
      >
        <SheetHeader class="px-6 pt-6 pb-3 border-b">
          <SheetTitle>
            {{
              salarySheetMode === "add"
                ? salaryDetailsContext === "business"
                  ? "Professional Income Details (New Entry)"
                  : "Salary Details (New Entry)"
                : salaryDetailsContext === "business"
                  ? "Professional Income Details"
                  : "Salary Details"
            }}
          </SheetTitle>
          <SheetDescription>
            {{
              salaryDetailsContext === "business"
                ? "Track net credited and TDS withheld for this professional-service income entry."
                : "Track gross components, net credited, and withholding for this salary entry."
            }}
          </SheetDescription>
        </SheetHeader>
        <div class="px-6 py-4 space-y-4 overflow-y-auto">
          <div class="space-y-3 rounded-lg border border-border/70 p-3">
            <p class="text-xs font-medium text-muted-foreground uppercase tracking-wide">Cashflow</p>
            <div class="grid grid-cols-1 sm:grid-cols-2 gap-2">
              <label class="space-y-1">
                <span class="text-xs text-muted-foreground">Net received</span>
                <input v-model="salaryDetailsForm.netReceivedAmount" type="text" inputmode="decimal" placeholder="0" class="w-full px-2 py-2 text-sm border rounded bg-background" />
              </label>
              <label class="space-y-1">
                <span class="text-xs text-muted-foreground">Tax withheld</span>
                <input v-model="salaryDetailsForm.taxWithheldAmount" type="text" inputmode="decimal" placeholder="0" class="w-full px-2 py-2 text-sm border rounded bg-background" />
              </label>
              <label
                v-if="salaryDetailsContext === 'salary'"
                class="space-y-1"
              >
                <span class="text-xs text-muted-foreground">Social security (employee)</span>
                <input v-model="salaryDetailsForm.socialSecurityEmployeeAmount" type="text" inputmode="decimal" placeholder="0" class="w-full px-2 py-2 text-sm border rounded bg-background" />
              </label>
            </div>
          </div>

          <div v-if="salaryDetailsContext === 'salary'" class="space-y-3 rounded-lg border border-border/70 p-3">
            <p class="text-xs font-medium text-muted-foreground uppercase tracking-wide">Gross Breakdown</p>
            <div class="grid grid-cols-1 sm:grid-cols-2 gap-2">
              <label class="space-y-1">
                <span class="text-xs text-muted-foreground">Base</span>
                <input v-model="salaryDetailsForm.baseAmount" type="text" inputmode="decimal" placeholder="0" class="w-full px-2 py-2 text-sm border rounded bg-background" />
              </label>
              <label class="space-y-1">
                <span class="text-xs text-muted-foreground">Bonus</span>
                <input v-model="salaryDetailsForm.bonusAmount" type="text" inputmode="decimal" placeholder="0" class="w-full px-2 py-2 text-sm border rounded bg-background" />
              </label>
              <label class="space-y-1">
                <span class="text-xs text-muted-foreground">Allowance</span>
                <input v-model="salaryDetailsForm.allowanceAmount" type="text" inputmode="decimal" placeholder="0" class="w-full px-2 py-2 text-sm border rounded bg-background" />
              </label>
              <label class="space-y-1">
                <span class="text-xs text-muted-foreground">Reimbursement</span>
                <input v-model="salaryDetailsForm.reimbursementAmount" type="text" inputmode="decimal" placeholder="0" class="w-full px-2 py-2 text-sm border rounded bg-background" />
              </label>
              <label class="space-y-1 sm:col-span-2">
                <span class="text-xs text-muted-foreground">Other taxable benefits</span>
                <input v-model="salaryDetailsForm.otherTaxableBenefitsAmount" type="text" inputmode="decimal" placeholder="0" class="w-full px-2 py-2 text-sm border rounded bg-background" />
              </label>
            </div>
          </div>
        </div>
        <SheetFooter class="px-6 py-4 border-t bg-background/95">
          <button
            @click="cancelSalaryDetailsEdit"
            class="px-3 py-2 text-sm border rounded hover:bg-accent transition-colors"
          >
            Cancel
          </button>
          <button
            @click="saveSalaryDetailsEdit"
            class="px-3 py-2 text-sm bg-foreground text-background rounded hover:opacity-90 transition-opacity"
          >
            Save
          </button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  </div>
</template>
