import { HttpError, int, now, str, todayStr } from "../util.js";
import { maskContact } from "./messages.js";

// Only a customer with a confirmed, paid booking whose date has passed can review it, once.
export default function reviewRoutes(ctx, add) {
  const { db } = ctx;
  add("POST", "/api/bookings/:id/review", ({ params, body, user }) => {
    const b = db.get("SELECT * FROM bookings WHERE id = ? AND customer_id = ?", params.id, user.id);
    if (!b) throw new HttpError(404, "Booking not found");
    if (b.status !== "confirmed" || b.date >= todayStr()) throw new HttpError(400, "You can review a booking after the event has happened");
    if (b.payment_status === "unpaid" || b.payment_status === "refunded") throw new HttpError(400, "Only paid bookings can be reviewed");
    if (db.get("SELECT 1 AS x FROM reviews WHERE booking_id = ?", b.id)) throw new HttpError(409, "You already reviewed this booking");
    const rating = int(body.rating, "Rating", { min: 1, max: 5 });
    db.run("INSERT INTO reviews (booking_id, group_id, customer_id, rating, text, created_at) VALUES (?, ?, ?, ?, ?, ?)", b.id, b.group_id, user.id, rating, str(body.text, "Review", { max: 800 }), now());
    return { ok: true };
  }, { auth: true });

  // The group can answer a review once in public (and edit or remove that answer). No contact details in it.
  const ownedReview = (id, user) => {
    const r = db.get("SELECT r.id, r.group_id, g.owner_id FROM reviews r JOIN groups g ON g.id = r.group_id WHERE r.id = ?", id);
    if (!r || r.owner_id !== user.id) throw new HttpError(404, "Review not found");
    return r;
  };
  add("POST", "/api/reviews/:id/reply", ({ params, body, user }) => {
    const r = ownedReview(params.id, user);
    const text = maskContact(str(body.text, "Reply", { min: 2, max: 500 })).text;
    db.run("UPDATE reviews SET reply = ?, reply_at = ? WHERE id = ?", text, now(), r.id);
    return { ok: true, reply: { text, at: now() } };
  }, { auth: true });
  add("DELETE", "/api/reviews/:id/reply", ({ params, user }) => {
    const r = ownedReview(params.id, user);
    db.run("UPDATE reviews SET reply = '', reply_at = 0 WHERE id = ?", r.id);
    return { ok: true };
  }, { auth: true });
}
