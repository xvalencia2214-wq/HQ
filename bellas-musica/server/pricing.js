import { daysBetween } from "./util.js";

export const SLOTS = ["12:00 PM", "2:00 PM", "4:00 PM", "6:00 PM", "8:00 PM"];
export const EVENT_TYPES = ["Wedding", "Quinceañera", "Birthday", "Anniversary", "Serenata", "Corporate / Restaurant", "Other"];
export const GROUP_TYPES = ["Mariachi", "Banda", "Norteño", "Trío romántico", "Grupera", "Conjunto", "DJ", "Other"];

// Cancellation policies: [minimum days before the event, share of the deposit refunded].
// The first row whose minimum is met applies. Everything is computed on the server.
export const POLICIES = {
  flexible: { rows: [[3, 100]], text: { en: "Full deposit back if you cancel 3+ days before the event. No refund after that.", es: "Depósito completo si cancelas 3 o más días antes del evento. Sin reembolso después." } },
  moderate: { rows: [[7, 100], [3, 50]], text: { en: "Full deposit back 7+ days before, 50% back 3–6 days before, none after that.", es: "Depósito completo 7 o más días antes, 50% de 3 a 6 días antes, nada después." } },
  strict: { rows: [[30, 100], [14, 50]], text: { en: "Full deposit back 30+ days before, 50% back 14–29 days before, none after that.", es: "Depósito completo 30 o más días antes, 50% de 14 a 29 días antes, nada después." } }
};

export function refundPercent(policy, daysBefore) {
  const p = POLICIES[policy] || POLICIES.moderate;
  for (const [minDays, pct] of p.rows) if (daysBefore >= minDays) return pct;
  return 0;
}

// Refund (in cents) owed to the customer if they cancel today.
export function refundForCancel(booking, today) {
  if (booking.payment_status !== "paid") return 0;
  const pct = refundPercent(booking.policy, daysBetween(today, booking.date));
  return Math.floor((booking.deposit_cents * pct) / 100);
}

// Build a quote. `pkg` is a package row or null (hourly). All values integer cents.
export function buildQuote({ group, pkg, hours, distanceMiles, feePct }) {
  const useHours = pkg ? pkg.hours : hours;
  const subtotal = pkg ? pkg.price_cents : group.rate_cents * useHours;
  const travel = distanceMiles != null && distanceMiles > group.travel_miles ? group.travel_fee_cents : 0;
  const total = subtotal + travel;
  const deposit = Math.ceil((total * group.deposit_pct) / 100);
  const platformFee = Math.min(Math.round((total * feePct) / 100), deposit);
  return {
    hours: useHours,
    subtotal_cents: subtotal,
    travel_fee_cents: travel,
    total_cents: total,
    deposit_cents: deposit,
    balance_cents: total - deposit,
    platform_fee_cents: platformFee,
    policy: group.cancel_policy,
    deposit_pct: group.deposit_pct
  };
}
