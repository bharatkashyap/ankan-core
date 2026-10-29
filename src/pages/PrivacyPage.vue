<template>
  <main class="utility-page">
    <header class="utility-nav"><router-link to="/landing" class="brand-mark"><span class="brand-mark__seal">A</span><span>ANKAN</span></router-link><nav aria-label="Legal and product navigation"><router-link to="/pricing">Pricing</router-link><router-link to="/privacy" class="active">Privacy</router-link><router-link to="/terms">Terms</router-link><router-link to="/signup" class="nav-action">Create account</router-link></nav></header>
    <section class="utility-hero"><h1>Privacy</h1><p class="updated">Last updated: October 2026</p></section>
    <section class="legal-copy"><p>Ankan Core runs on infrastructure you control. Your records are stored in the local Convex data volume.</p><p>The core edition does not apply application-level encryption to stored fields. Protect the host, data volume, and backups according to your needs.</p><p>Sign-in codes are sent through the email provider you configure. Optional integrations can send relevant data to their providers when you enable them.</p></section>
    <section class="legal-action"><p>Ready to get started?</p><router-link to="/signup" class="button button--primary">Create your account</router-link></section>
    <footer class="utility-footer"><span>ANKAN / YOUR RECORD, IN VIEW</span><div><router-link to="/landing">Product</router-link><router-link to="/pricing">Pricing</router-link><router-link to="/terms">Terms</router-link></div></footer>
  </main>
</template>
<style src="./utility.css"></style>
