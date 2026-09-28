import test from "node:test";
import assert from "node:assert/strict";
import { startApp, client, inDays, makeGroup, bookingBody } from "./helpers.js";

test("custom offers: private to one customer, priced by the server, expire, and never leak into public listings", async () => {
  const S = await startApp();
  try {
    const owner = client(S.base), a = client(S.base), b = client(S.base), anon = client(S.base);
    await owner.signup("of-o@example.com", "Offer Owner"); await a.signup("of-a@example.com", "Ana Cliente"); await b.signup("of-b@example.com", "Beto Cliente");
    const d = inDays(30);
    const gid = await makeGroup(owner, { name: "Offer Band", dates: [d, inDays(31)] });
    const cid = S.db.get("SELECT id FROM users WHERE email = 'of-a@example.com'").id;
    const manage = async () => { const r = await owner.get("/api/my/groups"); return { json: r.json.groups.find((g) => g.id === gid) }; };
    const publicBefore = (await anon.get(`/api/groups/${gid}`)).json.packages.length;

    // quote request from a customer: validated, becomes a chat message the group can answer
    const qr = (c, body) => c.post(`/api/groups/${gid}/quote-request`, body);
    assert.equal((await qr(a, { event: "Nope", guests: 50, hours: 2, date: d })).status, 400);
    assert.equal((await qr(a, { event: "Wedding", guests: 0, hours: 2, date: d })).status, 400);
    assert.equal((await qr(a, { event: "Wedding", guests: 50, hours: 2, date: "2020-01-01" })).status, 400);
    assert.equal((await qr(owner, { event: "Wedding", guests: 50, hours: 2, date: d })).status, 400); // your own group
    assert.equal((await qr(anon, { event: "Wedding", guests: 50, hours: 2, date: d })).status, 401);
    const ok = await qr(a, { event: "Wedding", guests: 120, hours: 3, date: d, note: "Outdoor patio" });
    assert.equal(ok.status, 200); assert.match(ok.json.messages.at(-1).text, /Quote request: Wedding on .*120 guests, 3 hr\. Outdoor patio/);

    // only people who have written can get an offer; validation
    const offer = (body, c = owner) => c.post(`/api/groups/${gid}/offers`, body);
    assert.equal((await offer({ customerId: cid, name: "Wedding special", hours: 3, price: 900 }, a)).status, 403); // not the owner
    const bid = S.db.get("SELECT id FROM users WHERE email = 'of-b@example.com'").id;
    assert.equal((await offer({ customerId: bid, name: "Wedding special", hours: 3, price: 900 })).status, 400); // Beto never wrote
    assert.equal((await offer({ customerId: cid, name: "x", hours: 3, price: 900 })).status, 400);
    assert.equal((await offer({ customerId: cid, name: "Wedding special", hours: 3, price: 0 })).status, 400);
    const made = await offer({ customerId: cid, name: "Wedding special", hours: 3, price: 900, note: "Includes sound" });
    assert.equal(made.status, 200);
    assert.match(S.db.get("SELECT subject FROM email_log WHERE kind = 'offer.customer'").subject, /custom offer/);
    assert.match((await a.get(`/api/groups/${gid}/messages`)).json.messages.at(-1).text, /Custom offer: Wedding special, 3 hr for \$900/);

    // not in public listings, search prices, share pages or the owner's normal package list
    assert.equal((await anon.get(`/api/groups/${gid}`)).json.packages.length, publicBefore);
    assert.equal((await manage()).json.packages.some((p) => p.name === "Wedding special"), false);
    assert.equal((await owner.patch(`/api/packages/${made.json.offer_id}`, { price: 1 })).status, 404);
    assert.equal((await owner.del(`/api/packages/${made.json.offer_id}`)).status, 404);
    const mine = (await manage()).json.open_offers; assert.equal(mine.length, 1); assert.equal(mine[0].customer, "Ana");

    // visible only to Ana
    assert.deepEqual((await a.get(`/api/groups/${gid}/offers`)).json.offers.map((o) => o.name), ["Wedding special"]);
    assert.deepEqual((await b.get(`/api/groups/${gid}/offers`)).json.offers, []);
    // Beto cannot book it, even knowing the id; nor can a guest
    const pid = made.json.offer_id;
    assert.equal((await b.post("/api/bookings", bookingBody(gid, d, { packageId: pid }))).status, 400);
    // Ana can, at the server's price (the client cannot change it)
    const q = await a.post("/api/bookings", bookingBody(gid, d, { packageId: pid, totalCents: 1 }));
    assert.equal(q.status, 200); assert.equal(q.json.booking.total_cents, 90000);
    // while it is booked it is not offered again, and the owner can't pull it out from under the customer
    assert.deepEqual((await a.get(`/api/groups/${gid}/offers`)).json.offers, []);
    assert.equal((await owner.del(`/api/groups/${gid}/offers/${pid}`)).status, 400);
    // an unpaid hold that expires frees the offer again
    S.db.run("UPDATE bookings SET status = 'expired' WHERE id = ?", q.json.booking.id);
    assert.equal((await a.get(`/api/groups/${gid}/offers`)).json.offers.length, 1);

    // expiry
    S.db.run("UPDATE packages SET expires_at = ? WHERE id = ?", Math.floor(Date.now() / 1000) - 5, pid);
    assert.deepEqual((await a.get(`/api/groups/${gid}/offers`)).json.offers, []);
    const late = await a.post("/api/bookings", bookingBody(gid, inDays(31), { packageId: pid }));
    assert.equal(late.status, 400); assert.match(late.json.error, /expired/);
    assert.equal((await manage()).json.open_offers.length, 0);

    // withdraw + cap of 3 open offers per customer
    const o1 = await offer({ customerId: cid, name: "One", hours: 2, price: 500 });
    assert.equal((await owner.del(`/api/groups/${gid}/offers/${o1.json.offer_id}`)).status, 200);
    assert.equal((await owner.del(`/api/groups/${gid}/offers/${o1.json.offer_id}`)).status, 404);
    for (let i = 0; i < 3; i++) assert.equal((await offer({ customerId: cid, name: `Opt ${i}`, hours: 2, price: 500 + i })).status, 200);
    assert.equal((await offer({ customerId: cid, name: "Too many", hours: 2, price: 700 })).status, 400);
  } finally { await S.close(); }
});
