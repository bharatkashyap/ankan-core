<script setup lang="ts">
import { ArrowUpRight, MoveRight } from "lucide-vue-next";
import LandingFinance from "./LandingFinance.vue";
import "./landing.css";

const emit = defineEmits<{ cta: [location: string] }>();
</script>

<template>
  <div class="lp lp-habit">
    <header class="lp-nav">
      <router-link class="lp-brand" to="/landing" aria-label="Ankan home"><span class="lp-brand-mark">A</span><span>ANKAN</span></router-link>
      <nav aria-label="Main navigation"><router-link to="/pricing">Pricing</router-link><router-link to="/privacy">Privacy</router-link><router-link class="lp-nav-cta" to="/signup" @click="emit('cta', 'nav')">Get started <ArrowUpRight :size="16" /></router-link></nav>
    </header>

    <main>
      <section class="lp-habit-hero">
        <div class="lp-habit-copy"><h1>Your progress, <span>day by day.</span></h1><p>Build a habit of logging expenses, meals, and workouts in Telegram. See your progress over time.</p><div class="lp-actions"><router-link class="lp-button lp-button-dark" to="/signup" @click="emit('cta', 'hero')">Log your first entry <ArrowUpRight :size="18" /></router-link><a class="lp-text-link lp-text-link-dark" href="#daily-flow">See your record <MoveRight :size="17" /></a></div></div>
        <div class="lp-habit-visual" aria-label="Workout messages become a progress chart in ChatGPT">
          <div class="lp-habit-log"><div class="lp-habit-log-head"><img src="/brands/telegram.svg" alt="Telegram" /><strong>This week</strong></div><div class="lp-habit-log-row"><span>Mon</span><strong>Squats · 3 sets</strong><b>✓</b></div><div class="lp-habit-log-row"><span>Wed</span><strong>6 km run</strong><b>✓</b></div><div class="lp-habit-log-row"><span>Fri</span><strong>Yoga · 30 min</strong><b>✓</b></div><div class="lp-habit-log-saved"><span class="lp-story-ankan" aria-label="Ankan">a</span>Saved in Ankan</div></div>
          <div class="lp-visual-arrow" aria-hidden="true"><MoveRight :size="28" /></div>
          <div class="lp-ask-demo" aria-label="Example ChatGPT conversation about workout history"><div class="lp-demo-top"><span class="lp-demo-avatar lp-demo-avatar-chatgpt"><img src="/brands/openai.svg" alt="" /></span><div><strong>ChatGPT</strong><span>connected to Ankan</span></div></div><div class="lp-demo-chat"><div class="lp-ask-question"><p>How often did I work out this month?</p></div><div class="lp-ask-answer"><div class="lp-answer-author"><img src="/brands/openai.svg" alt="" /><strong>ChatGPT</strong><span>using Ankan records</span></div><p>9 workouts in October, up from 6 in September.</p><div class="lp-insight"><div class="lp-insight-head"><span>WORKOUTS LOGGED</span><strong>+3 <small>vs September</small></strong></div><div class="lp-insight-bars" role="img" aria-label="Example workout counts: six in September and nine in October"><div><span>Sep</span><i style="width:67%"></i><strong>6</strong></div><div><span>Oct</span><i style="width:100%"></i><strong>9</strong></div></div></div></div></div></div>
          <small>Illustrative example in ChatGPT. Ask from any connected app.</small>
        </div>
      </section>

      <section id="daily-flow" class="lp-habit-week"><div class="lp-section-intro"><h2>A week you can see.</h2><p>Small entries become a record of what you did.</p></div><div class="lp-week-scene"><div class="lp-week-calendar"><div class="lp-week-head"><strong>This week</strong><span>3 DAYS LOGGED</span></div><div class="lp-week-days"><div class="has-entry"><span>Mon</span><strong>05</strong><i></i></div><div><span>Tue</span><strong>06</strong></div><div class="has-entry"><span>Wed</span><strong>07</strong><i></i></div><div><span>Thu</span><strong>08</strong></div><div class="has-entry"><span>Fri</span><strong>09</strong><i></i></div><div><span>Sat</span><strong>10</strong></div><div><span>Sun</span><strong>11</strong></div></div><div class="lp-week-records"><div><time>MON</time><strong>Squats · 3 sets</strong><span>Workout</span></div><div><time>WED</time><strong>Tofu lunch</strong><span>Meal</span></div><div><time>FRI</time><strong>Dinner · ฿900</strong><span>Expense</span></div></div></div><div class="lp-week-summary"><span>YOUR WEEK</span><strong>3 <small>days with entries</small></strong><div><span>Workouts</span><b>1</b></div><div><span>Meals</span><b>1</b></div><div><span>Expenses</span><b>1</b></div><p>Keep adding the moments you want to track.</p></div></div><small class="lp-illustration-note">Illustrative entries</small></section>

      <section class="lp-habit-trends"><div class="lp-habit-trends-copy"><h2>See the change. Ask about it.</h2><p>Open your charts in Ankan, then ask in the AI app you use.</p><div class="lp-trend-question"><span>What happened to my savings in February?</span></div><div class="lp-trend-apps" aria-label="Ask in ChatGPT, Claude, Gemini, Muse, Telegram, Instinct, or OpenClaw"><img src="/brands/openai.svg" alt="ChatGPT" /><img src="/brands/claude.svg" alt="Claude" /><img src="/brands/gemini.png" alt="Gemini" /><img src="/brands/muse.svg" alt="Muse" /><img src="/brands/telegram.svg" alt="Telegram" /><img src="/brands/instinct.ico" alt="Instinct" /><img src="/brands/openclaw.svg" alt="OpenClaw" /></div></div><figure class="lp-trend-capture"><div class="lp-trend-image"><img src="/images/overview.png" alt="Actual Ankan savings per month chart showing a February dip and recovery by April" /></div><figcaption>Actual Ankan overview with example account data</figcaption></figure></section>

      <LandingFinance />

      <section class="lp-habit-close"><div><h2>Start with one entry.</h2><p>Send it in Telegram. Watch the record grow.</p><router-link class="lp-button lp-button-light" to="/signup" @click="emit('cta', 'footer')">Get started <ArrowUpRight :size="18" /></router-link></div><div class="lp-close-message"><div><img src="/brands/telegram.svg" alt="Telegram" /><strong>Telegram</strong></div><p>Ran 6 km today</p><small><span class="lp-story-ankan">a</span>Saved in Ankan</small></div></section>
    </main>
    <footer class="lp-footer"><span>ankan © {{ new Date().getFullYear() }}</span><div><router-link to="/pricing">Pricing</router-link><router-link to="/privacy">Privacy</router-link><router-link to="/terms">Terms</router-link></div></footer>
  </div>
</template>
