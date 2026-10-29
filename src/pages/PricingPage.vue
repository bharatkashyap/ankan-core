<template>
  <main class="utility-page">
    <header class="utility-nav"><router-link to="/landing" class="brand-mark"><span class="brand-mark__seal">A</span><span>ANKAN CORE</span></router-link><nav aria-label="Product navigation"><router-link to="/pricing" class="active">Self-hosting</router-link><router-link to="/privacy">Privacy</router-link><router-link to="/terms">Terms</router-link><router-link to="/signup" class="nav-action">Create account</router-link></nav></header>
    <section class="utility-hero"><h1>Run Ankan Core yourself.</h1><p>The core app and its Convex database run on your machine with Docker Compose. You control the server and its data volume.</p><div class="actions"><router-link to="/signup" class="button button--primary">Create your account</router-link><router-link to="/landing" class="plain-link">Back to Ankan</router-link></div></section>
    <section class="pricing-table-section"><div class="section-title-row"><h2>What you need</h2><p>An email sending account is required for sign-in codes. Telegram, Google AI, and MCP are optional integrations.</p></div></section>
    <footer class="utility-footer"><span>ANKAN CORE</span><div><router-link to="/landing">Product</router-link><router-link to="/privacy">Privacy</router-link><router-link to="/terms">Terms</router-link></div></footer>
  </main>
</template>

<style src="./utility.css"></style>
