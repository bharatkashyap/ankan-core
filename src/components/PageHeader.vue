<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { Loader2, ChevronLeft, ChevronRight } from "lucide-vue-next";
import MultiCurrencyTotal from "@/components/MultiCurrencyTotal.vue";
import type { CurrencyTotals } from "@/lib/currency";

interface Props {
  label: string;
  totals: Partial<CurrencyTotals>;
  isLoading?: boolean;
  // For balance views (Assets, Liabilities)
  asOnDate?: string;
  // Some non-financial views use the shared month controls without a balance.
  hideTotals?: boolean;
  // For monthly views (Expenses, Income)
  showMonthNav?: boolean;
  currentMonth?: string;
  monthOptions?: string[];
}

const props = withDefaults(defineProps<Props>(), {
  isLoading: false,
  showMonthNav: false,
  hideTotals: false,
});

const emit = defineEmits<{
  prevMonth: [];
  nextMonth: [];
  setMonth: [month: string];
}>();

const monthNames = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

const selectedYear = ref<number | null>(null);
const selectedMonth = ref<number | null>(null);

const currentYearMonth = computed(() => {
  const parts = (props.currentMonth || "").split("-");
  if (parts.length < 2) return null;
  const year = Number(parts[0]);
  const month = Number(parts[1]);
  if (!Number.isFinite(year) || !Number.isFinite(month)) return null;
  return { year, month };
});

watch(
  currentYearMonth,
  (ym) => {
    if (!ym) return;
    selectedYear.value = ym.year;
    selectedMonth.value = ym.month;
  },
  { immediate: true },
);

const availableYears = computed(() => {
  const currentYear =
    currentYearMonth.value?.year || new Date().getFullYear();
  let minYear = currentYear - 10;
  let maxYear = currentYear + 1;

  for (const month of props.monthOptions || []) {
    const [y] = month.split("-");
    const year = Number(y);
    if (!Number.isFinite(year)) continue;
    minYear = Math.min(minYear, year);
    maxYear = Math.max(maxYear, year);
  }

  const years: number[] = [];
  for (let year = maxYear; year >= minYear; year--) {
    years.push(year);
  }
  return years;
});

const allMonths = computed(() => monthNames.map((_, idx) => idx + 1));

const emitSelectedMonth = () => {
  if (!selectedYear.value || !selectedMonth.value) return;
  const mm = String(selectedMonth.value).padStart(2, "0");
  emit("setMonth", `${selectedYear.value}-${mm}`);
};

const handleYearChange = () => {
  if (!selectedYear.value) return;
  if (!selectedMonth.value) selectedMonth.value = 1;
  emitSelectedMonth();
};

const formatDate = (dateStr: string) => {
  return new Date(dateStr).toLocaleDateString("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
};

</script>

<template>
  <div class="mb-8">
    <!-- Label row -->
    <div class="flex items-baseline gap-2 mb-1">
      <p class="text-sm text-muted-foreground">{{ label }}</p>
      <Loader2
        v-if="isLoading"
        class="h-3 w-3 animate-spin text-muted-foreground/50"
      />
    </div>

    <!-- Amount display -->
    <div
      v-if="!hideTotals"
      :class="isLoading ? 'opacity-40' : 'opacity-100'"
      class="transition-opacity duration-300"
    >
      <MultiCurrencyTotal :totals="totals" size="lg" />
    </div>

    <!-- Secondary info row -->
    <div class="flex items-center gap-2 mt-2">
      <!-- Month navigation for monthly views -->
      <template v-if="showMonthNav">
        <button
          @click="emit('prevMonth')"
          class="p-0.5 hover:bg-accent rounded transition-colors"
        >
          <ChevronLeft class="h-4 w-4 text-muted-foreground" />
        </button>
        <select
          v-if="selectedMonth !== null"
          :value="selectedMonth"
          @change="
            selectedMonth = Number(($event.target as HTMLSelectElement).value);
            emitSelectedMonth();
          "
          class="h-7 px-2 text-xs border rounded bg-background text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary"
        >
          <option
            v-for="month in allMonths"
            :key="month"
            :value="month"
          >
            {{ monthNames[month - 1] }}
          </option>
        </select>
        <select
          v-if="selectedYear !== null"
          :value="selectedYear"
          @change="
            selectedYear = Number(($event.target as HTMLSelectElement).value);
            handleYearChange();
          "
          class="h-7 px-2 text-xs border rounded bg-background text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary"
        >
          <option v-for="year in availableYears" :key="year" :value="year">
            {{ year }}
          </option>
        </select>
        <button
          @click="emit('nextMonth')"
          class="p-0.5 hover:bg-accent rounded transition-colors"
        >
          <ChevronRight class="h-4 w-4 text-muted-foreground" />
        </button>
      </template>

      <!-- As-on date for balance views -->
      <p v-else-if="asOnDate" class="text-xs text-muted-foreground">
        as on {{ formatDate(asOnDate) }}
      </p>
    </div>
  </div>
</template>
