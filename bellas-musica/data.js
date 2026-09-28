// Demo data. All groups, stories and prices are fictional placeholders.
// A few real ZIP centroids so the "near you" search can compute distances.
window.ZIPS = {
  "60608": { city: "Chicago, IL", lat: 41.8419, lon: -87.6702 },
  "77003": { city: "Houston, TX", lat: 29.7488, lon: -95.3474 },
  "78207": { city: "San Antonio, TX", lat: 29.4227, lon: -98.5250 },
  "90022": { city: "East Los Angeles, CA", lat: 34.0255, lon: -118.1567 },
  "85003": { city: "Phoenix, AZ", lat: 33.4530, lon: -112.0790 }
};

window.GROUPS = [
  { id: "los-gallos-de-oro", name: "Los Gallos de Oro", type: "Mariachi", zip: "60608", rate: 350, members: 7, rating: 4.9, reviews: 132,
    story: "Started in 2011 when three cousins played for tips on 26th Street. Today the whole family plays weddings, quinceañeras and Sunday parties." },
  { id: "mariachi-estrella-azul", name: "Mariachi Estrella Azul", type: "Mariachi", zip: "77003", rate: 400, members: 8, rating: 4.9, reviews: 210,
    story: "Formed by music school friends who wanted to keep the classic sound alive. Traditional trajes, modern sound system, no cover songs they can't play well." },
  { id: "banda-el-patron", name: "Banda El Patrón", type: "Banda", zip: "90022", rate: 900, members: 14, rating: 4.8, reviews: 98,
    story: "A 14-piece banda that grew out of a high school band program. Big brass, big dance floor, built for large parties." },
  { id: "norteno-los-del-rio-bravo", name: "Los del Río Bravo", type: "Norteño", zip: "78207", rate: 300, members: 5, rating: 4.8, reviews: 76,
    story: "Accordion, bajo sexto and a lot of heart. The band began at a family ranch in the Rio Grande Valley and now plays across South Texas." },
  { id: "trio-luna-de-plata", name: "Trío Luna de Plata", type: "Trío romántico", zip: "85003", rate: 250, members: 3, rating: 4.9, reviews: 64,
    story: "Three voices, three guitars. Perfect for serenatas, anniversaries and intimate dinners." },
  { id: "grupo-sabor-tropical", name: "Grupo Sabor Tropical", type: "Grupera", zip: "60608", rate: 600, members: 6, rating: 4.7, reviews: 88,
    story: "Cumbia and grupera hits from the 80s to today. They started playing at neighborhood block parties and never stopped." },
  { id: "mariachi-real-de-jalisco", name: "Mariachi Real de Jalisco", type: "Mariachi", zip: "90022", rate: 375, members: 7, rating: 4.7, reviews: 155,
    story: "Third-generation mariachi family. They learned to play before they learned to drive." },
  { id: "los-hermanos-vega", name: "Los Hermanos Vega", type: "Norteño", zip: "85003", rate: 280, members: 4, rating: 4.6, reviews: 41,
    story: "Four brothers, one accordion and a long list of corridos requests. Family-run and easy to work with." },
  { id: "dj-fiesta-latina", name: "DJ Fiesta Latina", type: "DJ", zip: "77003", rate: 200, members: 1, rating: 4.6, reviews: 120,
    story: "Bilingual DJ and MC who reads the room. Cumbia, reggaetón, banda, oldies — whatever gets the family dancing." },
  { id: "banda-sinaloense-la-costa", name: "Banda La Costa", type: "Banda", zip: "78207", rate: 850, members: 13, rating: 4.5, reviews: 57,
    story: "Sinaloa-style banda with a full brass section. They have played at hundreds of quinceañeras across Texas." },
  { id: "mariachi-alma-mexicana", name: "Mariachi Alma Mexicana", type: "Mariachi", zip: "60608", rate: 325, members: 6, rating: 4.5, reviews: 39,
    story: "A younger group with a fresh take on the classics. Great for weddings that mix old and new." },
  { id: "conjunto-brisa-del-valle", name: "Conjunto Brisa del Valle", type: "Conjunto", zip: "85003", rate: 260, members: 5, rating: 4.4, reviews: 28,
    story: "Conjunto music from the border, played the way their grandparents played it." }
];

window.EVENT_TYPES = ["Wedding", "Quinceañera", "Birthday", "Anniversary", "Serenata", "Corporate / Restaurant", "Other"];
window.SLOTS = ["12:00 PM", "2:00 PM", "4:00 PM", "6:00 PM", "8:00 PM"];
