// Seeds a realistic marketplace (one rich group, customers, bookings in every state, reviews, chat).
import { client, inDays, bookingBody } from "../test/helpers.js";
import { png } from "./png.mjs";

export async function seedMarketplace(S) {
const B64 = (c) => png(640, 420, c).toString("base64");
const owner = client(S.base), other = client(S.base), ana = client(S.base), luis = client(S.base);
await owner.signup("owner@qa.test", "Marisol Vega", { phone: "312-555-0111", sms_opt_in: true });
await other.signup("other@qa.test", "Otro Dueño");
await ana.signup("ana@qa.test", "Ana García", { phone: "312-555-0142" });
await luis.signup("luis@qa.test", "Luis Ramírez", { phone: "312-555-0143" });
const g = (await owner.post("/api/groups", { name: "Mariachi Tierra Viva", type: "Mariachi", zip: "60608", rate: 375, members: 8, story: "Eight musicians from Pilsen who grew up playing in their abuelo's living room. We bring trajes, a full sound system and a lot of corazón to weddings, quinceañeras and Sunday serenatas across Chicagoland." })).json;
const id = g.id;
await owner.patch(`/api/groups/${id}`, { events: ["Wedding", "Quinceañera", "Serenata", "Anniversary"], songs: ["Cielito Lindo", "El Rey", "Las Mañanitas", "Volver Volver", "Amor Eterno", "México Lindo y Querido", "La Negra", "Si Nos Dejan", "Sway (Quién Será)", "Bésame Mucho"], max_guests: 250, sound_system: true, dress_code: "Black and silver charro suits", set_minutes: 50, travel_miles: 25, travel_fee: 80, deposit_pct: 25, cancel_policy: "moderate", contact_phone: "312-555-0111", video_url: "https://youtu.be/dQw4w9WgXcQ" });
for (const c of [[210, 120, 40], [60, 110, 190], [190, 60, 80], [70, 150, 90]]) await owner.post(`/api/groups/${id}/photos`, { data: B64(c) });
await owner.post(`/api/groups/${id}/packages`, { name: "Serenata", description: "3 songs at the door, about 20 minutes", hours: 1, price: 250 });
await owner.post(`/api/groups/${id}/packages`, { name: "Quinceañera", description: "Waltz, entrance and 2 hours of music", hours: 3, price: 950 });
await owner.post(`/api/groups/${id}/packages`, { name: "Full wedding", description: "Ceremony + cocktail hour + dinner, 4 hours", hours: 4, price: 1300 });
await owner.post(`/api/groups/${id}/availability/weekends`, { weeks: 12 });
const pub = await owner.post(`/api/groups/${id}/publish`); if (pub.status !== 200) throw new Error("publish failed " + JSON.stringify(pub.json)); // new listings start as drafts
// bookings in each state
const wk = (n) => { for (let i = 1; i < 200; i++) { const d = new Date(); d.setDate(d.getDate() + i); if ([5, 6].includes(d.getDay()) && n-- === 0) return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; } };
const book = async (c, date, time, o = {}) => (await c.post("/api/bookings", bookingBody(id, date, { time, ...o }))).json.booking;
const pay = (c, b) => c.post(`/api/bookings/${b.id}/simulate-pay`);
const b1 = await book(ana, wk(1), "12:00 PM", { event: "Quinceañera", guests: 180 }); await pay(ana, b1); await owner.patch(`/api/bookings/${b1.id}`, { action: "accept" });
const b2 = await book(luis, wk(2), "2:00 PM", { event: "Wedding", guests: 120, message: "Please play Amor Eterno for the first dance" }); await pay(luis, b2);
const b3 = await book(ana, wk(3), "4:00 PM", { event: "Anniversary", guests: 40, hours: 1 }); await pay(ana, b3); await ana.patch(`/api/bookings/${b3.id}`, { action: "cancel" });
const b4 = await book(ana, wk(4), "2:00 PM", { event: "Serenata", guests: 30, hours: 1 }); // left unpaid
const past = await book(luis, wk(0), "6:00 PM", { event: "Birthday", guests: 60 }); await pay(luis, past); await owner.patch(`/api/bookings/${past.id}`, { action: "accept" });
S.db.run("UPDATE bookings SET date = ? WHERE id = ?", inDays(-6), past.id);
await luis.post(`/api/bookings/${past.id}/review`, { rating: 5, text: "Best decision we made for my mom's 60th. Everyone was crying and dancing. They learned her favorite song just for us." });
const oldR = await book(ana, wk(5), "12:00 PM", { event: "Wedding" }); await pay(ana, oldR); await owner.patch(`/api/bookings/${oldR.id}`, { action: "accept" });
S.db.run("UPDATE bookings SET date = ? WHERE id = ?", inDays(-30), oldR.id);
await ana.post(`/api/bookings/${oldR.id}/review`, { rating: 4, text: "Great music, a little late setting up but worth it." });
await ana.post(`/api/groups/${id}/messages`, { text: "Hola! Do you play for 180 guests outdoors? We have a canopy." });
const cid = (await owner.get(`/api/groups/${id}/threads`)).json.threads[0].customer_id;
await owner.post(`/api/groups/${id}/threads/${cid}`, { text: "Sí claro! We bring our own sound system. What time does the quince start?" });
await luis.post(`/api/groups/${id}/messages`, { text: "Can you learn a new song for the entrance?" });
await owner.post(`/api/groups/${id}/feature`).then((f) => owner.post(`/api/feature/${f.json.id}/simulate-pay`));
return { id, owner, other, ana, luis };
}
