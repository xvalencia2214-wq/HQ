import crypto from "node:crypto";
import { HttpError, now, str, withLock } from "../util.js";
import { getGroup, isTeam } from "../shared.js";
import { agreementTerms, signaturesOf, termsHash } from "../agreement.js";

// The booking agreement, signed in the app by the family and by the vendor (docs/competitors.md: the big sites only
// offer a printable page or a paid contract tool).
export default function agreementRoutes(ctx, add) {
  const { db, config } = ctx;
  const sideOf = (user, id) => {
    const b = db.get("SELECT * FROM bookings WHERE id = ?", id);
    if (!b) throw new HttpError(404, "Booking not found");
    if (b.customer_id === user.id) return { b, side: "customer" };
    if (isTeam(db, user, getGroup(db, b.group_id))) return { b, side: "group" };
    throw new HttpError(404, "Booking not found");
  };

  add("GET", "/api/bookings/:id/agreement", ({ params, user }) => {
    const { b, side } = sideOf(user, params.id);
    return { side, terms: agreementTerms(b), ...signaturesOf(db, b) };
  }, { auth: true });

  add("POST", "/api/bookings/:id/agreement/sign", ({ params, body, user, ip }) => withLock("booking:" + params.id, async () => {
    const { b, side } = sideOf(user, params.id);
    if (b.status !== "confirmed") throw new HttpError(400, "The agreement can be signed once the booking is confirmed.");
    if (body.agree !== true) throw new HttpError(400, "Tick the box to agree to the terms.");
    const name = str(body.name, "Your full name", { min: 3, max: 80 });
    if (!/\p{L}/u.test(name)) throw new HttpError(400, "Type your full name");
    // the terms the person was looking at must still be the current ones
    const hash = termsHash(b);
    if (body.terms_hash !== hash) throw new HttpError(409, "The booking changed while you were reading. Look it over again before you sign.");
    const ipHash = crypto.createHmac("sha256", config.secret).update(String(ip || "")).digest("hex").slice(0, 32);
    db.run(`INSERT INTO agreement_signs (booking_id, side, user_id, name, terms_hash, ip_hash, signed_at) VALUES (?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT (booking_id, side) DO UPDATE SET user_id = excluded.user_id, name = excluded.name, terms_hash = excluded.terms_hash, ip_hash = excluded.ip_hash, signed_at = excluded.signed_at`,
      b.id, side, user.id, name, hash, ipHash, now());
    return { side, terms: agreementTerms(b), ...signaturesOf(db, b) };
  }), { auth: true });
}
