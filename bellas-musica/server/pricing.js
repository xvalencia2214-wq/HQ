import { daysBetween } from "./util.js";

// The classic afternoon/evening start times (the "weekends" quick fill and older calendars use them).
export const SLOTS = ["12:00 PM", "2:00 PM", "4:00 PM", "6:00 PM", "8:00 PM"];
// Any start time of the day in 15-minute steps: mañanitas at 5:00 AM, a serenata at 11:30 PM. "12:00 AM" is the very start of
// the date (the night between the day before and this one).
export const TIME_STEP = 15;
export const timeLabel = (min) => { const h = Math.floor(min / 60) % 24, m = min % 60; return `${h % 12 || 12}:${String(m).padStart(2, "0")} ${h < 12 ? "AM" : "PM"}`; };
export const timeMin = (s) => {
  const m = /^(\d{1,2}):(\d{2}) (AM|PM)$/.exec(String(s || ""));
  if (!m || Number(m[1]) < 1 || Number(m[1]) > 12 || Number(m[2]) > 59) return -1;
  return ((Number(m[1]) % 12) + (m[3] === "PM" ? 12 : 0)) * 60 + Number(m[2]);
};
export const TIMES = Array.from({ length: 1440 / TIME_STEP }, (_, i) => timeLabel(i * TIME_STEP));
export const isTime = (s) => { const m = timeMin(s); return m >= 0 && m % TIME_STEP === 0 && timeLabel(m) === s; };
// Short sets (a serenata, mañanitas) can be shorter than an hour.
export const SHORT_MINUTES = [15, 20, 30, 45];
export const MAX_CAPACITY = 20;     // how many bookings a listing can serve at the same time (trucks, crews, lineups)
export const EVENT_TYPES = ["Wedding", "Quinceañera", "Birthday", "Anniversary", "Serenata", "Corporate / Restaurant", "Other"];
// Everything a party needs, in one place. Music came first; the other categories use the same listings, calendar, deposits,
// reviews and chat. A listing's category follows from its type ("Other" stays music, as it always was).
export const CATEGORIES = {
  music: ["Mariachi", "Banda", "Norteño", "Trío romántico", "Grupera", "Conjunto", "DJ", "Other"],
  food: ["Food truck", "Taquería / taco catering", "Catering", "Cakes and desserts", "Aguas frescas and drinks"],
  rentals: ["Tents", "Tables and chairs", "Bounce house", "Dance floor and stage", "Linens and tableware"],
  decor: ["Balloon decorations", "Event decorator", "Flowers", "Backdrops and photo walls"],
  photo: ["Photographer", "Videographer", "Photo booth"],
  services: ["Security / bouncer", "Bartender", "Party host / MC", "Kids entertainment", "Quinceañera choreographer", "Hair and makeup", "Clean-up crew"],
  venues: ["Party hall", "Outdoor venue"]
};
export const GROUP_TYPES = Object.values(CATEGORIES).flat();
export const CATEGORY_OF = Object.fromEntries(Object.entries(CATEGORIES).flatMap(([c, types]) => types.map((t) => [t, c])));
export const categoryOf = (type) => CATEGORY_OF[type] || "music";
// Whether a new listing in this category is booked by the hour by default (a tent or a food truck is booked by package).
export const HOURLY_BY_DEFAULT = { music: true, photo: true, services: true, food: false, rentals: false, decor: false, venues: false };

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
// What was paid toward the balance in the app: the parts (payment plan, padrinos), or the whole balance in one payment.
export const balancePaidInApp = (b) => (b.balance_parts_cents > 0 ? b.balance_parts_cents : ["paid", "partial_refund", "refunded"].includes(b.balance_status) ? balanceCents(b) : 0);
// What is still owed on the balance: nothing once it was paid in one payment or the vendor marked it paid outside the app.
export const balanceLeft = (b) => (["paid", "partial_refund", "refunded", "offline"].includes(b.balance_status) ? 0 : Math.max(0, balanceCents(b) - (b.balance_parts_cents || 0)));

// What a customer gets back if they cancel today: the policy's percentage of everything they paid in the app
// (the deposit, plus the balance if they already paid it). A balance paid outside the app is between them and the group.
export function refundParts(booking, today) {
  const pct = refundPercent(booking.policy, daysBetween(today, booking.date));
  const deposit = booking.payment_status === "paid" ? Math.floor((booking.deposit_cents * pct) / 100) : 0;
  const balance = ["paid", "partial_refund"].includes(booking.balance_status) || booking.balance_parts_cents > 0 ? Math.floor((balancePaidInApp(booking) * pct) / 100) : 0;
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
  "Tents": [{ en: "Side walls", es: "Paredes laterales" }, { en: "Lighting inside the tent", es: "Iluminación dentro de la carpa" }, { en: "Heaters", es: "Calentadores" }, { en: "Setup and takedown", es: "Montaje y desmontaje" }],
  "Tables and chairs": [{ en: "Tablecloths", es: "Manteles" }, { en: "Kids' tables and chairs", es: "Mesas y sillas para niños" }, { en: "Delivery and setup", es: "Entrega y montaje" }],
  "Bounce house": [{ en: "Extra hour", es: "Hora extra" }, { en: "Attendant on site", es: "Encargado en el lugar" }, { en: "Generator", es: "Generador" }],
  "Food truck": [{ en: "Extra 50 servings", es: "50 porciones extra" }, { en: "Aguas frescas", es: "Aguas frescas" }],
  "Taquería / taco catering": [{ en: "Extra 50 tacos", es: "50 tacos extra" }, { en: "Aguas frescas", es: "Aguas frescas" }, { en: "Servers", es: "Meseros" }],
  "Balloon decorations": [{ en: "Balloon arch", es: "Arco de globos" }, { en: "Number or letter balloons", es: "Globos de números o letras" }],
  "Event decorator": [{ en: "Centerpieces", es: "Centros de mesa" }, { en: "Backdrop", es: "Telón de fondo" }, { en: "Setup and takedown", es: "Montaje y desmontaje" }],
  "Photo booth": [{ en: "Unlimited prints", es: "Impresiones ilimitadas" }, { en: "Props", es: "Accesorios" }, { en: "Digital gallery", es: "Galería digital" }],
  "Photographer": [{ en: "Second photographer", es: "Segundo fotógrafo" }, { en: "Printed album", es: "Álbum impreso" }],
  _: [{ en: "Sound system", es: "Equipo de sonido" }, { en: "Wireless microphone", es: "Micrófono inalámbrico" }, { en: "Delivery and setup", es: "Entrega y montaje" }]
};
// "What we need from you": ready-made lines a vendor can tap to add (the family confirms them when booking).
export const NEEDS_PRESETS = {
  music: [
    { en: "A power outlet within 50 feet", es: "Un enchufe a menos de 50 pies" },
    { en: "A covered spot if it rains", es: "Un lugar techado si llueve" },
    { en: "Parking near the door for our van", es: "Estacionamiento cerca de la puerta para nuestra camioneta" },
    { en: "A 10x10 ft space to play", es: "Un espacio de 10x10 pies para tocar" },
    { en: "Water for the musicians", es: "Agua para los músicos" }
  ],
  food: [
    { en: "Space to park the truck (about 40 ft)", es: "Espacio para estacionar la troca (unos 40 pies)" },
    { en: "Level ground", es: "Piso parejo" },
    { en: "A power outlet (or we bring a generator)", es: "Un enchufe (o traemos generador)" },
    { en: "A table for serving", es: "Una mesa para servir" }
  ],
  rentals: [
    { en: "Flat ground (grass or concrete)", es: "Piso plano (pasto o concreto)" },
    { en: "A clear path for the delivery truck", es: "Paso libre para la troca de entrega" },
    { en: "OK to stake into the ground", es: "Permiso para clavar estacas en el piso" },
    { en: "Someone there at delivery and pickup", es: "Alguien que nos reciba al entregar y recoger" }
  ],
  decor: [
    { en: "Access to the hall 3 hours before", es: "Acceso al salón 3 horas antes" },
    { en: "A power outlet for the lights", es: "Un enchufe para las luces" },
    { en: "Your colors and theme a week before", es: "Tus colores y tema una semana antes" }
  ],
  photo: [
    { en: "A list of must-have photos", es: "Una lista de las fotos que no pueden faltar" },
    { en: "A seat and a plate for the photographer", es: "Un lugar y un plato para el fotógrafo" }
  ],
  services: [
    { en: "The venue's rules and the guest count", es: "Las reglas del lugar y el número de invitados" },
    { en: "A spot by the door for the guard", es: "Un lugar junto a la puerta para el guardia" }
  ],
  venues: [
    { en: "The final guest count a week before", es: "El número final de invitados una semana antes" },
    { en: "Your decorator's and DJ's arrival times", es: "La hora en que llegan tu decorador y tu DJ" }
  ]
};
export const MAX_NEEDS = 12;
// Holiday serenatas: Mother's Day (May 10, from midnight on) and the Virgen de Guadalupe (December 12, mañanitas at dawn).
export const HOLIDAYS = {
  mothers_day: { month: 5, day: 10, emoji: "🌹" },
  guadalupe: { month: 12, day: 12, emoji: "🌹" }
};
// The next date of a holiday on or after `today` (YYYY-MM-DD).
export function holidayDate(key, today) {
  const h = HOLIDAYS[key];
  if (!h) return "";
  const y = Number(today.slice(0, 4)), md = `${String(h.month).padStart(2, "0")}-${String(h.day).padStart(2, "0")}`;
  return `${y}-${md}` > today ? `${y}-${md}` : `${y + 1}-${md}`;
}
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
