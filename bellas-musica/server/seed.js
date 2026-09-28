import { now, todayStr, addDays } from "./util.js";
import { SLOTS } from "./pricing.js";

// Fictional sample listings so a fresh install has something to search. Turn off with DEMO_SEED=0.
const G = (id, name, type, zip, rate, members, rating, reviews, story, extra = {}) => ({ id, name, type, zip, rate, members, rating, reviews, story, ...extra });
const DEMO = [
  G("los-gallos-de-oro", "Los Gallos de Oro", "Mariachi", "60608", 350, 7, 4.9, 132, "Started in 2011 when three cousins played for tips on 26th Street. Today the whole family plays weddings, quinceañeras and Sunday parties.",
    { songs: ["Las Mañanitas", "El Rey", "Cielito Lindo", "Volver Volver", "Si Nos Dejan", "Sway (Quién Será)"], events: ["Wedding", "Quinceañera", "Birthday", "Serenata"], sound: 1, dress: "Charro suits (black and silver)", travel: 40, fee: 6000, guests: 250 }),
  G("mariachi-estrella-azul", "Mariachi Estrella Azul", "Mariachi", "77003", 400, 8, 4.9, 210, "Formed by music school friends who wanted to keep the classic sound alive. Traditional trajes, modern sound system, no cover songs they can't play well.",
    { songs: ["Las Mañanitas", "Cielito Lindo", "Amor Eterno", "Volver Volver", "México Lindo y Querido", "La Negra"], events: ["Wedding", "Quinceañera", "Anniversary", "Serenata"], sound: 1, dress: "Traditional trajes de charro", travel: 30, fee: 7500, guests: 300 }),
  G("banda-el-patron", "Banda El Patrón", "Banda", "90022", 900, 14, 4.8, 98, "A 14-piece banda that grew out of a high school band program. Big brass, big dance floor, built for large parties.",
    { songs: ["El Sinaloense", "Mi Ranchito", "Ni Con Tu Sombra", "La Culebra", "Se Vende Un Corazón"], events: ["Wedding", "Quinceañera", "Birthday"], sound: 1, dress: "Matching black shirts", travel: 50, fee: 15000, guests: 500 }),
  G("los-del-rio-bravo", "Los del Río Bravo", "Norteño", "78207", 300, 5, 4.8, 76, "Accordion, bajo sexto and a lot of heart. The band began at a family ranch in the Rio Grande Valley and now plays across South Texas.",
    { songs: ["Tragos Amargos", "Mi Tierra", "Cruz de Olvido", "Volverte a Ver", "El Sinaloense"], events: ["Birthday", "Wedding", "Corporate / Restaurant"], sound: 0, dress: "Boots and hats", travel: 40, fee: 5000, guests: 200 }),
  G("trio-luna-de-plata", "Trío Luna de Plata", "Trío romántico", "85003", 250, 3, 4.9, 64, "Three voices, three guitars. Perfect for serenatas, anniversaries and intimate dinners.",
    { songs: ["Sabor a Mí", "Bésame Mucho", "Contigo Aprendí", "Amor Eterno", "La Barca"], events: ["Serenata", "Anniversary", "Corporate / Restaurant", "Wedding"], sound: 0, dress: "Guayaberas or formal", travel: 25, fee: 4000, guests: 80 }),
  G("grupo-sabor-tropical", "Grupo Sabor Tropical", "Grupera", "60608", 600, 6, 4.7, 88, "Cumbia and grupera hits from the 80s to today. They started playing at neighborhood block parties and never stopped.",
    { songs: ["La Cumbia del Sol", "Mi Cucu", "Sonidero Nacional", "Tu Cárcel", "Amor de Mis Amores"], events: ["Quinceañera", "Birthday", "Wedding"], sound: 1, dress: "Colorful shirts", travel: 35, fee: 6000, guests: 300 }),
  G("mariachi-real-de-jalisco", "Mariachi Real de Jalisco", "Mariachi", "90022", 375, 7, 4.7, 155, "Third-generation mariachi family. They learned to play before they learned to drive.",
    { songs: ["Las Mañanitas", "Guadalajara", "El Son de la Negra", "Cielito Lindo", "Amor Eterno"], events: ["Wedding", "Quinceañera", "Birthday", "Serenata"], sound: 1, dress: "Charro suits", travel: 40, fee: 6500, guests: 250 }),
  G("los-hermanos-vega", "Los Hermanos Vega", "Norteño", "85003", 280, 4, 4.6, 41, "Four brothers, one accordion and a long list of corridos requests. Family-run and easy to work with.",
    { songs: ["Mi Tierra", "Tragos Amargos", "El Rey", "Contrabando y Traición"], events: ["Birthday", "Corporate / Restaurant", "Wedding"], sound: 0, dress: "Boots and hats", travel: 30, fee: 4500, guests: 150 }),
  G("dj-fiesta-latina", "DJ Fiesta Latina", "DJ", "77003", 200, 1, 4.6, 120, "Bilingual DJ and MC who reads the room. Cumbia, reggaetón, banda, oldies — whatever gets the family dancing.",
    { songs: ["La Bamba", "Bailando", "La Macarena", "Suavemente", "El Sinaloense"], events: ["Quinceañera", "Birthday", "Wedding", "Corporate / Restaurant"], sound: 1, dress: "Business casual", travel: 50, fee: 3000, guests: 400 }),
  G("banda-la-costa", "Banda La Costa", "Banda", "78207", 850, 13, 4.5, 57, "Sinaloa-style banda with a full brass section. They have played at hundreds of quinceañeras across Texas.",
    { songs: ["El Sinaloense", "La Culebra", "Mi Ranchito", "Las Mañanitas"], events: ["Quinceañera", "Wedding", "Birthday"], sound: 1, dress: "Matching outfits", travel: 50, fee: 14000, guests: 500 }),
  G("mariachi-alma-mexicana", "Mariachi Alma Mexicana", "Mariachi", "60608", 325, 6, 4.5, 39, "A younger group with a fresh take on the classics. Great for weddings that mix old and new.",
    { songs: ["Las Mañanitas", "Cielito Lindo", "Sway (Quién Será)", "Volver Volver", "Bésame Mucho"], events: ["Wedding", "Birthday", "Anniversary"], sound: 1, dress: "Modern black charro", travel: 30, fee: 5500, guests: 200 }),
  G("conjunto-brisa-del-valle", "Conjunto Brisa del Valle", "Conjunto", "85003", 260, 5, 4.4, 28, "Conjunto music from the border, played the way their grandparents played it.",
    { songs: ["Volver Volver", "Mi Tierra", "Cruz de Olvido", "Tragos Amargos"], events: ["Birthday", "Corporate / Restaurant", "Anniversary"], sound: 0, dress: "Western wear", travel: 30, fee: 4000, guests: 150 })
];

function hash(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

// Sample groups get a rolling 180 days of generated open dates (busier on weekends).
export function fillDemoAvailability(db) {
  const today = todayStr();
  const ids = db.all("SELECT id FROM groups WHERE demo = 1").map((r) => r.id);
  db.tx(() => {
    for (const id of ids) {
      for (let i = 1; i <= 180; i++) {
        const date = addDays(today, i);
        const h = hash(id + date);
        const dow = new Date(date + "T12:00:00Z").getUTCDay();
        if (h % 100 >= (dow === 5 || dow === 6 || dow === 0 ? 62 : 38)) continue;
        const slots = SLOTS.filter((_, k) => ((h >> (k + 3)) & 1) === 1);
        if (slots.length) db.run("INSERT OR IGNORE INTO availability (group_id, date, slots) VALUES (?, ?, ?)", id, date, JSON.stringify(slots));
      }
    }
  });
}

export function seedDemo(db) {
  if (!db.get("SELECT 1 AS x FROM groups WHERE demo = 1")) {
    db.tx(() => {
      for (const g of DEMO) {
        db.run(
          `INSERT INTO groups (id, demo, name, type, zip, rate_cents, members, story, events, songs, max_guests, sound_system, dress_code,
             travel_miles, travel_fee_cents, seed_rating, seed_reviews, created_at)
           VALUES (?, 1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          g.id, g.name, g.type, g.zip, g.rate * 100, g.members, g.story, JSON.stringify(g.events || []), JSON.stringify(g.songs || []),
          g.guests || 150, g.sound || 0, g.dress || "", g.travel || 30, g.fee || 0, g.rating, g.reviews, now());
        const hr = g.rate * 100;
        db.run("INSERT INTO packages (group_id, name, description, hours, price_cents) VALUES (?, ?, ?, ?, ?)", g.id, "Serenata / short set", "3 songs, about 20 minutes", 1, Math.round(hr * 0.6));
        db.run("INSERT INTO packages (group_id, name, description, hours, price_cents) VALUES (?, ?, ?, ?, ?)", g.id, "Party (2 hours)", "Two hours of music with breaks", 2, hr * 2);
        db.run("INSERT INTO packages (group_id, name, description, hours, price_cents) VALUES (?, ?, ?, ?, ?)", g.id, "Full event (4 hours)", "Four hours, setup included", 4, Math.round(hr * 4 * 0.9));
      }
    });
  }
  fillDemoAvailability(db);
}
