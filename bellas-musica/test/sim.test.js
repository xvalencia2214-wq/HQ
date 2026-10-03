// Marketplace simulation: vendors of every kind, families, padrinos and the site owner act at random over a few simulated
// weeks. The clock moves forward (holds expire, events happen, reminders and background jobs run), and after every step
// the money and booking rules are checked, nothing may answer 5xx, and no email or text may contain "undefined"/"NaN".
// Longer runs: SIM_STEPS=1500 SIM_SEEDS=1,2,3,4 node --test test/sim.test.js
import test, { mock } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { startApp, client, fakeStripe, postWebhook } from "./helpers.js";
import { checkInvariants } from "./invariants.js";
import { sendReviewReminders, sendEventReminders, housekeeping } from "../server/jobs.js";
import { expandSilentRequests } from "../server/routes/requests.js";
import { transferCart } from "../server/shared.js";

const rng = (seed) => () => (seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 2 ** 32;
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(64, 1)]).toString("base64");
const PDF = Buffer.from("%PDF-1.4\n% sim\n").toString("base64");
const PW = "correct horse battery";
const SLOTS = ["12:00 PM", "2:00 PM", "4:00 PM", "6:00 PM", "8:00 PM"];
const EVENTS = ["Wedding", "Quinceañera", "Birthday", "Anniversary", "Corporate / Restaurant"];
const BAD_TEXT = /\bundefined\b|\bNaN\b|\[object |\bnull\b|Invalid Date/;

async function simulate({ mode, seed, steps }) {
  const R = rng(seed), pick = (a) => a[Math.floor(R() * a.length)], chance = (p) => R() < p, int = (a, b) => a + Math.floor(R() * (b - a + 1));
  let clock = Date.now();
  const started = clock;
  mock.timers.enable({ apis: ["Date"], now: clock });
  const later = (ms) => { clock += ms; mock.timers.setTime(clock); };
  const day = (n) => { const d = new Date(clock + n * 86400000); return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Chicago", year: "numeric", month: "2-digit", day: "2-digit" }).format(d); };

  // a vendor's own calendar (some vendors connect it), and the weather service
  let busyIcs = "BEGIN:VCALENDAR\r\nEND:VCALENDAR\r\n";
  const side = http.createServer((req, res) => {
    if (req.url.startsWith("/cal")) { res.writeHead(200, { "Content-Type": "text/calendar" }); res.end(busyIcs); return; }
    res.writeHead(200, { "Content-Type": "application/geo+json" });
    if (req.url.startsWith("/points/")) res.end(JSON.stringify({ properties: { forecast: `http://127.0.0.1:${side.address().port}/f` } }));
    else res.end(JSON.stringify({ properties: { periods: [{ name: "Saturday", startTime: `${day(3)}T06:00:00-05:00`, isDaytime: true, temperature: 70, temperatureUnit: "F", shortForecast: "Rain", probabilityOfPrecipitation: { value: 80 } }] } }));
  });
  await new Promise((r) => side.listen(0, r));
  const sideBase = `http://127.0.0.1:${side.address().port}`;
  const fake = mode === "live" ? await fakeStripe() : null;
  const S = await startApp({
    DEMO_SEED: "0", ADMIN_EMAILS: "owner@sim.test", ICS_ALLOW_HTTP: "1", WEATHER_API_BASE: sideBase, RATE_FEEDEVENT: "100000", RATE_CHAT: "100000", RATE_AUTH: "100000",
    ...(fake ? { STRIPE_SECRET_KEY: "sk_test_sim", STRIPE_WEBHOOK_SECRET: "whsec_sim", STRIPE_API_BASE: fake.url } : {})
  });
  const log = [], tally = new Map(), errs = new Map();
  let what = "setup";
  const fail = (msg, extra) => assert.fail(`[${mode} seed ${seed}] ${msg} ${JSON.stringify(extra ?? "").slice(0, 600)}\nlast actions:\n  ${log.slice(-15).join("\n  ")}`);
  // every request goes through here: logs back in after the session expires, and no 5xx is ever acceptable
  function actor(email, name, extra = {}) {
    const c = client(S.base);
    const a = { email, name, c, id: null };
    a.call = async (method, url, body) => {
      let r = await c.raw(method, url, body);
      if (r.status === 401 && a.id) { await c.post("/api/auth/login", { email, password: PW }); r = await c.raw(method, url, body); }
      const key = `${method} ${url.split("?")[0].replace(/\/(?!api\b)[^/]*\d[^/]*/g, "/:x")} ${r.status}`;
      tally.set(key, (tally.get(key) || 0) + 1);
      if (r.status >= 400 && !errs.has(key)) errs.set(key, r.json?.error);
      if (r.status >= 500 && !(fake && fake.state.failRefunds && r.status === 502)) fail(`${method} ${url} -> ${r.status}`, r.json);
      return r;
    };
    a.get = (u) => a.call("GET", u); a.post = (u, b = {}) => a.call("POST", u, b); a.patch = (u, b = {}) => a.call("PATCH", u, b); a.put = (u, b = {}) => a.call("PUT", u, b); a.del = (u) => a.call("DELETE", u);
    a.signup = async () => { const u = await c.signup(email, name, extra); a.id = u.id; return a; };
    return a;
  }
  const anon = actor("", "anon");
  const webhook = (object) => postWebhook(S.base, { id: `evt_${seed}_${Math.floor(R() * 1e12)}`, type: "checkout.session.completed", data: { object: { payment_status: "paid", ...object } } }, "whsec_sim");

  try {
    // ---- people ----
    const admin = await actor("owner@sim.test", "Site Owner").signup();
    const vendors = [];
    const TYPES = [["Mariachi", true], ["Banda", true], ["DJ", true], ["Norteño", true], ["Trío romántico", true], ["Food truck", false], ["Taquería / taco catering", false], ["Tents", false], ["Tables and chairs", false], ["Balloon decorations", false], ["Photographer", true], ["Security / bouncer", true], ["Party hall", false]];
    let refCode = null;
    for (const [i, [type, hourly]] of TYPES.entries()) {
      const v = await actor(`v${i}@sim.test`, `Vendor ${i}`, { phone: `312555${String(1000 + i)}`, sms_opt_in: true, ...(refCode && chance(0.5) ? { ref: refCode } : {}) }).signup();
      const created = await v.post("/api/groups", { name: `${type} Sim ${i}`, type, zip: pick(["60608", "60623", "60632", "60804", "60647"]), members: int(1, 12), ...(hourly ? { rate: int(1, 9) * 50 + 100 } : {}), story: "We have played and served family parties all over Chicago for years. Ask us anything." });
      if (created.status !== 200) fail("vendor create failed", created.json);
      const id = created.json.id;
      await v.patch(`/api/groups/${id}`, { events: EVENTS.filter(() => chance(0.7)).concat("Birthday"), max_guests: int(80, 500), min_hours: hourly && chance(0.4) ? int(2, 4) : 1, cancel_policy: pick(["flexible", "moderate", "strict"]), deposit_pct: pick([20, 25, 30, 50]), weather_policy: chance(0.3) ? "If it rains we bring a tarp." : "" });
      const dates = {};
      for (let d = 1; d <= 30; d++) if (chance(0.6)) dates[day(d)] = SLOTS.filter(() => chance(0.6)).slice(0, 4);
      await v.put(`/api/groups/${id}/availability`, { dates: Object.fromEntries(Object.entries(dates).filter(([, s]) => s.length)) });
      await v.post(`/api/groups/${id}/photos`, { data: PNG });
      for (let k = 0; k < (hourly ? int(0, 2) : int(1, 3)); k++) await v.post(`/api/groups/${id}/packages`, { name: `Package ${k}`, description: "Sim package", hours: int(1, 5), price: int(4, 30) * 50 });
      for (let k = 0; k < int(0, 3); k++) await v.post(`/api/groups/${id}/addons`, { name: `Extra ${k} ${type}`, price: pick([0, 25, 60, 150]) });
      if (fake) { await v.post(`/api/groups/${id}/stripe/onboard`); await v.post(`/api/groups/${id}/stripe/refresh`); }
      const pub = await v.post(`/api/groups/${id}/publish`);
      if (pub.status !== 200) fail("publish failed", pub.json);
      if (!refCode) refCode = (await v.get("/api/my/referral")).json.code;
      vendors.push({ v, id, type, hourly });
    }
    const customers = [];
    for (let i = 0; i < 8; i++) customers.push(await actor(`c${i}@sim.test`, `Cliente ${i} Martinez`, { phone: `773555${2000 + i}`, sms_opt_in: chance(0.5), source: chance(0.3) ? "iglesia" : undefined }).signup());
    const padrinos = [];
    for (let i = 0; i < 3; i++) padrinos.push(await actor(`p${i}@sim.test`, `Padrino ${i}`).signup());
    const family = [0, 1, 2].map(() => actor("", "family"));

    // ---- helpers that look at the server's real state to pick meaningful actions ----
    const q = (sql, ...a) => S.db.all(sql, ...a);
    const one = (sql, ...a) => S.db.get(sql, ...a);
    const ownerOf = (gid) => vendors.find((x) => x.id === gid).v;
    const custById = (uid) => customers.find((c) => c.id === uid) || padrinos.find((c) => c.id === uid);
    const payDeposit = async (bid) => {
      const b = one("SELECT * FROM bookings WHERE id = ?", bid);
      if (fake) { const ev = { amount_total: b.deposit_cents, payment_intent: "pi_sim_" + bid + (chance(0.1) ? "_2" : ""), metadata: { kind: "booking", booking_id: bid } }; await webhook(ev); if (chance(0.2)) await webhook(ev); }
      else await custById(b.customer_id).post(`/api/bookings/${bid}/simulate-pay`);
    };
    const payPart = async (payer, partId) => {
      const p = one("SELECT * FROM balance_parts WHERE id = ?", partId);
      if (fake) await webhook({ amount_total: p.amount_cents, payment_intent: "pi_part_" + partId, metadata: { kind: "part", part_id: partId } });
      else await payer.post(`/api/parts/${partId}/simulate-pay`);
    };
    const openSlot = async (g) => {
      const months = [...new Set([day(1), day(31)].map((d) => d.slice(0, 7)))];
      const opts = [];
      for (const m of months) { const r = await anon.get(`/api/groups/${g.id}/availability?month=${m}`); for (const [d, s] of Object.entries(r.json.days || {})) for (const t of s) opts.push([d, t]); }
      return opts.length ? pick(opts) : null;
    };
    const bookingBodyFor = async (g, d, t) => {
      const pub = (await anon.get(`/api/groups/${g.id}`)).json;
      const usePkg = !pub.hourly || (pub.packages.length && chance(0.5));
      return {
        groupId: g.id, date: d, time: t, event: pick(EVENTS), guests: chance(0.05) ? 99999 : int(20, Math.max(20, pub.max_guests)), eventZip: pick(["60608", "60623", "60402", "77003"]),
        name: "Cliente", phone: "(312) 555-0142", address: "Salón de fiestas, Chicago", message: chance(0.3) ? "Por favor llegar temprano" : "", acceptPolicy: true,
        ...(usePkg && pub.packages.length ? { packageId: pick(pub.packages).id } : { hours: Math.max(pub.min_hours, int(1, 4)) }),
        ...(pub.addons.length && chance(0.5) ? { addonIds: pub.addons.filter(() => chance(0.5)).map((x) => x.id) } : {})
      };
    };
    const jobs = async () => {
      housekeeping(S.ctx); sendReviewReminders(S.ctx); sendEventReminders(S.ctx, { hour: 12 }); expandSilentRequests(S.ctx);
      S.ctx.expireDocuments(); await S.ctx.syncCalendars();
      if (fake) for (const c of q("SELECT DISTINCT cart_id FROM bookings WHERE cart_id != '' AND stripe_transfer_id = ''")) await transferCart(S.ctx, c.cart_id);
    };
    const extraChecks = () => {
      checkInvariants(S.db, fake, log);
      for (const m of q("SELECT kind, subject, body FROM email_log WHERE id > ?", lastMail)) if (BAD_TEXT.test(m.subject) || BAD_TEXT.test(m.body.replace(/<[^>]+>/g, " "))) fail(`email "${m.kind}" has a broken value`, m.subject);
      lastMail = one("SELECT COALESCE(MAX(id), 0) m FROM email_log").m;
      for (const m of q("SELECT body FROM sms_log WHERE id > ?", lastSms)) if (BAD_TEXT.test(m.body)) fail("text message has a broken value", m.body);
      lastSms = one("SELECT COALESCE(MAX(id), 0) m FROM sms_log").m;
      // a booking made while the vendor's calendar said busy
      for (const b of q("SELECT b.id, b.group_id, b.date, b.time, b.created_at FROM bookings b WHERE b.created_at > ? AND b.status IN ('pending_payment','requested','confirmed')", lastCheck)) {
        const [h, mm] = [(Number(b.time.split(":")[0]) % 12) + (b.time.endsWith("PM") ? 12 : 0), 0];
        const st = h * 60 + mm;
        if (one("SELECT 1 AS x FROM ext_busy WHERE group_id = ? AND date = ? AND start_min < ? AND end_min > ?", b.group_id, b.date, st + 120, st) && one("SELECT 1 AS x FROM bookings WHERE id = ? AND resched_count = 0", b.id)) fail("booked a time the vendor's own calendar marked busy", b);
      }
      lastCheck = Math.floor(clock / 1000);
      // bundle discounts only for complete bundles booked together on one day
      // (checked the moment the discount first appears, i.e. when the cart is paid: a partner may agree to move later)
      for (const b of q("SELECT * FROM bookings WHERE discount_cents > 0").filter((x) => !seenDiscount.has(x.id))) {
        seenDiscount.add(b.id);
        const members = q("SELECT group_id FROM bundle_members WHERE bundle_id = ?", b.bundle_id).map((x) => x.group_id);
        if (!b.cart_id) fail("bundle discount outside one checkout", b);
        const inCart = JSON.parse(one("SELECT booking_ids FROM carts WHERE id = ?", b.cart_id).booking_ids);
        if (members.length && !members.every((gid) => inCart.some((id) => one("SELECT 1 AS x FROM bookings WHERE id = ? AND group_id = ? AND date = ?", id, gid, b.date)))) fail("bundle discount without the whole bundle", b);
        if (b.discount_cents >= b.total_cents + b.discount_cents) fail("discount bigger than the price", b);
      }
      // reviews: one per booking, only for paid events that happened
      for (const r of q("SELECT r.*, b.status, b.date, b.payment_status FROM reviews r JOIN bookings b ON b.id = r.booking_id")) if (r.status !== "confirmed" && r.status !== "cancelled") fail("review on a booking that never happened", r);
    };
    let lastMail = 0, lastSms = 0, lastCheck = 0;
    const seenDiscount = new Set();

    // ---- the simulation ----
    for (let i = 0; i < steps; i++) {
      const c = pick(customers), roll = R() * 100;
      if (roll < 12) { // hold a slot with someone
        const g = pick(vendors), slot = await openSlot(g);
        what = `hold ${g.type} ${slot}`;
        if (slot) { const r = await c.post("/api/bookings", await bookingBodyFor(g, ...slot)); if (r.status === 200 && chance(0.75)) { what += " +pay"; await payDeposit(r.json.booking.id); } }
      } else if (roll < 19) { // a whole party day: hold several vendors (often a bundle) for one date, then one checkout
        const bun = chance(0.6) && one("SELECT b.id FROM bundles b WHERE NOT EXISTS (SELECT 1 FROM bundle_members m WHERE m.bundle_id = b.id AND m.accepted = 0) ORDER BY RANDOM() LIMIT 1");
        const team = bun ? q("SELECT group_id FROM bundle_members WHERE bundle_id = ?", bun.id).map((m) => vendors.find((x) => x.id === m.group_id)) : [];
        while (team.length < 2 || (team.length < 4 && chance(0.4))) { const g = pick(vendors); if (!team.includes(g)) team.push(g); }
        const d = day(int(2, 25));
        what = `party day ${d} ${team.map((g) => g.type).join("+")}${bun ? " (bundle)" : ""}`;
        for (const g of team) {
          const open = (await anon.get(`/api/groups/${g.id}/availability?month=${d.slice(0, 7)}`)).json.days?.[d];
          if (open?.length) await c.post("/api/bookings", await bookingBodyFor(g, d, pick(open)));
        }
        const holds = q("SELECT id FROM bookings WHERE customer_id = ? AND status = 'pending_payment' AND payment_status = 'unpaid'", c.id).map((x) => x.id);
        what += ` cart ${holds.length}`;
        if (holds.length >= 2) {
          const r = await c.post("/api/cart", { bookingIds: holds.slice(0, int(2, Math.min(6, holds.length))) });
          if (r.status === 200) {
            if (chance(0.15)) await payDeposit(holds[0]); // one paid on its own meanwhile
            if (fake) await webhook({ amount_total: r.json.amount_cents, payment_intent: "pi_cart_" + r.json.cart_id, metadata: { kind: "cart", cart_id: r.json.cart_id } });
            else await c.post(`/api/carts/${r.json.cart_id}/simulate-pay`);
          }
        }
      } else if (roll < 30) { // vendors answer requests
        const b = pick(q("SELECT id, group_id FROM bookings WHERE status = 'requested'")) || null;
        what = `answer ${b?.id}`;
        if (b) { if (fake) fake.state.failRefunds = chance(0.15); await ownerOf(b.group_id).patch(`/api/bookings/${b.id}`, { action: chance(0.8) ? "accept" : "decline" }); if (fake) fake.state.failRefunds = false; }
      } else if (roll < 37) { // payments toward the balance: the customer or a padrino
        const b = pick(q("SELECT * FROM bookings WHERE status = 'confirmed' AND balance_status = 'unpaid'"));
        what = `part ${b?.id}`;
        if (b) {
          const owner = custById(b.customer_id);
          const left = b.total_cents - b.deposit_cents - b.balance_parts_cents;
          const body = chance(0.3) ? { rest: true } : { amount: Math.max(1, Math.round((left / 100) * R() * 1.1)) };
          let start;
          if (chance(0.5)) start = await owner.post(`/api/bookings/${b.id}/parts`, body);
          else {
            let party = one("SELECT share_token FROM parties WHERE customer_id = ? AND date = ?", b.customer_id, b.date);
            if (!party) { const m = await owner.post("/api/parties", { date: b.date, zip: "60608", template: pick(["quince", "wedding", "birthday", ""]) }); party = m.status === 200 ? { share_token: m.json.party.share_url.split("/fp/")[1] } : null; }
            const pad = pick(padrinos);
            start = party ? await pad.post(`/api/fp/${party.share_token}/padrino`, { ...body, bookingId: b.id, name: pad.name, note: "Padrino" }) : { status: 0 };
            if (start.status === 200) { what += " padrino"; await payPart(pad, start.json.part_id); start = null; }
          }
          if (start && start.status === 200) await payPart(owner, start.json.part_id);
        }
      } else if (roll < 40) { // the whole balance in one payment, or marked paid in cash
        const b = pick(q("SELECT * FROM bookings WHERE status = 'confirmed' AND balance_status = 'unpaid'"));
        what = `balance ${b?.id}`;
        if (b) {
          if (chance(0.3)) await ownerOf(b.group_id).post(`/api/bookings/${b.id}/balance-offline`, { received: true });
          else if (fake) await webhook({ amount_total: b.total_cents - b.deposit_cents, payment_intent: "pi_bal_" + b.id, metadata: { kind: "balance", booking_id: b.id } });
          else { await custById(b.customer_id).post(`/api/bookings/${b.id}/balance`); await custById(b.customer_id).post(`/api/bookings/${b.id}/simulate-pay-balance`); }
        }
      } else if (roll < 46) { // cancellations
        const b = pick(q("SELECT * FROM bookings WHERE status IN ('pending_payment','requested','confirmed')"));
        what = `cancel ${b?.id}`;
        if (b) { if (fake) fake.state.failRefunds = chance(0.2); await (chance(0.7) ? custById(b.customer_id) : ownerOf(b.group_id)).patch(`/api/bookings/${b.id}`, { action: "cancel" }); if (fake) fake.state.failRefunds = false; }
      } else if (roll < 50) { // move the date
        const b = pick(q("SELECT * FROM bookings WHERE status = 'confirmed'"));
        what = `resched ${b?.id}`;
        if (b) {
          if (b.resched_status === "pending") await ownerOf(b.group_id).post(`/api/bookings/${b.id}/reschedule/respond`, { accept: chance(0.6) });
          else { const slot = await openSlot(vendors.find((x) => x.id === b.group_id)); if (slot) await custById(b.customer_id).post(`/api/bookings/${b.id}/reschedule`, { date: slot[0], time: slot[1] }); }
        }
      } else if (roll < 56) { // parties: plan, budget, timeline, family votes and comments, credits page
        const p = one("SELECT * FROM parties WHERE customer_id = ? ORDER BY RANDOM() LIMIT 1", c.id);
        what = `party ${p?.id || "new"}`;
        if (!p) { await c.post("/api/parties", { title: "Fiesta", date: day(int(2, 28)), zip: pick(["60608", "60632"]), guests: int(30, 300), budget: int(1, 20) * 500, template: pick(["quince", "wedding", "birthday", "bautizo", "backyard", "graduation"]) }); }
        else {
          const v = (await c.get(`/api/parties/${p.id}`)).json.party;
          const sub = pick(["budget", "timeline", "pick", "vote", "comment", "credits", "weather", "edit"]);
          what += " " + sub;
          if (sub === "budget") await c.patch(`/api/parties/${p.id}`, { budget: int(0, 40) * 250 });
          if (sub === "timeline") await c.put(`/api/parties/${p.id}/timeline`, { items: Array.from({ length: int(0, 6) }, (_, k) => ({ at: `${String(int(9, 23)).padStart(2, "0")}:${pick(["00", "30"])}`, label: `Paso ${k}`, bookingId: v.vendors.length && chance(0.5) ? pick(v.vendors).id : undefined })) });
          if (sub === "pick") await (chance(0.5) ? c.post(`/api/parties/${p.id}/picks`, { groupId: pick(vendors).id }) : pick(family).post(`/api/fp/${p.share_token}/picks`, { groupId: pick(vendors).id, name: "Prima" }));
          if (sub === "vote" && v.picks.length) await pick(family).post(`/api/fp/${p.share_token}/vote`, { groupId: pick(v.picks).id, voter: `voter-${int(1, 5)}-abcdef` });
          if (sub === "comment") await pick(family).post(`/api/fp/${p.share_token}/comments`, { name: "Tía", text: "¡Me encanta! " + int(1, 999), groupId: v.picks.length && chance(0.5) ? pick(v.picks).id : undefined });
          if (sub === "credits") { await c.patch(`/api/parties/${p.id}`, { credits_public: chance(0.7) }); await anon.get(`/api/thanks/${p.id}`); }
          if (sub === "weather") await c.get(`/api/parties/${p.id}/weather`);
          if (sub === "edit") await c.patch(`/api/parties/${p.id}`, { date: chance(0.2) ? day(int(-2, 30)) : p.date, guests: int(0, 500) });
          const fam = await anon.get(`/api/fp/${p.share_token}`);
          if (fam.status === 200 && (fam.json.party.money || /Salón de fiestas|555-0142/.test(JSON.stringify(fam.json)))) fail("the family link shows private details", fam.json.party);
          const own = (await c.get(`/api/parties/${p.id}`)).json.party;
          const expect = one(`SELECT COALESCE(SUM(total_cents), 0) t FROM bookings WHERE customer_id = ? AND date = ? AND status IN ('requested','confirmed')`, c.id, own.date).t;
          if (own.money.booked_cents !== expect) fail("party budget doesn't match the bookings", { own: own.money, expect });
          // the party page and the bookings page must agree on what is still owed
          const mine = (await c.get("/api/my/bookings")).json.bookings;
          let toPay = 0;
          for (const v of own.vendors.filter((x) => x.status !== "unpaid")) {
            const bv = mine.find((x) => x.id === v.id);
            if (!bv) fail("party vendor missing from my bookings", v);
            toPay += bv.balance_left_cents;
            if (v.status === "confirmed" && v.balance_left_cents !== bv.balance_left_cents) fail("party page and booking page disagree on the balance", { party: v, booking: bv });
          }
          if (own.money.to_pay_cents !== toPay) fail("party 'still to pay' doesn't match the bookings", { money: own.money, toPay });
        }
      } else if (roll < 60) { // get quotes, and vendors answering with offers that get booked
        what = "quotes";
        const r = await c.post("/api/requests", { category: pick(["music", "music", "food", "rentals", "photo"]), event: pick(EVENTS), date: day(int(3, 28)), guests: int(20, 300), hours: int(1, 5), zip: "60608", budgetMax: chance(0.3) ? int(2, 20) * 100 : undefined });
        if (r.status === 200 && r.json.groups.length) {
          const gid = pick(r.json.groups).id, g = vendors.find((x) => x.id === gid);
          if (!g) fail("quote went to an unknown listing", { groups: r.json.groups, ours: vendors.map((x) => x.id) });
          const offer = await g.v.post(`/api/groups/${g.id}/offers`, { customerId: c.id, name: "Oferta especial", hours: int(1, 4), price: int(3, 20) * 50 });
          if (offer.status === 200 && chance(0.5)) { const slot = await openSlot(g); if (slot) { const b = await c.post("/api/bookings", { ...(await bookingBodyFor(g, ...slot)), packageId: offer.json.offer_id }); if (b.status === 200) await payDeposit(b.json.booking.id); } }
        }
      } else if (roll < 63) { // event day: check-in with the customer's code, or the customer confirming arrival
        const b = pick(q("SELECT * FROM bookings WHERE status = 'confirmed' AND date = ? AND checked_in_at = 0", day(0)));
        what = `checkin ${b?.id}`;
        if (b) {
          const view = (await custById(b.customer_id).get("/api/my/bookings")).json.bookings.find((x) => x.id === b.id);
          if (chance(0.7) && view?.checkin_code) await ownerOf(b.group_id).post(`/api/bookings/${b.id}/checkin`, { code: chance(0.85) ? view.checkin_code : "0000" });
          else await custById(b.customer_id).post(`/api/bookings/${b.id}/arrived`);
        }
      } else if (roll < 66) { // after the event: reviews (with photos), replies, no-show reports and the owner's decision
        const b = pick(q("SELECT * FROM bookings WHERE status = 'confirmed' AND date < ?", day(0)));
        what = `after ${b?.id}`;
        if (b) {
          const cu = custById(b.customer_id);
          if (chance(0.7)) { const r = await cu.post(`/api/bookings/${b.id}/review`, { rating: int(1, 5), text: "Muy bien", photos: chance(0.4) ? [PNG] : undefined }); if (r.status === 200 && chance(0.5)) { const rv = one("SELECT id FROM reviews WHERE booking_id = ?", b.id); await ownerOf(b.group_id).post(`/api/reviews/${rv.id}/reply`, { text: "¡Gracias!" }); } }
          else { await cu.post(`/api/bookings/${b.id}/noshow`, { note: "They never came to the party" }); if (chance(0.7)) { if (fake) fake.state.failRefunds = chance(0.2); await admin.post(`/api/admin/bookings/${b.id}/noshow`, { refund: chance(0.6) }); if (fake) fake.state.failRefunds = false; } }
        }
      } else if (roll < 70) { // vendor business tools
        const g = pick(vendors), sub = pick(["doc", "review-doc", "cal", "feed", "pro", "feature", "bundle", "earnings", "site", "pause"]);
        what = `vendor ${g.type} ${sub}`;
        if (sub === "doc") await g.v.post(`/api/groups/${g.id}/documents`, { kind: pick(["insurance", "health_permit", "business_license"]), data: chance(0.9) ? PDF : "bm90IGEgZmlsZQ==" });
        if (sub === "review-doc") { const d = one("SELECT id FROM documents WHERE status = 'pending' LIMIT 1"); if (d) await admin.post(`/api/admin/documents/${d.id}`, { approve: chance(0.7), expires: chance(0.5) ? day(int(-1, 10)) : "", note: "ok" }); }
        if (sub === "cal") {
          const d = day(int(1, 20)), s = int(8, 20);
          busyIcs = `BEGIN:VCALENDAR\r\nBEGIN:VEVENT\r\nDTSTART:${d.replace(/-/g, "")}T${String(s).padStart(2, "0")}0000\r\nDTEND:${d.replace(/-/g, "")}T${String(Math.min(23, s + int(1, 4))).padStart(2, "0")}0000\r\nEND:VEVENT\r\n${chance(0.3) ? `BEGIN:VEVENT\r\nDTSTART;VALUE=DATE:${day(int(1, 20)).replace(/-/g, "")}\r\nEND:VEVENT\r\n` : ""}END:VCALENDAR\r\n`;
          await g.v.put(`/api/groups/${g.id}/calendar-sync/import`, { url: `${sideBase}/cal/${g.id}.ics` });
        }
        if (sub === "feed") { const f = (await g.v.post(`/api/groups/${g.id}/calendar-sync/feed`)).json.sync.feed_url; const r = await fetch(f.replace(/^https?:\/\/[^/]+/, S.base)); const t = await r.text(); if (r.status !== 200 || BAD_TEXT.test(t)) fail("calendar feed broken", t.slice(0, 300)); }
        if (sub === "pro" || sub === "feature") { const r = await g.v.post(`/api/groups/${g.id}/${sub}`); if (r.status === 200) { if (fake) { const f = one("SELECT amount_cents FROM payments_feature WHERE id = ?", r.json.id); await webhook({ amount_total: f.amount_cents, payment_intent: "pi_f_" + r.json.id, metadata: { kind: "feature", feature_id: r.json.id } }); } else await g.v.post(`/api/feature/${r.json.id}/simulate-pay`); } }
        if (sub === "bundle") {
          const mine = one("SELECT b.id, b.created_by FROM bundles b JOIN bundle_members m ON m.bundle_id = b.id WHERE m.group_id = ? AND m.accepted = 0", g.id);
          if (mine) await g.v.post(`/api/bundles/${mine.id}/accept`, { groupId: g.id });
          else if (chance(0.7)) {
            const partners = vendors.filter((x) => x.id !== g.id && chance(0.2)).slice(0, 2);
            if (!partners.length) partners.push(pick(vendors.filter((x) => x.id !== g.id)));
            const r = await g.v.post(`/api/groups/${g.id}/bundles`, { name: "Combo de fiesta", discount_pct: int(5, 20), partners: partners.map((x) => x.id) });
            if (r.status === 200) for (const x of partners) if (chance(0.85)) await x.v.post(`/api/bundles/${r.json.bundle.id}/accept`, { groupId: x.id });
          }
          else { const b = one("SELECT bundle_id FROM bundle_members WHERE group_id = ?", g.id); if (b) await g.v.del(`/api/bundles/${b.bundle_id}?groupId=${g.id}`); }
        }
        if (sub === "earnings") { await g.v.get(`/api/groups/${g.id}/earnings`); const r = await g.v.call("GET", `/api/groups/${g.id}/earnings.csv`); if (r.status !== 200) fail("earnings csv", r.status); }
        if (sub === "site") { const r = await fetch(`${S.base}/v/${g.id}`); const t = await r.text(); if (r.status === 200 && BAD_TEXT.test(t.replace(/<[^>]+>/g, " "))) fail("website page has a broken value", t.match(BAD_TEXT)?.[0]); }
        if (sub === "pause") await g.v.post(`/api/groups/${g.id}/pause`, { paused: chance(0.3) });
      } else if (roll < 74) { // browsing: search every category, Discover, Plan a party, price guide, public pages
        const sub = pick(["search", "feed", "guide", "group", "share", "landing", "sitemap"]);
        what = `browse ${sub}`;
        if (sub === "search") { const r = await anon.get(`/api/search?zip=${pick(["60608", "60623", "60402"])}&category=${pick(["all", "music", "food", "rentals", "decor", "photo", "services", "venues"])}${chance(0.5) ? "&date=" + day(int(1, 30)) : ""}${chance(0.3) ? "&soon=1" : ""}${chance(0.3) ? "&sort=price" : ""}`); if (r.status === 200 && BAD_TEXT.test(JSON.stringify(r.json.results.map((x) => [x.name, x.from_cents])))) fail("search result has a broken value", r.json.results[0]); }
        if (sub === "feed") await anon.get(`/api/feed?zip=60608&category=${pick(["all", "music", "food"])}&page=${int(0, 2)}`);
        if (sub === "guide") await anon.get(`/api/price-guide?category=${pick(["music", "food", "rentals", "decor"])}`);
        if (sub === "group") { const g = pick(vendors); const r = await anon.get(`/api/groups/${g.id}`); if (r.status === 200 && BAD_TEXT.test(JSON.stringify([r.json.name, r.json.packages, r.json.addons]))) fail("group page has a broken value", r.json); await anon.get(`/api/groups/${g.id}/bundle-deals`); }
        if (sub === "share") { const r = await fetch(`${S.base}/g/${pick(vendors).id}`); if (r.status >= 500) fail("share page 5xx", r.status); }
        if (sub === "landing") { const r = await fetch(`${S.base}/chicago/${pick(["pilsen", "little-village", "cicero"])}${chance(0.5) ? "/quinceanera" : ""}`); if (r.status >= 500) fail("landing 5xx", r.status); }
        if (sub === "sitemap") { const r = await fetch(`${S.base}/sitemap.xml`); if (r.status !== 200) fail("sitemap", r.status); }
      } else if (roll < 77) { // chat
        const g = pick(vendors);
        what = `chat ${g.type}`;
        await c.post(`/api/groups/${g.id}/messages`, { text: chance(0.3) ? "Llámame al 312-555-0100" : "¿Tienen disponible?" });
        if (chance(0.6)) await g.v.post(`/api/groups/${g.id}/threads/${c.id}`, { text: "¡Claro que sí!" });
      } else { // time passes; background jobs run
        const hours = pick([1, 2, 3, 6, 12, 24]);
        what = `+${hours}h`;
        later(hours * 3600_000);
        await jobs();
      }
      log.push(what);
      extraChecks();
      if (i % 25 === 0) for (const cu of customers) for (const bv of (await cu.get("/api/my/bookings")).json.bookings) {
        const b = one("SELECT * FROM bookings WHERE id = ?", bv.id);
        if (bv.balance_left_cents < 0 || bv.balance_paid_cents < 0 || bv.balance_left_cents > b.total_cents - b.deposit_cents) fail("booking page shows an impossible balance", bv);
        if (b.status === "confirmed" && b.balance_status === "unpaid" && b.deposit_cents + bv.balance_paid_cents + bv.balance_left_cents !== b.total_cents) fail("deposit + paid + left is not the total", { bv, b });
      }
    }
    const stats = one(`SELECT (SELECT COUNT(*) FROM bookings) bookings, (SELECT COUNT(*) FROM bookings WHERE status = 'confirmed') confirmed, (SELECT COUNT(*) FROM parties) parties,
      (SELECT COUNT(*) FROM balance_parts WHERE status IN ('paid','partial_refund','refunded')) parts, (SELECT COUNT(*) FROM carts WHERE status = 'paid') carts, (SELECT COUNT(*) FROM reviews) reviews,
      (SELECT COUNT(*) FROM bookings WHERE discount_cents > 0) bundled, (SELECT COUNT(*) FROM bookings WHERE checked_in_at > 0) checkins, (SELECT COUNT(*) FROM documents) docs, (SELECT COUNT(*) FROM ext_busy) busy,
      (SELECT COUNT(*) FROM email_log) emails`);
    if (process.env.SIM_TALLY) console.log([...tally].sort().map(([k, n]) => `${n}\t${k}\t${errs.get(k) || ""}`).join("\n"));
    return `${Math.round((clock - started) / 86400000)} days simulated | ` + Object.entries(stats).map(([k, v]) => `${k}:${v}`).join(" ");
  } finally { await S.close(); side.close(); if (fake) await fake.close(); mock.timers.reset(); }
}

const STEPS = Number(process.env.SIM_STEPS || 350);
const SEEDS = (process.env.SIM_SEEDS || "11,42").split(",").map(Number);
for (const mode of ["simulated", "live"]) {
  test(`marketplace simulation (${mode} payments): ${SEEDS.length} seeds x ${STEPS} steps, clock moving forward`, { timeout: 1_800_000 }, async () => {
    for (const seed of SEEDS) console.log(`  ${mode} seed ${seed}: ${await simulate({ mode, seed, steps: STEPS })}`);
  });
}
