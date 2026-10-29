<script setup lang="ts">
import { computed, ref } from "vue";
import { toast } from "vue-sonner";
import { useAISettings } from "@/composables/useConvex";

const { settings, isLoading, setMode, setByokKey, clearByokKey } = useAISettings();
const apiKey = ref("");
const saving = ref(false);
const usagePercent = computed(() => Math.min(100, Math.round(100 * settings.value.usage.used / Math.max(1, settings.value.usage.limit))));

async function saveKey() {
  if (!apiKey.value.trim()) return;
  saving.value = true;
  try {
    await setByokKey({ provider: "google", apiKey: apiKey.value.trim() });
    await setMode({ mode: "BYOK" });
    apiKey.value = "";
    toast.success("Your Google AI key is ready.");
  } catch (error) {
    toast.error(error instanceof Error ? error.message : "Could not save key.");
  } finally { saving.value = false; }
}

async function removeKey() {
  try {
    await clearByokKey({});
    toast.success("Your Google AI key was removed.");
  } catch (error) {
    toast.error(error instanceof Error ? error.message : "Could not remove key.");
  }
}
</script>

<template>
  <div class="mx-auto max-w-5xl space-y-6">
    <section class="rounded-xl border bg-background p-6 shadow-sm">
      <h3 class="text-2xl font-semibold tracking-tight">AI usage</h3>
      <p class="mt-1 text-sm text-muted-foreground">Messages processed today on this instance</p>
      <p class="mt-4 text-2xl font-semibold tabular-nums">{{ settings.usage.used }} <span class="text-base font-normal text-muted-foreground">/ {{ settings.usage.limit }}</span></p>
      <div class="mt-4 h-2 overflow-hidden rounded-full bg-muted"><div class="h-full bg-primary" :style="{ width: `${usagePercent}%` }" /></div>
    </section>
    <section class="rounded-xl border bg-background p-6 shadow-sm">
      <h3 class="text-2xl font-semibold tracking-tight">Google AI key</h3>
      <p class="mt-1 text-sm text-muted-foreground">Add your own key to use AI features. Your key is stored on this self-hosted instance.</p>
      <p v-if="settings.hasPersonalKey" class="mt-4 text-sm">A personal key is configured.</p>
      <form class="mt-5 flex flex-wrap gap-3" @submit.prevent="saveKey">
        <input v-model="apiKey" type="password" autocomplete="off" aria-label="Google AI API key" placeholder="Paste your Google AI key" class="min-w-0 flex-1 rounded-md border bg-background px-3 py-2 text-sm" />
        <button type="submit" :disabled="isLoading || saving || !apiKey.trim()" class="rounded-md bg-foreground px-4 py-2 text-sm font-medium text-background disabled:opacity-50">{{ saving ? "Saving…" : "Save key" }}</button>
        <button v-if="settings.hasPersonalKey" type="button" class="rounded-md border px-4 py-2 text-sm font-medium" @click="removeKey">Remove key</button>
      </form>
    </section>
  </div>
</template>
