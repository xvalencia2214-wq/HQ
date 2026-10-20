// Lessons from the competitors (docs/competitors.md, Oct 2026): know where families find nobody, and carry the music
// families ask for. (The vendor share kit is checked in the browser, e2e/e2e20.mjs.)
import test from "node:test";
import assert from "node:assert/strict";
import { startApp, client, inDays, makeGroup } from "./helpers.js";

test("searches and quote requests that find nobody show on the Admin page, by what and where", async () => {
  const S = await startApp({ DEMO_SEED: "0", WEATHER: "0", ADMIN_EMAILS: "boss@growth.test" });
  try {
    const boss = client(S.base), o = client(S.base), fam = client(S.base);
    await boss.signup("boss@growth.test", "Boss"); await o.signup("o@growth.test", "Owner"); await fam.signup("f@growth.test", "Familia");
    await makeGroup(o, { name: "Mariachi Growth", dates: [inDays(30)] });
    const anon = client(S.base);
    assert.ok((await anon.get("/api/search?zip=60608")).json.results.length > 0, "a search that finds someone");
    assert.equal((await anon.get("/api/search?zip=60608&category=venues")).json.results.length, 0);
    await anon.get("/api/search?zip=60608&category=venues");
    assert.equal((await anon.get("/api/search?zip=60608&category=venues&page=2")).status < 500, true, "a second page of nothing isn't counted twice");
    assert.equal((await anon.get("/api/search?zip=60608&type=Tamborazo")).json.results.length, 0);
    const q = await fam.post("/api/requests", { category: "photo", event: "Wedding", date: inDays(30), time: "6:00 PM", hours: 3, zip: "60632", guests: 100 });
    assert.equal(q.json.sent, 0);
    const s = (await boss.get("/api/admin/summary")).json.empty_searches;
    assert.equal(s.total, 4);
    assert.ok(s.of >= 4);
    const row = (what, zip) => s.top.find((r) => r.what === what && r.zip === zip);
    assert.equal(row("venues", "60608").n, 2);
    assert.equal(row("Tamborazo", "60608").n, 1);
    assert.equal(row("quotes:photo", "60632").n, 1);
    assert.ok(row("venues", "60608").city, "with the city name");
    assert.ok(!s.top.some((r) => r.what === "any"), "a search that found someone is not counted");
  } finally { await S.close(); }
});

test("the music families ask for is there: Sierreño, Tierra Caliente, Cumbia / Sonido, Tamborazo", async () => {
  const S = await startApp({ DEMO_SEED: "0", WEATHER: "0" });
  try {
    const meta = (await client(S.base).get("/api/meta")).json;
    for (const t of ["Sierreño", "Tierra Caliente", "Cumbia / Sonido", "Tamborazo"]) assert.ok(meta.categories.music.includes(t), t);
    const o = client(S.base); await o.signup("s@growth.test", "Sierreño Owner");
    const gid = await makeGroup(o, { name: "Los Sierreños de Pilsen", dates: [inDays(20)], extra: { type: "Sierreño" } });
    const found = (await client(S.base).get("/api/search?zip=60608&type=Sierre%C3%B1o")).json.results;
    assert.deepEqual(found.map((g) => g.id), [gid]);
    assert.equal(found[0].category, "music");
    assert.equal(found[0].type, "Sierreño");
    const words = (await import("node:fs")).readFileSync(new URL("../public/js/i18n.js", import.meta.url), "utf8");
    for (const t of ["Sierreño", "Tierra Caliente", "Cumbia / Sonido", "Tamborazo"]) assert.equal(words.split(`"type.${t}": `).length - 1, 2, `an English and a Spanish label for ${t}`);
  } finally { await S.close(); }
});
