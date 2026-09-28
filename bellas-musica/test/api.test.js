import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { startApp, client, inDays, makeGroup, bookingBody } from "./helpers.js";

let S;
before(async () => { S = await startApp(); });
after(async () => { await S.close(); });

const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(64, 1)]).toString("base64");

test("accounts: register, session, login, logout, validation", async () => {
  const a = client(S.base);
  assert.equal((await a.get("/api/me")).json.user, null);
  const u = await a.signup("ana@example.com", "Ana Garcia");
  assert.equal(u.email, "ana@example.com");
  assert.equal((await a.get("/api/me")).json.user.name, "Ana Garcia");
  assert.equal((await a.post("/api/auth/register", { email: "ANA@example.com", password: "another long pass", name: "X" })).status, 409);
  assert.equal((await client(S.base).post("/api/auth/register", { email: "b@example.com", password: "short", name: "B" })).status, 400);
  assert.equal((await client(S.base).post("/api/auth/register", { email: "not-an-email", password: "long enough pass", name: "B" })).status, 400);
  await a.post("/api/auth/logout");
  assert.equal((await a.get("/api/me")).json.user, null);
  assert.equal((await a.post("/api/auth/login", { email: "ana@example.com", password: "wrong password" })).status, 401);
  assert.equal((await a.post("/api/auth/login", { email: "nobody@example.com", password: "wrong password" })).status, 401);
  assert.equal((await a.post("/api/auth/login", { email: "ana@example.com", password: "correct horse battery" })).status, 200);
  // password is stored hashed
  assert.match(S.db.get("SELECT pass_hash FROM users WHERE email = 'ana@example.com'").pass_hash, /^scrypt\$/);
  // login throttling: 10 bad attempts per ip+email
  const t = client(S.base);
  let last;
  for (let i = 0; i < 12; i++) last = await t.post("/api/auth/login", { email: "thr@example.com", password: "nope nope nope" });
  assert.equal(last.status, 429);
});

test("security: cookies, CSRF, content type, headers, static safety", async () => {
  const a = client(S.base);
  const r = await a.raw("POST", "/api/auth/register", { email: "sec@example.com", password: "correct horse battery", name: "Sec" });
  const cookie = r.headers.get("set-cookie");
  assert.match(cookie, /HttpOnly/); assert.match(cookie, /SameSite=Lax/);
  const cross = await a.raw("POST", "/api/auth/logout", {}, { Origin: "https://evil.example" });
  assert.equal(cross.status, 403);
  const form = await fetch(S.base + "/api/auth/logout", { method: "POST", headers: { "Content-Type": "text/plain", "Content-Length": "2" }, body: "hi" });
  assert.equal(form.status, 415);
  const home = await fetch(S.base + "/");
  assert.equal(home.status, 200);
  assert.match(home.headers.get("content-security-policy"), /script-src 'self'/);
  assert.equal(home.headers.get("x-content-type-options"), "nosniff");
  for (const p of ["/../server/config.js", "/%2e%2e/server/config.js", "/uploads/../app.db", "/..%2fserver%2fconfig.js"]) {
    const x = await fetch(S.base + p);
    assert.ok(x.status === 404 || x.status === 400, p + " -> " + x.status);
    assert.doesNotMatch(await x.text(), /SESSION_SECRET/);
  }
  assert.equal((await fetch(S.base + "/api/nope")).status, 404);
});

test("search: zip, filters, event, guests, song (accent-insensitive), date, limits", async () => {
  const c = client(S.base);
  const all = (await c.get("/api/search?zip=60608")).json;
  assert.equal(all.origin.city, "Chicago");
  assert.ok(all.results.length >= 3);
  assert.ok(all.results.every((g) => g.distance_miles <= 60));
  assert.ok(all.results[0].rating >= all.results.at(-1).rating);
  assert.equal((await c.get("/api/search?zip=60608&type=Banda")).json.results.length, 0);
  assert.ok((await c.get("/api/search?zip=77003&type=Mariachi")).json.results.every((g) => g.type === "Mariachi"));
  assert.ok((await c.get("/api/search?zip=60608&max=340")).json.results.every((g) => g.rate_cents <= 34000));
  const big = (await c.get("/api/search?zip=90022&guests=450")).json.results;
  assert.ok(big.length && big.every((g) => g.max_guests >= 450));
  const songs = (await c.get("/api/search?zip=60608&song=mananitas")).json.results;
  assert.ok(songs.length && songs[0].matched_songs.some((s) => s.includes("Mañanitas")));
  const serenata = (await c.get("/api/search?zip=60608&event=Serenata")).json.results;
  assert.ok(serenata[0].fits_event);
  // date filter: every result is actually free that day
  const week = (await c.get("/api/groups/los-gallos-de-oro/availability?month=" + inDays(20).slice(0, 7))).json.days;
  const day = Object.keys(week)[0];
  const byDate = (await c.get(`/api/search?zip=60608&date=${day}`)).json.results;
  assert.ok(byDate.some((g) => g.id === "los-gallos-de-oro") && byDate.every((g) => g.open_slots.length > 0));
  assert.equal((await c.get("/api/search?zip=00000")).status, 404);
  assert.equal((await c.get("/api/search?zip=abc")).status, 400);
  assert.equal((await c.get("/api/search?zip=60608&date=2020-01-01")).status, 400);
  assert.ok((await c.get("/api/search?zip=60608&limit=1")).json.results.length === 1);
  const best = (await c.get("/api/best?zip=77003")).json;
  assert.equal(best.city, "Houston"); assert.ok(best.groups.length >= 1);
  assert.equal(all.results[0].contact_phone, undefined);
  assert.equal(all.results[0].owner_id, undefined);
});

test("groups: create, edit, permissions, packages, photos, video, privacy", async () => {
  const owner = client(S.base), other = client(S.base), anon = client(S.base);
  await owner.signup("owner1@example.com", "Owen Owner"); await other.signup("other1@example.com", "Otto Other");
  assert.equal((await anon.post("/api/groups", { name: "X Group", type: "Mariachi", zip: "60608", rate: 300 })).status, 401);
  assert.equal((await owner.post("/api/groups", { name: "Bad", type: "Polka", zip: "60608", rate: 300 })).status, 400);
  assert.equal((await owner.post("/api/groups", { name: "Bad Zip", type: "Mariachi", zip: "00000", rate: 300 })).status, 400);
  const id = await makeGroup(owner, { name: "Los Ñandúes" });
  assert.match(id, /^los-nandues-/);
  const p = await owner.patch(`/api/groups/${id}`, {
    story: "Since 2015", songs: ["Cielito Lindo", "El Rey", "Cielito Lindo"], events: ["Wedding", "Nope"], max_guests: 200, sound_system: true,
    dress_code: "Charro", set_minutes: 50, travel_miles: 20, travel_fee: 75, deposit_pct: 30, cancel_policy: "strict",
    contact_phone: "312-555-0199", video_url: "https://youtu.be/dQw4w9WgXcQ"
  });
  assert.equal(p.status, 200);
  assert.deepEqual(p.json.songs, ["Cielito Lindo", "El Rey"]); assert.deepEqual(p.json.events, ["Wedding"]);
  assert.equal(p.json.travel_fee_cents, 7500); assert.equal(p.json.contact_phone, "+13125550199");
  assert.equal(p.json.video.url, "https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ");
  assert.equal((await owner.patch(`/api/groups/${id}`, { video_url: "https://evil.example/x" })).status, 400);
  assert.equal((await owner.patch(`/api/groups/${id}`, { deposit_pct: 5 })).status, 400);
  assert.equal((await other.patch(`/api/groups/${id}`, { name: "Hacked" })).status, 403);
  assert.equal((await anon.patch(`/api/groups/${id}`, { name: "Hacked" })).status, 401);
  assert.equal((await owner.patch("/api/groups/los-gallos-de-oro", { name: "Hacked" })).status, 403); // sample groups have no owner
  const pub = (await anon.get(`/api/groups/${id}`)).json;
  assert.equal(pub.contact_phone, undefined); assert.equal(pub.stripe, undefined); assert.equal(pub.is_owner, false);
  // packages
  assert.equal((await owner.post(`/api/groups/${id}/packages`, { name: "Serenata", description: "3 songs", hours: 1, price: 250 })).status, 200);
  const g2 = await owner.post(`/api/groups/${id}/packages`, { name: "Party", hours: 3, price: 800 });
  const pid = g2.json.packages.find((x) => x.name === "Party").id;
  assert.equal((await other.del(`/api/packages/${pid}`)).status, 403);
  assert.equal((await owner.patch(`/api/packages/${pid}`, { price: 900 })).json.packages.find((x) => x.id === pid).price_cents, 90000);
  assert.equal((await owner.del(`/api/packages/${pid}`)).json.packages.length, 1);
  // photos
  const up = await owner.post(`/api/groups/${id}/photos`, { data: PNG });
  assert.equal(up.status, 200); assert.equal(up.json.photos.length, 1);
  const url = up.json.photos[0].url;
  const served = await fetch(S.base + url);
  assert.equal(served.status, 200); assert.equal(served.headers.get("content-type"), "image/png");
  assert.equal((await owner.post(`/api/groups/${id}/photos`, { data: Buffer.from("<html><script>alert(1)</script></html>").toString("base64") })).status, 400);
  assert.equal((await other.post(`/api/groups/${id}/photos`, { data: PNG })).status, 403);
  assert.equal((await owner.post(`/api/groups/${id}/photos`, { data: "A".repeat(6_000_000) })).status, 413);
  assert.equal((await other.del(`/api/groups/${id}/photos/${up.json.photos[0].id}`)).status, 403);
  const del = await owner.del(`/api/groups/${id}/photos/${up.json.photos[0].id}`);
  assert.equal(del.json.photos.length, 0);
  await new Promise((r) => setTimeout(r, 50));
  assert.equal(fs.existsSync(path.join(S.dir, "uploads", path.basename(url))), false);
  // calendar
  const d1 = inDays(12), d2 = inDays(13);
  assert.equal((await owner.put(`/api/groups/${id}/availability`, { dates: { [d1]: ["12:00 PM", "8:00 PM"], [d2]: ["9:00 AM"] } })).status, 400);
  assert.equal((await owner.put(`/api/groups/${id}/availability`, { dates: { "2020-01-01": ["12:00 PM"] } })).status, 400);
  assert.equal((await owner.put(`/api/groups/${id}/availability`, { dates: { [d1]: ["12:00 PM", "8:00 PM"] } })).status, 200);
  assert.deepEqual((await anon.get(`/api/groups/${id}/availability?month=${d1.slice(0, 7)}`)).json.days[d1], ["12:00 PM", "8:00 PM"]);
  assert.equal((await other.put(`/api/groups/${id}/availability`, { dates: { [d1]: [] } })).status, 403);
  assert.ok((await owner.post(`/api/groups/${id}/availability/weekends`, { weeks: 4 })).json.opened >= 8);
  assert.equal((await owner.del(`/api/groups/${id}/availability`)).status, 200);
  assert.deepEqual((await anon.get(`/api/groups/${id}/availability?month=${d1.slice(0, 7)}`)).json.days, {});
  assert.equal((await anon.get("/api/groups/nope")).status, 404);
});

test("bookings: quote, hold, double-booking, pay, accept, refunds by policy, privacy", async () => {
  const owner = client(S.base), cust = client(S.base), cust2 = client(S.base);
  await owner.signup("o2@example.com", "Olga Owner"); await cust.signup("c2@example.com", "Carlos Cliente"); await cust2.signup("c3@example.com", "Cora Cliente");
  const far = inDays(40), soon = inDays(4), mid = inDays(9), soon2 = inDays(5);
  const gid = await makeGroup(owner, { name: "Booking Band", dates: [far, soon, mid, soon2], extra: { cancel_policy: "moderate", travel_miles: 20, travel_fee: 60 } });

  const q = await cust.post("/api/quote", bookingBody(gid, far));
  assert.equal(q.status, 200);
  assert.equal(q.json.quote.total_cents, 60000); assert.equal(q.json.quote.deposit_cents, 15000);
  assert.equal(q.json.quote.platform_fee_cents, undefined);
  assert.equal(q.json.policy.key, "moderate");
  const farQ = await cust.post("/api/quote", bookingBody(gid, far, { eventZip: "77003" })); // Houston is far from Chicago
  assert.equal(farQ.json.quote.travel_fee_cents, 6000);

  assert.equal((await client(S.base).post("/api/bookings", bookingBody(gid, far))).status, 401);
  assert.equal((await cust.post("/api/bookings", bookingBody(gid, far, { acceptPolicy: false }))).status, 400);
  assert.equal((await cust.post("/api/bookings", bookingBody(gid, far, { guests: 9999 }))).status, 400);
  assert.equal((await cust.post("/api/bookings", bookingBody(gid, far, { time: "8:00 PM" }))).status, 409); // not offered
  assert.equal((await cust.post("/api/bookings", bookingBody(gid, far, { phone: "12" }))).status, 400);
  assert.equal((await owner.post("/api/bookings", bookingBody(gid, far))).status, 400); // own group

  const b1 = await cust.post("/api/bookings", bookingBody(gid, far));
  assert.equal(b1.status, 200); assert.equal(b1.json.booking.status, "pending_payment"); assert.equal(b1.json.payment.mode, "simulated");
  assert.equal((await cust2.post("/api/bookings", bookingBody(gid, far))).status, 409); // slot held
  assert.ok(!(await client(S.base).get(`/api/groups/${gid}/availability?month=${far.slice(0, 7)}`)).json.days[far]?.includes("2:00 PM"));
  // an unpaid hold that lapses frees the slot
  S.db.run("UPDATE bookings SET created_at = created_at - 4000 WHERE id = ?", b1.json.booking.id);
  const b1b = await cust2.post("/api/bookings", bookingBody(gid, far));
  assert.equal(b1b.status, 200);
  assert.equal((await cust.get("/api/my/bookings")).json.bookings.length, 0); // expired one is hidden
  await cust2.patch(`/api/bookings/${b1b.json.booking.id}`, { action: "cancel" });

  // pay -> request -> group sees it, phone hidden until accepted
  const b2 = (await cust.post("/api/bookings", bookingBody(gid, far))).json.booking;
  assert.equal((await cust2.post(`/api/bookings/${b2.id}/simulate-pay`)).status, 404);
  const paid = await cust.post(`/api/bookings/${b2.id}/simulate-pay`);
  assert.equal(paid.json.booking.status, "requested"); assert.equal(paid.json.booking.payment_status, "paid");
  let list = (await owner.get(`/api/groups/${gid}/bookings`)).json.bookings;
  let row = list.find((x) => x.id === b2.id);
  assert.equal(row.status, "requested"); assert.equal(row.phone, ""); assert.equal(row.payout_cents, 15000 - 6000);
  assert.ok(list.some((x) => x.status === "cancelled")); // history is kept
  assert.equal((await cust.get(`/api/groups/${gid}/bookings`)).status, 403);
  assert.equal((await cust.patch(`/api/bookings/${b2.id}`, { action: "accept" })).status, 403);
  assert.equal((await owner.patch(`/api/bookings/${b2.id}`, { action: "accept" })).json.booking.status, "confirmed");
  list = (await owner.get(`/api/groups/${gid}/bookings`)).json.bookings;
  assert.equal(list.find((x) => x.id === b2.id).phone, "+13125550142");
  // customer cancels 40 days out: full refund
  const c1 = await cust.patch(`/api/bookings/${b2.id}`, { action: "cancel" });
  assert.equal(c1.json.booking.status, "cancelled"); assert.equal(c1.json.booking.refund_cents, 15000); assert.equal(c1.json.booking.payment_status, "refunded");
  assert.equal((await cust.patch(`/api/bookings/${b2.id}`, { action: "cancel" })).status, 400); // already cancelled
  // 4 days out (moderate): 50%
  const b3 = (await cust.post("/api/bookings", bookingBody(gid, soon))).json.booking;
  await cust.post(`/api/bookings/${b3.id}/simulate-pay`);
  const mine = (await cust.get("/api/my/bookings")).json.bookings.find((b) => b.id === b3.id);
  assert.equal(mine.refund_if_cancel_cents, 7500);
  const c3 = await cust.patch(`/api/bookings/${b3.id}`, { action: "cancel" });
  assert.equal(c3.json.booking.refund_cents, 7500); assert.equal(c3.json.booking.payment_status, "partial_refund");
  // group declines: full refund; group cancels a confirmed booking: full refund
  const b4 = (await cust.post("/api/bookings", bookingBody(gid, mid))).json.booking;
  await cust.post(`/api/bookings/${b4.id}/simulate-pay`);
  const dec = await owner.patch(`/api/bookings/${b4.id}`, { action: "decline" });
  assert.equal(dec.json.booking.status, "declined"); assert.equal(dec.json.booking.refund_cents, 15000);
  const b5 = (await cust.post("/api/bookings", bookingBody(gid, soon2))).json.booking;
  await cust.post(`/api/bookings/${b5.id}/simulate-pay`);
  await owner.patch(`/api/bookings/${b5.id}`, { action: "accept" });
  const oc = await owner.patch(`/api/bookings/${b5.id}`, { action: "cancel" });
  assert.equal(oc.json.booking.refund_cents, 15000);
  // declined slot is bookable again
  assert.equal((await cust2.post("/api/bookings", bookingBody(gid, mid))).status, 200);
  // cannot accept an unpaid request
  const b6 = (await cust.post("/api/bookings", bookingBody(gid, far, { time: "4:00 PM" }))).json.booking;
  assert.equal((await owner.patch(`/api/bookings/${b6.id}`, { action: "accept" })).status, 400);
});

test("messaging: contact details hidden until confirmed; sample listings auto-reply", async () => {
  const owner = client(S.base), cust = client(S.base);
  await owner.signup("o3@example.com", "Olive Owner", { phone: "312-555-0111", sms_opt_in: true });
  await cust.signup("c4@example.com", "Cal Cliente");
  const day = inDays(30);
  const gid = await makeGroup(owner, { name: "Chat Band", dates: [day] });
  assert.equal((await client(S.base).post(`/api/groups/${gid}/messages`, { text: "hi" })).status, 401);
  assert.equal((await owner.post(`/api/groups/${gid}/messages`, { text: "hi" })).status, 400);
  const m = await cust.post(`/api/groups/${gid}/messages`, { text: "Hi! Call me at 312-555-0142 or ana@x.com" });
  assert.equal(m.json.masked, true);
  assert.ok(m.json.messages[0].text.includes("[hidden until a booking is confirmed]") && !m.json.messages[0].text.includes("555"));
  assert.equal((await cust.post(`/api/groups/${gid}/messages`, { text: "x".repeat(501) })).status, 400);
  const threads = (await owner.get(`/api/groups/${gid}/threads`)).json.threads;
  assert.equal(threads.length, 1); assert.equal(threads[0].name, "Cal C.");
  const cid = threads[0].customer_id;
  assert.equal((await cust.get(`/api/groups/${gid}/threads`)).status, 403);
  assert.equal((await owner.post(`/api/groups/${gid}/threads/9999`, { text: "hello" })).status, 400);
  assert.equal((await owner.post(`/api/groups/${gid}/threads/${cid}`, { text: "Sure, what songs?" })).json.messages.at(-1).sender, "group");
  // after a confirmed booking, contact details are allowed
  const b = (await cust.post("/api/bookings", bookingBody(gid, day))).json.booking;
  await cust.post(`/api/bookings/${b.id}/simulate-pay`); await owner.patch(`/api/bookings/${b.id}`, { action: "accept" });
  const ok = await cust.post(`/api/groups/${gid}/messages`, { text: "My number is 312-555-0142" });
  assert.equal(ok.json.masked, false);
  // sample listing replies automatically
  const auto = await cust.post("/api/groups/dj-fiesta-latina/messages", { text: "Are you free?" });
  assert.match(auto.json.messages.at(-1).text, /sample listing/);
});

test("texts: only opted-in users, sent from the platform number", async () => {
  const owner = client(S.base), optout = client(S.base), cust = client(S.base);
  await owner.signup("o4@example.com", "Opt In", { phone: "312-555-0122", sms_opt_in: true });
  await optout.signup("o5@example.com", "Opt Out", { phone: "312-555-0133" });
  await cust.signup("c5@example.com", "Cust Omer");
  const d = inDays(25);
  const g1 = await makeGroup(owner, { name: "Texty Band", dates: [d] });
  const g2 = await makeGroup(optout, { name: "Quiet Band", dates: [d] });
  const before = S.db.get("SELECT COUNT(*) c FROM sms_log").c;
  for (const g of [g1, g2]) { const b = (await cust.post("/api/bookings", bookingBody(g, d))).json.booking; await cust.post(`/api/bookings/${b.id}/simulate-pay`); }
  await new Promise((r) => setTimeout(r, 50));
  const rows = S.db.all("SELECT * FROM sms_log WHERE id > ?", before);
  assert.equal(rows.length, 1); assert.equal(rows[0].to_phone, "+13125550122"); assert.match(rows[0].body, /new booking request/);
  assert.doesNotMatch(rows[0].body, /555-0142|\+1312555014/); // never includes the customer's number
  assert.equal((await optout.patch("/api/me", { sms_opt_in: true })).json.user.sms_opt_in, true);
  const bare = client(S.base); await bare.signup("nophone@example.com", "No Phone");
  assert.equal((await bare.patch("/api/me", { sms_opt_in: true })).json.user.sms_opt_in, false); // opt-in needs a number
});

test("reviews: only after the event, paid, once; ratings update", async () => {
  const owner = client(S.base), cust = client(S.base), other = client(S.base);
  await owner.signup("o6@example.com", "Rev Owner"); await cust.signup("c6@example.com", "Rita Reviewer"); await other.signup("c7@example.com", "Ray Other");
  const d = inDays(20);
  const gid = await makeGroup(owner, { name: "Reviewed Band", dates: [d] });
  const b = (await cust.post("/api/bookings", bookingBody(gid, d))).json.booking;
  assert.equal((await cust.post(`/api/bookings/${b.id}/review`, { rating: 5 })).status, 400); // not yet
  await cust.post(`/api/bookings/${b.id}/simulate-pay`); await owner.patch(`/api/bookings/${b.id}`, { action: "accept" });
  assert.equal((await cust.post(`/api/bookings/${b.id}/review`, { rating: 5 })).status, 400); // event hasn't happened
  S.db.run("UPDATE bookings SET date = ? WHERE id = ?", inDays(-1), b.id); // time passes
  assert.equal((await cust.get("/api/my/bookings")).json.bookings.find((x) => x.id === b.id).status, "completed");
  assert.equal((await other.post(`/api/bookings/${b.id}/review`, { rating: 5 })).status, 404);
  assert.equal((await cust.post(`/api/bookings/${b.id}/review`, { rating: 6 })).status, 400);
  assert.equal((await cust.post(`/api/bookings/${b.id}/review`, { rating: 4, text: "Great music <b>hi</b>" })).status, 200);
  assert.equal((await cust.post(`/api/bookings/${b.id}/review`, { rating: 5 })).status, 409);
  const g = (await cust.get(`/api/groups/${gid}`)).json;
  assert.equal(g.reviews, 1); assert.equal(g.rating, 4); assert.equal(g.recent_reviews[0].name, "Rita R.");
});

test("featured placement: pay, ranks first, badge, stacks 30 days", async () => {
  const owner = client(S.base), other = client(S.base);
  await owner.signup("o7@example.com", "Feat Owner"); await other.signup("o8@example.com", "Not Owner");
  const gid = await makeGroup(owner, { name: "Zzz Newcomer", zip: "78207" });
  const before = (await client(S.base).get("/api/search?zip=78207")).json.results;
  assert.notEqual(before[0].id, gid);
  const f = await owner.post(`/api/groups/${gid}/feature`);
  assert.equal(f.json.simulated, true);
  assert.equal((await other.post(`/api/feature/${f.json.id}/simulate-pay`)).status, 404);
  assert.equal((await owner.post(`/api/feature/${f.json.id}/simulate-pay`)).status, 200);
  const after = (await client(S.base).get("/api/search?zip=78207")).json.results;
  assert.equal(after[0].id, gid); assert.equal(after[0].promoted, true);
  const first = S.db.get("SELECT promoted_until p FROM groups WHERE id = ?", gid).p;
  const f2 = await owner.post(`/api/groups/${gid}/feature`); await owner.post(`/api/feature/${f2.json.id}/simulate-pay`);
  await owner.post(`/api/feature/${f2.json.id}/simulate-pay`); // double click must not double-charge time
  assert.equal(S.db.get("SELECT promoted_until p FROM groups WHERE id = ?", gid).p, first + 30 * 86400);
});

test("account settings: profile, password change signs out other devices", async () => {
  const a = client(S.base), b = client(S.base);
  await a.signup("pw@example.com", "Pat Word");
  await b.post("/api/auth/login", { email: "pw@example.com", password: "correct horse battery" });
  assert.equal((await a.patch("/api/me", { name: "Patricia", lang: "es" })).json.user.lang, "es");
  assert.equal((await a.post("/api/me/password", { current: "wrong", next: "brand new password" })).status, 401);
  assert.equal((await a.post("/api/me/password", { current: "correct horse battery", next: "brand new password" })).status, 200);
  assert.equal((await b.get("/api/me")).json.user, null); // other device signed out
  assert.equal((await a.get("/api/me")).json.user.name, "Patricia"); // this one stays in
  assert.equal((await client(S.base).post("/api/auth/login", { email: "pw@example.com", password: "brand new password" })).status, 200);
});
