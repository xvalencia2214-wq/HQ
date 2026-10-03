import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { startApp, client, inDays, makeGroup, bookingBody } from "./helpers.js";
import { checkCalendarUrl, parseBusy } from "../server/ical.js";

const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(64, 1)]).toString("base64");
const PDF = Buffer.from("%PDF-1.4\n% test certificate\n").toString("base64");
const settle = () => new Promise((r) => setTimeout(r, 150));

test("referrals and Bella's Pro lower the platform fee; Pro doubles the photo limit", async () => {
  const S = await startApp({ DEMO_SEED: "0", PLATFORM_FEE_PCT: "10" });
  try {
    const a = client(S.base), b = client(S.base), cust = client(S.base), anon = client(S.base);
    await a.signup("rf-a@example.com", "Ana Mariachi");
    const ga = await makeGroup(a, { name: "Referrer Band", dates: [inDays(30)] });
    const ref = (await a.get("/api/my/referral")).json;
    assert.match(ref.code, /^[A-Z0-9x]{4,12}$/); assert.match(ref.url, new RegExp(`ref=${ref.code}`));
    assert.equal((await a.get("/api/my/referral")).json.code, ref.code); // stable
    // B signs up with the code; bad codes are just ignored
    await b.signup("rf-b@example.com", "Beto Carpas", { ref: ref.code, source: "Iglesia San Pío!!" });
    await client(S.base).signup("rf-x@example.com", "Nobody Ref", { ref: "ZZZZZZ" });
    const bu = S.db.get("SELECT referred_by, signup_source FROM users WHERE email = 'rf-b@example.com'");
    assert.equal(bu.signup_source, "iglesiasanpo");
    assert.equal(bu.referred_by, S.db.get("SELECT id FROM users WHERE email = 'rf-a@example.com'").id);
    assert.equal(S.db.get("SELECT referred_by FROM users WHERE email = 'rf-x@example.com'").referred_by, 0);
    // nothing yet: B hasn't published
    assert.equal((await a.get("/api/my/groups")).json.groups[0].fee_pct, 10);
    const gb = await makeGroup(b, { name: "Referred Band", dates: [inDays(30)] });
    assert.equal((await a.get("/api/my/groups")).json.groups[0].fee_pct, 5);
    assert.equal((await b.get("/api/my/groups")).json.groups[0].fee_pct, 5);
    assert.ok(S.db.all("SELECT kind FROM email_log").some((r) => r.kind === "referral.reward"));
    assert.deepEqual([(await a.get("/api/my/referral")).json.invited, (await a.get("/api/my/referral")).json.live], [1, 1]);
    // the half fee is what bookings are charged
    await cust.signup("rf-c@example.com", "Cust");
    const bk = (await cust.post("/api/bookings", bookingBody(ga, inDays(30), { hours: 3 }))).json.booking; // $900
    assert.equal(S.db.get("SELECT platform_fee_cents f FROM bookings WHERE id = ?", bk.id).f, 4500);
    // a second listing from B doesn't reward again
    const before = S.db.get("SELECT fee_discount_until u FROM groups WHERE id = ?", ga).u;
    await makeGroup(b, { name: "Referred Band Two", dates: [inDays(31)] });
    assert.equal(S.db.get("SELECT fee_discount_until u FROM groups WHERE id = ?", ga).u, before);

    // Pro: bought like Featured, lowers the fee to PRO_FEE_PCT (6) for a group without a referral discount, shows a badge
    const c = client(S.base); await c.signup("pro-c@example.com", "Pro Owner");
    const gc = await makeGroup(c, { name: "Pro Band", dates: [inDays(32)] });
    assert.equal((await anon.get(`/api/groups/${gc}`)).json.pro, false);
    const buy = await c.post(`/api/groups/${gc}/pro`);
    assert.equal(buy.status, 200); assert.equal(buy.json.amount_cents, 2900); assert.match(buy.json.url, /#\/pay\/pro\//);
    assert.equal((await anon.post(`/api/groups/${gc}/pro`)).status, 401);
    assert.equal((await c.post(`/api/feature/${buy.json.id}/simulate-pay`)).status, 200);
    assert.equal((await anon.get(`/api/groups/${gc}`)).json.pro, true);
    assert.equal((await c.get("/api/my/groups")).json.groups[0].fee_pct, 6);
    assert.equal(S.db.get("SELECT promoted_until p FROM groups WHERE id = ?", gc).p, 0); // Pro is not Featured
    for (let i = 0; i < 19; i++) await c.post(`/api/groups/${gc}/photos`, { data: PNG });
    assert.equal(S.db.get("SELECT COUNT(*) n FROM photos WHERE group_id = ?", gc).n, 20);
    assert.equal((await c.post(`/api/groups/${gc}/photos`, { data: PNG })).status, 400);
  } finally { await S.close(); }
});

test("calendar sync: a vendor's own calendar blocks times; its bookings come out as a private feed", async () => {
  const d = inDays(20), d2 = inDays(21);
  const toStamp = (k, hhmm) => k.replace(/-/g, "") + "T" + hhmm + "00";
  let ics = `BEGIN:VCALENDAR\r\nBEGIN:VEVENT\r\nDTSTART:${toStamp(d, "1330")}\r\nDTEND:${toStamp(d, "1530")}\r\nSUMMARY:Other gig\r\nEND:VEVENT\r\nBEGIN:VEVENT\r\nDTSTART;VALUE=DATE:${d2.replace(/-/g, "")}\r\nDTEND;VALUE=DATE:${inDays(22).replace(/-/g, "")}\r\nSUMMARY:Family trip\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n`;
  const srv = http.createServer((req, res) => { if (req.url === "/bad") { res.writeHead(200); res.end("hello"); return; } res.writeHead(200, { "Content-Type": "text/calendar" }); res.end(ics); });
  await new Promise((r) => srv.listen(0, r));
  const S = await startApp({ DEMO_SEED: "0", ICS_ALLOW_HTTP: "1" });
  try {
    const o = client(S.base), other = client(S.base), cust = client(S.base), anon = client(S.base);
    await o.signup("cal-o@example.com", "Cal Owner"); await other.signup("cal-x@example.com", "Other"); await cust.signup("cal-c@example.com", "Cust");
    const g = await makeGroup(o, { name: "Cal Band", dates: [d, d2] }); // 12, 2, 4 PM on both days
    const open = async (k) => (await anon.get(`/api/groups/${g}/availability?month=${k.slice(0, 7)}`)).json.days[k] || [];
    assert.deepEqual(await open(d), ["12:00 PM", "2:00 PM", "4:00 PM"]);
    const base = `http://127.0.0.1:${srv.address().port}`;
    assert.equal((await other.put(`/api/groups/${g}/calendar-sync/import`, { url: base + "/cal.ics" })).status, 403);
    assert.equal((await o.put(`/api/groups/${g}/calendar-sync/import`, { url: base + "/bad" })).status, 400);
    const imp = await o.put(`/api/groups/${g}/calendar-sync/import`, { url: base + "/cal.ics" });
    assert.equal(imp.status, 200); assert.equal(imp.json.sync.busy_days, 2);
    // 1:30-3:30 PM busy: blocks a 2:00 start (the shortest booking is an hour); 12:00-1:00 and 4:00 still fit. All-day: the whole day.
    assert.deepEqual(await open(d), ["12:00 PM", "4:00 PM"]);
    // a 2-hour booking can't start at 12:00 any more (it would run into the busy time)
    assert.deepEqual((await anon.get(`/api/groups/${g}/availability?month=${d.slice(0, 7)}&minutes=120`)).json.days[d], ["4:00 PM"]);
    assert.deepEqual(await open(d2), []);
    assert.equal((await cust.post("/api/bookings", bookingBody(g, d, { time: "2:00 PM" }))).status, 409);
    // the calendar changes and is read again
    ics = "BEGIN:VCALENDAR\r\nEND:VCALENDAR\r\n";
    await S.ctx.syncCalendars();
    assert.deepEqual(await open(d), ["12:00 PM", "2:00 PM", "4:00 PM"]);
    assert.equal((await o.del(`/api/groups/${g}/calendar-sync/import`)).json.sync.import_url, "");

    // export feed: private link, bookings in it, address only once confirmed
    const feed = (await o.post(`/api/groups/${g}/calendar-sync/feed`)).json.sync.feed_url;
    assert.match(feed, /\/api\/cal\/[\w-]{20,}\.ics$/);
    const bk = (await cust.post("/api/bookings", bookingBody(g, d))).json.booking;
    await cust.post(`/api/bookings/${bk.id}/simulate-pay`);
    let cal = await fetch(feed.replace(/^https?:\/\/[^/]+/, S.base)).then((r) => r.text());
    assert.match(cal, /BEGIN:VCALENDAR/); assert.match(cal, new RegExp(`UID:${bk.id}@bellasmusica`)); assert.match(cal, /STATUS:TENTATIVE/);
    assert.ok(!cal.includes("Casa Blanca"));
    await o.patch(`/api/bookings/${bk.id}`, { action: "accept" });
    cal = await fetch(feed.replace(/^https?:\/\/[^/]+/, S.base)).then((r) => r.text());
    assert.match(cal, /STATUS:CONFIRMED/); assert.match(cal, /Casa Blanca/);
    const rotated = (await o.post(`/api/groups/${g}/calendar-sync/feed`)).json.sync.feed_url;
    assert.equal((await fetch(feed.replace(/^https?:\/\/[^/]+/, S.base))).status, 404); // the old link stops working
    assert.notEqual(rotated, feed);
  } finally { await S.close(); srv.close(); }
});

test("calendar links: only public https addresses; the parser skips cancelled and free time", () => {
  for (const bad of ["http://example.com/x.ics", "https://localhost/x.ics", "https://127.0.0.1/x", "https://10.0.0.5/x", "https://192.168.1.2/x", "https://169.254.169.254/latest", "ftp://x.com/a", "nonsense", ""])
    assert.throws(() => checkCalendarUrl(bad), /calendar|allowed|https/i, bad);
  assert.equal(checkCalendarUrl("webcal://calendar.google.com/calendar/ical/abc/basic.ics"), "https://calendar.google.com/calendar/ical/abc/basic.ics");
  const busy = parseBusy("BEGIN:VCALENDAR\r\nBEGIN:VEVENT\r\nSTATUS:CANCELLED\r\nDTSTART:20261110T140000\r\nDTEND:20261110T150000\r\nEND:VEVENT\r\nBEGIN:VEVENT\r\nTRANSP:TRANSPARENT\r\nDTSTART:20261111T140000\r\nEND:VEVENT\r\nBEGIN:VEVENT\r\nDTSTART:20261112T2200\r\nEND:VEVENT\r\nBEGIN:VEVENT\r\nDTSTART:20261113T230000\r\nDTEND:20261114T010000\r\nEND:VEVENT\r\nEND:VCALENDAR", { tz: "America/Chicago", from: "2026-11-01" });
  assert.deepEqual(busy, [{ date: "2026-11-12", start: 1320, end: 1380 }, { date: "2026-11-13", start: 1380, end: 1440 }, { date: "2026-11-14", start: 0, end: 60 }]);
});

test("earnings, licenses and insurance with admin review, weather policy, review photos, quotes for every category, WhatsApp, partner links, website page", async () => {
  const seen = [];
  const tw = http.createServer(async (req, res) => { let b = ""; for await (const c of req) b += c; seen.push(Object.fromEntries(new URLSearchParams(b))); res.writeHead(201); res.end("{}"); });
  await new Promise((r) => tw.listen(0, r));
  const S = await startApp({ DEMO_SEED: "0", ADMIN_EMAILS: "boss@example.com", TWILIO_ACCOUNT_SID: "ACx", TWILIO_AUTH_TOKEN: "t", TWILIO_FROM: "+15550001111", TWILIO_WHATSAPP_FROM: "+15550002222", TWILIO_API_BASE: `http://127.0.0.1:${tw.address().port}` });
  try {
    const o = client(S.base), cust = client(S.base), boss = client(S.base), anon = client(S.base);
    await o.signup("et-o@example.com", "Earn Owner", { phone: "312-555-0101", sms_opt_in: true }); await cust.signup("et-c@example.com", "Earn Cust"); await boss.signup("boss@example.com", "The Boss", { source: "dress-shop-26th" });
    const d = inDays(-5);
    const g = await makeGroup(o, { name: "Earn Band", dates: [inDays(10), inDays(11)] });

    // WhatsApp: the owner switches channel; the next alert goes to WhatsApp from the WhatsApp number
    assert.equal((await o.patch("/api/me", { notify_channel: "whatsapp" })).json.user.notify_channel, "whatsapp");
    assert.equal((await o.get("/api/me")).json.user.notify_channel, "whatsapp"); // and it is read back after a reload
    const b1 = (await cust.post("/api/bookings", bookingBody(g, inDays(10), { hours: 3 }))).json.booking;
    await cust.post(`/api/bookings/${b1.id}/simulate-pay`); await settle();
    assert.equal(seen.at(-1).To, "whatsapp:+13125550101"); assert.equal(seen.at(-1).From, "whatsapp:+15550002222");
    await o.patch("/api/me", { notify_channel: "sms" });
    await o.patch(`/api/bookings/${b1.id}`, { action: "accept" });
    const part = (await cust.post(`/api/bookings/${b1.id}/parts`, { amount: 100 })).json.part_id;
    await cust.post(`/api/parts/${part}/simulate-pay`); await settle();
    assert.equal(seen.at(-1).To, "+13125550101");

    // earnings: deposit share (225 - 90 fee = 135) + 100 paid in the app, by event month
    S.db.run("UPDATE bookings SET date = ? WHERE id = ?", d, b1.id);
    const e = (await o.get(`/api/groups/${g}/earnings?year=${d.slice(0, 4)}`)).json.earnings;
    const m = e.months[Number(d.slice(5, 7)) - 1];
    assert.deepEqual([m.events, m.deposits_cents, m.balances_cents, m.fees_cents], [1, 13500, 10000, 9000]);
    assert.equal(e.total.deposits_cents, 13500);
    const csv = await o.raw("GET", `/api/groups/${g}/earnings.csv?year=${d.slice(0, 4)}`);
    assert.equal(csv.status, 200); assert.match(csv.headers.get("content-type"), /text\/csv/);
    assert.equal((await cust.get(`/api/groups/${g}/earnings`)).status, 403);

    // review with photos (the event is now in the past)
    const rv = (body) => cust.post(`/api/bookings/${b1.id}/review`, body);
    assert.equal((await rv({ rating: 5, text: "x", photos: [PNG, PNG, PNG, PNG] })).status, 400);
    assert.equal((await rv({ rating: 5, text: "x", photos: [Buffer.from("not an image at all, really").toString("base64")] })).status, 400);
    assert.equal((await rv({ rating: 5, text: "¡Excelentes!", photos: [PNG, PNG] })).status, 200);
    const pub = (await anon.get(`/api/groups/${g}`)).json;
    assert.equal(pub.recent_reviews[0].photos.length, 2); assert.match(pub.recent_reviews[0].photos[0], /^\/uploads\/r_/);

    // weather policy
    assert.equal((await o.patch(`/api/groups/${g}`, { weather_policy: "If it rains we move under the tent. Call 312-555-0101." })).status, 200);
    assert.ok(!(await anon.get(`/api/groups/${g}`)).json.weather_policy.includes("555-0101"));

    // documents: upload, admin review, badge, expiry
    const up = (body) => o.post(`/api/groups/${g}/documents`, body);
    assert.equal((await up({ kind: "insurance", data: Buffer.from("plain text").toString("base64") })).status, 400);
    assert.equal((await up({ kind: "passport", data: PDF })).status, 400);
    const ok1 = await up({ kind: "insurance", data: PDF });
    assert.equal(ok1.status, 200); assert.equal(ok1.json.documents[0].status, "pending");
    assert.equal((await o.get("/api/admin/documents")).status, 404); // not an admin
    const list = (await boss.get("/api/admin/documents")).json.documents;
    assert.equal(list.length, 1); assert.equal(list[0].group_name, "Earn Band");
    const file = await boss.raw("GET", `/api/admin/documents/${list[0].id}/file`);
    assert.equal(file.status, 200); assert.equal(file.headers.get("content-type"), "application/pdf"); assert.equal(file.headers.get("content-security-policy"), "sandbox");
    assert.equal((await anon.raw("GET", `/api/admin/documents/${list[0].id}/file`)).status, 401);
    await boss.post(`/api/admin/documents/${list[0].id}`, { approve: true, expires: inDays(-1) });
    assert.equal((await anon.get(`/api/groups/${g}`)).json.insured, true);
    S.ctx.expireDocuments();
    assert.equal((await anon.get(`/api/groups/${g}`)).json.insured, false); // expired insurance takes the badge away
    const ok2 = await up({ kind: "health_permit", data: PNG });
    await boss.post(`/api/admin/documents/${ok2.json.documents[0].id}`, { approve: false, note: "Blurry, please rescan" });
    assert.equal((await anon.get(`/api/groups/${g}`)).json.licensed, false);
    assert.ok(S.db.all("SELECT kind FROM email_log").some((r) => r.kind === "doc.rejected.group"));
    assert.ok(S.db.get("SELECT 1 AS x FROM admin_log WHERE action = 'document rejected'"));
    // the file isn't reachable from the public uploads folder
    assert.notEqual((await fetch(`${S.base}/uploads/${list[0].id}.pdf`)).status, 200);

    // partner links show up in the admin summary
    const sum = (await boss.get("/api/admin/summary")).json;
    assert.ok(sum.signup_sources.some((x) => x.source === "dress-shop-26th"));

    // website page
    const site = await fetch(`${S.base}/v/${g}`).then((r) => r.text());
    assert.match(site, /<title>Earn Band/); assert.match(site, /See dates &amp; book/); assert.match(site, /og:title/);
    assert.ok(!site.includes("555-0101"));
    assert.equal((await fetch(`${S.base}/v/does-not-exist`)).status, 404);
  } finally { await S.close(); tw.close(); }
});

test("Get quotes for tents, food and more: only that kind of vendor gets the request", async () => {
  const S = await startApp({ DEMO_SEED: "0" });
  try {
    const mo = client(S.base), vo = client(S.base), cust = client(S.base);
    await mo.signup("gq-m@example.com", "M"); await vo.signup("gq-v@example.com", "V"); await cust.signup("gq-c@example.com", "C");
    const d = inDays(30);
    await makeGroup(mo, { name: "Music Only", dates: [d] });
    const tent = (await vo.post("/api/groups", { name: "Tent Only", type: "Tents", zip: "60608", members: 2, story: "Tents delivered and set up by our crew, rain or shine, all over Chicago." })).json.id;
    await vo.patch(`/api/groups/${tent}`, { events: ["Wedding"] }); await vo.put(`/api/groups/${tent}/availability`, { dates: { [d]: ["12:00 PM"] } });
    await vo.post(`/api/groups/${tent}/photos`, { data: PNG }); await vo.post(`/api/groups/${tent}/packages`, { name: "Tent", description: "", hours: 1, price: 400 }); await vo.post(`/api/groups/${tent}/publish`);
    const body = { event: "Wedding", date: d, guests: 80, hours: 2, zip: "60608" };
    assert.equal((await cust.post("/api/requests", { ...body, category: "spaceships" })).status, 400);
    const r1 = await cust.post("/api/requests", { ...body, category: "rentals" });
    assert.deepEqual(r1.json.groups.map((g) => g.name), ["Tent Only"]);
    const r2 = await cust.post("/api/requests", body);
    assert.deepEqual(r2.json.groups.map((g) => g.name), ["Music Only"]);
    assert.deepEqual((await cust.get("/api/my/requests")).json.requests.map((r) => r.category).sort(), ["music", "rentals"]);
  } finally { await S.close(); }
});
