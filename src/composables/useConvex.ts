import {
  ref,
  computed,
  shallowRef,
  watch,
  onUnmounted,
  getCurrentInstance,
} from "vue";
import type {
  FunctionReference,
  FunctionArgs,
  FunctionReturnType,
} from "convex/server";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { useAuthStore, getConvexClient, getStoredToken } from "@/stores/auth";

// =============================================================================
// RE-EXPORTS  (so existing imports don't break)
// =============================================================================
export { api, getConvexClient, getStoredToken };
export type { Id };
export { useAuthStore };

/** @deprecated — use `useAuthStore()` directly instead */
export function useAuth() {
  return useAuthStore();
}

// =============================================================================
// CORE CONVEX HOOKS
// =============================================================================

export function useConvexQuery<Q extends FunctionReference<"query">>(
  query: Q,
  args: () => FunctionArgs<Q> | "skip",
) {
  const data = shallowRef<FunctionReturnType<Q>>();
  const isLoading = ref(true);
  const error = ref<Error | null>(null);

  let unsub: (() => void) | null = null;

  const subscribe = (queryArgs: FunctionArgs<Q> | "skip") => {
    unsub?.();
    unsub = null;
    if (queryArgs === "skip") {
      isLoading.value = false;
      return;
    }
    isLoading.value = true;
    unsub = getConvexClient().onUpdate(query, queryArgs, (result) => {
      data.value = result;
      isLoading.value = false;
      error.value = null;
    });
  };

  const computedArgs = computed(args);
  subscribe(computedArgs.value);
  watch(computedArgs, (newArgs) => subscribe(newArgs));

  if (getCurrentInstance()) {
    onUnmounted(() => unsub?.());
  }

  return { data, isLoading, error };
}

export function useConvexMutation<M extends FunctionReference<"mutation">>(
  mutation: M,
) {
  const isLoading = ref(false);
  const error = ref<Error | null>(null);

  const mutate = async (
    args: FunctionArgs<M>,
  ): Promise<FunctionReturnType<M>> => {
    isLoading.value = true;
    error.value = null;
    try {
      return await getConvexClient().mutation(mutation, args);
    } catch (e) {
      error.value = e as Error;
      throw e;
    } finally {
      isLoading.value = false;
    }
  };

  return { mutate, isLoading, error };
}

export function useConvexAction<A extends FunctionReference<"action">>(
  action: A,
) {
  const isLoading = ref(false);
  const error = ref<Error | null>(null);

  const run = async (args: FunctionArgs<A>): Promise<FunctionReturnType<A>> => {
    isLoading.value = true;
    error.value = null;
    try {
      return await getConvexClient().action(action, args);
    } catch (e) {
      error.value = e as Error;
      throw e;
    } finally {
      isLoading.value = false;
    }
  };

  return { run, isLoading, error };
}

// =============================================================================
// USER DATA HOOK - populates auth store with user data
// =============================================================================
export function useCurrentUser() {
  const auth = useAuthStore();
  const { mutate: acceptPendingFamilyInvites } = useConvexMutation(
    api.users.acceptPendingFamilyInvites,
  );
  const { mutate: ensureUserWithProfile } = useConvexMutation(
    api.users.ensureUserWithProfile,
  );
  let acceptedInvitesOnce = false;
  let ensuredProfileOnce = false;

  // Only query when authenticated
  const { data, isLoading, error } = useConvexQuery(
    api.users.currentUser,
    () => (auth.isAuthenticated ? {} : "skip"),
  );

  // Watch for user data and update auth store
  watch(data, (user) => {
    if (user) {
      auth.userId = user._id;
      if (user.email) auth.email = user.email;
      if (user.activeProfileId) auth.profileId = user.activeProfileId;
      if (!ensuredProfileOnce) {
        ensuredProfileOnce = true;
        void ensureUserWithProfile({}).then((result) => {
          if (!auth.profileId && result?.profileId) {
            auth.profileId = result.profileId;
          }
        });
      }
      if (!acceptedInvitesOnce) {
        acceptedInvitesOnce = true;
        void acceptPendingFamilyInvites({});
      }
    }
  }, { immediate: true });

  return { user: data, isLoading, error };
}

// =============================================================================
// DOMAIN HOOKS
//
// Each hook reads from the Pinia auth store for profileId / userId.
// Pinia stores are reactive — accessing `store.profileId` inside a
// computed / arrow fn is automatically tracked. No `.value` needed.
// =============================================================================

// --- Profiles ---
export function useProfiles() {
  const { data, isLoading, error } = useConvexQuery(
    api.profiles.listAccessible,
    () => ({}),
  );

  return {
    profiles: computed(() => data.value || []),
    isLoading,
    error,
    createProfile: useConvexMutation(api.profiles.create).mutate,
    updateProfile: useConvexMutation(api.profiles.update).mutate,
    deleteProfile: useConvexMutation(api.profiles.remove).mutate,
  };
}

export function useFamilies() {
  const { data, isLoading, error } = useConvexQuery(
    api.families.listForCurrentUser,
    () => ({}),
  );
  return {
    families: computed(() => data.value || []),
    isLoading,
    error,
    createFamily: useConvexMutation(api.families.createFamily).mutate,
    inviteMember: useConvexMutation(api.families.inviteMember).mutate,
  };
}

export function useAISettings() {
  const { data, isLoading, error } = useConvexQuery(
    api.aiSettings.getMySettings,
    () => ({}),
  );

  const defaults = {
    mode: "MANAGED" as const,
    provider: "google" as const,
    hasByokKey: false,
    hasPersonalKey: false,
    keyLast4: null as string | null,
    isActive: false,
    managedPlanTier: "TRIAL" as const,
    entitlementPlanCode: null as string | null,
    trial: {
      startsAt: null as number | null,
      endsAt: null as number | null,
      daysRemaining: 15,
      isActive: true,
      daysTotal: 15,
    },
    usage: {
      date: "",
      used: 0,
      limit: 20,
      remaining: 20,
    },
    limits: {
      personal: 100,
      managedTrial: 20,
      managedPaid: 20,
    },
  };

  return {
    settings: computed(() => data.value || defaults),
    isLoading,
    error,
    setMode: useConvexMutation(api.aiSettings.setMode).mutate,
    setByokKey: useConvexMutation(api.aiSettings.setByokKey).mutate,
    clearByokKey: useConvexMutation(api.aiSettings.clearByokKey).mutate,
  };
}

// --- Accounts ---
export function useAccounts() {
  const auth = useAuthStore();
  const profileArgs = () =>
    auth.profileId ? { profileId: auth.profileId } : "skip";

  const {
    data: accounts,
    isLoading,
    error,
  } = useConvexQuery(api.accounts.listByProfile, profileArgs);
  const { data: balances, isLoading: balancesLoading } = useConvexQuery(
    api.accounts.getAllLatestBalances,
    profileArgs,
  );
  const { data: netWorthData } = useConvexQuery(
    api.accounts.getNetWorth,
    profileArgs,
  );

  const accountsList = computed(() => accounts.value || []);
  const defaultNetWorth = {
    assets: 0,
    liabilities: 0,
    netWorth: 0,
    assetsByCurrency: {},
    liabilitiesByCurrency: {},
    netWorthByCurrency: {},
  };

  return {
    accounts: accountsList,
    assets: computed(() =>
      accountsList.value.filter((a) => a.category === "asset"),
    ),
    liabilities: computed(() =>
      accountsList.value.filter((a) => a.category === "liability"),
    ),
    balances: computed(() => balances.value || {}),
    balancesLoading,
    netWorth: computed(() => netWorthData.value || defaultNetWorth),
    getBalance: (id: string) => (balances.value as any)?.[id]?.amount || 0,
    getBalanceDate: (id: string) => (balances.value as any)?.[id]?.date || "",
    isLoading,
    error,
    createAccount: useConvexMutation(api.accounts.create).mutate,
    updateAccount: useConvexMutation(api.accounts.update).mutate,
    deleteAccount: useConvexMutation(api.accounts.deactivate).mutate,
    addBalance: useConvexMutation(api.accounts.addBalance).mutate,
    updateBalance: useConvexMutation(api.accounts.updateBalance).mutate,
    deleteBalance: useConvexMutation(api.accounts.deleteBalance).mutate,
  };
}

export function useBalanceHistory(accountId: () => Id<"accounts"> | null) {
  const { data, isLoading, error } = useConvexQuery(
    api.accounts.getBalanceHistory,
    () => (accountId() ? { accountId: accountId()! } : "skip"),
  );
  return { history: computed(() => data.value || []), isLoading, error };
}

export function useLatestBalance(accountId: () => Id<"accounts"> | null) {
  const { data, isLoading, error } = useConvexQuery(
    api.accounts.getLatestBalance,
    () => (accountId() ? { accountId: accountId()! } : "skip"),
  );
  return { balance: data, isLoading, error };
}

// --- Income ---
export function useIncome() {
  const auth = useAuthStore();

  const { data: categories } = useConvexQuery(
    api.income.listCategories,
    () => (auth.isAuthenticated ? {} : "skip"),
  );
  const { data: categoriesGrouped } = useConvexQuery(
    api.income.listCategoriesGrouped,
    () => (auth.isAuthenticated ? {} : "skip"),
  );
  const {
    data: entries,
    isLoading,
    error,
  } = useConvexQuery(api.income.listByProfile, () =>
    auth.profileId ? { profileId: auth.profileId } : "skip",
  );

  const incomeList = computed(() => entries.value || []);
  const months = computed(() => {
    const set = new Set(
      incomeList.value.map((e) => e.date?.substring(0, 7)).filter(Boolean),
    );
    return Array.from(set).sort().reverse();
  });

  return {
    categories: computed(() => categories.value || []),
    categoriesGrouped: computed(() => categoriesGrouped.value || {}),
    incomeEntries: incomeList,
    availableMonths: months,
    isLoading,
    error,
    addIncome: useConvexMutation(api.income.add).mutate,
    updateIncome: useConvexMutation(api.income.update).mutate,
    deleteIncome: useConvexMutation(api.income.remove).mutate,
  };
}

export function useIncomeByMonth(monthYear: () => string) {
  const auth = useAuthStore();
  const { data, isLoading, error } = useConvexQuery(
    api.income.listByMonthWithCategories,
    () =>
      auth.profileId && monthYear()
        ? { profileId: auth.profileId, monthYear: monthYear() }
        : "skip",
  );
  return { income: computed(() => data.value || []), isLoading, error };
}

export function useIncomeTotalByMonth(monthYear: () => string) {
  const auth = useAuthStore();
  const { data, isLoading, error } = useConvexQuery(
    api.income.getTotalByMonth,
    () =>
      auth.profileId && monthYear()
        ? { profileId: auth.profileId, monthYear: monthYear() }
        : "skip",
  );
  return { total: computed(() => data.value || 0), isLoading, error };
}

export function useIncomeTotalsByCurrency(monthYear: () => string) {
  const auth = useAuthStore();
  const { data, isLoading, error } = useConvexQuery(
    api.income.getTotalsByCurrency,
    () =>
      auth.profileId && monthYear()
        ? { profileId: auth.profileId, monthYear: monthYear() }
        : "skip",
  );
  return {
    totals: computed(() => data.value || { INR: 0, USD: 0, THB: 0 }),
    isLoading,
    error,
  };
}

// --- Expenses ---
export function useExpenses() {
  const auth = useAuthStore();

  const { data: categories } = useConvexQuery(
    api.expenses.listCategories,
    () => (auth.isAuthenticated ? {} : "skip"),
  );
  const { data: categoriesGrouped } = useConvexQuery(
    api.expenses.listCategoriesGrouped,
    () => (auth.isAuthenticated ? {} : "skip"),
  );
  const { data: months } = useConvexQuery(
    api.expenses.getAvailableMonths,
    () => (auth.profileId ? { profileId: auth.profileId } : "skip"),
  );

  return {
    categories: computed(() => categories.value || []),
    categoriesGrouped: computed(() => categoriesGrouped.value || {}),
    availableMonths: computed(() => months.value || []),
    addExpense: useConvexMutation(api.expenses.add).mutate,
    updateExpense: useConvexMutation(api.expenses.update).mutate,
    deleteExpense: useConvexMutation(api.expenses.remove).mutate,
  };
}

export function useExpensesByMonth(monthYear: () => string) {
  const auth = useAuthStore();
  const { data, isLoading, error } = useConvexQuery(
    api.expenses.listByMonthWithCategories,
    () =>
      auth.profileId && monthYear()
        ? { profileId: auth.profileId, monthYear: monthYear() }
        : "skip",
  );
  return { expenses: computed(() => data.value || []), isLoading, error };
}

export function useExpensesTotalByMonth(monthYear: () => string) {
  const auth = useAuthStore();
  const { data, isLoading, error } = useConvexQuery(
    api.expenses.getTotalByMonth,
    () =>
      auth.profileId && monthYear()
        ? { profileId: auth.profileId, monthYear: monthYear() }
        : "skip",
  );
  return { total: computed(() => data.value || 0), isLoading, error };
}

export function useExpensesTotalsByCurrency(monthYear: () => string) {
  const auth = useAuthStore();
  const { data, isLoading, error } = useConvexQuery(
    api.expenses.getTotalsByCurrency,
    () =>
      auth.profileId && monthYear()
        ? { profileId: auth.profileId, monthYear: monthYear() }
        : "skip",
  );
  return {
    totals: computed(() => data.value || { INR: 0, USD: 0, THB: 0 }),
    isLoading,
    error,
  };
}

// --- Tax ---
export function useTax() {
  const auth = useAuthStore();
  const { data, isLoading, error } = useConvexQuery(
    api.tax.getTaxSummary,
    () => (auth.profileId ? { profileId: auth.profileId } : "skip"),
  );
  return { taxSummary: computed(() => data.value), isLoading, error };
}

export function useTaxPayments(fiscalYear?: () => string) {
  const auth = useAuthStore();

  const getFY = () => {
    const now = new Date();
    const m = now.getMonth() + 1;
    const y = now.getFullYear();
    return m >= 4 ? `${y}-${(y + 1) % 100}` : `${y - 1}-${y % 100}`;
  };

  const { data, isLoading, error } = useConvexQuery(
    api.tax.getTaxPaymentsByJurisdiction,
    () =>
      auth.profileId
        ? {
            profileId: auth.profileId,
            fiscalYear: fiscalYear?.() || getFY(),
          }
        : "skip",
  );

  const defaultPayments = {
    IN: { total: 0, payments: [] },
    US: { total: 0, payments: [] },
    TH: { total: 0, payments: [] },
  };

  return {
    paymentsByJurisdiction: computed(() => data.value || defaultPayments),
    addTaxPayment: useConvexMutation(api.tax.addTaxPayment).mutate,
    deleteTaxPayment: useConvexMutation(api.tax.deleteTaxPayment).mutate,
    isLoading,
    error,
  };
}

export function useTaxStatusByFiscalYear(fiscalYear: () => string) {
  const auth = useAuthStore();
  const {
    mutate: requestFxRefreshForFiscalYear,
    isLoading: isRefreshingFxRates,
  } = useConvexMutation((api as any).tax.requestFxRefreshForFiscalYear);
  const { data, isLoading, error } = useConvexQuery(
    api.tax.getTaxStatusByFiscalYear,
    () =>
      auth.profileId && fiscalYear()
        ? { profileId: auth.profileId, fiscalYear: fiscalYear() }
        : "skip",
  );

  const refreshKey = ref("");
  watch(
    () => `${auth.profileId || ""}:${fiscalYear() || ""}`,
    async (key) => {
      if (!auth.profileId || !fiscalYear()) return;
      if (refreshKey.value === key) return;
      refreshKey.value = key;
      try {
        await requestFxRefreshForFiscalYear({
          profileId: auth.profileId,
          fiscalYear: fiscalYear(),
        });
      } catch {
        // Tax query has fallback behavior; keep UI usable even if refresh fails.
      }
    },
    { immediate: true },
  );

  const empty = {
    fiscalYear: "",
    residencyByJurisdiction: {
      IN: true,
      US: false,
      TH: false,
    } as Record<"IN" | "US" | "TH", boolean>,
    jurisdictions: {
      IN: {
        income: 0,
        isResident: true,
        worldwideTaxation: true,
        domesticIncome: 0,
        foreignIncomeIncluded: 0,
        foreignTaxCreditAllowed: 0,
        foreignTaxCreditCurrency: "INR",
        foreignTaxCreditBreakdown: [],
        incomeBreakdownByMonth: [],
        foreignIncomeEntryLines: [],
        grossIncomeConsidered: 0,
        standardDeductionApplied: 0,
        section44adaDeduction: 0,
        taxComputationRows: [],
        taxComputationSlabTax: 0,
        taxComputationAdjustment: 0,
        taxableIncome: 0,
        taxableIncomeOldRegime: 0,
        taxDue: 0,
        taxDueNewRegime: 0,
        taxDueOldRegime: 0,
        taxPaid: 0,
        netDue: 0,
        netDueNewRegime: 0,
        netDueOldRegime: 0,
        fxEvidenceSummary: {
          serviceCalls: 0,
          fallbackCalls: 0,
          cacheHits: 0,
          samples: [],
        },
        currency: "INR",
      },
      US: {
        income: 0,
        isResident: false,
        worldwideTaxation: false,
        domesticIncome: 0,
        foreignIncomeIncluded: 0,
        foreignTaxCreditAllowed: 0,
        foreignTaxCreditCurrency: "USD",
        foreignTaxCreditBreakdown: [],
        incomeBreakdownByMonth: [],
        foreignIncomeEntryLines: [],
        grossIncomeConsidered: 0,
        standardDeductionApplied: 0,
        section44adaDeduction: 0,
        taxComputationRows: [],
        taxComputationSlabTax: 0,
        taxComputationAdjustment: 0,
        taxableIncome: 0,
        taxDue: 0,
        taxPaid: 0,
        netDue: 0,
        fxEvidenceSummary: {
          serviceCalls: 0,
          fallbackCalls: 0,
          cacheHits: 0,
          samples: [],
        },
        currency: "USD",
      },
      TH: {
        income: 0,
        isResident: false,
        worldwideTaxation: false,
        domesticIncome: 0,
        foreignIncomeIncluded: 0,
        foreignTaxCreditAllowed: 0,
        foreignTaxCreditCurrency: "THB",
        foreignTaxCreditBreakdown: [],
        incomeBreakdownByMonth: [],
        foreignIncomeEntryLines: [],
        grossIncomeConsidered: 0,
        standardDeductionApplied: 0,
        section44adaDeduction: 0,
        taxComputationRows: [],
        taxComputationSlabTax: 0,
        taxComputationAdjustment: 0,
        taxableIncome: 0,
        taxDue: 0,
        taxPaid: 0,
        netDue: 0,
        fxEvidenceSummary: {
          serviceCalls: 0,
          fallbackCalls: 0,
          cacheHits: 0,
          samples: [],
        },
        currency: "THB",
      },
    },
  };

  return {
    status: computed(() => data.value || empty),
    setTaxResidencyForFiscalYear: useConvexMutation(
      (api as any).tax.setTaxResidencyForFiscalYear,
    ).mutate,
    addTaxPayment: useConvexMutation(api.tax.addTaxPayment).mutate,
    setTaxPaidForFiscalYear: useConvexMutation(api.tax.setTaxPaidForFiscalYear)
      .mutate,
    requestFxRefreshForFiscalYear,
    isRefreshingFxRates,
    isLoading,
    error,
  };
}
