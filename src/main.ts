import { createApp } from "vue";
import { createPinia } from "pinia";
import App from "./App.vue";
import router from "./router";
import "./style.css";
import "vue-sonner/style.css";
import { useAuthStore } from "@/stores/auth";

const app = createApp(App);
const pinia = createPinia();

app.use(pinia);
app.use(router);

// Bootstrap auth (check localStorage for existing session) before mounting.
// This runs async — the store starts in "loading" state and transitions
// to "ready" or "unauthenticated" once complete.
const auth = useAuthStore();
auth.bootstrap();

app.mount("#app");

export default app;
