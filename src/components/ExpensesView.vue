<script setup lang="ts">
import { ref, computed, watch, nextTick } from "vue";
import { storeToRefs } from "pinia";
import {
  api,
  useConvexAction,
  useConvexQuery,
  useExpenses,
  useExpensesByMonth,
  useExpensesTotalsByCurrency,
} from "@/composables/useConvex";
import type { Id } from "../../convex/_generated/dataModel";
import { useAuthStore } from "@/stores/auth";
import { ChevronDown, X, Plus, Loader2 } from "lucide-vue-next";
import { Skeleton } from "@/components/ui/skeleton";
import PageHeader from "@/components/PageHeader.vue";
import MultiCurrencyTotal from "@/components/MultiCurrencyTotal.vue";
import { toast } from "vue-sonner";

const auth = useAuthStore();
const { profileId: activeProfileId } = storeToRefs(auth);
const { data: activeTrips } = useConvexQuery(api.tripReports.listActiveForProfile,
  () => activeProfileId.value ? { profileId: activeProfileId.value } : "skip");
const { run: addOwnerExpenseToTrip } = useConvexAction(api.tripReportActions.addOwnerExpense);
const {
  availableMonths,
  categoriesGrouped,
  addExpense,
  updateExpense,
  deleteExpense,
} = useExpenses();

const currentExpenseMonth = ref("");

// Initialize with current month
watch(
  () => availableMonths.value,
  (_months) => {
    if (!currentExpenseMonth.value) {
      const now = new Date();
      currentExpenseMonth.value = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
    }
  },
  { immediate: true },
);

const { expenses: monthlyExpenses } = useExpensesByMonth(
  () => currentExpenseMonth.value,
);
const { totals: expenseTotals, isLoading: totalLoading } =
  useExpensesTotalsByCurrency(() => currentExpenseMonth.value);

// Active editing state
type ExpenseCategoryRef = {
  id: Id<"expenseCategories">;
  name: string;
  group: string;
};

const getDefaultDateForViewedExpenseMonth = () => {
  if (/^\d{4}-\d{2}$/.test(currentExpenseMonth.value)) {
    return `${currentExpenseMonth.value}-01`;
  }
  return new Date().toISOString().split("T")[0];
};

const activeCategory = ref<ExpenseCategoryRef | null>(null);
const expressionInput = ref("");
const noteInput = ref("");
const selectedTripIds = ref<Id<"tripReports">[]>([]);
const selectedCurrency = ref<"INR" | "USD" | "THB">("INR");
const selectedDate = ref(getDefaultDateForViewedExpenseMonth());
const inputRef = ref<HTMLInputElement | null>(null);
const isSubmitting = ref(false);
const expandedCategories = ref<Set<string>>(new Set());
const deletingEntryId = ref<string | null>(null);
const editingEntryId = ref<string | null>(null);
const editingDate = ref("");
const editingAmountEntryId = ref<string | null>(null);
const editingAmount = ref("");

const currencies = [
  { code: "INR" as const, symbol: "₹", name: "Rupee" },
  { code: "USD" as const, symbol: "$", name: "Dollar" },
  { code: "THB" as const, symbol: "฿", name: "Baht" },
];

// Group expenses by category for the current month
const expensesByCategory = computed(() => {
  const grouped: Record<
    string,
    {
      totals: { INR: number; USD: number; THB: number };
      entries: typeof monthlyExpenses.value;
    }
  > = {};
  for (const exp of monthlyExpenses.value) {
    if (!grouped[exp.categoryId]) {
      grouped[exp.categoryId] = {
        totals: { INR: 0, USD: 0, THB: 0 },
        entries: [],
      };
    }
    const category = grouped[exp.categoryId];
    if (category) {
      const currency = (exp.currency || "INR") as "INR" | "USD" | "THB";
      category.totals[currency] += exp.amount;
      category.entries.push(exp);
    }
  }
  return grouped;
});

// Evaluate expression like "120+70+100"
const evaluateExpression = (expr: string): number | null => {
  // Only allow numbers, +, -, *, /, (, ), and whitespace
  const sanitized = expr.replace(/[^0-9+\-*/.() ]/g, "");
  if (!sanitized.trim()) return null;
  try {
    // Use Function instead of eval for slightly better safety
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
const startEditing = async (cat: ExpenseCategoryRef) => {
  activeCategory.value = cat;
  expressionInput.value = "";
  noteInput.value = "";
  selectedTripIds.value = [];
  selectedDate.value = getDefaultDateForViewedExpenseMonth();
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
  selectedTripIds.value = [];
};

const toggleTrip = (tripId: Id<"tripReports">) => {
  selectedTripIds.value = selectedTripIds.value.includes(tripId)
    ? selectedTripIds.value.filter((id) => id !== tripId)
    : [...selectedTripIds.value, tripId];
};

// Smart blur: only cancel if focus leaves the entire editing area
const handleBlur = (e: FocusEvent) => {
  const related = e.relatedTarget as HTMLElement | null;
  // If focus moved to another element inside the same editing row, don't cancel
  const container = (e.currentTarget as HTMLElement)?.closest(
    "[data-editing-area]",
  );
  if (container && related && container.contains(related)) {
    return;
  }
  cancelEditing();
};

// Submit entry
const submitEntry = async () => {
  const amount = computedAmount.value;
  if (!amount || amount <= 0 || !activeCategory.value || !activeProfileId.value)
    return;

  isSubmitting.value = true;
  try {
    const entryId = await addExpense({
      profileId: activeProfileId.value,
      categoryId: activeCategory.value.id,
      amount,
      currency: selectedCurrency.value,
      date: selectedDate.value || getDefaultDateForViewedExpenseMonth(),
      note: noteInput.value.trim() || (
        expressionInput.value.includes("+") ||
        expressionInput.value.includes("-")
          ? expressionInput.value // Store the expression as note for reference
          : undefined),
      source: "manual",
    });
    if (selectedTripIds.value.length) {
      const linked = await Promise.allSettled(selectedTripIds.value.map((reportId) =>
        addOwnerExpenseToTrip({ reportId, expenseId: entryId })));
      const failed = linked.filter((result) => result.status === "rejected").length;
      if (failed) toast.error(`Expense saved, but ${failed} trip ${failed === 1 ? "link" : "links"} failed. Add it from the report search.`);
      else toast.success("Expense added to selected trip");
    }
    // Auto-expand category to show the new entry
    expandedCategories.value.add(activeCategory.value.id);
    expandedCategories.value = new Set(expandedCategories.value);
    // Reset and keep same category active for quick repeat entry
    expressionInput.value = "";
    noteInput.value = "";
    await nextTick();
    inputRef.value?.focus();
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
    await deleteExpense({ entryId: entryId as any });
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
    await updateExpense({
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

const startDateEdit = (entryId: string, currentDate?: string | null) => {
  editingEntryId.value = entryId;
  editingDate.value = currentDate || "";
};

const saveDateEdit = async (entryId: string) => {
  if (!editingDate.value) return;
  try {
    await updateExpense({ entryId: entryId as any, date: editingDate.value });
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
  const parsed = Number.parseFloat(
    editingAmount.value.replace(/,/g, "").trim(),
  );
  if (!Number.isFinite(parsed) || parsed <= 0) {
    editingAmountEntryId.value = null;
    editingAmount.value = "";
    return;
  }
  try {
    await updateExpense({ entryId: entryId as any, amount: parsed });
  } finally {
    editingAmountEntryId.value = null;
    editingAmount.value = "";
  }
};

const cancelAmountEdit = () => {
  editingAmountEntryId.value = null;
  editingAmount.value = "";
};

const prevMonth = () => {
  const parts = currentExpenseMonth.value.split("-").map(Number);
  const year = parts[0] ?? new Date().getFullYear();
  const month = parts[1] ?? 1;
  const d = new Date(year, month - 2, 1);
  currentExpenseMonth.value = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
};

const nextMonth = () => {
  const parts = currentExpenseMonth.value.split("-").map(Number);
  const year = parts[0] ?? new Date().getFullYear();
  const month = parts[1] ?? 1;
  const d = new Date(year, month, 1);
  currentExpenseMonth.value = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
};

const setMonth = (month: string) => {
  if (!month) return;
  currentExpenseMonth.value = month;
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
      const catData = expensesByCategory.value[cat._id];
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
  "Housing",
  "Food & Dining",
  "Transport",
  "Utilities",
  "Subscriptions",
  "Health",
  "Entertainment",
  "Shopping",
  "Financial",
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
      label="Total Expenses"
      :totals="expenseTotals"
      :is-loading="totalLoading"
      show-month-nav
      :current-month="currentExpenseMonth"
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
              v-for="j in 4"
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
              <div data-editing-area>
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
                        class="px-1 sm:px-1.5 py-0.5 transition-colors"
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
                      inputmode="decimal"
                      placeholder="0"
                      @keydown="handleKeydown"
                      @blur="handleBlur"
                      class="w-16 sm:w-24 min-w-0 bg-transparent text-right tabular-nums placeholder:text-muted-foreground/40 focus:outline-none border-b border-foreground pb-0.5 text-sm"
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
                </div>

                <!-- Amount or Add button when inactive -->
                <template v-else>
                  <MultiCurrencyTotal
                    v-if="
                      cat.totals.INR > 0 ||
                      cat.totals.USD > 0 ||
                      cat.totals.THB > 0
                    "
                    :totals="cat.totals"
                    size="sm"
                    class="font-medium"
                  />
                  <button
                    @click="startEditing(cat)"
                    class="p-1 text-muted-foreground hover:text-foreground transition-colors"
                  >
                    <Plus class="h-4 w-4" />
                  </button>
                </template>
              </div>

              <div v-if="activeCategory?.id === cat.id" class="mb-3 ml-8 space-y-3 rounded-md border bg-background p-3 sm:ml-11">
                <label class="block text-xs font-medium text-muted-foreground">Description
                  <input v-model="noteInput" type="text" maxlength="200" placeholder="e.g. flight to Chiang Mai" class="mt-1 min-h-10 w-full rounded-md border bg-background px-3 text-sm text-foreground outline-none focus:ring-2 focus:ring-ring" />
                </label>
                <div v-if="activeTrips?.length">
                  <p class="text-xs font-medium text-muted-foreground">Add to trip</p>
                  <div class="mt-2 flex flex-wrap gap-2">
                    <button v-for="trip in activeTrips" :key="trip.id" type="button" :aria-pressed="selectedTripIds.includes(trip.id)" class="min-h-10 rounded-full border px-3 text-sm transition-colors" :class="selectedTripIds.includes(trip.id) ? 'border-foreground bg-foreground text-background' : 'bg-background text-foreground hover:bg-muted'" @click="toggleTrip(trip.id)">{{ trip.title }}</button>
                  </div>
                </div>
              </div>
              </div>

              <!-- Expanded entries -->
              <div
                v-if="expandedCategories.has(cat.id) && cat.entries.length > 0"
                class="ml-8 pl-3 border-l border-border space-y-1 py-2"
              >
                <div
                  v-for="entry in cat.entries"
                  :key="entry._id"
                  class="flex items-center justify-between gap-2 py-1.5 text-sm"
                >
                  <div
                    class="flex items-center gap-1.5 text-muted-foreground min-w-0"
                  >
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
                    <template v-if="entry.note">
                      <span class="text-muted-foreground/30 hidden sm:inline"
                        >·</span
                      >
                      <span class="text-xs truncate hidden sm:inline">{{
                        entry.note
                      }}</span>
                    </template>
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
                      title="Tap to edit amount"
                    >
                      {{
                        formatCurrency(entry.amount, entry.currency || "INR")
                      }}
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
      <p>No expenses this month.</p>
    </div>
  </div>
</template>
