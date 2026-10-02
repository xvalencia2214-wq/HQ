import test from "node:test";
import assert from "node:assert/strict";
import { startApp, client, inDays, makeGroup, bookingBody } from "./helpers.js";

const TINY_PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(64, 1)]).toString("base64");

// A package-only vendor (tents, food...) set up the way a real one would be.
async function makeVendor(owner, { name, type, zip = "60608", dates = [], pkg = ["20x20 tent", 1, 350], extra = {} }) {
  const c = await owner.post("/api/groups", { name, type, zip, members: 3, story: "We deliver and set up everything for your backyard party, rain or shine." });
  assert.equal(c.status, 200, JSON.stringify(c.json));
  const id = c.json.id;
  await owner.patch(`/api/groups/${id}`, { events: ["Wedding", "Quinceañera", "Birthday"], ...extra });
  await owner.put(`/api/groups/${id}/availability`, { dates: Object.fromEntries(dates.map((d) => [d, ["12:00 PM", "2:00 PM", "4:00 PM"]])) });
  await owner.post(`/api/groups/${id}/photos`, { data: TINY_PNG });
  if (pkg) await owner.post(`/api/groups/${id}/packages`, { name: pkg[0], description: "Delivery and setup", hours: pkg[1], price: pkg[2] });
  const p = await owner.post(`/api/groups/${id}/publish`);
  return { id, publish: p };
}

test("party vendors: categories, package-only listings, search and feed filters, and music-only places stay music", async () => {
  const S = await startApp({ DEMO_SEED: "0" });
  try {
    const mo = client(S.base), vo = client(S.base), cust = client(S.base), anon = client(S.base);
    await mo.signup("v-m@example.com", "Music Owner"); await vo.signup("v-v@example.com", "Vendor Owner"); await cust.signup("v-c@example.com", "Ana Cliente");
    const d = inDays(30);

    // meta: every type belongs to exactly one category, music types unchanged
    const meta = (await anon.get("/api/meta")).json;
    assert.deepEqual(Object.keys(meta.categories), ["music", "food", "rentals", "decor", "photo", "services", "venues"]);
    assert.deepEqual(meta.categories.music, ["Mariachi", "Banda", "Norteño", "Trío romántico", "Grupera", "Conjunto", "DJ", "Other"]);
    assert.equal(new Set(meta.group_types).size, meta.group_types.length);
    for (const w of ["Tents", "Tables and chairs", "Food truck", "Taquería / taco catering", "Catering", "Security / bouncer", "Balloon decorations", "Event decorator", "Photographer", "Party hall"]) assert.ok(meta.group_types.includes(w), w);
    assert.equal(meta.hourly_by_default.rentals, false); assert.equal(meta.hourly_by_default.music, true);

    // a music group still needs a price per hour; a tent company doesn't
    assert.equal((await mo.post("/api/groups", { name: "No Rate Mariachi", type: "Mariachi", zip: "60608", members: 5 })).status, 400);
    const mus = await makeGroup(mo, { name: "Mariachi Uno", dates: [d] });
    const tentDraft = await vo.post("/api/groups", { name: "Carpas Test", type: "Tents", zip: "60608", members: 2, story: "x" });
    assert.equal(tentDraft.status, 200); assert.equal(tentDraft.json.hourly, false); assert.equal(tentDraft.json.category, "rentals");
    // publishing a package-only listing needs a package
    const noPkg = await makeVendor(vo, { name: "Sillas Sin Paquete", type: "Tables and chairs", dates: [d], pkg: null });
    assert.equal(noPkg.publish.status, 400); assert.ok(noPkg.publish.json.missing.includes("packages"));
    const tent = await makeVendor(vo, { name: "Carpas El Sol", type: "Tents", dates: [d] });
    assert.equal(tent.publish.status, 200);
    const food = await makeVendor(vo, { name: "Tacos Test Truck", type: "Food truck", dates: [d], pkg: ["Tacos for 50", 2, 600] });
    // an hourly vendor (security): booked by the hour like music, with a minimum
    const sec = (await vo.post("/api/groups", { name: "Guardia Segura", type: "Security / bouncer", zip: "60608", members: 4, rate: 55, story: "Licensed, uniformed, bilingual security for parties and halls." })).json;
    assert.equal(sec.hourly, true); assert.equal(sec.category, "services");
    await vo.patch(`/api/groups/${sec.id}`, { events: ["Wedding", "Quinceañera"], min_hours: 4 });
    await vo.put(`/api/groups/${sec.id}/availability`, { dates: { [d]: ["2:00 PM"] } }); await vo.post(`/api/groups/${sec.id}/photos`, { data: TINY_PNG });
    assert.equal((await vo.post(`/api/groups/${sec.id}/publish`)).status, 200);

    // switching to hourly needs a price; switching back works
    assert.equal((await vo.patch(`/api/groups/${tent.id}`, { hourly: true })).status, 400);
    assert.equal((await vo.patch(`/api/groups/${tent.id}`, { hourly: "yes" })).status, 400);
    const sw = await vo.patch(`/api/groups/${tent.id}`, { hourly: true, rate: 80 });
    assert.equal(sw.status, 200); assert.equal(sw.json.hourly, true);
    assert.equal((await vo.patch(`/api/groups/${tent.id}`, { hourly: false })).json.hourly, false);

    // search: music by default (nothing changes for people looking for music), a category or "all" on request
    const names = async (qs) => (await anon.get("/api/search?zip=60608" + qs)).json.results.map((g) => g.name).sort();
    assert.deepEqual(await names(""), ["Mariachi Uno"]);
    assert.deepEqual(await names("&category=rentals"), ["Carpas El Sol"]);
    assert.deepEqual(await names("&category=food"), ["Tacos Test Truck"]);
    assert.deepEqual(await names("&category=services"), ["Guardia Segura"]);
    assert.deepEqual(await names("&category=all"), ["Carpas El Sol", "Guardia Segura", "Mariachi Uno", "Tacos Test Truck"]);
    assert.deepEqual(await names("&type=Tents"), ["Carpas El Sol"]); // a type implies its category
    assert.deepEqual(await names(`&category=rentals&date=${d}`), ["Carpas El Sol"]);
    assert.deepEqual(await names(`&category=rentals&date=${inDays(31)}`), []);
    assert.equal((await anon.get("/api/search?zip=60608&category=spaceships")).status, 400);
    const card = (await anon.get("/api/search?zip=60608&category=rentals")).json.results[0];
    assert.equal(card.category, "rentals"); assert.equal(card.hourly, false); assert.equal(card.from_cents, 35000);
    assert.deepEqual(await names("&category=rentals&max=300"), []); // from-price is the cheapest package
    assert.deepEqual(await names("&category=rentals&max=400"), ["Carpas El Sol"]);

    // feed: everyone by default (so people discover vendors too), or one category
    const feed = async (qs = "") => (await anon.get("/api/feed?zip=60608" + qs)).json.items.map((g) => g.name).sort();
    assert.deepEqual(await feed(), ["Carpas El Sol", "Guardia Segura", "Mariachi Uno", "Tacos Test Truck"]);
    assert.deepEqual(await feed("&category=food"), ["Tacos Test Truck"]);
    assert.equal((await anon.get("/api/feed?zip=60608&category=nope")).status, 400);
    assert.ok((await anon.get("/api/feed?zip=60608&category=rentals")).json.items.every((i) => i.category === "rentals"));

    // booking a package-only vendor: a package is required; add-ons work the same
    const hourlyTry = await cust.post("/api/quote", bookingBody(tent.id, d, { hours: 3 }));
    assert.equal(hourlyTry.status, 400); assert.match(hourlyTry.json.error, /booked by package/);
    const pkgId = (await anon.get(`/api/groups/${tent.id}`)).json.packages[0].id;
    const walls = (await vo.post(`/api/groups/${tent.id}/addons`, { name: "Side walls", price: 80 })).json.addons[0];
    const q = await cust.post("/api/quote", bookingBody(tent.id, d, { packageId: pkgId, addonIds: [walls.id] }));
    assert.equal(q.status, 200); assert.equal(q.json.quote.total_cents, 43000);
    const bk = await cust.post("/api/bookings", bookingBody(tent.id, d, { packageId: pkgId, addonIds: [walls.id] }));
    assert.equal(bk.status, 200); assert.equal(bk.json.booking.category, "rentals"); assert.equal(bk.json.booking.group_type, "Tents");
    // hourly vendor respects its minimum
    assert.equal((await cust.post("/api/quote", bookingBody(sec.id, d, { hours: 2 }))).status, 400);
    assert.equal((await cust.post("/api/quote", bookingBody(sec.id, d, { hours: 4 }))).json.quote.subtotal_cents, 22000);
    // the same customer can book music and a tent for the same day (one party, several vendors)
    assert.equal((await cust.post("/api/bookings", bookingBody(mus, d))).status, 200);
    const mine = (await cust.get("/api/my/bookings")).json.bookings.filter((b) => b.date === d).map((b) => b.category).sort();
    assert.deepEqual(mine, ["music", "rentals"]);

    // Get quotes is about music: vendors never receive those requests
    const rq = await cust.post("/api/requests", { event: "Wedding", date: d, guests: 80, hours: 3, zip: "60608" });
    assert.equal(rq.status, 200);
    const asked = S.db.all("SELECT g.type FROM event_request_groups x JOIN groups g ON g.id = x.group_id").map((r) => r.type);
    assert.ok(asked.length >= 1 && asked.every((ty) => ty === "Mariachi"), JSON.stringify(asked));

    // best-of pages and the neighborhood landing pages stay about music
    assert.ok((await anon.get("/api/best?zip=60608")).json.groups.every((g) => g.category === "music"));
    const land = await fetch(S.base + "/chicago/pilsen").then((r) => r.text());
    assert.ok(!land.includes("Carpas El Sol") && !land.includes("Tacos Test Truck"));
  } finally { await S.close(); }
});
