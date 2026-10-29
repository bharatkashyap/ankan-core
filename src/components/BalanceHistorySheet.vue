<script setup lang="ts">
import { ref, computed, watch } from "vue";
import { getConvexClient, api, type Id } from "@/composables/useConvex";
import { toast } from "vue-sonner";
import { ChevronDown, Loader2, Trash2 } from "lucide-vue-next";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";

interface Account {
  _id: Id<"accounts">;
  name: string;
  category?: "asset" | "liability";
  type?: string;
  currency: string;
}

interface BalanceRecord {
  _id: Id<"balanceHistory">;
  amount: number;
  date: string;
  note?: string;
}

const props = defineProps<{
  open: boolean;
  account: Account | null;
  typeOptions?: readonly string[];
  typeLabel?: string;
}>();

const emit = defineEmits<{
  (e: "update:open", value: boolean): void;
  (e: "balanceAdded"): void;
  (e: "balanceDeleted", recordId: Id<"balanceHistory">): void;
  (e: "accountDeleted", accountId: Id<"accounts">): void;
}>();

// Local state
const historyData = ref<BalanceRecord[]>([]);
const newBalanceInput = ref("");
const newBalanceDate = ref<string>(
  new Date().toISOString().split("T")[0] ?? "",
);
const isSaving = ref(false);
const accountName = ref("");
const accountType = ref("");
const isSavingAccountMeta = ref(false);
const isDeletingAccount = ref(false);
const isDeleteDialogOpen = ref(false);
const expandedMonths = ref<Set<string>>(new Set());
const isLoading = ref(false);
const deletingRecordId = ref<Id<"balanceHistory"> | null>(null);
const isDeleteEntryDialogOpen = ref(false);
const pendingDeleteRecord = ref<BalanceRecord | null>(null);

const hasAccountMetaChanges = computed(() => {
  if (!props.account) return false;
  const trimmed = accountName.value.trim();
  if (!trimmed) return false;
  return (
    trimmed !== props.account.name ||
    accountType.value !== (props.account.type || "")
  );
});

// Load history when account changes
watch(
  () => [props.open, props.account] as const,
  async ([open, account]) => {
    if (open && account) {
      isLoading.value = true;
      expandedMonths.value = new Set();
      accountName.value = account.name;
      accountType.value = account.type || "";
      try {
        const client = getConvexClient();
        const history = await client.query(api.accounts.getBalanceHistory, {
          accountId: account._id,
          limit: 100,
        });
        historyData.value = history || [];
        // Expand current month by default
        if (history && history.length > 0 && history[0]) {
          expandedMonths.value.add(history[0].date.substring(0, 7));
        }
      } finally {
        isLoading.value = false;
      }
    }
  },
  { immediate: true },
);

// Group history by month
const groupedHistory = computed(() => {
  const groups: Record<string, BalanceRecord[]> = {};
  for (const record of historyData.value) {
    const monthKey = record.date.substring(0, 7); // YYYY-MM
    if (!groups[monthKey]) groups[monthKey] = [];
    groups[monthKey].push(record);
  }
  return groups;
});

const sortedHistoryMonths = computed(() => {
  return Object.keys(groupedHistory.value).sort().reverse();
});

const toggleMonth = (monthKey: string) => {
  if (expandedMonths.value.has(monthKey)) {
    expandedMonths.value.delete(monthKey);
  } else {
    expandedMonths.value.add(monthKey);
  }
  expandedMonths.value = new Set(expandedMonths.value);
};

const formatMonthYear = (monthKey: string) => {
  const parts = monthKey.split("-");
  const year = parts[0] || "2000";
  const month = parts[1] || "01";
  return new Date(parseInt(year), parseInt(month) - 1).toLocaleDateString(
    "en-IN",
    { month: "short", year: "numeric" },
  );
};

const formatDateShort = (dateStr: string) => {
  const date = new Date(dateStr);
  return date.toLocaleDateString("en-IN", { day: "numeric", month: "short" });
};

const formatCurrency = (amount: number, currency?: string) => {
  const curr = currency || "INR";
  const symbol = curr === "INR" ? "₹" : curr === "USD" ? "$" : "฿";
  return `${symbol}${amount.toLocaleString("en-IN")}`;
};

const closeSheet = () => {
  emit("update:open", false);
  historyData.value = [];
  newBalanceInput.value = "";
  newBalanceDate.value = new Date().toISOString().split("T")[0] ?? "";
};

const saveNewBalance = async () => {
  if (!props.account || !newBalanceInput.value.trim()) return;
  const amount = parseFloat(newBalanceInput.value.replace(/,/g, ""));
  if (isNaN(amount)) return;

  isSaving.value = true;
  try {
    const client = getConvexClient();
    await client.mutation(api.accounts.addBalance, {
      accountId: props.account._id,
      amount,
      date: newBalanceDate.value,
    });
    // Reload history
    historyData.value =
      (await client.query(api.accounts.getBalanceHistory, {
        accountId: props.account._id,
        limit: 100,
      })) || [];
    newBalanceInput.value = "";
    // Expand the month we just added to
    expandedMonths.value.add(newBalanceDate.value.substring(0, 7));
    emit("balanceAdded");
  } finally {
    isSaving.value = false;
  }
};

const saveAccountMeta = async () => {
  if (!props.account || !hasAccountMetaChanges.value) return;
  const trimmed = accountName.value.trim();
  if (!trimmed) return;

  isSavingAccountMeta.value = true;
  try {
    const client = getConvexClient();
    await client.mutation(api.accounts.update, {
      accountId: props.account._id,
      name: trimmed,
      type: accountType.value || undefined,
    });
  } finally {
    isSavingAccountMeta.value = false;
  }
};

const handleDeleteRecord = async (recordId: Id<"balanceHistory">) => {
  if (deletingRecordId.value === recordId) return;

  deletingRecordId.value = recordId;
  try {
    const deletedRecord = historyData.value.find((r) => r._id === recordId);
    const client = getConvexClient();
    await client.mutation(api.accounts.deleteBalance, { recordId });
    historyData.value = historyData.value.filter((r) => r._id !== recordId);
    emit("balanceDeleted", recordId);
    toast.success("Balance entry deleted.", {
      description: deletedRecord
        ? `${formatCurrency(deletedRecord.amount, props.account?.currency)} on ${formatDateShort(deletedRecord.date)} removed.`
        : "Entry removed from history.",
    });
  } catch (error) {
    toast.error(
      error instanceof Error ? error.message : "Could not delete balance entry.",
    );
    throw error;
  } finally {
    deletingRecordId.value = null;
  }
};

const openDeleteEntryDialog = (record: BalanceRecord) => {
  pendingDeleteRecord.value = record;
  isDeleteEntryDialogOpen.value = true;
};

const confirmDeleteEntry = async () => {
  const recordId = pendingDeleteRecord.value?._id;
  if (!recordId) return;
  await handleDeleteRecord(recordId);
  isDeleteEntryDialogOpen.value = false;
  pendingDeleteRecord.value = null;
};

const restoreDeletedAccount = async (
  accountId: Id<"accounts">,
  accountName: string,
) => {
  try {
    const client = getConvexClient();
    await client.mutation(api.accounts.update, {
      accountId,
      isActive: true,
    });
    toast.success(`Restored "${accountName}".`);
  } catch (error) {
    toast.error(
      error instanceof Error ? error.message : "Could not restore account.",
    );
  }
};

const openDeleteDialog = () => {
  isDeleteDialogOpen.value = true;
};

const handleDeleteAccount = async () => {
  if (!props.account || isDeletingAccount.value) return;

  isDeletingAccount.value = true;
  try {
    const client = getConvexClient();
    const deletedId = props.account._id;
    const deletedName = props.account.name;
    await client.mutation(api.accounts.deactivate, {
      accountId: deletedId,
    });
    emit("accountDeleted", deletedId);
    isDeleteDialogOpen.value = false;
    closeSheet();
    toast.success(`"${deletedName}" deleted.`, {
      description: "Account removed from lists.",
      duration: 8000,
      action: {
        label: "Undo",
        onClick: () => {
          void restoreDeletedAccount(deletedId, deletedName);
        },
      },
    });
  } catch (error) {
    toast.error(
      error instanceof Error ? error.message : "Could not delete account.",
    );
  } finally {
    isDeletingAccount.value = false;
  }
};
</script>

<template>
  <Sheet :open="open" @update:open="(val) => !val && closeSheet()">
    <SheetContent
      class="w-full sm:w-[420px] sm:max-w-[420px] flex flex-col overflow-hidden"
    >
      <SheetHeader class="px-6 pb-4">
        <div class="flex items-start justify-between gap-3">
          <div>
            <SheetTitle class="text-lg">{{ accountName || account?.name }}</SheetTitle>
            <SheetDescription class="text-sm">
              {{ account?.type || "Other" }} · {{ account?.currency }}
            </SheetDescription>
          </div>
        </div>

      </SheetHeader>

      <div class="px-6 pb-4 mb-4 border-b">
        <p
          class="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-3"
        >
          Account details
        </p>
        <div class="space-y-2">
          <input
            v-model="accountName"
            type="text"
            placeholder="Account name"
            class="w-full bg-transparent text-sm placeholder:text-muted-foreground/50 focus:outline-none py-2 px-3 border rounded"
            @keyup.enter="saveAccountMeta"
          />
          <div class="flex items-center gap-2">
            <template v-if="(props.typeOptions?.length || 0) > 0">
              <select
                v-model="accountType"
                class="w-full bg-transparent text-sm focus:outline-none py-2 px-3 border rounded"
              >
                <option
                  v-for="option in props.typeOptions"
                  :key="option"
                  :value="option"
                >
                  {{ option }}
                </option>
              </select>
            </template>
            <template v-else>
              <input
                v-model="accountType"
                type="text"
                :placeholder="props.typeLabel || 'Category'"
                class="w-full bg-transparent text-sm placeholder:text-muted-foreground/50 focus:outline-none py-2 px-3 border rounded"
                @keyup.enter="saveAccountMeta"
              />
            </template>
            <button
              @click="saveAccountMeta"
              :disabled="isSavingAccountMeta || !hasAccountMetaChanges"
              class="text-sm bg-foreground text-background px-4 py-2 rounded hover:opacity-90 disabled:opacity-30"
            >
              <Loader2 v-if="isSavingAccountMeta" class="h-4 w-4 animate-spin" />
              <span v-else>Save</span>
            </button>
          </div>
        </div>
      </div>

      <!-- Add balance at top -->
      <div class="px-6 pb-4 mb-4 border-b">
        <p
          class="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-3"
        >
          Add Entry
        </p>
        <div class="flex items-center gap-2">
          <input
            v-model="newBalanceDate"
            type="date"
            class="bg-transparent text-sm focus:outline-none py-2 px-3 border rounded flex-shrink-0"
          />
          <input
            v-model="newBalanceInput"
            type="text"
            placeholder="Amount"
            class="flex-1 min-w-0 bg-transparent text-right tabular-nums placeholder:text-muted-foreground/50 focus:outline-none py-2 px-3 border rounded"
            @keyup.enter="saveNewBalance"
          />
          <button
            @click="saveNewBalance"
            :disabled="isSaving || !newBalanceInput.trim()"
            class="text-sm bg-foreground text-background px-4 py-2 rounded hover:opacity-90 disabled:opacity-30"
          >
            <Loader2 v-if="isSaving" class="h-4 w-4 animate-spin" />
            <span v-else>Add</span>
          </button>
        </div>
      </div>

      <div class="flex-1 overflow-y-auto px-6 scrollbar-thin">
        <p
          class="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-3"
        >
          History
        </p>

        <div v-if="isLoading" class="flex items-center justify-center py-8">
          <Loader2 class="h-5 w-5 animate-spin text-muted-foreground" />
        </div>

        <div
          v-else-if="historyData.length === 0"
          class="text-center py-8 text-muted-foreground text-sm"
        >
          No history yet
        </div>

        <div v-else class="space-y-2">
          <div
            v-for="monthKey in sortedHistoryMonths"
            :key="monthKey"
            class="border rounded-lg overflow-hidden"
          >
            <!-- Month header -->
            <button
              @click="toggleMonth(monthKey)"
              class="w-full flex items-center justify-between px-3 py-2 bg-accent/30 hover:bg-accent/50 transition-colors"
            >
              <span class="text-sm font-medium">{{
                formatMonthYear(monthKey)
              }}</span>
              <div class="flex items-center gap-2">
                <span class="text-sm tabular-nums text-muted-foreground">
                  {{ groupedHistory[monthKey]?.length ?? 0 }} entries
                </span>
                <ChevronDown
                  class="h-4 w-4 text-muted-foreground transition-transform"
                  :class="{ '-rotate-180': expandedMonths.has(monthKey) }"
                />
              </div>
            </button>

            <!-- Entries -->
            <div v-if="expandedMonths.has(monthKey)" class="divide-y">
              <div
                v-for="record in groupedHistory[monthKey]"
                :key="record._id"
                class="flex items-center justify-between px-4 py-3 group hover:bg-accent/20"
              >
                <div>
                  <span class="text-sm text-muted-foreground">{{
                    formatDateShort(record.date)
                  }}</span>
                  <p
                    v-if="record.note"
                    class="text-xs text-muted-foreground/70 mt-0.5"
                  >
                    {{ record.note }}
                  </p>
                </div>
                <div class="flex items-center gap-3">
                  <span class="tabular-nums font-medium">{{
                    formatCurrency(record.amount, account?.currency)
                  }}</span>
                  <button
                    @click="openDeleteEntryDialog(record)"
                    :disabled="deletingRecordId === record._id"
                    class="inline-flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground/40 hover:bg-destructive/10 hover:text-destructive disabled:opacity-50 transition-colors"
                    aria-label="Delete balance entry"
                  >
                    <Loader2
                      v-if="deletingRecordId === record._id"
                      class="h-3 w-3 animate-spin"
                    />
                    <Trash2 v-else class="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div class="p-6 mt-auto flex justify-center">
        <button
          type="button"
          @click="openDeleteDialog"
          :disabled="isDeletingAccount"
          class="inline-flex items-center justify-center gap-2 rounded-lg border border-input bg-background px-4 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-destructive/5 hover:text-destructive hover:border-destructive/30 disabled:opacity-50 shadow-sm"
          aria-label="Delete account"
        >
          <Loader2 v-if="isDeletingAccount" class="h-4 w-4 animate-spin" />
          <template v-else>
            <Trash2 class="h-4 w-4" />
            Delete
          </template>
        </button>
      </div>
    </SheetContent>
  </Sheet>

  <Dialog :open="isDeleteDialogOpen" @update:open="(v) => (isDeleteDialogOpen = v)">
    <DialogContent class="sm:max-w-md">
      <DialogHeader>
        <DialogTitle>Delete this account?</DialogTitle>
        <DialogDescription>
          Remove <span class="font-medium text-foreground">{{ accountName || account?.name }}</span> from your list.
        </DialogDescription>
      </DialogHeader>
      <DialogFooter>
        <button
          type="button"
          class="inline-flex h-9 items-center justify-center rounded-md border px-4 text-sm font-medium hover:bg-accent"
          @click="isDeleteDialogOpen = false"
          :disabled="isDeletingAccount"
        >
          Cancel
        </button>
        <button
          type="button"
          class="inline-flex h-9 items-center justify-center rounded-md bg-destructive px-4 text-sm font-medium text-white hover:bg-destructive/90 disabled:opacity-50"
          @click="handleDeleteAccount"
          :disabled="isDeletingAccount"
        >
          <Loader2 v-if="isDeletingAccount" class="h-4 w-4 animate-spin" />
          <span v-else>Delete account</span>
        </button>
      </DialogFooter>
    </DialogContent>
  </Dialog>

  <Dialog
    :open="isDeleteEntryDialogOpen"
    @update:open="(v) => (isDeleteEntryDialogOpen = v)"
  >
    <DialogContent class="sm:max-w-md">
      <DialogHeader>
        <DialogTitle>Delete this entry?</DialogTitle>
        <DialogDescription>
          This balance entry will be permanently removed.
        </DialogDescription>
      </DialogHeader>
      <DialogFooter>
        <button
          type="button"
          class="inline-flex h-9 items-center justify-center rounded-md border px-4 text-sm font-medium hover:bg-accent"
          @click="isDeleteEntryDialogOpen = false"
          :disabled="deletingRecordId !== null"
        >
          Cancel
        </button>
        <button
          type="button"
          class="inline-flex h-9 items-center justify-center rounded-md bg-destructive px-4 text-sm font-medium text-white hover:bg-destructive/90 disabled:opacity-50"
          @click="confirmDeleteEntry"
          :disabled="deletingRecordId !== null"
        >
          <Loader2 v-if="deletingRecordId !== null" class="h-4 w-4 animate-spin" />
          <span v-else>Delete entry</span>
        </button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>
