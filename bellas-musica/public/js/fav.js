import { api } from "./api.js";
import { state } from "./state.js";
import { t } from "./i18n.js";
import { esc, toast } from "./ui.js";

// The set of group ids the signed-in person has saved, loaded once per person and kept in step as they tap hearts.
let ids = new Set(), owner = null;
export async function loadFavs() {
  const who = state.user ? state.user.id : null;
  if (who === owner) return ids;
  owner = who; ids = new Set();
  if (who) { try { ids = new Set((await api.get("/api/my/favorites?ids=1")).ids); } catch { /* hearts just start empty */ } }
  return ids;
}
export const isFav = (id) => ids.has(id);

export function heart(id, cls = "") {
  const on = isFav(id);
  return `<button type="button" class="heart ${cls}${on ? " on" : ""}" data-heart="${esc(id)}" aria-pressed="${on}" aria-label="${esc(t(on ? "fav.unsave" : "fav.save"))}">${on ? "♥" : "♡"}</button>`;
}

const paint = (id, on) => document.querySelectorAll(`[data-heart="${CSS.escape(id)}"]`).forEach((x) => {
  x.classList.toggle("on", on); x.setAttribute("aria-pressed", String(on)); x.textContent = on ? "♥" : "♡"; x.setAttribute("aria-label", t(on ? "fav.unsave" : "fav.save"));
});

export function wireHearts(root) {
  root.querySelectorAll("[data-heart]:not([data-wired])").forEach((b) => {
    b.dataset.wired = "1";
    b.onclick = async (e) => {
      e.preventDefault(); e.stopPropagation();
      if (!state.user) { location.hash = "#/login?next=" + encodeURIComponent(location.hash); return; }
      const id = b.dataset.heart, want = !isFav(id);
      b.disabled = true;
      try {
        await api.post(`/api/favorites/${encodeURIComponent(id)}`, { saved: want });
        if (want) ids.add(id); else ids.delete(id);
        paint(id, want); toast(t(want ? "fav.saved" : "fav.removed"));
        window.dispatchEvent(new CustomEvent("bm:favs"));
      } catch (ex) { toast(ex.message, "error"); }
      b.disabled = false;
    };
  });
}
