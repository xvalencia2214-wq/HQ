import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { DatabaseSync } from "node:sqlite";
import { startApp, client } from "./helpers.js";

const run = (dir, script, ...args) => execFileSync("node", ["--disable-warning=ExperimentalWarning", script, ...args], { env: { ...process.env, DATA_DIR: dir }, encoding: "utf8" });

test("admin: reset a password while the server is running; old password and old sessions stop working", async () => {
  const S = await startApp();
  try {
    const a = client(S.base);
    await a.signup("locked@example.com", "Locked Out");
    const out = run(S.dir, "server/admin.js", "reset-password", "LOCKED@example.com");
    const pw = out.match(/password for \S+: (\S+)/)[1];
    assert.equal((await a.get("/api/me")).json.user, null); // existing session signed out
    assert.equal((await client(S.base).post("/api/auth/login", { email: "locked@example.com", password: "correct horse battery" })).status, 401);
    assert.equal((await client(S.base).post("/api/auth/login", { email: "locked@example.com", password: pw })).status, 200);
    assert.throws(() => run(S.dir, "server/admin.js", "reset-password", "nobody@example.com"), /./);
    assert.match(run(S.dir, "server/admin.js", "stats"), /users: 1/);
  } finally { await S.close(); }
});

test("backup: consistent copy that opens and contains the data", async () => {
  const S = await startApp();
  try {
    await client(S.base).signup("backup@example.com", "Back Up");
    const dest = path.join(S.dir, "copy.db");
    run(S.dir, "server/backup.js", dest);
    const copy = new DatabaseSync(dest);
    assert.equal(copy.prepare("SELECT COUNT(*) c FROM users WHERE email = 'backup@example.com'").get().c, 1);
    copy.close();
    assert.ok(fs.statSync(dest).size > 1000);
  } finally { await S.close(); }
});

test("health endpoint and legal pages are served", async () => {
  const S = await startApp();
  try {
    assert.deepEqual(await (await fetch(S.base + "/api/health")).json(), { ok: true });
    for (const p of ["/terms.html", "/privacy.html"]) { const r = await fetch(S.base + p); assert.equal(r.status, 200); assert.match(await r.text(), /Template/); }
  } finally { await S.close(); }
});

test("private preview: everything asks for the password except the health check and Stripe's webhook", async () => {
  const S = await startApp({ DEMO_SEED: "0", PREVIEW_PASSWORD: "mariachi 2026" });
  try {
    const auth = (p) => ({ Authorization: "Basic " + Buffer.from("anyone:" + p).toString("base64") });
    for (const u of ["/", "/api/meta", "/g/x", "/robots.txt"]) {
      const r = await fetch(S.base + u);
      assert.equal(r.status, 401, u); assert.match(r.headers.get("www-authenticate"), /Basic/);
    }
    assert.equal((await fetch(S.base + "/", { headers: auth("wrong") })).status, 401);
    assert.equal((await fetch(S.base + "/", { headers: auth("mariachi 2026") })).status, 200);
    assert.equal((await fetch(S.base + "/api/meta", { headers: auth("mariachi 2026") })).status, 200);
    assert.equal((await fetch(S.base + "/api/health")).status, 200);
    assert.notEqual((await fetch(S.base + "/api/stripe/webhook", { method: "POST", body: "{}" })).status, 401);
  } finally { await S.close(); }
  // Render gives the address itself
  const { loadConfig } = await import("../server/config.js");
  assert.equal(loadConfig({ DATA_DIR: S.dir, RENDER_EXTERNAL_URL: "https://bellas-musica.onrender.com/" }).baseUrl, "https://bellas-musica.onrender.com");
  assert.equal(loadConfig({ DATA_DIR: S.dir, BASE_URL: "https://bellasmusica.com", RENDER_EXTERNAL_URL: "https://x.onrender.com" }).baseUrl, "https://bellasmusica.com");
});
