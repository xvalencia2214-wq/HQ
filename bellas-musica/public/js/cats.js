import { t } from "./i18n.js";
import { esc } from "./ui.js";

// The kinds of things you can book for a party. Order = how they are shown.
export const CAT_ORDER = ["music", "food", "rentals", "decor", "photo", "services", "venues"];
export const CAT_ICON = { all: "✨", music: "🎺", food: "🌮", rentals: "⛺", decor: "🎈", photo: "📸", services: "🛡️", venues: "🏛️" };
export const catLabel = (c) => `${CAT_ICON[c] || ""} ${t("cat." + c)}`.trim();

// A row of category chips. `href(c)` makes links (search page); without it they are buttons with data-cat (Discover).
export function catChips(active, { withAll = false, href = null, label = "" } = {}) {
  const list = withAll ? ["all", ...CAT_ORDER] : CAT_ORDER;
  const one = (c) => href
    ? `<a class="catchip${c === active ? " on" : ""}" href="${esc(href(c))}"${c === active ? ' aria-current="true"' : ""}>${esc(catLabel(c))}</a>`
    : `<button type="button" class="catchip${c === active ? " on" : ""}" data-cat="${c}" aria-pressed="${c === active}">${esc(catLabel(c))}</button>`;
  return `<div class="catrow" role="group" aria-label="${esc(label || t("f.category"))}">${list.map(one).join("")}</div>`;
}
