// Test drive: `npm run tryout` starts the app on its own practice database with ready-made accounts and a party already
// in progress, so every feature can be tried by clicking around. Nothing here touches the real data folder.
//   npm run tryout              start (sets everything up the first time)
//   npm run tryout -- --reset   throw the practice data away and start over
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dataDir = path.join(root, "data-tryout");
if (process.argv.includes("--reset")) fs.rmSync(dataDir, { recursive: true, force: true });
const PASSWORD = "fiesta2026";
const OWNER = "dueno@prueba.com";
process.env.DATA_DIR = dataDir;
process.env.ADMIN_EMAILS = [process.env.ADMIN_EMAILS, OWNER].filter(Boolean).join(",");
for (const k of ["STRIPE_SECRET_KEY", "TWILIO_ACCOUNT_SID", "RESEND_API_KEY"]) delete process.env[k]; // practice money and messages only

const { loadConfig } = await import("./config.js");
const { createApp } = await import("./app.js");
const { todayStr, addDays } = await import("./util.js");
const { categoryOf } = await import("./pricing.js");

const config = loadConfig();
const app = createApp(config);
const busy = (e) => {
  if (e && e.code !== "EADDRINUSE") throw e;
  console.error(`\nPort ${config.port} is already in use: Bella's Música (or another program) is already running in another window.\nClose that window first (or press Ctrl+C in it), then try again.\n`);
  process.exit(1);
};
const port = await app.listen().catch(busy);
const base = `http://127.0.0.1:${port}`;
const db = app.ctx.db;
const PHOTO = fs.readFileSync(path.join(root, "public", "og.png")).toString("base64");

function person() {
  let cookie = "";
  const call = async (method, url, body) => {
    const res = await fetch(base + url, { method, headers: { ...(body ? { "Content-Type": "application/json" } : {}), ...(cookie ? { Cookie: cookie } : {}) }, body: body ? JSON.stringify(body) : undefined });
    const set = res.headers.get("set-cookie");
    if (set) cookie = set.split(";")[0];
    const json = await res.json().catch(() => null);
    if (res.status >= 400) throw new Error(`${method} ${url}: ${json?.error || res.status}`);
    return json;
  };
  return { get: (u) => call("GET", u), post: (u, b = {}) => call("POST", u, b), put: (u, b = {}) => call("PUT", u, b), patch: (u, b = {}) => call("PATCH", u, b) };
}
async function signup(email, name, extra = {}) {
  const p = person();
  await p.post("/api/auth/register", { email, name, password: PASSWORD, phone: "(312) 555-01" + String(10 + Math.floor(Math.random() * 89)), ...extra });
  return p;
}
const next60 = (slots) => Object.fromEntries(Array.from({ length: 60 }, (_, i) => [addDays(todayStr(), i + 1), slots]));
async function listing(owner, info, { packages = [], addons = [], slots = ["12:00 PM", "2:00 PM", "4:00 PM", "6:00 PM", "8:00 PM"] } = {}) {
  const { id } = await owner.post("/api/groups", info.create);
  await owner.patch(`/api/groups/${id}`, info.patch);
  await owner.put(`/api/groups/${id}/availability`, { dates: next60(slots) });
  await owner.post(`/api/groups/${id}/photos`, { data: PHOTO });
  for (const [name, description, hours, price] of packages) await owner.post(`/api/groups/${id}/packages`, { name, description, hours, price });
  for (const [name, description, price] of addons) await owner.post(`/api/groups/${id}/addons`, { name, description, price });
  await owner.post(`/api/groups/${id}/publish`);
  return id;
}
const booking = (groupId, date, time, more) => ({ groupId, date, time, event: "Quinceañera", guests: 150, eventZip: "60608", name: "Rosa Martínez", phone: "(312) 555-0142", address: "Salón Los Arcos, 2500 S Laramie Ave, Cicero", message: "", acceptPolicy: true, acceptNeeds: true, ...more });

let payLinkUrl = "";
async function setUp() {
  console.log("Setting up the practice accounts and a party in progress...");
  const owner = await signup(OWNER, "Dueño de Bella's");
  const dj = await signup("dj@prueba.com", "Beto Ramírez", { sms_opt_in: true });
  const carpas = await signup("carpas@prueba.com", "Lupe Torres");
  const mariachi = await signup("mariachi@prueba.com", "Chuy Hernández", { sms_opt_in: true });
  const familia = await signup("familia@prueba.com", "Rosa Martínez");
  const padrino = await signup("padrino@prueba.com", "Tío Juan Martínez");
  const ayudante = await signup("ayudante@prueba.com", "Memo Ramírez");
  const restaurante = await signup("restaurante@prueba.com", "Restaurante El Sol");

  // ---- three vendors: a DJ with every setup add-on, a tent company and a mariachi ----
  const djId = await listing(dj, {
    create: { name: "DJ Relámpago", type: "DJ", zip: "60623", members: 2, rate: 150, story: "Cumbias, banda, reggaetón and the classics. We read the crowd and keep the dance floor full all night." },
    patch: { events: ["Quinceañera", "Wedding", "Birthday", "Anniversary"], max_guests: 400, min_hours: 3, deposit_pct: 25, cancel_policy: "moderate", weather_policy: "Outdoor parties: we bring a canopy for the equipment. Heavy rain or lightning: we move inside or pick a new date together." }
  }, { addons: [["Fog machine", "Low fog for the first dance", 75], ["Dance floor lights", "Moving lights and lasers", 100], ["Special lighting (uplights, spotlights)", "Uplights around the hall in your colors", 150], ["Visuals and video screen", "Big screen with your photos and videos", 200], ["Audio and video setup", "Mics, speakers and a projector for the speeches", 250]], slots: ["12:00 PM", "2:00 PM", "4:00 PM", "6:00 PM-11:00 PM"] });
  const carpasId = await listing(carpas, {
    create: { name: "Carpas Lupe", type: "Tents", zip: "60629", members: 4, story: "Tents for backyard parties from 20x20 to 40x80, delivered, staked and taken down by our crew, rain or shine." },
    patch: { events: ["Quinceañera", "Wedding", "Birthday", "Anniversary"], max_guests: 300, deposit_pct: 30, cancel_policy: "flexible" }
  }, { packages: [["20x20 tent (40 guests)", "Delivery, setup and takedown", 1, 350], ["20x40 tent (80 guests)", "Delivery, setup and takedown", 1, 600], ["40x60 tent (150 guests)", "With sidewalls and lights", 1, 1200]], addons: [["Sidewalls", "For cold or windy days", 120], ["Heaters", "Two patio heaters", 150]] });
  const mariachiId = await listing(mariachi, {
    create: { name: "Mariachi Sol de Jalisco", type: "Mariachi", zip: "60608", members: 8, rate: 350, story: "Eight musicians in traje de charro. Las Mañanitas, the vals for the quinceañera and every classic you ask for." },
    patch: { events: ["Quinceañera", "Wedding", "Birthday", "Serenata"], max_guests: 500, min_hours: 2, deposit_pct: 25, cancel_policy: "moderate" }
  }, { addons: [["Extra violinist", "A ninth musician for a fuller sound", 150]], slots: ["5:00 AM", "6:00 AM", "12:00 PM", "2:00 PM", "4:00 PM", "6:00 PM-11:30 PM"] });

  // Pro for the DJ (paid with practice money), a bundle between the tents and the mariachi, a license waiting for review
  const pro = await dj.post(`/api/groups/${djId}/pro`);
  await dj.post(`/api/feature/${pro.id}/simulate-pay`);
  const bun = await carpas.post(`/api/groups/${carpasId}/bundles`, { name: "Quinceañera en el patio: carpa + mariachi", discount_pct: 10, partners: [mariachiId] });
  await mariachi.post(`/api/bundles/${bun.bundle.id}/accept`, { groupId: mariachiId });
  await carpas.post(`/api/groups/${carpasId}/documents`, { kind: "insurance", data: Buffer.from("%PDF-1.4\n% practice insurance certificate\n").toString("base64") });

  // ---- the business tools ----
  // the DJ has two setups (two parties at once) and needs 30 minutes to get from one to the next
  await dj.patch(`/api/groups/${djId}`, { capacity: 2, buffer_min: 30, needs: ["A power outlet within 50 feet", "A covered spot if it rains", "Parking near the door for our van"] });
  await carpas.patch(`/api/groups/${carpasId}`, { needs: ["Flat ground (grass or concrete)", "OK to stake into the ground", "Someone there at delivery and pickup"] });
  await mariachi.patch(`/api/groups/${mariachiId}`, { needs: ["A 10x10 ft space to play", "Water for the musicians"] });
  // a 20-minute serenata, and the holiday serenatas
  await mariachi.post(`/api/groups/${mariachiId}/packages`, { name: "Serenata (3 canciones)", description: "Las Mañanitas and two songs you pick", minutes: 20, price: 250 });
  await mariachi.post(`/api/groups/${mariachiId}/specials`, { holiday: "mothers_day", minutes: 20, price: 250, from: "12:00 AM", to: "11:30 PM" });
  await mariachi.post(`/api/groups/${mariachiId}/specials`, { holiday: "guadalupe", minutes: 30, price: 300, from: "12:00 AM", to: "7:00 AM" });
  // the crews
  for (const c of [["Toño Ramírez", "Lights", "773-555-0141", 120], ["Memo Ramírez", "Speakers and setup", "773-555-0142", 100]]) await dj.post(`/api/groups/${djId}/crew`, { name: c[0], role: c[1], phone: c[2], pay: c[3] });
  for (const c of [["Juan Trompeta", "Trumpet", "773-555-0151", 150], ["Pedro Violín", "Violin", "773-555-0152", 150], ["Chava Guitarrón", "Guitarrón", "773-555-0153", 150]]) await mariachi.post(`/api/groups/${mariachiId}/crew`, { name: c[0], role: c[1], phone: c[2], pay: c[3] });
  // Memo helps run the DJ's business (team login)
  const inv = await dj.post(`/api/groups/${djId}/team/invite`, { email: "ayudante@prueba.com" });
  await ayudante.post(`/api/team-invite/${inv.url.split("/team/")[1]}/accept`);
  // an open payment link the DJ sent a client it found on WhatsApp
  const link = await dj.post(`/api/groups/${djId}/paylinks`, { clientName: "Karla Gómez", title: "Boda de Karla", date: addDays(todayStr(), 10), time: "7:30 PM", hours: 5, event: "Wedding", guests: 200, eventZip: "60402", address: "Salón Real, Berwyn", total: 1500, depositPct: 50, days: 7, note: "¡Gracias por elegirnos! Incluye luces y humo." });
  payLinkUrl = link.url;

  // ---- the family's party, three weeks out ----
  // about three weeks out, on the day the most kinds of sample vendors are open (so every section of the party page has choices)
  const kinds = (d) => new Set(db.all("SELECT g.type FROM availability a JOIN groups g ON g.id = a.group_id WHERE g.demo = 1 AND a.date = ?", d).map((r) => categoryOf(r.type))).size;
  const day = Array.from({ length: 15 }, (_, i) => addDays(todayStr(), 16 + i)).reduce((best, d) => (kinds(d) > kinds(best) ? d : best));
  const { party } = await familia.post("/api/parties", { title: "Quinceañera de Sofía", event: "Quinceañera", date: day, zip: "60804", guests: 150, budget: 8000, template: "quince" });
  const token = party.share_url.split("/fp/")[1];
  // the DJ is booked with fog and dance lights, the deposit paid and the DJ confirmed
  const djPub = await familia.get(`/api/groups/${djId}`);
  const addonIds = djPub.addons.filter((a) => /Fog|Dance floor/.test(a.name)).map((a) => a.id);
  const b1 = (await familia.post("/api/bookings", booking(djId, day, "6:00 PM", { hours: 5, addonIds, message: "Sofía's vals at 8:30, please!" }))).booking;
  await familia.post(`/api/bookings/${b1.id}/simulate-pay`);
  await dj.patch(`/api/bookings/${b1.id}`, { action: "accept" });
  // the DJ's lineup for Sofía's party
  const djCrew = (await dj.get(`/api/groups/${djId}/crew`)).crew;
  await dj.put(`/api/bookings/${b1.id}/lineup`, { members: djCrew.map((c) => ({ crewId: c.id })) });
  // a payment plan: the family paid $100 toward the balance and Tío Juan paid $200 as padrino through the family link
  const part = await familia.post(`/api/bookings/${b1.id}/parts`, { amount: 100 });
  await familia.post(`/api/parts/${part.part_id}/simulate-pay`);
  const pad = await padrino.post(`/api/fp/${token}/padrino`, { bookingId: b1.id, amount: 200, name: "Tío Juan", note: "¡Para la música de mi sobrina!" });
  await padrino.post(`/api/parts/${pad.part_id}/simulate-pay`);
  // tent and mariachi held for the same day, not paid yet: "Pay all at once" shows the bundle savings
  const tentPkg = (await familia.get(`/api/groups/${carpasId}`)).packages.find((p) => /40x60/.test(p.name)).id;
  await familia.post("/api/bookings", booking(carpasId, day, "12:00 PM", { packageId: tentPkg }));
  await familia.post("/api/bookings", booking(mariachiId, day, "4:00 PM", { hours: 2 }));
  // the day-of timeline, family ideas and votes
  await familia.put(`/api/parties/${party.id}/timeline`, { items: [{ at: "12:00", label: "Tent goes up" }, { at: "16:00", label: "Mariachi: Las Mañanitas" }, { at: "18:00", label: "DJ starts", bookingId: b1.id }, { at: "20:30", label: "Vals de Sofía" }, { at: "21:00", label: "Cake" }] });
  const prima = person();
  await prima.post(`/api/fp/${token}/picks`, { groupId: "tacos-el-guero-food-truck", name: "Prima Daniela" });
  await prima.post(`/api/fp/${token}/vote`, { groupId: "tacos-el-guero-food-truck", voter: "prima-daniela-voter-1" });
  await prima.post(`/api/fp/${token}/comments`, { name: "Tía Carmen", text: "¡Los tacos de El Güero son los mejores! Yo voto por ellos." });
  await familia.post(`/api/groups/${carpasId}/messages`, { text: "Hola, ¿la carpa de 40x60 trae luces?" });

  // ---- a party that already happened (the DJ played Rosa's birthday last week): ready for a review with photos ----
  const past = (await familia.post("/api/bookings", booking(djId, addDays(todayStr(), 30), "8:00 PM", { hours: 3, event: "Birthday", guests: 60 }))).booking;
  await familia.post(`/api/bookings/${past.id}/simulate-pay`);
  await dj.patch(`/api/bookings/${past.id}`, { action: "accept" });
  db.run("UPDATE bookings SET date = ?, checked_in_at = ? WHERE id = ?", addDays(todayStr(), -7), Math.floor(Date.now() / 1000) - 7 * 86400, past.id);

  // ---- a party happening today (a baptism the DJ is playing): try "one more hour" ----
  const today = (await familia.post("/api/bookings", booking(djId, addDays(todayStr(), 40), "2:00 PM", { hours: 3, event: "Other", guests: 80, message: "Bautizo de Mateo" }))).booking;
  await familia.post(`/api/bookings/${today.id}/simulate-pay`);
  await dj.patch(`/api/bookings/${today.id}`, { action: "accept" });
  db.run("UPDATE bookings SET date = ? WHERE id = ?", todayStr(), today.id);

  // ---- a restaurant books the mariachi every Friday for 6 weeks (10% off each week); last Friday already happened ----
  await mariachi.patch(`/api/groups/${mariachiId}`, { weekly_discount_pct: 10, events: ["Quinceañera", "Wedding", "Birthday", "Serenata", "Corporate / Restaurant"] });
  const friday = (() => { let d = addDays(todayStr(), 1); while (new Date(d + "T12:00:00Z").getUTCDay() !== 5) d = addDays(d, 1); return d; })();
  const weekly = await restaurante.post("/api/series", booking(mariachiId, friday, "7:00 PM", { hours: 2, event: "Corporate / Restaurant", guests: 120, eventZip: "60608", name: "Restaurante El Sol", phone: "(312) 555-0177", address: "Restaurante El Sol, 1800 W Cermak Rd, Chicago", weeks: 6 }));
  await restaurante.post(`/api/carts/${weekly.cart.cart_id}/simulate-pay`);
  for (const b of db.all("SELECT id, date FROM bookings WHERE series_id = ?", weekly.series_id)) {
    await mariachi.patch(`/api/bookings/${b.id}`, { action: "accept" });
    db.run("UPDATE bookings SET date = ? WHERE id = ?", addDays(b.date, -7), b.id); // shift back a week: the first Friday is past
  }
  const firstFriday = db.get("SELECT id FROM bookings WHERE series_id = ? ORDER BY date LIMIT 1", weekly.series_id);
  const tip = await restaurante.post(`/api/bookings/${firstFriday.id}/tips`, { amount: 50, note: "¡Los clientes los aman! Gracias." });
  await restaurante.post(`/api/tips/${tip.tip_id}/simulate-pay`);

  // ---- a new request waiting for the DJ to accept or decline ----
  const req = (await padrino.post("/api/bookings", booking(djId, addDays(todayStr(), 35), "8:00 PM", { hours: 4, event: "Anniversary", guests: 90, name: "Juan Martínez", address: "Casa de Juan, Berwyn" }))).booking;
  await padrino.post(`/api/bookings/${req.id}/simulate-pay`);
  console.log("Done.\n");
}

if (!db.get("SELECT 1 AS x FROM users WHERE email = ?", OWNER)) {
  try { await setUp(); }
  catch (e) { console.error("Setting up the practice data failed:", e.message, "\nTry: npm run tryout -- --reset"); }
} else if (!db.get("SELECT 1 AS x FROM users WHERE email = 'restaurante@prueba.com'")) {
  console.log("\nThis practice data is from an earlier version. To see the newest tools, start over with:  npm run tryout -- --reset\n");
}
if (!payLinkUrl) { const l = db.get("SELECT 1 AS x FROM pay_links WHERE status = 'open'"); payLinkUrl = l ? "(open My business as dj@prueba.com to copy it)" : ""; }

// the vendors' morning text (texts are pretend here, so show what it says)
const { sendDailyTexts } = await import("./jobs.js");
db.run("UPDATE users SET daily_text_on = '' WHERE email IN ('dj@prueba.com', 'mariachi@prueba.com')");
const since = Math.floor(Date.now() / 1000) - 5;
sendDailyTexts(app.ctx, { hour: 8 });
const morning = db.all("SELECT body FROM sms_log WHERE created_at >= ? AND (body LIKE 'Today:%' OR body LIKE 'Hoy:%' OR body LIKE '%Today:%' OR body LIKE '%Hoy:%')", since).map((r) => "  " + r.body.replace(/\n/g, " ")).slice(0, 2);

const url = config.baseUrl;
console.log(`Bella's Música TEST DRIVE is running: open ${url}
(practice money only; nothing here is real. Stop with Ctrl+C. Start over with: npm run tryout -- --reset)

Every password: ${PASSWORD}

  familia@prueba.com    Rosa, the mom planning Sofía's quinceañera
  padrino@prueba.com    Tío Juan, a padrino (also asked the DJ for his anniversary)
  dj@prueba.com         DJ Relámpago: fog, lights, visuals, audio/video add-ons, 3-hour minimum, Pro, two setups at once
  ayudante@prueba.com   Memo, the DJ's helper (team login)
  carpas@prueba.com     Carpas Lupe: tents, in a bundle with the mariachi
  mariachi@prueba.com   Mariachi Sol de Jalisco: 2-hour minimum, plays every Friday at a restaurant
  restaurante@prueba.com  Restaurante El Sol: books the mariachi every Friday (weekly gigs, tips)
  ${OWNER.padEnd(21)} you, the owner (Admin page)
${morning.length ? `\nThe morning text vendors get (pretend texts; turn it off in Account):\n${morning.join("\n")}\n` : ""}${payLinkUrl ? `\nThe DJ's payment link for a client (open it as familia@ or padrino@ to pay it):\n  ${payLinkUrl.replace(/^https?:\/\/[^/]+/, url)}\n` : ""}`);
for (const sig of ["SIGINT", "SIGTERM"]) process.on(sig, () => app.close().then(() => process.exit(0)));
