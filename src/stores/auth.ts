import { defineStore } from "pinia";
import { computed, ref } from "vue";
import { ConvexClient } from "convex/browser";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";

// =============================================================================
// STORAGE KEYS (namespaced by deployment URL)
// =============================================================================
const CONVEX_URL = import.meta.env.VITE_CONVEX_URL || "";
const STORAGE_NAMESPACE = CONVEX_URL.replace(/[^a-zA-Z0-9]/g, "");
const JWT_KEY = `__convexAuthJWT_${STORAGE_NAMESPACE}`;
const REFRESH_KEY = `__convexAuthRefreshToken_${STORAGE_NAMESPACE}`;
const SESSION_EXPIRY_KEY = `__convexAuthSessionExpiry_${STORAGE_NAMESPACE}`;

// Keep browser session alive for a week locally; server-side refresh token validity still applies.
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const REFRESH_RETRY_DELAYS_MS = [0, 500, 1500, 4000];
const REFRESH_CHECK_INTERVAL_MS = 10 * 60 * 1000;
const REFRESH_WHEN_EXPIRING_WITHIN_MS = 2 * 60 * 60 * 1000;

function decodeJwtExpMs(token: string | null): number | null {
  if (!token) return null;
  const parts = token.split(".");
  if (parts.length < 2 || !parts[1]) return null;
  try {
    const normalized = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    const padded = normalized + "=".repeat((4 - (normalized.length % 4)) % 4);
    const payload = JSON.parse(atob(padded)) as { exp?: number };
    if (!payload?.exp || !Number.isFinite(payload.exp)) return null;
    return payload.exp * 1000;
  } catch {
    return null;
  }
}

function isJwtUsableNow(token: string | null): boolean {
  if (!token) return false;
  const expMs = decodeJwtExpMs(token);
  if (!expMs) return true;
  return Date.now() < expMs;
}

// =============================================================================
// STORAGE HELPERS
// =============================================================================
function getStoredJwt(): string | null {
  const expiresAtRaw = localStorage.getItem(SESSION_EXPIRY_KEY);
  if (expiresAtRaw) {
    const expiresAt = Number(expiresAtRaw);
    if (Number.isFinite(expiresAt) && Date.now() > expiresAt) {
      // Important: only clear local JWT cache, keep refresh token so session can recover.
      clearJwtOnly();
      return null;
    }
  }
  return localStorage.getItem(JWT_KEY);
}

function getStoredRefreshToken(): string | null {
  return localStorage.getItem(REFRESH_KEY);
}

function getStoredSessionExpiry(): number | null {
  const raw = localStorage.getItem(SESSION_EXPIRY_KEY);
  if (!raw) return null;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : null;
}

function storeTokens(
  jwt: string,
  refreshToken: string,
  expiresAt: number = Date.now() + SESSION_TTL_MS,
): void {
  localStorage.setItem(JWT_KEY, jwt);
  localStorage.setItem(REFRESH_KEY, refreshToken);
  localStorage.setItem(SESSION_EXPIRY_KEY, String(expiresAt));
}

function clearJwtOnly(): void {
  localStorage.removeItem(JWT_KEY);
  localStorage.removeItem(SESSION_EXPIRY_KEY);
}

function clearTokens(): void {
  clearJwtOnly();
  localStorage.removeItem(REFRESH_KEY);
}

function clearRefreshTokenOnly(): void {
  localStorage.removeItem(REFRESH_KEY);
}

/** For router guard - synchronous check */
export function getStoredToken(): string | null {
  return getStoredJwt();
}

// =============================================================================
// CONVEX CLIENT SINGLETON
// =============================================================================
let client: ConvexClient | null = null;

export function getConvexClient(): ConvexClient {
  if (!client) {
    if (!CONVEX_URL) throw new Error("VITE_CONVEX_URL not set");
    client = new ConvexClient(CONVEX_URL);

    client.setAuth(
      async () => getStoredJwt(),
      () => {
        // No-op. We intentionally avoid noisy console logs for transient auth transport events.
      },
    );
  }
  return client;
}

// =============================================================================
// PINIA STORE
// =============================================================================
export type AuthState = "loading" | "unauthenticated" | "authenticated";

export const useAuthStore = defineStore("auth", () => {
  // ---- State ----
  const state = ref<AuthState>("loading");
  const serverAuthenticated = ref(false);
  const userId = ref<Id<"users"> | null>(null);
  const profileId = ref<Id<"profiles"> | null>(null);
  const email = ref<string | null>(null);
  const authNotice = ref<string | null>(null);

  // ---- Getters ----
  const isLoading = computed(() => state.value === "loading");
  const isAuthenticated = computed(() => state.value === "authenticated");

  // ---- Internal refresh controls ----
  let refreshPromise: Promise<boolean> | null = null;
  let refreshIntervalHandle: ReturnType<typeof setInterval> | null = null;

  function ensureConvexAuthConfigured() {
    const c = getConvexClient();
    serverAuthenticated.value = false;
    c.setAuth(
      async () => getStoredJwt(),
      (isAuthenticated) => { serverAuthenticated.value = isAuthenticated; },
    );
    return c;
  }

  function setAuthNotice(message: string) {
    authNotice.value = message;
  }

  function clearAuthNotice() {
    authNotice.value = null;
  }

  function invalidateSession(c: ConvexClient, notice?: string) {
    stopRefreshLoop();
    clearTokens();
    serverAuthenticated.value = false;
    c.setAuth(async () => null);
    state.value = "unauthenticated";
    userId.value = null;
    profileId.value = null;
    email.value = null;
    if (notice) setAuthNotice(notice);
  }

  async function validateCurrentJwt(c: ConvexClient): Promise<boolean> {
    try {
      const user = await c.query(api.users.currentUser, {});
      return !!user;
    } catch {
      return false;
    }
  }

  function startRefreshLoop() {
    if (refreshIntervalHandle) return;
    refreshIntervalHandle = setInterval(async () => {
      if (state.value !== "authenticated") return;
      const expiresAt = getStoredSessionExpiry();
      const refreshToken = getStoredRefreshToken();
      if (!refreshToken) {
        const jwt = getStoredJwt();
        if (!isJwtUsableNow(jwt)) {
          invalidateSession(ensureConvexAuthConfigured(), "Session expired. Please sign in again.");
        }
        return;
      }
      if (!expiresAt || expiresAt - Date.now() <= REFRESH_WHEN_EXPIRING_WITHIN_MS) {
        await refreshSession(false);
      }
    }, REFRESH_CHECK_INTERVAL_MS);
  }

  function stopRefreshLoop() {
    if (!refreshIntervalHandle) return;
    clearInterval(refreshIntervalHandle);
    refreshIntervalHandle = null;
  }

  async function refreshSession(forceAuthTransition: boolean): Promise<boolean> {
    if (refreshPromise) return refreshPromise;

    const refreshToken = getStoredRefreshToken();
    if (!refreshToken) {
      if (forceAuthTransition) state.value = "unauthenticated";
      return false;
    }

    const c = ensureConvexAuthConfigured();

    refreshPromise = (async () => {
      for (const delay of REFRESH_RETRY_DELAYS_MS) {
        if (delay > 0) {
          await new Promise((resolve) => setTimeout(resolve, delay));
        }
        try {
          const result = await c.action(api.auth.signIn, { refreshToken });
          if (result?.tokens) {
            storeTokens(result.tokens.token, result.tokens.refreshToken);
            ensureConvexAuthConfigured();
            state.value = "authenticated";
            return true;
          }
        } catch {
          // retry
        }
      }

      const jwt = getStoredJwt();
      const jwtUsable = isJwtUsableNow(jwt);
      const online =
        typeof navigator === "undefined" ? true : navigator.onLine !== false;

      if ((!jwtUsable || forceAuthTransition) && online) {
        invalidateSession(c, "Session expired. Please sign in again.");
        return false;
      }

      if (online) {
        const jwtStillValid = await validateCurrentJwt(c);
        if (!jwtStillValid) {
          invalidateSession(c, "Session expired. Please sign in again.");
          return false;
        }
        // JWT is still valid but refresh failed repeatedly.
        // Stop using likely-bad refresh token to avoid retry loops/log spam.
        clearRefreshTokenOnly();
        return false;
      }

      return false;
    })();

    try {
      return await refreshPromise;
    } finally {
      refreshPromise = null;
    }
  }

  // ---- Actions ----

  /**
   * Sign in with a provider.
   * Step 1 (email only): sends OTP, returns { started: true }
   * Step 2 (email + code): verifies OTP, stores tokens, returns { signingIn: true }
   */
  async function signIn(
    provider: string,
    params: Record<string, any>,
    options?: { turnstileToken?: string },
  ) {
    const c = getConvexClient();

    const result = await c.action(api.auth.signIn, {
      provider,
      params,
      turnstileToken: options?.turnstileToken,
    });

      if (result?.tokens) {
        storeTokens(result.tokens.token, result.tokens.refreshToken);
        ensureConvexAuthConfigured();
        clearAuthNotice();

        email.value = params.email;
        state.value = "authenticated";
      startRefreshLoop();

      return { signingIn: true };
    }

    if (result?.started) {
      return { signingIn: false, started: true };
    }

    return { signingIn: false };
  }

  /**
   * Called on app startup to check for existing session.
   */
  async function bootstrap() {
    const storedRefresh = getStoredRefreshToken();
    const storedJwt = getStoredJwt();

    if (!storedJwt && !storedRefresh) {
      state.value = "unauthenticated";
      return;
    }

    if (storedJwt && !isJwtUsableNow(storedJwt)) {
      clearJwtOnly();
      if (!storedRefresh) {
        state.value = "unauthenticated";
        setAuthNotice("Session expired. Please sign in again.");
        return;
      }
    }

    ensureConvexAuthConfigured();

    if (storedJwt && isJwtUsableNow(storedJwt)) {
      state.value = "authenticated";
      startRefreshLoop();
      // Refresh in background to rotate tokens without blocking app startup.
      void refreshSession(false);
      return;
    }

    // No JWT but refresh token exists: recover session with retries.
    const recovered = await refreshSession(true);
    if (recovered) {
      startRefreshLoop();
    }
  }

  /**
   * Sign out - invalidate session and clear tokens.
   */
  async function signOut() {
    const c = getConvexClient();
    try {
      await c.action(api.auth.signOut, {});
    } catch {
      // Ignore errors
    }
    invalidateSession(c);
  }

  function setActiveProfile(id: Id<"profiles">) {
    profileId.value = id;
  }

  return {
    state,
    serverAuthenticated,
    userId,
    profileId,
    email,
    authNotice,
    isLoading,
    isAuthenticated,
    bootstrap,
    signIn,
    signOut,
    setActiveProfile,
    clearAuthNotice,
  };
});
