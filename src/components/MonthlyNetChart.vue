<script setup lang="ts">
/**
 * MonthlyNetChart - bar chart for income minus expense by month.
 */
import { computed } from "vue";
import {
  VisXYContainer,
  VisLine,
  VisScatter,
  VisAxis,
  VisPlotline,
  VisTooltip,
  VisScatterSelectors,
} from "@unovis/vue";

const props = withDefaults(
  defineProps<{
    data: Array<{
      month: string;
      value: number;
      income?: number;
      expense?: number;
      currencyLabel?: string;
    }>;
    height?: number;
    average?: number | null;
  }>(),
  { height: 72 },
);

const formatMonth = (monthStr: string) => {
  const [year, month] = monthStr.split("-");
  const d = new Date(parseInt(year!), parseInt(month!) - 1, 1);
  return d.toLocaleDateString("en-IN", { month: "short", year: "2-digit" });
};

const chartData = computed(() =>
  props.data.map((row, index) => ({
    x: index,
    y: row.value,
    month: row.month,
    currencyLabel: row.currencyLabel,
    income: row.income ?? null,
    expense: row.expense ?? null,
  })),
);


const x = (d: { x: number }) => d.x;
const y = (d: { y: number }) => d.y;
const pointColor = (d: { y: number }) =>
  d.y >= 0 ? "hsl(142, 76%, 36%)" : "hsl(0, 84%, 60%)";

const formatCurrency = (value: number) => {
  return `${Math.abs(value).toLocaleString("en-IN", { maximumFractionDigits: 0 })}`;
};

const formatCompact = (value: number) => {
  const abs = Math.abs(value);
  const sign = value < 0 ? "−" : "";
  if (abs >= 1_000_000) {
    const val = abs / 1_000_000;
    const text = val >= 10 ? Math.round(val).toString() : val.toFixed(1).replace(/\.0$/, "");
    return `${sign}${text}m`;
  }
  if (abs >= 1_000) {
    const text = Math.round(abs / 1_000);
    return `${sign}${text}k`;
  }
  return `${sign}${Math.round(abs)}`;
};

const tickValues = computed(() => {
  const count = props.data.length;
  if (count <= 2) return props.data.map((_, index) => index);
  return [0, Math.floor((count - 1) / 2), count - 1];
});

const tickFormat = (value: number) => {
  const row = props.data[value];
  if (!row) return "";
  return formatMonth(row.month);
};

const tooltipTriggers = {
  [VisScatterSelectors.point]: (d: {
    y: number;
    month: string;
    income?: number | null;
    expense?: number | null;
    currencyLabel?: string;
  }) => {
    const amount = formatCurrency(d.y);
    const income = d.income !== null ? formatCurrency(d.income) : null;
    const expense = d.expense !== null ? formatCurrency(d.expense) : null;
    const label = d.currencyLabel ? ` ${d.currencyLabel}` : "";
    return `<div class="text-[10px] text-foreground">
      <div class="font-medium">${formatMonth(d.month)}</div>
      <div>${d.y >= 0 ? "+" : "−"}${amount}${label}</div>
      ${income ? `<div class="text-[9px] text-muted-foreground">Income ${income}${label}</div>` : ""}
      ${expense ? `<div class="text-[9px] text-muted-foreground">Spent ${expense}${label}</div>` : ""}
    </div>`;
  },
};
</script>

<template>
  <div class="w-full">
    <VisXYContainer
      :data="chartData"
      :height="height"
      :margin="{ top: 8, right: 8, bottom: 20, left: 36 }"
    >
      <VisPlotline
        v-if="average !== null && average !== undefined"
        :axis="'y'"
        :value="average"
        :lineStyle="[4, 4]"
        :lineWidth="1"
        :color="'hsl(220, 12%, 70%)'"
        :labelText="'Avg'"
        :labelSize="9"
        :labelColor="'hsl(220, 12%, 70%)'"
        :labelOffsetX="6"
      />
      <VisPlotline
        :axis="'y'"
        :value="0"
        :lineStyle="[2, 3]"
        :lineWidth="1"
        :color="'hsl(220, 12%, 75%)'"
      />
      <VisLine :x="x" :y="y" :color="'hsl(220, 12%, 45%)'" :lineWidth="2" />
      <VisScatter :x="x" :y="y" :size="5" :color="pointColor" />
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
        :tickFormat="formatCompact"
        :tickTextColor="'hsl(215 16% 65%)'"
        :tickTextFontSize="9"
        :tickLine="false"
        :domainLine="false"
      />
      <VisTooltip
        :triggers="tooltipTriggers"
        :followCursor="false"
        :className="'ankan-chart-tooltip'"
        :verticalPlacement="'center'"
        :horizontalPlacement="'right'"
        :horizontalShift="12"
      />
    </VisXYContainer>
  </div>
</template>

<style scoped>
:deep([data-vis-xy-container]) {
  background: transparent !important;
}
:deep(.ankan-chart-tooltip) {
  padding: 6px 8px;
  border-radius: 8px;
  background: hsl(0 0% 100% / 0.92);
  color: hsl(220 14% 10%);
  box-shadow: 0 6px 20px rgba(15, 23, 42, 0.15);
  font-size: 10px;
  pointer-events: none;
  max-width: 140px;
}
</style>
