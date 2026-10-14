import { esc, toast } from "./ui.js";
import { t, lang } from "./i18n.js";

// One conversation. `mine` is the sender value that shows on the right; send(text) resolves to { messages, masked }.
// `quick` (vendors): ready-made replies, [{ label, en, es }]; a tap puts the text in the box, in the language picked, to edit and send.
let quickLang = "";
export function renderChat(box, { messages, mine, send, formId = "chatform", inputId = "chatin", note = "", quick = null }) {
  if (!quickLang) quickLang = lang();
  const quickRow = quick ? `<div class="quick" role="group" aria-label="${esc(t("qr.title"))}"><span class="dim small">${esc(t("qr.title"))}</span>
      ${quick.map((q, i) => `<button type="button" class="chip" data-q="${i}">${esc(q.label)}</button>`).join("")}
      <span class="qlang">${["en", "es"].map((l) => `<button type="button" class="chip small${quickLang === l ? " on" : ""}" data-ql="${l}" aria-pressed="${quickLang === l}">${l === "en" ? "English" : "Español"}</button>`).join("")}</span></div>` : "";
  box.innerHTML = `<div class="chat" id="chat">${messages.length ? messages.map((m) => `<div class="msg ${m.sender === mine ? "me" : "them"}">${esc(m.text)}</div>`).join("") : `<div class="empty small">${esc(t("g.noMsgs"))}</div>`}</div>
    ${quickRow}<form class="chat-form" id="${formId}"><input id="${inputId}" maxlength="500" placeholder="${esc(t("g.msgHint"))}" aria-label="${esc(t("g.message"))}"><button class="btn dark" type="submit">${esc(t("common.send"))}</button></form>${note}`;
  const c = box.querySelector(".chat"); c.scrollTop = c.scrollHeight;
  box.querySelectorAll("[data-q]").forEach((b) => { b.onclick = () => { const inp = box.querySelector(`#${inputId}`); inp.value = quick[Number(b.dataset.q)][quickLang]; inp.focus(); }; });
  box.querySelectorAll("[data-ql]").forEach((b) => { b.onclick = () => { quickLang = b.dataset.ql; box.querySelectorAll("[data-ql]").forEach((x) => { x.classList.toggle("on", x === b); x.setAttribute("aria-pressed", String(x === b)); }); }; });
  box.querySelector("form").onsubmit = async (e) => {
    e.preventDefault();
    const inp = box.querySelector("input"), text = inp.value.trim();
    if (!text) return;
    try {
      const r = await send(text);
      if (r.masked) toast(t("g.masked"));
      renderChat(box, { messages: r.messages, mine, send, formId, inputId, note, quick });
      window.dispatchEvent(new CustomEvent("bm:attention"));
    } catch (ex) { toast(ex.message, "error"); }
  };
}
