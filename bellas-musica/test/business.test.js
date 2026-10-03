// The tools that make the app a vendor's whole business: team logins, payment links for its own clients, lineup and pay,
// one more hour at the party, what the vendor needs from the family, and holiday serenatas.
import test from "node:test";
import assert from "node:assert/strict";
import { startApp, client, inDays, makeGroup, bookingBody, fakeStripe, postWebhook } from "./helpers.js";
import { holidayDate } from "../server/pricing.js";

const row = (S, id) => S.db.get("SELECT * FROM bookings WHERE id = ?", id);

test("team logins: invite, join, run the listing; payouts and the team stay with the owner", async () => {
  const S = await startApp({ DEMO_SEED: "0" });
  try {
    const o = client(S.base), m = client(S.base), x = client(S.base), c = client(S.base);
    await o.signup("tm-o@example.com", "Beto Owner"); await m.signup("tm-m@example.com", "Lupe Manager"); await x.signup("tm-x@example.com", "Stranger"); await c.signup("tm-c@example.com", "Cust");
    const d = inDays(20);
    const g = await makeGroup(o, { name: "Team Band", dates: [d] });
    assert.equal((await m.get(`/api/groups/${g}/team`)).status, 403);
    assert.equal((await o.post(`/api/groups/${g}/team/invite`, { email: "not an email" })).status, 400);
    const inv = await o.post(`/api/groups/${g}/team/invite`, { email: "tm-m@example.com" });
    assert.equal(inv.status, 200);
    assert.ok(S.db.all("SELECT kind FROM email_log").some((r) => r.kind === "team.invite"));
    const token = inv.json.url.split("/team/")[1];
    assert.equal((await client(S.base).get(`/api/team-invite/${token}`)).json.invite.group, "Team Band");
    assert.equal((await o.post(`/api/team-invite/${token}/accept`)).status, 400); // the owner already owns it
    assert.match((await x.post(`/api/team-invite/${token}/accept`)).json.error, /for t…@example\.com/); // sent to Lupe's email: not for anyone else
    assert.equal((await m.post(`/api/team-invite/${token}/accept`)).status, 200);
    assert.equal((await x.post(`/api/team-invite/${token}/accept`)).status, 404); // one use only
    assert.ok(S.db.all("SELECT kind FROM email_log").some((r) => r.kind === "team.joined"));

    // the manager sees the listing and runs it
    const mine = (await m.get("/api/my/groups")).json.groups;
    assert.equal(mine.length, 1); assert.equal(mine[0].my_role, "manager");
    assert.equal((await m.patch(`/api/groups/${g}`, { story: "We play mariachi music for weddings, quinceañeras and family parties in Chicago." })).status, 200);
    assert.equal((await m.put(`/api/groups/${g}/availability`, { dates: { [d]: ["12:00 PM", "2:00 PM", "4:00 PM", "6:00 PM"] } })).status, 200);
    const b = (await c.post("/api/bookings", bookingBody(g, d))).json.booking;
    await c.post(`/api/bookings/${b.id}/simulate-pay`);
    // the request reaches the whole team
    const mUser = S.db.get("SELECT email FROM users WHERE id = (SELECT user_id FROM group_team LIMIT 1)");
    assert.ok(S.db.all("SELECT * FROM email_log WHERE kind = 'booking.requested.group'").some((r) => r.to_addr === mUser.email || r.recipient === mUser.email || JSON.stringify(r).includes(mUser.email)));
    assert.equal((await m.patch(`/api/bookings/${b.id}`, { action: "accept" })).status, 200);
    assert.equal(row(S, b.id).status, "confirmed");
    assert.equal((await m.post(`/api/groups/${g}/messages`, { text: "hi" })).status, 400); // can't message your own listing
    assert.equal((await m.post("/api/bookings", bookingBody(g, d, { time: "4:00 PM" }))).status, 400); // nor book it
    // owner-only: payouts, Pro, Featured, the team
    for (const path of ["stripe/onboard", "pro", "feature", "team/invite"]) assert.equal((await m.post(`/api/groups/${g}/${path}`, { email: "a@b.co" })).status, 403, path);
    // a stranger still can't
    assert.equal((await x.patch(`/api/groups/${g}`, { story: "x" })).status, 403);
    // leaving, and the owner removing someone
    const mid = S.db.get("SELECT user_id FROM group_team").user_id;
    assert.equal((await x.del(`/api/groups/${g}/team/${mid}`)).status, 403);
    assert.equal((await m.del(`/api/groups/${g}/team/${mid}`)).json.left, true);
    assert.equal((await m.get("/api/my/groups")).json.groups.length, 0);
    assert.equal((await m.patch(`/api/groups/${g}`, { story: "y" })).status, 403);
  } finally { await S.close(); }
});

test("payment link for the vendor's own client: holds the time, the client pays, it's confirmed at the lower fee", async () => {
  const S = await startApp({ DEMO_SEED: "0", PLATFORM_FEE_PCT: "10" });
  try {
    const o = client(S.base), c = client(S.base), other = client(S.base);
    await o.signup("pl-o@example.com", "Link Owner"); await c.signup("pl-c@example.com", "Rosa Cliente"); await other.signup("pl-x@example.com", "Other");
    const d = inDays(25);
    const g = await makeGroup(o, { name: "Link Band", dates: [d] });
    const base = { clientName: "Rosa Martínez", title: "Quinceañera de Sofía", date: d, time: "7:30 PM", hours: 4, event: "Quinceañera", guests: 150, eventZip: "60608", address: "Salón Los Arcos", total: 1600, depositPct: 50, days: 3 };
    assert.equal((await other.post(`/api/groups/${g}/paylinks`, base)).status, 403);
    for (const bad of [{ time: "7:10 PM" }, { total: 5 }, { depositPct: 5 }, { date: "2020-01-01" }, { hours: 9 }, { minutes: 25 }]) assert.equal((await o.post(`/api/groups/${g}/paylinks`, { ...base, ...bad })).status, 400, JSON.stringify(bad));
    const mk = await o.post(`/api/groups/${g}/paylinks`, base);
    assert.equal(mk.status, 200);
    assert.equal(mk.json.link.deposit_cents, 80000);
    const token = mk.json.url.split("/pay-link/")[1];
    // the time is held: nobody else can book 7:30-11:30 PM (the group's calendar doesn't even list it; links ignore the calendar)
    assert.equal((await o.post(`/api/groups/${g}/paylinks`, { ...base, time: "9:00 PM" })).status, 409);
    // the client's page
    const pub = (await client(S.base).get(`/api/pay-link/${token}`)).json.link;
    assert.equal(pub.group.name, "Link Band"); assert.equal(pub.total_cents, 160000); assert.equal(pub.balance_cents, 80000); assert.equal(pub.status, "open");
    assert.equal((await o.post(`/api/pay-link/${token}/book`, { acceptPolicy: true, phone: "312-555-0142" })).status, 400); // the vendor can't pay its own link
    assert.equal((await c.post(`/api/pay-link/${token}/book`, { phone: "312-555-0142" })).status, 400); // policy not accepted
    const bk = await c.post(`/api/pay-link/${token}/book`, { acceptPolicy: true, phone: "312-555-0142" });
    assert.equal(bk.status, 200);
    const id = bk.json.booking_id;
    assert.equal(row(S, id).status, "pending_payment"); assert.equal(row(S, id).direct, 1);
    assert.equal(row(S, id).platform_fee_cents, 4800); // 3% of $1,600, not 10%
    assert.equal((await other.post(`/api/pay-link/${token}/book`, { acceptPolicy: true, phone: "312-555-0199" })).status, 409); // used by Rosa
    // the hold lasts as long as the link, not 30 minutes
    S.db.run("UPDATE bookings SET created_at = created_at - 7200 WHERE id = ?", id);
    await client(S.base).get(`/api/groups/${g}/availability?month=${d.slice(0, 7)}`);
    assert.equal(row(S, id).status, "pending_payment");
    await c.post(`/api/bookings/${id}/simulate-pay`);
    assert.equal(row(S, id).status, "confirmed"); // the vendor already agreed
    assert.ok(S.db.all("SELECT kind FROM email_log").some((r) => r.kind === "link.paid.group"));
    assert.equal((await client(S.base).get(`/api/pay-link/${token}`)).json.link.status, "used");
    const list = (await o.get(`/api/groups/${g}/paylinks`)).json;
    assert.equal(list.links[0].booking_status, "confirmed"); assert.equal(list.fee_pct, 3);
    // cancelling an open link frees its time
    const mk2 = await o.post(`/api/groups/${g}/paylinks`, { ...base, date: inDays(26), time: "2:00 PM", hours: 2 });
    assert.equal((await other.del(`/api/paylinks/${mk2.json.link.id}`)).status, 404);
    assert.equal((await o.del(`/api/paylinks/${mk2.json.link.id}`)).json.link.status, "cancelled");
    assert.equal((await c.post(`/api/pay-link/${mk2.json.url.split("/pay-link/")[1]}/book`, { acceptPolicy: true, phone: "312-555-0142" })).status, 410);
  } finally { await S.close(); }
});

test("payment link in live Stripe mode: a fresh checkout each try, the webhook confirms it", async () => {
  const F = await fakeStripe();
  const S = await startApp({ DEMO_SEED: "0", STRIPE_SECRET_KEY: "sk_test_x", STRIPE_WEBHOOK_SECRET: "whsec_pl", STRIPE_API_BASE: F.url });
  try {
    const o = client(S.base), c = client(S.base);
    await o.signup("pll-o@example.com", "Live Owner"); await c.signup("pll-c@example.com", "Live Cust");
    const d = inDays(30);
    const g = await makeGroup(o, { name: "Live Link", dates: [d] });
    S.db.run("UPDATE groups SET stripe_ready = 0 WHERE id = ?", g);
    assert.equal((await o.post(`/api/groups/${g}/paylinks`, { clientName: "Ana", date: d, time: "6:00 PM", hours: 2, event: "Birthday", guests: 50, eventZip: "60608", total: 500 })).status, 400); // payouts not set up
    S.db.run("UPDATE groups SET stripe_ready = 1 WHERE id = ?", g);
    const mk = await o.post(`/api/groups/${g}/paylinks`, { clientName: "Ana", date: d, time: "6:00 PM", hours: 2, event: "Birthday", guests: 50, eventZip: "60608", total: 500 });
    const token = mk.json.url.split("/pay-link/")[1];
    // the vendor left the address empty: the client has to give it
    assert.match((await c.post(`/api/pay-link/${token}/book`, { acceptPolicy: true, phone: "312-555-0142" })).json.error, /location/);
    const a = await c.post(`/api/pay-link/${token}/book`, { acceptPolicy: true, phone: "312-555-0142", address: "Casa de Ana, Cicero" });
    assert.equal(a.json.payment.mode, "stripe");
    // trying again later opens a fresh checkout for the same booking
    const again = await c.post(`/api/pay-link/${token}/book`, { acceptPolicy: true, phone: "312-555-0142" });
    assert.equal(again.json.booking_id, a.json.booking_id); assert.equal(again.json.payment.mode, "stripe");
    const b = row(S, a.json.booking_id);
    await postWebhook(S.base, { id: "evt_pl_1", type: "checkout.session.completed", data: { object: { payment_status: "paid", amount_total: b.deposit_cents, payment_intent: "pi_pl", metadata: { kind: "booking", booking_id: b.id } } } }, "whsec_pl");
    assert.equal(row(S, b.id).status, "confirmed");
  } finally { await S.close(); await F.close(); }
});

test("lineup and pay: roster, who works each gig, WhatsApp details, payroll", async () => {
  const S = await startApp({ DEMO_SEED: "0" });
  try {
    const o = client(S.base), c = client(S.base), x = client(S.base);
    await o.signup("cr-o@example.com", "Crew Owner"); await c.signup("cr-c@example.com", "Crew Cust"); await x.signup("cr-x@example.com", "Stranger");
    const d = inDays(10);
    const g = await makeGroup(o, { name: "Crew Band", dates: [d] });
    assert.equal((await o.post(`/api/groups/${g}/crew`, { name: "J" })).status, 400);
    assert.equal((await o.post(`/api/groups/${g}/crew`, { name: "Juan Trompeta", phone: "nope" })).status, 400);
    await o.post(`/api/groups/${g}/crew`, { name: "Juan Trompeta", role: "Trumpet", phone: "773-555-0101", pay: 150 });
    const crew = (await o.post(`/api/groups/${g}/crew`, { name: "Pedro Violín", role: "Violin", pay: 120 })).json.crew;
    assert.equal(crew.length, 2);
    assert.equal((await x.get(`/api/groups/${g}/crew`)).status, 403);
    const b = (await c.post("/api/bookings", bookingBody(g, d, { hours: 3 }))).json.booking;
    await c.post(`/api/bookings/${b.id}/simulate-pay`);
    const juan = crew.find((p) => p.name.startsWith("Juan")), pedro = crew.find((p) => p.name.startsWith("Pedro"));
    let L = (await o.put(`/api/bookings/${b.id}/lineup`, { members: [{ crewId: juan.id }, { crewId: pedro.id, pay: 100 }] })).json;
    assert.equal(L.total_cents, 25000);
    assert.equal(L.booking.address, ""); // not confirmed yet: no address for the crew
    await o.patch(`/api/bookings/${b.id}`, { action: "accept" });
    L = (await o.get(`/api/bookings/${b.id}/lineup`)).json;
    assert.equal(L.booking.address, "Casa Blanca Hall, Chicago");
    assert.equal((await x.get(`/api/bookings/${b.id}/lineup`)).status, 404);
    assert.equal((await o.put(`/api/bookings/${b.id}/lineup`, { members: [{ crewId: 99999 }] })).status, 400);
    await o.post(`/api/bookings/${b.id}/lineup/${juan.id}/sent`);
    L = (await o.post(`/api/bookings/${b.id}/lineup/${juan.id}/paid`, { paid: true })).json;
    assert.ok(L.lineup.find((p) => p.crew_id === juan.id).paid_at > 0 && L.lineup.find((p) => p.crew_id === juan.id).sent_at > 0);
    // a paid person can't be dropped from the record by editing the lineup; their pay doesn't change either
    L = (await o.put(`/api/bookings/${b.id}/lineup`, { members: [{ crewId: juan.id, pay: 999 }] })).json;
    assert.deepEqual(L.lineup.map((p) => [p.name, p.pay_cents]), [["Juan Trompeta", 15000]]);
    const pr = (await o.get(`/api/groups/${g}/payroll?month=${d.slice(0, 7)}`)).json;
    assert.equal(pr.paid_cents, 15000); assert.equal(pr.owed_cents, 0);
    await o.put(`/api/bookings/${b.id}/lineup`, { members: [{ crewId: juan.id }, { crewId: pedro.id }] });
    const pr2 = (await o.get(`/api/groups/${g}/payroll?month=${d.slice(0, 7)}`)).json;
    assert.equal(pr2.owed_cents, 12000); assert.equal(pr2.people[0].name, "Pedro Violín");
    // deleting someone who worked keeps them (inactive)
    await o.del(`/api/crew/${juan.id}`);
    assert.equal((await o.get(`/api/groups/${g}/crew`)).json.crew.find((p) => p.id === juan.id).active, false);
  } finally { await S.close(); }
});

test("one more hour at the party: offered or asked, paid in the app or in cash; no no-show after that", async () => {
  const S = await startApp({ DEMO_SEED: "0" });
  try {
    const o = client(S.base), c = client(S.base), x = client(S.base);
    await o.signup("ex-o@example.com", "Extra Owner"); await c.signup("ex-c@example.com", "Extra Cust"); await x.signup("ex-x@example.com", "Stranger");
    const d = inDays(9);
    const g = await makeGroup(o, { name: "Extra Band", dates: [d] }); // $300/hour
    const b = (await c.post("/api/bookings", bookingBody(g, d, { hours: 3 }))).json.booking;
    await c.post(`/api/bookings/${b.id}/simulate-pay`); await o.patch(`/api/bookings/${b.id}`, { action: "accept" });
    assert.match((await o.post(`/api/bookings/${b.id}/extras`, { kind: "hour" })).json.error, /day of the event/);
    S.db.run("UPDATE bookings SET date = ? WHERE id = ?", inDays(1), b.id); // the day before: still closed (it can still be cancelled)
    assert.equal((await o.post(`/api/bookings/${b.id}/extras`, { kind: "hour" })).status, 400);
    S.db.run("UPDATE bookings SET date = ? WHERE id = ?", inDays(0), b.id); // the party is today
    assert.equal((await x.post(`/api/bookings/${b.id}/extras`, { kind: "hour" })).status, 404);
    // the vendor offers one more hour at its rate
    let ex = (await o.post(`/api/bookings/${b.id}/extras`, { kind: "hour" })).json.extras;
    assert.equal(ex[0].amount_cents, 30000); assert.equal(ex[0].status, "offered");
    assert.ok(S.db.all("SELECT kind FROM email_log").some((r) => r.kind === "extra.offered.customer"));
    assert.equal((await o.post(`/api/extras/${ex[0].id}/pay`)).status, 403);
    assert.equal((await c.post(`/api/extras/${ex[0].id}/pay`)).json.payment.mode, "simulated");
    await c.post(`/api/extras/${ex[0].id}/simulate-pay`);
    await c.post(`/api/extras/${ex[0].id}/simulate-pay`); // twice: still once
    ex = (await c.get(`/api/bookings/${b.id}/extras`)).json.extras;
    assert.equal(ex[0].status, "paid");
    assert.equal(S.db.get("SELECT fee_cents FROM extras WHERE id = ?", ex[0].id).fee_cents, 3000); // the booking's 10%
    // the family asks for another hour; the vendor sets the price and marks it paid in cash
    assert.equal((await c.post(`/api/bookings/${b.id}/extras`, { kind: "other", label: "Tip", amount: 50 })).status, 403);
    ex = (await c.post(`/api/bookings/${b.id}/extras`, { kind: "hour" })).json.extras;
    const asked = ex.find((e) => e.status === "asked");
    assert.ok(S.db.all("SELECT kind FROM email_log").some((r) => r.kind === "extra.asked.group"));
    assert.equal((await c.post(`/api/extras/${asked.id}/pay`)).status, 400); // not confirmed yet
    assert.equal((await o.post(`/api/extras/${asked.id}/accept`, { amount: 250 })).status, 200);
    assert.equal((await o.post(`/api/extras/${asked.id}/cash`)).status, 200);
    // a custom extra, then cancelled: a late payment for it goes back
    ex = (await o.post(`/api/bookings/${b.id}/extras`, { kind: "other", label: "Extra song", amount: 40 })).json.extras;
    const song = ex.find((e) => e.label === "Extra song");
    await c.post(`/api/extras/${song.id}/cancel`);
    await c.post(`/api/extras/${song.id}/simulate-pay`);
    assert.ok(S.db.get("SELECT * FROM extra_refunds WHERE payment_intent = ?", `sim_extra_${song.id}#extra`));
    // the vendor was clearly there: no no-show report afterwards
    S.db.run("UPDATE bookings SET date = ? WHERE id = ?", inDays(-1), b.id);
    assert.equal((await c.post(`/api/bookings/${b.id}/noshow`, { note: "They never came to the party at all" })).status, 400);
    // earnings show the extras
    const e = (await o.get(`/api/groups/${g}/earnings?year=${inDays(-1).slice(0, 4)}`)).json.earnings;
    assert.equal(e.total.extras_cents, 27000);
  } finally { await S.close(); }
});

test("what the vendor needs from the family, and holiday serenatas", async () => {
  const S = await startApp({ DEMO_SEED: "0" });
  try {
    const o = client(S.base), c = client(S.base);
    await o.signup("nd-o@example.com", "Needs Owner"); await c.signup("nd-c@example.com", "Needs Cust");
    const d = inDays(12);
    const g = await makeGroup(o, { name: "Needs Truck", dates: [d] });
    assert.equal((await o.patch(`/api/groups/${g}`, { needs: Array(13).fill("x") })).status, 400);
    await o.patch(`/api/groups/${g}`, { needs: ["A power outlet within 50 feet", "Call me at 312-555-0100 for parking"] });
    const pub = (await c.get(`/api/groups/${g}`)).json;
    assert.equal(pub.needs.length, 2); assert.doesNotMatch(pub.needs[1], /555-0100/);
    assert.match((await c.post("/api/bookings", bookingBody(g, d))).json.error, /what they need/);
    const b = (await c.post("/api/bookings", bookingBody(g, d, { acceptNeeds: true }))).json.booking;
    assert.equal(b.needs.length, 2);
    assert.ok((await c.get("/api/meta")).json.needs_presets.food.length > 0);

    // a Mother's Day special: 20-minute serenatas, from midnight to 2 AM on May 10
    const may10 = holidayDate("mothers_day", inDays(0));
    assert.equal((await o.post(`/api/groups/${g}/specials`, { holiday: "easter", minutes: 20, price: 200, from: "12:00 AM", to: "2:00 AM" })).status, 400);
    assert.equal((await o.post(`/api/groups/${g}/specials`, { holiday: "mothers_day", minutes: 25, price: 200, from: "12:00 AM", to: "2:00 AM" })).status, 400);
    const sp = await o.post(`/api/groups/${g}/specials`, { holiday: "mothers_day", minutes: 20, price: 200, from: "12:00 AM", to: "2:00 AM" });
    assert.equal(sp.status, 200); assert.equal(sp.json.specials[0].holiday_date, may10); assert.equal(sp.json.specials[0].name, "Serenata del 10 de mayo");
    // setting it again replaces it
    const sp2 = await o.post(`/api/groups/${g}/specials`, { holiday: "mothers_day", minutes: 30, price: 250, from: "12:00 AM", to: "2:00 AM" });
    assert.equal(sp2.json.specials.length, 1);
    const list = (await c.get("/api/specials/mothers_day?zip=60608")).json;
    assert.equal(list.date, may10); assert.equal(list.vendors[0].name, "Needs Truck"); assert.equal(list.vendors[0].special.minutes, 30); assert.equal(list.vendors[0].open, 5);
    const pkg = list.vendors[0].special.id;
    // the special can only be booked on its date
    assert.match((await c.post("/api/bookings", bookingBody(g, d, { packageId: pkg, acceptNeeds: true }))).json.error, /only for/);
    const s1 = await c.post("/api/bookings", bookingBody(g, may10, { time: "12:00 AM", packageId: pkg, acceptNeeds: true, event: "Serenata" }));
    assert.equal(s1.status, 200); assert.equal(s1.json.booking.duration_min, 30);
    assert.equal((await c.get("/api/specials/mothers_day")).json.vendors[0].open, 4);
    assert.ok((await c.get("/api/meta")).json.holidays.find((h) => h.key === "mothers_day").offering >= 1);
  } finally { await S.close(); }
});

test("money review: duplicate payments go back, old checkouts close, unpaid link holds can be cancelled, fair fees", async () => {
  const F = await fakeStripe();
  const S = await startApp({ DEMO_SEED: "0", STRIPE_SECRET_KEY: "sk_test_x", STRIPE_WEBHOOK_SECRET: "whsec_mr", STRIPE_API_BASE: F.url, PLATFORM_FEE_PCT: "10" });
  let seq = 0;
  const hook = (object) => postWebhook(S.base, { id: `evt_mr_${++seq}`, type: "checkout.session.completed", data: { object: { payment_status: "paid", ...object } } }, "whsec_mr");
  try {
    const o = client(S.base), c = client(S.base), found = client(S.base);
    await o.signup("mr-o@example.com", "Money Owner"); await c.signup("mr-c@example.com", "Own Client"); await found.signup("mr-f@example.com", "Found Here");
    const d = inDays(30), d2 = inDays(31);
    const g = await makeGroup(o, { name: "Money Band", dates: [d, d2] });
    const link = async (date, time) => (await o.post(`/api/groups/${g}/paylinks`, { clientName: "Ana", date, time, hours: 2, event: "Birthday", guests: 50, eventZip: "60608", address: "Casa", total: 1000, depositPct: 50 })).json;

    // two tries at paying a link: the first checkout is closed before the second opens
    const l1 = await link(d, "6:00 PM"), tok1 = l1.url.split("/pay-link/")[1];
    const a = await c.post(`/api/pay-link/${tok1}/book`, { acceptPolicy: true, phone: "312-555-0142" });
    const firstSession = row(S, a.json.booking_id).stripe_session_id;
    const b2 = await c.post(`/api/pay-link/${tok1}/book`, { acceptPolicy: true, phone: "312-555-0142" });
    assert.ok(F.calls.some((x) => x.url === `/v1/checkout/sessions/${firstSession}/expire`));
    assert.notEqual(row(S, b2.json.booking_id).stripe_session_id, firstSession);
    // the client's own payment is at 3%
    assert.equal(row(S, a.json.booking_id).platform_fee_cents, 3000);
    // two payments for the same deposit anyway: the second goes back in full
    const bk = row(S, a.json.booking_id);
    await hook({ amount_total: bk.deposit_cents, payment_intent: "pi_dep_1", metadata: { kind: "booking", booking_id: bk.id } });
    await hook({ amount_total: bk.deposit_cents, payment_intent: "pi_dep_2", metadata: { kind: "booking", booking_id: bk.id } });
    await hook({ amount_total: bk.deposit_cents, payment_intent: "pi_dep_1", metadata: { kind: "booking", booking_id: bk.id } }); // the first reported again: nothing
    assert.equal(row(S, bk.id).status, "confirmed");
    assert.deepEqual(F.state.refunded.filter((r) => r.pi.startsWith("pi_dep")), [{ pi: "pi_dep_2", amount: bk.deposit_cents }]);
    assert.ok(S.db.get("SELECT 1 AS x FROM extra_refunds WHERE payment_intent = 'pi_dep_2'"));

    // a link the client opened but never paid holds the time; the vendor can cancel it, which frees the time
    const l2 = await link(d2, "2:00 PM"), tok2 = l2.url.split("/pay-link/")[1];
    const held = await c.post(`/api/pay-link/${tok2}/book`, { acceptPolicy: true, phone: "312-555-0142" });
    assert.equal((await o.post(`/api/groups/${g}/paylinks`, { clientName: "Other", date: d2, time: "2:00 PM", hours: 2, event: "Birthday", guests: 50, eventZip: "60608", total: 500 })).status, 409);
    assert.equal((await o.del(`/api/paylinks/${l2.link.id}`)).json.link.status, "cancelled");
    assert.equal(row(S, held.json.booking_id).status, "cancelled");
    assert.equal((await o.post(`/api/groups/${g}/paylinks`, { clientName: "Other", date: d2, time: "2:00 PM", hours: 2, event: "Birthday", guests: 50, eventZip: "60608", total: 500 })).status, 200);
    // a paid one can't be cancelled from here
    assert.equal((await o.del(`/api/paylinks/${l1.link.id}`)).status, 400);

    // a family that found the vendor here (they messaged first) pays the regular fee through a link
    await found.post(`/api/groups/${g}/messages`, { text: "Hola, ¿están libres?" });
    const l3 = await link(inDays(32), "6:00 PM");
    await o.put(`/api/groups/${g}/availability`, { dates: { [inDays(32)]: ["6:00 PM"] } });
    const f3 = await found.post(`/api/pay-link/${l3.url.split("/pay-link/")[1]}/book`, { acceptPolicy: true, phone: "312-555-0199" });
    assert.equal(row(S, f3.json.booking_id).platform_fee_cents, 10000); // 10% of $1,000, not 3%

    // an extra paid twice: the second payment goes back
    S.db.run("UPDATE bookings SET date = ? WHERE id = ?", inDays(0), bk.id);
    const ex = (await o.post(`/api/bookings/${bk.id}/extras`, { kind: "other", label: "Una más", amount: 100 })).json.extras[0];
    const p1 = await c.post(`/api/extras/${ex.id}/pay`);
    assert.equal(p1.json.payment.mode, "stripe");
    const s1 = S.db.get("SELECT session_id FROM extras WHERE id = ?", ex.id).session_id;
    await c.post(`/api/extras/${ex.id}/pay`); // a second try closes the first checkout
    assert.ok(F.calls.some((x) => x.url === `/v1/checkout/sessions/${s1}/expire`));
    await hook({ amount_total: 10000, payment_intent: "pi_ex_1", metadata: { kind: "extra", extra_id: ex.id, booking_id: bk.id } });
    await hook({ amount_total: 10000, payment_intent: "pi_ex_2", metadata: { kind: "extra", extra_id: ex.id, booking_id: bk.id } });
    assert.equal(S.db.get("SELECT status, pi FROM extras WHERE id = ?", ex.id).pi, "pi_ex_1");
    assert.deepEqual(F.state.refunded.filter((r) => r.pi.startsWith("pi_ex")), [{ pi: "pi_ex_2", amount: 10000 }]);

    // team invitations are limited per day
    let last;
    for (let i = 0; i < 16; i++) { last = await o.post(`/api/groups/${g}/team/invite`, {}); if (i < 9) assert.equal(last.status, 200); }
    assert.ok([400, 429].includes(last.status));
  } finally { await S.close(); await F.close(); }
});

test("propinas, weekly gigs and the morning text", async () => {
  const S = await startApp({ DEMO_SEED: "0" });
  try {
    const o = client(S.base), c = client(S.base), x = client(S.base), m = client(S.base);
    await o.signup("wk-o@example.com", "Beto Owner", { phone: "312-555-0101", sms_opt_in: true, lang: "es" });
    await c.signup("wk-c@example.com", "Restaurante El Sol"); await x.signup("wk-x@example.com", "Stranger");
    await m.signup("wk-m@example.com", "Lupe Helper", { phone: "312-555-0102", sms_opt_in: true });
    const first = inDays(7);
    const g = await makeGroup(o, { name: "Mariachi Viernes", dates: [] });
    // open the same weekday for 10 weeks except the 3rd, with a 10% weekly discount
    const dates = Object.fromEntries(Array.from({ length: 10 }, (_, i) => [inDays(7 + 7 * i), ["7:00 PM"]]).filter((_, i) => i !== 2));
    await o.put(`/api/groups/${g}/availability`, { dates });
    assert.equal((await o.patch(`/api/groups/${g}`, { weekly_discount_pct: 40 })).status, 400);
    assert.equal((await o.patch(`/api/groups/${g}`, { weekly_discount_pct: 10 })).json.weekly_discount_pct, 10);

    // ---- weekly gigs ----
    const body = bookingBody(g, first, { time: "7:00 PM", hours: 2, event: "Corporate / Restaurant", weeks: 6 });
    assert.equal((await c.post("/api/series", { ...body, weeks: 13 })).status, 400);
    assert.equal((await o.post("/api/series", body)).status, 400); // not your own group
    const sr = await c.post("/api/series", body);
    assert.equal(sr.status, 200);
    assert.equal(sr.json.dates.length, 5); assert.deepEqual(sr.json.skipped, [inDays(21)]); // the 3rd week isn't open
    const rows = S.db.all("SELECT * FROM bookings WHERE series_id = ? ORDER BY date", sr.json.series_id);
    assert.equal(rows.length, 5);
    assert.equal(rows[0].total_cents, 54000); assert.equal(rows[0].discount_cents, 6000); // $600 for 2 hours, 10% off
    assert.equal(sr.json.cart.amount_cents, rows.reduce((n, b) => n + b.deposit_cents, 0));
    await c.post(`/api/carts/${sr.json.cart.cart_id}/simulate-pay`);
    assert.ok(S.db.all("SELECT status, discount_cents FROM bookings WHERE series_id = ?", sr.json.series_id).every((b) => b.status === "requested" && b.discount_cents === 6000));
    const mine = (await c.get("/api/my/bookings")).json.bookings.filter((b) => b.series_id === sr.json.series_id).sort((a, b) => (a.date < b.date ? -1 : 1));
    assert.deepEqual([mine[0].series.n, mine[0].series.of, mine[4].series.last], [1, 5, true]);
    // the vendor accepts them all (the dashboard does one call per date)
    for (const b of rows) assert.equal((await o.patch(`/api/bookings/${b.id}`, { action: "accept" })).status, 200);
    // ---- propina ----
    const b0 = rows[0];
    assert.match((await c.post(`/api/bookings/${b0.id}/tips`, { amount: 50 })).json.error, /day of the event/);
    S.db.run("UPDATE bookings SET date = ? WHERE id = ?", inDays(-1), b0.id);
    assert.equal((await x.post(`/api/bookings/${b0.id}/tips`, { amount: 50 })).status, 404);
    assert.equal((await c.post(`/api/bookings/${b0.id}/tips`, { amount: 2 })).status, 400);
    const tp = await c.post(`/api/bookings/${b0.id}/tips`, { amount: 50, note: "¡Gracias! Llámame al 312-555-0199" });
    assert.equal(tp.json.payment.mode, "simulated");
    await c.post(`/api/tips/${tp.json.tip_id}/simulate-pay`); await c.post(`/api/tips/${tp.json.tip_id}/simulate-pay`);
    const t0 = S.db.get("SELECT * FROM tips WHERE id = ?", tp.json.tip_id);
    assert.equal(t0.status, "paid"); assert.equal(t0.fee_cents, 0); assert.doesNotMatch(t0.note, /555-0199/);
    assert.ok(S.db.all("SELECT kind FROM email_log").some((r) => r.kind === "tip.paid.group"));
    const view = (await o.get(`/api/groups/${g}/bookings`)).json.bookings.find((b) => b.id === b0.id);
    assert.equal(view.tips[0].amount_cents, 5000);
    // no no-show report after tipping; earnings show the tip
    assert.equal((await c.post(`/api/bookings/${b0.id}/noshow`, { note: "They never came to the party at all" })).status, 400);
    const e = (await o.get(`/api/groups/${g}/earnings?year=${inDays(-1).slice(0, 4)}`)).json.earnings;
    assert.equal(e.total.tips_cents, 5000);

    // ---- the morning text ----
    const inv = await o.post(`/api/groups/${g}/team/invite`, {});
    await m.post(`/api/team-invite/${inv.json.url.split("/team/")[1]}/accept`);
    S.db.run("UPDATE bookings SET date = ? WHERE id = ?", inDays(0), rows[1].id); // a gig today
    await c.post("/api/bookings", bookingBody(g, inDays(70), { time: "7:00 PM", hours: 2 })); // nothing new: not paid yet
    const { sendDailyTexts } = await import("../server/jobs.js");
    assert.equal(sendDailyTexts(S.ctx, { hour: 5 }), 0); // too early
    assert.equal(sendDailyTexts(S.ctx, { hour: 7 }), 2); // the owner and the helper
    assert.equal(sendDailyTexts(S.ctx, { hour: 8 }), 0); // once a day
    const texts = S.db.all("SELECT * FROM sms_log WHERE body LIKE '%Hoy:%' OR body LIKE '%Today:%'");
    assert.ok(texts.some((x) => /Hoy: 1 evento \(7:00 PM/.test(x.body) && /por cobrar hoy/.test(x.body)), JSON.stringify(texts));
    assert.ok(texts.some((x) => /Today: 1 gig/.test(x.body)));
    // turned off in Account: no text
    await m.patch("/api/me", { name: "Lupe Helper", phone: "312-555-0102", sms_opt_in: true, daily_text: false });
    S.db.run("UPDATE users SET daily_text_on = ''");
    assert.equal(sendDailyTexts(S.ctx, { hour: 7 }), 1);
  } finally { await S.close(); }
});
