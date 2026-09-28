import { api } from "../api.js";
import { esc, money, toast } from "../ui.js";

// Owner-only page. English only: it is for the person running the site.
const cents = (c) => (Math.abs(c) >= 1_000_000 ? "$" + new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 }).format(c / 100) : money(c));
const when = (ts) => new Date(ts * 1000).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
const tile = (label, value, sub = "") => `<div class="tile"><div class="tile-l">${esc(label)}</div><div class="tile-v">${esc(value)}</div>${sub ? `<div class="tile-s">${esc(sub)}</div>` : ""}</div>`;

function groupsTable(list, empty) {
  if (!list.length) return `<div class="panel empty small">${esc(empty)}</div>`;
  return `<div class="tbl-wrap"><table class="tbl"><thead><tr><th>Group</th><th>Owner</th><th>Where</th><th>Status</th><th class="num">Active bookings</th><th><span class="sr-only">Actions</span></th></tr></thead><tbody>
    ${list.map((g) => `<tr><td><a href="#/group/${esc(g.id)}">${esc(g.name)}</a></td><td>${esc(g.owner_email || "(sample)")}</td><td>${esc(g.type)} · ${esc(g.city)}</td>
      <td>${g.demo ? '<span class="badge">sample</span> ' : ""}${g.hidden ? '<span class="badge cancelled">hidden</span> ' : ""}${g.promoted_until * 1000 > Date.now() ? '<span class="badge confirmed">featured</span> ' : ""}${!g.demo ? (g.stripe_ready ? '<span class="badge confirmed">payouts ready</span>' : '<span class="badge requested">no payouts yet</span>') : ""}</td>
      <td class="num">${g.active_bookings}</td>
      <td class="acts"><button class="btn ghost small" data-hide="${esc(g.id)}" data-to="${g.hidden ? "0" : "1"}">${g.hidden ? "Unhide" : "Hide"}</button>${g.demo ? "" : ` <button class="btn ghost small" data-feat="${esc(g.id)}" data-days="30">Feature 30 days</button> <button class="btn ghost small" data-feat="${esc(g.id)}" data-days="0">Clear</button>`}</td></tr>`).join("")}
    </tbody></table></div>`;
}

export async function admin(app) {
  let s;
  try { s = await api.get("/api/admin/summary"); }
  catch { app.innerHTML = `<div class="panel empty">Not found.</div>`; return; }
  const b = s.bookings.by_status, live = s.payments === "stripe";
  const statusLine = Object.entries(b).map(([k, v]) => `${v} ${k.replace("_", " ")}`).join(" · ") || "No bookings yet";

  app.innerHTML = `<div class="titlebar"><h1>Owner dashboard</h1><div class="chips"><span class="tag">${live ? "Payments: live" : "Payments: test mode (simulated)"}</span><span class="tag">${s.texts === "twilio" ? "Texts: live" : "Texts: simulated"}</span><span class="tag">Day = ${esc(s.timezone)}</span></div></div>
    ${live ? "" : `<div class="note">Test mode: the numbers below are from simulated payments, not real money.</div>`}
    <div class="hero-fig"><div class="tile-l">Platform fees kept</div><div class="hero-v">${cents(s.money.platform_fees_kept_cents)}</div>
      <div class="tile-s">${s.platform_fee_pct}% of each booking, out of ${cents(s.money.net_deposits_cents)} net deposits. Featured placements add ${cents(s.money.featured_revenue_cents)}.</div></div>
    <div class="tiles">
      ${tile("Users", s.users.total, `${s.users.last7} in the last 7 days`)}
      ${tile("Real groups", s.groups.real, `${s.groups.sample} sample listings · ${s.groups.hidden} hidden`)}
      ${tile("Bookings", Object.values(b).reduce((a, x) => a + x, 0), statusLine)}
      ${tile("Confirmed booking value", cents(s.bookings.confirmed_value_cents), "total price of confirmed bookings")}
      ${tile("Deposits collected", cents(s.money.deposits_collected_cents), `${cents(s.money.refunded_cents)} refunded`)}
      ${tile("Groups ready for payouts", `${s.groups.payouts_ready} of ${s.groups.real}`, `${s.groups.featured_now} featured now`)}
      ${tile("Texts, last 30 days", `${s.texts_30d.sent} sent`, `${s.texts_30d.failed} failed · ${s.texts_30d.logged_only} logged only`)}
    </div>

    <h2 class="sec">Groups</h2>${groupsTable(s.groups_list.filter((g) => !g.demo), "No real groups yet. Share the link with your first groups.")}
    ${s.groups_list.some((g) => g.demo) ? `<details class="samples"><summary>${s.groups_list.filter((g) => g.demo).length} sample listings (fictional; set DEMO_SEED=0 to remove)</summary>${groupsTable(s.groups_list.filter((g) => g.demo), "")}</details>` : ""}

    <div class="two"><div class="panel"><h2 class="sec">Find a user</h2><form id="uform" class="chat-form"><input id="uq" placeholder="Email or name" aria-label="Search users"><button class="btn dark" type="submit">Search</button></form><div id="ures"></div><div id="pw"></div></div>
    <div class="panel"><h2 class="sec">Newest sign-ups</h2>${s.recent_signups.map((u) => `<div class="req"><div><strong>${esc(u.name)}</strong><br><span class="dim small">${esc(u.email)}</span></div><div class="dim small">${when(u.created_at)}</div></div>`).join("") || '<div class="dim">None yet.</div>'}</div></div>

    <h2 class="sec">Latest bookings</h2><div class="tbl-wrap"><table class="tbl"><thead><tr><th>Created</th><th>Group</th><th>Event date</th><th>Status</th><th>Deposit</th><th class="num">Total</th></tr></thead><tbody>
    ${s.recent_bookings.map((r) => `<tr><td>${when(r.created_at)}</td><td>${esc(r.group_name)}</td><td>${esc(r.date)}</td><td><span class="badge ${esc(r.status)}">${esc(r.status.replace("_", " "))}</span></td><td>${esc(r.payment_status.replace("_", " "))}</td><td class="num">${cents(r.total_cents)}</td></tr>`).join("") || '<tr><td colspan="6" class="dim">None yet.</td></tr>'}
    </tbody></table></div>

    <h2 class="sec">Audit log</h2><div class="panel">${s.log.map((l) => `<div class="req"><div><strong>${esc(l.action)}</strong> <span class="dim">${esc(l.target)} ${esc(l.details)}</span></div><div class="dim small">${esc(l.admin_email)} · ${when(l.created_at)}</div></div>`).join("") || '<div class="dim">Nothing yet. Every hide, feature and password reset is recorded here.</div>'}</div>`;

  const reload = () => admin(app);
  app.querySelectorAll("[data-hide]").forEach((btn) => { btn.onclick = async () => {
    const hide = btn.dataset.to === "1";
    if (hide && !confirm("Hide this group from search, its page, and new bookings? Existing bookings are unaffected.")) return;
    try { await api.post(`/api/admin/groups/${encodeURIComponent(btn.dataset.hide)}/hide`, { hidden: hide }); toast("Done"); reload(); } catch (e) { toast(e.message, "error"); }
  }; });
  app.querySelectorAll("[data-feat]").forEach((btn) => { btn.onclick = async () => {
    try { await api.post(`/api/admin/groups/${encodeURIComponent(btn.dataset.feat)}/feature`, { days: Number(btn.dataset.days) }); toast("Done"); reload(); } catch (e) { toast(e.message, "error"); }
  }; });
  const search = async (q) => {
    const { users } = await api.get("/api/admin/users?q=" + encodeURIComponent(q));
    document.getElementById("ures").innerHTML = users.length ? users.map((u) => `<div class="req"><div><strong>${esc(u.name)}</strong><br><span class="dim small">${esc(u.email)} · ${u.groups} groups · ${u.bookings} bookings</span></div><button class="btn ghost small" data-reset="${u.id}" data-email="${esc(u.email)}">Reset password</button></div>`).join("") : '<div class="dim">No match.</div>';
    document.querySelectorAll("[data-reset]").forEach((btn) => { btn.onclick = async () => {
      if (!confirm(`Reset the password for ${btn.dataset.email}? They will be signed out everywhere.`)) return;
      try {
        const r = await api.post(`/api/admin/users/${btn.dataset.reset}/reset-password`);
        document.getElementById("pw").innerHTML = `<div class="note ok">Temporary password for <strong>${esc(r.email)}</strong>: <code>${esc(r.temporary_password)}</code><br>Tell them privately, and ask them to change it under Account.</div>`;
      } catch (e) { toast(e.message, "error"); }
    }; });
  };
  document.getElementById("uform").onsubmit = (e) => { e.preventDefault(); search(document.getElementById("uq").value.trim()).catch((x) => toast(x.message, "error")); };
}
