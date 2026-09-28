import { lookupZip, miles } from "./geo.js";

// The city we are launching in. Everything Chicago-specific lives here so opening another city means editing one file.
export const MARKET = {
  key: "chicago",
  name: "Chicago",
  area: "Chicagoland",
  center: { zip: "60608", lat: 41.8515, lon: -87.6694 },
  radiusMiles: 60,
  // Quick-picks on the home page: [id, display name, ZIP code, group of the city]
  neighborhoods: [
    { id: "pilsen", name: "Pilsen", zip: "60608" }, { id: "little-village", name: "Little Village", zip: "60623" },
    { id: "back-of-the-yards", name: "Back of the Yards", zip: "60609" }, { id: "brighton-park", name: "Brighton Park", zip: "60632" },
    { id: "humboldt-park", name: "Humboldt Park", zip: "60651" }, { id: "logan-square", name: "Logan Square", zip: "60647" },
    { id: "cicero", name: "Cicero", zip: "60804" }, { id: "berwyn", name: "Berwyn", zip: "60402" },
    { id: "melrose-park", name: "Melrose Park", zip: "60160" }, { id: "des-plaines", name: "Des Plaines", zip: "60016" },
    { id: "aurora", name: "Aurora", zip: "60505" }, { id: "elgin", name: "Elgin", zip: "60120" },
    { id: "joliet", name: "Joliet", zip: "60435" }, { id: "waukegan", name: "Waukegan", zip: "60085" }
  ]
};

export function inMarket(zip) {
  const z = lookupZip(zip);
  return Boolean(z) && miles(MARKET.center, z) <= MARKET.radiusMiles;
}
