<template>
  <main class="utility-page">
    <header class="utility-nav"><router-link to="/landing" class="brand-mark"><span class="brand-mark__seal">A</span><span>ANKAN</span></router-link><nav aria-label="Legal and product navigation"><router-link to="/pricing">Pricing</router-link><router-link to="/privacy">Privacy</router-link><router-link to="/terms" class="active">Terms</router-link><router-link to="/signup" class="nav-action">Create account</router-link></nav></header>
    <section class="utility-hero"><h1>Self-hosting terms</h1></section>
    <section class="legal-copy"><p>Ankan Core is open-source software under the MIT license. The person running an instance controls its data and access.</p><p>If you make your instance available to others, you are responsible for its operating terms and privacy notice.</p><p>Financial, tax, and AI outputs are informational and should be checked before use.</p></section>
    <section class="legal-action"><p>Ready to start a record in Ankan?</p><router-link to="/signup" class="button button--primary">Create your account</router-link></section>
    <footer class="utility-footer"><span>ANKAN / YOUR RECORD, IN VIEW</span><div><router-link to="/landing">Product</router-link><router-link to="/pricing">Pricing</router-link><router-link to="/privacy">Privacy</router-link></div></footer>
  </main>
</template>
<style src="./utility.css"></style>
