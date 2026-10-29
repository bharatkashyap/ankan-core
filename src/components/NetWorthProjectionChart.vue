<script setup lang="ts">
import { computed } from "vue";
import {
  VisXYContainer,
  VisLine,
  VisAxis,
  VisScatter,
  VisTooltip,
  VisScatterSelectors,
} from "@unovis/vue";
import { CurveType } from "@unovis/ts";

type CurrencyCode = "INR" | "USD" | "THB";
type SeriesPoint = { month: string; value: number };
type ChartSeries = {
  currency: CurrencyCode;
  actual: SeriesPoint[];
  projected: SeriesPoint[];
};
type Segment = "actual" | "projection";
type ChartPoint = {
  x: number;
  y: number;
  month: string;
  currency: CurrencyCode;
  segment: Segment;
};

const props = withDefaults(
  defineProps<{
    series: ChartSeries[];
    height?: number;
  }>(),
  { height: 96 },
);

const colorByCurrency: Record<CurrencyCode, string> = {
  INR: "hsl(220, 15%, 18%)",
  USD: "hsl(210, 70%, 45%)",
  THB: "hsl(145, 35%, 40%)",
};

const symbolByCurrency: Record<CurrencyCode, string> = {
  INR: "₹",
  USD: "$",
  THB: "฿",
};

const localeByCurrency: Record<CurrencyCode, string> = {
  INR: "en-IN",
  USD: "en-US",
  THB: "th-TH",
};

const allMonths = computed(() => {
  const set = new Set<string>();
  for (const row of props.series) {
    for (const point of row.actual) set.add(point.month);
    for (const point of row.projected) set.add(point.month);
  }
  return Array.from(set).sort((a, b) => a.localeCompare(b));
});

const monthIndex = computed(() => {
  const map = new Map<string, number>();
  allMonths.value.forEach((month, idx) => map.set(month, idx));
  return map;
});

const withMonthIndex = (
  points: SeriesPoint[],
  currency: CurrencyCode,
  segment: Segment,
): ChartPoint[] =>
  points
    .map((row) => {
      const x = monthIndex.value.get(row.month);
      if (x === undefined) return null;
      return {
        x,
        y: row.value,
        month: row.month,
        currency,
        segment,
      };
    })
    .filter((point): point is ChartPoint => point !== null)
    .sort((a, b) => a.x - b.x);

const renderSeries = computed(() =>
  props.series
    .map((row) => {
      const actual = withMonthIndex(row.actual, row.currency, "actual");
      const lastActual = row.actual[row.actual.length - 1];
      const projectedSource =
        row.projected.length > 0 && lastActual
          ? [{ month: lastActual.month, value: lastActual.value }, ...row.projected]
          : [];
      const projectedRaw = withMonthIndex(projectedSource, row.currency, "projection");
      const lastActualX = actual[actual.length - 1]?.x ?? -1;
      const projected = projectedRaw.filter((point) => point.x >= lastActualX);
      return {
        currency: row.currency,
        actual,
        projected,
      };
    })
    .filter((row) => row.actual.length > 0 || row.projected.length > 0),
);

const x = (d: { x: number }) => d.x;
const y = (d: { y: number }) => d.y;
const projectionDash = () => [7, 5];

const formatMonth = (monthStr: string) => {
  const [year, month] = monthStr.split("-");
  const d = new Date(parseInt(year!, 10), parseInt(month!, 10) - 1, 1);
  return d.toLocaleDateString("en-IN", { month: "short", year: "2-digit" });
};

const tickValues = computed(() => {
  const count = allMonths.value.length;
  if (count <= 1) return [0];
  const lastActualIndex = renderSeries.value
    .map((row) => row.actual[row.actual.length - 1]?.x)
    .filter((value): value is number => value !== undefined)
    .sort((a, b) => a - b)
    .at(-1);

  const idx = [0, lastActualIndex ?? 0, count - 1];
  return Array.from(new Set(idx));
});

const tickFormat = (value: number) => {
  const month = allMonths.value[value];
  if (!month) return "";
  return formatMonth(month);
};

const yTickFormat = (value: number) => {
  const abs = Math.abs(value);
  const sign = value < 0 ? "-" : "";
  if (abs >= 1_000_000)
    return `${sign}${(abs / 1_000_000)
      .toFixed(abs >= 10_000_000 ? 0 : 1)
      .replace(/\.0$/, "")}m`;
  if (abs >= 1_000) return `${sign}${Math.round(abs / 1_000)}k`;
  return `${sign}${Math.round(abs)}`;
};

const tooltipTriggers = {
  [VisScatterSelectors.point]: (d: {
    month: string;
    y: number;
    currency?: CurrencyCode;
    segment?: Segment;
  }) => {
    const currency = d.currency || "INR";
    const symbol = symbolByCurrency[currency];
    const locale = localeByCurrency[currency];
    const segmentLabel = d.segment === "projection" ? "Projection" : "Actual";
    return `<div class="text-[11px] text-foreground">
      <div class="font-medium">${formatMonth(d.month)} · ${currency} ${segmentLabel}</div>
      <div>${symbol}${Math.round(d.y).toLocaleString(locale)}</div>
    </div>`;
  },
};
</script>

<template>
  <div class="w-full">
    <VisXYContainer
      :height="height"
      :margin="{ top: 8, right: 8, bottom: 18, left: 36 }"
    >
      <template v-for="row in renderSeries" :key="row.currency">
        <VisLine
          :data="row.actual"
          :x="x"
          :y="y"
          :color="colorByCurrency[row.currency]"
          :lineWidth="2"
          :curveType="CurveType.Linear"
        />
        <VisScatter
          :data="row.actual"
          :x="x"
          :y="y"
          :size="3"
          :color="colorByCurrency[row.currency]"
        />

        <VisLine
          v-if="row.projected.length > 1"
          :data="row.projected"
          :x="x"
          :y="y"
          :color="colorByCurrency[row.currency]"
          :lineWidth="2"
          :curveType="CurveType.Linear"
          :lineDashArray="projectionDash"
          :attributes="{ class: 'projection-line' }"
        />
        <VisScatter
          v-if="row.projected.length > 1"
          :data="row.projected"
          :x="x"
          :y="y"
          :size="3"
          :color="colorByCurrency[row.currency]"
        />
      </template>

      <VisAxis
        type="x"
        :tickValues="tickValues"
        :tickFormat="tickFormat"
        :tickTextColor="'hsl(215 16% 65%)'"
        :tickTextFontSize="9"
        :tickLine="false"
        :domainLine="false"
      />
      <VisAxis
        type="y"
        :tickFormat="yTickFormat"
        :tickTextColor="'hsl(215 16% 65%)'"
        :tickTextFontSize="9"
        :tickLine="false"
        :domainLine="false"
      />
      <VisTooltip :triggers="tooltipTriggers" />
    </VisXYContainer>
  </div>
</template>

<style scoped>
:deep([data-vis-xy-container]) {
  background: transparent !important;
}

:deep(.projection-line path) {
  stroke-dasharray: 7 5 !important;
}
</style>
