import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, readFileSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

test("first and repeat boots retain auth keys and deploy with the local admin key", () => {
  const dir = mkdtempSync(join(tmpdir(), "ankan-core-"));
  try {
    mkdirSync(join(dir, "bin"));
    writeFileSync(join(dir, "admin-key"), "local-admin-key\n");
    writeFileSync(join(dir, "mcp-secret"), "m".repeat(64));
    const log = join(dir, "calls.log");
    writeFileSync(join(dir, "bin", "pnpm"), `#!/usr/bin/env node\nconst fs=require('fs');fs.appendFileSync(process.env.CALLS_LOG,JSON.stringify({args:process.argv.slice(2),key:process.env.CONVEX_SELF_HOSTED_ADMIN_KEY})+'\\n');\n`, { mode: 0o755 });
    const env = { ...process.env, PATH: `${join(dir, "bin")}:${process.env.PATH}`, CALLS_LOG: log,
      ANKAN_SHARED_DIR: dir, ANKAN_APP_DIR: process.cwd(), CONVEX_SELF_HOSTED_URL: "http://backend:3210", APP_PUBLIC_URL: "http://localhost:3000" };
    for (let run = 0; run < 2; run += 1) {
      const result = spawnSync(process.execPath, ["docker/deploy.mjs"], { cwd: process.cwd(), env, encoding: "utf8" });
      assert.equal(result.status, 0, result.stderr);
      assert.ok(JSON.parse(readFileSync(join(dir, "auth-keys.json"), "utf8")).JWKS);
    }
    const calls = readFileSync(log, "utf8").trim().split("\n").map(JSON.parse);
    assert.ok(calls.every((call) => call.key === "local-admin-key"));
    assert.deepEqual(calls.at(-1).args, ["exec", "convex", "deploy", "--yes", "--typecheck", "disable"]);
    const jwks = calls.filter((call) => call.args[4] === "JWKS").map((call) => call.args[5]);
    assert.equal(jwks.length, 2);
    assert.equal(jwks[0], jwks[1]);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
