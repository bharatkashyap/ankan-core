<script setup lang="ts">
import { ArrowUpRight, MoveRight } from "lucide-vue-next";
import LandingFinance from "./LandingFinance.vue";
import "./landing.css";

const emit = defineEmits<{ cta: [location: string] }>();
</script>

<template>
  <div class="lp lp-context">
    <header class="lp-nav">
      <router-link class="lp-brand" to="/landing" aria-label="Ankan home"><span class="lp-brand-mark">A</span><span>ANKAN</span></router-link>
      <nav aria-label="Main navigation"><router-link to="/pricing">Pricing</router-link><router-link to="/privacy">Privacy</router-link><router-link class="lp-nav-cta" to="/signup" @click="emit('cta', 'nav')">Get started <ArrowUpRight :size="16" /></router-link></nav>
    </header>

    <main>
      <section class="lp-context-hero">
        <div class="lp-context-copy">
          <h1>Your context, <span>across apps.</span></h1>
          <p>Your expenses, meals, and workouts stay in Ankan, ready when you switch AI apps.</p>
          <div class="lp-actions"><router-link class="lp-button lp-button-light" to="/signup" @click="emit('cta', 'hero')">Start your record <ArrowUpRight :size="18" /></router-link><a class="lp-text-link" href="#context-visual">See it in action <MoveRight :size="17" /></a></div>
        </div>
        <div id="context-visual" class="lp-context-visual" aria-label="Ankan records read from connected AI apps">
          <div class="lp-visual-record"><div class="lp-visual-record-head"><span class="lp-story-ankan">a</span><strong>Ankan</strong><small>YOUR RECORD</small></div><div class="lp-visual-record-row"><span>Expense</span><strong>Dinner at Sarnies</strong><b>฿900</b></div><div class="lp-visual-record-row"><span>Meal</span><strong>Tofu lunch</strong></div><div class="lp-visual-record-row"><span>Workout</span><strong>Squats · 3 sets</strong></div></div>
          <div class="lp-visual-arrow" aria-hidden="true"><MoveRight :size="28" /></div>
          <div class="lp-visual-chat"><div class="lp-visual-chat-apps" aria-label="ChatGPT, Claude, Gemini, Muse, Telegram, Instinct, and OpenClaw"><img src="/brands/openai.svg" alt="ChatGPT" /><img src="/brands/claude.svg" alt="Claude" /><img src="/brands/gemini.png" alt="Gemini" /><img src="/brands/muse.svg" alt="Muse" /><img src="/brands/telegram.svg" alt="Telegram" /><img src="/brands/instinct.ico" alt="Instinct" /><img src="/brands/openclaw.svg" alt="OpenClaw" /></div><div class="lp-visual-question">What did I log today?</div><div class="lp-visual-answer">Dinner at Sarnies, tofu lunch, and squats.</div></div>
          <small>Illustrative record and answer</small>
        </div>
      </section>

      <section class="lp-context-continuity">
        <div class="lp-section-intro"><h2>Pick up in a new chat.</h2><p>What you logged earlier is still there when you change apps.</p></div>
        <div class="lp-continuity-stage">
          <div class="lp-continuity-history"><div class="lp-continuity-heading"><span class="lp-story-ankan">a</span><strong>Your Ankan record</strong><small>EARLIER THIS MONTH</small></div><div class="lp-continuity-entry"><time>MON 05</time><span>6 km run</span><b>Workout</b></div><div class="lp-continuity-entry"><time>MON 05</time><span>Tofu lunch</span><b>Meal</b></div><div class="lp-continuity-entry"><time>FRI 16</time><span>Dinner at Sarnies</span><b>Expense</b></div></div>
          <div class="lp-continuity-thread"><div class="lp-continuity-heading"><img src="/brands/claude.svg" alt="Claude" /><strong>A new chat in Claude</strong><small>TODAY</small></div><div class="lp-continuity-question">What did I eat after my last run?</div><div class="lp-continuity-answer">After your 6 km run, you logged tofu lunch.</div><div class="lp-continuity-source"><span class="lp-story-ankan">a</span>From your Ankan record</div></div>
        </div>
        <small class="lp-illustration-note">Illustrative entries and answer</small>
      </section>

      <section class="lp-context-control"><div class="lp-context-control-copy"><h2>Choose who can read it.</h2><p>Connect an AI app when you want to ask about your records. Revoke access in Ankan.</p></div><div class="lp-connections-demo"><div class="lp-connections-title"><span class="lp-story-ankan">a</span><strong>Connections</strong><span>READ-ONLY ACCESS</span></div><div class="lp-connection-row"><img src="/brands/openai.svg" alt="" /><strong>ChatGPT</strong><span class="lp-connection-on">Connected</span></div><div class="lp-connection-row"><img src="/brands/claude.svg" alt="" /><strong>Claude</strong><span class="lp-connection-on">Connected</span></div><div class="lp-connection-row"><img src="/brands/openclaw.svg" alt="" /><strong>OpenClaw</strong><span>Not connected</span></div><small>Illustrative connection states</small></div></section>

      <LandingFinance />

      <section class="lp-context-close"><div><h2>Your history goes with you.</h2><p>Start a record once. Use it in the apps you choose.</p><router-link class="lp-button lp-button-light" to="/signup" @click="emit('cta', 'footer')">Create your account <ArrowUpRight :size="18" /></router-link></div><div class="lp-close-logos" aria-label="ChatGPT, Claude, Gemini, Muse, Telegram, Instinct, and OpenClaw"><img src="/brands/openai.svg" alt="ChatGPT" /><img src="/brands/claude.svg" alt="Claude" /><img src="/brands/gemini.png" alt="Gemini" /><img src="/brands/muse.svg" alt="Muse" /><img src="/brands/telegram.svg" alt="Telegram" /><img src="/brands/instinct.ico" alt="Instinct" /><img src="/brands/openclaw.svg" alt="OpenClaw" /></div></section>
    </main>
    <footer class="lp-footer"><span>ankan © {{ new Date().getFullYear() }}</span><div><router-link to="/pricing">Pricing</router-link><router-link to="/privacy">Privacy</router-link><router-link to="/terms">Terms</router-link></div></footer>
  </div>
</template>
