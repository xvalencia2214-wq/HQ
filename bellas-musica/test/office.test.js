// Mi Oficina, the owner's private AI office: only the owner can reach it; the desks' lookups never carry anyone's contact
// details to the AI; drafts wait for the owner and only Approve sends (as edited); the daily cap, the morning run and
// email, the chat, refusals and test mode.
import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { startApp, client, inDays, makeGroup, bookingBody } from "./helpers.js";

async function fakeClaude() {
  const calls = [], script = [];
  const server = http.createServer(async (req, res) => {
    let raw = ""; for await (const c of req) raw += c;
    const body = raw ? JSON.parse(raw) : {};
    calls.push({ url: req.url, headers: req.headers, body });
    const next = script.shift() || { stop_reason: "end_turn", content: [{ type: "text", text: "All quiet today." }] };
    const msg = { id: `msg_${calls.length}`, type: "message", role: "assistant", model: body.model, stop_details: null, usage: { input_tokens: 2000, output_tokens: 500, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 }, ...next };
    res.writeHead(200, { "Content-Type": "application/json" }); res.end(JSON.stringify(msg));
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  return { url: `http://127.0.0.1:${server.address().port}`, calls, script, close: () => new Promise((r) => server.close(r)) };
}
const until = async (fn, ms = 5000) => { for (let i = 0; i < ms / 50; i++) { if (await fn()) return true; await new Promise((r) => setTimeout(r, 50)); } return false; };
const ROUTES = [["get", "/api/admin/office"], ["post", "/api/admin/office/run", { desk: "briefing" }], ["post", "/api/admin/office/drafts/1", { action: "approve" }],
  ["post", "/api/admin/office/chat", { messages: [{ role: "user", text: "hi" }] }], ["post", "/api/admin/office/memory", { text: "x" }], ["del", "/api/admin/office/memory/1"]];

test("Mi Oficina is the owner's only: everyone else (and nobody logged in) gets Not found", async () => {
  const S = await startApp({ DEMO_SEED: "0", WEATHER: "0", ADMIN_EMAILS: "boss@office.test" });
  try {
    const boss = client(S.base), o = client(S.base), anon = client(S.base);
    await boss.signup("boss@office.test", "Boss"); await o.signup("o@office.test", "Owner");
    S.db.run("INSERT INTO office_memory (desk, text, created_at) VALUES ('owner', 'secret plan', 1)");
    for (const who of [o, anon]) for (const [m, u, b] of ROUTES) assert.equal((await who[m](u, b)).status, 404, `${m} ${u}`);
    assert.equal(S.db.get("SELECT COUNT(*) c FROM office_memory").c, 1, "nothing changed");
    const v = (await boss.get("/api/admin/office")).json;
    assert.equal(v.mode, "test");
    assert.deepEqual(v.desks.map((d) => d.id), ["briefing", "recruiting", "social", "quality", "support"]);
    assert.ok(v.desks.every((d) => d.about && !("job" in d)), "the owner sees a plain description");
    assert.equal((await boss.post("/api/admin/office/run", { desk: "nope" })).status, 400);
    assert.equal((await boss.post("/api/admin/office/chat", { messages: [{ role: "assistant", text: "hi" }] })).status, 400);
    assert.equal((await boss.post("/api/admin/office/chat", { messages: [{ role: "user", text: "x".repeat(2001) }] })).status, 400);
    assert.equal((await boss.post("/api/admin/office/memory", { text: "" })).status, 400);
    assert.equal((await boss.post("/api/admin/office/drafts/abc", { action: "approve" })).status, 400);
    assert.equal((await boss.post("/api/admin/office/drafts/99", { action: "approve" })).status, 404);
  } finally { await S.close(); }
});

test("Mi Oficina live: Claude with fallbacks, the desk's lookups, nothing private sent, drafts wait for the owner", async () => {
  const F = await fakeClaude();
  const S = await startApp({ DEMO_SEED: "0", WEATHER: "0", ADMIN_EMAILS: "boss@office.test", ANTHROPIC_API_KEY: "sk-ant-test", ANTHROPIC_BASE_URL: F.url });
  try {
    const boss = client(S.base), o = client(S.base), fam = client(S.base);
    await boss.signup("boss@office.test", "Boss");
    await o.signup("owner@office.test", "Dueño", { phone: "312-555-0111" });
    await fam.signup("rosa@office.test", "Rosa Martínez", { phone: "312-555-0142" });
    const gid = await makeGroup(o, { name: "Mariachi Oficina Live", dates: [inDays(20), inDays(21)] });
    const b = (await fam.post("/api/bookings", bookingBody(gid, inDays(20), { message: "Gate code 4471, call me at 773-555-0199", address: "1234 W 18th St" }))).json.booking;
    await fam.post(`/api/bookings/${b.id}/simulate-pay`); await o.patch(`/api/bookings/${b.id}`, { action: "accept" });
    S.db.run("INSERT INTO reviews (booking_id, group_id, customer_id, rating, text, created_at) VALUES (?, ?, ?, 5, 'La mejor serenata', ?)", b.id, gid, S.db.get("SELECT id FROM users WHERE email = 'rosa@office.test'").id, Math.floor(Date.now() / 1000));

    F.script.push(
      { stop_reason: "tool_use", content: [{ type: "tool_use", id: "t1", name: "memory_read", input: {} }, { type: "tool_use", id: "t2", name: "business_summary", input: {} }, { type: "tool_use", id: "t3", name: "recent_bookings", input: { days: 30 } }] },
      { stop_reason: "tool_use", content: [{ type: "tool_use", id: "t4", name: "vendor_health", input: {} }, { type: "tool_use", id: "t5", name: "support_queue", input: { days: 30 } }, { type: "tool_use", id: "t6", name: "content_ideas", input: {} }] },
      { stop_reason: "tool_use", content: [
        { type: "tool_use", id: "t7", name: "save_draft", input: { kind: "vendor_email", target: gid, subject: "¡Felicidades!", body: "Hola, ¡felicidades por su reseña!\n— Bella's Fiestas", lang: "es" } },
        { type: "tool_use", id: "t8", name: "save_draft", input: { kind: "customer_email", target: b.id, subject: "Gracias", body: "Gracias por reservar.", lang: "es" } },
        { type: "tool_use", id: "t9", name: "save_draft", input: { kind: "vendor_email", target: "no-such-vendor", subject: "x", body: "x", lang: "es" } },
        { type: "tool_use", id: "t10", name: "save_draft", input: { kind: "vendor_email", target: gid, subject: "¡Felicidades!", body: "Hola, ¡felicidades por su reseña!\n— Bella's Fiestas", lang: "es" } },
        { type: "tool_use", id: "t11", name: "memory_write", input: { note: "Asked Mariachi Oficina Live to share their 5-star review." } }] },
      { stop_reason: "end_turn", content: [{ type: "text", text: "**Good day.** 1 confirmed booking.\n- Approve the email to Mariachi Oficina Live." }] }
    );
    const run = await boss.post("/api/admin/office/run", { desk: "briefing" });
    assert.equal(run.status, 200);
    assert.ok(run.json.desks.find((d) => d.id === "briefing").working, "the screen sees the desk working");
    assert.ok(await until(async () => !(await boss.get("/api/admin/office")).json.desks.find((d) => d.id === "briefing").working));
    const v = (await boss.get("/api/admin/office")).json;
    assert.match(v.desks[0].report.text, /Good day/);
    assert.equal(F.calls.length, 4);

    const first = F.calls[0];
    assert.equal(first.body.model, "claude-opus-5-5");
    assert.equal(first.body.fallbacks, "default");
    assert.equal(first.body.output_config.effort, "medium");
    assert.match(String(first.headers["anthropic-beta"]), /server-side-fallback-2026-07-01/);
    assert.deepEqual(first.body.system[0].cache_control, { type: "ephemeral" });
    assert.match(first.body.system[1].text, /Morning briefing/);
    assert.ok(first.body.tools.every((t) => t.strict === true && t.input_schema.additionalProperties === false), "strict tools");
    assert.deepEqual(F.calls[3].body.tools, first.body.tools, "same tools every round (cache-friendly)");

    // what reached the AI: the real numbers, but nobody's contact details or private notes
    const sent = JSON.stringify(F.calls.map((c) => c.body.messages));
    for (const secret of ["312-555-0111", "312-555-0142", "773-555-0199", "4471", "1234 W 18th", "rosa@office.test", "owner@office.test", "Martínez"]) assert.ok(!sent.includes(secret), `leaked ${secret}`);
    assert.ok(sent.includes("Mariachi Oficina Live") && sent.includes("Rosa") && sent.includes("La mejor serenata"), "it saw the vendor, the first name and the review");
    const results = F.calls[3].body.messages.at(-1).content;
    assert.ok(results.find((r) => r.tool_use_id === "t9").is_error, "a draft for a vendor that doesn't exist is refused");
    assert.match(results.find((r) => r.tool_use_id === "t10").content, /already waiting/, "the same draft isn't saved twice");

    // the drafts wait; nothing was sent yet
    assert.deepEqual(v.drafts.map((d) => d.kind).sort(), ["customer_email", "vendor_email"]);
    assert.equal(S.db.get("SELECT COUNT(*) c FROM email_log WHERE kind = 'office.message'").c, 0, "nothing goes out on its own");
    assert.equal(v.desks[0].waiting, 2);
    assert.ok(v.memory.some((m) => m.desk === "briefing" && /5-star/.test(m.text)), "the desk left a note for tomorrow");
    assert.ok(S.db.get("SELECT micro_usd FROM office_usage").micro_usd > 0, "the cost is counted");
    assert.ok(v.usage.today_usd > 0);

    // the owner edits and approves: the family gets exactly that
    const toFam = v.drafts.find((d) => d.kind === "customer_email");
    assert.match(toFam.target_label, /Rosa/);
    const ok = await boss.post(`/api/admin/office/drafts/${toFam.id}`, { action: "approve", subject: "¡Gracias, Rosa!", body: "Gracias por reservar con nosotros.\nNos vemos en la fiesta." });
    assert.equal(ok.json.status, "sent");
    const mail = S.db.get("SELECT * FROM email_log WHERE kind = 'office.message'");
    assert.equal(mail.to_email, "rosa@office.test"); assert.equal(mail.subject, "¡Gracias, Rosa!"); assert.match(mail.body, /Nos vemos en la fiesta/);
    assert.equal((await boss.post(`/api/admin/office/drafts/${toFam.id}`, { action: "approve" })).status, 409, "only once");
    const toVendor = v.drafts.find((d) => d.kind === "vendor_email");
    assert.equal((await boss.post(`/api/admin/office/drafts/${toVendor.id}`, { action: "reject" })).json.status, "rejected");
    assert.equal(S.db.get("SELECT COUNT(*) c FROM email_log WHERE kind = 'office.message'").c, 1);
    assert.match(S.db.get("SELECT action FROM admin_log ORDER BY id DESC").action, /office customer_email sent/);

    // the chat: effort low, the conversation sent along
    F.script.push({ stop_reason: "tool_use", content: [{ type: "tool_use", id: "c1", name: "save_draft", input: { kind: "social_post", target: "tiktok", subject: "Serenata", body: "¡La mejor serenata! #chicago", lang: "es" } }] },
      { stop_reason: "end_turn", content: [{ type: "text", text: "You made 1 booking this week." }] });
    const c = await boss.post("/api/admin/office/chat", { messages: [{ role: "user", text: "How was the week?" }, { role: "assistant", text: "Good." }, { role: "user", text: "And bookings?" }] });
    assert.equal(c.json.reply, "You made 1 booking this week.");
    const chatCall = F.calls.at(-2).body;
    assert.equal(chatCall.output_config.effort, "low"); assert.equal(chatCall.messages.length, 3); assert.match(chatCall.messages[2].content, /And bookings\?/);
    assert.equal(S.db.get("SELECT desk FROM office_drafts WHERE kind = 'social_post'").desk, "social", "a draft made in the chat shows in the Social media room");

    // a refusal is said plainly
    F.script.push({ stop_reason: "refusal", content: [] });
    await boss.post("/api/admin/office/run", { desk: "support" });
    assert.ok(await until(async () => /declined/.test(S.db.get("SELECT text FROM office_reports WHERE desk = 'support'")?.text || "")));
  } finally { await S.close(); await F.close(); }
});

test("Mi Oficina's daily cap stops the AI; the morning run works once, in the morning, and emails the owner", async () => {
  const F = await fakeClaude();
  const S = await startApp({ DEMO_SEED: "0", WEATHER: "0", ADMIN_EMAILS: "boss@office.test", ANTHROPIC_API_KEY: "sk-ant-test", ANTHROPIC_BASE_URL: F.url, OFFICE_DAILY_LIMIT_USD: "1" });
  try {
    const boss = client(S.base); await boss.signup("boss@office.test", "Boss");
    assert.equal(await S.ctx.office.morning({ hour: 13 }), false, "not in the afternoon");
    F.script.push(...Array.from({ length: 5 }, (_, i) => ({ stop_reason: "end_turn", content: [{ type: "text", text: `**Report ${i + 1}:** all good. See [the office](#/office).` }] })));
    assert.equal(await S.ctx.office.morning({ hour: 8 }), true);
    assert.equal(F.calls.length, 5, "every desk worked once");
    assert.equal(S.db.get("SELECT COUNT(DISTINCT desk) c FROM office_reports").c, 5);
    const mail = S.db.get("SELECT * FROM email_log WHERE kind = 'office.briefing'");
    assert.equal(mail.to_email, "boss@office.test"); assert.match(mail.subject, /morning briefing/); assert.match(mail.body, /Report 5: all good. See the office\./, "the briefing (last) is in the email, as plain words");
    assert.ok(!mail.body.includes("**") && !mail.body.includes("](#"), "no formatting marks in the email");
    assert.match(mail.body, /#\/office/);
    assert.equal(await S.ctx.office.morning({ hour: 9 }), false, "once a day");

    // over the cap: no more calls, and the report says so
    S.db.run("UPDATE office_usage SET micro_usd = 1000000");
    await boss.post("/api/admin/office/run", { desk: "social" });
    assert.ok(await until(async () => /spending limit/.test(S.db.get("SELECT text FROM office_reports WHERE desk = 'social' ORDER BY id DESC").text)));
    assert.match((await boss.post("/api/admin/office/chat", { messages: [{ role: "user", text: "hi" }] })).json.reply, /spending limit/);
    assert.equal(F.calls.length, 5, "the AI wasn't called past the cap");
  } finally { await S.close(); await F.close(); }
});

test("Mi Oficina test mode (no key): simple reports from real numbers and Spanish template drafts, free", async () => {
  const S = await startApp({ DEMO_SEED: "0", WEATHER: "0", ADMIN_EMAILS: "boss@office.test" });
  try {
    const boss = client(S.base), o = client(S.base);
    await boss.signup("boss@office.test", "Boss"); await o.signup("o@office.test", "Owner");
    const gid = await makeGroup(o, { name: "Mariachi Sin Historia", dates: [inDays(20)] });
    S.db.run("UPDATE groups SET story = '' WHERE id = ?", gid);
    await client(S.base).get("/api/search?zip=60608&category=venues");
    for (const d of ["briefing", "recruiting", "quality", "social", "support"]) await boss.post("/api/admin/office/run", { desk: d });
    assert.ok(await until(async () => S.db.get("SELECT COUNT(*) c FROM office_reports").c === 5));
    const r = Object.fromEntries(S.db.all("SELECT desk, text FROM office_reports").map((x) => [x.desk, x.text]));
    assert.match(r.briefing, /Real vendors: 1/);
    assert.match(r.recruiting, /venues near Chicago/);
    assert.match(r.quality, /Mariachi Sin Historia: story too short/);
    const d = S.db.get("SELECT * FROM office_drafts WHERE kind = 'vendor_email'");
    assert.match(d.body, /cuente su historia/); assert.ok(!/story too short/.test(d.body), "the vendor's email is all in Spanish");
    assert.equal(S.db.get("SELECT COUNT(*) c FROM office_drafts WHERE kind = 'social_post'").c, 1);
    assert.equal(S.db.get("SELECT COUNT(*) c FROM office_usage").c, 0, "free");
    // the office's own words and the vendor emails it sends exist in both languages
    const approve = await boss.post(`/api/admin/office/drafts/${d.id}`, { action: "approve" });
    assert.equal(approve.json.status, "sent");
    assert.match(S.db.get("SELECT body FROM email_log WHERE kind = 'office.message'").body, /Abrir Bella's Fiestas|Open Bella's Fiestas/);
  } finally { await S.close(); }
});
