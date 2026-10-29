/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as accounts from "../accounts.js";
import type * as aiSettings from "../aiSettings.js";
import type * as auth from "../auth.js";
import type * as billing from "../billing.js";
import type * as constants_india_fy_fy2023_24 from "../constants/india/fy/fy2023_24.js";
import type * as constants_india_fy_fy2024_25 from "../constants/india/fy/fy2024_25.js";
import type * as constants_india_fy_fy_current from "../constants/india/fy/fy_current.js";
import type * as constants_india_index from "../constants/india/index.js";
import type * as constants_india_types from "../constants/india/types.js";
import type * as constants_shared_types from "../constants/shared/types.js";
import type * as constants_thailand_pit from "../constants/thailand/pit.js";
import type * as crons from "../crons.js";
import type * as expenses from "../expenses.js";
import type * as families from "../families.js";
import type * as health from "../health.js";
import type * as http from "../http.js";
import type * as income from "../income.js";
import type * as lemonsqueezyWebhook from "../lemonsqueezyWebhook.js";
import type * as lib_auth from "../lib/auth.js";
import type * as lib_explicitWeightGroups from "../lib/explicitWeightGroups.js";
import type * as lib_fieldEncryption from "../lib/fieldEncryption.js";
import type * as lib_healthMacroTotals from "../lib/healthMacroTotals.js";
import type * as lib_healthSessions from "../lib/healthSessions.js";
import type * as lib_jevRouter from "../lib/jevRouter.js";
import type * as lib_mcpOwnership from "../lib/mcpOwnership.js";
import type * as lib_mcpPlan from "../lib/mcpPlan.js";
import type * as lib_mealReferences from "../lib/mealReferences.js";
import type * as lib_messageDecision from "../lib/messageDecision.js";
import type * as lib_tax_fxService from "../lib/tax/fxService.js";
import type * as lib_tax_policies from "../lib/tax/policies.js";
import type * as lib_tripFxService from "../lib/tripFxService.js";
import type * as lib_tripIdentity from "../lib/tripIdentity.js";
import type * as lib_tripInference from "../lib/tripInference.js";
import type * as lib_tripPeople from "../lib/tripPeople.js";
import type * as lib_tripSettlement from "../lib/tripSettlement.js";
import type * as mcpAuthorize from "../mcpAuthorize.js";
import type * as mcpData from "../mcpData.js";
import type * as mcpExpenses from "../mcpExpenses.js";
import type * as mcpHttp from "../mcpHttp.js";
import type * as mcpStore from "../mcpStore.js";
import type * as migrations from "../migrations.js";
import type * as profiles from "../profiles.js";
import type * as recordsAgent from "../recordsAgent.js";
import type * as tax from "../tax.js";
import type * as telegram from "../telegram.js";
import type * as telegramBot from "../telegramBot.js";
import type * as telegramInternal from "../telegramInternal.js";
import type * as tripReportActions from "../tripReportActions.js";
import type * as tripReports from "../tripReports.js";
import type * as users from "../users.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  accounts: typeof accounts;
  aiSettings: typeof aiSettings;
  auth: typeof auth;
  billing: typeof billing;
  "constants/india/fy/fy2023_24": typeof constants_india_fy_fy2023_24;
  "constants/india/fy/fy2024_25": typeof constants_india_fy_fy2024_25;
  "constants/india/fy/fy_current": typeof constants_india_fy_fy_current;
  "constants/india/index": typeof constants_india_index;
  "constants/india/types": typeof constants_india_types;
  "constants/shared/types": typeof constants_shared_types;
  "constants/thailand/pit": typeof constants_thailand_pit;
  crons: typeof crons;
  expenses: typeof expenses;
  families: typeof families;
  health: typeof health;
  http: typeof http;
  income: typeof income;
  lemonsqueezyWebhook: typeof lemonsqueezyWebhook;
  "lib/auth": typeof lib_auth;
  "lib/explicitWeightGroups": typeof lib_explicitWeightGroups;
  "lib/fieldEncryption": typeof lib_fieldEncryption;
  "lib/healthMacroTotals": typeof lib_healthMacroTotals;
  "lib/healthSessions": typeof lib_healthSessions;
  "lib/jevRouter": typeof lib_jevRouter;
  "lib/mcpOwnership": typeof lib_mcpOwnership;
  "lib/mcpPlan": typeof lib_mcpPlan;
  "lib/mealReferences": typeof lib_mealReferences;
  "lib/messageDecision": typeof lib_messageDecision;
  "lib/tax/fxService": typeof lib_tax_fxService;
  "lib/tax/policies": typeof lib_tax_policies;
  "lib/tripFxService": typeof lib_tripFxService;
  "lib/tripIdentity": typeof lib_tripIdentity;
  "lib/tripInference": typeof lib_tripInference;
  "lib/tripPeople": typeof lib_tripPeople;
  "lib/tripSettlement": typeof lib_tripSettlement;
  mcpAuthorize: typeof mcpAuthorize;
  mcpData: typeof mcpData;
  mcpExpenses: typeof mcpExpenses;
  mcpHttp: typeof mcpHttp;
  mcpStore: typeof mcpStore;
  migrations: typeof migrations;
  profiles: typeof profiles;
  recordsAgent: typeof recordsAgent;
  tax: typeof tax;
  telegram: typeof telegram;
  telegramBot: typeof telegramBot;
  telegramInternal: typeof telegramInternal;
  tripReportActions: typeof tripReportActions;
  tripReports: typeof tripReports;
  users: typeof users;
}>;

/**
 * A utility for referencing Convex functions in your app's public API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
export declare const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
>;

/**
 * A utility for referencing Convex functions in your app's internal API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = internal.myModule.myFunction;
 * ```
 */
export declare const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
>;

export declare const components: {};
