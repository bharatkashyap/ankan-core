<script setup lang="ts">
/**
 * InlineSparkline - A tiny sparkline for inline use with numbers
 */
import { computed } from "vue";
import { VisXYContainer, VisLine } from "@unovis/vue";
import { CurveType } from "@unovis/ts";

const props = withDefaults(
  defineProps<{
    data: number[];
    width?: number;
    height?: number;
    color?: string;
  }>(),
  {
    width: 80,
    height: 24,
    color: "hsl(var(--muted-foreground))",
  }
);

// Transform to x/y points
const chartData = computed(() => {
  if (!props.data || props.data.length === 0) return [];
  return props.data.map((y, x) => ({ x, y }));
});

// Trend color
const lineColor = computed(() => {
  if (props.data.length < 2) return props.color;
  const first = props.data[0]!;
  const last = props.data[props.data.length - 1]!;
  if (last > first) return "hsl(142, 76%, 36%)"; // green
  if (last < first) return "hsl(0, 84%, 60%)"; // red
  return props.color;
});

const x = (d: { x: number }) => d.x;
const y = (d: { y: number }) => d.y;
</script>

<template>
  <div
    class="inline-block align-middle overflow-hidden"
    :style="{ width: `${width}px`, height: `${height}px` }"
  >
    <VisXYContainer
      :data="chartData"
      :height="height"
      :margin="{ top: 2, right: 2, bottom: 2, left: 2 }"
    >
      <VisLine
        :x="x"
        :y="y"
        :color="lineColor"
        :lineWidth="1.5"
        :curveType="CurveType.MonotoneX"
      />
    </VisXYContainer>
  </div>
</template>

<style scoped>
:deep([data-vis-xy-container]) {
  background: transparent !important;
}
</style>
