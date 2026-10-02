import { now, todayStr, addDays } from "./util.js";
import { SLOTS } from "./pricing.js";

// Fictional sample listings so a fresh install has something to search. Turn off with DEMO_SEED=0.
const G = (id, name, type, zip, rate, members, rating, reviews, story, extra = {}) => ({ id, name, type, zip, rate, members, rating, reviews, story, ...extra });
const DEMO = [
  G("los-gallos-de-oro", "Los Gallos de Oro", "Mariachi", "60608", 350, 7, 4.9, 132, "Started in 2011 when three cousins played for tips on 26th Street. Today the whole family plays weddings, quinceañeras and Sunday parties across Pilsen and beyond.",
    { songs: ["Las Mañanitas", "El Rey", "Cielito Lindo", "Volver Volver", "Si Nos Dejan", "Sway (Quién Será)"], events: ["Wedding", "Quinceañera", "Birthday", "Serenata"], sound: 1, dress: "Charro suits (black and silver)", travel: 40, fee: 6000, guests: 250 }),
  G("banda-los-paisanos-del-sur", "Banda Los Paisanos del Sur", "Banda", "60623", 900, 14, 4.8, 98, "A 14-piece banda that grew out of a Little Village high school band program. Big brass, big dance floor, built for large quinceañeras and weddings.",
    { songs: ["El Sinaloense", "Mi Ranchito", "Ni Con Tu Sombra", "La Culebra", "Se Vende Un Corazón"], events: ["Wedding", "Quinceañera", "Birthday"], sound: 1, dress: "Matching black shirts", travel: 50, fee: 15000, guests: 500 }),
  G("los-compas-de-cicero", "Los Compas de Cicero", "Norteño", "60804", 300, 5, 4.8, 76, "Accordion, bajo sexto and a lot of heart. Friends from Cicero who have played family parties and restaurants across the west side for years.",
    { songs: ["Tragos Amargos", "Mi Tierra", "Cruz de Olvido", "Volverte a Ver", "El Sinaloense"], events: ["Birthday", "Wedding", "Corporate / Restaurant"], sound: 0, dress: "Boots and hats", travel: 40, fee: 5000, guests: 200 }),
  G("trio-luna-de-humboldt", "Trío Luna de Humboldt", "Trío romántico", "60651", 250, 3, 4.9, 64, "Three voices, three guitars. Perfect for serenatas, anniversaries and intimate dinners from Humboldt Park to the suburbs.",
    { songs: ["Sabor a Mí", "Bésame Mucho", "Contigo Aprendí", "Amor Eterno", "La Barca"], events: ["Serenata", "Anniversary", "Corporate / Restaurant", "Wedding"], sound: 0, dress: "Guayaberas or formal", travel: 25, fee: 4000, guests: 80 }),
  G("grupo-sabor-tropical", "Grupo Sabor Tropical", "Grupera", "60609", 600, 6, 4.7, 88, "Cumbia and grupera hits from the 80s to today. They started at Back of the Yards block parties and never stopped.",
    { songs: ["La Cumbia del Sol", "Mi Cucu", "Sonidero Nacional", "Tu Cárcel", "Amor de Mis Amores"], events: ["Quinceañera", "Birthday", "Wedding"], sound: 1, dress: "Colorful shirts", travel: 35, fee: 6000, guests: 300 }),
  G("mariachi-real-de-berwyn", "Mariachi Real de Berwyn", "Mariachi", "60402", 375, 7, 4.7, 155, "Third-generation mariachi family. They learned to play before they learned to drive.",
    { songs: ["Las Mañanitas", "Guadalajara", "El Son de la Negra", "Cielito Lindo", "Amor Eterno"], events: ["Wedding", "Quinceañera", "Birthday", "Serenata"], sound: 1, dress: "Charro suits", travel: 40, fee: 6500, guests: 250 }),
  G("los-hermanos-vega-de-aurora", "Los Hermanos Vega de Aurora", "Norteño", "60505", 280, 4, 4.6, 41, "Four brothers, one accordion and a long list of corrido requests. Family-run and easy to work with.",
    { songs: ["Mi Tierra", "Tragos Amargos", "El Rey", "Contrabando y Traición"], events: ["Birthday", "Corporate / Restaurant", "Wedding"], sound: 0, dress: "Boots and hats", travel: 40, fee: 4500, guests: 150 }),
  G("dj-fiesta-chicago", "DJ Fiesta Chicago", "DJ", "60647", 200, 1, 4.6, 120, "Bilingual DJ and MC who reads the room. Cumbia, reggaetón, banda, oldies — whatever gets the family dancing.",
    { songs: ["La Bamba", "Bailando", "La Macarena", "Suavemente", "El Sinaloense"], events: ["Quinceañera", "Birthday", "Wedding", "Corporate / Restaurant"], sound: 1, dress: "Business casual", travel: 50, fee: 3000, guests: 400 }),
  G("banda-la-costa-de-waukegan", "Banda La Costa de Waukegan", "Banda", "60085", 850, 13, 4.5, 57, "Sinaloa-style banda with a full brass section. They have played hundreds of quinceañeras across Lake County.",
    { songs: ["El Sinaloense", "La Culebra", "Mi Ranchito", "Las Mañanitas"], events: ["Quinceañera", "Wedding", "Birthday"], sound: 1, dress: "Matching outfits", travel: 50, fee: 14000, guests: 500 }),
  G("mariachi-alma-mexicana", "Mariachi Alma Mexicana", "Mariachi", "60608", 325, 6, 4.5, 39, "A younger group with a fresh take on the classics. Great for weddings that mix old and new.",
    { songs: ["Las Mañanitas", "Cielito Lindo", "Sway (Quién Será)", "Volver Volver", "Bésame Mucho"], events: ["Wedding", "Birthday", "Anniversary"], sound: 1, dress: "Modern black charro", travel: 30, fee: 5500, guests: 200 }),
  G("conjunto-brisa-de-joliet", "Conjunto Brisa de Joliet", "Conjunto", "60435", 260, 5, 4.4, 28, "Conjunto music from the border, played the way their grandparents played it.",
    { songs: ["Volver Volver", "Mi Tierra", "Cruz de Olvido", "Tragos Amargos"], events: ["Birthday", "Corporate / Restaurant", "Anniversary"], sound: 0, dress: "Western wear", travel: 30, fee: 4000, guests: 150 }),
  G("mariachi-juvenil-de-melrose-park", "Mariachi Juvenil de Melrose Park", "Mariachi", "60160", 300, 8, 4.8, 64, "Eight young musicians who came up through a community mariachi program. Energy, harmony and a lot of pride.",
    { songs: ["Cielito Lindo", "El Rey", "La Negra", "México Lindo y Querido", "Las Mañanitas"], events: ["Quinceañera", "Birthday", "Wedding", "Serenata"], sound: 1, dress: "Red and black trajes", travel: 35, fee: 5000, guests: 250 }),
  G("banda-el-jefe-de-brighton-park", "Banda El Jefe de Brighton Park", "Banda", "60632", 950, 15, 4.7, 77, "Fifteen musicians and a sound system that fills any banquet hall. Their quinceañera set is famous on the southwest side.",
    { songs: ["El Sinaloense", "Mi Ranchito", "La Culebra", "Ni Con Tu Sombra", "Las Mañanitas"], events: ["Quinceañera", "Wedding", "Birthday"], sound: 1, dress: "Matching white shirts", travel: 50, fee: 16000, guests: 600 }),
  G("trio-los-caballeros-de-des-plaines", "Trío Los Caballeros de Des Plaines", "Trío romántico", "60016", 240, 3, 4.5, 35, "Classic boleros and rancheras for restaurants, anniversaries and serenatas in the northwest suburbs.",
    { songs: ["Sabor a Mí", "Contigo Aprendí", "Bésame Mucho", "La Barca", "Amor Eterno"], events: ["Serenata", "Anniversary", "Corporate / Restaurant"], sound: 0, dress: "Suits", travel: 30, fee: 3500, guests: 80 })
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

// Sample min-hours and add-ons so the new features show up in the demo: a DJ with fog/lights/visuals/AV, and a couple of groups with a 2-hour minimum.
const DEMO_EXTRAS = {
  "dj-fiesta-chicago": { min_hours: 3, addons: [["Fog machine", "Low-lying fog for the first dance", 75], ["Dance floor lights", "Moving-head and LED effects", 120], ["Special lighting (uplights, spotlights)", "Uplights in your colors and a spotlight for the couple", 150], ["Visuals and video screen", "Projector or LED screen with photo and video slideshow", 200], ["Audio and video setup", "Full speaker, mic and video setup for speeches and slideshows", 0]] },
  "banda-la-costa-de-waukegan": { min_hours: 2, addons: [["Sound system", "Speakers and mixer for up to 300 guests", 150]] },
  "grupo-sabor-tropical": { min_hours: 2, addons: [["Sound system", "", 100], ["Dance floor lights", "", 90]] },
  "mariachi-real-de-berwyn": { min_hours: 1, addons: [["Wireless microphone", "For toasts and dedications", 25]] }
};

export function seedDemo(db) {
  // Older sample sets are retired: removed, or just hidden if anyone already booked or messaged them.
  const keep = DEMO.map((g) => g.id);
  for (const old of db.all(`SELECT id FROM groups WHERE demo = 1 AND id NOT IN (${keep.map(() => "?").join(",")})`, ...keep)) {
    const used = db.get("SELECT (SELECT COUNT(*) FROM bookings WHERE group_id = ?) + (SELECT COUNT(*) FROM messages WHERE group_id = ?) n", old.id, old.id).n;
    if (used) db.run("UPDATE groups SET hidden = 1 WHERE id = ?", old.id); else db.run("DELETE FROM groups WHERE id = ?", old.id);
  }
  {
    db.tx(() => {
      for (const g of DEMO) {
        if (db.get("SELECT 1 AS x FROM groups WHERE id = ?", g.id)) continue; // already there
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
  for (const [id, x] of Object.entries(DEMO_EXTRAS)) {
    if (!db.get("SELECT 1 AS x FROM groups WHERE id = ? AND demo = 1", id) || db.get("SELECT COUNT(*) c FROM addons WHERE group_id = ?", id).c) continue;
    db.run("UPDATE groups SET min_hours = ? WHERE id = ?", x.min_hours, id);
    for (const [name, description, price] of x.addons) db.run("INSERT INTO addons (group_id, name, description, price_cents) VALUES (?, ?, ?, ?)", id, name, description, price * 100);
  }
  fillDemoAvailability(db);
}
