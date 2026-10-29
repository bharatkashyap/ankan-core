import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { generateKeyPairSync } from "node:crypto";
import { spawnSync } from "node:child_process";

const shared = process.env.ANKAN_SHARED_DIR || "/convex/data";
const adminKey = readFileSync(`${shared}/admin-key`, "utf8").trim();
if (!adminKey) throw new Error("Convex admin key is missing");
const env = {
  ...process.env,
  CONVEX_SELF_HOSTED_ADMIN_KEY: adminKey,
  CONVEX_SELF_HOSTED_URL: process.env.CONVEX_SELF_HOSTED_URL || "http://backend:3210",
};

function convex(...args) {
  const result = spawnSync("pnpm", ["exec", "convex", ...args], {
    cwd: process.env.ANKAN_APP_DIR || "/app", env, stdio: "inherit",
  });
  if (result.status !== 0) throw new Error(`convex ${args[0]} failed (${result.status ?? "signal"})`);
}

function setEnv(name, value) {
  const result = spawnSync("pnpm", ["exec", "convex", "env", "set", name], {
    cwd: process.env.ANKAN_APP_DIR || "/app", env, input: value,
    stdio: ["pipe", "inherit", "inherit"],
  });
  if (result.status !== 0) throw new Error(`convex env set ${name} failed (${result.status ?? "signal"})`);
}

const keysPath = `${shared}/auth-keys.json`;
let keys;
if (existsSync(keysPath)) {
  keys = JSON.parse(readFileSync(keysPath, "utf8"));
} else {
  const { publicKey, privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  keys = {
    JWT_PRIVATE_KEY: privateKey.export({ type: "pkcs8", format: "pem" }).trimEnd().replace(/\n/g, " "),
    JWKS: JSON.stringify({ keys: [{ use: "sig", ...publicKey.export({ format: "jwk" }) }] }),
  };
  writeFileSync(keysPath, JSON.stringify(keys), { mode: 0o600 });
}

setEnv("JWT_PRIVATE_KEY", keys.JWT_PRIVATE_KEY);
setEnv("JWKS", keys.JWKS);
setEnv("SITE_URL", process.env.APP_PUBLIC_URL || "http://localhost:3000");
setEnv("APP_PUBLIC_URL", process.env.APP_PUBLIC_URL || "http://localhost:3000");
setEnv("ANKAN_APP_URL", process.env.APP_PUBLIC_URL || "http://localhost:3000");
setEnv("MCP_PUBLIC_ORIGIN", process.env.MCP_PUBLIC_ORIGIN || "http://localhost:3002");
setEnv("MCP_PROXY_SECRET", readFileSync(`${shared}/mcp-secret`, "utf8").trim());
setEnv("SELF_HOSTED_MODE", "1");
for (const name of [
  "ZEPTOMAIL_SEND_API_KEY", "ZEPTOMAIL_FROM_ADDRESS", "ZEPTOMAIL_API_URL",
  "CLOUDFLARE_TURNSTILE_SECRET_KEY", "TELEGRAM_BOT_TOKEN",
  "TELEGRAM_WEBHOOK_SECRET", "GOOGLE_AI_API_KEY", "JEV_API_KEY",
]) {
  if (process.env[name]) setEnv(name, process.env[name]);
}
convex("deploy", "--yes", "--typecheck", "disable");
console.log("Ankan Core is ready at http://localhost:3000");
