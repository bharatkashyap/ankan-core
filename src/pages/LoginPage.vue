<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import { useAuthStore } from "@/stores/auth";
import { Loader2 } from "lucide-vue-next";

const router = useRouter();
const route = useRoute();
const auth = useAuthStore();
const isSignupMode = computed(() => route.name === "signup");
const afterSignIn = computed(() => {
  const next = route.query.next;
  if (typeof next === "string") {
    try {
      const url = new URL(next, window.location.origin);
      if (url.origin === window.location.origin && url.pathname === "/mcp/authorize" &&
        /^[A-Za-z0-9_-]{20,100}$/.test(url.searchParams.get("request") || "")) return next;
    } catch { /* Ignore malformed return paths. */ }
  }
  const trip = route.query.trip;
  return typeof trip === "string" && /^[a-f0-9]{24}$/.test(trip)
    ? { name: "trip-report", params: { slug: trip } }
    : { name: "overview" };
});

// Redirect when authenticated (covers both fresh login and page revisit)
watch(
  () => auth.isAuthenticated,
  (authenticated) => {
    if (authenticated) router.replace(afterSignIn.value);
  },
  { immediate: true },
);

const step = ref<"email" | "otp">("email");
const email = ref("");
const otp = ref("");
const isLoading = ref(false);
const error = ref("");
const emailError = ref("");
const emailSubmitAttempted = ref(false);
const emailInputRef = ref<HTMLInputElement | null>(null);
const turnstileSiteKey = (import.meta.env.VITE_TURNSTILE_SITE_KEY || "").trim();
const turnstileHostRef = ref<HTMLDivElement | null>(null);
const turnstileWidgetId = ref<string | null>(null);
const turnstileToken = ref("");
const turnstileError = ref("");

type TurnstileApi = {
  render: (
    container: HTMLElement | string,
    options: Record<string, unknown>,
  ) => string;
  reset: (widgetId?: string) => void;
  remove: (widgetId: string) => void;
};

declare global {
  interface Window {
    turnstile?: TurnstileApi;
  }
}

let turnstileScriptPromise: Promise<void> | null = null;

function loadTurnstileScript() {
  if (typeof window === "undefined") {
    return Promise.resolve();
  }
  if (window.turnstile) {
    return Promise.resolve();
  }
  if (turnstileScriptPromise) {
    return turnstileScriptPromise;
  }

  turnstileScriptPromise = new Promise((resolve, reject) => {
    const existingScript = document.querySelector<HTMLScriptElement>(
      "script[data-turnstile-script='1']",
    );
    if (existingScript) {
      existingScript.addEventListener("load", () => resolve(), { once: true });
      existingScript.addEventListener(
        "error",
        () => reject(new Error("Could not load security verification")),
        { once: true },
      );
      return;
    }

    const script = document.createElement("script");
    script.src =
      "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
    script.async = true;
    script.defer = true;
    script.dataset.turnstileScript = "1";
    script.onload = () => resolve();
    script.onerror = () =>
      reject(new Error("Could not load security verification"));
    document.head.appendChild(script);
  });

  return turnstileScriptPromise;
}

function resetTurnstileWidget() {
  turnstileToken.value = "";
  if (window.turnstile && turnstileWidgetId.value) {
    window.turnstile.reset(turnstileWidgetId.value);
  }
}

async function mountTurnstileWidget() {
  if (!turnstileSiteKey) {
    turnstileError.value =
      "Security verification is unavailable. Please try again later.";
    return;
  }
  await loadTurnstileScript();
  if (!window.turnstile || !turnstileHostRef.value) {
    turnstileError.value =
      "Security verification is unavailable. Please try again later.";
    return;
  }
  turnstileWidgetId.value = window.turnstile.render(turnstileHostRef.value, {
    sitekey: turnstileSiteKey,
    callback: (token: string) => {
      turnstileToken.value = token;
      turnstileError.value = "";
    },
    "expired-callback": () => {
      turnstileToken.value = "";
      turnstileError.value = "Security check expired. Please verify again.";
    },
    "error-callback": () => {
      turnstileToken.value = "";
      turnstileError.value = "Security check failed. Please verify again.";
    },
  });
}

onMounted(() => {
  if (turnstileSiteKey) void mountTurnstileWidget();
});

onUnmounted(() => {
  if (window.turnstile && turnstileWidgetId.value) {
    window.turnstile.remove(turnstileWidgetId.value);
  }
});

const canSubmitEmail = computed(() => {
  return (
    !isLoading.value &&
    !emailError.value &&
    !!email.value.trim() &&
    (!turnstileSiteKey || !!turnstileToken.value)
  );
});

const validateEmail = (): string => {
  const normalized = email.value.trim();
  if (!normalized) return "Email is required";

  const el = emailInputRef.value;
  if (el) {
    // Keep native email validation source of truth, but show custom UI.
    el.value = normalized;
    if (el.validity.typeMismatch) {
      return "Please enter a valid email address";
    }
    if (el.validity.patternMismatch) {
      return "Please enter a valid email address";
    }
  }

  return "";
};

const handleEmailSubmit = async () => {
  emailSubmitAttempted.value = true;
  email.value = email.value.trim();
  emailError.value = validateEmail();
  if (emailError.value) {
    return;
  }
  if (turnstileSiteKey && !turnstileToken.value) {
    turnstileError.value = "Please complete the security check to continue.";
    return;
  }

  isLoading.value = true;
  error.value = "";

  try {
    await auth.signIn(
      "listmonk-otp",
      { email: email.value },
      { turnstileToken: turnstileToken.value },
    );
    step.value = "otp";
  } catch (err: any) {
    // Show user-friendly error message
    const rawMessage = err.message || "";
    if (
      rawMessage.includes("Failed to send OTP") ||
      rawMessage.includes("fetch")
    ) {
      error.value = "Could not send verification code. Please try again.";
    } else if (rawMessage.includes("Security verification")) {
      error.value = "Please complete the security check and try again.";
      resetTurnstileWidget();
    } else if (rawMessage.includes("rate limit")) {
      error.value = "Too many attempts. Please wait a few minutes.";
    } else {
      error.value = "Something went wrong. Please try again.";
    }
    console.error("Sign in error:", err);
  } finally {
    isLoading.value = false;
  }
};

const handleOTPSubmit = async () => {
  if (!otp.value || otp.value.length !== 6) {
    error.value = "Please enter the 6-digit code";
    return;
  }

  isLoading.value = true;
  error.value = "";

  try {
    await auth.signIn("listmonk-otp", {
      email: email.value,
      code: otp.value,
    });
    // The authentication watcher returns to the trip when this login came from it.
  } catch (err: any) {
    // Show user-friendly error message
    const rawMessage = err.message || "";
    if (rawMessage.includes("verify code") || rawMessage.includes("Invalid")) {
      error.value = "Invalid code. Please check and try again.";
    } else if (rawMessage.includes("expired")) {
      error.value = "Code expired. Please request a new one.";
    } else {
      error.value = "Could not verify code. Please try again.";
    }
    console.error("OTP verification error:", err);
  } finally {
    isLoading.value = false;
  }
};

const handleKeypress = (e: KeyboardEvent) => {
  if (e.key === "Enter") {
    if (step.value === "email") {
      handleEmailSubmit();
    } else {
      handleOTPSubmit();
    }
  }
};

watch(email, (value) => {
  if (!emailSubmitAttempted.value) {
    return;
  }
  emailError.value = validateEmail();
});
</script>

<template>
  <div class="min-h-screen flex items-center justify-center bg-background">
    <div class="w-full max-w-sm p-8">
      <h1
        class="mb-2 text-3xl font-bold text-foreground"
      >
        ankan
      </h1>
      <p class="text-muted-foreground mb-2">
        {{
          step === "email"
            ? isSignupMode
              ? "Create your account with email"
              : "Sign in with your email"
            : "Enter verification code"
        }}
      </p>
      <p class="text-sm text-muted-foreground mb-8">
        {{
          isSignupMode
            ? "No card required. Start your 15-day trial (20/day)."
            : "Don't have an account? You can sign up instantly."
        }}
      </p>

      <!-- Email Step -->
      <div v-if="step === 'email'" class="space-y-4">
        <div>
          <label class="text-sm font-medium mb-1 block">Email</label>
          <input
            ref="emailInputRef"
            v-model="email"
            type="email"
            pattern="^[^\s@]+@[^\s@]+\.[^\s@]+$"
            placeholder="you@example.com"
            class="w-full px-4 py-3 border rounded-lg bg-background focus:outline-none focus:ring-2"
            :class="
              emailError
                ? 'border-red-500 focus:ring-red-500'
                : 'border-border focus:ring-primary'
            "
            @keypress="handleKeypress"
            @blur="
              emailSubmitAttempted
                ? (emailError = validateEmail())
                : (emailError = '')
            "
            :disabled="isLoading"
          />
          <p v-if="emailError" class="mt-1 text-xs text-red-500">
            {{ emailError }}
          </p>
        </div>
        <div v-if="turnstileSiteKey">
          <div ref="turnstileHostRef" class="min-h-[65px]" />
          <p v-if="turnstileError" class="mt-1 text-xs text-red-500">
            {{ turnstileError }}
          </p>
        </div>

        <button
          @click="handleEmailSubmit"
          :disabled="!canSubmitEmail"
          class="w-full py-3 bg-primary text-primary-foreground rounded-lg font-medium hover:bg-primary/90 transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
        >
          <Loader2 v-if="isLoading" class="h-4 w-4 animate-spin" />
          {{ isLoading ? "Sending..." : "Continue" }}
        </button>
      </div>

      <!-- OTP Step -->
      <div v-else class="space-y-4">
        <p class="text-sm text-muted-foreground">
          We sent a code to
          <span class="font-medium text-foreground">{{ email }}</span>
        </p>

        <div>
          <label class="text-sm font-medium mb-1 block"
            >Verification Code</label
          >
          <input
            v-model="otp"
            type="text"
            inputmode="numeric"
            placeholder="123456"
            maxlength="6"
            class="w-full px-4 py-3 border rounded-lg bg-background focus:outline-none focus:ring-2 focus:ring-primary text-center text-2xl tracking-widest font-mono"
            @keypress="handleKeypress"
            :disabled="isLoading"
          />
        </div>

        <button
          @click="handleOTPSubmit"
          :disabled="isLoading"
          class="w-full py-3 bg-primary text-primary-foreground rounded-lg font-medium hover:bg-primary/90 transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
        >
          <Loader2 v-if="isLoading" class="h-4 w-4 animate-spin" />
          {{ isLoading ? "Verifying..." : isSignupMode ? "Create Account" : "Sign In" }}
        </button>

        <button
          @click="
            step = 'email';
            resetTurnstileWidget();
          "
          class="w-full py-2 text-sm text-muted-foreground hover:text-foreground transition-colors"
        >
          ← Use different email
        </button>
      </div>

      <!-- Error -->
      <p v-if="error" class="mt-4 text-sm text-red-500 text-center">
        {{ error }}
      </p>
      <div class="mt-6 text-center text-sm text-muted-foreground">
        <router-link to="/landing" class="underline underline-offset-4 hover:text-foreground">
          Back to home
        </router-link>
      </div>
    </div>
  </div>
</template>
