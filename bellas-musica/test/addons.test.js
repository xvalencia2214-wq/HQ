import test from "node:test";
import assert from "node:assert/strict";
import { startApp, client, inDays, makeGroup, bookingBody } from "./helpers.js";

test("minimum hours: a group's minimum applies to hourly bookings and quote requests, packages stay as listed, and the server enforces it", async () => {
  const S = await startApp();
  try {
    const owner = client(S.base), cust = client(S.base), other = client(S.base), anon = client(S.base);
    await owner.signup("mh-o@example.com", "Min Owner"); await cust.signup("mh-c@example.com", "Min Cliente"); await other.signup("mh-x@example.com", "Otro Dueño");
    const gid = await makeGroup(owner, { name: "Two Hour Band", rate: 300, dates: [inDays(30), inDays(31), inDays(32)], extra: { min_hours: 2 } });
    const pub = (await anon.get(`/api/groups/${gid}`)).json;
    assert.equal(pub.min_hours, 2); // shown to everyone

    // a default group still allows one hour
    const g1 = await makeGroup(other, { name: "Any Hours Band", dates: [inDays(30)] });
    assert.equal((await anon.get(`/api/groups/${g1}`)).json.min_hours, 1);
    assert.equal((await cust.post("/api/quote", bookingBody(g1, inDays(30), { hours: 1 }))).status, 200);

    // under the minimum is refused with a clear message, at the minimum or above it is priced
    const under = await cust.post("/api/quote", bookingBody(gid, inDays(30), { hours: 1 }));
    assert.equal(under.status, 400); assert.match(under.json.error, /minimum of 2 hours/);
    assert.equal((await cust.post("/api/bookings", bookingBody(gid, inDays(30), { hours: 1 }))).status, 400);
    const two = await cust.post("/api/quote", bookingBody(gid, inDays(30), { hours: 2 }));
    assert.equal(two.json.quote.subtotal_cents, 60000);
    assert.equal((await cust.post("/api/quote", bookingBody(gid, inDays(30), { hours: 3 }))).json.quote.subtotal_cents, 90000);

    // a one-hour package is priced as listed even when the group's hourly minimum is 2
    const pk = await owner.post(`/api/groups/${gid}/packages`, { name: "Serenata", description: "3 songs", hours: 1, price: 180 });
    assert.equal(pk.status, 200);
    const pid = pk.json.packages[0].id;
    const viaPkg = await cust.post("/api/quote", bookingBody(gid, inDays(30), { packageId: pid, hours: 1 }));
    assert.equal(viaPkg.status, 200); assert.equal(viaPkg.json.quote.subtotal_cents, 18000);

    // quote requests (chat) respect it too
    assert.equal((await cust.post(`/api/groups/${gid}/quote-request`, { event: "Wedding", guests: 50, hours: 1, date: inDays(30) })).status, 400);
    assert.equal((await cust.post(`/api/groups/${gid}/quote-request`, { event: "Wedding", guests: 50, hours: 2, date: inDays(30) })).status, 200);

    // setting the minimum: owner only, 1 to 8
    assert.equal((await other.patch(`/api/groups/${gid}`, { min_hours: 3 })).status, 403);
    for (const bad of [0, 9, 2.5, "x", null]) assert.equal((await owner.patch(`/api/groups/${gid}`, { min_hours: bad })).status, 400, String(bad));
    assert.equal((await owner.patch(`/api/groups/${gid}`, { min_hours: 4 })).json.min_hours, 4);
    assert.equal((await cust.post("/api/quote", bookingBody(gid, inDays(30), { hours: 3 }))).status, 400);
  } finally { await S.close(); }
});

test("add-ons: a group lists them, the customer ticks them, the server prices and stores them, and nobody can tamper with the price", async () => {
  const S = await startApp();
  try {
    const dj = client(S.base), other = client(S.base), cust = client(S.base), anon = client(S.base);
    await dj.signup("ad-dj@example.com", "DJ Owner"); await other.signup("ad-o@example.com", "Otro Dueño"); await cust.signup("ad-c@example.com", "Ana Cliente");
    const gid = await makeGroup(dj, { name: "DJ Luces", rate: 200, dates: [inDays(40), inDays(41), inDays(42)], extra: { type: "DJ" } });
    const gid2 = await makeGroup(other, { name: "Other Band", dates: [inDays(40)] });

    // meta carries the DJ presets (fog machine, lights, visuals, audio and video, special lighting)
    const meta = (await anon.get("/api/meta")).json;
    const names = meta.addon_presets.DJ.map((p) => p.en).join("|");
    for (const w of ["Fog machine", "Dance floor lights", "Special lighting", "Visuals", "Audio and video setup"]) assert.ok(names.includes(w), w);
    assert.ok(meta.addon_presets.DJ.every((p) => p.es && p.es !== p.en));

    // owner-only creation with validation
    const add = (c, id, body) => c.post(`/api/groups/${id}/addons`, body);
    assert.equal((await add(other, gid, { name: "Fog machine", price: 50 })).status, 403);
    assert.equal((await add(anon, gid, { name: "Fog machine", price: 50 })).status, 401);
    for (const bad of [{ name: "x", price: 10 }, { name: "Fog machine", price: -5 }, { name: "Fog machine", price: 99999 }, { name: "Fog machine", price: "abc" }, {}]) assert.equal((await add(dj, gid, bad)).status, 400, JSON.stringify(bad));
    const r1 = await add(dj, gid, { name: "Fog machine", description: "Low-lying fog for the first dance", price: 75 });
    assert.equal(r1.status, 200);
    await add(dj, gid, { name: "Special lighting (uplights, spotlights)", price: 150 });
    await add(dj, gid, { name: "Audio and video setup", price: 0 }); // included
    assert.equal((await add(dj, gid, { name: "fog MACHINE", price: 10 })).status, 400); // duplicate name
    const list = (await anon.get(`/api/groups/${gid}`)).json.addons;
    assert.deepEqual(list.map((a) => [a.name, a.price_cents]), [["Fog machine", 7500], ["Special lighting (uplights, spotlights)", 15000], ["Audio and video setup", 0]]);
    const [fog, lights, av] = list;

    // the quote adds exactly what was ticked
    const quote = (ids, extra = {}) => cust.post("/api/quote", bookingBody(gid, inDays(40), { hours: 3, addonIds: ids, ...extra }));
    const none = (await quote([])).json.quote;
    assert.equal(none.total_cents, 60000); assert.equal(none.addons_cents, 0);
    const two = (await quote([fog.id, lights.id])).json.quote;
    assert.equal(two.addons_cents, 22500); assert.equal(two.total_cents, 82500); assert.equal(two.deposit_cents, Math.ceil(82500 * 0.25));
    assert.deepEqual(two.addons.map((a) => a.name), ["Fog machine", "Special lighting (uplights, spotlights)"]);
    assert.equal((await quote([fog.id, fog.id, av.id])).json.quote.addons_cents, 7500); // repeats count once, included ones are free
    assert.equal((await quote(undefined)).status, 200);

    // bad input: another group's add-on, unknown ids, junk, too many
    const foreign = (await add(other, gid2, { name: "Sound system", price: 40 })).json.addons[0];
    assert.equal((await quote([foreign.id])).status, 400);
    assert.equal((await quote([999999])).status, 400);
    assert.equal((await quote(["x"])).status, 400);
    assert.equal((await quote("fog")).status, 400);
    assert.equal((await quote(Array.from({ length: 30 }, (_, i) => i + 1))).status, 400);

    // booking stores a copy: later price changes and deletion don't change an existing booking
    const bk = await cust.post("/api/bookings", bookingBody(gid, inDays(40), { hours: 3, addonIds: [fog.id, lights.id] }));
    assert.equal(bk.status, 200);
    assert.equal(bk.json.booking.total_cents, 82500); assert.equal(bk.json.booking.addons_cents, 22500);
    assert.deepEqual(bk.json.booking.addons.map((a) => a.name), ["Fog machine", "Special lighting (uplights, spotlights)"]);
    const bid = bk.json.booking.id;
    assert.equal((await dj.patch(`/api/addons/${fog.id}`, { price: 500 })).status, 200);
    assert.equal((await dj.del(`/api/addons/${lights.id}`)).status, 200);
    assert.equal((await other.patch(`/api/addons/${fog.id}`, { price: 1 })).status, 403);
    assert.equal((await other.del(`/api/addons/${fog.id}`)).status, 403);
    assert.equal((await dj.del(`/api/addons/${lights.id}`)).status, 404);
    const mine = (await cust.get("/api/my/bookings")).json.bookings.find((b) => b.id === bid);
    assert.equal(mine.total_cents, 82500); assert.deepEqual(mine.addons.map((a) => a.price_cents), [7500, 15000]);

    // pay it: the deposit is on the full total including add-ons, and the group sees what was ordered
    assert.equal((await cust.post(`/api/bookings/${bid}/simulate-pay`)).status, 200);
    const row = S.db.get("SELECT total_cents, deposit_cents, addons_cents FROM bookings WHERE id = ?", bid);
    assert.equal(row.total_cents, 82500); assert.equal(row.deposit_cents, Math.ceil(82500 * 0.25)); assert.equal(row.addons_cents, 22500);
    const forGroup = (await dj.get(`/api/groups/${gid}/bookings`)).json.bookings.find((b) => b.id === bid);
    assert.deepEqual(forGroup.addons.map((a) => a.name), ["Fog machine", "Special lighting (uplights, spotlights)"]);
    const ics = await cust.raw("GET", `/api/bookings/${bid}/ics`);
    assert.equal(ics.status, 200);

    // limit of 12 add-ons
    for (let i = 0; i < 12; i++) await add(dj, gid, { name: `Extra number ${i}`, price: 5 });
    assert.equal((await add(dj, gid, { name: "One too many", price: 5 })).status, 400);

    // deleting the account's group data: add-ons go with the group (no orphans)
    const before = S.db.get("SELECT COUNT(*) c FROM addons WHERE group_id = ?", gid2).c;
    assert.equal(before, 1);
  } finally { await S.close(); }
});
