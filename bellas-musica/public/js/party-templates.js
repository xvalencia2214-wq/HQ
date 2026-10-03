// Ready-made party plans: what a party like this usually needs, a typical day-of schedule, and how budgets usually split.
// Only suggestions: everything can be changed on the party page.
export const TEMPLATES = {
  quince: {
    needs: ["music", "food", "rentals", "decor", "photo", "services", "venues"],
    split: { venues: 25, food: 25, music: 20, decor: 10, photo: 10, rentals: 5, services: 5 },
    timeline: [["10:00", "Tables, chairs and decorations set up", "Montaje de mesas, sillas y decoración"], ["13:00", "Misa", "Misa"], ["16:00", "Photos with the family", "Fotos con la familia"],
      ["18:00", "Guests arrive, dinner is served", "Llegan los invitados, se sirve la cena"], ["19:30", "Grand entrance and the waltz", "Entrada y el vals"], ["20:00", "Mariachi or banda", "Mariachi o banda"],
      ["21:00", "Cake and toast", "Pastel y brindis"], ["21:30", "Dance", "Baile"], ["00:30", "Clean-up", "Limpieza"]]
  },
  wedding: {
    needs: ["music", "food", "rentals", "decor", "photo", "services", "venues"],
    split: { venues: 30, food: 25, music: 15, photo: 12, decor: 10, rentals: 4, services: 4 },
    timeline: [["12:00", "Ceremony", "Ceremonia"], ["14:00", "Photos", "Fotos"], ["17:00", "Cocktail hour", "Cóctel"], ["18:00", "Dinner", "Cena"], ["19:30", "First dance", "Primer baile"],
      ["20:00", "Mariachi serenade", "Serenata de mariachi"], ["21:00", "Dance (DJ or banda)", "Baile (DJ o banda)"], ["23:30", "Send-off", "Despedida"]]
  },
  birthday: {
    needs: ["music", "food", "rentals", "decor"],
    split: { food: 35, music: 30, rentals: 20, decor: 15 },
    timeline: [["13:00", "Tables, chairs and bounce house set up", "Montaje de mesas, sillas y brincolín"], ["15:00", "Guests arrive", "Llegan los invitados"], ["16:00", "Food", "Comida"],
      ["17:30", "Mañanitas and cake", "Mañanitas y pastel"], ["18:00", "Piñata", "Piñata"], ["19:00", "Music and dancing", "Música y baile"]]
  },
  bautizo: {
    needs: ["music", "food", "decor", "photo", "venues"],
    split: { venues: 30, food: 35, music: 15, decor: 10, photo: 10 },
    timeline: [["11:00", "Church", "Iglesia"], ["13:00", "Photos", "Fotos"], ["14:00", "Lunch with the family", "Comida con la familia"], ["15:30", "Trío or mariachi", "Trío o mariachi"], ["17:00", "Cake", "Pastel"]]
  },
  backyard: {
    needs: ["music", "food", "rentals", "services"],
    split: { food: 40, music: 30, rentals: 20, services: 10 },
    timeline: [["12:00", "Tent, tables and chairs delivered", "Entrega de carpa, mesas y sillas"], ["15:00", "Food truck arrives", "Llega el food truck"], ["16:00", "Party starts", "Empieza la fiesta"],
      ["18:00", "Music", "Música"], ["22:00", "Clean-up crew", "Equipo de limpieza"]]
  },
  graduation: {
    needs: ["music", "food", "rentals", "decor"],
    split: { food: 40, music: 25, rentals: 20, decor: 15 },
    timeline: [["13:00", "Decorations and tables ready", "Decoración y mesas listas"], ["15:00", "Guests arrive", "Llegan los invitados"], ["16:00", "Food", "Comida"], ["17:00", "Toast for the graduate", "Brindis por el graduado"], ["18:00", "Music", "Música"]]
  }
};
export const TEMPLATE_KEYS = Object.keys(TEMPLATES);

// Rules of thumb for a party of `guests` people. Rounded up; vendors give the final number.
export function guestMath(guests) {
  const n = Math.max(0, Math.round(Number(guests) || 0));
  if (!n) return null;
  const roundTables = Math.ceil(n / 8);              // 60" rounds seat 8
  const seatedSqft = n * 12 + 200;                   // seated dinner + a small dance floor
  const tents = [[400, "20x20"], [800, "20x40"], [1200, "30x40"], [1800, "30x60"], [2400, "40x60"], [3200, "40x80"]];
  const tent = (tents.find(([sq]) => sq >= seatedSqft) || [0, "2 x 40x80"])[1];
  return {
    roundTables, chairs: n, tent, tacos: n * 4, servings: Math.ceil(n * 1.1), aguasGallons: Math.ceil(n / 8),
    cakeServings: n, balloonArch: n > 60 ? 2 : 1, security: n >= 150 ? Math.ceil(n / 100) : n >= 100 ? 1 : 0
  };
}
