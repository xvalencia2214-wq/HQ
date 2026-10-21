// Lessons from the competitors (docs/competitors.md, Oct 2026): know where families find nobody, and carry the music
// families ask for. (The vendor share kit is checked in the browser, e2e/e2e20.mjs.)
import test from "node:test";
import assert from "node:assert/strict";
import { startApp, client, inDays, makeGroup, bookingBody } from "./helpers.js";

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

test("the vendor's calendar: a time closes the moment someone starts paying, a full day says Booked, a declined booking opens it again", async () => {
  const S = await startApp({ DEMO_SEED: "0", WEATHER: "0" });
  try {
    const o = client(S.base), a = client(S.base), b = client(S.base), anon = client(S.base);
    await o.signup("o@cal.test", "Owner"); await a.signup("a@cal.test", "Ana"); await b.signup("b@cal.test", "Beto");
    const one = inDays(20), three = inDays(21);
    const gid = await makeGroup(o, { name: "Mariachi Calendario", dates: [three] });
    await o.put(`/api/groups/${gid}/availability`, { dates: { [one]: ["2:00 PM"] } });
    const month = (d) => anon.get(`/api/groups/${gid}/availability?month=${d.slice(0, 7)}`).then((r) => r.json);
    const cal = async (d) => { const m = await month(d); return { open: m.days[d] || [], booked: m.booked.includes(d) }; };
    assert.deepEqual(await cal(one), { open: ["2:00 PM"], booked: false });

    // Ana starts booking (not paid yet): the only time is held for her right away
    const req = await a.post("/api/bookings", bookingBody(gid, one));
    assert.equal(req.status, 200);
    assert.deepEqual(await cal(one), { open: [], booked: true }, "closed and shown as Booked before she even pays");
    const second = await b.post("/api/bookings", bookingBody(gid, one));
    assert.equal(second.status, 409, "nobody can take the same time");
    await a.post(`/api/bookings/${req.json.booking.id}/simulate-pay`);
    assert.deepEqual(await cal(one), { open: [], booked: true });
    // the group says no: the day opens again for everyone
    assert.equal((await o.patch(`/api/bookings/${req.json.booking.id}`, { action: "decline" })).status, 200);
    assert.deepEqual(await cal(one), { open: ["2:00 PM"], booked: false });

    // a day with more times stays open with the rest; only the booked time goes
    const before = (await cal(three)).open;
    await b.post("/api/bookings", bookingBody(gid, three));
    const after = await cal(three);
    assert.ok(!after.open.includes("2:00 PM") && after.open.length > 0 && after.open.length < before.length && !after.booked, JSON.stringify({ before, after }));
    // a day the group never opened is not "Booked"
    assert.equal((await cal(inDays(22))).booked, false);
  } finally { await S.close(); }
});

test("the vendor page says how far the group is from the family and what travel adds; cards say it too", async () => {
  const { lookupZip, miles } = await import("../server/geo.js");
  const S = await startApp({ DEMO_SEED: "0", WEATHER: "0" });
  try {
    const o = client(S.base), anon = client(S.base); await o.signup("o@far.test", "Owner");
    const gid = await makeGroup(o, { name: "Banda Lejos", zip: "60608", dates: [inDays(20)], extra: { travel_miles: 10, travel_fee: 60 } });
    const dist = (z) => Math.round(miles(lookupZip(z), lookupZip("60608")));
    const near = (await anon.get(`/api/groups/${gid}?zip=60608`)).json.from;
    assert.deepEqual(near, { zip: "60608", city: lookupZip("60608").city, miles: 0, reaches: true, travel_extra_cents: 0 });
    const mid = (await anon.get(`/api/groups/${gid}?zip=60540`)).json.from; // Naperville: past the free 10 miles, inside the reach
    assert.equal(mid.miles, dist("60540")); assert.ok(mid.miles > 10 && mid.miles <= 40, String(mid.miles));
    assert.equal(mid.reaches, true); assert.equal(mid.travel_extra_cents, 6000);
    const far = (await anon.get(`/api/groups/${gid}?zip=61801`)).json.from; // Champaign: too far
    assert.equal(far.reaches, false); assert.ok(far.miles > 100);
    assert.equal((await anon.get(`/api/groups/${gid}`)).json.from, null, "no ZIP, no distance");
    assert.equal((await anon.get(`/api/groups/${gid}?zip=abc`)).json.from, null, "a bad ZIP is ignored");
    const card = (await anon.get("/api/search?zip=60540")).json.results.find((g) => g.id === gid);
    assert.equal(card.distance_miles, dist("60540")); assert.equal(card.travel_extra_cents, 6000);
  } finally { await S.close(); }
});

test("the Terms and Privacy pages open with or without .html (people type the short form)", async () => {
  const S = await startApp({ DEMO_SEED: "0", WEATHER: "0" });
  try {
    for (const [from, to] of [["/terms", "/terms.html"], ["/privacy", "/privacy.html"], ["/Terms/", "/terms.html"], ["/terminos", "/terms.html"], ["/privacidad", "/privacy.html"]]) {
      const r = await fetch(S.base + from, { redirect: "manual" });
      assert.equal(r.status, 301, from); assert.equal(r.headers.get("location"), to, from);
    }
    for (const p of ["/terms.html", "/privacy.html"]) { const r = await fetch(S.base + p); assert.equal(r.status, 200, p); assert.match(await r.text(), /version 2026-10-20/); }
    const followed = await fetch(S.base + "/terms"); assert.equal(followed.status, 200); assert.match(await followed.text(), /Terms of Service/);
  } finally { await S.close(); }
});

test("/términos with the accent opens the Terms too", async () => {
  const S = await startApp({ DEMO_SEED: "0", WEATHER: "0" });
  try {
    for (const p of ["/t%C3%A9rminos", "/T%C3%A9RMINOS/"]) { const r = await fetch(S.base + p, { redirect: "manual" }); assert.equal(r.status, 301, p); assert.equal(r.headers.get("location"), "/terms.html"); }
    assert.equal((await fetch(S.base + "/%E0%A4%A")).status < 500, true, "a broken address doesn't crash");
  } finally { await S.close(); }
});
