import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";
import { authTables } from "@convex-dev/auth/server";

export default defineSchema({
  ...authTables,

  // User accounts (linked to auth)
  users: defineTable({
    email: v.optional(v.string()),
    name: v.optional(v.string()),
    image: v.optional(v.string()),
    emailVerificationTime: v.optional(v.number()),
    telegramChatId: v.optional(v.string()),
    telegramOnboardingDismissedAt: v.optional(v.number()),
    activeProfileId: v.optional(v.id("profiles")),
  })
    .index("email", ["email"])
    .index("by_telegram", ["telegramChatId"]),

  // Family member profiles
  profiles: defineTable({
    userId: v.id("users"),
    name: v.string(),
    avatarColor: v.string(),
    isDefault: v.boolean(),
  }).index("by_user", ["userId"]),

  mcpClients: defineTable({
    clientId: v.string(),
    clientName: v.string(),
    redirectUris: v.array(v.string()),
    createdAt: v.number(),
  }).index("by_client_id", ["clientId"]),

  mcpEndpoints: defineTable({
    userId: v.id("users"),
    slug: v.string(),
    createdAt: v.number(),
  }).index("by_user", ["userId"]).index("by_slug", ["slug"]),

  mcpRateBuckets: defineTable({
    key: v.string(),
    count: v.number(),
    expiresAt: v.number(),
  }).index("by_key", ["key"]).index("by_expires", ["expiresAt"]),

  mcpUsageDaily: defineTable({
    userId: v.id("users"),
    day: v.string(),
    count: v.number(),
  }).index("by_user_day", ["userId", "day"]).index("by_day", ["day"]),

  mcpAuthorizationRequests: defineTable({
    requestId: v.string(),
    clientId: v.string(),
    clientName: v.string(),
    redirectUri: v.string(),
    resource: v.optional(v.string()),
    codeChallenge: v.string(),
    state: v.string(),
    expiresAt: v.number(),
  }).index("by_request_id", ["requestId"]).index("by_expires", ["expiresAt"]),

  mcpAuthorizationCodes: defineTable({
    codeHash: v.string(),
    clientId: v.string(),
    clientName: v.string(),
    redirectUri: v.string(),
    resource: v.optional(v.string()),
    codeChallenge: v.string(),
    userId: v.id("users"),
    expiresAt: v.number(),
  }).index("by_code_hash", ["codeHash"]).index("by_expires", ["expiresAt"]),

  mcpGrants: defineTable({
    userId: v.id("users"),
    clientId: v.string(),
    clientName: v.string(),
    resource: v.string(),
    scope: v.string(),
    createdAt: v.number(),
    lastUsedAt: v.number(),
    revokedAt: v.optional(v.number()),
  }).index("by_user", ["userId"]).index("by_created_at", ["createdAt"]),

  mcpAccessTokens: defineTable({
    tokenHash: v.string(),
    grantId: v.id("mcpGrants"),
    expiresAt: v.number(),
  }).index("by_token_hash", ["tokenHash"]).index("by_grant", ["grantId"]).index("by_expires", ["expiresAt"]),

  mcpRefreshTokens: defineTable({
    tokenHash: v.string(),
    grantId: v.id("mcpGrants"),
    expiresAt: v.number(),
    usedAt: v.optional(v.number()),
  }).index("by_token_hash", ["tokenHash"]).index("by_grant", ["grantId"]).index("by_expires", ["expiresAt"]),

  families: defineTable({
    name: v.string(),
    createdByUserId: v.id("users"),
  }).index("by_creator", ["createdByUserId"]),

  familyMembers: defineTable({
    familyId: v.id("families"),
    userId: v.id("users"),
    role: v.union(v.literal("owner"), v.literal("member")),
    invitedByUserId: v.optional(v.id("users")),
    joinedAt: v.number(),
  })
    .index("by_family", ["familyId"])
    .index("by_user", ["userId"])
    .index("by_family_user", ["familyId", "userId"]),

  familyInvites: defineTable({
    familyId: v.id("families"),
    email: v.string(),
    role: v.union(v.literal("owner"), v.literal("member")),
    invitedByUserId: v.id("users"),
    status: v.union(v.literal("pending"), v.literal("accepted"), v.literal("cancelled")),
    invitedUserId: v.optional(v.id("users")),
    createdAt: v.number(),
    acceptedAt: v.optional(v.number()),
  })
    .index("by_family", ["familyId"])
    .index("by_email", ["email"])
    .index("by_family_email", ["familyId", "email"]),

  // Asset and liability accounts
  accounts: defineTable({
    profileId: v.id("profiles"),
    name: v.string(),
    category: v.union(
      v.literal("asset"),
      v.literal("liability"),
    ),
    type: v.optional(v.string()),
    currency: v.string(),
    isActive: v.boolean(),
    displayOrder: v.number(),
  })
    .index("by_profile", ["profileId"])
    .index("by_profile_category", ["profileId", "category"]),

  // Balance history for accounts
  balanceHistory: defineTable({
    accountId: v.id("accounts"),
    amount: v.optional(v.number()),
    amountEnc: v.optional(v.string()),
    date: v.string(), // ISO date: YYYY-MM-DD
    note: v.optional(v.string()),
    noteEnc: v.optional(v.string()),
  })
    .index("by_account", ["accountId"])
    .index("by_account_date", ["accountId", "date"]),

  // Income categories (with grouping like expenses)
  incomeCategories: defineTable({
    name: v.string(),
    groupName: v.optional(v.string()),
    isActive: v.boolean(),
  }).index("by_group", ["groupName"]),

  // Income entries with jurisdiction
  incomeEntries: defineTable({
    profileId: v.id("profiles"),
    categoryId: v.id("incomeCategories"),
    amount: v.optional(v.number()),
    amountEnc: v.optional(v.string()),
    // Optional cash actually credited for reconciliation; tax logic uses `amount`.
    netReceivedAmount: v.optional(v.number()),
    netReceivedAmountEnc: v.optional(v.string()),
    // Structured salary-level breakdown for verification and audit.
    salaryDetails: v.optional(
      v.object({
        baseAmount: v.optional(v.number()),
        bonusAmount: v.optional(v.number()),
        allowanceAmount: v.optional(v.number()),
        reimbursementAmount: v.optional(v.number()),
        otherTaxableBenefitsAmount: v.optional(v.number()),
        socialSecurityEmployeeAmount: v.optional(v.number()),
        taxWithheldAmount: v.optional(v.number()),
      }),
    ),
    salaryDetailsEnc: v.optional(
      v.object({
        baseAmountEnc: v.optional(v.string()),
        bonusAmountEnc: v.optional(v.string()),
        allowanceAmountEnc: v.optional(v.string()),
        reimbursementAmountEnc: v.optional(v.string()),
        otherTaxableBenefitsAmountEnc: v.optional(v.string()),
        socialSecurityEmployeeAmountEnc: v.optional(v.string()),
        taxWithheldAmountEnc: v.optional(v.string()),
      }),
    ),
    currency: v.optional(
      v.union(v.literal("INR"), v.literal("USD"), v.literal("THB")),
    ),
    date: v.string(), // ISO date
    jurisdiction: v.union(
      v.literal("IN"), // India
      v.literal("US"), // United States
      v.literal("TH"), // Thailand
    ),
    incomeType: v.union(
      v.literal("salary"),
      v.literal("business"),
      v.literal("investment"),
      v.literal("other"),
    ),
    note: v.optional(v.string()),
    noteEnc: v.optional(v.string()),
    source: v.union(
      v.literal("manual"),
      v.literal("bot"),
      v.literal("csv_import"),
    ),
  })
    .index("by_profile", ["profileId"])
    .index("by_profile_date", ["profileId", "date"])
    .index("by_profile_jurisdiction", ["profileId", "jurisdiction"]),

  // Expense categories
  expenseCategories: defineTable({
    name: v.string(),
    groupName: v.string(),
    isActive: v.boolean(),
  }).index("by_group", ["groupName"]),

  // Expense entries
  expenseEntries: defineTable({
    profileId: v.id("profiles"),
    categoryId: v.id("expenseCategories"),
    amount: v.optional(v.number()),
    amountEnc: v.optional(v.string()),
    currency: v.optional(
      v.union(v.literal("INR"), v.literal("USD"), v.literal("THB")),
    ), // Default to INR if not specified
    date: v.string(), // ISO date
    note: v.optional(v.string()),
    noteEnc: v.optional(v.string()),
    source: v.union(
      v.literal("manual"),
      v.literal("bot"),
      v.literal("csv_import"),
    ),
  })
    .index("by_profile", ["profileId"])
    .index("by_profile_date", ["profileId", "date"]),

  tripReports: defineTable({
    profileId: v.id("profiles"),
    ownerUserId: v.id("users"),
    slug: v.string(),
    title: v.string(),
    place: v.string(),
    ownerName: v.string(),
    participants: v.array(v.string()),
    passcodeHash: v.string(),
    sharePasscodeHash: v.optional(v.string()),
    shareCodeEnc: v.optional(v.string()),
    expiresAt: v.number(),
    createdAt: v.number(),
    failedAttempts: v.number(),
    lockedUntil: v.optional(v.number()),
    separateCurrencies: v.boolean(),
    candidateTruncated: v.boolean(),
    excludedExpenseIds: v.optional(v.array(v.id("expenseEntries"))),
  }).index("by_slug", ["slug"]).index("by_owner", ["ownerUserId"]),

  tripReportEntries: defineTable({
    reportId: v.id("tripReports"),
    expenseId: v.optional(v.id("expenseEntries")),
    date: v.string(),
    noteEnc: v.string(),
    amountEnc: v.string(),
    currency: v.union(v.literal("INR"), v.literal("USD"), v.literal("THB")),
    rateToInr: v.number(),
    fxSource: v.union(v.literal("service"), v.literal("fallback")),
    fxDate: v.optional(v.string()),
    paidBy: v.string(),
    payerInferred: v.optional(v.boolean()),
    matchInferred: v.optional(v.boolean()),
    splitWith: v.array(v.string()),
    splitCustomized: v.boolean(),
    source: v.union(v.literal("detected"), v.literal("owner"), v.literal("guest")),
    status: v.union(v.literal("approved"), v.literal("pending"), v.literal("rejected")),
    submittedBy: v.optional(v.string()),
    createdAt: v.number(),
  }).index("by_report", ["reportId"]).index("by_report_expense", ["reportId", "expenseId"]).index("by_expense", ["expenseId"]),

  tripReportSettlements: defineTable({
    reportId: v.id("tripReports"),
    date: v.string(),
    from: v.string(),
    to: v.string(),
    amountEnc: v.string(),
    currency: v.union(v.literal("INR"), v.literal("USD"), v.literal("THB")),
    rateToInr: v.number(),
    fxDate: v.optional(v.string()),
    createdAt: v.number(),
  }).index("by_report", ["reportId"]),

  tripReportSessions: defineTable({
    reportId: v.id("tripReports"),
    token: v.string(),
    expiresAt: v.number(),
  }).index("by_token", ["token"]),

  // Private wellness log entries captured alongside the household ledger.
  healthEntries: defineTable({
    profileId: v.id("profiles"),
    kind: v.union(v.literal("exercise"), v.literal("meal")),
    sessionId: v.optional(v.string()),
    calories: v.optional(v.number()),
    proteinGrams: v.optional(v.number()),
    carbsGrams: v.optional(v.number()),
    fatGrams: v.optional(v.number()),
    nutritionEstimated: v.optional(v.boolean()),
    durationMinutes: v.optional(v.number()),
    workoutType: v.optional(v.string()),
    sets: v.optional(v.number()),
    weight: v.optional(v.number()),
    weightGroups: v.optional(v.array(v.object({ sets: v.number(), weight: v.number() }))),
    noteEnc: v.optional(v.string()),
    date: v.string(),
    source: v.union(v.literal("manual"), v.literal("bot")),
  })
    .index("by_profile", ["profileId"])
    .index("by_profile_date", ["profileId", "date"]),

  mealReferences: defineTable({
    profileId: v.id("profiles"),
    nameEnc: v.string(),
    calories: v.number(),
    proteinGrams: v.optional(v.number()),
    carbsGrams: v.optional(v.number()),
    fatGrams: v.optional(v.number()),
    nutritionEstimated: v.boolean(),
    timesUsed: v.number(),
    updatedAt: v.number(),
  }).index("by_profile", ["profileId"]),

  // Tax payments (advance tax, TDS, withholding)
  taxPayments: defineTable({
    profileId: v.id("profiles"),
    jurisdiction: v.union(
      v.literal("IN"), // India
      v.literal("US"), // United States
      v.literal("TH"), // Thailand
    ),
    paymentType: v.union(
      v.literal("advance_tax"), // India advance tax
      v.literal("tds"), // TDS from salary/interest
      v.literal("withholding"), // US/TH withholding
      v.literal("self_assessment"), // Self-assessment payment
    ),
    amount: v.optional(v.number()),
    amountEnc: v.optional(v.string()),
    currency: v.union(v.literal("INR"), v.literal("USD"), v.literal("THB")),
    date: v.string(), // ISO date
    fiscalYear: v.string(), // e.g., "2025-26" or "2025"
    note: v.optional(v.string()),
    noteEnc: v.optional(v.string()),
    source: v.union(v.literal("manual"), v.literal("bot")),
  })
    .index("by_profile", ["profileId"])
    .index("by_profile_jurisdiction", ["profileId", "jurisdiction"])
    .index("by_profile_year", ["profileId", "fiscalYear"]),

  // Tax residency by fiscal year (for cross-border tax computation)
  taxResidency: defineTable({
    profileId: v.id("profiles"),
    fiscalYear: v.string(),
    jurisdiction: v.union(v.literal("IN"), v.literal("US"), v.literal("TH")),
    isResident: v.boolean(),
    note: v.optional(v.string()),
    noteEnc: v.optional(v.string()),
    source: v.union(v.literal("manual"), v.literal("bot")),
  })
    .index("by_profile", ["profileId"])
    .index("by_profile_year", ["profileId", "fiscalYear"])
    .index("by_profile_year_jurisdiction", [
      "profileId",
      "fiscalYear",
      "jurisdiction",
    ]),

  // Cached FX rates (SBI TTB to INR) fetched via worker action.
  fxRates: defineTable({
    currency: v.union(v.literal("INR"), v.literal("USD"), v.literal("THB")),
    date: v.string(), // YYYY-MM-DD
    rateToInr: v.number(),
    source: v.union(v.literal("service"), v.literal("fallback")),
    endpoint: v.optional(v.string()),
    status: v.optional(v.number()),
    fetchedAt: v.number(),
  }).index("by_currency_date", ["currency", "date"]),

  // Telegram bot link codes (temporary, for account linking)
  telegramLinkCodes: defineTable({
    code: v.string(),
    chatId: v.string(),
    expiresAt: v.number(), // Unix timestamp
  })
    .index("by_code", ["code"])
    .index("by_chatId", ["chatId"]),

  // User AI provider + key settings for BYOK / managed routing.
  aiSettings: defineTable({
    userId: v.id("users"),
    mode: v.union(v.literal("BYOK"), v.literal("MANAGED")),
    provider: v.union(v.literal("google")),
    encryptedApiKey: v.optional(v.string()),
    keyLast4: v.optional(v.string()),
    isActive: v.boolean(),
    createdAt: v.number(),
    updatedAt: v.number(),
  }).index("by_user", ["userId"]),

  // Daily AI usage counters for fair-use throttling.
  aiUsageDaily: defineTable({
    userId: v.id("users"),
    date: v.string(), // YYYY-MM-DD
    mode: v.union(v.literal("BYOK"), v.literal("MANAGED")),
    count: v.number(),
    updatedAt: v.number(),
  })
    .index("by_user_date", ["userId", "date"])
    .index("by_user_date_mode", ["userId", "date", "mode"]),

  // Recent AI parse errors / fallback notes for debugging in Convex.
  aiParseLogs: defineTable({
    userId: v.id("users"),
    profileId: v.optional(v.id("profiles")),
    chatId: v.optional(v.string()),
    messageTextEnc: v.optional(v.string()),
    model: v.optional(v.string()),
    stage: v.string(),
    severity: v.union(v.literal("warn"), v.literal("error")),
    errorMessage: v.optional(v.string()),
    httpStatus: v.optional(v.number()),
    provider: v.optional(v.string()),
    createdAt: v.number(),
  })
    .index("by_user_created", ["userId", "createdAt"])
    .index("by_created", ["createdAt"]),

  // Idempotency receipts for inbound Telegram messages. A webhook retry must
  // never send a second failure reply or process the same transaction twice.
  telegramMessageReceipts: defineTable({
    chatId: v.string(),
    messageId: v.string(),
    createdAt: v.number(),
  }).index("by_chat_message", ["chatId", "messageId"]),

  // Last records Q&A per Telegram chat so short follow-ups keep context.
  telegramQueryContext: defineTable({
    chatId: v.string(),
    profileId: v.id("profiles"),
    lastQuestion: v.string(),
    updatedAt: v.number(),
  }).index("by_chat_profile", ["chatId", "profileId"]),

  // Managed AI entitlement state (for paid routing enforcement).
  aiManagedEntitlements: defineTable({
    userId: v.id("users"),
    status: v.union(v.literal("active"), v.literal("inactive")),
    source: v.union(v.literal("manual"), v.literal("billing_webhook")),
    planCode: v.optional(v.string()),
    subscriptionId: v.optional(v.string()),
    providerEventAt: v.optional(v.number()),
    dailyLimit: v.optional(v.number()),
    createdAt: v.number(),
    updatedAt: v.number(),
  }).index("by_user", ["userId"]),
});
