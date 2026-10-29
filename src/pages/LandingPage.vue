<script setup lang="ts">
import { onMounted, onUnmounted } from "vue";
import LandingContext from "./landing/LandingContext.vue";
import LandingHabit from "./landing/LandingHabit.vue";
import { landingVariant, landingSource, rememberLandingVisit } from "./landing/experiment";

const variant = landingVariant();
const source = landingSource();
const isPreview = new URLSearchParams(window.location.search).has("variant");

function trackAction(location: string) {
  if (isPreview) return;
  rememberLandingVisit(variant, source);
  if (import.meta.env.DEV) console.info("landing_cta", { variant, source, location });
}

onMounted(() => {
  const canonical = document.createElement("link");
  canonical.rel = "canonical";
  canonical.href = new URL("/landing", window.location.origin).href;
  canonical.dataset.ankanLanding = "true";
  document.head.appendChild(canonical);
  if (isPreview) return;
  rememberLandingVisit(variant, source);
});

onUnmounted(() => document.querySelector('link[data-ankan-landing="true"]')?.remove());
</script>

<template>
  <LandingContext v-if="variant === 'context'" @cta="trackAction" />
  <LandingHabit v-else @cta="trackAction" />
</template>
