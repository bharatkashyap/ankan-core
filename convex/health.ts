import { mutation, query } from "./_generated/server";
import { v } from "convex/values";
import { requireProfileAccess } from "./lib/auth";
import { entriesInHealthDay, entriesInWorkoutSession } from "./lib/healthSessions";
import {
  decryptStringWithFallback,
  encryptOptionalString,
} from "./lib/fieldEncryption";

const healthKind = v.union(v.literal("exercise"), v.literal("meal"));
const weightGroupsValidator = v.array(v.object({ sets: v.number(), weight: v.number() }));

function validDate(value: string) {
  const timestamp = Date.parse(`${value}T00:00:00Z`);
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(timestamp)
    && new Date(timestamp).toISOString().slice(0, 10) === value;
}

function validateWeightGroups(groups: { sets: number; weight: number }[] | undefined, allowEmpty = false) {
  if (groups === undefined) return;
  if ((!allowEmpty && groups.length === 0) || groups.some(({ sets, weight }) => !Number.isSafeInteger(sets) || sets < 1 || !Number.isFinite(weight) || weight < 0)) {
    throw new Error("Each weight group needs a positive set count and a non-negative weight");
  }
}

async function hydrate<T extends { note?: string; noteEnc?: string }>(row: T) {
  return { ...row, note: await decryptStringWithFallback(row.noteEnc, row.note) };
}

export const listByMonth = query({
  args: { profileId: v.id("profiles"), monthYear: v.string() },
  handler: async (ctx, args) => {
    await requireProfileAccess(ctx, args.profileId);
    const rows = await ctx.db
      .query("healthEntries")
      .withIndex("by_profile_date", (q) => q.eq("profileId", args.profileId))
      .collect();
    return await Promise.all(
      rows.filter((row) => row.date.startsWith(args.monthYear)).map(hydrate),
    );
  },
});

export const listMealReferences = query({
  args: { profileId: v.id("profiles") },
  handler: async (ctx, { profileId }) => {
    await requireProfileAccess(ctx, profileId);
    const rows = await ctx.db.query("mealReferences")
      .withIndex("by_profile", (q) => q.eq("profileId", profileId))
      .collect();
    const references = await Promise.all(rows.map(async (row) => ({
      id: row._id,
      name: (await decryptStringWithFallback(row.nameEnc, undefined)) || "",
      calories: row.calories,
      proteinGrams: row.proteinGrams,
      carbsGrams: row.carbsGrams,
      fatGrams: row.fatGrams,
      nutritionEstimated: row.nutritionEstimated,
      updatedAt: row.updatedAt,
    })));
    return references.sort((a, b) => b.updatedAt - a.updatedAt);
  },
});

export const add = mutation({
  args: {
    profileId: v.id("profiles"),
    kind: healthKind,
    calories: v.optional(v.number()),
    proteinGrams: v.optional(v.number()),
    carbsGrams: v.optional(v.number()),
    fatGrams: v.optional(v.number()),
    nutritionEstimated: v.optional(v.boolean()),
    durationMinutes: v.optional(v.number()),
    workoutType: v.optional(v.string()),
    sets: v.optional(v.number()),
    weight: v.optional(v.number()),
    weightGroups: v.optional(weightGroupsValidator),
    note: v.optional(v.string()),
    date: v.string(),
  },
  handler: async (ctx, args) => {
    await requireProfileAccess(ctx, args.profileId);
    if (args.kind === "meal" && (!args.calories || args.calories <= 0)) {
      throw new Error("Calories must be greater than zero");
    }
    if ([args.proteinGrams, args.carbsGrams, args.fatGrams].some((value) => value !== undefined && (!Number.isFinite(value) || value < 0))) {
      throw new Error("Macros must be non-negative numbers");
    }
    const macros = [args.proteinGrams, args.carbsGrams, args.fatGrams];
    if (args.kind === "meal" && macros.some((value) => value !== undefined) && macros.some((value) => value === undefined)) {
      throw new Error("Enter protein, carbs, and fat together");
    }
    if (args.kind === "exercise" && !args.workoutType?.trim()) {
      throw new Error("Exercise is required");
    }
    if (args.weightGroups !== undefined && args.kind !== "exercise") throw new Error("Weight groups are only for exercises");
    validateWeightGroups(args.weightGroups);
    return await ctx.db.insert("healthEntries", {
      profileId: args.profileId,
      kind: args.kind,
      calories: args.calories,
      proteinGrams: args.proteinGrams,
      carbsGrams: args.carbsGrams,
      fatGrams: args.fatGrams,
      nutritionEstimated: args.nutritionEstimated,
      durationMinutes: args.durationMinutes,
      workoutType: args.workoutType?.trim(),
      sets: args.weightGroups?.reduce((sum, group) => sum + group.sets, 0) ?? args.sets,
      weight: args.weightGroups ? (args.weightGroups.length === 1 ? args.weightGroups[0].weight : undefined) : args.weight,
      weightGroups: args.weightGroups,
      noteEnc: await encryptOptionalString(args.note),
      date: args.date,
      source: "manual",
    });
  },
});

export const update = mutation({
  args: {
    entryId: v.id("healthEntries"),
    calories: v.optional(v.number()),
    proteinGrams: v.optional(v.number()),
    carbsGrams: v.optional(v.number()),
    fatGrams: v.optional(v.number()),
    durationMinutes: v.optional(v.number()),
    workoutType: v.optional(v.string()),
    sets: v.optional(v.number()),
    weight: v.optional(v.number()),
    weightGroups: v.optional(weightGroupsValidator),
    note: v.optional(v.string()),
    date: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const row = await ctx.db.get(args.entryId);
    if (!row) throw new Error("Health entry not found");
    await requireProfileAccess(ctx, row.profileId);
    if (row.kind === "exercise" && args.date !== undefined) throw new Error("Change workout dates for the full session");
    if (row.kind === "meal" && args.calories !== undefined && args.calories <= 0) throw new Error("Calories must be greater than zero");
    if ([args.proteinGrams, args.carbsGrams, args.fatGrams].some((value) => value !== undefined && (!Number.isFinite(value) || value < 0))) throw new Error("Macros must be non-negative numbers");
    if (row.kind === "exercise" && args.workoutType !== undefined && !args.workoutType.trim()) throw new Error("Exercise is required");
    if (args.weightGroups !== undefined && row.kind !== "exercise") throw new Error("Weight groups are only for exercises");
    validateWeightGroups(args.weightGroups, true);
    await ctx.db.patch(args.entryId, {
      ...(args.calories !== undefined ? { calories: args.calories } : {}),
      ...(args.proteinGrams !== undefined ? { proteinGrams: args.proteinGrams } : {}),
      ...(args.carbsGrams !== undefined ? { carbsGrams: args.carbsGrams } : {}),
      ...(args.fatGrams !== undefined ? { fatGrams: args.fatGrams } : {}),
      ...(args.durationMinutes !== undefined ? { durationMinutes: args.durationMinutes } : {}),
      ...(args.workoutType !== undefined ? { workoutType: args.workoutType.trim() } : {}),
      ...(args.weightGroups?.length
        ? {
            weightGroups: args.weightGroups,
            sets: args.weightGroups.reduce((sum, group) => sum + group.sets, 0),
            weight: args.weightGroups.length === 1 ? args.weightGroups[0].weight : undefined,
          }
        : {
            ...(args.weightGroups !== undefined ? { weightGroups: undefined, sets: args.sets, weight: args.weight } : {}),
            ...(args.sets !== undefined ? { sets: args.sets } : {}),
            ...(args.weight !== undefined ? { weight: args.weight } : {}),
          }),
      ...(args.date !== undefined ? { date: args.date } : {}),
      ...(args.note !== undefined ? { noteEnc: await encryptOptionalString(args.note) } : {}),
    });
  },
});

export const updateWorkoutSessionDate = mutation({
  args: { entryId: v.id("healthEntries"), date: v.string() },
  handler: async (ctx, args) => {
    const entry = await ctx.db.get(args.entryId);
    if (!entry || entry.kind !== "exercise") throw new Error("Workout not found");
    await requireProfileAccess(ctx, entry.profileId);
    if (!validDate(args.date)) {
      throw new Error("Choose a valid workout date");
    }
    const entries = entry.sessionId
      ? entriesInWorkoutSession(entry, await ctx.db.query("healthEntries")
          .withIndex("by_profile_date", (q) => q.eq("profileId", entry.profileId))
          .collect())
      : [entry];
    for (const row of entries) await ctx.db.patch(row._id, { date: args.date });
    return entries.length;
  },
});

export const updateDayDate = mutation({
  args: {
    profileId: v.id("profiles"),
    kind: healthKind,
    fromDate: v.string(),
    date: v.string(),
  },
  handler: async (ctx, args) => {
    await requireProfileAccess(ctx, args.profileId);
    if (!validDate(args.fromDate) || !validDate(args.date)) throw new Error("Choose a valid date");
    if (args.fromDate === args.date) return 0;

    const dayEntries = (await ctx.db.query("healthEntries")
      .withIndex("by_profile_date", (q) => q.eq("profileId", args.profileId).eq("date", args.fromDate))
      .collect()).filter((row) => row.kind === args.kind);
    if (dayEntries.length === 0) throw new Error("No entries found for this date");

    // A workout session must stay together even if older data has its exercises on different dates.
    const candidates = args.kind === "exercise" && dayEntries.some((row) => row.sessionId)
      ? await ctx.db.query("healthEntries")
          .withIndex("by_profile", (q) => q.eq("profileId", args.profileId))
          .collect()
      : dayEntries;
    const entriesToMove = entriesInHealthDay(dayEntries, candidates, args.profileId, args.kind, args.fromDate);
    for (const row of entriesToMove) await ctx.db.patch(row._id, { date: args.date });
    return entriesToMove.length;
  },
});

export const remove = mutation({
  args: { entryId: v.id("healthEntries") },
  handler: async (ctx, args) => {
    const row = await ctx.db.get(args.entryId);
    if (!row) throw new Error("Health entry not found");
    await requireProfileAccess(ctx, row.profileId);
    await ctx.db.delete(args.entryId);
  },
});
