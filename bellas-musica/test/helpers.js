import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import crypto from "node:crypto";
import { loadConfig } from "../server/config.js";
import { createApp } from "../server/app.js";

export async function startApp(env = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bm-test-"));
  const config = loadConfig({ DATA_DIR: dir, BASE_URL: "http://localhost:3000", RATE_API: "100000", RATE_REGISTER: "1000", RATE_FORGOT: "1000", RATE_WAITLIST: "1000", RATE_BOOKING: "1000", RATE_CHAT: "1000", RATE_UPLOAD: "1000", ...env });
  const app = createApp(config);
  const port = await app.listen(0);
  const base = `http://127.0.0.1:${port}`;
  config.baseUrl = base;
  return { app, ctx: app.ctx, db: app.ctx.db, base, dir, close: () => app.close() };
}

// Tiny HTTP client with a cookie jar, one per simulated browser.
export function client(base) {
  let cookie = "";
  async function call(method, url, body, headers = {}) {
    const res = await fetch(base + url, {
      method,
      headers: { ...(body !== undefined ? { "Content-Type": "application/json" } : {}), ...(cookie ? { Cookie: cookie } : {}), ...headers },
      body: body !== undefined ? JSON.stringify(body) : undefined
    });
    const set = res.headers.get("set-cookie");
    if (set) { const c = set.split(";")[0]; cookie = c.endsWith("=") ? "" : c; }
    let json = null;
    try { json = await res.json(); } catch { /* not json */ }
    return { status: res.status, json, headers: res.headers };
  }
  return {
    cookie: () => cookie,
    get: (u) => call("GET", u),
    post: (u, b = {}) => call("POST", u, b),
    put: (u, b = {}) => call("PUT", u, b),
    patch: (u, b = {}) => call("PATCH", u, b),
    del: (u) => call("DELETE", u),
    raw: call,
    async signup(email, name = "Test User", extra = {}) {
      const r = await call("POST", "/api/auth/register", { email, password: "correct horse battery", name, ...extra });
      if (r.status !== 200) throw new Error("signup failed " + JSON.stringify(r.json));
      return r.json.user;
    }
  };
}

export const ymd = (d) => d.toISOString().slice(0, 10);
export const inDays = (n) => { const d = new Date(); d.setDate(d.getDate() + n); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };

// A tiny stand-in for api.stripe.com that records every request it receives.
export async function fakeStripe() {
  const calls = [];
  const state = { sessionPaid: false, sessionAmount: 0, ready: true, failRefunds: false, refundDelay: 0, refunded: [], idem: new Map(), connectEnabled: true, chargesEnabled: true, webhooks: [] };
  const server = http.createServer(async (req, res) => {
    let body = "";
    for await (const c of req) body += c;
    const form = Object.fromEntries(new URLSearchParams(body));
    calls.push({ method: req.method, url: req.url, form, auth: req.headers.authorization, idem: req.headers["idempotency-key"] });
    const send = (o) => { res.writeHead(200, { "Content-Type": "application/json" }); res.end(JSON.stringify(o)); };
    if (req.method === "POST" && req.url === "/v1/checkout/sessions") return send({ id: "cs_test_" + calls.length, url: "https://checkout.stripe.test/pay/" + calls.length });
    if (req.method === "POST" && /^\/v1\/checkout\/sessions\/[^/]+\/expire$/.test(req.url)) return send({ id: req.url.split("/")[4], status: "expired" });
    if (req.method === "GET" && req.url.startsWith("/v1/checkout/sessions/")) return send({ id: req.url.split("/").pop(), status: state.sessionPaid ? "complete" : "open", url: state.sessionPaid ? null : "https://checkout.stripe.test/resume", payment_status: state.sessionPaid ? "paid" : "unpaid", amount_total: state.sessionAmount, payment_intent: "pi_test_1" });
    if (req.method === "POST" && req.url === "/v1/refunds") {
      if (state.refundDelay) await new Promise((r) => setTimeout(r, state.refundDelay));
      if (state.failRefunds) { res.writeHead(500, { "Content-Type": "application/json" }); return res.end(JSON.stringify({ error: { message: "refund failed" } })); }
      const key = req.headers["idempotency-key"];
      if (key && state.idem.has(key)) return send(state.idem.get(key)); // like Stripe: same key = same result, no second refund
      const out = { id: "re_test_" + calls.length };
      state.refunded.push({ pi: form.payment_intent, amount: Number(form.amount) });
      if (key) state.idem.set(key, out);
      return send(out);
    }
    if (req.method === "GET" && req.url === "/v1/account") return send({ id: "acct_platform", country: "US", charges_enabled: state.chargesEnabled });
    if (req.method === "GET" && req.url.startsWith("/v1/accounts?")) {
      if (!state.connectEnabled) { res.writeHead(400, { "Content-Type": "application/json" }); return res.end(JSON.stringify({ error: { message: "You can only create new accounts if you've signed up for Connect" } })); }
      return send({ data: [] });
    }
    if (req.method === "GET" && req.url.startsWith("/v1/webhook_endpoints")) return send({ data: state.webhooks });
    if (req.method === "POST" && req.url === "/v1/accounts") return send({ id: "acct_test_1" });
    if (req.method === "POST" && req.url === "/v1/account_links") return send({ url: "https://connect.stripe.test/onboard" });
    if (req.method === "GET" && req.url.startsWith("/v1/accounts/")) return send({ id: "acct_test_1", charges_enabled: state.ready, payouts_enabled: state.ready });
    res.writeHead(404, { "Content-Type": "application/json" }); res.end(JSON.stringify({ error: { message: "unknown" } }));
  });
  await new Promise((r) => server.listen(0, r));
  return { calls, state, url: `http://127.0.0.1:${server.address().port}`, close: () => new Promise((r) => { server.close(r); server.closeAllConnections?.(); }) };
}

export function signWebhook(payload, secret, t = Math.floor(Date.now() / 1000)) {
  const raw = typeof payload === "string" ? payload : JSON.stringify(payload);
  const sig = crypto.createHmac("sha256", secret).update(`${t}.${raw}`).digest("hex");
  return { raw, header: `t=${t},v1=${sig}` };
}

export async function postWebhook(base, payload, secret, opts = {}) {
  const { raw, header } = signWebhook(payload, secret, opts.t);
  const res = await fetch(base + "/api/stripe/webhook", { method: "POST", headers: { "Stripe-Signature": opts.header || header, "Content-Type": "application/json" }, body: raw });
  return { status: res.status, json: await res.json().catch(() => null) };
}

const TINY_PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(64, 1)]).toString("base64");

// A published group with open slots on the given dates. Pass `draft: true` to leave it unpublished and unfinished.
export async function makeGroup(owner, { name = "Test Mariachi", zip = "60608", rate = 300, dates = [], extra = {}, draft = false, photo = true } = {}) {
  const c = await owner.post("/api/groups", { name, type: "Mariachi", zip, rate, members: 6, story: draft ? "We play." : "We play mariachi music for weddings, quinceañeras and family parties." });
  if (c.status !== 200) throw new Error("group create failed " + JSON.stringify(c.json));
  const id = c.json.id;
  const patch = { ...extra };
  if (!draft) {
    if (!patch.story || patch.story.length < 40) patch.story = "We play mariachi music for weddings, quinceañeras and family parties.";
    if (!patch.events) patch.events = ["Wedding", "Quinceañera"];
  }
  if (Object.keys(patch).length) { const r = await owner.patch(`/api/groups/${id}`, patch); if (r.status !== 200) throw new Error("group patch failed " + JSON.stringify(r.json)); }
  if (dates.length) await owner.put(`/api/groups/${id}/availability`, { dates: Object.fromEntries(dates.map((d) => [d, ["12:00 PM", "2:00 PM", "4:00 PM"]])) });
  if (!draft) {
    if (!dates.length) await owner.post(`/api/groups/${id}/availability/weekends`, { weeks: 2 });
    if (photo) await owner.post(`/api/groups/${id}/photos`, { data: TINY_PNG });
    let p = await owner.post(`/api/groups/${id}/publish`);
    if (p.status === 400 && p.json.missing?.includes("payouts")) { // live Stripe mode: finish payout setup first, like a real group must
      await owner.post(`/api/groups/${id}/stripe/onboard`); await owner.post(`/api/groups/${id}/stripe/refresh`);
      p = await owner.post(`/api/groups/${id}/publish`);
    }
    if (p.status !== 200) throw new Error("publish failed " + JSON.stringify(p.json));
  }
  return id;
}

export const bookingBody = (groupId, date, over = {}) => ({
  groupId, date, time: "2:00 PM", hours: 2, event: "Wedding", guests: 100, eventZip: "60608",
  name: "Ana Garcia", phone: "(312) 555-0142", address: "Casa Blanca Hall, Chicago", message: "Please play Volver Volver", acceptPolicy: true, ...over
});
