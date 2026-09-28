import { esc, toast } from "./ui.js";
import { t } from "./i18n.js";

// One conversation. `mine` is the sender value that shows on the right; send(text) resolves to { messages, masked }.
export function renderChat(box, { messages, mine, send, formId = "chatform", inputId = "chatin", note = "" }) {
  box.innerHTML = `<div class="chat" id="chat">${messages.length ? messages.map((m) => `<div class="msg ${m.sender === mine ? "me" : "them"}">${esc(m.text)}</div>`).join("") : `<div class="empty small">${esc(t("g.noMsgs"))}</div>`}</div>
    <form class="chat-form" id="${formId}"><input id="${inputId}" maxlength="500" placeholder="${esc(t("g.msgHint"))}" aria-label="${esc(t("g.message"))}"><button class="btn dark" type="submit">${esc(t("common.send"))}</button></form>${note}`;
  const c = box.querySelector(".chat"); c.scrollTop = c.scrollHeight;
  box.querySelector("form").onsubmit = async (e) => {
    e.preventDefault();
    const inp = box.querySelector("input"), text = inp.value.trim();
    if (!text) return;
    try {
      const r = await send(text);
      if (r.masked) toast(t("g.masked"));
      renderChat(box, { messages: r.messages, mine, send, formId, inputId, note });
      window.dispatchEvent(new CustomEvent("bm:attention"));
    } catch (ex) { toast(ex.message, "error"); }
  };
}
