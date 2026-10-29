import { internalMutation, internalQuery, mutation, query } from "./_generated/server";
import { v } from "convex/values";
import { requireAuth } from "./lib/auth";
import {
  decryptSecretString,
  encryptOptionalString,
  encryptSecretString,
} from "./lib/fieldEncryption";

const DEFAULT_PROVIDER = "google" as const;
const DEFAULT_MODE = "MANAGED" as const;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

type RuntimeMode = "BYOK" | "MANAGED";
type ManagedPlanTier = "TRIAL" | "PAID" | "EXPIRED";
type AccessState = {
  managedPlanTier: ManagedPlanTier;
  trialStartedAt: number | null;
  trialEndsAt: number | null;
  trialDaysRemaining: number;
  trialIsActive: boolean;
  entitlementActive: boolean;
  entitlementPlanCode: string | null;
  entitlementDailyLimit: number | null;
};

function getNumericEnv(key: string, fallback: number) {
  const raw = process.env[key];
  if (!raw) return fallback;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? Math.trunc(parsed) : fallback;
}

function getPersonalDailyLimit() {
  return getNumericEnv("AI_DAILY_LIMIT_BYOK", 100);
}

function getTrialDurationDays() {
  return getNumericEnv("AI_TRIAL_DAYS", 15);
}

function getManagedTrialDailyLimit() {
  const explicitTrial = process.env.AI_DAILY_LIMIT_MANAGED_TRIAL;
  if (explicitTrial) {
    return getNumericEnv("AI_DAILY_LIMIT_MANAGED_TRIAL", 20);
  }
  return getNumericEnv("AI_DAILY_LIMIT_MANAGED_FREE", 20);
}

function getManagedPaidDailyLimit() {
  const explicitPaid = process.env.AI_DAILY_LIMIT_MANAGED_PAID;
  if (explicitPaid) {
    return getNumericEnv("AI_DAILY_LIMIT_MANAGED_PAID", 20);
  }
  return getNumericEnv("AI_DAILY_LIMIT_MANAGED", 20);
}

function getDailyLimit(mode: RuntimeMode, accessState: AccessState) {
  if (accessState.managedPlanTier === "TRIAL") return getManagedTrialDailyLimit();
  if (mode === "BYOK") return getPersonalDailyLimit();
  if (accessState.managedPlanTier === "EXPIRED") return 0;
  return accessState.entitlementDailyLimit ?? getManagedPaidDailyLimit();
}

function getEffectiveMode(mode: RuntimeMode, accessState: AccessState): RuntimeMode {
  if (mode === "MANAGED" && accessState.managedPlanTier === "EXPIRED") {
    return "BYOK";
  }
  return mode;
}

function getTodayKey() {
  return new Date().toISOString().slice(0, 10);
}

async function getAccessState(ctx: any, userId: any): Promise<AccessState> {
  if (process.env.SELF_HOSTED_MODE === "1") {
    return {
      managedPlanTier: "PAID",
      trialStartedAt: null,
      trialEndsAt: null,
      trialDaysRemaining: 0,
      trialIsActive: false,
      entitlementActive: true,
      entitlementPlanCode: "SELF_HOSTED",
      entitlementDailyLimit: getManagedPaidDailyLimit(),
    };
  }
  const entitlement = await ctx.db
    .query("aiManagedEntitlements")
    .withIndex("by_user", (q: any) => q.eq("userId", userId))
    .first();
  const entitlementActive = entitlement?.status === "active";
  const entitlementDailyLimit = entitlementActive && typeof entitlement?.dailyLimit === "number"
    && Number.isInteger(entitlement.dailyLimit) && entitlement.dailyLimit > 0
    ? entitlement.dailyLimit : null;
  const user = await ctx.db.get(userId);
  if (!user) {
    return {
      managedPlanTier: entitlementActive ? "PAID" : "EXPIRED",
      trialStartedAt: null,
      trialEndsAt: null,
      trialDaysRemaining: 0,
      trialIsActive: false,
      entitlementActive,
      entitlementPlanCode: entitlement?.planCode || null,
      entitlementDailyLimit,
    };
  }

  const now = Date.now();
  const trialStartedAt = user._creationTime;
  const trialEndsAt = trialStartedAt + getTrialDurationDays() * MS_PER_DAY;
  const trialIsActive = now < trialEndsAt;
  const trialDaysRemaining = trialIsActive
    ? Math.max(1, Math.ceil((trialEndsAt - now) / MS_PER_DAY))
    : 0;

  return {
    managedPlanTier: entitlementActive ? "PAID" : trialIsActive ? "TRIAL" : "EXPIRED",
    trialStartedAt,
    trialEndsAt,
    trialDaysRemaining,
    trialIsActive,
    entitlementActive,
    entitlementPlanCode: entitlement?.planCode || null,
    entitlementDailyLimit,
  };
}

async function upsertForUser(
  ctx: any,
  userId: any,
  patch: Partial<{
    mode: RuntimeMode;
    provider: "google";
    encryptedApiKey: string | undefined;
    keyLast4: string | undefined;
    isActive: boolean;
  }>,
) {
  const existing = await ctx.db
    .query("aiSettings")
    .withIndex("by_user", (q: any) => q.eq("userId", userId))
    .first();

  const now = Date.now();
  if (!existing) {
    const doc = {
      userId,
      mode: patch.mode || DEFAULT_MODE,
      provider: patch.provider || DEFAULT_PROVIDER,
      encryptedApiKey: patch.encryptedApiKey,
      keyLast4: patch.keyLast4,
      isActive: patch.isActive ?? false,
      createdAt: now,
      updatedAt: now,
    };
    const id = await ctx.db.insert("aiSettings", doc);
    return await ctx.db.get(id);
  }

  await ctx.db.patch(existing._id, {
    ...patch,
    updatedAt: now,
  });
  return await ctx.db.get(existing._id);
}

export const getMySettings = query({
  args: {},
  handler: async (ctx) => {
    const userId = await requireAuth(ctx);
    const accessState = await getAccessState(ctx, userId);
    const setting = await ctx.db
      .query("aiSettings")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .first();

    const configuredMode: RuntimeMode = (setting?.mode || DEFAULT_MODE) as RuntimeMode;
    const mode = getEffectiveMode(configuredMode, accessState);
    const date = getTodayKey();
    const usageRow = await ctx.db
      .query("aiUsageDaily")
      .withIndex("by_user_date_mode", (q) =>
        q.eq("userId", userId).eq("date", date).eq("mode", mode),
      )
      .first();

    const used = usageRow?.count || 0;
    const limit = getDailyLimit(mode, accessState);

    return {
      mode,
      provider: setting?.provider || DEFAULT_PROVIDER,
      hasByokKey: !!setting?.encryptedApiKey,
      hasPersonalKey: !!setting?.encryptedApiKey,
      keyLast4: setting?.keyLast4 || null,
      isActive: setting?.isActive || false,
      managedPlanTier: accessState.managedPlanTier,
      entitlementPlanCode: accessState.entitlementPlanCode,
      trial: {
        startsAt: accessState.trialStartedAt,
        endsAt: accessState.trialEndsAt,
        daysRemaining: accessState.trialDaysRemaining,
        isActive: accessState.trialIsActive,
        daysTotal: getTrialDurationDays(),
      },
      usage: {
        date,
        used,
        limit,
        remaining: Math.max(0, limit - used),
      },
      limits: {
        personal: getPersonalDailyLimit(),
        managedTrial: getManagedTrialDailyLimit(),
        managedPaid: accessState.entitlementDailyLimit ?? getManagedPaidDailyLimit(),
      },
    };
  },
});

export const recordParseLog = internalMutation({
  args: {
    userId: v.id("users"),
    profileId: v.optional(v.id("profiles")),
    chatId: v.optional(v.string()),
    messageText: v.optional(v.string()),
    model: v.optional(v.string()),
    stage: v.string(),
    severity: v.union(v.literal("warn"), v.literal("error")),
    errorMessage: v.optional(v.string()),
    httpStatus: v.optional(v.number()),
    provider: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await ctx.db.insert("aiParseLogs", {
      userId: args.userId,
      profileId: args.profileId,
      chatId: args.chatId,
      messageTextEnc: await encryptOptionalString(args.messageText),
      model: args.model,
      stage: args.stage,
      severity: args.severity,
      errorMessage: args.errorMessage,
      httpStatus: args.httpStatus,
      provider: args.provider,
      createdAt: Date.now(),
    });
  },
});

export const setMode = mutation({
  args: {
    mode: v.union(v.literal("BYOK"), v.literal("MANAGED")),
  },
  handler: async (ctx, args) => {
    const userId = await requireAuth(ctx);
    const setting = await upsertForUser(ctx, userId, { mode: args.mode });
    return {
      mode: setting?.mode || args.mode,
      provider: setting?.provider || DEFAULT_PROVIDER,
      hasByokKey: !!setting?.encryptedApiKey,
      hasPersonalKey: !!setting?.encryptedApiKey,
    };
  },
});

export const setByokKey = mutation({
  args: {
    provider: v.union(v.literal("google")),
    apiKey: v.string(),
  },
  handler: async (ctx, args) => {
    const userId = await requireAuth(ctx);
    const encryptedApiKey = await encryptSecretString(args.apiKey);
    const keyLast4 = args.apiKey.trim().slice(-4);
    const setting = await upsertForUser(ctx, userId, {
      provider: args.provider,
      encryptedApiKey,
      keyLast4,
      isActive: true,
      mode: "BYOK",
    });
    return {
      provider: setting?.provider || args.provider,
      mode: setting?.mode || "BYOK",
      keyLast4: setting?.keyLast4 || keyLast4,
      hasByokKey: true,
      hasPersonalKey: true,
    };
  },
});

export const clearByokKey = mutation({
  args: {},
  handler: async (ctx) => {
    const userId = await requireAuth(ctx);
    const setting = await upsertForUser(ctx, userId, {
      encryptedApiKey: undefined,
      keyLast4: undefined,
      isActive: false,
    });
    return {
      mode: setting?.mode || DEFAULT_MODE,
      hasByokKey: false,
      hasPersonalKey: false,
    };
  },
});

export const getUserAiRuntime = internalQuery({
  args: { userId: v.id("users") },
  handler: async (ctx, args) => {
    const accessState = await getAccessState(ctx, args.userId);
    const setting = await ctx.db
      .query("aiSettings")
      .withIndex("by_user", (q) => q.eq("userId", args.userId))
      .first();
    const configuredMode: RuntimeMode = (setting?.mode || DEFAULT_MODE) as RuntimeMode;
    const mode = getEffectiveMode(configuredMode, accessState);
    if (!setting) {
      return {
        mode,
        provider: DEFAULT_PROVIDER,
        encryptedApiKey: null,
      };
    }
    return {
      mode,
      provider: setting.provider,
      encryptedApiKey: setting.encryptedApiKey || null,
    };
  },
});

export const resolveRuntimeAiKey = internalQuery({
  args: { userId: v.id("users") },
  handler: async (ctx, args) => {
    const setting = await ctx.db
      .query("aiSettings")
      .withIndex("by_user", (q) => q.eq("userId", args.userId))
      .first();
    const accessState = await getAccessState(ctx, args.userId);
    const configuredMode: RuntimeMode = (setting?.mode || DEFAULT_MODE) as RuntimeMode;
    const mode = getEffectiveMode(configuredMode, accessState);

    if (mode === "MANAGED") {
      const managedKey = process.env.GOOGLE_AI_API_KEY || null;
      return {
        mode: "MANAGED" as const,
        provider: DEFAULT_PROVIDER,
        apiKey: managedKey,
        hasKey: !!managedKey,
        managedPlanTier: accessState.managedPlanTier,
        reason: managedKey ? null : ("managed_key_missing" as const),
      };
    }

    if (!setting?.encryptedApiKey) {
      return {
        mode: "BYOK" as const,
        provider: setting?.provider || DEFAULT_PROVIDER,
        apiKey: null,
        hasKey: false,
        managedPlanTier: accessState.managedPlanTier,
        reason: "personal_key_missing" as const,
      };
    }

    const apiKey = await decryptSecretString(setting.encryptedApiKey);
    return {
      mode: "BYOK" as const,
      provider: setting?.provider || DEFAULT_PROVIDER,
      apiKey,
      hasKey: true,
      managedPlanTier: accessState.managedPlanTier,
      reason: null,
    };
  },
});

export const setManagedEntitlement = internalMutation({
  args: {
    userId: v.id("users"),
    status: v.union(v.literal("active"), v.literal("inactive")),
    source: v.union(v.literal("manual"), v.literal("billing_webhook")),
    planCode: v.optional(v.string()),
    subscriptionId: v.optional(v.string()),
    providerEventAt: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    if (!(await ctx.db.get(args.userId))) throw new Error("Billing user not found");
    const existing = await ctx.db
      .query("aiManagedEntitlements")
      .withIndex("by_user", (q) => q.eq("userId", args.userId))
      .first();
    const now = Date.now();
    if (existing) {
      if (args.source === "billing_webhook") {
        if (existing.subscriptionId && existing.subscriptionId !== args.subscriptionId && args.status === "inactive") return existing;
        if (existing.subscriptionId === args.subscriptionId && existing.providerEventAt && args.providerEventAt && args.providerEventAt < existing.providerEventAt) return existing;
      }
      await ctx.db.patch(existing._id, {
        status: args.status,
        source: args.source,
        planCode: args.planCode,
        subscriptionId: args.subscriptionId ?? existing.subscriptionId,
        providerEventAt: args.providerEventAt ?? existing.providerEventAt,
        updatedAt: now,
      });
      return await ctx.db.get(existing._id);
    }
    const id = await ctx.db.insert("aiManagedEntitlements", {
      userId: args.userId,
      status: args.status,
      source: args.source,
      planCode: args.planCode,
      subscriptionId: args.subscriptionId,
      providerEventAt: args.providerEventAt,
      createdAt: now,
      updatedAt: now,
    });
    return await ctx.db.get(id);
  },
});

export const getBillingSubscription = internalQuery({
  args: { userId: v.id("users") },
  handler: async (ctx, { userId }) => {
    const entitlement = await ctx.db.query("aiManagedEntitlements")
      .withIndex("by_user", (q) => q.eq("userId", userId)).first();
    return entitlement?.subscriptionId ?? null;
  },
});

export const setManagedDailyLimit = internalMutation({
  args: { userId: v.id("users"), dailyLimit: v.number() },
  handler: async (ctx, args) => {
    if (!Number.isInteger(args.dailyLimit) || args.dailyLimit < 1 || args.dailyLimit > 1000) {
      throw new Error("Daily limit must be an integer between 1 and 1000");
    }
    const entitlement = await ctx.db
      .query("aiManagedEntitlements")
      .withIndex("by_user", (q) => q.eq("userId", args.userId))
      .first();
    if (!entitlement || entitlement.status !== "active") {
      throw new Error("An active managed AI entitlement is required");
    }
    await ctx.db.patch(entitlement._id, { dailyLimit: args.dailyLimit, updatedAt: Date.now() });
    return { userId: args.userId, dailyLimit: args.dailyLimit };
  },
});

export const getDailyQuotaStatus = internalQuery({
  args: {
    userId: v.id("users"),
    mode: v.union(v.literal("BYOK"), v.literal("MANAGED")),
  },
  handler: async (ctx, args) => {
    const date = getTodayKey();
    const accessState = await getAccessState(ctx, args.userId);
    const limit = getDailyLimit(args.mode, accessState);
    const existing = await ctx.db
      .query("aiUsageDaily")
      .withIndex("by_user_date_mode", (q) =>
        q.eq("userId", args.userId).eq("date", date).eq("mode", args.mode),
      )
      .first();

    const used = existing?.count || 0;
    return {
      allowed: limit > 0 && used < limit,
      limit,
      used,
      remaining: Math.max(0, limit - used),
      planTier: accessState.managedPlanTier,
      trialEndsAt: accessState.trialEndsAt,
      trialDaysRemaining: accessState.trialDaysRemaining,
    };
  },
});

export const consumeDailyQuota = internalMutation({
  args: {
    userId: v.id("users"),
    mode: v.union(v.literal("BYOK"), v.literal("MANAGED")),
  },
  handler: async (ctx, args) => {
    const date = getTodayKey();
    const accessState = await getAccessState(ctx, args.userId);
    const limit = getDailyLimit(args.mode, accessState);
    const existing = await ctx.db
      .query("aiUsageDaily")
      .withIndex("by_user_date_mode", (q) =>
        q.eq("userId", args.userId).eq("date", date).eq("mode", args.mode),
      )
      .first();

    const current = existing?.count || 0;
    if (limit <= 0) {
      return {
        allowed: false,
        limit,
        used: current,
        remaining: 0,
        planTier: accessState.managedPlanTier,
      };
    }

    if (current >= limit) {
      return {
        allowed: false,
        limit,
        used: current,
        remaining: 0,
        planTier: accessState.managedPlanTier,
      };
    }

    if (existing) {
      await ctx.db.patch(existing._id, {
        count: current + 1,
        updatedAt: Date.now(),
      });
    } else {
      await ctx.db.insert("aiUsageDaily", {
        userId: args.userId,
        date,
        mode: args.mode,
        count: 1,
        updatedAt: Date.now(),
      });
    }
    const used = current + 1;
    return {
      allowed: true,
      limit,
      used,
      remaining: Math.max(0, limit - used),
      planTier: accessState.managedPlanTier,
    };
  },
});
