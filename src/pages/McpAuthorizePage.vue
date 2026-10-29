<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import { LockKeyhole, ExternalLink } from "lucide-vue-next";
import { api, getConvexClient } from "@/composables/useConvex";

const route = useRoute();
const router = useRouter();
const requestId = computed(() => typeof route.query.request === "string" ? route.query.request : "");
const request = ref<{ clientName: string; clientId: string; redirectUri: string; expiresAt: number } | null>(null);
const loading = ref(true);
const busy = ref(false);
const error = ref("");
const callbackHost = computed(() => {
  try { return request.value ? new URL(request.value.redirectUri).host : ""; }
  catch { return ""; }
});

watch(requestId, async (id) => {
  request.value = null;
  error.value = "";
  if (!id) { loading.value = false; error.value = "This connection request is missing its ID."; return; }
  loading.value = true;
  try {
    request.value = await getConvexClient().query(api.mcpStore.describeAuthorizationRequest, { requestId: id });
    if (!request.value) error.value = "This connection request expired. Start again from your MCP client.";
  } catch {
    error.value = "We couldn't load the connection request. Sign in and try again.";
  } finally { loading.value = false; }
}, { immediate: true });

async function approve() {
  if (!request.value || !requestId.value) return;
  busy.value = true;
  error.value = "";
  try {
    const redirectUrl = await getConvexClient().action(api.mcpAuthorize.approve, { requestId: requestId.value });
    window.location.assign(redirectUrl);
  } catch {
    error.value = "Could not approve this connection. Start a new request in your MCP client.";
    busy.value = false;
  }
}
</script>

<template>
  <div class="mx-auto max-w-2xl space-y-7 py-4">
    <div class="space-y-2">
      <h1 class="text-3xl font-semibold tracking-tight">Connect to Ankan</h1>
      <p class="max-w-prose text-muted-foreground">Review what this client can access before continuing.</p>
    </div>

    <div v-if="loading" class="rounded-xl border p-6 text-sm text-muted-foreground" role="status">Loading connection request…</div>
    <div v-else-if="request" class="rounded-xl border bg-card p-6 space-y-6">
      <div class="flex items-start gap-4">
        <div class="rounded-lg bg-muted p-3"><LockKeyhole class="size-5" aria-hidden="true" /></div>
        <div class="min-w-0 space-y-1">
          <h2 class="text-xl font-semibold break-words">{{ request.clientName }}</h2>
          <p class="text-sm text-muted-foreground break-all">Returns to {{ callbackHost }}</p>
          <a v-if="request.clientId.startsWith('https://')" :href="request.clientId" target="_blank" rel="noopener noreferrer" class="inline-flex items-center gap-1 text-sm underline underline-offset-4">
            Client information <ExternalLink class="size-3.5" aria-hidden="true" />
          </a>
        </div>
      </div>
      <div class="space-y-2 border-t pt-5">
        <h3 class="font-medium">Read access requested</h3>
        <p class="text-sm text-muted-foreground">Read financial, health, tax, and trip records in profiles you own. This connection cannot change your data.</p>
      </div>
      <p class="text-sm text-muted-foreground">Access tokens last one hour. The client can refresh access for up to 30 days, or until you revoke this connection in Connected apps.</p>
      <p v-if="callbackHost === 'localhost' || callbackHost === '127.0.0.1'" class="rounded-lg bg-muted px-4 py-3 text-sm">This client returns to your computer at {{ callbackHost }}. Continue only if you started this connection there.</p>
      <p v-if="error" role="alert" class="text-sm text-destructive">{{ error }}</p>
      <div class="flex flex-wrap gap-3">
        <button type="button" class="rounded-md bg-foreground px-4 py-2 text-sm font-medium text-background focus-visible:outline-2 focus-visible:outline-offset-2 disabled:opacity-50" :disabled="busy" @click="approve">
          {{ busy ? "Connecting…" : "Allow read access" }}
        </button>
        <button type="button" class="rounded-md border px-4 py-2 text-sm font-medium hover:bg-muted focus-visible:outline-2 focus-visible:outline-offset-2" :disabled="busy" @click="router.push('/connections')">Cancel</button>
      </div>
    </div>
    <div v-else class="rounded-xl border p-6 space-y-4">
      <p role="alert" class="text-sm text-destructive">{{ error }}</p>
      <button type="button" class="text-sm underline underline-offset-4" @click="router.push('/connections')">Go to Connected apps</button>
    </div>
  </div>
</template>
