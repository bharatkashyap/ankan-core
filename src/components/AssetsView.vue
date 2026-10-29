<script setup lang="ts">
import { ref, computed, nextTick } from "vue";
import { storeToRefs } from "pinia";
import { useAccounts } from "@/composables/useConvex";
import { useAuthStore } from "@/stores/auth";
import { ChevronRight, X } from "lucide-vue-next";
import PageHeader from "@/components/PageHeader.vue";
import BalanceHistorySheet from "@/components/BalanceHistorySheet.vue";

const auth = useAuthStore();
const { profileId: activeProfileId } = storeToRefs(auth);
const { assets, balances, balancesLoading, getBalance, createAccount, addBalance } =
  useAccounts();

const assetCategoryOptions = [
  "Savings",
  "Current",
  "Fixed Deposit",
  "PPF",
  "NPS",
  "Stocks",
  "Mutual Funds",
  "Debt Funds",
  "US Stocks",
  "Smallcase",
  "Gold",
  "Wallet",
  "Transport Card",
  "Cash",
  "Bank",
  "Other",
] as const;

// Totals by currency (no conversion)
const totalsByCurrency = computed(() => {
  const totals = { INR: 0, USD: 0, THB: 0 };
  for (const account of assets.value) {
    const currency = (account.currency || "INR") as keyof typeof totals;
    if (currency in totals) {
      totals[currency] += getBalance(account._id);
    }
  }
  return totals;
});

// Latest as-on date across all accounts
const latestAsOnDate = computed(() => {
  const dates = Object.values(balances.value)
    .map((b) => b.date)
    .filter(Boolean);
  if (!dates.length) return "";
  return dates.sort().reverse()[0];
});

// Group accounts by type
const groupedAssets = computed(() => {
  const groups: Record<string, typeof assets.value> = {};
  for (const account of assets.value) {
    const type = account.type || "Other";
    if (!groups[type]) groups[type] = [];
    groups[type]!.push(account);
  }
  // Sort groups: common types first
  const order = [
    "Savings",
    "Cash",
    "Fixed Deposit",
    "PPF",
    "NPS",
    "Stocks",
    "Mutual Funds",
    "Debt Funds",
    "US Stocks",
    "Smallcase",
    "Gold",
    "Wallet",
    "Transport Card",
    "Other",
  ];
  const sorted: Record<string, typeof assets.value> = {};
  for (const type of order) {
    if (groups[type]) sorted[type] = groups[type]!;
  }
  // Add any remaining groups
  for (const type of Object.keys(groups)) {
    if (!sorted[type]) sorted[type] = groups[type] ?? [];
  }
  return sorted;
});

// History Sheet (using shared component)
const isHistoryOpen = ref(false);
const selectedAccount = ref<any>(null);

const openHistory = (account: any) => {
  selectedAccount.value = account;
  isHistoryOpen.value = true;
};

// Inline add account
const showAddRow = ref(false);
const newAccount = ref({
  name: "",
  type: "Savings",
  currency: "INR",
  openingAmount: "",
});
const addAccountInputRef = ref<HTMLInputElement | null>(null);

const toggleAddRow = async () => {
  showAddRow.value = !showAddRow.value;
  if (showAddRow.value) {
    await nextTick();
    addAccountInputRef.value?.focus();
  }
};

const submitNewAccount = async () => {
  if (!newAccount.value.name.trim() || !activeProfileId.value) return;
  const accountId = await createAccount({
    profileId: activeProfileId.value,
    name: newAccount.value.name.trim(),
    category: "asset",
    type: newAccount.value.type || undefined,
    currency: newAccount.value.currency,
    displayOrder: assets.value.length,
  });

  const openingAmountRaw = newAccount.value.openingAmount.trim();
  if (openingAmountRaw) {
    const openingAmount = Number(openingAmountRaw.replace(/,/g, ""));
    if (Number.isFinite(openingAmount)) {
      const today = new Date().toISOString().split("T")[0];
      if (today) {
        await addBalance({
          accountId,
          amount: openingAmount,
          date: today,
          note: "Opening balance",
        });
      }
    }
  }

  newAccount.value = {
    name: "",
    type: "Savings",
    currency: "INR",
    openingAmount: "",
  };
  showAddRow.value = false;
};

const formatCurrency = (amount: number, currency = "INR") => {
  if (currency === "THB")
    return new Intl.NumberFormat("th-TH", {
      style: "currency",
      currency: "THB",
      maximumFractionDigits: 0,
    }).format(amount);
  if (currency === "USD")
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD",
      maximumFractionDigits: 0,
    }).format(amount);
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0,
  }).format(amount);
};
</script>

<template>
  <div class="max-w-3xl">
    <PageHeader
      label="Total Assets"
      :totals="totalsByCurrency"
      :as-on-date="latestAsOnDate"
      :is-loading="balancesLoading"
    />

    <!-- Add button at top -->
    <button
      v-if="!showAddRow"
      @click="toggleAddRow"
      class="mb-6 text-sm text-muted-foreground hover:text-foreground transition-colors"
    >
      + Add account
    </button>

    <!-- Add row at top -->
    <div v-if="showAddRow" class="mb-6 p-4 border rounded-lg bg-accent/30">
      <p class="text-sm font-medium mb-3">New Account</p>
      <div class="flex flex-wrap items-center gap-3">
        <input
          ref="addAccountInputRef"
          v-model="newAccount.name"
          type="text"
          placeholder="Account name"
          @keydown.enter="submitNewAccount"
          @keydown.escape="showAddRow = false"
          class="flex-1 bg-transparent placeholder:text-muted-foreground/50 focus:outline-none text-sm py-2 px-3 border rounded"
        />
        <select
          v-model="newAccount.type"
          class="w-40 bg-transparent text-sm focus:outline-none py-2 px-3 border rounded"
        >
          <option
            v-for="option in assetCategoryOptions"
            :key="option"
            :value="option"
          >
            {{ option }}
          </option>
        </select>
        <input
          v-model="newAccount.openingAmount"
          type="text"
          placeholder="Opening amount"
          @keydown.enter="submitNewAccount"
          class="w-40 bg-transparent text-sm tabular-nums text-right placeholder:text-muted-foreground/50 focus:outline-none py-2 px-3 border rounded"
        />
        <select
          v-model="newAccount.currency"
          class="bg-transparent text-sm focus:outline-none py-2 px-3 border rounded"
        >
          <option value="INR">INR</option>
          <option value="USD">USD</option>
          <option value="THB">THB</option>
        </select>
        <button
          @click="submitNewAccount"
          class="text-sm bg-foreground text-background px-4 py-2 rounded hover:opacity-90"
        >
          Add
        </button>
        <button
          @click="showAddRow = false"
          class="text-muted-foreground hover:text-foreground p-2"
        >
          <X class="h-4 w-4" />
        </button>
      </div>
    </div>

    <!-- Grouped Accounts List -->
    <div class="space-y-6">
      <div v-for="(accounts, type) in groupedAssets" :key="type">
        <p
          class="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-2"
        >
          {{ type }}
        </p>
        <div class="space-y-1">
          <div
            v-for="account in accounts"
            :key="account._id"
            @click="openHistory(account)"
            class="flex items-center justify-between py-3 px-3 -mx-3 rounded hover:bg-accent/50 cursor-pointer group transition-colors"
          >
            <span class="font-medium">{{ account.name }}</span>
            <div class="flex items-center gap-3">
              <span
                class="tabular-nums text-sm transition-opacity duration-300"
                :class="balancesLoading ? 'opacity-40' : 'opacity-100'"
              >
                {{ formatCurrency(getBalance(account._id), account.currency) }}
              </span>
              <ChevronRight
                class="h-4 w-4 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity"
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>

  <!-- History Sheet (shared component) -->
  <BalanceHistorySheet
    :open="isHistoryOpen"
    :account="selectedAccount"
    :type-options="assetCategoryOptions"
    type-label="Category"
    @update:open="isHistoryOpen = $event"
  />
</template>
