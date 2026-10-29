<script setup lang="ts">
import { computed, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import { useMediaQuery } from "@vueuse/core";
import { useAuthStore } from "@/stores/auth";
import { useCurrentUser } from "@/composables/useConvex";
import { Toaster, toast } from "vue-sonner";
import {
  SidebarProvider,
  Sidebar,
  SidebarContent,
  SidebarHeader,
  SidebarFooter,
  SidebarMenu,
  SidebarMenuItem,
  SidebarMenuButton,
  SidebarInset,
  SidebarTrigger,
} from "@/components/ui/sidebar";
import {
  LayoutDashboard,
  Wallet,
  CreditCard,
  ShoppingCart,
  TrendingUp,
  Landmark,
  Users,
  Loader2,
  LogOut,
  MessageCircle,
  Gauge,
  HeartPulse,
  Link2,
} from "lucide-vue-next";

import ProfileSwitcher from "@/components/ProfileSwitcher.vue";

// ============================================================================
// State — everything comes from the Pinia auth store
// ============================================================================
const route = useRoute();
const router = useRouter();
const auth = useAuthStore();
const isMobileToast = useMediaQuery("(max-width: 600px)");

// Load user data when authenticated - this populates auth.userId, auth.email, auth.profileId
useCurrentUser();

// ============================================================================
// Navigation
// ============================================================================
const navItems = [
  { path: "/", name: "overview", label: "Overview", icon: LayoutDashboard },
  { path: "/assets", name: "assets", label: "Assets", icon: Wallet },
  {
    path: "/liabilities",
    name: "liabilities",
    label: "Liabilities",
    icon: CreditCard,
  },
  {
    path: "/expenses",
    name: "expenses",
    label: "Expenses",
    icon: ShoppingCart,
  },
  { path: "/income", name: "income", label: "Income", icon: TrendingUp },
  { path: "/health", name: "health", label: "Health", icon: HeartPulse },
  { path: "/tax", name: "tax", label: "Tax", icon: Landmark },
  { path: "/family", name: "family", label: "Family", icon: Users },
];

const currentRouteName = computed(() => (route.name as string) || "overview");

const navigateTo = (path: string) => {
  router.push(path);
};

const handleSignOut = async () => {
  await auth.signOut();
  router.push("/login");
};

// ============================================================================
// Routing guard — redirect to /login when unauthenticated
// ============================================================================
watch(
  () => auth.state,
  async (state) => {
    if (state !== "unauthenticated") return;
    await router.isReady();
    if (auth.state === "unauthenticated" && !router.currentRoute.value.meta.public) {
      router.replace("/landing");
    }
  },
  { immediate: true },
);

watch(
  () => auth.authNotice,
  (notice) => {
    if (!notice) return;
    toast.error(notice);
    auth.clearAuthNotice();
  },
);
</script>

<template>
  <!-- Public pages (marketing/auth/legal) and Telegram link page - no sidebar -->
  <router-view v-if="route.meta.public || route.name === 'link-telegram'" />

  <!-- Authenticated layout with sidebar -->
  <SidebarProvider v-else>
    <Sidebar>
      <SidebarHeader class="p-4">
        <router-link
          to="/"
          class="text-xl font-bold text-primary"
        >
          ankan
        </router-link>
        <ProfileSwitcher v-if="auth.userId" class="mt-3" />
      </SidebarHeader>
      <SidebarContent>
        <SidebarMenu>
          <SidebarMenuItem v-for="item in navItems" :key="item.name">
            <SidebarMenuButton
              :is-active="currentRouteName === item.name"
              @click="navigateTo(item.path)"
            >
              <component :is="item.icon" class="mr-2 h-4 w-4" />
              {{ item.label }}
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarContent>
      <SidebarFooter class="p-4 border-t">
        <div class="text-xs text-muted-foreground truncate mb-2">
          {{ auth.email }}
        </div>
        <SidebarMenuButton
          :is-active="currentRouteName === 'usage'"
          @click="navigateTo('/usage')"
        >
          <Gauge class="mr-2 h-4 w-4" />
          AI settings
        </SidebarMenuButton>
        <SidebarMenuButton @click="navigateTo('/link-telegram')">
          <MessageCircle class="mr-2 h-4 w-4" />
          Telegram Bot
        </SidebarMenuButton>
        <SidebarMenuButton
          :is-active="currentRouteName === 'connections'"
          @click="navigateTo('/connections')"
        >
          <Link2 class="mr-2 h-4 w-4" />
          Connected apps
        </SidebarMenuButton>
        <SidebarMenuButton @click="handleSignOut">
          <LogOut class="mr-2 h-4 w-4" />
          Sign Out
        </SidebarMenuButton>
      </SidebarFooter>
    </Sidebar>

    <SidebarInset>
      <header
        class="flex h-14 items-center border-b px-4 bg-background/80 backdrop-blur-sm sticky top-0 z-10"
      >
        <SidebarTrigger />
        <h2 class="ml-4 text-lg font-semibold capitalize">
          {{ currentRouteName }}
        </h2>
      </header>

      <main class="flex-1 overflow-auto p-6">
        <!-- Loading State -->
        <div
          v-if="auth.isLoading"
          class="flex items-center justify-center h-64"
        >
          <div class="text-center">
            <Loader2 class="h-8 w-8 animate-spin text-primary mx-auto" />
            <p class="mt-2 text-sm text-muted-foreground">
              Loading your data...
            </p>
          </div>
        </div>

        <!-- Router View -->
        <router-view v-else />
      </main>
    </SidebarInset>
  </SidebarProvider>
  <Toaster :position="isMobileToast ? 'bottom-center' : 'top-right'" rich-colors />
</template>
