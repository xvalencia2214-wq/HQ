import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { startApp, client, inDays, makeGroup, bookingBody } from "./helpers.js";

const mails = (S, kind, to) => S.db.all("SELECT * FROM email_log WHERE kind = ?" + (to ? " AND to_email = ?" : "") + " ORDER BY id", ...(to ? [kind, to] : [kind]));
const linkIn = (m, re) => m.body.match(re)[1];

test("password reset: emailed one-time link, expires, works once, signs out everywhere, tells nothing about who has an account", async () => {
  const S = await startApp();
  try {
    const a = client(S.base), other = client(S.base);
    await a.signup("pr@example.com", "Pat Reset");
    await other.post("/api/auth/login", { email: "pr@example.com", password: "correct horse battery" });
    // same answer for known and unknown emails; only the real one gets mail
    assert.deepEqual((await client(S.base).post("/api/auth/forgot", { email: "pr@example.com" })).json, { ok: true });
    assert.deepEqual((await client(S.base).post("/api/auth/forgot", { email: "nobody@example.com" })).json, { ok: true });
    assert.equal(mails(S, "auth.reset").length, 1); assert.equal(mails(S, "auth.reset", "nobody@example.com").length, 0);
    const token = linkIn(mails(S, "auth.reset")[0], /#\/reset\/([\w-]+)/);
    assert.equal(S.db.get("SELECT COUNT(*) c FROM auth_tokens WHERE token_hash = ?", token).c, 0); // the raw token is never stored
    assert.equal((await a.post("/api/auth/reset", { token: "x".repeat(43), password: "brand new password" })).status, 400); // wrong token
    assert.equal((await a.post("/api/auth/reset", { token, password: "short" })).status, 400);
    assert.equal(S.db.get("SELECT used_at FROM auth_tokens").used_at, null); // a bad password doesn't burn the link... 
    assert.equal((await a.post("/api/auth/reset", { token, password: "brand new password" })).status, 200);
    assert.equal((await a.post("/api/auth/reset", { token, password: "another new password" })).status, 400); // ...but a good use does: no replay
    assert.equal((await other.get("/api/me")).json.user, null); // every session was ended
    assert.equal((await client(S.base).post("/api/auth/login", { email: "pr@example.com", password: "correct horse battery" })).status, 401);
    assert.equal((await client(S.base).post("/api/auth/login", { email: "pr@example.com", password: "brand new password" })).status, 200);
    assert.equal(mails(S, "auth.reset_done", "pr@example.com").length, 1); // security notice
    // a newer link replaces an older one; expired links fail
    await client(S.base).post("/api/auth/forgot", { email: "pr@example.com" }); await client(S.base).post("/api/auth/forgot", { email: "pr@example.com" });
    const [t1, t2] = mails(S, "auth.reset").slice(1).map((m) => linkIn(m, /#\/reset\/([\w-]+)/));
    assert.equal((await client(S.base).post("/api/auth/reset", { token: t1, password: "yet another password" })).status, 400);
    S.db.run("UPDATE auth_tokens SET expires_at = expires_at - 7200");
    assert.equal((await client(S.base).post("/api/auth/reset", { token: t2, password: "yet another password" })).status, 400);
  } finally { await S.close(); }
});

test("forgot-password is rate limited", async () => {
  const S = await startApp({ RATE_FORGOT: "3" });
  try {
    const c = client(S.base); let last;
    for (let i = 0; i < 5; i++) last = await c.post("/api/auth/forgot", { email: "spam@example.com" });
    assert.equal(last.status, 429);
  } finally { await S.close(); }
});

test("email confirmation: sent at signup, link confirms, booking requires it when real email is on", async () => {
  const seen = []; const srv = http.createServer(async (req, res) => { let b = ""; for await (const c of req) b += c; seen.push(JSON.parse(b)); res.writeHead(200, { "Content-Type": "application/json" }); res.end("{}"); });
  await new Promise((r) => srv.listen(0, r));
  const live = await startApp({ RESEND_API_KEY: "re_x", EMAIL_FROM: "Bella <h@bellas.test>", EMAIL_API_BASE: `http://127.0.0.1:${srv.address().port}` });
  const sim = await startApp();
  try {
    // simulated email: no gate
    const so = client(sim.base), sc = client(sim.base); await so.signup("v-o@example.com", "V Owner"); await sc.signup("v-c@example.com", "V Cust");
    const sd = inDays(30); const sg = await makeGroup(so, { name: "Sim Band", dates: [sd] });
    assert.equal((await sc.post("/api/bookings", bookingBody(sg, sd))).status, 200);
    // live email: unverified users cannot book until they click the link
    const o = client(live.base), c = client(live.base); await o.signup("lv-o@example.com", "Live Owner"); const me = await c.signup("lv-c@example.com", "Live Cust");
    assert.equal(me.email_verified, false);
    const d = inDays(30); const gid = await makeGroup(o, { name: "Live Band", dates: [d] });
    await live.ctx.db.run("UPDATE groups SET stripe_ready = 1"); // payouts aside, this test is about the email gate
    const blocked = await c.post("/api/bookings", bookingBody(gid, d));
    assert.equal(blocked.status, 403); assert.equal(blocked.json.code, "verify_email");
    await new Promise((r) => setTimeout(r, 150));
    const mail = seen.find((m) => m.to[0] === "lv-c@example.com" && /Confirm your email/.test(m.subject));
    const token = mail.text.match(/#\/verify\/([\w-]+)/)[1];
    assert.equal((await c.post("/api/auth/verify", { token: "nope".repeat(10) })).status, 400);
    assert.equal((await c.post("/api/auth/resend-verification")).json.ok, true); // resend works; the older link stops working
    assert.equal((await c.post("/api/auth/verify", { token })).status, 400);
    await new Promise((r) => setTimeout(r, 150));
    const token2 = seen.filter((m) => m.to[0] === "lv-c@example.com" && /Confirm your email/.test(m.subject)).at(-1).text.match(/#\/verify\/([\w-]+)/)[1];
    assert.equal((await client(live.base).post("/api/auth/verify", { token: token2 })).status, 200); // works even from another browser
    assert.equal((await c.get("/api/me")).json.user.email_verified, true);
    assert.notEqual((await c.post("/api/bookings", bookingBody(gid, d))).json.code, "verify_email");
    assert.equal((await c.post("/api/auth/resend-verification")).json.already, true);
  } finally { await sim.close(); await live.close(); srv.closeAllConnections?.(); srv.close(); }
});

test("event reminders: a week before and the day before, once each, only in daytime hours", async () => {
  const S = await startApp();
  try {
    const { sendEventReminders } = await import("../server/jobs.js");
    const owner = client(S.base), cust = client(S.base);
    await owner.signup("rm-o@example.com", "Rem Owner"); await cust.signup("rm-c@example.com", "Rem Cust", { phone: "312-555-0177", sms_opt_in: true });
    const d1 = inDays(40), d2 = inDays(41), d3 = inDays(42);
    const gid = await makeGroup(owner, { name: "Reminder Band", dates: [d1, d2, d3] });
    const mk = async (d) => { const b = (await cust.post("/api/bookings", bookingBody(gid, d))).json.booking; await cust.post(`/api/bookings/${b.id}/simulate-pay`); await owner.patch(`/api/bookings/${b.id}`, { action: "accept" }); return b.id; };
    const [w, t, far] = [await mk(d1), await mk(d2), await mk(d3)];
    S.db.run("UPDATE bookings SET date = ? WHERE id = ?", inDays(7), w); S.db.run("UPDATE bookings SET date = ? WHERE id = ?", inDays(1), t);
    assert.equal(sendEventReminders(S.ctx, { hour: 3 }), 0); // 3 a.m.: nobody gets woken up
    assert.equal(sendEventReminders(S.ctx, { hour: 12 }), 2); // two bookings reminded: a week-before (customer) and tomorrow (customer + group)
    const kinds = S.db.all("SELECT kind, to_email, subject FROM email_log WHERE kind LIKE 'event.reminder.%'");
    assert.equal(kinds.filter((k) => k.to_email === "rm-c@example.com").length, 2); assert.equal(kinds.filter((k) => k.to_email === "rm-o@example.com").length, 1);
    assert.ok(kinds.some((k) => /In a week/.test(k.subject))); assert.ok(kinds.some((k) => /Tomorrow/.test(k.subject)));
    assert.match(S.db.get("SELECT body FROM email_log WHERE kind = 'event.reminder.group'").body, /Customer phone: \+13125550142/); // confirmed: the group may see it
    assert.ok(S.db.all("SELECT body FROM sms_log").some((r) => /reminder/.test(r.body)));
    assert.equal(sendEventReminders(S.ctx, { hour: 12 }), 0); // never twice
    assert.equal(S.db.get("SELECT reminder7_sent a, reminder1_sent b FROM bookings WHERE id = ?", far).a, 0); // a booking 40 days out gets nothing
  } finally { await S.close(); }
});
