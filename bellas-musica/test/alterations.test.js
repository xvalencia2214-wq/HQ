import test from "node:test";
import assert from "node:assert/strict";
import { startApp, client, inDays, bookingBody } from "./helpers.js";

const TINY_PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(64, 1)]).toString("base64");

// Alterations (dress and suit fittings for quinceañeras, weddings, chambelanes) is its own kind of vendor.
test("alterations: its own category, a listing is found and booked, quotes, price guide and its own Google pages", async () => {
  const S = await startApp({ DEMO_SEED: "0" });
  try {
    const anon = client(S.base), vo = client(S.base), cust = client(S.base);
    await vo.signup("alt-v@example.com", "Rosa Costurera"); await cust.signup("alt-c@example.com", "Ana Cliente");
    const d = inDays(30);

    // the category and its three kinds, booked by package (not by the hour), with its own checklist for families
    const meta = (await anon.get("/api/meta")).json;
    assert.deepEqual(meta.categories.alterations, ["Dress alterations", "Suit and tux alterations", "Custom dresses and outfits"]);
    for (const t of meta.categories.alterations) assert.ok(meta.group_types.includes(t), t);
    assert.equal(meta.hourly_by_default.alterations, false);

    // a seamstress lists her business
    const c = await vo.post("/api/groups", { name: "Costura Rosa", type: "Dress alterations", zip: "60608", members: 1, story: "Quinceañera and wedding dresses fitted just right, two fittings, ready a week early." });
    assert.equal(c.status, 200, JSON.stringify(c.json));
    assert.equal(c.json.category, "alterations"); assert.equal(c.json.hourly, false);
    const id = c.json.id;
    await vo.patch(`/api/groups/${id}`, { events: ["Quinceañera", "Wedding"] });
    await vo.put(`/api/groups/${id}/availability`, { dates: { [d]: ["12:00 PM", "2:00 PM"] } });
    await vo.post(`/api/groups/${id}/photos`, { data: TINY_PNG });
    const noPkg = await vo.post(`/api/groups/${id}/publish`);
    assert.equal(noPkg.status, 400, "like other package vendors, she needs a price first");
    assert.equal((await vo.post(`/api/groups/${id}/packages`, { name: "Quinceañera dress", description: "Hem, take in and bustle, 2 fittings", hours: 1, price: 140 })).status, 200);
    assert.equal((await vo.post(`/api/groups/${id}/publish`)).status, 200);
    // the other two kinds work too
    for (const type of ["Suit and tux alterations", "Custom dresses and outfits"]) {
      const g = await vo.post("/api/groups", { name: `Test ${type}`, type, zip: "60608", members: 1, story: "x" });
      assert.equal(g.status, 200); assert.equal(g.json.category, "alterations");
    }

    // search: found under its own category, never mixed into music
    const found = (await anon.get(`/api/search?zip=60608&category=alterations&date=${d}`)).json.results;
    assert.deepEqual(found.map((g) => g.name), ["Costura Rosa"]);
    assert.ok(!(await anon.get("/api/search?zip=60608")).json.results.some((g) => g.name === "Costura Rosa"), "not in the music search");
    assert.ok((await anon.get("/api/search?zip=60608&category=all")).json.results.some((g) => g.name === "Costura Rosa"), "in Everything");

    // a family books her package for the date
    const pkg = (await anon.get(`/api/groups/${id}`)).json.packages[0];
    const b = await cust.post("/api/bookings", bookingBody(id, d, { time: "12:00 PM", event: "Quinceañera", guests: 1, packageId: pkg.id, message: "Dress for my daughter's quince" }));
    assert.equal(b.status, 200, JSON.stringify(b.json));

    // Get quotes and the price guide accept the new category
    const q = await cust.post("/api/requests", { category: "alterations", event: "Quinceañera", date: inDays(40), guests: 1, hours: 1, zip: "60608" });
    assert.equal(q.status, 200, JSON.stringify(q.json));
    assert.equal((await anon.get("/api/price-guide?category=alterations")).status, 200);
    assert.equal((await anon.get("/api/search?zip=60608&category=sewing")).status, 400, "an unknown category is still refused");

    // its own pages for Google, in English and Spanish, listed in the sitemap once someone is there
    const en = await fetch(S.base + "/chicago/pilsen/alterations"), es = await fetch(S.base + "/es/chicago/pilsen/arreglos");
    const enHtml = await en.text(), esHtml = await es.text();
    assert.equal(en.status, 200); assert.equal(es.status, 200);
    assert.match(enHtml, /Dress and suit alterations in Pilsen/); assert.match(enHtml, /Costura Rosa/); assert.doesNotMatch(enHtml, /noindex/);
    assert.match(esHtml, /Arreglos de vestidos y trajes en Pilsen/); assert.match(esHtml, /lang="es"/);
    const map = await (await fetch(S.base + "/sitemap.xml")).text();
    assert.match(map, /\/chicago\/pilsen\/alterations</); assert.match(map, /\/es\/chicago\/pilsen\/arreglos</);
  } finally { await S.close(); }
});

test("alterations: the sample listing shows up on a fresh install", async () => {
  const S = await startApp({});
  try {
    const r = (await client(S.base).get("/api/search?zip=60608&category=alterations")).json.results;
    assert.ok(r.some((g) => g.name === "Aguja de Oro Arreglos" && g.demo), JSON.stringify(r.map((g) => g.name)));
  } finally { await S.close(); }
});
