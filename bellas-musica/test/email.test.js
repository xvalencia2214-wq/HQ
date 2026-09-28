import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { startApp, client, inDays, makeGroup, bookingBody } from "./helpers.js";

const emails = (S, where = "1=1", ...p) => S.db.all(`SELECT * FROM email_log WHERE ${where} ORDER BY id`, ...p);

test("booking emails go to the right people, in their language, with links that work", async () => {
  const S = await startApp({ BUSINESS_ADDRESS: "123 W Cermak Rd, Chicago, IL 60608", SUPPORT_EMAIL: "help@bellas.test" });
  try {
    const owner = client(S.base), cust = client(S.base);
    await owner.signup("em-o@example.com", "Olga Owner");
    await cust.signup("em-c@example.com", "Carlos Cliente"); await cust.patch("/api/me", { lang: "es" });
    const d = inDays(30), d2 = inDays(31);
    const gid = await makeGroup(owner, { name: 'Los <b>Reyes</b> & "Co"', dates: [d, d2] });
    const b = (await cust.post("/api/bookings", bookingBody(gid, d))).json.booking;
    assert.equal(emails(S, "kind LIKE 'booking.%'").length, 0); // no booking emails until the deposit is paid
    await cust.post(`/api/bookings/${b.id}/simulate-pay`);
    const toOwner = emails(S, "kind = ?", "booking.requested.group")[0], toCust = emails(S, "kind = ?", "booking.received.customer")[0];
    assert.match(toOwner.subject, /New booking request/); assert.match(toOwner.body, /Carlos|Ana Garcia/); assert.match(toOwner.body, /\$90/); // 150 deposit - 60 fee
    assert.match(toOwner.body, /#\/dashboard\?g=.*tab=requests/);
    assert.match(toCust.subject, /^Recibimos tu solicitud/); assert.match(toCust.body, /depósito/); // Spanish for the Spanish-speaking customer
    assert.match(toCust.body, /123 W Cermak Rd/); // postal address in the footer
    assert.doesNotMatch(toCust.body, /Stop these notifications|Dejar de recibir/); // receipts are transactional: no unsubscribe needed
    await owner.patch(`/api/bookings/${b.id}`, { action: "accept" });
    assert.match(emails(S, "to_email = ? AND kind = ?", "em-c@example.com", "booking.confirmed.customer")[0].subject, /^Confirmado:/);
    await cust.patch(`/api/bookings/${b.id}`, { action: "cancel" });
    assert.match(emails(S, "to_email = ? AND kind = ?", "em-o@example.com", "booking.cancelled.group")[0].subject, /cancelled by the customer/);
    // decline path
    const b2 = (await cust.post("/api/bookings", bookingBody(gid, d2))).json.booking; await cust.post(`/api/bookings/${b2.id}/simulate-pay`);
    await owner.patch(`/api/bookings/${b2.id}`, { action: "decline" });
    const dec = emails(S, "kind = ?", "booking.declined.customer")[0];
    assert.match(dec.body, /\$150/); assert.match(dec.body, /reembolsando/);
    // owner cancelling a confirmed booking
    const d3 = inDays(32); await owner.put(`/api/groups/${gid}/availability`, { dates: { [d3]: ["12:00 PM"] } });
    const b3 = (await cust.post("/api/bookings", bookingBody(gid, d3, { time: "12:00 PM" }))).json.booking; await cust.post(`/api/bookings/${b3.id}/simulate-pay`);
    await owner.patch(`/api/bookings/${b3.id}`, { action: "accept" }); await owner.patch(`/api/bookings/${b3.id}`, { action: "cancel" });
    assert.match(emails(S, "kind = ?", "booking.cancelled.customer")[0].subject, /canceló tu reserva/);
  } finally { await S.close(); }
});

test("message emails are optional: they carry an unsubscribe link that really works", async () => {
  const S = await startApp();
  try {
    const owner = client(S.base), cust = client(S.base);
    await owner.signup("un-o@example.com", "Una Owner"); await cust.signup("un-c@example.com", "Una Cust");
    const gid = await makeGroup(owner, { name: "Unsub Band" });
    await cust.post(`/api/groups/${gid}/messages`, { text: "hello" });
    const m = emails(S, "kind = 'message.group'")[0];
    assert.match(m.body, /Stop these notifications: http/);
    const url = m.body.match(/Stop these notifications: (\S+)/)[1];
    assert.equal((await fetch(url.replace(/&t=.*/, "&t=forged"))).status, 200); // page renders, but...
    assert.equal(S.db.get("SELECT email_notify n FROM users WHERE email = 'un-o@example.com'").n, 1); // ...a forged link changes nothing
    const ok = await fetch(url); assert.match(await ok.text(), /no longer receive/);
    assert.equal(S.db.get("SELECT email_notify n FROM users WHERE email = 'un-o@example.com'").n, 0);
    const one = await fetch(url.replace(/&t=.*/, "&t=bad"), { method: "POST" }); assert.equal(one.status, 400); // one-click needs a valid signature too
    S.db.run("UPDATE messages SET created_at = created_at - 4000"); // let the 30-minute throttle pass
    const before = emails(S, "kind = 'message.group'").length;
    await cust.post(`/api/groups/${gid}/messages`, { text: "again" });
    assert.equal(emails(S, "kind = 'message.group'").length, before); // opted out: no more message emails
    // but receipts still arrive
    const d = inDays(30); await owner.put(`/api/groups/${gid}/availability`, { dates: { [d]: ["12:00 PM"] } });
    const b = (await cust.post("/api/bookings", bookingBody(gid, d, { time: "12:00 PM" }))).json.booking; await cust.post(`/api/bookings/${b.id}/simulate-pay`);
    assert.equal(emails(S, "to_email = 'un-o@example.com' AND kind = 'booking.requested.group'").length, 1);
    // and the user can flip it back in their account
    assert.equal((await owner.patch("/api/me", { email_notify: true })).json.user.email_notify, true);
  } finally { await S.close(); }
});

test("HTML emails escape everything a user typed", async () => {
  const S = await startApp();
  try {
    const owner = client(S.base), cust = client(S.base);
    await owner.signup("esc-o@example.com", "Esc Owner"); await cust.signup("esc-c@example.com", "Esc Cust");
    const gid = await makeGroup(owner, { name: '<img src=x onerror=alert(1)> Band' });
    await cust.post(`/api/groups/${gid}/messages`, { text: "hi" });
    const { renderEmail } = await import("../server/emails.js");
    const r = renderEmail({ subject: '<script>alert(1)</script>', lines: ['x "quoted" <b>bold</b>'], cta: { label: "<i>Go</i>", url: 'https://x.test/?a="><script>' } }, { lang: "en", config: S.ctx.config, unsubUrl: "" });
    assert.doesNotMatch(r.html, /<script>alert|<b>bold|<i>Go/); assert.match(r.html, /&lt;script&gt;/); assert.match(r.html, /&quot;&gt;&lt;script&gt;/);
    assert.match(emails(S, "kind = 'message.group'")[0].subject, /<img src=x/); // plain-text subject is not HTML, so it stays literal
  } finally { await S.close(); }
});

test("Resend: real requests carry the key, sender, unsubscribe headers; failures are logged, never thrown", async () => {
  const seen = []; let fail = false;
  const srv = http.createServer(async (req, res) => { let b = ""; for await (const c of req) b += c; seen.push({ url: req.url, auth: req.headers.authorization, body: JSON.parse(b) }); res.writeHead(fail ? 500 : 200, { "Content-Type": "application/json" }); res.end("{}"); });
  await new Promise((r) => srv.listen(0, r));
  const S = await startApp({ RESEND_API_KEY: "re_test_123", EMAIL_FROM: "Bella's Música <hello@bellas.test>", EMAIL_REPLY_TO: "help@bellas.test", EMAIL_API_BASE: `http://127.0.0.1:${srv.address().port}` });
  try {
    const owner = client(S.base), cust = client(S.base);
    await owner.signup("rs-o@example.com", "Rs Owner"); await cust.signup("rs-c@example.com", "Rs Cust");
    const gid = await makeGroup(owner, { name: "Resend Band" });
    await cust.post(`/api/groups/${gid}/messages`, { text: "hello" });
    await new Promise((r) => setTimeout(r, 150));
    const m = seen.find((x) => x.body.to[0] === "rs-o@example.com" && /New message/.test(x.body.subject));
    assert.equal(m.url, "/emails"); assert.equal(m.auth, "Bearer re_test_123");
    assert.equal(m.body.from, "Bella's Música <hello@bellas.test>"); assert.equal(m.body.reply_to, "help@bellas.test");
    assert.match(m.body.headers["List-Unsubscribe"], /^<http.*\/unsubscribe\?u=\d+&t=/); assert.equal(m.body.headers["List-Unsubscribe-Post"], "List-Unsubscribe=One-Click");
    assert.match(m.body.html, /<a href="http/); assert.match(m.body.text, /Open messages/);
    assert.equal(S.db.get("SELECT sent FROM email_log WHERE kind = 'message.group'").sent, 1);
    fail = true; S.db.run("UPDATE messages SET created_at = created_at - 4000");
    assert.equal((await cust.post(`/api/groups/${gid}/messages`, { text: "again" })).status, 200); // provider outage never breaks the request
    await new Promise((r) => setTimeout(r, 150));
    assert.match(S.db.all("SELECT error FROM email_log ORDER BY id DESC LIMIT 1")[0].error, /Email provider 500/);
  } finally { await S.close(); srv.closeAllConnections?.(); srv.close(); }
});
