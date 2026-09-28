import { dowLetters, dkey, fmtMonth, fmtDate } from "./ui.js";
import { t } from "./i18n.js";

// Month grid used by customers and by group managers.
// cfg.dayState(dateObj) -> { enabled, open }, cfg.onPick(key), cfg.onMonth()
export function calendar(box, st, cfg) {
  const m = st.month, first = new Date(m.getFullYear(), m.getMonth(), 1);
  const days = new Date(m.getFullYear(), m.getMonth() + 1, 0).getDate();
  let html = `<div class="cal-head"><button type="button" class="btn ghost" data-nav="-1" aria-label="${t("cal.prev")}">‹</button><h3>${fmtMonth(m)}</h3><button type="button" class="btn ghost" data-nav="1" aria-label="${t("cal.next")}">›</button></div><div class="cal">`;
  dowLetters().forEach((d) => { html += `<div class="dow">${d}</div>`; });
  for (let b = 0; b < first.getDay(); b++) html += '<div class="day blank"></div>';
  for (let d = 1; d <= days; d++) {
    const date = new Date(m.getFullYear(), m.getMonth(), d), s = cfg.dayState(date), k = dkey(date);
    html += `<button type="button" class="day${s.open ? " open" : s.enabled ? " idle" : ""}${st.date === k ? " sel" : ""}" data-d="${k}" aria-label="${fmtDate(k)}${s.open ? ", " + t("cal.open") : ""}"${s.enabled ? "" : " disabled"}>${d}</button>`;
  }
  box.innerHTML = html + "</div>";
  box.querySelectorAll("[data-nav]").forEach((btn) => {
    btn.onclick = () => { st.month = new Date(m.getFullYear(), m.getMonth() + Number(btn.getAttribute("data-nav")), 1); cfg.onMonth(); };
  });
  box.querySelectorAll(".day[data-d]:not([disabled])").forEach((btn) => { btn.onclick = () => cfg.onPick(btn.getAttribute("data-d")); });
}
export const monthKey = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
