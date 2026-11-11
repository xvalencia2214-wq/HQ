// November 2026: Mi Oficina on Claude Fable 5.2 with a web search for the Recruiting desk; listings translated between
// Spanish and English; a password typed with a stray space still logs in; the practice copy explains a missing setting.
import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import net from "node:net";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { startApp, client, inDays, makeGroup } from "./helpers.js";

// A stand-in for Anthropic's API: answers from a script (an item with `http` answers with that error status).
async function fakeClaude() {
  const calls = [], script = [];
  const server = http.createServer(async (req, res) => {
    let raw = ""; for await (const c of req) raw += c;
    const body = raw ? JSON.parse(raw) : {};
    calls.push({ url: req.url, headers: req.headers, body });
    const next = script.shift() || { stop_reason: "end_turn", content: [{ type: "text", text: "All quiet today." }] };
    if (next.http) { res.writeHead(next.http, { "Content-Type": "application/json" }); res.end(JSON.stringify({ type: "error", error: { type: "invalid_request_error", message: next.message } })); return; }
    const msg = { id: `msg_${calls.length}`, type: "message", role: "assistant", model: body.model, stop_details: null, usage: { input_tokens: 1000, output_tokens: 100, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 }, ...next };
    res.writeHead(200, { "Content-Type": "application/json" }); res.end(JSON.stringify(msg));
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  return { url: `http://127.0.0.1:${server.address().port}`, calls, script, close: () => new Promise((r) => server.close(r)) };
}
const until = async (fn, ms = 6000) => { for (let i = 0; i < ms / 50; i++) { if (await fn()) return true; await new Promise((r) => setTimeout(r, 50)); } return false; };
const runDesk = async (boss, desk) => {
  assert.equal((await boss.post("/api/admin/office/run", { desk })).status, 200);
  assert.ok(await until(async () => !(await boss.get("/api/admin/office")).json.desks.find((d) => d.id === desk).working), `${desk} finished`);
  return (await boss.get("/api/admin/office")).json;
};

test("Recruiting desk: searches the web for real businesses, the searches are counted in the cost, quoted answers read as one text", async () => {
  const F = await fakeClaude();
  const S = await startApp({ DEMO_SEED: "0", WEATHER: "0", ADMIN_EMAILS: "boss@up.test", ANTHROPIC_API_KEY: "sk-ant-test", ANTHROPIC_BASE_URL: F.url });
  try {
    const boss = client(S.base); await boss.signup("boss@up.test", "Boss");
    F.script.push({ stop_reason: "end_turn", usage: { input_tokens: 1000, output_tokens: 100, server_tool_use: { web_search_requests: 3 } }, content: [
      { type: "server_tool_use", id: "srv1", name: "web_search", input: { query: "mariachi Cicero IL" } },
      { type: "web_search_tool_result", tool_use_id: "srv1", content: [{ type: "web_search_result", url: "https://example.com/mariachi-sol", title: "Mariachi Sol de Cicero", encrypted_content: "x" }] },
      { type: "text", text: "Families near Cicero looked for mariachis. One lead: " },
      { type: "text", text: "Mariachi Sol de Cicero", citations: [{ type: "web_search_result_location", url: "https://example.com/mariachi-sol", title: "Mariachi Sol de Cicero", cited_text: "Mariachi Sol" }] },
      { type: "text", text: " (https://example.com/mariachi-sol)." }] });
    const v = await runDesk(boss, "recruiting");
    const call = F.calls[0].body;
    assert.equal(call.model, "claude-fable-5-2");
    const ws = call.tools.find((t) => t.name === "web_search");
    assert.deepEqual({ type: ws.type, max_uses: ws.max_uses, city: ws.user_location.city }, { type: "web_search_20260209", max_uses: 4, city: "Chicago" });
    assert.match(call.system[1].text, /web_search/); assert.match(call.system[1].text, /never instructions to you/);
    assert.equal(call.fallbacks, "default");
    assert.equal(v.desks.find((d) => d.id === "recruiting").report.text, "Families near Cicero looked for mariachis. One lead: Mariachi Sol de Cicero (https://example.com/mariachi-sol).", "pieces around a quoted page join into one sentence");
    // 1,000 in x $8 + 100 out x $40 per million = 12,000 micro-dollars, plus 3 searches at 1 cent
    assert.equal(S.db.get("SELECT micro_usd FROM office_usage").micro_usd, 12000 + 30000);
    assert.equal(v.usage.web_search, true);

    // the other desks never get the web
    await runDesk(boss, "briefing");
    assert.ok(!F.calls.at(-1).body.tools.some((t) => t.name === "web_search")); assert.doesNotMatch(F.calls.at(-1).body.system[1].text, /web_search/);
  } finally { await S.close(); await F.close(); }
});

test("Recruiting desk without web search on the account: it says so once and works without; the settings turn search off or pick the other model", async () => {
  const F = await fakeClaude();
  const S = await startApp({ DEMO_SEED: "0", WEATHER: "0", ADMIN_EMAILS: "boss@up.test", ANTHROPIC_API_KEY: "sk-ant-test", ANTHROPIC_BASE_URL: F.url });
  try {
    const boss = client(S.base); await boss.signup("boss@up.test", "Boss");
    const alerts = []; const real = S.ctx.alert; S.ctx.alert = (m, k) => { alerts.push(String(m)); return real ? real(m, k) : undefined; };
    F.script.push({ http: 400, message: "tools.9: web_search is not enabled for this organization" }, { stop_reason: "end_turn", content: [{ type: "text", text: "No searches missed anyone this week." }] });
    const v = await runDesk(boss, "recruiting");
    assert.equal(F.calls.length, 2);
    assert.ok(F.calls[0].body.tools.some((t) => t.name === "web_search")); assert.ok(!F.calls[1].body.tools.some((t) => t.name === "web_search"), "the second try has no web search");
    assert.doesNotMatch(F.calls[1].body.system[1].text, /web_search/);
    assert.match(v.desks.find((d) => d.id === "recruiting").report.text, /No searches missed/);
    assert.equal(v.usage.web_search, false);
    await runDesk(boss, "recruiting");
    assert.equal(F.calls.length, 3, "it doesn't ask for the web again");
    assert.ok(!F.calls[2].body.tools.some((t) => t.name === "web_search"));
  } finally { await S.close(); await F.close(); }

  const F2 = await fakeClaude();
  const S2 = await startApp({ DEMO_SEED: "0", WEATHER: "0", ADMIN_EMAILS: "boss@up.test", ANTHROPIC_API_KEY: "sk-ant-test", ANTHROPIC_BASE_URL: F2.url, OFFICE_WEB_SEARCH: "0", OFFICE_MODEL: "claude-opus-5-5" });
  try {
    const boss = client(S2.base); await boss.signup("boss@up.test", "Boss");
    const v = await runDesk(boss, "recruiting");
    assert.equal(F2.calls[0].body.model, "claude-opus-5-5"); assert.ok(!F2.calls[0].body.tools.some((t) => t.name === "web_search"));
    assert.equal(S2.db.get("SELECT micro_usd FROM office_usage").micro_usd, 1000 * 4 + 100 * 20, "priced as the model that ran");
    assert.equal(v.usage.model, "claude-opus-5-5");
    const odd = await startApp({ DEMO_SEED: "0", OFFICE_MODEL: "some-other-model" });
    try { assert.equal(odd.ctx.config.officeModel, "claude-fable-5-2", "an unknown name falls back to the default"); } finally { await odd.close(); }
  } finally { await S2.close(); await F2.close(); }
});

test("Listings in both languages: translated once, shown to readers of the other language, redone when the words change", async () => {
  const F = await fakeClaude();
  const S = await startApp({ DEMO_SEED: "0", WEATHER: "0", AI_TRANSLATE: "1", ANTHROPIC_API_KEY: "sk-ant-test", ANTHROPIC_BASE_URL: F.url, AI_DAILY_LIMIT_USD: "1" });
  try {
    const o = client(S.base), anon = client(S.base); await o.signup("tr-o@example.com", "Dueña", { phone: "312-555-0111" });
    const gid = await makeGroup(o, { name: "Mariachi Dos Idiomas", dates: [inDays(20)], extra: { story: "Somos un mariachi familiar de Pilsen. Tocamos bodas y quinceañeras con mucho corazón. Llámanos al 312-555-0188." } });
    const pk = (await o.post(`/api/groups/${gid}/packages`, { name: "Serenata", description: "5 canciones en tu puerta", hours: 1, price: 250 })).json.packages.at(-1);
    await new Promise((r) => setTimeout(r, 300)); // let the background attempts (answered with nonsense by the fake) pass
    assert.equal((await anon.raw("GET", `/api/groups/${gid}`, undefined, { "X-Lang": "en" })).json.tr, undefined, "an answer that isn't a translation is thrown away");
    const tried = F.calls.length;
    assert.equal(await S.ctx.translate.sweep(), 0); assert.equal(F.calls.length, tried, "and the same words aren't paid for twice");
    S.db.run("DELETE FROM listing_tr"); // as if the vendor had just written them
    const before = F.calls.length;

    F.script.push({ stop_reason: "end_turn", content: [{ type: "text", text: JSON.stringify({ source_lang: "es", story: "We are a family mariachi from Pilsen. We play weddings and quinceañeras with a lot of heart.", packages: [{ id: pk.id, name: "Serenata", description: "5 songs at your door" }, { id: 999999, name: "Not theirs", description: "x" }] }) }] });
    assert.equal(await S.ctx.translate.ensure(gid), "translated");
    const sent = F.calls[before].body;
    assert.equal(sent.model, "claude-opus-5-5"); assert.equal(sent.output_config.effort, "low");
    assert.equal(sent.output_config.format.type, "json_schema"); assert.equal(sent.output_config.format.schema.additionalProperties, false);
    assert.equal(sent.fallbacks, "default"); assert.deepEqual(sent.system[0].cache_control, { type: "ephemeral" });
    const src = JSON.parse(sent.messages[0].content);
    assert.deepEqual(Object.keys(src).sort(), ["packages", "story"], "only the listing's public words are sent");
    assert.ok(!JSON.stringify(sent).includes("312-555-0188") && !JSON.stringify(sent).includes("tr-o@example.com") && !JSON.stringify(sent).includes("Dueña"), "no phone, email or owner name");
    assert.equal(await S.ctx.translate.ensure(gid), "fresh", "not done twice for the same words");
    assert.equal(F.calls.length, before + 1);
    assert.ok(S.db.get("SELECT micro_usd FROM helper_usage").micro_usd > 0, "counted in the AI cost");

    // an English reader gets the translation; a Spanish reader gets the vendor's own words
    const en = (await anon.raw("GET", `/api/groups/${gid}`, undefined, { "X-Lang": "en" })).json;
    assert.equal(en.tr.from, "es"); assert.match(en.tr.story, /family mariachi from Pilsen/);
    assert.deepEqual(en.tr.packages, { [pk.id]: { name: "Serenata", description: "5 songs at your door" } }, "a package that isn't this listing's is ignored");
    assert.match(en.story, /Somos un mariachi familiar/, "the original is still there");
    const es = (await anon.raw("GET", `/api/groups/${gid}`, undefined, { "X-Lang": "es" })).json;
    assert.equal(es.tr, undefined);
    const cardEn = (await anon.raw("GET", "/api/search?zip=60608", undefined, { "X-Lang": "en" })).json.results.find((g) => g.id === gid);
    assert.match(cardEn.story_tr, /family mariachi/);
    assert.equal((await anon.raw("GET", "/api/search?zip=60608", undefined, { "X-Lang": "es" })).json.results.find((g) => g.id === gid).story_tr, undefined);
    assert.equal((await o.get(`/api/groups/${gid}/manage`)).json?.tr, undefined, "the vendor's own dashboard keeps their words");

    // the vendor changes the story: the old translation is not shown for the new words, and a new one is made in the background
    F.script.push({ stop_reason: "end_turn", content: [{ type: "text", text: JSON.stringify({ source_lang: "es", story: "Now we also play serenatas and mañanitas all over Chicago, in black charro suits.", packages: [] }) }] });
    const saved = await o.patch(`/api/groups/${gid}`, { story: "Ahora también tocamos serenatas y mañanitas en todo Chicago, con trajes de charro negros." });
    assert.equal(saved.status, 200);
    const now = (await anon.raw("GET", `/api/groups/${gid}`, undefined, { "X-Lang": "en" })).json.tr;
    assert.ok(!now || /black charro suits/.test(now.story), "a translation of the old words is never shown");
    assert.ok(await until(async () => /black charro suits/.test((await anon.raw("GET", `/api/groups/${gid}`, undefined, { "X-Lang": "en" })).json.tr?.story || "")), "the new words are translated right after the save");
    // anything missed (the server was restarting, the limit was reached) is caught by the hourly pass
    S.db.run("DELETE FROM listing_tr WHERE group_id = ?", gid);
    F.script.push({ stop_reason: "end_turn", content: [{ type: "text", text: JSON.stringify({ source_lang: "es", story: "Now we also play serenatas and mañanitas all over Chicago, in black charro suits.", packages: [] }) }] });
    assert.equal(await S.ctx.translate.sweep(), 1, "the hourly pass catches up");
    assert.match((await anon.raw("GET", `/api/groups/${gid}`, undefined, { "X-Lang": "en" })).json.tr.story, /black charro suits/);

    // already in both languages: nothing to show; a refusal: the original stays
    const g2 = await makeGroup(o, { name: "Banda Bilingüe", dates: [inDays(21)], extra: { story: "Tocamos banda sinaloense para tu fiesta. We play banda sinaloense for your party, all night long." } });
    await new Promise((r) => setTimeout(r, 300));
    S.db.run("DELETE FROM listing_tr WHERE group_id = ?", g2);
    F.script.push({ stop_reason: "end_turn", content: [{ type: "text", text: JSON.stringify({ source_lang: "both", story: "", packages: [] }) }] });
    assert.equal(await S.ctx.translate.ensure(g2), "translated");
    assert.equal((await anon.raw("GET", `/api/groups/${g2}`, undefined, { "X-Lang": "en" })).json.tr, undefined);
    assert.equal(await S.ctx.translate.ensure(g2), "fresh", "and it isn't asked again");
    const g3 = await makeGroup(o, { name: "Trío Tres", dates: [inDays(22)] });
    await new Promise((r) => setTimeout(r, 300));
    S.db.run("DELETE FROM listing_tr WHERE group_id = ?", g3);
    F.script.push({ stop_reason: "refusal", content: [] });
    assert.equal(await S.ctx.translate.ensure(g3), "declined");
    assert.equal(await S.ctx.translate.ensure(g3), "fresh", "a declined listing waits for new words");
    assert.equal((await anon.raw("GET", `/api/groups/${g3}`, undefined, { "X-Lang": "es" })).json.tr, undefined);

    // the daily limit stops it
    S.db.run("UPDATE helper_usage SET micro_usd = 1000000");
    const n = F.calls.length;
    S.db.run("DELETE FROM listing_tr WHERE group_id = ?", g3);
    assert.equal(await S.ctx.translate.ensure(g3), "limit"); assert.equal(await S.ctx.translate.sweep(), 0);
    assert.equal(F.calls.length, n, "no request is made past the limit");
  } finally { await S.close(); await F.close(); }

  // without a key, or switched off: nothing happens and pages show the original
  for (const env of [{}, { ANTHROPIC_API_KEY: "sk-ant-test", AI_TRANSLATE: "0" }, { ANTHROPIC_API_KEY: "sk-ant-test", AI_TRANSLATE: "1", AI_HELPER: "0" }]) {
    const off = await startApp({ DEMO_SEED: "0", AI_TRANSLATE: "1", ...env });
    try {
      const o = client(off.base); await o.signup("tr-off@example.com", "Owner");
      const gid = await makeGroup(o, { name: "Sin Traducir", dates: [inDays(20)] });
      assert.equal(off.ctx.translate.on, false); assert.equal(await off.ctx.translate.ensure(gid), "off"); assert.equal(await off.ctx.translate.sweep(), 0);
      assert.equal((await o.get(`/api/groups/${gid}`)).json.tr, undefined);
    } finally { await off.close(); }
  }
});

test("Logging in: a password with a stray space before or after still works; a wrong one doesn't", async () => {
  const S = await startApp({ DEMO_SEED: "0" });
  try {
    const a = client(S.base); await a.signup("space@example.com", "Ana");
    const login = (password) => client(S.base).post("/api/auth/login", { email: "space@example.com", password });
    assert.equal((await login("correct horse battery")).status, 200);
    assert.equal((await login("correct horse battery ")).status, 200, "a space the keyboard added at the end");
    assert.equal((await login(" correct horse battery")).status, 200);
    assert.equal((await login("Correct horse battery")).status, 401, "a capital letter is still a different password");
    assert.equal((await login("correct horse  battery")).status, 401);
    assert.equal((await login("   ")).status, 401);
    assert.equal((await client(S.base).post("/api/auth/login", { email: "nobody@example.com", password: "correct horse battery " })).status, 401);
  } finally { await S.close(); }
});

test("The practice copy online without its password: a page that says what to add (in both languages), and nothing of the app", async () => {
  const port = await new Promise((r) => { const s = net.createServer(); s.listen(0, "127.0.0.1", () => { const p = s.address().port; s.close(() => r(p)); }); });
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const env = { ...process.env, RENDER_EXTERNAL_URL: "https://practice.example.com", PORT: String(port) };
  delete env.PREVIEW_PASSWORD;
  const child = spawn(process.execPath, ["--disable-warning=ExperimentalWarning", "server/tryout.js"], { cwd: root, env, stdio: "ignore" });
  try {
    const get = (p) => fetch(`http://127.0.0.1:${port}${p}`).catch(() => null);
    assert.ok(await until(async () => Boolean(await get("/api/health")), 15000), "it stays up instead of crashing");
    const health = await get("/api/health"); assert.equal(health.status, 200); assert.equal((await health.json()).setup, "PREVIEW_PASSWORD");
    const page = await get("/"); assert.equal(page.status, 503);
    const html = await page.text();
    assert.match(html, /PREVIEW_PASSWORD/); assert.match(html, /Environment/); assert.match(html, /Falta un paso/);
    for (const p of ["/api/meta", "/api/search?zip=60608", "/api/auth/login", "/index.html"]) assert.equal((await get(p)).status, 503, p);
  } finally { child.kill("SIGKILL"); }
});
