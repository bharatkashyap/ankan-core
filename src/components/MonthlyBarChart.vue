<script setup lang="ts">
/**
 * MonthlyBarChart - Simple bar chart for monthly totals
 * Shows last 6 months with month labels and bars
 */
import { computed } from "vue";

const props = defineProps<{
  data: Array<{ month: string; total: number }>;
  height?: number;
}>();

const maxValue = computed(() => {
  if (!props.data || props.data.length === 0) return 0;
  return Math.max(...props.data.map(d => d.total), 1);
});

// Format month as "Jan", "Feb", etc.
const formatMonth = (monthStr: string) => {
  const [year, month] = monthStr.split("-");
  const d = new Date(parseInt(year!), parseInt(month!) - 1, 1);
  return d.toLocaleDateString("en-IN", { month: "short" });
};

// Format amount compact
const formatCompact = (n: number) => {
  if (n >= 10000000) return `${(n / 10000000).toFixed(1)}Cr`;
  if (n >= 100000) return `${(n / 100000).toFixed(0)}L`;
  if (n >= 1000) return `${(n / 1000).toFixed(0)}K`;
  return n.toFixed(0);
};
</script>

<template>
  <div class="w-full" :style="{ height: `${height || 48}px` }">
    <div class="flex items-end justify-between gap-1 h-full">
      <div
        v-for="item in data"
        :key="item.month"
        class="flex-1 flex flex-col items-center gap-0.5"
      >
        <!-- Bar -->
        <div
          class="w-full bg-muted-foreground/20 rounded-t transition-all"
          :style="{
            height: `${Math.max((item.total / maxValue) * 100, 4)}%`,
            minHeight: '2px',
          }"
        />
        <!-- Month label -->
        <span class="text-[9px] text-muted-foreground/60 leading-none">
          {{ formatMonth(item.month) }}
        </span>
      </div>
    </div>
  </div>
</template>
