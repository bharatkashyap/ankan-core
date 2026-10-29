<script setup lang="ts">
import { computed, nextTick, ref } from "vue";
import { storeToRefs } from "pinia";
import { ChevronDown, Dumbbell, Flame, Loader2, Plus, X } from "lucide-vue-next";
import { api, useConvexMutation, useConvexQuery } from "@/composables/useConvex";
import { useAuthStore } from "@/stores/auth";
import PageHeader from "@/components/PageHeader.vue";

const { profileId } = storeToRefs(useAuthStore());
const tab = ref<"workouts" | "meals">("workouts");
const today = new Date().toISOString().slice(0, 10);
const month = ref(today.slice(0, 7));
const date = ref(today);
const showAddRow = ref(false);
const exercise = ref("");
type WeightGroup = { sets?: number; weight?: number };
const weightGroups = ref<WeightGroup[]>([{}]);
const editWeightGroups = ref<WeightGroup[]>([{}]);
const validWeightGroup = (group: WeightGroup) => Number.isSafeInteger(group.sets) && group.sets! > 0 && typeof group.weight === "number" && Number.isFinite(group.weight) && group.weight >= 0;
const validWeightGroups = (groups: WeightGroup[]) => groups.length === 1
  ? (groups[0].sets === undefined || groups[0].sets === "" || (Number.isSafeInteger(groups[0].sets) && groups[0].sets! > 0))
    && (groups[0].weight === undefined || groups[0].weight === "" || (typeof groups[0].weight === "number" && Number.isFinite(groups[0].weight) && groups[0].weight >= 0))
  : groups.every(validWeightGroup);
const weightFields = (groups: WeightGroup[]) => groups.every(validWeightGroup)
  ? { weightGroups: groups.map((group) => ({ sets: group.sets!, weight: group.weight! })) }
  : { sets: typeof groups[0]?.sets === "number" ? groups[0].sets : undefined, weight: typeof groups[0]?.weight === "number" ? groups[0].weight : undefined };
const calories = ref<number | undefined>();
const protein = ref<number | undefined>();
const carbs = ref<number | undefined>();
const fat = ref<number | undefined>();
const enteredMacros = computed(() => [protein.value, carbs.value, fat.value].map((value) => typeof value === "number" && Number.isFinite(value) ? value : undefined));
const macroInputsIncomplete = computed(() => enteredMacros.value.some((value) => value !== undefined) && enteredMacros.value.some((value) => value === undefined));
const meal = ref("");
const inputRef = ref<HTMLInputElement | null>(null);
const editingId = ref<string | null>(null);
const editValue = ref("");
const editDate = ref("");
const editError = ref("");
const editCalories = ref<number | undefined>();
const editProtein = ref<number | undefined>();
const editCarbs = ref<number | undefined>();
const editFat = ref<number | undefined>();
const editingDay = ref<{ kind: "exercise" | "meal"; date: string } | null>(null);
const dayDate = ref("");
const dayError = ref("");
const dayDateInput = ref<HTMLInputElement | null>(null);
const showSavedMeals = ref(false);
const deletingId = ref<string | null>(null);
const expandedMealId = ref<string | null>(null);

const { data: entries, isLoading } = useConvexQuery(api.health.listByMonth, () => profileId.value ? { profileId: profileId.value, monthYear: month.value } : "skip");
const { data: savedMeals, isLoading: savedMealsLoading, error: savedMealsError } = useConvexQuery(api.health.listMealReferences, () => profileId.value && showSavedMeals.value && tab.value === "meals" ? { profileId: profileId.value } : "skip");
const { mutate: add, isLoading: isSaving } = useConvexMutation(api.health.add);
const { mutate: update, isLoading: isUpdating } = useConvexMutation(api.health.update);
const { mutate: updateDayDate, isLoading: isMovingDay } = useConvexMutation(api.health.updateDayDate);
const { mutate: remove } = useConvexMutation(api.health.remove);
type HealthEntry = NonNullable<typeof entries.value>[number];
const isExercise = (entry: HealthEntry) => entry.kind === "exercise";
const visibleEntries = computed(() => (entries.value || []).filter((entry) => tab.value === "workouts" ? isExercise(entry) : entry.kind === "meal").sort((a, b) => b.date.localeCompare(a.date)));
const groupedEntries = computed(() => {
  const groups: Record<string, typeof visibleEntries.value> = {};
  for (const entry of visibleEntries.value) (groups[entry.date] ||= []).push(entry);
  return Object.entries(groups);
});
const mealDays = computed(() => groupedEntries.value.map(([day, dayEntries]) => ({
  day,
  entries: dayEntries,
  calories: dayEntries.reduce((sum, entry) => sum + (entry.calories || 0), 0),
  protein: dayEntries.reduce((sum, entry) => sum + (entry.proteinGrams || 0), 0),
  carbs: dayEntries.reduce((sum, entry) => sum + (entry.carbsGrams || 0), 0),
  fat: dayEntries.reduce((sum, entry) => sum + (entry.fatGrams || 0), 0),
  macrosComplete: dayEntries.every((entry) => entry.proteinGrams !== undefined && entry.carbsGrams !== undefined && entry.fatGrams !== undefined),
})));
const groupSessions = (dayEntries: HealthEntry[]) => {
  const sessions = new Map<string, HealthEntry[]>();
  for (const entry of dayEntries) {
    const key = entry.sessionId || `manual:${entry._id}`;
    if (!sessions.has(key)) sessions.set(key, []);
    sessions.get(key)!.push(entry);
  }
  return [...sessions.entries()];
};
const workoutCount = computed(() => {
  const exerciseEntries = (entries.value || []).filter(isExercise);
  const byDay = new Map<string, HealthEntry[]>();
  for (const entry of exerciseEntries) {
    if (!byDay.has(entry.date)) byDay.set(entry.date, []);
    byDay.get(entry.date)!.push(entry);
  }
  return [...byDay.values()].reduce((total, dayEntries) => total + groupSessions(dayEntries).length, 0);
});
const formatDate = (value: string) => new Date(`${value}T00:00:00`).toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short" });
const formatGrams = (value: number) => new Intl.NumberFormat("en-IN", { maximumFractionDigits: 1 }).format(Math.round(value * 10) / 10);
const changeMonth = (delta: number) => { const [year, value] = month.value.split("-").map(Number); const next = new Date(year || 0, (value || 1) - 1 + delta, 1); month.value = `${next.getFullYear()}-${String(next.getMonth() + 1).padStart(2, "0")}`; };
const toggleAdd = async () => { showAddRow.value = !showAddRow.value; if (showAddRow.value) { await nextTick(); inputRef.value?.focus(); } };
const cancelAdd = () => { showAddRow.value = false; exercise.value = ""; weightGroups.value = [{}]; calories.value = undefined; protein.value = undefined; carbs.value = undefined; fat.value = undefined; meal.value = ""; };
async function submit() {
  if (!profileId.value) return;
  if (tab.value === "workouts") { if (!exercise.value.trim() || !validWeightGroups(weightGroups.value)) return; await add({ profileId: profileId.value, kind: "exercise", workoutType: exercise.value, ...weightFields(weightGroups.value), date: date.value }); }
  else {
    if (!calories.value || calories.value <= 0) return;
    if (macroInputsIncomplete.value) return;
    const [proteinGrams, carbsGrams, fatGrams] = enteredMacros.value;
    await add({ profileId: profileId.value, kind: "meal", calories: calories.value, proteinGrams, carbsGrams, fatGrams, nutritionEstimated: false, note: meal.value || undefined, date: date.value });
  }
  cancelAdd();
}
const rowText = (entry: HealthEntry) => isExercise(entry)
  ? entry.weightGroups?.length
    ? entry.weightGroups.map(({ sets, weight }) => `${sets} ${sets === 1 ? "set" : "sets"} × ${weight} kg`).join(" · ")
    : [entry.sets && `${entry.sets} sets`, entry.weight !== undefined && `${entry.weight} kg`].filter(Boolean).join(" · ") || "Exercise"
  : [
      `${entry.calories?.toLocaleString()} kcal`,
      entry.proteinGrams !== undefined && `P ${entry.proteinGrams}g`,
      entry.carbsGrams !== undefined && `C ${entry.carbsGrams}g`,
      entry.fatGrams !== undefined && `F ${entry.fatGrams}g`,
      entry.nutritionEstimated && "estimated",
    ].filter(Boolean).join(" · ");
const startEdit = (entry: HealthEntry) => { editingId.value = entry._id; editError.value = ""; editDate.value = entry.date; editValue.value = isExercise(entry) ? entry.workoutType || "" : entry.note || ""; editWeightGroups.value = entry.weightGroups?.map((group) => ({ ...group })) || [{ sets: entry.sets, weight: entry.weight }]; editCalories.value = entry.calories; editProtein.value = entry.proteinGrams; editCarbs.value = entry.carbsGrams; editFat.value = entry.fatGrams; };
const startDayDateEdit = async (kind: "exercise" | "meal", day: string) => {
  editingId.value = null;
  editingDay.value = { kind, date: day };
  dayDate.value = day;
  dayError.value = "";
  await nextTick();
  dayDateInput.value?.focus();
};
async function saveDayDate() {
  if (!profileId.value || !editingDay.value || !dayDate.value || isMovingDay.value) return;
  if (dayDate.value === editingDay.value.date) { editingDay.value = null; return; }
  dayError.value = "";
  try {
    await updateDayDate({ profileId: profileId.value, kind: editingDay.value.kind, fromDate: editingDay.value.date, date: dayDate.value });
    month.value = dayDate.value.slice(0, 7);
    editingDay.value = null;
  } catch {
    dayError.value = "Couldn't change the date. Please try again.";
  }
}
const toggleMeal = (entryId: string) => {
  if (editingId.value && editingId.value !== entryId) editingId.value = null;
  expandedMealId.value = expandedMealId.value === entryId ? null : entryId;
};
async function saveEdit(entry: HealthEntry) {
  const value = editValue.value.trim();
  if (isUpdating.value || (entry.kind === "meal" && !editDate.value)) return;
  if (isExercise(entry) && (!value || !validWeightGroups(editWeightGroups.value))) return;
  if (entry.kind === "meal" && (!editCalories.value || editCalories.value <= 0)) return;
  editError.value = "";
  try {
    await update(isExercise(entry)
      ? { entryId: entry._id, workoutType: value, ...weightFields(editWeightGroups.value), ...(entry.weightGroups && !editWeightGroups.value.every(validWeightGroup) ? { weightGroups: [] } : {}) }
      : { entryId: entry._id, date: editDate.value, note: value, calories: editCalories.value, proteinGrams: editProtein.value, carbsGrams: editCarbs.value, fatGrams: editFat.value });
    if (entry.kind === "meal") month.value = editDate.value.slice(0, 7);
    editingId.value = null;
  } catch {
    editError.value = "Couldn't save changes. Please try again.";
  }
}
async function deleteEntry(entryId: string) { deletingId.value = entryId; try { await remove({ entryId: entryId as any }); if (expandedMealId.value === entryId) expandedMealId.value = null; } finally { deletingId.value = null; } }
</script>

<template>
  <div class="max-w-3xl">
    <PageHeader label="Health" :totals="{}" :hide-totals="true" :show-month-nav="true" :current-month="month" @prev-month="changeMonth(-1)" @next-month="changeMonth(1)" @set-month="month = $event" />
    <div class="mb-7 flex items-center gap-1 border-b">
      <button class="relative px-3 py-2 text-sm transition-colors" :class="tab === 'workouts' ? 'text-foreground' : 'text-muted-foreground hover:text-foreground'" @click="tab = 'workouts'"><Dumbbell class="mr-1.5 inline h-4 w-4" />Workouts<span v-if="tab === 'workouts'" class="absolute inset-x-0 bottom-0 h-0.5 bg-foreground" /></button>
      <button class="relative px-3 py-2 text-sm transition-colors" :class="tab === 'meals' ? 'text-foreground' : 'text-muted-foreground hover:text-foreground'" @click="tab = 'meals'"><Flame class="mr-1.5 inline h-4 w-4" />Meals<span v-if="tab === 'meals'" class="absolute inset-x-0 bottom-0 h-0.5 bg-foreground" /></button>
      <span v-if="tab === 'workouts'" class="ml-auto text-xs tabular-nums text-muted-foreground">{{ workoutCount }} sessions</span>
      <button v-else type="button" class="ml-auto flex items-center gap-1 text-xs text-muted-foreground transition-colors hover:text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2" :aria-expanded="showSavedMeals" aria-controls="saved-meals-panel" @click="showSavedMeals = !showSavedMeals">Saved meals<ChevronDown class="h-3.5 w-3.5 transition-transform" :class="showSavedMeals && 'rotate-180'" /></button>
    </div>
    <button v-if="!showAddRow" class="mb-6 text-sm text-muted-foreground transition-colors hover:text-foreground" @click="toggleAdd"><Plus class="mr-1 inline h-4 w-4" />Add {{ tab === 'workouts' ? 'exercise' : 'meal' }}</button>
    <form v-else class="mb-7 flex flex-wrap items-center gap-2 rounded-lg border bg-accent/30 p-3" @submit.prevent="submit">
      <template v-if="tab === 'workouts'">
        <input ref="inputRef" v-model="exercise" required placeholder="Exercise" aria-label="Exercise" class="min-w-40 flex-1 bg-transparent px-2 py-2 text-sm outline-none placeholder:text-muted-foreground/50" />
        <div class="flex w-full flex-col gap-2">
          <div v-for="(group, index) in weightGroups" :key="index" class="flex items-center gap-2">
            <span class="w-12 text-xs text-muted-foreground">{{ index === 0 ? 'Sets' : `Group ${index + 1}` }}</span>
            <input v-model.number="group.sets" :required="weightGroups.length > 1" min="1" step="1" type="number" placeholder="Sets" :aria-label="`Sets in group ${index + 1}`" class="w-20 border-b bg-transparent px-2 py-2 text-sm outline-none placeholder:text-muted-foreground/50" />
            <input v-model.number="group.weight" :required="weightGroups.length > 1" min="0" step="0.5" type="number" placeholder="kg" :aria-label="`Weight in kilograms for group ${index + 1}`" class="w-20 border-b bg-transparent px-2 py-2 text-sm outline-none placeholder:text-muted-foreground/50" />
            <button v-if="weightGroups.length > 1" type="button" class="rounded p-1 text-muted-foreground hover:text-foreground focus-visible:outline focus-visible:outline-2" :aria-label="`Remove weight group ${index + 1}`" @click="weightGroups.splice(index, 1)"><X class="h-3.5 w-3.5" /></button>
          </div>
          <button type="button" class="w-fit text-xs text-primary hover:underline focus-visible:outline focus-visible:outline-2" @click="weightGroups.push({})"><Plus class="mr-1 inline h-3.5 w-3.5" />Add weight group</button>
        </div>
      </template>
      <template v-else>
        <input ref="inputRef" v-model="meal" placeholder="Meal" aria-label="Meal" class="min-w-36 flex-1 bg-transparent px-2 py-2 text-sm outline-none placeholder:text-muted-foreground/50" />
        <input v-model.number="calories" required min="1" type="number" placeholder="kcal" aria-label="Calories" class="w-24 border-b bg-transparent px-2 py-2 text-sm outline-none placeholder:text-muted-foreground/50" />
        <input v-model.number="protein" min="0" step="0.1" type="number" placeholder="Protein g" aria-label="Protein in grams" class="w-24 border-b bg-transparent px-2 py-2 text-sm outline-none placeholder:text-muted-foreground/50" />
        <input v-model.number="carbs" min="0" step="0.1" type="number" placeholder="Carbs g" aria-label="Carbs in grams" class="w-20 border-b bg-transparent px-2 py-2 text-sm outline-none placeholder:text-muted-foreground/50" />
        <input v-model.number="fat" min="0" step="0.1" type="number" placeholder="Fat g" aria-label="Fat in grams" class="w-20 border-b bg-transparent px-2 py-2 text-sm outline-none placeholder:text-muted-foreground/50" />
      </template>
      <input v-model="date" required type="date" class="bg-transparent px-2 py-2 text-xs text-muted-foreground outline-none" /><button :disabled="isSaving || (tab === 'meals' && macroInputsIncomplete) || (tab === 'workouts' && !validWeightGroups(weightGroups))" class="rounded bg-foreground px-3 py-2 text-xs text-background disabled:opacity-40"><Loader2 v-if="isSaving" class="h-3.5 w-3.5 animate-spin" /><span v-else>Add</span></button><button type="button" class="p-2 text-muted-foreground hover:text-foreground" aria-label="Cancel" @click="cancelAdd"><X class="h-4 w-4" /></button>
      <p v-if="tab === 'meals' && macroInputsIncomplete" class="w-full text-xs text-muted-foreground">Enter all three macros, or leave them blank.</p>
    </form>
    <section v-if="tab === 'meals' && showSavedMeals" id="saved-meals-panel" class="mb-8 border-b border-border/60 pb-6">
      <h2 class="text-sm font-semibold">Saved meals</h2>
      <p class="mt-1 text-xs text-muted-foreground">Nutrition for one serving, saved by the bot for future meal logs.</p>
      <p v-if="savedMealsLoading" class="mt-4 text-sm text-muted-foreground">Loading saved meals…</p>
      <p v-else-if="savedMealsError" role="alert" class="mt-4 text-sm text-destructive">Couldn't load saved meals. Please try refreshing.</p>
      <p v-else-if="!savedMeals?.length" class="mt-4 text-sm text-muted-foreground">No saved meals yet. Send the bot a named food with its calories to save it here.</p>
      <ul v-else class="mt-3 divide-y divide-border/60">
        <li v-for="reference in savedMeals" :key="reference.id" class="flex flex-wrap items-start justify-between gap-x-4 gap-y-1 py-3 first:pt-0">
          <div class="min-w-0 flex-1">
            <p class="break-words text-sm font-medium">{{ reference.name }}</p>
            <p v-if="reference.proteinGrams !== undefined && reference.carbsGrams !== undefined && reference.fatGrams !== undefined" class="mt-1 text-xs tabular-nums text-muted-foreground">P {{ formatGrams(reference.proteinGrams) }}g · C {{ formatGrams(reference.carbsGrams) }}g · F {{ formatGrams(reference.fatGrams) }}g</p>
          </div>
          <div class="shrink-0 text-right">
            <p class="text-sm tabular-nums">{{ reference.calories.toLocaleString() }} kcal</p>
            <p v-if="reference.nutritionEstimated" class="text-xs text-muted-foreground">Estimated</p>
          </div>
        </li>
      </ul>
    </section>
    <div v-if="isLoading" class="py-10 text-sm text-muted-foreground">Loading…</div>
    <div v-else-if="groupedEntries.length === 0" class="py-10 text-sm text-muted-foreground">No {{ tab === 'workouts' ? 'workouts' : 'meals' }} this month.</div>
    <div v-else-if="tab === 'workouts'" class="space-y-7">
      <section v-for="[day, dayEntries] in groupedEntries" :key="day">
        <h3 v-if="editingDay?.kind !== 'exercise' || editingDay.date !== day" class="mb-3 text-sm font-semibold"><button type="button" class="rounded-sm text-left hover:underline hover:underline-offset-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2" :aria-label="`Change date for workouts on ${formatDate(day)}`" @click="startDayDateEdit('exercise', day)">{{ formatDate(day) }}</button></h3>
        <form v-else class="mb-3 flex flex-wrap items-end gap-x-3 gap-y-2" @submit.prevent="saveDayDate">
          <label class="text-xs text-muted-foreground">Workout date<input ref="dayDateInput" v-model="dayDate" required type="date" class="mt-1 block rounded-md border bg-background px-3 py-2 text-base text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring sm:text-sm" @keydown.escape.prevent="editingDay = null" /></label>
          <button type="submit" class="rounded-md bg-foreground px-3 py-2 text-xs text-background disabled:opacity-40" :disabled="isMovingDay || !dayDate">{{ isMovingDay ? 'Saving…' : 'Save' }}</button>
          <button type="button" class="px-1 py-2 text-xs text-muted-foreground hover:text-foreground" @click="editingDay = null">Cancel</button>
          <p class="w-full text-xs text-muted-foreground">Moves all {{ groupSessions(dayEntries).length }} {{ groupSessions(dayEntries).length === 1 ? 'workout' : 'workouts' }} on this date.</p>
          <p v-if="dayError" role="alert" class="w-full text-xs text-destructive">{{ dayError }}</p>
        </form>
        <div v-for="([sessionId, sessionEntries], sessionIndex) in groupSessions(dayEntries)" :key="sessionId" class="border-b border-border/60 pb-3 pt-1 last:border-b-0">
          <p v-if="groupSessions(dayEntries).length > 1" class="py-1 text-xs font-medium text-muted-foreground">Workout {{ sessionIndex + 1 }}</p>
          <div v-for="entry in sessionEntries" :key="entry._id">
            <form v-if="editingId === entry._id" class="my-2 rounded-md border border-border bg-accent/20 p-3" @submit.prevent="saveEdit(entry)">
              <label class="block text-xs text-muted-foreground">Exercise<input v-model="editValue" required class="mt-1 block w-full rounded-md border bg-background px-3 py-2 text-base text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring sm:text-sm" @keydown.escape="editingId = null" /></label>
              <div class="mt-3 space-y-2">
                <div v-for="(group, index) in editWeightGroups" :key="index" class="flex flex-wrap items-end gap-2">
                  <label class="text-xs text-muted-foreground">Sets<input v-model.number="group.sets" min="1" step="1" type="number" class="mt-1 block w-20 rounded-md border bg-background px-2 py-2 text-base text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring sm:text-sm" /></label>
                  <label class="text-xs text-muted-foreground">Weight (kg)<input v-model.number="group.weight" min="0" step="0.5" type="number" class="mt-1 block w-24 rounded-md border bg-background px-2 py-2 text-base text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring sm:text-sm" /></label>
                  <button v-if="editWeightGroups.length > 1" type="button" class="rounded-md p-2 text-muted-foreground hover:text-foreground focus-visible:outline focus-visible:outline-2" :aria-label="`Remove weight group ${index + 1}`" @click="editWeightGroups.splice(index, 1)"><X class="h-4 w-4" /></button>
                </div>
                <button type="button" class="text-xs text-primary hover:underline focus-visible:outline focus-visible:outline-2" @click="editWeightGroups.push({})"><Plus class="mr-1 inline h-3.5 w-3.5" />Add weight group</button>
              </div>
              <p v-if="editError" role="alert" class="mt-2 text-xs text-destructive">{{ editError }}</p>
              <div class="mt-3 flex items-center gap-3">
                <button type="submit" class="rounded-md bg-foreground px-3 py-2 text-xs text-background disabled:opacity-40" :disabled="isUpdating || !editValue.trim() || !validWeightGroups(editWeightGroups)">{{ isUpdating ? 'Saving…' : 'Save exercise' }}</button>
                <button type="button" class="px-1 py-2 text-xs text-muted-foreground hover:text-foreground" @click="editingId = null">Cancel</button>
              </div>
            </form>
            <div v-else class="flex min-h-10 min-w-0 items-center gap-2 py-1">
              <button type="button" class="min-w-0 flex-1 truncate text-left text-sm hover:underline hover:underline-offset-2 focus-visible:rounded-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2" :aria-label="`Edit ${entry.workoutType || 'exercise'}`" @click="startEdit(entry)">{{ entry.workoutType || 'Exercise' }}</button>
              <span class="max-w-[45%] truncate text-right text-xs tabular-nums text-muted-foreground">{{ rowText(entry) }}</span>
              <button type="button" class="shrink-0 rounded p-1 text-muted-foreground/60 transition-colors hover:text-destructive focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 disabled:text-destructive" :disabled="deletingId === entry._id" :aria-label="`Delete ${entry.workoutType || 'exercise'}`" @click="deleteEntry(entry._id)"><Loader2 v-if="deletingId === entry._id" class="h-3.5 w-3.5 animate-spin" /><X v-else class="h-3.5 w-3.5" /></button>
            </div>
          </div>
        </div>
      </section>
    </div>
    <div v-else class="space-y-7">
      <section v-for="day in mealDays" :key="day.day">
        <div class="flex items-start justify-between gap-3">
          <h3 v-if="editingDay?.kind !== 'meal' || editingDay.date !== day.day" class="text-sm font-semibold"><button type="button" class="rounded-sm text-left hover:underline hover:underline-offset-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2" :aria-label="`Change date for meals on ${formatDate(day.day)}`" @click="startDayDateEdit('meal', day.day)">{{ formatDate(day.day) }}</button></h3>
          <form v-else class="flex min-w-0 flex-wrap items-end gap-x-3 gap-y-2" @submit.prevent="saveDayDate">
            <label class="text-xs text-muted-foreground">Meal date<input ref="dayDateInput" v-model="dayDate" required type="date" class="mt-1 block rounded-md border bg-background px-3 py-2 text-base text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring sm:text-sm" @keydown.escape.prevent="editingDay = null" /></label>
            <button type="submit" class="rounded-md bg-foreground px-3 py-2 text-xs text-background disabled:opacity-40" :disabled="isMovingDay || !dayDate">{{ isMovingDay ? 'Saving…' : 'Save' }}</button>
            <button type="button" class="px-1 py-2 text-xs text-muted-foreground hover:text-foreground" @click="editingDay = null">Cancel</button>
            <p class="w-full text-xs text-muted-foreground">Moves all {{ day.entries.length }} {{ day.entries.length === 1 ? 'meal' : 'meals' }} on this date.</p>
            <p v-if="dayError" role="alert" class="w-full text-xs text-destructive">{{ dayError }}</p>
          </form>
          <strong class="shrink-0 text-base font-semibold tabular-nums">{{ day.calories.toLocaleString() }} kcal</strong>
        </div>
        <p class="mt-1 mb-3 text-sm tabular-nums text-muted-foreground">P {{ formatGrams(day.protein) }}g · C {{ formatGrams(day.carbs) }}g · F {{ formatGrams(day.fat) }}g</p>
        <p v-if="!day.macrosComplete" class="mb-3 text-xs text-muted-foreground">Some meals lack macros; these are logged amounts only.</p>
        <div v-for="entry in day.entries" :key="entry._id" class="border-t border-border/60">
          <div class="flex min-h-12 items-center gap-3">
            <button type="button" class="flex min-w-0 flex-1 items-center gap-3 py-2 text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2" :aria-expanded="expandedMealId === entry._id" @click="toggleMeal(entry._id)">
              <span class="min-w-0 flex-1 truncate text-sm">{{ entry.note || 'Meal' }}</span>
              <span class="shrink-0 text-xs tabular-nums text-muted-foreground">{{ entry.calories?.toLocaleString() }} kcal</span>
              <ChevronDown class="h-4 w-4 shrink-0 text-muted-foreground transition-transform" :class="expandedMealId === entry._id && 'rotate-180'" />
            </button>
          </div>
          <div v-if="expandedMealId === entry._id" :id="`meal-${entry._id}`" class="pb-4">
            <p class="mb-3 break-words text-sm font-medium">{{ entry.note || 'Meal' }}</p>
            <dl class="grid grid-cols-2 gap-x-4 gap-y-2 text-sm sm:grid-cols-4">
              <div><dt class="text-xs text-muted-foreground">Calories</dt><dd class="tabular-nums">{{ entry.calories?.toLocaleString() }} kcal</dd></div>
              <div><dt class="text-xs text-muted-foreground">Protein</dt><dd class="tabular-nums">{{ entry.proteinGrams === undefined ? '—' : `${formatGrams(entry.proteinGrams)}g` }}</dd></div>
              <div><dt class="text-xs text-muted-foreground">Carbs</dt><dd class="tabular-nums">{{ entry.carbsGrams === undefined ? '—' : `${formatGrams(entry.carbsGrams)}g` }}</dd></div>
              <div><dt class="text-xs text-muted-foreground">Fat</dt><dd class="tabular-nums">{{ entry.fatGrams === undefined ? '—' : `${formatGrams(entry.fatGrams)}g` }}</dd></div>
            </dl>
            <p v-if="entry.nutritionEstimated" class="mt-2 text-xs text-muted-foreground">Estimated from description</p>
            <div v-if="editingId === entry._id" class="mt-4 grid grid-cols-2 gap-3 text-sm">
              <label class="col-span-2">Meal<input v-model="editValue" class="mt-1 w-full rounded-md border bg-background px-3 py-2 outline-none focus-visible:ring-2 focus-visible:ring-ring" @keydown.escape="editingId = null" /></label>
              <label class="col-span-2">Date<input v-model="editDate" required type="date" class="mt-1 w-full rounded-md border bg-background px-3 py-2 outline-none focus-visible:ring-2 focus-visible:ring-ring" /></label>
              <label>Calories<input v-model.number="editCalories" min="1" type="number" class="mt-1 w-full rounded-md border bg-background px-3 py-2 outline-none focus-visible:ring-2 focus-visible:ring-ring" /></label>
              <label>Protein (g)<input v-model.number="editProtein" min="0" step="0.1" type="number" class="mt-1 w-full rounded-md border bg-background px-3 py-2 outline-none focus-visible:ring-2 focus-visible:ring-ring" /></label>
              <label>Carbs (g)<input v-model.number="editCarbs" min="0" step="0.1" type="number" class="mt-1 w-full rounded-md border bg-background px-3 py-2 outline-none focus-visible:ring-2 focus-visible:ring-ring" /></label>
              <label>Fat (g)<input v-model.number="editFat" min="0" step="0.1" type="number" class="mt-1 w-full rounded-md border bg-background px-3 py-2 outline-none focus-visible:ring-2 focus-visible:ring-ring" /></label>
              <p v-if="editError" role="alert" class="col-span-2 text-xs text-destructive">{{ editError }}</p>
              <div class="col-span-2 flex gap-4"><button type="button" class="font-medium underline underline-offset-2 disabled:opacity-40" :disabled="isUpdating || !editDate" @click="saveEdit(entry)">{{ isUpdating ? 'Saving…' : 'Save' }}</button><button type="button" class="text-muted-foreground underline underline-offset-2" @click="editingId = null">Cancel</button></div>
            </div>
            <div v-else class="mt-4 flex gap-5 text-sm"><button type="button" class="underline underline-offset-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2" :aria-label="`Edit ${entry.note || 'meal'}`" @click="startEdit(entry)">Edit meal</button><button type="button" class="text-destructive underline underline-offset-2 disabled:opacity-50" :disabled="deletingId === entry._id" @click="deleteEntry(entry._id)">{{ deletingId === entry._id ? 'Deleting…' : 'Delete meal' }}</button></div>
          </div>
        </div>
      </section>
    </div>
  </div>
</template>
