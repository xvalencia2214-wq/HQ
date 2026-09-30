import { api } from "../api.js";
import { state } from "../state.js";
import { t } from "../i18n.js";
import { esc, toast, wireShare } from "../ui.js";
import { groupCard } from "./home.js";
import { loadFavs, wireHearts } from "../fav.js";

const grid = (groups) => `<div class="grid">${groups.map((g) => groupCard(g, null)).join("")}</div>`;

// Your saved groups, and links you can send to a partner or a family chat.
export async function saved(app) {
  await loadFavs();
  const [{ groups }, { shortlists }] = await Promise.all([api.get("/api/my/favorites"), api.get("/api/my/shortlists")]);
  app.innerHTML = `<div class="titlebar"><h1>♥ ${esc(t("fav.title"))}</h1></div>
    ${groups.length ? `<div class="panel"><h2 class="sec">${esc(t("fav.share"))}</h2><p class="dim small">${esc(t("fav.shareHint"))}</p>
      <form id="slform" class="chat-form"><input id="sl-title" maxlength="60" placeholder="${esc(t("fav.titlePh"))}" aria-label="${esc(t("fav.titleLabel"))}"><button class="btn dark" type="submit">${esc(t("fav.create"))}</button></form><div id="slresult"></div></div>${grid(groups)}`
      : `<div class="panel empty">${esc(t("fav.none"))} <a href="#/">${esc(t("nav.find"))}</a> · <a href="#/discover">${esc(t("nav.discover"))}</a></div>`}
    ${shortlists.length ? `<div class="panel"><h2 class="sec">${esc(t("fav.myLists"))}</h2>${shortlists.map((s) => `<div class="req"><div><strong>${esc(s.title || t("fav.untitled"))}</strong> <span class="dim small">· ${esc(t("fav.count", { n: s.n }))}</span><br><a href="${esc(s.url)}" class="small">${esc(s.url)}</a></div><button class="btn ghost small" data-revoke="${esc(s.token)}">${esc(t("fav.revoke"))}</button></div>`).join("")}</div>` : ""}`;
  wireHearts(app); wireShare(app);
  app.querySelectorAll("[data-revoke]").forEach((b) => { b.onclick = async () => { try { await api.del(`/api/shortlists/${encodeURIComponent(b.dataset.revoke)}`); toast(t("fav.revoked")); saved(app); } catch (e) { toast(e.message, "error"); } }; });
  const form = document.getElementById("slform");
  if (form) form.onsubmit = async (e) => {
    e.preventDefault();
    try {
      const r = await api.post("/api/shortlists", { title: document.getElementById("sl-title").value });
      const text = t("fav.shareText", { name: state.user.name.split(" ")[0] });
      const wa = `https://wa.me/?text=${encodeURIComponent(text + " " + r.url)}`;
      document.getElementById("slresult").innerHTML = `<div class="note ok"><p>${esc(t("fav.linkReady"))}</p><input readonly id="sl-url" value="${esc(r.url)}" aria-label="${esc(t("fav.copy"))}">
        <p><button type="button" class="btn small" id="sl-copy">${esc(t("fav.copy"))}</button> <a class="btn ghost small" href="${esc(wa)}" target="_blank" rel="noopener noreferrer">WhatsApp</a></p></div>`;
      document.getElementById("sl-copy").onclick = async () => {
        try { if (navigator.share) { await navigator.share({ title: text, url: r.url }); return; } } catch (ex) { if (ex && ex.name === "AbortError") return; }
        try { await navigator.clipboard.writeText(r.url); toast(t("fav.copied")); } catch { document.getElementById("sl-url").select(); }
      };
    } catch (ex) { toast(ex.message, "error"); }
  };
}

// The public view of a link someone sent you.
export async function shortlist(app, token) {
  await loadFavs();
  let d;
  try { d = await api.get(`/api/shortlists/${encodeURIComponent(token)}`); }
  catch { app.innerHTML = `<div class="panel empty">${esc(t("fav.listGone"))} <a href="#/">${esc(t("nav.find"))}</a></div>`; return; }
  document.title = `${d.title || t("fav.listBy", { name: d.by })} · Bella's Música`;
  app.innerHTML = `<div class="titlebar"><h1>♥ ${esc(d.title || t("fav.listBy", { name: d.by }))}</h1></div><p class="dim">${esc(t("fav.listBy", { name: d.by }))}</p>
    ${d.groups.length ? grid(d.groups) : `<div class="panel empty">${esc(t("fav.listGone"))}</div>`}
    <p><a class="btn" href="#/chicago">${esc(t("fav.cta"))}</a></p>`;
  wireHearts(app); wireShare(app);
}
