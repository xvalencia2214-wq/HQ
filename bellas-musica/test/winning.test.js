// The features that answer the big booking sites (docs/competitors.md): the founding-vendor fee, signing the agreement
// in the app, reviews from past clients, the guest list with RSVPs, the ID-checked badge, payouts held until check-in,
// and the Spanish search pages.
import test from "node:test";
import assert from "node:assert/strict";
import { startApp, client, inDays, makeGroup, bookingBody } from "./helpers.js";

test("founding vendors: the first listings to go live lock in a lower fee, and the offer runs out", async () => {
  const S = await startApp({ DEMO_SEED: "0", PLATFORM_FEE_PCT: "10", FOUNDING_SLOTS: "2", FOUNDING_FEE_PCT: "5", FOUNDING_DAYS: "180" });
  try {
    const anon = client(S.base);
    assert.deepEqual((await anon.get("/api/meta")).json.founding, { left: 2, slots: 2, fee_pct: 5, days: 180 });
    const owners = [];
    for (const n of [1, 2, 3]) { const c = client(S.base); await c.signup(`fd${n}@example.com`, `Founder ${n}`); owners.push(c); }
    // a draft doesn't take a spot
    const draft = await makeGroup(owners[0], { name: "Draft Band", draft: true });
    assert.equal((await anon.get("/api/meta")).json.founding.left, 2);
    const g1 = await makeGroup(owners[0], { name: "First Band", dates: [inDays(30)] });
    const g2 = await makeGroup(owners[1], { name: "Second Band", dates: [inDays(30)] });
    const g3 = await makeGroup(owners[2], { name: "Third Band", dates: [inDays(30)] });
    const view = async (c, id) => (await c.get("/api/my/groups")).json.groups.find((g) => g.id === id);
    const v1 = await view(owners[0], g1), v2 = await view(owners[1], g2), v3 = await view(owners[2], g3);
    assert.deepEqual([v1.founding_no, v1.fee_pct, v2.founding_no, v2.fee_pct, v3.founding_no, v3.fee_pct], [1, 5, 2, 5, 0, 10]);
    const days = (v1.founding_until - Math.floor(Date.now() / 1000)) / 86400;
    assert.ok(days > 179.9 && days <= 180, `about 180 days, got ${days}`);
    assert.equal((await anon.get("/api/meta")).json.founding.left, 0);
    assert.equal((await view(owners[0], draft)).founding_no, 0);

    // pausing and publishing again doesn't hand out a second spot, and it's the fee bookings are charged
    await owners[0].post(`/api/groups/${g1}/pause`, { paused: true });
    await owners[0].post(`/api/groups/${g1}/publish`);
    assert.equal(S.db.get("SELECT COUNT(*) c FROM groups WHERE founding_no > 0").c, 2);
    const cust = client(S.base); await cust.signup("fd-c@example.com", "Cust");
    const b1 = (await cust.post("/api/bookings", bookingBody(g1, inDays(30), { hours: 3 }))).json.booking; // $900
    const b3 = (await cust.post("/api/bookings", bookingBody(g3, inDays(30), { hours: 3 }))).json.booking;
    assert.equal(S.db.get("SELECT platform_fee_cents f FROM bookings WHERE id = ?", b1.id).f, 4500);
    assert.equal(S.db.get("SELECT platform_fee_cents f FROM bookings WHERE id = ?", b3.id).f, 9000);

    // once the period ends, the normal fee comes back
    S.db.run("UPDATE groups SET founding_until = ? WHERE id = ?", Math.floor(Date.now() / 1000) - 10, g1);
    assert.equal((await view(owners[0], g1)).fee_pct, 10);

    // the admin page counts the spots
    const adminEmail = "fd-admin@example.com";
    S.ctx.config.adminEmails.push(adminEmail);
    const admin = client(S.base); await admin.signup(adminEmail, "Owner");
    const sum = (await admin.get("/api/admin/summary")).json;
    assert.deepEqual([sum.groups.founding, sum.groups.founding_slots, sum.groups.founding_fee_pct], [2, 2, 5]);
  } finally { await S.close(); }
});

test("founding vendors: sample listings never take a spot, and 0 spots turns the offer off", async () => {
  const S = await startApp({ FOUNDING_SLOTS: "0" });
  try {
    assert.equal((await client(S.base).get("/api/meta")).json.founding, null);
    const c = client(S.base); await c.signup("fd0@example.com", "Owner");
    const g = await makeGroup(c, { name: "No Offer Band", dates: [inDays(20)] });
    assert.equal(S.db.get("SELECT founding_no FROM groups WHERE id = ?", g).founding_no, 0);
  } finally { await S.close(); }
  const T = await startApp({ FOUNDING_SLOTS: "3" }); // the sample listings are in this one
  try {
    assert.equal(T.db.get("SELECT COUNT(*) c FROM groups WHERE demo = 1 AND founding_no > 0").c, 0);
    assert.equal((await client(T.base).get("/api/meta")).json.founding.left, 3);
  } finally { await T.close(); }
});

// a confirmed, paid booking: the customer pays the deposit and the group accepts
async function confirmed(S, owner, cust, gid, date, over = {}) {
  const b = (await cust.post("/api/bookings", bookingBody(gid, date, over))).json.booking;
  await cust.post(`/api/bookings/${b.id}/simulate-pay`);
  await owner.patch(`/api/bookings/${b.id}`, { action: "accept" });
  return b;
}

test("the booking agreement is signed in the app by both sides, and a changed booking needs new signatures", async () => {
  const S = await startApp({ DEMO_SEED: "0" });
  try {
    const owner = client(S.base), cust = client(S.base), other = client(S.base);
    await owner.signup("ag-o@example.com", "Owner"); await cust.signup("ag-c@example.com", "Rosa Martínez"); await other.signup("ag-x@example.com", "Stranger");
    const gid = await makeGroup(owner, { name: "Signing Band", dates: [inDays(40), inDays(41)] });
    // not before the booking is confirmed
    const pending = (await cust.post("/api/bookings", bookingBody(gid, inDays(41)))).json.booking;
    await cust.post(`/api/bookings/${pending.id}/simulate-pay`);
    let a = (await cust.get(`/api/bookings/${pending.id}/agreement`)).json;
    assert.equal((await cust.post(`/api/bookings/${pending.id}/agreement/sign`, { name: "Rosa Martínez", agree: true, terms_hash: a.terms_hash })).status, 400);

    const b = await confirmed(S, owner, cust, gid, inDays(40));
    a = (await cust.get(`/api/bookings/${b.id}/agreement`)).json;
    assert.equal(a.side, "customer"); assert.equal(a.customer, null); assert.equal(a.group, null); assert.match(a.terms_hash, /^[0-9a-f]{64}$/);
    assert.equal(a.terms.date, inDays(40));
    // strangers can't see or sign it; logged out is 401
    assert.equal((await other.get(`/api/bookings/${b.id}/agreement`)).status, 404);
    assert.equal((await other.post(`/api/bookings/${b.id}/agreement/sign`, { name: "Stranger Danger", agree: true, terms_hash: a.terms_hash })).status, 404);
    assert.equal((await client(S.base).get(`/api/bookings/${b.id}/agreement`)).status, 401);
    // must tick the box, type a real name, and sign the version they saw
    const sign = (c, body) => c.post(`/api/bookings/${b.id}/agreement/sign`, body);
    assert.equal((await sign(cust, { name: "Rosa Martínez", terms_hash: a.terms_hash })).status, 400);
    assert.equal((await sign(cust, { name: "12345", agree: true, terms_hash: a.terms_hash })).status, 400);
    assert.equal((await sign(cust, { name: "Rosa Martínez", agree: true, terms_hash: "0".repeat(64) })).status, 409);
    const r = await sign(cust, { name: "Rosa Martínez", agree: true, terms_hash: a.terms_hash });
    assert.equal(r.status, 200); assert.equal(r.json.customer.name, "Rosa Martínez"); assert.equal(r.json.customer.current, true); assert.equal(r.json.group, null);
    const row = S.db.get("SELECT * FROM agreement_signs WHERE booking_id = ? AND side = 'customer'", b.id);
    assert.match(row.ip_hash, /^[0-9a-f]{32}$/); assert.equal(row.terms_hash, a.terms_hash);
    // the vendor's side
    const og = (await owner.get(`/api/bookings/${b.id}/agreement`)).json;
    assert.equal(og.side, "group"); assert.equal(og.customer.current, true);
    assert.equal((await owner.post(`/api/bookings/${b.id}/agreement/sign`, { name: "Juan Owner", agree: true, terms_hash: og.terms_hash })).status, 200);
    // the booking lists show it
    assert.deepEqual((await cust.get("/api/my/bookings")).json.bookings.find((x) => x.id === b.id).signed, { customer: true, group: true });
    assert.deepEqual((await owner.get(`/api/groups/${gid}/bookings`)).json.bookings.find((x) => x.id === b.id).signed, { customer: true, group: true });

    // a new date changes the terms: the old signatures stay on record but no longer count
    S.db.run("UPDATE bookings SET time = '4:00 PM' WHERE id = ?", b.id);
    const after = (await cust.get(`/api/bookings/${b.id}/agreement`)).json;
    assert.notEqual(after.terms_hash, a.terms_hash);
    assert.equal(after.customer.current, false); assert.equal(after.group.current, false);
    assert.deepEqual((await cust.get("/api/my/bookings")).json.bookings.find((x) => x.id === b.id).signed, { customer: false, group: false });
    assert.equal((await sign(cust, { name: "Rosa Martínez", agree: true, terms_hash: after.terms_hash })).json.customer.current, true);
  } finally { await S.close(); }
});

test("past-client reviews: a one-time link, labelled on the page, counted in the stars, with guards against self-reviews", async () => {
  const S = await startApp({ DEMO_SEED: "0", TRUST_PROXY: "1" });
  try {
    const owner = client(S.base), helper = client(S.base), fan = client(S.base), fan2 = client(S.base), anon = client(S.base);
    await owner.signup("pr-o@example.com", "Owner"); await fan.signup("pr-f@example.com", "Lupe Ramírez"); await fan2.signup("pr-f2@example.com", "Beto Soto");
    const gid = await makeGroup(owner, { name: "Past Band", dates: [inDays(30)] });
    const from = (ip) => ({ "X-Forwarded-For": ip });
    const as = (c, ip) => ({ post: (u, b) => c.raw("POST", u, b, from(ip)), get: (u) => c.raw("GET", u, undefined, from(ip)) });
    const month = new Date().toISOString().slice(0, 7);
    // validation: past month only, a real event, a valid email if given
    const mk = (b) => as(owner, "10.0.0.1").post(`/api/groups/${gid}/client-reviews`, { name: "Lupe", event: "Wedding", when: "2025-06", ...b });
    assert.equal((await mk({ when: "2099-01" })).status, 400);
    assert.equal((await mk({ event: "Rave" })).status, 400);
    assert.equal((await mk({ email: "nope" })).status, 400);
    assert.equal((await anon.post(`/api/groups/${gid}/client-reviews`, { name: "X", event: "Wedding", when: "2025-06" })).status, 401);
    assert.equal((await fan.post(`/api/groups/${gid}/client-reviews`, { name: "X", event: "Wedding", when: "2025-06" })).status, 403);
    const inv = await mk({ email: "lupe@example.com", when: month });
    assert.equal(inv.status, 200); assert.equal(inv.json.emailed, true);
    const token = inv.json.url.split("/#/review/")[1];
    assert.ok(S.db.get("SELECT 1 AS x FROM email_log WHERE kind = 'pastreview.invite' AND to_email = 'lupe@example.com'"));
    assert.equal(inv.json.invite.email, "l…@example.com");
    // anyone can open the link to see what it's for; writing needs an account
    const peek = (await anon.get(`/api/past-review/${token}`)).json;
    assert.deepEqual([peek.group.name, peek.event, peek.status], ["Past Band", "Wedding", "invited"]);
    assert.equal((await anon.post(`/api/past-review/${token}`, { rating: 5, text: "Wonderful music all night" })).status, 401);
    assert.equal((await anon.get("/api/past-review/" + "x".repeat(24))).status, 404);
    // the business can't review itself: not its own account, not a helper, not from its own connection
    assert.equal((await as(owner, "10.0.0.9").post(`/api/past-review/${token}`, { rating: 5, text: "We are the best band ever" })).status, 403);
    const tok = (await owner.post(`/api/groups/${gid}/team/invite`, {})).json.url.split("/team/")[1];
    await helper.signup("pr-h@example.com", "Helper"); assert.equal((await helper.post(`/api/team-invite/${tok}/accept`)).status, 200);
    assert.equal((await as(helper, "10.0.0.8").post(`/api/past-review/${token}`, { rating: 5, text: "My boss is the best band" })).status, 403);
    assert.equal((await as(fan, "10.0.0.1").post(`/api/past-review/${token}`, { rating: 5, text: "Same wifi as the vendor" })).status, 403);
    assert.equal((await as(fan, "10.0.0.2").post(`/api/past-review/${token}`, { rating: 5, text: "short" })).status, 400);
    // the client writes it
    const ok = await as(fan, "10.0.0.2").post(`/api/past-review/${token}`, { rating: 4, text: "They played our wedding and everyone danced. Call 773-555-0101!" });
    assert.equal(ok.status, 200);
    assert.equal((await as(fan, "10.0.0.2").post(`/api/past-review/${token}`, { rating: 5, text: "Writing it again, twice" })).status, 409);
    assert.ok(S.db.get("SELECT 1 AS x FROM email_log WHERE kind = 'pastreview.got' AND to_email = 'pr-o@example.com'"));
    // on the page: labelled, counted, contact details masked
    const g = (await anon.get(`/api/groups/${gid}`)).json;
    assert.equal(g.reviews, 1); assert.equal(g.rating, 4); assert.equal(g.past_reviews, 1); assert.equal(g.events_done, 0);
    const rv = g.recent_reviews[0];
    assert.equal(rv.past_client, true); assert.equal(rv.event, "Wedding"); assert.equal(rv.name, "Lupe R."); assert.doesNotMatch(rv.text, /555-0101/);
    // the business answers it in public
    assert.equal((await owner.post(`/api/client-reviews/${rv.id.slice(1)}/reply`, { text: "¡Gracias Lupe!" })).status, 200);
    assert.equal((await anon.get(`/api/groups/${gid}`)).json.recent_reviews[0].reply.text, "¡Gracias Lupe!");
    assert.equal((await fan.post(`/api/client-reviews/${rv.id.slice(1)}/reply`, { text: "not mine" })).status, 404);
    // a written review can't be deleted by the business; an unanswered link can be cancelled or refreshed
    assert.equal((await owner.del(`/api/client-reviews/${rv.id.slice(1)}`)).status, 400);
    const inv2 = (await mk({ name: "Beto" })).json;
    const fresh = (await owner.post(`/api/client-reviews/${inv2.invite.id}/link`)).json.url.split("/#/review/")[1];
    assert.equal((await anon.get(`/api/past-review/${inv2.url.split("/#/review/")[1]}`)).status, 404); // the old link stopped working
    assert.equal((await anon.get(`/api/past-review/${fresh}`)).status, 200);
    assert.equal((await owner.del(`/api/client-reviews/${inv2.invite.id}`)).status, 200);
    assert.equal((await anon.get(`/api/past-review/${fresh}`)).status, 404);
    // the same person can't review the same business twice
    const inv3 = (await mk({ name: "Lupe again" })).json.url.split("/#/review/")[1];
    assert.equal((await as(fan, "10.0.0.2").post(`/api/past-review/${inv3}`, { rating: 5, text: "A second review from me" })).status, 409);
    // the cap: at most MAX_PAST_REVIEWS written
    const { MAX_PAST_REVIEWS } = await import("../server/routes/clientreviews.js");
    S.db.run("UPDATE client_reviews SET status = 'done', rating = 5, reviewer_id = 999 WHERE status = 'invited' AND id != (SELECT id FROM client_reviews WHERE status = 'invited' LIMIT 1)");
    for (let i = S.db.get("SELECT COUNT(*) c FROM client_reviews WHERE group_id = ? AND status = 'done'", gid).c; i < MAX_PAST_REVIEWS; i++) {
      S.db.run("INSERT INTO client_reviews (id, group_id, token_hash, client_name, event_type, event_month, status, rating, created_by, reviewer_id, created_at, expires_at) VALUES (?, ?, ?, 'Filler', 'Wedding', '2025-01', 'done', 5, 0, 999, 0, 0)", "fill" + i, gid, "h" + i);
    }
    assert.equal((await mk({ name: "Too Many" })).status, 400);
    assert.equal((await as(fan2, "10.0.0.3").post(`/api/past-review/${inv3}`, { rating: 5, text: "One more past client here" })).status, 409);
    // the site owner can remove one, and it stops counting
    S.ctx.config.adminEmails.push("pr-admin@example.com");
    const admin = client(S.base); await admin.signup("pr-admin@example.com", "Site Owner");
    const list = (await admin.get("/api/admin/summary")).json.past_reviews;
    const lupe = list.find((x) => x.reviewer_email === "pr-f@example.com");
    assert.ok(lupe); assert.equal(lupe.same_connection, 0);
    const before = (await anon.get(`/api/groups/${gid}`)).json.reviews;
    assert.equal((await admin.post(`/api/admin/past-reviews/${lupe.id}/remove`)).status, 200);
    assert.equal((await anon.get(`/api/groups/${gid}`)).json.reviews, before - 1);
    assert.equal((await owner.post(`/api/admin/past-reviews/${lupe.id}/remove`)).status, 404); // admin pages look like they don't exist to everyone else
  } finally { await S.close(); }
});

test("guest list: add one or a pasted list, personal and open RSVP links, answers and totals, the court of honor", async () => {
  const S = await startApp({ DEMO_SEED: "0" });
  try {
    const host = client(S.base), other = client(S.base), guest = client(S.base);
    await host.signup("gl-h@example.com", "Rosa Martínez"); await other.signup("gl-x@example.com", "Someone Else");
    const party = (await host.post("/api/parties", { title: "Quince de Sofía", event: "Quinceañera", date: inDays(45), zip: "60608", guests: 100 })).json.party;
    const base = `/api/parties/${party.id}`;
    let L = (await host.get(`${base}/guests`)).json;
    assert.deepEqual(L.guests, []); assert.match(L.rsvp_url, /#\/rsvp\/[\w-]{16}$/);
    // only the host
    assert.equal((await other.get(`${base}/guests`)).status, 404);
    assert.equal((await client(S.base).get(`${base}/guests`)).status, 401);
    // one at a time, with checks
    assert.equal((await host.post(`${base}/guests`, { name: "" })).status, 400);
    assert.equal((await host.post(`${base}/guests`, { name: "Tía Carmen", seats: 50 })).status, 400);
    assert.equal((await host.post(`${base}/guests`, { name: "Tía Carmen", phone: "12345" })).status, 400);
    L = (await host.post(`${base}/guests`, { name: "Tía Carmen", seats: 4, side: "Mom's family", phone: "(773) 555-0101" })).json;
    assert.equal(L.guests[0].phone, "7735550101"); assert.equal(L.totals.invited, 4);
    // a pasted list: name, people, group, phone in any order after the name
    L = (await host.post(`${base}/guests`, { lines: "Padrino Juan, 2\nLa familia Soto; Dad's side; 3\n\nPrima Ana" })).json;
    assert.equal(L.guests.length, 4); assert.equal(L.totals.invited, 4 + 2 + 3 + 1); assert.equal(L.totals.waiting, 4);
    const soto = L.guests.find((g) => g.name === "La familia Soto");
    assert.deepEqual([soto.seats, soto.side], [3, "Dad's side"]);
    assert.equal((await host.post(`${base}/guests`, { lines: "Good One, 2\nBad Phone, 2, 555-0101" })).status, 400);
    assert.equal((await host.get(`${base}/guests`)).json.guests.length, 4, "a bad line adds nothing");
    // the guest's personal link: no account needed; can't bring more than invited
    const carmen = L.guests.find((g) => g.name === "Tía Carmen");
    const tok = carmen.url.split("#/rsvp/")[1];
    const inv = (await guest.get(`/api/rsvp/${tok}`)).json;
    assert.equal(inv.party.title, "Quince de Sofía"); assert.equal(inv.party.host, "Rosa"); assert.equal(inv.guest.name, "Tía Carmen"); assert.equal(inv.guest.seats, 4);
    assert.equal(inv.party.address, undefined); // nothing about vendors, money or addresses
    assert.equal((await guest.post(`/api/rsvp/${tok}`, { rsvp: "yes", coming: 6 })).status, 400);
    assert.equal((await guest.post(`/api/rsvp/${tok}`, { rsvp: "sure" })).status, 400);
    const ans = await guest.post(`/api/rsvp/${tok}`, { rsvp: "yes", coming: 3, note: "Sin cebolla para mí" });
    assert.equal(ans.status, 200); assert.equal(ans.json.guest.coming, 3);
    // the open link: a cousin writes her name; she gets her own link back
    const open = L.rsvp_url.split("#/rsvp/")[1];
    assert.equal((await guest.get(`/api/rsvp/${open}`)).json.guest, null);
    assert.equal((await guest.post(`/api/rsvp/${open}`, { rsvp: "yes", coming: 2 })).status, 400); // name needed
    const o = (await guest.post(`/api/rsvp/${open}`, { rsvp: "yes", coming: 2, name: "Prima Lucía" })).json;
    assert.equal(o.guest.name, "Prima Lucía"); assert.notEqual(o.token, open);
    await guest.post(`/api/rsvp/${o.token}`, { rsvp: "maybe" }); // changes her answer on her own link
    // the host's view
    L = (await host.get(`${base}/guests`)).json;
    assert.deepEqual([L.totals.yes, L.totals.maybe, L.totals.waiting, L.totals.no], [3, 1, 3, 0]);
    assert.equal(L.guests.find((g) => g.name === "Prima Lucía").source, "open");
    assert.equal(L.guests.find((g) => g.name === "Tía Carmen").note, "Sin cebolla para mí");
    // the host marks answers by hand (a phone call); a "no" counts nobody
    const juan = L.guests.find((g) => g.name === "Padrino Juan");
    L = (await host.patch(`${base}/guests/${juan.id}`, { rsvp: "yes" })).json;
    assert.equal(L.guests.find((g) => g.id === juan.id).coming, 2); assert.equal(L.totals.yes, 5);
    L = (await host.patch(`${base}/guests/${juan.id}`, { rsvp: "no" })).json;
    assert.equal(L.totals.yes, 3); assert.equal(L.totals.no, 1);
    assert.equal((await other.patch(`${base}/guests/${juan.id}`, { rsvp: "yes" })).status, 404);
    // invitation message, answer-by date, and a fresh open link
    assert.equal((await host.patch(`${base}/rsvp`, { by: inDays(60) })).status, 400); // after the party
    L = (await host.patch(`${base}/rsvp`, { note: "Salón Las Palmas, 6 PM", by: inDays(30) })).json;
    assert.equal((await guest.get(`/api/rsvp/${tok}`)).json.party.note, "Salón Las Palmas, 6 PM");
    L = (await host.patch(`${base}/rsvp`, { newLink: true })).json;
    assert.equal((await guest.get(`/api/rsvp/${open}`)).status, 404);
    assert.equal((await guest.get(`/api/rsvp/${tok}`)).status, 200); // personal links keep working
    // removing a guest
    L = (await host.del(`${base}/guests/${carmen.id}`)).json;
    assert.equal(L.guests.some((g) => g.name === "Tía Carmen"), false);
    assert.equal((await guest.get(`/api/rsvp/${tok}`)).status, 404);
    // court of honor and padrinos
    L = (await host.put(`${base}/court`, { items: [{ role: "Chambelán de honor", name: "Diego" }, { role: "Madrina de última muñeca", name: "Tía Lupe", phone: "773-555-0199" }] })).json;
    assert.deepEqual(L.court.map((c) => [c.role, c.name, c.phone]), [["Chambelán de honor", "Diego", ""], ["Madrina de última muñeca", "Tía Lupe", "7735550199"]]);
    assert.equal((await host.put(`${base}/court`, { items: [{ role: "", name: "x" }] })).status, 400);
    assert.equal((await other.put(`${base}/court`, { items: [] })).status, 404);
    // deleting the party removes its guest list
    await host.del(base);
    assert.equal(S.db.get("SELECT COUNT(*) c FROM party_guests").c, 0); assert.equal(S.db.get("SELECT COUNT(*) c FROM party_court").c, 0);
    assert.equal((await guest.get(`/api/rsvp/${o.token}`)).status, 404);
  } finally { await S.close(); }
});

test("ID checked: shown only when Stripe finished checking the owner's identity (live mode), never on samples or in test mode", async () => {
  const { fakeStripe } = await import("./helpers.js");
  const fake = await fakeStripe();
  const S = await startApp({ DEMO_SEED: "0", STRIPE_SECRET_KEY: "sk_test_x", STRIPE_WEBHOOK_SECRET: "whsec_x", STRIPE_API_BASE: fake.url });
  try {
    const owner = client(S.base), anon = client(S.base);
    await owner.signup("id-o@example.com", "Owner");
    // Stripe still wants something about the person: payouts may work, but no badge
    fake.state.requirements = { currently_due: ["individual.verification.document"], past_due: [], disabled_reason: null };
    const gid = await makeGroup(owner, { name: "ID Band", dates: [inDays(30)] });
    assert.equal((await anon.get(`/api/groups/${gid}`)).json.id_checked, false);
    // everything checked
    fake.state.requirements = { currently_due: [], past_due: [], disabled_reason: null };
    await owner.post(`/api/groups/${gid}/stripe/refresh`);
    assert.equal((await anon.get(`/api/groups/${gid}`)).json.id_checked, true);
    assert.equal((await anon.get("/api/search?zip=60608")).json.results.find((r) => r.id === gid).id_checked, true);
    // Stripe turns payouts off: the badge goes too
    fake.state.ready = false;
    await owner.post(`/api/groups/${gid}/stripe/refresh`);
    assert.equal((await anon.get(`/api/groups/${gid}`)).json.id_checked, false);
  } finally { await S.close(); await fake.close(); }
  // test mode (no Stripe): payouts are pretend, so no badge
  const T = await startApp({ DEMO_SEED: "1" });
  try {
    const o = client(T.base); await o.signup("id-t@example.com", "Owner");
    const gid = await makeGroup(o, { name: "Test Mode Band", dates: [inDays(30)] });
    assert.equal((await client(T.base).get(`/api/groups/${gid}`)).json.id_checked, false);
    T.db.run("UPDATE groups SET id_checked = 1 WHERE demo = 1");
    assert.ok((await client(T.base).get("/api/search?zip=60608")).json.results.filter((r) => r.demo).every((r) => r.id_checked === false));
  } finally { await T.close(); }
});

test("new vendors: the deposit is held until check-in, then the vendor's share is sent once; refunds never claw back", async () => {
  const { fakeStripe, postWebhook } = await import("./helpers.js");
  const { releaseHeldPayouts } = await import("../server/jobs.js");
  const { checkInvariants } = await import("./invariants.js");
  const fake = await fakeStripe();
  const S = await startApp({ DEMO_SEED: "0", STRIPE_SECRET_KEY: "sk_test_x", STRIPE_WEBHOOK_SECRET: "whsec_h", STRIPE_API_BASE: fake.url, HOLD_NEW_VENDOR_EVENTS: "2", PLATFORM_FEE_PCT: "10" });
  try {
    const owner = client(S.base), cust = client(S.base);
    await owner.signup("hold-o@example.com", "New Vendor"); await cust.signup("hold-c@example.com", "Family");
    const dates = [inDays(40), inDays(41), inDays(42), inDays(43), inDays(44)];
    const gid = await makeGroup(owner, { name: "Brand New Band", dates });
    let seq = 0;
    const book = async (date) => {
      const r = await cust.post("/api/bookings", bookingBody(gid, date, { hours: 3 })); // $900, 25% deposit = $225, fee $90
      assert.equal(r.status, 200, JSON.stringify(r.json));
      const b = r.json.booking, pi = `pi_hold_${++seq}`;
      const session = fake.calls.filter((c) => c.method === "POST" && c.url === "/v1/checkout/sessions").pop().form;
      await postWebhook(S.base, { id: "evt_hold_" + seq, type: "checkout.session.completed", data: { object: { payment_status: "paid", amount_total: b.deposit_cents, payment_intent: pi, metadata: { kind: "booking", booking_id: b.id } } } }, "whsec_h");
      await owner.patch(`/api/bookings/${b.id}`, { action: "accept" });
      return { b, pi, session };
    };
    const row = (id) => S.db.get("SELECT * FROM bookings WHERE id = ?", id);
    const transfersFor = (id) => (fake.state.transfers || []).filter((t) => t.transfer_group === id);

    // 1) held: the checkout charges the platform only; checking in sends the vendor its share, once
    const one = await book(dates[0]);
    assert.equal(one.session["payment_intent_data[transfer_group]"], one.b.id);
    assert.equal(one.session["payment_intent_data[transfer_data][destination]"], undefined);
    assert.equal(one.session["payment_intent_data[application_fee_amount]"], undefined);
    assert.equal(row(one.b.id).payout_hold, 1);
    assert.equal((await owner.get(`/api/groups/${gid}/bookings`)).json.bookings.find((x) => x.id === one.b.id).payout_held, true);
    assert.equal((await cust.get("/api/my/bookings")).json.bookings.find((x) => x.id === one.b.id).payout_held, true);
    assert.equal(await releaseHeldPayouts(S.ctx), 0, "nothing goes out before the party");
    S.db.run("UPDATE bookings SET date = ? WHERE id = ?", inDays(0), one.b.id);
    const code = (await cust.get("/api/my/bookings")).json.bookings.find((x) => x.id === one.b.id).checkin_code;
    assert.equal((await owner.post(`/api/bookings/${one.b.id}/checkin`, { code })).status, 200);
    assert.deepEqual(transfersFor(one.b.id).map((t) => [t.amount, t.destination]), [["13500", "acct_test_1"]]); // $225 - $90 fee
    assert.ok(row(one.b.id).payout_released_at > 0);
    await releaseHeldPayouts(S.ctx);
    assert.equal(transfersFor(one.b.id).length, 1, "never sent twice");
    assert.equal((await owner.get(`/api/groups/${gid}/bookings`)).json.bookings.find((x) => x.id === one.b.id).payout_held, false);

    // 2) no check-in: sent once the no-show window closes (4 days after), not before
    const two = await book(dates[1]);
    S.db.run("UPDATE bookings SET date = ? WHERE id = ?", inDays(-2), two.b.id);
    await releaseHeldPayouts(S.ctx);
    assert.equal(transfersFor(two.b.id).length, 0);
    S.db.run("UPDATE bookings SET date = ? WHERE id = ?", inDays(-4), two.b.id);
    await releaseHeldPayouts(S.ctx);
    assert.equal(transfersFor(two.b.id)[0].amount, "13500");

    // 3) a no-show report holds it; your refund sends everything back from the platform's charge, the vendor gets nothing
    const three = await book(dates[2]);
    S.db.run("UPDATE bookings SET date = ? WHERE id = ?", inDays(-1), three.b.id);
    assert.equal((await cust.post(`/api/bookings/${three.b.id}/noshow`, { note: "Nobody came to the party" })).status, 200);
    S.db.run("UPDATE bookings SET date = ? WHERE id = ?", inDays(-10), three.b.id); // even long after, a report waits for you
    await releaseHeldPayouts(S.ctx);
    assert.equal(transfersFor(three.b.id).length, 0);
    S.ctx.config.adminEmails.push("hold-admin@example.com");
    const admin = client(S.base); await admin.signup("hold-admin@example.com", "Site Owner");
    assert.equal((await admin.post(`/api/admin/bookings/${three.b.id}/noshow`, { refund: true })).status, 200);
    const refund = fake.calls.filter((c) => c.url === "/v1/refunds" && c.form.payment_intent === three.pi);
    assert.equal(refund.length, 1); assert.equal(refund[0].form.amount, "22500"); assert.equal(refund[0].form.reverse_transfer, undefined);
    assert.equal(transfersFor(three.b.id).length, 0); assert.ok(row(three.b.id).payout_released_at > 0);

    // 4) the family cancels 4 days out (moderate policy: half back): the vendor gets its share of the half that was kept
    const four = await book(dates[3]);
    S.db.run("UPDATE bookings SET date = ? WHERE id = ?", inDays(4), four.b.id);
    assert.equal((await cust.patch(`/api/bookings/${four.b.id}`, { action: "cancel" })).status, 200);
    const r4 = row(four.b.id);
    assert.equal(r4.refund_cents, 11250);
    await releaseHeldPayouts(S.ctx);
    assert.equal(transfersFor(four.b.id)[0].amount, String(Math.round((22500 - 11250) * (22500 - 9000) / 22500)));

    checkInvariants(S.db, fake, []);

    // 5) after 2 events here, the vendor is established: paid at booking time again, like before
    S.db.run("UPDATE bookings SET date = ? WHERE id = ?", inDays(-6), one.b.id);
    const five = await book(dates[4]);
    assert.equal(row(five.b.id).payout_hold, 0);
    assert.equal(five.session["payment_intent_data[transfer_data][destination]"], "acct_test_1");
    assert.equal(five.session["payment_intent_data[application_fee_amount]"], "9000");
  } finally { await S.close(); await fake.close(); }
});

test("Spanish search pages: /es/chicago/<barrio>/<evento>, in Spanish, linked both ways, in the sitemap only with a real group", async () => {
  const S = await startApp({ DEMO_SEED: "0" });
  const page = async (p) => { const r = await fetch(S.base + p); return { status: r.status, html: await r.text() }; };
  try {
    const o = client(S.base); await o.signup("es-l@example.com", "Owner");
    const gid = await makeGroup(o, { name: "Mariachi Pilsen Real", zip: "60608", dates: [inDays(20)], extra: { events: ["Quinceañera", "Wedding"] } });
    const es = await page("/es/chicago/pilsen/quinceanera");
    assert.equal(es.status, 200);
    assert.match(es.html, /<html lang="es">/);
    assert.match(es.html, /<title>Mariachi, banda y norteño en vivo para una quinceañera en Pilsen, Chicago/);
    assert.match(es.html, /<h1>Música mexicana en vivo para una quinceañera en Pilsen, Chicago<\/h1>/);
    assert.ok(es.html.includes(`href="/g/${gid}"`)); assert.match(es.html, /en el barrio · desde \$/);
    assert.match(es.html, /<link rel="canonical" href="[^"]*\/es\/chicago\/pilsen\/quinceanera">/);
    assert.match(es.html, /hreflang="en" href="[^"]*\/chicago\/pilsen\/quinceanera"/); assert.match(es.html, /hreflang="es" href="[^"]*\/es\/chicago\/pilsen\/quinceanera"/);
    assert.match(es.html, /hreflang="x-default" href="[^"]*\/chicago\/pilsen\/quinceanera"/);
    assert.doesNotMatch(es.html, /noindex/);
    // Spanish event words in the address
    assert.match((await page("/es/chicago/pilsen/boda")).html, /para una boda en Pilsen/);
    assert.match((await page("/es/chicago/pilsen")).html, /para tu fiesta en Pilsen[\s\S]*Por evento[\s\S]*\/es\/chicago\/pilsen\/cumpleanos/);
    assert.equal((await page("/es/chicago/pilsen/wedding")).status, 404); // English word on the Spanish page
    assert.equal((await page("/es/chicago/pilsen/karaoke")).status, 404);
    assert.equal((await page("/es/chicago/atlantis")).status, 404);
    // the English page points to the Spanish one
    const en = await page("/chicago/pilsen/wedding");
    assert.match(en.html, /<html lang="en">/); assert.match(en.html, /hreflang="es" href="[^"]*\/es\/chicago\/pilsen\/boda"/); assert.match(en.html, /En español/);
    // no real group: served, but not indexed and not in the sitemap
    assert.match((await page("/es/chicago/aurora/boda")).html, /noindex/);
    const sm = await (await fetch(S.base + "/sitemap.xml")).text();
    for (const u of ["/es/chicago/pilsen", "/es/chicago/pilsen/quinceanera", "/es/chicago/pilsen/boda"]) assert.ok(sm.includes(`${S.base}${u}</loc>`), u);
    assert.ok(!sm.includes("/es/chicago/aurora"));
    assert.ok(!sm.includes("/es/chicago/pilsen/cumpleanos")); // this group doesn't play birthdays
  } finally { await S.close(); }
});

test("new vendors: a second payment of a held deposit goes back from the platform's charge (nothing to reverse)", async () => {
  const { fakeStripe, postWebhook } = await import("./helpers.js");
  const fake = await fakeStripe();
  const S = await startApp({ DEMO_SEED: "0", STRIPE_SECRET_KEY: "sk_test_x", STRIPE_WEBHOOK_SECRET: "whsec_d", STRIPE_API_BASE: fake.url, HOLD_NEW_VENDOR_EVENTS: "2" });
  try {
    const owner = client(S.base), cust = client(S.base);
    await owner.signup("dup-o@example.com", "Owner"); await cust.signup("dup-c@example.com", "Family");
    const gid = await makeGroup(owner, { name: "Dup Band", dates: [inDays(30)] });
    const b = (await cust.post("/api/bookings", bookingBody(gid, inDays(30)))).json.booking;
    const pay = (pi, n) => postWebhook(S.base, { id: "evt_dup_" + n, type: "checkout.session.completed", data: { object: { payment_status: "paid", amount_total: b.deposit_cents, payment_intent: pi, metadata: { kind: "booking", booking_id: b.id } } } }, "whsec_d");
    await pay("pi_first", 1); await pay("pi_second", 2);
    const r = fake.calls.filter((c) => c.url === "/v1/refunds");
    assert.equal(r.length, 1); assert.equal(r[0].form.payment_intent, "pi_second"); assert.equal(r[0].form.reverse_transfer, undefined);
    assert.equal(S.db.get("SELECT payment_status FROM bookings WHERE id = ?", b.id).payment_status, "paid");
  } finally { await S.close(); await fake.close(); }
});
