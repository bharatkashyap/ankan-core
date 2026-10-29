<script setup lang="ts">
/**
 * NetWorthSparkline - A minimal but readable line chart
 * Shows net worth trend with start/end context and change indicator
 */
import { computed } from "vue";
import { VisXYContainer, VisLine } from "@unovis/vue";
import { CurveType } from "@unovis/ts";

const props = withDefaults(
  defineProps<{
    data: Array<{ date: string; netWorth: number }>;
    height?: number;
  }>(),
  {
    height: 64,
  }
);

// Transform data for unovis
const chartData = computed(() => {
  if (!props.data || props.data.length === 0) return [];
  return props.data.map((d, i) => ({
    x: i,
    y: d.netWorth,
    date: d.date,
  }));
});

// Summary stats
const startValue = computed(() => {
  if (!props.data || props.data.length === 0) return 0;
  return props.data[0]!.netWorth;
});

const endValue = computed(() => {
  if (!props.data || props.data.length === 0) return 0;
  return props.data[props.data.length - 1]!.netWorth;
});

const change = computed(() => endValue.value - startValue.value);
const changePercent = computed(() => {
  if (startValue.value === 0) return 0;
  return (change.value / startValue.value) * 100;
});

const isPositive = computed(() => change.value >= 0);

const formatCompact = (n: number) => {
  const absN = Math.abs(n);
  if (absN >= 10000000) return `${(n / 10000000).toFixed(1)}Cr`;
  if (absN >= 100000) return `${(n / 100000).toFixed(1)}L`;
  if (absN >= 1000) return `${(n / 1000).toFixed(0)}K`;
  return n.toFixed(0);
};

const startDate = computed(() => {
  if (!props.data || props.data.length === 0) return "";
  const d = new Date(props.data[0]!.date);
  return d.toLocaleDateString("en-IN", { month: "short", day: "numeric" });
});

const endDate = computed(() => {
  if (!props.data || props.data.length === 0) return "";
  const d = new Date(props.data[props.data.length - 1]!.date);
  return d.toLocaleDateString("en-IN", { month: "short", day: "numeric" });
});

// Accessors
const x = (d: { x: number }) => d.x;
const y = (d: { y: number }) => d.y;
</script>

<template>
  <div class="w-full">
    <!-- Date range header -->
    <div class="flex justify-between text-xs text-muted-foreground/60 mb-0.5 px-1">
      <span>{{ startDate }}</span>
      <span>{{ endDate }}</span>
    </div>

    <!-- Chart -->
    <div
      class="w-full overflow-hidden rounded"
      :style="{ height: `${height}px` }"
    >
      <VisXYContainer
        :data="chartData"
        :height="height"
        :margin="{ top: 8, right: 4, bottom: 8, left: 4 }"
      >
        <VisLine
          :x="x"
          :y="y"
          :color="isPositive ? 'hsl(142, 76%, 36%)' : 'hsl(0, 84%, 60%)'"
          :lineWidth="2"
          :curveType="CurveType.MonotoneX"
        />
      </VisXYContainer>
    </div>

    <!-- Change indicator -->
    <div class="flex justify-end text-xs mt-1 px-1">
      <span class="text-muted-foreground">
        {{ isPositive ? '↑' : '↓' }} ₹{{ formatCompact(Math.abs(change)) }}
        <span class="text-muted-foreground/60">
          ({{ isPositive ? '+' : '' }}{{ changePercent.toFixed(1) }}%)
        </span>
      </span>
    </div>
  </div>
</template>

<style scoped>
/* Override unovis default dark backgrounds */
:deep([data-vis-xy-container]) {
  background: transparent !important;
}
</style>
