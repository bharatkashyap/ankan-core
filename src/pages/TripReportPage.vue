<script setup lang="ts">
import { computed, nextTick, ref, watch, onUnmounted } from "vue";
import { useRoute } from "vue-router";
import { toast } from "vue-sonner";
import { ArrowRight, LockKeyhole, Pencil, Plus, Search, Share2, X } from "lucide-vue-next";
import { api, getConvexClient, useConvexAction, useConvexMutation, useConvexQuery } from "@/composables/useConvex";
import type { Id } from "@/composables/useConvex";
import { useAuthStore } from "@/stores/auth";

const route = useRoute();
const auth = useAuthStore();
const slug = computed(() => String(route.params.slug || ""));
const sessionKey = computed(() => `ankan-trip:${slug.value}`);
const accessToken = ref(sessionStorage.getItem(sessionKey.value) || "");
const guestCurrencyView = ref<boolean | null>(null);
const passcode = ref("");
const unlockError = ref("");
const { data: shell, isLoading: shellLoading } = useConvexQuery(api.tripReports.getShell, () => ({ slug: slug.value }));
const { data: report, isLoading: reportLoading } = useConvexQuery(api.tripReports.getReport, () => {
  // Wait for account restoration before deciding whether a passcode is needed.
  if (auth.state === "loading") return "skip";
  return { slug: slug.value, token: accessToken.value || undefined, viewSeparateCurrencies: guestCurrencyView.value ?? undefined };
});
const { run: unlock, isLoading: unlocking } = useConvexAction(api.tripReportActions.unlock);
const { run: submitGuest, isLoading: guestSubmitting } = useConvexAction(api.tripReportActions.submitGuestExpense);
const { run: addOwnerExpense, isLoading: ownerAdding } = useConvexAction(api.tripReportActions.addOwnerExpense);
const { run: getShareText, isLoading: sharing } = useConvexAction(api.tripReportActions.getShareText);
const { run: recordSettlement, isLoading: recordingPayment } = useConvexAction(api.tripReportActions.recordSettlement);
const { mutate: updateEntry } = useConvexMutation(api.tripReports.updateEntry);
const { mutate: updateReport } = useConvexMutation(api.tripReports.updateReport);
const { mutate: renameParticipant } = useConvexMutation(api.tripReports.renameParticipant);
const { mutate: removeParticipant } = useConvexMutation(api.tripReports.removeParticipant);
const { mutate: removeReportExpense } = useConvexMutation(api.tripReports.removeReportExpense);
const { mutate: removeSettlement } = useConvexMutation(api.tripReports.removeSettlement);

const ownerSearch = ref("");
const debouncedSearch = ref("");
const searchOpen = ref(false);
type SearchExpense = { id: Id<"expenseEntries">; date: string; note: string; amount: number; currency: string };
const searchResults = ref<SearchExpense[]>([]);
const searchCursor = ref<string | null>(null);
const searchDone = ref(false);
const searchBusy = ref(false);
const searchFailed = ref(false);
const addedExpenseIds = ref(new Set<string>());
const addingExpenseId = ref<string | null>(null);
let searchGeneration = 0;
let searchTimer: ReturnType<typeof setTimeout> | undefined;
watch(ownerSearch, (value) => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => { debouncedSearch.value = value.trim(); }, 300);
});
onUnmounted(() => { clearTimeout(searchTimer); searchGeneration++; });

async function loadMoreExpenses(generation = searchGeneration) {
  if (!report.value?.isOwner || !searchOpen.value || searchBusy.value || searchDone.value) return;
  const reportId = report.value.id;
  const search = debouncedSearch.value;
  searchBusy.value = true;
  searchFailed.value = false;
  try {
    let scannedPages = 0;
    let found = 0;
    do {
      const page = await getConvexClient().query(api.tripReports.searchOwnerExpenses, {
        reportId, search, cursor: searchCursor.value ?? undefined,
      });
      if (generation !== searchGeneration) return;
      const seen = new Set(searchResults.value.map((expense) => expense.id));
      searchResults.value.push(...page.rows.filter((expense) => !seen.has(expense.id)));
      searchCursor.value = page.continueCursor;
      searchDone.value = page.isDone;
      found += page.rows.length;
      scannedPages++;
    } while (!searchDone.value && found < 12 && scannedPages < 4);
  } catch {
    if (generation === searchGeneration) searchFailed.value = true;
  } finally {
    if (generation === searchGeneration) searchBusy.value = false;
  }
}

watch([searchOpen, debouncedSearch, () => report.value?.isOwner ? report.value.id : null], () => {
  searchGeneration++;
  searchResults.value = [];
  searchCursor.value = null;
  searchDone.value = false;
  searchBusy.value = false;
  searchFailed.value = false;
  if (searchOpen.value && report.value?.isOwner) void loadMoreExpenses(searchGeneration);
});

function onSearchScroll(event: Event) {
  const panel = event.target as HTMLElement;
  if (panel.scrollTop + panel.clientHeight >= panel.scrollHeight - 64) void loadMoreExpenses();
}
const personName = ref("");
const includePersonInExistingExpenses = ref(false);
const reviewingNewPerson = ref(false);
const addingPerson = ref(false);
const addPersonInput = ref<HTMLInputElement | null>(null);
const addPersonConfirm = ref<HTMLButtonElement | null>(null);
watch(personName, () => {
  reviewingNewPerson.value = false;
  includePersonInExistingExpenses.value = false;
});
const editingTitle = ref(false);
const tripTitleInput = ref("");
const tripTitleField = ref<HTMLInputElement | null>(null);
const savingTitle = ref(false);
const editingPerson = ref<string | null>(null);
const participantInput = ref("");
const participantField = ref<HTMLInputElement | null>(null);
const savingPerson = ref(false);
const removingPerson = ref<string | null>(null);
const removingPersonBusy = ref(false);
const removePersonError = ref("");
const guestName = ref("");
const guestNote = ref("");
const guestAmount = ref("");
const guestDate = ref(new Date().toISOString().slice(0, 10));
const guestCurrency = ref<"INR" | "USD" | "THB">("THB");
const editingEntry = ref<string | null>(null);
const editPayer = ref("");
const editSplit = ref<string[]>([]);
const editNewPerson = ref("");
const busyEntry = ref<string | null>(null);
const paymentOpen = ref(false);
const paymentFrom = ref("");
const paymentTo = ref("");
const paymentAmount = ref("");
const paymentPrefill = ref("");
const paymentPrefillCurrency = ref<"INR" | "USD" | "THB">("THB");
const paymentCurrency = ref<"INR" | "USD" | "THB">("THB");
const paymentDate = ref(new Date().toISOString().slice(0, 10));

watch(slug, () => {
  accessToken.value = sessionStorage.getItem(sessionKey.value) || "";
  passcode.value = "";
  guestCurrencyView.value = null;
});

watch(() => report.value?.isOwner, (isOwner) => {
  if (isOwner) guestCurrencyView.value = null;
});

const approvedEntries = computed(() => report.value?.entries.filter((entry) => entry.status === "approved") || []);
const pendingEntries = computed(() => report.value?.entries.filter((entry) => entry.status === "pending") || []);
const sortedEntries = computed(() => [...approvedEntries.value].sort((a, b) => b.date.localeCompare(a.date)));
const formatMoney = (amount: number, currency: string) => new Intl.NumberFormat(currency === "INR" ? "en-IN" : "en-US", { style: "currency", currency, maximumFractionDigits: 2 }).format(amount);
const formatDate = (date: string) => new Date(`${date}T00:00:00Z`).toLocaleDateString("en-US", { timeZone: "UTC", day: "numeric", month: "short", year: "numeric" });
const mergeTarget = computed(() => report.value?.participants.find((person) => person !== editingPerson.value && person.toLowerCase() === participantInput.value.trim().toLowerCase()));

async function editTripTitle() {
  if (!report.value) return;
  tripTitleInput.value = report.value.title;
  editingTitle.value = true;
  await nextTick();
  tripTitleField.value?.focus();
  tripTitleField.value?.select();
}

async function saveTripTitle() {
  if (!report.value || savingTitle.value) return;
  const title = tripTitleInput.value.trim();
  if (!title) { toast.error("Enter a trip name"); return; }
  savingTitle.value = true;
  try {
    await updateReport({ reportId: report.value.id, title });
    editingTitle.value = false;
  } catch { toast.error("Could not rename this trip"); }
  finally { savingTitle.value = false; }
}

async function editParticipant(person: string) {
  removingPerson.value = null;
  editingPerson.value = person;
  participantInput.value = person;
  await nextTick();
  participantField.value?.focus();
  participantField.value?.select();
}

function startRemovePerson(person: string) {
  editingPerson.value = null;
  removingPerson.value = person;
  removePersonError.value = "";
}

async function saveParticipant() {
  if (!report.value || !editingPerson.value || savingPerson.value) return;
  const to = participantInput.value.trim();
  if (!to) { toast.error("Enter a name"); return; }
  savingPerson.value = true;
  try {
    await renameParticipant({ reportId: report.value.id, from: editingPerson.value, to });
    editingPerson.value = null;
    toast.success("Name updated on this trip");
  } catch { toast.error("Could not update this name"); }
  finally { savingPerson.value = false; }
}

async function confirmRemovePerson() {
  if (!report.value || !removingPerson.value || removingPersonBusy.value) return;
  removingPersonBusy.value = true;
  removePersonError.value = "";
  try {
    const result = await removeParticipant({ reportId: report.value.id, person: removingPerson.value });
    if (!result.ok) {
      removePersonError.value = result.reason;
      return;
    }
    removingPerson.value = null;
    toast.success("Person removed from this trip");
  } catch {
    removePersonError.value = "Could not remove this person. Try again.";
  } finally {
    removingPersonBusy.value = false;
  }
}

async function removeFromTrip(entryId: NonNullable<typeof report.value>["entries"][number]["id"]) {
  try {
    await removeReportExpense({ entryId });
    toast.success("Removed from this report");
  } catch { toast.error("Could not remove this expense"); }
}

async function submitPasscode() {
  unlockError.value = "";
  if (passcode.value.length !== 4) return;
  try {
    const result = await unlock({ slug: slug.value, passcode: passcode.value.toUpperCase() });
    if (!result.ok || !result.token) {
      unlockError.value = result.reason === "locked" ? "Too many attempts. Try again in 15 minutes." : result.reason === "expired" ? "This report has expired." : "That passcode didn't match. Check the code from the trip owner.";
      return;
    }
    sessionStorage.setItem(sessionKey.value, result.token);
    accessToken.value = result.token;
    passcode.value = "";
  } catch {
    unlockError.value = "Could not unlock the report. Please try again.";
  }
}

async function shareReport() {
  if (!report.value) return;
  try {
    const text = await getShareText({ reportId: report.value.id });
    if (navigator.share) {
      try { await navigator.share({ text }); return; }
      catch (error) { if (error instanceof DOMException && error.name === "AbortError") return; }
    }
    await navigator.clipboard.writeText(text);
    toast.success("Link and passcode copied");
  } catch { toast.error("Could not share this trip. Try again."); }
}

function openPayment(from = "", to = "", amount = 0, currency: string = "THB") {
  paymentFrom.value = from || report.value?.participants[0] || "";
  paymentTo.value = to || report.value?.participants.find((person) => person !== paymentFrom.value) || "";
  paymentAmount.value = amount ? String(amount) : "";
  paymentPrefill.value = paymentAmount.value;
  paymentCurrency.value = currency === "INR" || currency === "USD" ? currency : "THB";
  paymentPrefillCurrency.value = paymentCurrency.value;
  paymentOpen.value = true;
}

watch(paymentCurrency, () => {
  // A suggested debt amount belongs to its original currency. Do not reuse that number as a payment in another currency.
  if (paymentOpen.value && paymentCurrency.value !== paymentPrefillCurrency.value && paymentPrefill.value && paymentAmount.value === paymentPrefill.value) paymentAmount.value = "";
  if (paymentCurrency.value !== paymentPrefillCurrency.value) paymentPrefill.value = "";
});

async function savePayment() {
  if (!report.value) return;
  const amount = Number(paymentAmount.value);
  if (!paymentFrom.value || !paymentTo.value || paymentFrom.value === paymentTo.value || !Number.isFinite(amount) || amount <= 0 || !paymentDate.value) {
    toast.error("Choose two people and enter a payment amount"); return;
  }
  try {
    await recordSettlement({ reportId: report.value.id, date: paymentDate.value, from: paymentFrom.value, to: paymentTo.value, amount, currency: paymentCurrency.value });
    paymentOpen.value = false;
    toast.success("Payment recorded");
  } catch { toast.error("Could not record this payment"); }
}

async function deletePayment(settlementId: NonNullable<typeof report.value>["payments"][number]["id"]) {
  try { await removeSettlement({ settlementId }); toast.success("Payment removed"); }
  catch { toast.error("Could not remove this payment"); }
}

async function saveCurrencyMode(separateCurrencies: boolean) {
  if (!report.value) return;
  if (!report.value.isOwner) {
    guestCurrencyView.value = separateCurrencies;
    return;
  }
  try { await updateReport({ reportId: report.value.id, separateCurrencies }); }
  catch { toast.error("Could not change the currency view"); }
}

async function addParticipant() {
  if (!report.value || addingPerson.value) return;
  const name = personName.value.trim();
  if (!name || report.value.participants.some((person) => person.toLowerCase() === name.toLowerCase())) return;
  addingPerson.value = true;
  try {
    await updateReport({ reportId: report.value.id, participants: [...report.value.participants, name], includeInExistingExpenses: includePersonInExistingExpenses.value });
    personName.value = "";
    reviewingNewPerson.value = false;
    includePersonInExistingExpenses.value = false;
    toast.success(`${name} added`);
  } catch { toast.error("Could not add this person"); }
  finally { addingPerson.value = false; }
}

async function reviewNewPerson() {
  if (!report.value) return;
  const name = personName.value.trim();
  if (!name || report.value.participants.some((person) => person.toLowerCase() === name.toLowerCase())) return;
  reviewingNewPerson.value = true;
  await nextTick();
  addPersonConfirm.value?.focus();
}

async function cancelNewPersonReview() {
  reviewingNewPerson.value = false;
  includePersonInExistingExpenses.value = false;
  await nextTick();
  addPersonInput.value?.focus();
}

function edit(entry: NonNullable<typeof report.value>["entries"][number]) {
  editingEntry.value = entry.id;
  editPayer.value = entry.paidBy;
  editSplit.value = [...entry.splitWith];
  editNewPerson.value = "";
}

async function saveSplit(entryId: NonNullable<typeof report.value>["entries"][number]["id"]) {
  const newPerson = editNewPerson.value.trim();
  if (!editSplit.value.length && !newPerson) { toast.error("Select at least one person"); return; }
  busyEntry.value = entryId;
  try {
    await updateEntry({ entryId, paidBy: editPayer.value, splitWith: editSplit.value, newPerson: newPerson || undefined });
    editingEntry.value = null;
    toast.success("Split updated");
  } catch { toast.error("Could not save this split"); }
  finally { busyEntry.value = null; }
}

async function includeExpense(expenseId: Id<"expenseEntries">) {
  if (!report.value || ownerAdding.value || addedExpenseIds.value.has(expenseId)) return;
  addingExpenseId.value = expenseId;
  try {
    await addOwnerExpense({ reportId: report.value.id, expenseId });
    addedExpenseIds.value.add(expenseId);
    toast.success("Expense added to trip");
  } catch { toast.error("Could not add this expense"); }
  finally { addingExpenseId.value = null; }
}

async function proposeExpense() {
  const amount = Number(guestAmount.value);
  if (!guestName.value.trim() || !guestNote.value.trim() || !guestDate.value || !Number.isFinite(amount) || amount <= 0) {
    toast.error("Add your name, date, amount, and description");
    return;
  }
  try {
    await submitGuest({ slug: slug.value, token: accessToken.value, submittedBy: guestName.value.trim(), date: guestDate.value, note: guestNote.value.trim(), amount, currency: guestCurrency.value });
    guestNote.value = "";
    guestAmount.value = "";
    toast.success("Sent to the trip owner for approval");
  } catch (error) {
    if (String(error).includes("Unlock the report first")) {
      sessionStorage.removeItem(sessionKey.value);
      accessToken.value = "";
      toast.error("This passcode session expired. Unlock the report again.");
    } else {
      toast.error("Could not submit this expense. Please try again.");
    }
  }
}
</script>

<template>
  <!-- Trip report: a clear settlement ledger behind a real passcode gate. No private rows are fetched before access. -->
  <div class="trip-page min-h-screen bg-background text-foreground">
    <header class="mx-auto flex max-w-4xl items-center justify-between border-b px-5 py-4">
      <router-link to="/landing" class="text-xl font-bold tracking-tight">ankan</router-link>
      <button v-if="report?.isOwner" type="button" :disabled="sharing" class="inline-flex min-h-11 items-center gap-2 rounded-md border px-3 py-2 text-sm hover:bg-muted disabled:opacity-50" @click="shareReport"><Share2 class="h-4 w-4" /> {{ sharing ? 'Preparing…' : 'Share' }}</button>
    </header>

    <main class="mx-auto max-w-4xl px-5 pb-16">
      <div v-if="auth.isLoading || shellLoading || reportLoading" class="flex min-h-[50vh] items-center justify-center text-muted-foreground">Opening trip report…</div>
      <div v-else-if="!shell?.exists" class="mx-auto max-w-lg py-24 text-center">
        <LockKeyhole class="mx-auto mb-5 h-8 w-8 text-[#67809a]" />
        <h1 class="text-3xl font-semibold tracking-tight">This report is unavailable</h1>
        <p class="mt-3 text-[#64748b]">The link may have expired. Ask the trip owner for a new one.</p>
      </div>

      <div v-else-if="!report" class="relative min-h-[640px] overflow-hidden rounded-2xl border border-[#dce4ed] bg-white">
        <div class="pointer-events-none absolute inset-0 select-none p-6 blur-lg md:p-12" aria-hidden="true">
          <div class="h-5 w-44 rounded bg-[#c9d6e4]" />
          <div class="mt-8 h-14 w-3/5 rounded bg-[#d9e3ed]" />
          <div class="mt-12 grid gap-6 md:grid-cols-2"><div class="h-40 rounded-xl bg-[#dbe5ee]" /><div class="h-40 rounded-xl bg-[#e1e9f0]" /></div>
          <div class="mt-12 space-y-4"><div v-for="index in 5" :key="index" class="h-11 rounded-lg bg-[#d8e2eb]" /></div>
        </div>
        <div class="absolute inset-0 bg-white/55" />
        <div class="relative z-10 flex min-h-[640px] items-center justify-center p-5">
          <form class="w-full max-w-sm rounded-xl border bg-background px-7 py-9 text-center shadow-lg" @submit.prevent="submitPasscode">
            <LockKeyhole class="mx-auto mb-5 h-7 w-7" />
            <h1 class="text-2xl font-semibold tracking-tight">Open the trip report</h1>
            <p class="mt-2 text-sm text-muted-foreground">Enter the 4 character passcode.</p>
            <label for="trip-passcode" class="sr-only">Four character passcode</label>
            <input id="trip-passcode" v-model="passcode" maxlength="4" autocomplete="one-time-code" autocapitalize="characters" spellcheck="false" inputmode="text" class="mt-7 w-full rounded-md border bg-background px-3 py-3 text-center font-mono text-2xl font-semibold tracking-[.55em] uppercase outline-none focus:ring-2 focus:ring-ring" placeholder="••••" @input="passcode = passcode.toUpperCase().replace(/[^A-Z2-9]/g, '')" />
            <p v-if="unlockError" role="alert" class="mt-3 text-sm text-[#b34242]">{{ unlockError }}</p>
            <button type="submit" :disabled="passcode.length !== 4 || unlocking" class="mt-5 flex w-full items-center justify-center gap-2 rounded-md bg-primary px-4 py-3 font-medium text-primary-foreground disabled:opacity-50">{{ unlocking ? 'Checking…' : 'Unlock report' }} <ArrowRight v-if="!unlocking" class="h-4 w-4" /></button>
          </form>
        </div>
      </div>

      <template v-else>
        <div class="flex flex-col gap-4 border-b pb-6 pt-10 md:flex-row md:items-end md:justify-between">
          <div class="min-w-0 flex-1">
            <form v-if="editingTitle && report.isOwner" class="flex flex-col gap-2 sm:flex-row sm:items-center" @submit.prevent="saveTripTitle">
              <label for="trip-title-edit" class="sr-only">Trip name</label>
              <input id="trip-title-edit" ref="tripTitleField" v-model="tripTitleInput" maxlength="80" class="min-h-11 min-w-0 flex-1 rounded-md border bg-background px-3 text-xl font-semibold outline-none focus:ring-2 focus:ring-ring" />
              <div class="flex gap-2"><button type="submit" :disabled="savingTitle" class="min-h-11 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground disabled:opacity-50">Save</button><button type="button" class="min-h-11 rounded-md border px-4 text-sm" @click="editingTitle = false">Cancel</button></div>
            </form>
            <div v-else class="flex min-w-0 items-start gap-1"><h1 class="min-w-0 break-words text-3xl font-semibold tracking-tight">{{ report.title }}</h1><button v-if="report.isOwner" type="button" aria-label="Rename trip" class="-mt-1 flex min-h-11 min-w-11 shrink-0 items-center justify-center rounded-md hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring" @click="editTripTitle"><Pencil class="h-4 w-4" /></button></div>
            <p class="mt-2 text-sm text-muted-foreground">{{ report.ownerName }} · Expires {{ formatDate(new Date(report.expiresAt).toISOString().slice(0, 10)) }}</p>
          </div>
          <div class="flex items-center gap-1 text-sm">
            <button class="rounded-md px-3 py-2" :class="!report.separateCurrencies ? 'bg-muted font-medium' : 'text-muted-foreground'" @click="saveCurrencyMode(false)">Convert to INR</button>
            <button class="rounded-md px-3 py-2" :class="report.separateCurrencies ? 'bg-muted font-medium' : 'text-muted-foreground'" @click="saveCurrencyMode(true)">Keep currencies</button>
          </div>
        </div>

        <p v-if="report.hasFallbackFx && !report.separateCurrencies" class="mt-4 text-sm text-amber-700">Some currency conversions use fallback rates.</p>
        <p v-if="report.hasLegacyFx && !report.separateCurrencies" class="mt-4 text-sm text-amber-700">Some conversions still use older exchange rates.</p>
        <p v-if="report.hasOutdatedFx && !report.separateCurrencies" class="mt-2 text-sm text-amber-700">Updating a conversion after an expense date changed.</p>

        <section class="mt-6" aria-labelledby="trip-people-title">
          <h2 id="trip-people-title" class="text-sm font-medium text-muted-foreground">People</h2>
          <div class="mt-2 flex flex-wrap gap-2"><div v-for="person in report.participants" :key="person" class="inline-flex items-center rounded-md bg-muted text-sm"><span class="py-2 pl-3" :class="report.isOwner ? '' : 'pr-3'">{{ person }}</span><button v-if="report.isOwner" type="button" :aria-label="`Rename ${person}`" class="flex min-h-11 min-w-11 items-center justify-center rounded-md hover:bg-border focus-visible:ring-2 focus-visible:ring-ring" @click="editParticipant(person)"><Pencil class="h-3.5 w-3.5" /></button><button v-if="report.isOwner && person !== report.ownerName" type="button" :aria-label="`Remove ${person} from this trip`" class="flex min-h-11 min-w-11 items-center justify-center rounded-md text-muted-foreground hover:bg-border hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring" @click="startRemovePerson(person)"><X class="h-4 w-4" /></button></div></div>
          <form v-if="editingPerson && report.isOwner" class="mt-3 flex max-w-md flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center" @submit.prevent="saveParticipant">
            <label for="trip-person-edit" class="sr-only">Name for {{ editingPerson }}</label>
            <input id="trip-person-edit" ref="participantField" v-model="participantInput" maxlength="60" class="min-h-11 min-w-0 flex-1 rounded-md border bg-background px-3 text-base outline-none focus:ring-2 focus:ring-ring" />
            <div class="flex gap-2"><button type="submit" :disabled="savingPerson" class="min-h-11 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground disabled:opacity-50">Save</button><button type="button" class="min-h-11 rounded-md border px-4 text-sm" @click="editingPerson = null">Cancel</button></div>
            <p v-if="mergeTarget" class="w-full text-xs text-muted-foreground">This will combine {{ editingPerson }} with {{ mergeTarget }} in this trip.</p>
          </form>
          <div v-if="removingPerson && report.isOwner" class="mt-3 max-w-md space-y-2 text-sm" role="group" :aria-label="`Remove ${removingPerson}`">
            <p>Remove <strong>{{ removingPerson }}</strong> from this trip?</p>
            <p class="text-muted-foreground">Their share will be removed from trip expenses.</p>
            <p v-if="removePersonError" role="alert" class="text-destructive">{{ removePersonError }}</p>
            <div class="flex gap-3"><button type="button" :disabled="removingPersonBusy" class="min-h-11 rounded-md border border-destructive px-4 text-sm font-medium text-destructive disabled:opacity-50" @click="confirmRemovePerson">{{ removingPersonBusy ? 'Removing…' : 'Remove person' }}</button><button type="button" class="min-h-11 px-2 text-sm text-muted-foreground" @click="removingPerson = null">Cancel</button></div>
          </div>
          <form v-if="report.isOwner && !editingPerson && !removingPerson" class="relative mt-3 max-w-sm" @submit.prevent="reviewNewPerson">
            <div class="flex gap-2"><input ref="addPersonInput" v-model="personName" aria-label="Add a person" placeholder="Add a person" maxlength="60" class="min-h-11 min-w-0 flex-1 rounded-md border px-3 text-base" /><button type="submit" aria-label="Add person" class="flex min-h-11 min-w-11 items-center justify-center rounded-md border"><Plus class="h-4 w-4" /></button></div>
            <div v-if="reviewingNewPerson" role="group" aria-label="New person options" class="absolute inset-x-0 top-full z-20 mt-2 rounded-md border bg-background p-3 shadow-md" @keydown.esc.prevent="cancelNewPersonReview">
              <p class="text-sm font-medium">Add {{ personName.trim() }} to this trip</p>
              <label class="mt-2 flex min-h-9 items-center gap-2 text-sm text-muted-foreground"><input v-model="includePersonInExistingExpenses" type="checkbox" />Include in all existing expense splits</label>
              <div class="mt-3 flex items-center gap-4 text-sm"><button ref="addPersonConfirm" type="button" :disabled="addingPerson" class="rounded-md bg-primary px-3 py-2 font-medium text-primary-foreground disabled:opacity-50" @click="addParticipant">{{ addingPerson ? 'Adding…' : 'Add person' }}</button><button type="button" class="text-muted-foreground" @click="cancelNewPersonReview">Cancel</button></div>
            </div>
          </form>
        </section>

        <section class="mt-8" aria-labelledby="settlement-title">
          <div class="mb-4 flex items-center justify-between gap-3"><h2 id="settlement-title" class="text-xl font-semibold">Who owes whom</h2><button v-if="report.isOwner" type="button" class="min-h-11 text-sm font-medium underline underline-offset-2" @click="openPayment()">Record payment</button></div>
          <div v-for="group in report.settlements" :key="group.currency" class="border-t py-4">
            <div class="mb-3 flex justify-between gap-4"><span class="text-muted-foreground">Total · {{ group.currency }}</span><strong class="tabular-nums">{{ formatMoney(group.total, group.currency) }}</strong></div>
            <p v-if="!group.transfers.length" class="text-sm text-muted-foreground">Nothing left to pay</p>
            <div v-for="(transfer, index) in group.transfers" :key="index" class="py-2"><div class="flex flex-wrap items-center gap-2"><span class="font-medium">{{ transfer.from }}</span><ArrowRight class="h-4 w-4 text-muted-foreground" /><span class="font-medium">{{ transfer.to }}</span><strong class="ml-auto tabular-nums">{{ formatMoney(transfer.amount, group.currency) }}</strong></div><button v-if="report.isOwner" type="button" class="mt-1 text-sm text-muted-foreground underline underline-offset-2" @click="openPayment(transfer.from, transfer.to, transfer.amount, group.currency)">Record payment</button></div>
          </div>
          <form v-if="paymentOpen && report.isOwner" class="mt-3 grid max-w-lg gap-3 border-t pt-4 text-sm" @submit.prevent="savePayment">
            <div class="grid grid-cols-2 gap-3"><label>From<select v-model="paymentFrom" class="mt-1 min-h-11 w-full rounded-md border bg-background px-3"><option v-for="person in report.participants" :key="person">{{ person }}</option></select></label><label>To<select v-model="paymentTo" class="mt-1 min-h-11 w-full rounded-md border bg-background px-3"><option v-for="person in report.participants" :key="person">{{ person }}</option></select></label></div>
            <div class="grid grid-cols-[minmax(0,1fr)_100px] gap-3"><label>Amount paid<input v-model="paymentAmount" type="number" min="0.01" step="0.01" required class="mt-1 min-h-11 w-full rounded-md border bg-background px-3 text-base" /></label><label>Currency<select v-model="paymentCurrency" class="mt-1 min-h-11 w-full rounded-md border bg-background px-2"><option>THB</option><option>INR</option><option>USD</option></select></label></div>
            <label>Date<input v-model="paymentDate" type="date" required class="mt-1 min-h-11 w-full rounded-md border bg-background px-3" /></label>
            <div class="flex gap-3"><button type="submit" :disabled="recordingPayment" class="min-h-11 rounded-md bg-primary px-4 font-medium text-primary-foreground disabled:opacity-50">{{ recordingPayment ? 'Saving…' : 'Save payment' }}</button><button type="button" class="min-h-11 text-muted-foreground" @click="paymentOpen = false">Cancel</button></div>
          </form>
          <div v-if="report.payments.length" class="mt-5 border-t pt-4"><h3 class="mb-2 text-sm font-medium">Recorded payments</h3><div v-for="payment in [...report.payments].sort((a, b) => b.date.localeCompare(a.date))" :key="payment.id" class="flex flex-wrap items-baseline gap-x-2 gap-y-1 py-2 text-sm"><span><strong>{{ payment.from }}</strong> paid <strong>{{ payment.to }}</strong></span><span class="text-muted-foreground">· {{ formatDate(payment.date) }}</span><strong class="ml-auto tabular-nums">{{ formatMoney(payment.amount, payment.currency) }}</strong><p v-for="unapplied in report.unappliedPayments.filter((item) => item.id === payment.id)" :key="unapplied.id" class="w-full text-xs text-muted-foreground">{{ formatMoney(unapplied.amount, unapplied.currency) }} exceeds the current amount owed and is not applied</p><button v-if="report.isOwner" type="button" class="w-full text-left text-muted-foreground underline underline-offset-2" @click="deletePayment(payment.id)">Remove payment</button></div></div>
        </section>

        <section class="mt-9 border-t pt-6" aria-labelledby="search-title">
          <div class="flex items-center justify-between gap-4"><h2 id="search-title" class="text-xl font-semibold">Add an expense</h2><button v-if="searchOpen" class="text-sm text-muted-foreground hover:text-foreground" @click="searchOpen = false">Close</button></div>
          <div v-if="report.isOwner" class="relative mt-4"><Search class="absolute left-3 top-3 h-4 w-4 text-muted-foreground" /><input v-model="ownerSearch" aria-label="Search your expenses" placeholder="Search your expenses by note, amount, or date" class="w-full rounded-md border bg-background py-2 pl-9 pr-3 text-sm outline-none focus:ring-2 focus:ring-ring" @focus="searchOpen = true" /></div>
          <p v-else-if="!auth.isAuthenticated" class="mt-3 text-sm text-muted-foreground">Own this report? <router-link :to="{ name: 'login', query: { trip: slug } }" class="underline underline-offset-2">Sign in to search your expenses</router-link>.</p>
          <p v-else class="mt-3 text-sm text-muted-foreground">Only the trip owner can search their expenses.</p>
          <div v-if="searchOpen && report.isOwner" class="mt-2 h-72 overflow-y-auto border-t" aria-live="polite" @scroll.passive="onSearchScroll">
            <template v-if="ownerSearch.trim() === debouncedSearch"><div v-for="expense in searchResults" :key="expense.id" class="flex items-center gap-3 border-b py-3 text-sm"><div class="min-w-0 flex-1"><p class="truncate font-medium">{{ expense.note || 'Expense' }}</p><p class="text-muted-foreground">{{ formatDate(expense.date) }}</p></div><span class="shrink-0 tabular-nums">{{ formatMoney(expense.amount, expense.currency) }}</span><button class="shrink-0 rounded-md border px-3 py-1.5 font-medium hover:bg-muted disabled:opacity-50" :disabled="ownerAdding || addedExpenseIds.has(expense.id)" @click="includeExpense(expense.id)">{{ addedExpenseIds.has(expense.id) ? 'Added' : addingExpenseId === expense.id ? 'Adding…' : 'Add' }}</button></div></template>
            <p v-if="searchBusy || ownerSearch.trim() !== debouncedSearch" class="py-4 text-center text-sm text-muted-foreground" role="status">Loading expenses…</p>
            <p v-else-if="searchFailed" class="py-4 text-center text-sm text-muted-foreground">Search paused. <button class="underline underline-offset-2" @click="loadMoreExpenses()">Try again</button></p>
            <p v-else-if="searchDone && searchResults.length === 0" class="py-4 text-sm text-muted-foreground">No matching expenses. Try a note or date.</p>
            <p v-else-if="searchDone" class="py-4 text-center text-xs text-muted-foreground">End of results</p>
            <div v-else class="py-3 text-center"><button class="text-sm text-muted-foreground underline underline-offset-2" @click="loadMoreExpenses()">Load more expenses</button></div>
          </div>
        </section>

        <section class="mt-9" aria-labelledby="transactions-title">
          <div class="mb-4 flex items-baseline justify-between"><h2 id="transactions-title" class="text-xl font-semibold">Trip expenses</h2><span class="text-sm text-muted-foreground">{{ approvedEntries.length }} expenses</span></div>
          <p v-if="!sortedEntries.length" class="border-t py-8 text-muted-foreground">No expenses yet.</p>
          <div v-for="entry in sortedEntries" :key="entry.id" class="border-t py-4">
            <div class="flex gap-4"><div class="min-w-0 flex-1"><p class="font-medium">{{ entry.note }}</p><p class="mt-1 text-sm text-muted-foreground"><time :datetime="entry.date" class="font-medium text-foreground">{{ formatDate(entry.date) }}</time><span class="mx-1.5" aria-hidden="true">·</span>Paid by <span class="font-medium text-foreground">{{ entry.paidBy }}</span></p><p class="mt-0.5 text-sm text-muted-foreground">Split between <span class="font-medium text-foreground">{{ entry.splitWith.join(' and ') }}</span></p><p v-if="entry.matchInferred" class="mt-1 text-xs text-muted-foreground">Matched by trip date</p></div><div class="shrink-0 text-right"><p class="font-medium tabular-nums">{{ formatMoney(entry.amount, entry.currency) }}</p><p v-if="entry.currency !== 'INR' && !report.separateCurrencies" class="text-xs text-muted-foreground">≈ {{ formatMoney(entry.amount * entry.rateToInr, 'INR') }}</p></div></div>
            <div v-if="report.isOwner" class="mt-2 flex gap-4 text-sm"><button class="underline underline-offset-2" @click="edit(entry)">Edit split</button><button class="text-muted-foreground underline underline-offset-2" @click="removeFromTrip(entry.id)">Remove</button></div>
            <div v-if="editingEntry === entry.id && report.isOwner" class="mt-4 rounded-md bg-muted p-4">
              <label class="block text-sm font-medium">Paid by<select v-model="editPayer" class="mt-1 block w-full rounded-md border bg-background px-3 py-2"><option v-for="person in report.participants" :key="person">{{ person }}</option></select></label>
              <div class="mt-4 text-sm font-medium">Split equally with</div>
              <div class="mt-2 flex flex-wrap gap-3"><label v-for="person in report.participants" :key="person" class="flex items-center gap-2 text-sm"><input v-model="editSplit" type="checkbox" :value="person" />{{ person }}</label></div>
              <label class="mt-4 block text-sm font-medium">Add a new person to this split<input v-model="editNewPerson" maxlength="60" placeholder="Name" class="mt-1 block min-h-11 w-full rounded-md border bg-background px-3 text-base font-normal" /></label>
              <div class="mt-4 flex gap-3"><button class="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50" :disabled="busyEntry === entry.id" @click="saveSplit(entry.id)">Save</button><button class="text-sm text-muted-foreground" @click="editingEntry = null">Cancel</button></div>
            </div>
          </div>
          <div v-if="pendingEntries.length" class="mt-8"><h3 class="mb-2 font-medium">Awaiting approval</h3><p v-for="entry in pendingEntries" :key="entry.id" class="border-t py-3 text-sm text-muted-foreground">{{ entry.submittedBy }} · {{ entry.note }} · {{ formatMoney(entry.amount, entry.currency) }}</p></div>
        </section>

        <details class="mt-8 border-t pt-5"><summary class="cursor-pointer font-medium">Suggest a missing expense</summary><form class="mt-4 grid max-w-lg gap-3 text-sm" @submit.prevent="proposeExpense"><label>Your name<input v-model="guestName" maxlength="60" class="mt-1 block w-full rounded-md border px-3 py-2" /></label><label>Description<input v-model="guestNote" maxlength="200" class="mt-1 block w-full rounded-md border px-3 py-2" /></label><div class="grid grid-cols-[1fr_100px] gap-3"><label>Amount<input v-model="guestAmount" type="number" min="0.01" step="0.01" class="mt-1 block w-full rounded-md border px-3 py-2" /></label><label>Currency<select v-model="guestCurrency" class="mt-1 block w-full rounded-md border px-2 py-2"><option>THB</option><option>INR</option><option>USD</option></select></label></div><label>Date<input v-model="guestDate" type="date" class="mt-1 block w-full rounded-md border px-3 py-2" /></label><button type="submit" :disabled="guestSubmitting" class="w-fit rounded-md bg-primary px-4 py-2 font-medium text-primary-foreground disabled:opacity-50">{{ guestSubmitting ? 'Sending…' : 'Send for approval' }}</button></form></details>
      </template>
    </main>
  </div>
</template>
