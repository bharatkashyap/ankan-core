<script setup lang="ts">
import { computed } from "vue";
import { formatCurrency, type CurrencyTotals } from "@/lib/currency";

interface Props {
  totals: Partial<CurrencyTotals>;
  size?: "lg" | "md" | "sm";
}

const props = withDefaults(defineProps<Props>(), {
  size: "lg",
});

// Filter currencies that have positive values
const activeCurrencies = computed(() => {
  const result: Array<{ code: "INR" | "USD" | "THB"; amount: number }> = [];

  // Always check in order: INR, USD, THB
  if (props.totals.INR && props.totals.INR > 0) {
    result.push({ code: "INR", amount: props.totals.INR });
  }
  if (props.totals.USD && props.totals.USD > 0) {
    result.push({ code: "USD", amount: props.totals.USD });
  }
  if (props.totals.THB && props.totals.THB > 0) {
    result.push({ code: "THB", amount: props.totals.THB });
  }

  return result;
});

const hasAnyValue = computed(() => activeCurrencies.value.length > 0);

// Size classes
const sizeClasses = computed(() => {
  switch (props.size) {
    case "lg":
      return "text-3xl";
    case "md":
      return "text-xl";
    case "sm":
      return "text-base";
  }
});
</script>

<template>
  <span
    class="inline-flex items-baseline gap-1.5 flex-wrap font-semibold tabular-nums"
    :class="sizeClasses"
  >
    <!-- Show all active currencies with + separator -->
    <template v-if="hasAnyValue">
      <template v-for="(curr, idx) in activeCurrencies" :key="curr.code">
        <span v-if="idx > 0" class="opacity-50">+</span>
        <span>{{ formatCurrency(curr.amount, curr.code) }}</span>
      </template>
    </template>

    <!-- Fallback when no values -->
    <span v-else class="text-muted-foreground">₹0</span>
  </span>
</template>
