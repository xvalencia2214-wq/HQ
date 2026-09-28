import { api } from "../api.js";
import { t } from "../i18n.js";
import { esc } from "../ui.js";
import { renderChat } from "../chat.js";

// Customer inbox: every conversation with every group in one place.
export async function messagesView(app, params) {
  const { threads } = await api.get("/api/my/threads");
  app.innerHTML = `<h2 class="sec">${esc(t("msg.title"))}</h2>${threads.length ? `<div class="two"><div class="panel">${threads.map((th) => `<button class="thread${th.unread ? " unread" : ""}" data-g="${esc(th.group_id)}"><strong>${esc(th.group_name)}</strong>${th.unread ? `<span class="dot">${esc(t("msg.new"))}</span>` : ""}<br><span class="dim small">${th.last.sender === "customer" ? esc(t("msg.you")) + ": " : ""}${esc(th.last.text.slice(0, 70))}</span></button>`).join("")}</div>
    <div class="panel" id="conv" hidden></div></div>` : `<div class="panel empty">${esc(t("msg.none"))} <a href="#/">${esc(t("nav.find"))}</a></div>`}`;
  const open = async (gid) => {
    const conv = document.getElementById("conv"); if (!conv) return;
    const { messages } = await api.get(`/api/groups/${encodeURIComponent(gid)}/messages`);
    conv.hidden = false;
    conv.innerHTML = `<div class="titlebar"><h3 class="sec">${esc(threads.find((x) => x.group_id === gid)?.group_name || "")}</h3><a href="#/group/${esc(gid)}">${esc(t("msg.open"))}</a></div><div id="convchat"></div>`;
    renderChat(document.getElementById("convchat"), { messages, mine: "customer", send: (text) => api.post(`/api/groups/${encodeURIComponent(gid)}/messages`, { text }) });
    document.querySelectorAll(".thread").forEach((b) => { if (b.dataset.g === gid) { b.classList.remove("unread"); b.querySelector(".dot")?.remove(); } });
    window.dispatchEvent(new CustomEvent("bm:attention"));
  };
  app.querySelectorAll(".thread").forEach((b) => { b.onclick = () => open(b.dataset.g); });
  const want = params.get("g") || (threads.find((x) => x.unread) || threads[0] || {}).group_id;
  if (want && threads.some((x) => x.group_id === want)) await open(want);
}
