import { HttpError, int, now, safeJson, str, todayStr, withLock } from "../util.js";
import { balanceCents } from "../pricing.js";
import { LIVE_SQL, feePctFor, expirePending, getGroup, isBookable, isLive, markBookingPaid, markCartPaid, markPartPaid, newId, requireOwner } from "../shared.js";
import { maskContact } from "./messages.js";

const MIN_PART = 2000;                // $20: the smallest installment or padrino payment (unless less is left)
const MAX_PENDING_PARTS = 3;          // unpaid payment links one person can have open per booking
const MAX_CART = 6;
const MAX_BUNDLE = 5;                 // vendors in one bundle (including the one that creates it)

// Payment plans and padrinos (paying the balance in parts), one checkout for several deposits, and vendor bundles.
export default function payPlusRoutes(ctx, add) {
  const { db, stripe, config } = ctx;


  // ---- the balance in parts ----
  const remaining = (b) => balanceCents(b) - (b.balance_parts_cents || 0);
  const partsOpen = (b) => b.status === "confirmed" && b.payment_status === "paid" && b.balance_status === "unpaid" && b.date >= todayStr() && remaining(b) > 0;

  async function startPart(b, payer, { amount, rest, note = "", payerName }) {
    if (!partsOpen(b)) throw new HttpError(400, b.balance_status === "offline" ? "The vendor already marked the balance as received." : b.balance_status === "paid" ? "The balance is already paid." : "Payments toward the balance open once the vendor confirms, until the day of the event.");
    const left = remaining(b);
    let cents;
    if (rest === true) cents = left;
    else {
      cents = int(amount, "Amount", { min: 1, max: 100000 }) * 100;
      if (cents > left) throw new HttpError(400, `Only $${(left / 100).toFixed(2)} is left to pay.`);
      if (cents < MIN_PART && cents !== left) throw new HttpError(400, "Pay at least $20 at a time (or whatever is left).");
    }
    if (db.get("SELECT COUNT(*) c FROM balance_parts WHERE booking_id = ? AND payer_id = ? AND status = 'pending' AND created_at > ?", b.id, payer.id, now() - 86400).c >= MAX_PENDING_PARTS) throw new HttpError(429, "You have several payments waiting. Finish one first.");
    const group = getGroup(db, b.group_id);
    if (stripe.live && !group.stripe_ready) throw new HttpError(400, "This vendor can't take payments in the app right now.");
    const part = { id: newId("bp"), amount_cents: cents };
    db.run("INSERT INTO balance_parts (id, booking_id, payer_id, payer_name, note, amount_cents, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
      part.id, b.id, payer.id, payerName || payer.name.split(" ")[0], maskContact(str(note, "Note", { max: 60 })).text, cents, now());
    // A one-payment checkout for the whole balance can't be paid any more once parts exist.
    if (stripe.live && b.balance_session_id) { await stripe.expireCheckoutSession(b.balance_session_id).catch(() => {}); db.run("UPDATE bookings SET balance_session_id = '' WHERE id = ?", b.id); }
    if (!stripe.live) return { part_id: part.id, payment: { mode: "simulated", url: `${config.baseUrl}/#/pay/part/${part.id}` } };
    const session = await stripe.checkoutForPart({ part, booking: b, group, successUrl: `${config.baseUrl}/#/booking/${b.id}?part=1`, cancelUrl: `${config.baseUrl}/#/booking/${b.id}` });
    db.run("UPDATE balance_parts SET session_id = ? WHERE id = ?", session.id, part.id);
    return { part_id: part.id, payment: { mode: "stripe", url: session.url } };
  }

  add("POST", "/api/bookings/:id/parts", ({ params, body, user }) => withLock("booking:" + params.id, async () => {
    const b = db.get("SELECT * FROM bookings WHERE id = ?", params.id);
    if (!b || b.customer_id !== user.id) throw new HttpError(404, "Booking not found");
    return startPart(b, user, { amount: body.amount, rest: body.rest });
  }), { auth: true });

  // A padrino pays toward one of the party's vendors through the family link (needs an account so the payment has an owner).
  add("POST", "/api/fp/:token/padrino", ({ params, body, user }) => {
    const p = /^[\w-]{20,40}$/.test(String(params.token)) ? db.get("SELECT * FROM parties WHERE share_token = ?", String(params.token)) : null;
    if (!p) throw new HttpError(404, "This party link isn't valid any more. Ask for a new one.");
    const b = db.get("SELECT * FROM bookings WHERE id = ? AND customer_id = ? AND date = ?", String(body.bookingId || ""), p.customer_id, p.date);
    if (!b) throw new HttpError(404, "That vendor isn't part of this party");
    return withLock("booking:" + b.id, () => startPart(db.get("SELECT * FROM bookings WHERE id = ?", b.id), user, { amount: body.amount, rest: body.rest, note: body.note, payerName: maskContact(str(body.name || user.name.split(" ")[0], "Your name", { min: 1, max: 40 })).text }));
  }, { auth: true });

  const myPart = (user, id) => {
    const p = db.get("SELECT bp.*, b.group_id, b.date, b.time, b.customer_id, g.name AS group_name FROM balance_parts bp JOIN bookings b ON b.id = bp.booking_id JOIN groups g ON g.id = b.group_id WHERE bp.id = ?", String(id));
    if (!p || p.payer_id !== user.id) throw new HttpError(404, "Payment not found");
    return p;
  };
  add("GET", "/api/parts/:id", ({ params, user }) => {
    const p = myPart(user, params.id);
    return { part: { id: p.id, booking_id: p.booking_id, amount_cents: p.amount_cents, status: p.status, group_name: p.group_name, date: p.date, time: p.time, mine: p.customer_id === user.id } };
  }, { auth: true });
  add("POST", "/api/parts/:id/simulate-pay", async ({ params, user }) => {
    if (stripe.live) throw new HttpError(400, "Simulated payments are off");
    const p = myPart(user, params.id);
    const after = await markPartPaid(ctx, p.id, "sim_part_" + p.id);
    if (after.status === "stray") throw new HttpError(409, "This payment was no longer needed, so it was sent back.");
    return { part: { id: after.id, status: after.status, booking_id: p.booking_id, mine: p.customer_id === user.id } };
  }, { auth: true });

  // ---- one checkout for several deposits ----
  const cartRows = (body, user) => {
    if (!Array.isArray(body.bookingIds) || body.bookingIds.length < 2 || body.bookingIds.length > MAX_CART) throw new HttpError(400, `Pick 2 to ${MAX_CART} unpaid bookings`);
    expirePending(db);
    const ids = [...new Set(body.bookingIds.map(String))];
    const rows = ids.map((id) => db.get("SELECT * FROM bookings WHERE id = ? AND customer_id = ?", id, user.id));
    if (rows.some((b) => !b)) throw new HttpError(404, "Booking not found");
    if (rows.some((b) => b.status !== "pending_payment" || b.payment_status !== "unpaid")) throw new HttpError(400, "One of these is no longer waiting for a deposit. Refresh and try again.");
    return { ids, rows, groups: rows.map((b) => getGroup(db, b.group_id)) };
  };
  // What the one checkout would cost, with bundle savings, before it is started (for the button).
  add("POST", "/api/cart/preview", ({ body, user }) => {
    const { rows, groups } = cartRows(body, user);
    const prices = bundlePrices(rows, groups);
    return { amount_cents: rows.reduce((n, b) => n + (prices.get(b.id)?.deposit_cents ?? b.deposit_cents), 0), discount_cents: [...prices.values()].reduce((n, x) => n + x.discount_cents, 0) };
  }, { auth: true });
  add("POST", "/api/cart", ({ body, user }) => withLock("cart-user:" + user.id, async () => {
    const { ids, rows, groups } = cartRows(body, user);
    if (stripe.live && groups.some((g) => !g.stripe_ready || !isBookable(ctx, g))) throw new HttpError(400, "One of these vendors can't take payments right now. Pay the others together and that one on its own.");
    // Each booking's own checkout is closed first so the same deposit can't be paid twice. One that can't be closed was
    // just paid: it is recorded now and the family picks again.
    if (stripe.live) for (const b of rows) if (b.stripe_session_id) {
      try { await stripe.expireCheckoutSession(b.stripe_session_id); }
      catch {
        const s = await stripe.getCheckoutSession(b.stripe_session_id).catch(() => null);
        if (s && s.payment_status === "paid") {
          if (s.amount_total === b.deposit_cents) await markBookingPaid(ctx, b.id, String(s.payment_intent || ""));
          throw new HttpError(409, "One of these deposits was just paid. Refresh and try again.");
        }
      }
    }
    // The bundle prices live in the cart and reach the bookings only when the cart is paid, so a cart that is left
    // unpaid never lowers what a booking costs on its own.
    const prices = bundlePrices(rows, groups);
    const items = rows.map((b) => prices.get(b.id) || { id: b.id, total_cents: b.total_cents, deposit_cents: b.deposit_cents, platform_fee_cents: b.platform_fee_cents, discount_cents: 0, bundle_id: "" });
    const amount = items.reduce((n, x) => n + x.deposit_cents, 0);
    const cart = { id: newId("c"), amount_cents: amount };
    db.run("INSERT INTO carts (id, customer_id, booking_ids, amount_cents, items_json, created_at) VALUES (?, ?, ?, ?, ?, ?)", cart.id, user.id, JSON.stringify(ids), amount, JSON.stringify(items), now());
    if (!stripe.live) return { cart_id: cart.id, amount_cents: amount, payment: { mode: "simulated", url: `${config.baseUrl}/#/pay/cart/${cart.id}` } };
    const lines = rows.map((b, i) => ({ amount: items[i].deposit_cents, name: `Deposit: ${groups[i].name} on ${b.date}` }));
    const session = await stripe.checkoutForCart({ cart, lines, successUrl: `${config.baseUrl}/#/bookings?cart=1`, cancelUrl: `${config.baseUrl}/#/bookings` });
    db.run("UPDATE carts SET session_id = ? WHERE id = ?", session.id, cart.id);
    return { cart_id: cart.id, amount_cents: amount, payment: { mode: "stripe", url: session.url } };
  }), { auth: true });

  const myCart = (user, id) => {
    const c = db.get("SELECT * FROM carts WHERE id = ?", String(id));
    if (!c || c.customer_id !== user.id) throw new HttpError(404, "Not found");
    return c;
  };
  add("GET", "/api/carts/:id", ({ params, user }) => {
    const c = myCart(user, params.id);
    const priced = new Map(safeJson(c.items_json, []).map((x) => [x.id, x]));
    const items = safeJson(c.booking_ids, []).map((id) => db.get("SELECT b.id, b.date, b.time, b.deposit_cents, b.discount_cents, g.name AS group_name FROM bookings b JOIN groups g ON g.id = b.group_id WHERE b.id = ?", id)).filter(Boolean)
      .map((b) => (priced.has(b.id) && c.status !== "paid" ? { ...b, deposit_cents: priced.get(b.id).deposit_cents, discount_cents: priced.get(b.id).discount_cents } : b));
    return { cart: { id: c.id, status: c.status, amount_cents: c.amount_cents, items } };
  }, { auth: true });
  add("POST", "/api/carts/:id/simulate-pay", async ({ params, user }) => {
    if (stripe.live) throw new HttpError(400, "Simulated payments are off");
    const c = myCart(user, params.id);
    await markCartPaid(ctx, c.id, "sim_cart_" + c.id);
    return { ok: true };
  }, { auth: true });

  // ---- bundles: vendors that work together give a discount when all of them are booked for the same day ----
  const activeBundles = (groupId) => db.all(
    `SELECT b.* FROM bundles b JOIN bundle_members m ON m.bundle_id = b.id WHERE m.group_id = ?
       AND NOT EXISTS (SELECT 1 FROM bundle_members x WHERE x.bundle_id = b.id AND x.accepted = 0)`, groupId);
  // The discounted price of each booking that completes an active bundle (all its members, the same day). Nothing is written.
  function bundlePrices(rows, groups) {
    const out = new Map();
    const byGroup = new Map(rows.map((b, i) => [b.group_id, { b, g: groups[i] }]));
    const seen = new Set();
    for (const { b } of byGroup.values()) for (const bun of activeBundles(b.group_id)) {
      if (seen.has(bun.id)) continue; seen.add(bun.id);
      const members = db.all("SELECT group_id FROM bundle_members WHERE bundle_id = ?", bun.id).map((m) => m.group_id);
      if (members.length < 2 || !members.every((gid) => byGroup.has(gid))) continue;
      const items = members.map((gid) => byGroup.get(gid));
      if (new Set(items.map((x) => x.b.date)).size !== 1) continue;            // the same party day
      if (!items.every((x) => isLive(x.g))) continue;
      for (const { b, g } of items) {
        if (out.has(b.id) || b.discount_cents) continue;                      // one discount per booking
        const discount = Math.round(((b.total_cents - b.travel_fee_cents) * bun.discount_pct) / 100);
        const total = b.total_cents - discount;
        const deposit = Math.ceil((total * g.deposit_pct) / 100);
        const fee = Math.min(Math.round((total * feePctFor(g, config)) / 100), deposit);
        out.set(b.id, { id: b.id, total_cents: total, deposit_cents: deposit, platform_fee_cents: fee, discount_cents: discount, bundle_id: bun.id });
      }
    }
    return out;
  }

  const bundleView = (bun, viewerGroup) => {
    const members = db.all("SELECT m.group_id, m.accepted, g.name, g.type FROM bundle_members m JOIN groups g ON g.id = m.group_id WHERE m.bundle_id = ?", bun.id);
    return { id: bun.id, name: bun.name, discount_pct: bun.discount_pct, created_by: bun.created_by, active: members.every((m) => m.accepted), mine_accepted: Boolean(members.find((m) => m.group_id === viewerGroup)?.accepted), members: members.map((m) => ({ id: m.group_id, name: m.name, type: m.type, accepted: Boolean(m.accepted) })) };
  };
  add("GET", "/api/groups/:id/bundles", ({ params, user }) => {
    const g = requireOwner(db, user, params.id);
    return { bundles: db.all("SELECT b.* FROM bundles b JOIN bundle_members m ON m.bundle_id = b.id WHERE m.group_id = ? ORDER BY b.created_at DESC", g.id).map((b) => bundleView(b, g.id)) };
  }, { auth: true });
  add("POST", "/api/groups/:id/bundles", ({ params, body, user }) => {
    const g = requireOwner(db, user, params.id);
    if (db.get("SELECT COUNT(*) c FROM bundles WHERE created_by = ?", g.id).c >= 10) throw new HttpError(400, "At most 10 bundles");
    const name = maskContact(str(body.name, "Bundle name", { min: 3, max: 60 })).text;
    const pct = int(body.discount_pct, "Discount", { min: 5, max: 30 });
    if (!Array.isArray(body.partners) || body.partners.length < 1 || body.partners.length > MAX_BUNDLE - 1) throw new HttpError(400, `Add 1 to ${MAX_BUNDLE - 1} partners`);
    // a partner can be given as its listing id or a link to its page
    const ids = [...new Set(body.partners.map((x) => String(x || "").trim().replace(/^.*(?:#\/group\/|\/g\/)/, "").replace(/[?#].*$/, "")))];
    const partners = ids.map((id) => db.get(`SELECT * FROM groups WHERE id = ? AND ${LIVE_SQL}`, id));
    if (partners.some((x) => !x)) throw new HttpError(400, "One of those listings wasn't found. Paste the link to their page.");
    if (partners.some((x) => x.id === g.id)) throw new HttpError(400, "Add other businesses, not yourself");
    const id = newId("bu");
    db.tx(() => {
      db.run("INSERT INTO bundles (id, name, discount_pct, created_by, created_at) VALUES (?, ?, ?, ?, ?)", id, name, pct, g.id, now());
      db.run("INSERT INTO bundle_members (bundle_id, group_id, accepted) VALUES (?, ?, 1)", id, g.id);
      for (const x of partners) db.run("INSERT INTO bundle_members (bundle_id, group_id, accepted) VALUES (?, ?, ?)", id, x.id, x.owner_id && x.owner_id === g.owner_id ? 1 : 0);
    });
    for (const x of partners) if (x.owner_id && x.owner_id !== g.owner_id) ctx.notify.toGroup(x, "bundle.invite.group", { group: x.name, partner: g.name, bundle: name, pct: String(pct), url: `${config.baseUrl}/#/dashboard?g=${x.id}&tab=extras` });
    return { bundle: bundleView(db.get("SELECT * FROM bundles WHERE id = ?", id), g.id) };
  }, { auth: true });
  add("POST", "/api/bundles/:bid/accept", ({ params, body, user }) => {
    const g = requireOwner(db, user, String(body.groupId || ""));
    if (db.run("UPDATE bundle_members SET accepted = 1 WHERE bundle_id = ? AND group_id = ?", params.bid, g.id).changes === 0) throw new HttpError(404, "Invitation not found");
    return { bundle: bundleView(db.get("SELECT * FROM bundles WHERE id = ?", params.bid), g.id) };
  }, { auth: true });
  // Leaving ends the bundle for everyone (a bundle is all of its members or nothing). Bookings already discounted keep their price.
  add("DELETE", "/api/bundles/:bid", ({ params, query, user }) => {
    const g = requireOwner(db, user, String(query.groupId || ""));
    if (!db.get("SELECT 1 AS x FROM bundle_members WHERE bundle_id = ? AND group_id = ?", params.bid, g.id)) throw new HttpError(404, "Bundle not found");
    db.run("DELETE FROM bundles WHERE id = ?", params.bid);
    return { ok: true };
  }, { auth: true });

  // Public: the active bundles a listing is part of, with the partners (only live ones; a bundle with a hidden partner isn't shown).
  add("GET", "/api/groups/:id/bundle-deals", ({ params }) => {
    const out = [];
    for (const bun of activeBundles(String(params.id))) {
      const v = bundleView(bun, "");
      const live = v.members.map((m) => db.get("SELECT * FROM groups WHERE id = ?", m.id)).every((x) => x && isLive(x));
      if (live) out.push({ id: v.id, name: v.name, discount_pct: v.discount_pct, members: v.members.map(({ id, name, type }) => ({ id, name, type })) });
    }
    return { bundles: out };
  });


}
