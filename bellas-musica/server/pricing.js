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

export const balanceCents = (b) => b.total_cents - b.deposit_cents;

// What a customer gets back if they cancel today: the policy's percentage of everything they paid in the app
// (the deposit, plus the balance if they already paid it). A balance paid outside the app is between them and the group.
export function refundParts(booking, today) {
  const pct = refundPercent(booking.policy, daysBetween(today, booking.date));
  const deposit = booking.payment_status === "paid" ? Math.floor((booking.deposit_cents * pct) / 100) : 0;
  const balance = booking.balance_status === "paid" ? Math.floor((balanceCents(booking) * pct) / 100) : 0;
  return { deposit, balance, pct };
}
export function refundForCancel(booking, today) {
  const p = refundParts(booking, today);
  return p.deposit + p.balance;
}

// Add-ons a group can offer on top of its music (flat price per event). Presets are only suggestions shown when a group is set up:
// a DJ gets the lighting and effects list, everyone gets a sound system. The group chooses which to offer and the price (0 = included).
export const ADDON_PRESETS = {
  DJ: [
    { en: "Fog machine", es: "Máquina de humo" },
    { en: "Dance floor lights", es: "Luces para la pista de baile" },
    { en: "Special lighting (uplights, spotlights)", es: "Iluminación especial (uplights, reflectores)" },
    { en: "Visuals and video screen", es: "Visuales y pantalla de video" },
    { en: "Audio and video setup", es: "Equipo de audio y video" },
    { en: "Wireless microphone for speeches", es: "Micrófono inalámbrico para discursos" }
  ],
  _: [{ en: "Sound system", es: "Equipo de sonido" }, { en: "Wireless microphone", es: "Micrófono inalámbrico" }]
};
export const MAX_ADDONS = 12;
export const MAX_HOURS = 8;

// Build a quote. `pkg` is a package row or null (hourly). `addons` are the add-on rows the customer picked. All values integer cents.
export function buildQuote({ group, pkg, hours, distanceMiles, feePct, addons = [] }) {
  const useHours = pkg ? pkg.hours : hours;
  const subtotal = pkg ? pkg.price_cents : group.rate_cents * useHours;
  const travel = distanceMiles != null && distanceMiles > group.travel_miles ? group.travel_fee_cents : 0;
  const addonsCents = addons.reduce((n, a) => n + a.price_cents, 0);
  const total = subtotal + travel + addonsCents;
  const deposit = Math.ceil((total * group.deposit_pct) / 100);
  const platformFee = Math.min(Math.round((total * feePct) / 100), deposit);
  return {
    hours: useHours,
    subtotal_cents: subtotal,
    travel_fee_cents: travel,
    addons: addons.map((a) => ({ id: a.id, name: a.name, price_cents: a.price_cents })),
    addons_cents: addonsCents,
    total_cents: total,
    deposit_cents: deposit,
    balance_cents: total - deposit,
    platform_fee_cents: platformFee,
    policy: group.cancel_policy,
    deposit_pct: group.deposit_pct
  };
}
