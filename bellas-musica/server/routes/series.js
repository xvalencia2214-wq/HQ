// Weekly gigs: a restaurant (or a church, a bar) books the same group every week, 2 to 12 weeks at once, with one checkout
// for all the deposits. Each date is a normal booking (its own balance, reminders, cancellation policy); dates the group
// isn't open are skipped. A group can give a discount on each date booked this way.
import { HttpError, addDays, int, isDate, now, safeJson, str, todayStr, withLock } from "../util.js";
import { normalizePhone } from "../sms.js";
import { expirePending, feePctFor, getGroup, getVisibleGroup, isBookable, isTeam, newId } from "../shared.js";
import { checkStart } from "../schedule.js";
import { MAX_SERIES } from "./payplus.js";

export default function seriesRoutes(ctx, add) {
  const { db, config } = ctx;

  add("POST", "/api/series", ({ body, user }) => withLock("series-user:" + user.id, async () => {
    const g = getVisibleGroup(db, str(body.groupId, "Group", { required: true, max: 80 }), user);
    if (isTeam(db, user, g)) throw new HttpError(400, "You can't book your own group");
    if (!isBookable(ctx, g)) throw new HttpError(400, "This group isn't taking online deposits yet. Send them a message instead.");
    if (body.acceptPolicy !== true) throw new HttpError(400, "Please accept the deposit and cancellation policy");
    if (ctx.email.live && !user.email_verified) throw new HttpError(403, "Please confirm your email address first. We sent you a link; you can ask for another from the banner at the top.", { code: "verify_email" });
    const needs = safeJson(g.needs_json, []);
    if (needs.length && body.acceptNeeds !== true) throw new HttpError(400, "Please confirm you can provide what they need");
    const weeks = int(body.weeks, "Weeks", { min: 2, max: MAX_SERIES });
    const first = body.date;
    if (!isDate(first) || first <= todayStr()) throw new HttpError(400, "Pick a future date");
    const phone = normalizePhone(str(body.phone, "Phone", { required: true, max: 30 }));
    if (!phone) throw new HttpError(400, "Enter a valid US phone number");
    const name = str(body.name, "Name", { required: true, max: 80 }), address = str(body.address, "Event location", { required: true, max: 160 }), message = str(body.message, "Message", { max: 500 });
    expirePending(db);
    if (db.get("SELECT COUNT(*) c FROM bookings WHERE customer_id = ? AND status = 'pending_payment'", user.id).c >= 6) throw new HttpError(429, "You have several unpaid holds. Pay for or cancel them first.");
    // price each date the same way a single booking is priced, and keep the ones the group can do
    const pct = Math.max(0, Math.min(30, g.weekly_discount_pct || 0)), dates = [], skipped = [];
    let r0 = null;
    for (let i = 0; i < weeks; i++) {
      const date = addDays(first, 7 * i);
      const r = ctx.priceRequest({ ...body, date }, { requireSlot: false }, user);
      r0 = r0 || r;
      const at = checkStart(db, g, date, r.time, r.minutes);
      if (at.listed && at.fits) dates.push({ date, r }); else skipped.push(date);
    }
    if (dates.length < 2) throw new HttpError(409, skipped.length ? "The group isn't open at that time on enough of those weeks. Pick another time or ask them about it." : "Pick at least 2 weeks");
    const sid = newId("s"), t = now(), ids = [];
    db.tx(() => {
      db.run("INSERT INTO series (id, customer_id, group_id, weeks, discount_pct, created_at) VALUES (?, ?, ?, ?, ?, ?)", sid, user.id, g.id, dates.length, pct, t);
      for (const { date, r } of dates) {
        const q = r.quote;
        const discount = Math.round(((q.total_cents - q.travel_fee_cents) * pct) / 100);
        const total = q.total_cents - discount;
        const deposit = Math.ceil((total * g.deposit_pct) / 100);
        const fee = Math.min(Math.round((total * feePctFor(g, config)) / 100), deposit);
        const id = newId("b");
        db.run(`INSERT INTO bookings (id, group_id, customer_id, date, time, hours, duration_min, needs_json, package_id, package_name, event_type, guests, event_zip, name, phone, address, message,
            subtotal_cents, travel_fee_cents, addons_json, addons_cents, total_cents, deposit_cents, platform_fee_cents, discount_cents, policy, status, series_id, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending_payment', ?, ?, ?)`,
          id, g.id, user.id, date, r.time, q.hours, r.minutes, JSON.stringify(needs), r.pkg?.id ?? null, r.pkg?.name ?? "", r.event, r.guests, r.eventZip, name, phone, address, message,
          q.subtotal_cents, q.travel_fee_cents, JSON.stringify(q.addons.map((a) => ({ name: a.name, price_cents: a.price_cents }))), q.addons_cents, total, deposit, fee, discount, q.policy, sid, t, t);
        ids.push(id);
      }
    });
    const cart = await ctx.createCart(ids, user);
    db.run("UPDATE series SET cart_id = ? WHERE id = ?", cart.cart_id, sid);
    return { series_id: sid, dates: dates.map((x) => x.date), skipped, discount_pct: pct, cart };
  }), { auth: true });
}
