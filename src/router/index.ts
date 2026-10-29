import { createRouter, createWebHistory } from "vue-router";
import { getStoredToken } from "@/composables/useConvex";

const routes = [
  {
    path: "/landing",
    name: "landing",
    component: () => import("@/pages/LandingPage.vue"),
    meta: { public: true },
  },
  {
    path: "/pricing",
    name: "pricing",
    component: () => import("@/pages/PricingPage.vue"),
    meta: { public: true },
  },
  {
    path: "/privacy",
    name: "privacy",
    component: () => import("@/pages/PrivacyPage.vue"),
    meta: { public: true },
  },
  {
    path: "/terms",
    name: "terms",
    component: () => import("@/pages/TermsPage.vue"),
    meta: { public: true },
  },
  {
    path: "/login",
    name: "login",
    component: () => import("@/pages/LoginPage.vue"),
    meta: { public: true },
  },
  {
    path: "/signup",
    name: "signup",
    component: () => import("@/pages/LoginPage.vue"),
    meta: { public: true },
  },
  {
    path: "/",
    name: "overview",
    component: () => import("@/components/OverviewView.vue"),
  },
  {
    path: "/assets",
    name: "assets",
    component: () => import("@/components/AssetsView.vue"),
  },
  {
    path: "/liabilities",
    name: "liabilities",
    component: () => import("@/components/LiabilitiesView.vue"),
  },
  {
    path: "/expenses",
    name: "expenses",
    component: () => import("@/components/ExpensesView.vue"),
  },
  {
    path: "/income",
    name: "income",
    component: () => import("@/components/IncomeView.vue"),
  },
  {
    path: "/health",
    name: "health",
    component: () => import("@/components/HealthView.vue"),
  },
  {
    path: "/tax",
    name: "tax",
    component: () => import("@/components/TaxSummary.vue"),
  },
  {
    path: "/family",
    name: "family",
    component: () => import("@/components/FamilyView.vue"),
  },
  {
    path: "/usage",
    name: "usage",
    component: () => import("@/components/AISettingsView.vue"),
  },
  {
    path: "/settings",
    redirect: "/usage",
  },
  {
    path: "/link-telegram",
    name: "link-telegram",
    component: () => import("@/pages/TelegramLinkPage.vue"),
  },
  {
    path: "/mcp/authorize",
    name: "mcp-authorize",
    component: () => import("@/pages/McpAuthorizePage.vue"),
  },
  {
    path: "/connections",
    name: "connections",
    component: () => import("@/pages/ConnectionsPage.vue"),
  },
  {
    path: "/trip/:slug",
    name: "trip-report",
    component: () => import("@/pages/TripReportPage.vue"),
    meta: { public: true },
  },
  {
    // Catch-all redirect to overview
    path: "/:pathMatch(.*)*",
    redirect: "/landing",
  },
];

const router = createRouter({
  history: createWebHistory(),
  routes,
});

// Auth guard
router.beforeEach((to, _from, next) => {
  const token = getStoredToken();
  const isAuthenticated = !!token;

  if (to.meta.public || isAuthenticated) {
    next();
  } else if (to.name === "mcp-authorize") {
    next({ path: "/login", query: { next: to.fullPath } });
  } else {
    next("/landing");
  }
});

export default router;
