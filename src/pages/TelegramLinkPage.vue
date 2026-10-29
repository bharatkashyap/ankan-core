<script setup lang="ts">
import { ref, computed } from "vue";
import { useRouter } from "vue-router";
import {
  useConvexQuery,
  useConvexMutation,
  api,
} from "@/composables/useConvex";
import { Loader2, MessageCircle, Check, Unlink } from "lucide-vue-next";

const router = useRouter();
const botUsername = (import.meta.env.VITE_TELEGRAM_BOT_USERNAME || "").replace(/^@/, "");

// Check current link status
const { data: telegramStatus, isLoading: statusLoading } = useConvexQuery(
  api.users.getTelegramStatus,
  () => ({}),
);

const isLinked = computed(() => telegramStatus.value?.isLinked ?? false);

const code = ref("");
const isLinking = ref(false);
const isUnlinking = ref(false);
const error = ref("");
const success = ref("");

const linkMutation = useConvexMutation(api.users.linkTelegramAccount);
const unlinkMutation = useConvexMutation(api.users.unlinkTelegram);

const handleLink = async () => {
  const trimmed = code.value.trim().toUpperCase();
  if (!trimmed || trimmed.length !== 6) {
    error.value = "Please enter the 6-character code from the Telegram bot.";
    return;
  }

  isLinking.value = true;
  error.value = "";
  success.value = "";

  try {
    await linkMutation.mutate({ code: trimmed });
    success.value = "Telegram account linked successfully! 🎉";
    code.value = "";
  } catch (err: any) {
    const msg = err?.message || err?.data || "";
    if (msg.includes("Invalid")) {
      error.value = "Invalid code. Please check and try again.";
    } else if (msg.includes("expired")) {
      error.value = "Code expired. Send /link in Telegram to get a new one.";
    } else {
      error.value = "Failed to link. Please try again.";
    }
    console.error("Link error:", err);
  } finally {
    isLinking.value = false;
  }
};

const handleUnlink = async () => {
  isUnlinking.value = true;
  error.value = "";
  success.value = "";

  try {
    await unlinkMutation.mutate({});
    success.value = "Telegram account unlinked.";
  } catch (err: any) {
    error.value = "Failed to unlink. Please try again.";
    console.error("Unlink error:", err);
  } finally {
    isUnlinking.value = false;
  }
};

const handleKeypress = (e: KeyboardEvent) => {
  if (e.key === "Enter") handleLink();
};
</script>

<template>
  <div class="min-h-screen flex items-center justify-center bg-background">
    <div class="w-full max-w-sm p-8">
      <!-- Header -->
      <div class="flex items-center gap-2 mb-2">
        <MessageCircle class="h-6 w-6 text-primary" />
        <h1 class="text-2xl font-bold bg-clip-text text-primary">
          Link Telegram
        </h1>
      </div>
      <p class="text-muted-foreground mb-6 text-sm">
        Connect your Telegram account to log expenses via chat.
      </p>

      <!-- Loading -->
      <div v-if="statusLoading" class="flex items-center justify-center py-12">
        <Loader2 class="h-6 w-6 animate-spin text-muted-foreground" />
      </div>

      <!-- Already Linked -->
      <div v-else-if="isLinked" class="space-y-4">
        <div
          class="flex items-center gap-3 p-4 bg-green-50 dark:bg-green-950/30 border border-green-200 dark:border-green-800 rounded-lg"
        >
          <Check class="h-5 w-5 text-green-600 flex-shrink-0" />
          <div>
            <p class="font-medium text-green-800 dark:text-green-200">
              Telegram is linked
            </p>
            <p class="text-sm text-green-600 dark:text-green-400">
              Send expenses directly from Telegram.
            </p>
          </div>
        </div>

        <button
          @click="handleUnlink"
          :disabled="isUnlinking"
          class="w-full py-2 text-sm text-muted-foreground hover:text-red-500 transition-colors flex items-center justify-center gap-2"
        >
          <Loader2 v-if="isUnlinking" class="h-3 w-3 animate-spin" />
          <Unlink v-else class="h-3 w-3" />
          {{ isUnlinking ? "Unlinking..." : "Unlink Telegram" }}
        </button>
      </div>

      <!-- Link Form -->
      <div v-else class="space-y-4">
        <div
          class="p-4 bg-muted/50 rounded-lg text-sm text-muted-foreground space-y-2"
        >
          <p class="font-medium text-foreground">How to link:</p>
          <p v-if="!botUsername">Set VITE_TELEGRAM_BOT_USERNAME and TELEGRAM_BOT_TOKEN to use your own bot.</p>
          <ol v-else class="list-decimal list-inside space-y-1">
            <li>
              Open
              <a
                :href="`https://t.me/${botUsername}`"
                target="_blank"
                class="text-primary underline"
                >@{{ botUsername }}</a
              >
              in Telegram
            </li>
            <li>Send <code class="px-1 bg-muted rounded">/link</code></li>
            <li>Enter the 6-character code below</li>
          </ol>
        </div>

        <div>
          <label class="text-sm font-medium mb-1 block">Link Code</label>
          <input
            v-model="code"
            type="text"
            placeholder="ABC123"
            maxlength="6"
            class="w-full px-4 py-3 border rounded-lg bg-background focus:outline-none focus:ring-2 focus:ring-primary text-center text-2xl tracking-widest font-mono uppercase"
            @keypress="handleKeypress"
            :disabled="isLinking"
          />
        </div>

        <button
          @click="handleLink"
          :disabled="isLinking"
          class="w-full py-3 bg-primary text-primary-foreground rounded-lg font-medium hover:bg-primary/90 transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
        >
          <Loader2 v-if="isLinking" class="h-4 w-4 animate-spin" />
          {{ isLinking ? "Linking..." : "Link Account" }}
        </button>
      </div>

      <!-- Success -->
      <p
        v-if="success"
        class="mt-4 text-sm text-green-600 dark:text-green-400 text-center"
      >
        {{ success }}
      </p>

      <!-- Error -->
      <p v-if="error" class="mt-4 text-sm text-red-500 text-center">
        {{ error }}
      </p>

      <!-- Back link -->
      <button
        @click="router.push('/')"
        class="mt-6 w-full py-2 text-sm text-muted-foreground hover:text-foreground transition-colors"
      >
        ← Back to overview
      </button>
    </div>
  </div>
</template>
