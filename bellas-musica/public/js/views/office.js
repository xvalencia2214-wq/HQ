// "Mi Oficina": the owner's private AI office (server/office.js). Five desks around a shared memory work every morning
// and leave a report and drafts; nothing goes out until the owner taps Approve. Owner only, English only (like Admin).
import { api } from "../api.js";
import { esc, toast } from "../ui.js";
import { chuyFormat } from "../chuy.js";

const when = (ts) => new Date(ts * 1000).toLocaleString("en-US", { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
const KIND = { vendor_email: "Email to a vendor", customer_email: "Email to a family", social_post: "Social post", outreach: "Outreach message", task: "To-do" };
const SENDS = new Set(["vendor_email", "customer_email"]);

// A little room seen from above at an angle: floor, desk, a glowing screen in the desk's color and its worker, who
// types while the desk is working.
const room = (d) => `<svg class="of-svg" viewBox="0 0 160 110" aria-hidden="true" focusable="false">
  <polygon points="80,30 152,66 80,102 8,66" fill="#1b2a52" stroke="#c9962b" stroke-width="1.5"/>
  <polygon points="80,38 140,68 80,96 20,68" fill="#22346a" opacity=".55"/>
  <polygon points="58,58 104,58 112,70 66,70" fill="#8a6420"/><polygon points="66,70 112,70 112,76 66,76" fill="#6b4c16"/>
  <rect x="72" y="40" width="26" height="18" rx="2" fill="#0b1838" stroke="#e6c063" stroke-width="1"/>
  <rect class="of-glow" x="75" y="43" width="20" height="12" rx="1" fill="${esc(d.color)}"/>
  <g class="of-who"><circle cx="58" cy="50" r="7" fill="#e8b98a"/><path d="M51 48 q7 -9 14 0 z" fill="#2b1a0e"/><rect x="50" y="57" width="16" height="16" rx="6" fill="${esc(d.color)}"/>
    <rect class="of-arm" x="63" y="60" width="10" height="4" rx="2" fill="#e8b98a"/></g>
  <circle cx="132" cy="44" r="7" fill="#1d7a52"/><rect x="129" y="50" width="6" height="8" rx="1" fill="#6b4c16"/>
</svg>`;

export async function office(app) {
  let v, pick = "", chat = [], chatBusy = false, timer = null;
  const load = async () => { v = await api.get("/api/admin/office"); };
  try { await load(); } catch { app.innerHTML = `<div class="panel empty">Not found.</div>`; return; }
  pick = new URLSearchParams(location.hash.split("?")[1] || "").get("desk") || "";

  const deskOf = (id) => v.desks.find((d) => d.id === id);
  const light = (d) => (d.working ? `<span class="of-light work">Working…</span>` : d.report ? `<span class="of-light done">Report ready</span>` : `<span class="of-light idle">Not started</span>`);

  function floor() {
    const btn = (d) => `<button type="button" class="of-room${pick === d.id ? " on" : ""}${d.working ? " working" : ""}" data-desk="${esc(d.id)}" aria-pressed="${pick === d.id}">
        ${room(d)}<span class="of-name"><span aria-hidden="true">${d.emoji}</span> ${esc(d.name)}</span>${light(d)}
        ${d.waiting ? `<span class="of-badge"><span aria-hidden="true">${d.waiting}</span><span class="sr-only">, ${d.waiting} waiting for you</span></span>` : ""}</button>`;
    const [a, b, c, e, f] = v.desks;
    return `<div class="of-floor">${btn(a)}<button type="button" class="of-brain${pick === "memory" ? " on" : ""}" data-desk="memory" aria-pressed="${pick === "memory"}">
        <span class="of-orb" aria-hidden="true">🧠</span><span class="of-name">Shared memory</span><span class="of-light idle">${v.memory.length} notes</span></button>${btn(b)}${btn(c)}${btn(e)}${btn(f)}</div>`;
  }

  function draftCard(x) {
    const ready = x.status === "ready";
    return `<div class="of-draft" data-id="${x.id}"><div class="of-dh"><strong>${esc(KIND[x.kind] || x.kind)}</strong> · <span class="dim small">${esc(x.target_label)} · ${esc(when(x.created_at))}</span>${ready ? ' <span class="badge confirmed">ready to copy</span>' : ""}</div>
      ${x.kind === "task" && !x.subject ? "" : `<label class="small">Title or subject<input class="of-sub" maxlength="160" value="${esc(x.subject)}"${ready ? " readonly" : ""}></label>`}
      <label class="small">${SENDS.has(x.kind) ? "Message (you can edit it before sending)" : "Text"}<textarea class="of-body" rows="${Math.min(12, Math.max(4, x.body.split("\n").length + 1))}" maxlength="3000"${ready ? " readonly" : ""}>${esc(x.body)}</textarea></label>
      <div class="of-acts">${ready ? `<button type="button" class="btn small" data-act="copy">Copy</button><button type="button" class="btn ghost small" data-act="done">Done, remove it</button>`
        : `<button type="button" class="btn small" data-act="approve">${SENDS.has(x.kind) ? "Approve and send email" : "Approve"}</button><button type="button" class="btn ghost small" data-act="copy">Copy</button><button type="button" class="btn ghost small" data-act="reject">Reject</button>`}</div></div>`;
  }

  function panel() {
    if (pick === "memory") return `<div class="panel of-panel" id="ofpanel"><h2 class="sec">🧠 Shared memory</h2><p class="dim small">Every desk reads this before it works. Add your own rules and plans (they always come first), like “Focus on Cicero this month” or “Never message vendors on Sundays”.</p>
      <form id="ofmem" class="copyrow"><input id="ofmemtext" maxlength="400" placeholder="A note for your office" aria-label="A note for your office"><button class="btn small">Add note</button></form>
      ${v.memory.length ? `<ul class="of-mem">${v.memory.map((m) => `<li><span class="tag">${esc(m.desk === "owner" ? "You" : (deskOf(m.desk) || { name: m.desk === "office" ? "Office chat" : m.desk }).name)}</span> ${esc(m.text)} <span class="dim small">${esc(m.on)}</span> <button type="button" class="linkbtn small" data-forget="${m.id}">Delete</button></li>`).join("")}</ul>` : '<p class="dim">Nothing yet.</p>'}</div>`;
    const d = deskOf(pick);
    if (!d) return `<div class="panel of-panel" id="ofpanel"><p>Tap a room to see what that desk did, the drafts it left for you, and to put it to work.</p></div>`;
    const drafts = v.drafts.filter((x) => x.desk === d.id);
    return `<div class="panel of-panel" id="ofpanel"><div class="of-ph"><h2 class="sec"><span aria-hidden="true">${d.emoji}</span> ${esc(d.name)}</h2>
        <button type="button" class="btn small" id="ofrun"${d.working || v.mode === "off" ? " disabled" : ""}>${d.working ? "Working…" : "Run now"}</button></div>
      <p class="dim small">${esc(d.about)}</p>
      <h3>Latest report</h3>${d.report ? `<div class="of-report">${chuyFormat(d.report.text)}</div><p class="dim small">${esc(when(d.report.at))}</p>` : '<p class="dim">No report yet. It works every morning, or tap Run now.</p>'}
      <h3>Waiting for you (${drafts.length})</h3>${drafts.length ? drafts.map(draftCard).join("") : '<p class="dim">Nothing to approve from this desk.</p>'}</div>`;
  }

  function chatBox() {
    return `<div class="panel" id="ofchat"><h2 class="sec">💬 Talk to your office</h2><p class="dim small">Ask anything about the business: “How did we do this week?”, “Which vendors need help?”, “Write a post for Día de Muertos”. It looks up real numbers and can save drafts for you to approve.</p>
      <div class="of-msgs" aria-live="polite">${chat.map((m) => `<div class="of-msg ${m.role}">${m.role === "user" ? esc(m.text) : chuyFormat(m.text)}</div>`).join("")}${chatBusy ? '<div class="of-msg assistant dim">Thinking…</div>' : ""}</div>
      <form id="ofask" class="copyrow"><textarea id="ofq" rows="2" maxlength="2000" placeholder="Ask your office" aria-label="Ask your office"></textarea><button class="btn small"${chatBusy ? " disabled" : ""}>Send</button>${chat.length ? '<button type="button" class="btn ghost small" id="ofnew">New chat</button>' : ""}</form></div>`;
  }

  function draw() {
    if (!app.isConnected) return;
    const u = v.usage;
    app.innerHTML = `<div class="titlebar"><h1>Mi Oficina</h1><div class="chips"><span class="tag">${v.mode === "live" ? "AI: on" : v.mode === "test" ? "AI: test mode (no key)" : "AI: off"}</span><span class="tag">Today $${u.today_usd.toFixed(2)} of $${u.daily_limit_usd} · month $${u.month_usd.toFixed(2)}</span><a class="tag" href="#/admin">Owner dashboard</a></div></div>
      <p class="lead">Your team works every morning and emails you the briefing. They only look things up and write drafts: <strong>nothing goes out until you approve it.</strong></p>
      ${v.mode === "test" ? `<div class="note">Test mode: the desks write simple reports from your real numbers, without AI. Add ANTHROPIC_API_KEY on Render to turn on the full office.</div>` : ""}
      ${floor()}${panel()}${chatBox()}`;
    wire();
  }

  async function refresh() { try { await load(); draw(); } catch { /* keep the screen */ } watch(); }
  function watch() {
    clearTimeout(timer);
    if (app.isConnected && v.desks.some((d) => d.working)) timer = setTimeout(() => { if (app.isConnected) refresh(); }, 3000);
  }

  function wire() {
    app.querySelectorAll("[data-desk]").forEach((b) => (b.onclick = () => { pick = pick === b.dataset.desk ? "" : b.dataset.desk; draw(); if (pick) document.getElementById("ofpanel")?.scrollIntoView({ behavior: "smooth", block: "start" }); }));
    const run = document.getElementById("ofrun");
    if (run) run.onclick = async () => { run.disabled = true; try { v = await api.post("/api/admin/office/run", { desk: pick }); toast("The desk is working on it"); draw(); watch(); } catch (e) { toast(e.message, "error"); run.disabled = false; } };
    app.querySelectorAll(".of-draft").forEach((card) => card.querySelectorAll("[data-act]").forEach((b) => (b.onclick = async () => {
      const act = b.dataset.act, sub = card.querySelector(".of-sub"), body = card.querySelector(".of-body");
      if (act === "copy") { try { await navigator.clipboard.writeText([sub && sub.value, body.value].filter(Boolean).join("\n\n")); toast("Copied"); } catch { body.select(); toast("Select and copy the text"); } return; }
      if (act === "approve" && SENDS.has(v.drafts.find((x) => String(x.id) === card.dataset.id)?.kind) && !confirm("Send this email now?")) return;
      b.disabled = true;
      try {
        const r = await api.post(`/api/admin/office/drafts/${card.dataset.id}`, { action: act, ...(act === "approve" ? { body: body.value, ...(sub ? { subject: sub.value } : {}) } : {}) });
        v = r.office; toast(r.status === "sent" ? "Sent ✓" : r.status === "ready" ? "Approved: ready to copy" : r.status === "rejected" ? "Rejected" : "Done"); draw();
      } catch (e) { toast(e.message, "error"); b.disabled = false; }
    })));
    const mem = document.getElementById("ofmem");
    if (mem) mem.onsubmit = async (e) => { e.preventDefault(); const text = document.getElementById("ofmemtext").value.trim(); if (!text) return; try { v = await api.post("/api/admin/office/memory", { text }); draw(); toast("Saved to memory"); } catch (er) { toast(er.message, "error"); } };
    app.querySelectorAll("[data-forget]").forEach((b) => (b.onclick = async () => { try { v = await api.del(`/api/admin/office/memory/${b.dataset.forget}`); draw(); } catch (e) { toast(e.message, "error"); } }));
    const ask = document.getElementById("ofask"), q = document.getElementById("ofq");
    q.onkeydown = (e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); ask.requestSubmit(); } };
    ask.onsubmit = async (e) => {
      e.preventDefault();
      const text = q.value.trim();
      if (!text || chatBusy) return;
      if (chat.length >= 18) chat = chat.slice(-16); // the server takes up to 20 turns, starting with yours
      chat.push({ role: "user", text }); chatBusy = true; draw();
      try { const r = await api.post("/api/admin/office/chat", { messages: chat }); chat.push({ role: "assistant", text: r.reply }); }
      catch (er) { chat.pop(); toast(er.message, "error"); }
      chatBusy = false;
      try { await load(); } catch { /* keep */ }
      draw(); document.getElementById("ofq")?.focus();
    };
    const fresh = document.getElementById("ofnew");
    if (fresh) fresh.onclick = () => { chat = []; draw(); };
    app.querySelectorAll(".of-report a.chuy-link, .of-msgs a.chuy-link").forEach((a) => a.addEventListener("click", (e) => { e.preventDefault(); location.hash = a.getAttribute("href"); }));
  }

  draw();
  watch();
}
