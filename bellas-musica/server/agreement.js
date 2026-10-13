import crypto from "node:crypto";
import { durationOf } from "./schedule.js";

// Signing the booking agreement in the app. Each side types its name and ticks "I agree"; we keep who signed, when, from
// which connection (hashed), and a fingerprint of the terms they saw. If the terms change later (a new date, a new price),
// the old signature no longer matches and both sides are asked to sign the new version.
export function agreementTerms(b) {
  return {
    booking: b.id, group: b.group_id, customer: b.name, event: b.event_type, date: b.date, time: b.time, minutes: durationOf(b),
    package: b.package_name || "", guests: b.guests, address: b.address, total_cents: b.total_cents, deposit_cents: b.deposit_cents,
    policy: b.policy, addons: b.addons_json || "[]"
  };
}
export const termsHash = (b) => crypto.createHash("sha256").update(JSON.stringify(agreementTerms(b))).digest("hex");

export function signaturesOf(db, b) {
  const hash = termsHash(b);
  const rows = db.all("SELECT side, name, signed_at, terms_hash FROM agreement_signs WHERE booking_id = ?", b.id);
  const one = (side) => {
    const r = rows.find((x) => x.side === side);
    return r ? { name: r.name, signed_at: r.signed_at, current: r.terms_hash === hash } : null;
  };
  return { customer: one("customer"), group: one("group"), terms_hash: hash };
}
// For booking lists: has each side signed the current version?
export function signedFlags(db, b) {
  const s = signaturesOf(db, b);
  return { customer: Boolean(s.customer && s.customer.current), group: Boolean(s.group && s.group.current) };
}
