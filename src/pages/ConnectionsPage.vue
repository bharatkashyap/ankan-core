<script setup lang="ts">
import { ref, watch } from "vue";
import { Copy, Check, Link2, ShieldX } from "lucide-vue-next";
import { api, getConvexClient, useAuthStore, type Id } from "@/composables/useConvex";

type Grant = { id: Id<"mcpGrants">; clientName: string; clientId: string; createdAt: number; lastUsedAt: number };
const auth = useAuthStore();
const mcpOrigin = (import.meta.env.VITE_MCP_ORIGIN || "").replace(/\/$/, "");
const mcpUrl = ref("");
const endpointLoading = ref(true);
const grants = ref<Grant[]>([]);
const loading = ref(true);
const grantsLoaded = ref(false);
const busyId = ref<string | null>(null);
const copied = ref(false);
const error = ref("");
const endpointError = ref(false);

async function loadGrants() {
  loading.value = true;
  grantsLoaded.value = false;
  error.value = "";
  try {
    grants.value = await getConvexClient().query(api.mcpStore.listGrants, {});
    grantsLoaded.value = true;
  }
  catch { error.value = "Could not load connected apps. Try again."; }
  finally { loading.value = false; }
}

async function loadEndpoint() {
  if (!mcpOrigin) { endpointLoading.value = false; return; }
  endpointLoading.value = true;
  endpointError.value = false;
  try {
    const slug = await getConvexClient().action(api.mcpAuthorize.getOrCreateEndpoint, {});
    mcpUrl.value = `${mcpOrigin}/u/${slug}`;
  } catch { mcpUrl.value = ""; endpointError.value = true; }
  finally { endpointLoading.value = false; }
}

async function copyUrl() {
  if (!mcpUrl.value) return;
  try {
    await navigator.clipboard.writeText(mcpUrl.value);
    copied.value = true;
    window.setTimeout(() => { copied.value = false; }, 2500);
  } catch { error.value = "Could not copy the URL. Select it and copy it manually."; }
}

async function revoke(grantId: Id<"mcpGrants">) {
  busyId.value = grantId;
  error.value = "";
  try {
    await getConvexClient().mutation(api.mcpStore.revokeGrant, { grantId });
    grants.value = grants.value.filter((grant) => grant.id !== grantId);
  } catch { error.value = "Could not revoke this connection. Try again."; }
  finally { busyId.value = null; }
}

watch(() => auth.serverAuthenticated, (authenticated) => {
  if (!authenticated) return;
  void loadEndpoint();
  void loadGrants();
}, { immediate: true });
</script>

<template>
  <div class="mx-auto max-w-4xl space-y-9 py-4">
    <header class="space-y-2">
      <h1 class="text-3xl font-semibold tracking-tight">Connected apps</h1>
      <p class="max-w-2xl text-muted-foreground">Add your personal MCP URL to a client, then approve read access to your Ankan data.</p>
    </header>

    <section aria-labelledby="connect-heading" class="space-y-5 rounded-xl border bg-card p-6">
      <div class="flex items-start gap-4">
        <div class="rounded-lg bg-muted p-3"><Link2 class="size-5" aria-hidden="true" /></div>
        <div class="space-y-1">
          <h2 id="connect-heading" class="text-xl font-semibold">Connect an MCP client</h2>
        </div>
      </div>
      <p v-if="!mcpOrigin" class="text-sm text-muted-foreground">MCP access needs a separately configured proxy. See the self-hosting guide.</p>
      <p v-else-if="endpointLoading || !auth.serverAuthenticated" role="status" class="text-sm text-muted-foreground">Loading your MCP URL…</p>
      <div v-else-if="mcpUrl" class="flex flex-col gap-2 sm:flex-row">
        <input aria-label="Ankan MCP server URL" :value="mcpUrl" readonly class="min-w-0 flex-1 rounded-md border bg-background px-3 py-2 font-mono text-sm focus-visible:outline-2 focus-visible:outline-offset-2" @focus="($event.target as HTMLInputElement).select()" />
        <button type="button" class="inline-flex items-center justify-center gap-2 rounded-md bg-foreground px-4 py-2 text-sm font-medium text-background focus-visible:outline-2 focus-visible:outline-offset-2" @click="copyUrl">
          <Check v-if="copied" class="size-4" aria-hidden="true" /><Copy v-else class="size-4" aria-hidden="true" />
          {{ copied ? "Copied" : "Copy URL" }}
        </button>
      </div>
      <div v-else-if="endpointError" class="flex flex-wrap items-center gap-3">
        <p class="text-sm text-destructive">Could not load your MCP URL.</p>
        <button type="button" class="text-sm underline underline-offset-4" @click="loadEndpoint">Try again</button>
      </div>
    </section>

    <section aria-labelledby="active-heading" class="space-y-4">
      <div class="flex items-baseline justify-between gap-4">
        <h2 id="active-heading" class="text-xl font-semibold">Active connections</h2>
        <button type="button" class="text-sm underline underline-offset-4" :disabled="loading || !auth.serverAuthenticated" @click="loadGrants">Refresh</button>
      </div>
      <p v-if="error" role="alert" class="text-sm text-destructive">{{ error }}</p>
      <p v-if="loading || !auth.serverAuthenticated" role="status" class="text-sm text-muted-foreground">Loading connections…</p>
      <div v-else-if="grantsLoaded && !grants.length" class="rounded-xl border p-6 text-sm text-muted-foreground">No MCP clients are connected yet.</div>
      <ul v-else-if="grants.length" class="divide-y rounded-xl border" aria-label="Connected MCP clients">
        <li v-for="grant in grants" :key="grant.id" class="flex flex-col gap-4 p-5 sm:flex-row sm:items-center sm:justify-between">
          <div class="min-w-0 space-y-1">
            <h3 class="font-medium break-words">{{ grant.clientName }}</h3>
            <p class="text-xs text-muted-foreground break-all">{{ grant.clientId }}</p>
            <p class="text-xs text-muted-foreground">Connected {{ new Date(grant.createdAt).toLocaleDateString() }}</p>
          </div>
          <button type="button" class="inline-flex shrink-0 items-center justify-center gap-2 rounded-md border px-3 py-2 text-sm font-medium hover:bg-muted focus-visible:outline-2 focus-visible:outline-offset-2 disabled:opacity-50" :disabled="busyId === grant.id" @click="revoke(grant.id)">
            <ShieldX class="size-4" aria-hidden="true" />{{ busyId === grant.id ? "Revoking…" : "Revoke access" }}
          </button>
        </li>
      </ul>
    </section>
  </div>
</template>
