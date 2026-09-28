import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import { DatabaseSync } from "node:sqlite";
import { startApp, client, inDays, makeGroup, bookingBody, fakeStripe, postWebhook } from "./helpers.js";
import { createAlerts } from "../server/alerts.js";
import { backupIfNeeded, listBackups, backupStatus } from "../server/backups.js";
import { runPreflight } from "../server/preflight.js";
import { loadConfig } from "../server/config.js";

const hook = async () => { const got = []; const srv = http.createServer(async (req, res) => { let b = ""; for await (const c of req) b += c; got.push(JSON.parse(b)); res.writeHead(200); res.end("ok"); }); await new Promise((r) => srv.listen(0, r)); return { got, url: `http://127.0.0.1:${srv.address().port}/hook`, close: () => { srv.closeAllConnections?.(); srv.close(); } }; };
const wait = (ms = 120) => new Promise((r) => setTimeout(r, ms));

test("alerts: one message per problem per 10 minutes, Slack- and Discord-shaped, silent without a webhook", async () => {
  const h = await hook();
  try {
    const alert = createAlerts({ alertWebhook: h.url, businessName: "Bella's Música" });
    alert("Something broke", "k1"); alert("Something broke", "k1"); alert("Something else", "k2");
    await wait();
    assert.equal(h.got.length, 2);
    assert.equal(h.got[0].text, "[Bella's Música] Something broke"); assert.equal(h.got[0].content, h.got[0].text);
    const quiet = createAlerts({ alertWebhook: "", businessName: "x" }); quiet("no webhook"); await wait(30);
    assert.equal(h.got.length, 2);
  } finally { h.close(); }
});

test("a failed refund raises an alert (and still leaves the booking untouched)", async () => {
  const h = await hook(), F = await fakeStripe();
  const S = await startApp({ STRIPE_SECRET_KEY: "sk_test_x", STRIPE_WEBHOOK_SECRET: "whsec_x", STRIPE_API_BASE: F.url, ALERT_WEBHOOK_URL: h.url });
  try {
    const owner = client(S.base), cust = client(S.base);
    await owner.signup("al-o@example.com", "Al Owner"); await cust.signup("al-c@example.com", "Al Cust");
    const d = inDays(30); const gid = await makeGroup(owner, { name: "Alert Band", dates: [d] });
    await owner.post(`/api/groups/${gid}/stripe/onboard`); await owner.post(`/api/groups/${gid}/stripe/refresh`);
    const b = (await cust.post("/api/bookings", bookingBody(gid, d))).json.booking;
    await postWebhook(S.base, { id: "evt_al1", type: "checkout.session.completed", data: { object: { payment_status: "paid", amount_total: b.deposit_cents, payment_intent: "pi_al", metadata: { kind: "booking", booking_id: b.id } } } }, "whsec_x");
    F.state.failRefunds = true;
    assert.equal((await owner.patch(`/api/bookings/${b.id}`, { action: "decline" })).status, 502);
    await wait();
    assert.ok(h.got.some((m) => /REFUND FAILED for booking/.test(m.text) && m.text.includes(b.id)), JSON.stringify(h.got));
    assert.equal(S.db.get("SELECT status FROM bookings WHERE id = ?", b.id).status, "requested");
  } finally { await S.close(); await F.close(); h.close(); }
});

test("nightly backups: made once a day, verified, rotated, and stale ones raise an alert", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bm-bk-"));
  const S = await startApp({ BACKUP_DIR: dir, BACKUP_KEEP: "3" });
  try {
    await client(S.base).signup("bk@example.com", "Back Up");
    const alerts = []; S.ctx.alert = (m) => alerts.push(m);
    assert.equal(listBackups(dir).length, 1); // the server already took today's backup when it started
    for (const f of listBackups(dir)) fs.rmSync(f.path); // ...remove it so we can watch one being made
    for (const d of ["2020-01-01", "2020-01-02", "2020-01-03", "2020-01-04"]) fs.writeFileSync(path.join(dir, `bellas-${d}.db`), "old");
    const made = backupIfNeeded(S.ctx);
    assert.ok(made && fs.existsSync(made));
    const copy = new DatabaseSync(made); assert.equal(copy.prepare("SELECT COUNT(*) c FROM users WHERE email = 'bk@example.com'").get().c, 1); copy.close();
    assert.equal(listBackups(dir).length, 3); // today's plus the two newest old ones: the rest were pruned
    assert.ok(!fs.existsSync(path.join(dir, "bellas-2020-01-01.db")));
    assert.equal(backupIfNeeded(S.ctx), null); // already have today's
    assert.deepEqual(alerts, []);
    assert.equal(fs.readdirSync(dir).filter((f) => f.endsWith(".partial")).length, 0);
    const st = backupStatus(S.ctx.config); assert.equal(st.enabled, true); assert.equal(st.count, 3); assert.ok(st.last_at > Date.now() / 1000 - 60);
    // stale: the newest backup is older than 36 hours
    for (const f of listBackups(dir)) fs.utimesSync(f.path, new Date(Date.now() - 50 * 3600_000), new Date(Date.now() - 50 * 3600_000));
    backupIfNeeded(S.ctx);
    assert.ok(alerts.some((a) => /No database backup in the last 36 hours/.test(a)));
    assert.equal(backupStatus({ backupDir: "" }).enabled, false);
  } finally { await S.close(); }
});

test("analytics: anonymous counters for the funnel, per-group views, top searched ZIPs", async () => {
  const S = await startApp({ ADMIN_EMAILS: "st-admin@example.com" });
  try {
    const owner = client(S.base), cust = client(S.base), admin = client(S.base), anon = client(S.base);
    await owner.signup("st-o@example.com", "St Owner"); await cust.signup("st-c@example.com", "St Cust"); await admin.signup("st-admin@example.com", "St Admin");
    const d = inDays(30); const gid = await makeGroup(owner, { name: "Stats Band", dates: [d] });
    for (let i = 0; i < 3; i++) await anon.get("/api/search?zip=60608"); await anon.get("/api/search?zip=60623");
    await anon.get(`/api/groups/${gid}`); await cust.get(`/api/groups/${gid}`); await cust.get(`/api/groups/${gid}`);
    await owner.get(`/api/groups/${gid}`); // the group's own view does not count
    const b = (await cust.post("/api/bookings", bookingBody(gid, d))).json.booking; await cust.post(`/api/bookings/${b.id}/simulate-pay`); await owner.patch(`/api/bookings/${b.id}`, { action: "accept" });
    const s = (await admin.get("/api/admin/summary")).json;
    assert.deepEqual(s.funnel_30d, { searches: 4, group_views: 3, booking_started: 1, booking_paid: 1, booking_confirmed: 1, signups: 3 });
    assert.deepEqual(s.top_zips[0], { zip: "60608", city: "Chicago", searches: 3 });
    const mine = (await owner.get("/api/my/groups")).json.groups[0].stats_30d;
    assert.deepEqual(mine, { views: 3, requests: 1, confirmed: 1 });
    // nothing personal is stored
    const cols = S.db.all("PRAGMA table_info(stats_daily)").map((c) => c.name).sort();
    assert.deepEqual(cols, ["day", "key", "n", "ref"]);
  } finally { await S.close(); }
});

test("preflight: passes a good setup and names exactly what is wrong in a bad one", async () => {
  const F = await fakeStripe();
  const tw = http.createServer((req, res) => { res.writeHead(200, { "Content-Type": "application/json" }); res.end(JSON.stringify(req.url.includes("IncomingPhoneNumbers") ? { incoming_phone_numbers: req.url.includes("15551110000") ? [{}] : [] } : { status: "active" })); });
  const rs = http.createServer((req, res) => { res.writeHead(req.headers.authorization === "Bearer re_good" ? 200 : 401, { "Content-Type": "application/json" }); res.end(JSON.stringify({ data: [{ name: "bellas.test", status: "verified" }, { name: "pending.test", status: "pending" }] })); });
  await Promise.all([new Promise((r) => tw.listen(0, r)), new Promise((r) => rs.listen(0, r))]);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bm-pf-"));
  const env = (over = {}) => ({ DATA_DIR: dir, NODE_ENV: "production", BASE_URL: "https://bellas.test", SESSION_SECRET: "s".repeat(40), TRUST_PROXY: "1", ADMIN_EMAILS: "me@bellas.test", BUSINESS_ADDRESS: "1 Main St", SUPPORT_EMAIL: "help@bellas.test", ALERT_WEBHOOK_URL: "http://x", BACKUP_DIR: dir,
    STRIPE_SECRET_KEY: "sk_test_x", STRIPE_WEBHOOK_SECRET: "whsec_x", STRIPE_API_BASE: F.url, TWILIO_ACCOUNT_SID: "AC1", TWILIO_AUTH_TOKEN: "t", TWILIO_FROM: "+15551110000", TWILIO_API_BASE: `http://127.0.0.1:${tw.address().port}`,
    RESEND_API_KEY: "re_good", EMAIL_FROM: "Bella <hello@bellas.test>", EMAIL_API_BASE: `http://127.0.0.1:${rs.address().port}`, ...over });
  const by = (rs, name) => rs.find((r) => r.name === name);
  try {
    F.state.webhooks = [{ url: "https://bellas.test/api/stripe/webhook", status: "enabled", enabled_events: ["checkout.session.completed", "checkout.session.async_payment_succeeded"] }];
    let r = await runPreflight(loadConfig(env()));
    assert.deepEqual(r.filter((x) => x.status === "fail"), [], JSON.stringify(r.filter((x) => x.status === "fail")));
    assert.equal(by(r, "Stripe webhook endpoint").status, "ok"); assert.equal(by(r, "Email sender domain verified").status, "ok"); assert.equal(by(r, "Twilio number").status, "ok");
    assert.equal(by(r, "Twilio A2P registration").status, "warn"); // honest: cannot be checked automatically
    // now break things one at a time
    F.state.connectEnabled = false; F.state.webhooks = [{ url: "https://bellas.test/api/stripe/webhook", enabled_events: ["checkout.session.completed"] }];
    r = await runPreflight(loadConfig(env({ TWILIO_FROM: "+15559999999", EMAIL_FROM: "x <hello@pending.test>", STRIPE_WEBHOOK_SECRET: "" })));
    assert.equal(by(r, "Stripe Connect").status, "fail"); assert.match(by(r, "Stripe webhook events").detail, /async_payment_succeeded/);
    assert.equal(by(r, "STRIPE_WEBHOOK_SECRET").status, "fail"); assert.equal(by(r, "Twilio number").status, "fail"); assert.equal(by(r, "Email sender domain").status, "warn");
    F.state.webhooks = []; assert.equal(by(await runPreflight(loadConfig(env({ STRIPE_WEBHOOK_SECRET: "w" }))), "Stripe webhook endpoint").status, "fail");
    r = await runPreflight(loadConfig(env({ RESEND_API_KEY: "re_bad", BASE_URL: "http://bellas.test", SESSION_SECRET: "short" })));
    assert.equal(by(r, "Resend key").status, "fail"); assert.equal(by(r, "BASE_URL").status, "fail"); assert.equal(by(r, "SESSION_SECRET").status, "fail");
    // a bare test-mode setup only warns
    r = await runPreflight(loadConfig({ DATA_DIR: dir }));
    assert.deepEqual(r.filter((x) => x.status === "fail"), []); assert.match(by(r, "Stripe").detail, /SIMULATED/);
  } finally { await F.close(); tw.close(); rs.close(); }
});
