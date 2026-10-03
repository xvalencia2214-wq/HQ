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
      <td>${g.demo ? '<span class="badge">sample</span> ' : ""}${g.status === "draft" ? '<span class="badge requested">draft</span> ' : ""}${g.status === "paused" ? '<span class="badge cancelled">paused</span> ' : ""}${g.verified ? '<span class="badge confirmed">verified</span> ' : ""}${g.insured ? '<span class="badge confirmed">insured</span> ' : ""}${g.hidden ? '<span class="badge cancelled">hidden</span> ' : ""}${g.promoted_until * 1000 > Date.now() ? '<span class="badge confirmed">featured</span> ' : ""}${!g.demo ? (g.stripe_ready ? '<span class="badge confirmed">payouts ready</span>' : '<span class="badge requested">no payouts yet</span>') : ""}</td>
      <td class="num">${g.active_bookings}</td>
      <td class="acts">${g.demo ? "" : `<button class="btn ghost small" data-badge="verified" data-g="${esc(g.id)}" data-to="${g.verified ? "0" : "1"}">${g.verified ? "Remove verified" : "Mark verified"}</button> <button class="btn ghost small" data-badge="insured" data-g="${esc(g.id)}" data-to="${g.insured ? "0" : "1"}">${g.insured ? "Remove insured" : "Mark insured"}</button> `}<button class="btn ghost small" data-hide="${esc(g.id)}" data-to="${g.hidden ? "0" : "1"}">${g.hidden ? "Unhide" : "Hide"}</button>${g.demo ? "" : ` <button class="btn ghost small" data-feat="${esc(g.id)}" data-days="30">Feature 30 days</button> <button class="btn ghost small" data-feat="${esc(g.id)}" data-days="0">Clear</button>`}</td></tr>`).join("")}
    </tbody></table></div>`;
}

export async function admin(app) {
  let s;
  try { s = await api.get("/api/admin/summary"); }
  catch { app.innerHTML = `<div class="panel empty">Not found.</div>`; return; }
  const b = s.bookings.by_status, live = s.payments === "stripe";
  const statusLine = Object.entries(b).map(([k, v]) => `${v} ${k.replace("_", " ")}`).join(" · ") || "No bookings yet";

  app.innerHTML = `<div class="titlebar"><h1>Owner dashboard</h1><div class="chips"><span class="tag">${live ? "Payments: live" : "Payments: test mode (simulated)"}</span><span class="tag">${s.texts === "twilio" ? "Texts: live" : "Texts: simulated"}</span><span class="tag">${s.email === "resend" ? "Email: live" : "Email: simulated"}</span><span class="tag">Day = ${esc(s.timezone)}</span></div></div>
    ${live ? "" : `<div class="note">Test mode: the numbers below are from simulated payments, not real money.</div>`}
    <div class="hero-fig"><div class="tile-l">Platform fees kept</div><div class="hero-v">${cents(s.money.platform_fees_kept_cents)}</div>
      <div class="tile-s">${s.platform_fee_pct}% of each booking, out of ${cents(s.money.net_deposits_cents)} net deposits. Featured and Pro passes add ${cents(s.money.featured_revenue_cents)}.</div></div>
    <div class="tiles">
      ${tile("Users", s.users.total, `${s.users.last7} in the last 7 days`)}
      ${tile("Real groups", s.groups.real, `${s.groups.sample} sample listings · ${s.groups.hidden} hidden`)}
      ${tile("Bookings", Object.values(b).reduce((a, x) => a + x, 0), statusLine)}
      ${tile("Confirmed booking value", cents(s.bookings.confirmed_value_cents), "total price of confirmed bookings")}
      ${tile("Deposits collected", cents(s.money.deposits_collected_cents), `${cents(s.money.refunded_cents)} refunded`)}
      ${tile("Groups ready for payouts", `${s.groups.payouts_ready} of ${s.groups.real}`, `${s.groups.featured_now} featured now`)}
      ${tile("Texts, last 30 days", `${s.texts_30d.sent} sent`, `${s.texts_30d.failed} failed · ${s.texts_30d.logged_only} logged only`)}
    </div>

    ${s.noshow_reports.length ? `<h2 class="sec">No-show reports to review (${s.noshow_reports.length})</h2><div class="panel">${s.noshow_reports.map((r) => `<div class="req"><div><strong>${esc(r.group_name)}</strong> · ${esc(r.date)} ${esc(r.time)}<br><span class="dim small">${esc(r.customer)} (${esc(r.customer_email)}) paid ${cents(r.paid_cents)} in the app · reported ${when(r.noshow_at)}</span>
      <div class="note small">Customer: “${esc(r.noshow_note)}”<br>${r.noshow_reply ? `Group: “${esc(r.noshow_reply)}”` : "<em>The group has not answered yet.</em>"}</div></div>
      <div><button class="btn small" data-ns="refund" data-b="${esc(r.id)}" data-amt="${r.paid_cents}">Refund ${cents(r.paid_cents)}</button> <button class="btn ghost small" data-ns="reject" data-b="${esc(r.id)}">Not confirmed</button></div></div>`).join("")}</div>` : ""}
    <h2 class="sec">Last 30 days</h2>
    <div class="tiles">${tile("Searches", s.funnel_30d.searches)}${tile("Group pages viewed", s.funnel_30d.group_views)}${tile("Bookings started", s.funnel_30d.booking_started)}${tile("Deposits paid", s.funnel_30d.booking_paid)}${tile("Confirmed by groups", s.funnel_30d.booking_confirmed)}${tile("Sign-ups", s.funnel_30d.signups)}${tile("Discover views", s.funnel_30d.feed_views, `${s.funnel_30d.feed_taps} taps to a profile or chat`)}</div>
    <div class="two"><div class="panel"><h2 class="sec">Where people search</h2>${s.top_zips.length ? `<table class="tbl"><thead><tr><th>ZIP</th><th>City</th><th class="num">Searches</th></tr></thead><tbody>${s.top_zips.map((z) => `<tr><td>${esc(z.zip)}</td><td>${esc(z.city)}</td><td class="num">${z.searches}</td></tr>`).join("")}</tbody></table>` : '<div class="dim">No searches yet.</div>'}</div>
    <div class="panel"><h2 class="sec">Waitlist (${s.waitlist.total})</h2>${s.waitlist.by_city.length ? `<table class="tbl"><thead><tr><th>Place</th><th class="num">Customers</th><th class="num">Groups</th></tr></thead><tbody>${s.waitlist.by_city.map((w) => `<tr><td>${esc(w.place)}</td><td class="num">${w.customers}</td><td class="num">${w.groups}</td></tr>`).join("")}</tbody></table><p><a href="/api/admin/waitlist.csv" download>Download the full list (CSV)</a></p>` : '<div class="dim">Nobody outside your launch area has asked yet.</div>'}</div></div>

    <h2 class="sec">Invite a group</h2>
    <div class="two"><div class="panel"><p class="dim small">Type in what a group sent you (or what you found on their page). You get a private link: when they open it and sign up, the listing is theirs. It stays a draft until they publish.</p>
      <form id="iform"><div class="row"><div><label for="i-name">Group name</label><input id="i-name" name="name" required maxlength="80"></div><div><label for="i-type">Type</label><select id="i-type" name="type">${["Mariachi", "Banda", "Norteño", "Trío romántico", "Grupera", "Conjunto", "DJ", "Other"].map((x) => `<option>${x}</option>`).join("")}</select></div></div>
      <div class="row"><div><label for="i-zip">ZIP</label><input id="i-zip" name="zip" inputmode="numeric" maxlength="5" required></div><div><label for="i-rate">Price per hour ($)</label><input id="i-rate" name="rate" type="number" min="50" max="5000" value="300"></div></div>
      <label for="i-story">Story (optional)</label><textarea id="i-story" name="story" maxlength="800"></textarea><div id="ierr" class="err" role="alert"></div><button class="btn small" type="submit">Create invite link</button></form><div id="iresult"></div></div>
    <div class="panel"><h2 class="sec">Waiting to be claimed (${s.invites.length})</h2>${s.invites.map((i) => `<div class="req"><div><strong>${esc(i.name)}</strong><br><span class="dim small">${esc(i.type)} · ${esc(i.city)} · ${when(i.created_at)}</span></div><div><button class="btn ghost small" data-newlink="${esc(i.id)}">New link</button> <button class="btn ghost small" data-delinv="${esc(i.id)}">Delete</button></div></div>`).join("") || '<div class="dim">None. Links are shown once when you create them; use "New link" if you lose one.</div>'}</div></div>

    <h2 class="sec">Health</h2>
    <div class="tiles">${tile("Email", s.email === "resend" ? "Live" : "Simulated", s.email === "resend" ? "sent through Resend" : "written to the log only")}${tile("Error alerts", s.alerts_on ? "On" : "Off", s.alerts_on ? "failures go to your webhook" : "set ALERT_WEBHOOK_URL")}${tile("Backups", s.backups.enabled ? `${s.backups.count} kept` : "Off", s.backups.enabled ? (s.backups.last_at ? `last: ${when(s.backups.last_at)}` : "none yet") : "set BACKUP_DIR")}</div>

    <h2 class="sec">Groups</h2>${groupsTable(s.groups_list.filter((g) => !g.demo), "No real groups yet. Share the link with your first groups.")}
    ${s.groups_list.some((g) => g.demo) ? `<details class="samples"><summary>${s.groups_list.filter((g) => g.demo).length} sample listings (fictional; set DEMO_SEED=0 to remove)</summary>${groupsTable(s.groups_list.filter((g) => g.demo), "")}</details>` : ""}

    <div class="two"><div class="panel"><h2 class="sec">Find a user</h2><form id="uform" class="chat-form"><input id="uq" placeholder="Email or name" aria-label="Search users"><button class="btn dark" type="submit">Search</button></form><div id="ures"></div><div id="pw"></div></div>
    <div class="panel"><h2 class="sec">Newest sign-ups</h2>${s.recent_signups.map((u) => `<div class="req"><div><strong>${esc(u.name)}</strong><br><span class="dim small">${esc(u.email)}</span></div><div class="dim small">${when(u.created_at)}</div></div>`).join("") || '<div class="dim">None yet.</div>'}</div></div>

    <h2 class="sec">Latest bookings</h2><div class="tbl-wrap"><table class="tbl"><thead><tr><th>Created</th><th>Group</th><th>Event date</th><th>Status</th><th>Deposit</th><th class="num">Total</th></tr></thead><tbody>
    ${s.recent_bookings.map((r) => `<tr><td>${when(r.created_at)}</td><td>${esc(r.group_name)}</td><td>${esc(r.date)}</td><td><span class="badge ${esc(r.status)}">${esc(r.status.replace("_", " "))}</span></td><td>${esc(r.payment_status.replace("_", " "))}</td><td class="num">${cents(r.total_cents)}</td></tr>`).join("") || '<tr><td colspan="6" class="dim">None yet.</td></tr>'}
    </tbody></table></div>

    <div class="two"><div class="panel" id="docs"><h2 class="sec">Licenses and insurance to check (${s.pending_documents})</h2><div class="dim">Loading…</div></div>
    <div class="panel"><h2 class="sec">Partner links</h2><p class="dim small">Give each church, dress shop or school its own link to count the families it sends you.</p>
      <form id="srcform" class="chat-form"><input id="src-name" placeholder="iglesia-san-pio" aria-label="Partner name"><button class="btn dark" type="submit">Make link</button></form><div id="srclink"></div>
      ${s.signup_sources.length ? `<table class="tbl"><thead><tr><th>Source</th><th class="num">Sign-ups (90 days)</th></tr></thead><tbody>${s.signup_sources.map((x) => `<tr><td>${esc(x.source)}</td><td class="num">${x.n}</td></tr>`).join("")}</tbody></table>` : '<div class="dim small">No sign-ups from partner links yet.</div>'}</div></div>

    <h2 class="sec">Audit log</h2><div class="panel">${s.log.map((l) => `<div class="req"><div><strong>${esc(l.action)}</strong> <span class="dim">${esc(l.target)} ${esc(l.details)}</span></div><div class="dim small">${esc(l.admin_email)} · ${when(l.created_at)}</div></div>`).join("") || '<div class="dim">Nothing yet. Every hide, feature and password reset is recorded here.</div>'}</div>`;

  const reload = () => admin(app);
  // documents waiting for review: open the file, then approve (optionally with an expiry date) or reject with a reason
  const drawDocs = async () => {
    const box = document.getElementById("docs"); if (!box) return;
    const { documents } = await api.get("/api/admin/documents");
    box.innerHTML = `<h2 class="sec">Licenses and insurance to check (${documents.length})</h2>` + (documents.map((d) => `<div class="req"><div><strong>${esc(d.group_name)}</strong> · ${esc(d.kind.replace(/_/g, " "))}<br><span class="dim small">${esc(d.type)} · ${when(d.created_at)}</span><br><a href="/api/admin/documents/${esc(d.id)}/file" target="_blank" rel="noopener">Open the file</a></div>
      <div class="req-r"><label class="small">Expires <input type="date" data-exp="${esc(d.id)}"></label><br><button class="btn small" data-docok="${esc(d.id)}">Approve</button> <button class="btn ghost small" data-docno="${esc(d.id)}">Reject</button></div></div>`).join("") || '<div class="dim">Nothing waiting.</div>');
    box.querySelectorAll("[data-docok]").forEach((b) => { b.onclick = async () => { try { await api.post(`/api/admin/documents/${b.dataset.docok}`, { approve: true, expires: box.querySelector(`[data-exp="${b.dataset.docok}"]`).value }); toast("Approved"); drawDocs(); } catch (e) { toast(e.message, "error"); } }; });
    box.querySelectorAll("[data-docno]").forEach((b) => { b.onclick = async () => { const note = prompt("Why? (the vendor sees this)", "The document is unreadable or expired"); if (note === null) return; try { await api.post(`/api/admin/documents/${b.dataset.docno}`, { approve: false, note }); toast("Rejected"); drawDocs(); } catch (e) { toast(e.message, "error"); } }; });
  };
  drawDocs().catch(() => {});
  document.getElementById("srcform").onsubmit = (e) => {
    e.preventDefault();
    const name = document.getElementById("src-name").value.toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/^-|-$/g, "").slice(0, 40);
    if (!name) return;
    const link = `${location.origin}/?src=${name}`;
    document.getElementById("srclink").innerHTML = `<div class="note ok small"><code>${esc(link)}</code></div>`;
  };
  app.querySelectorAll("[data-hide]").forEach((btn) => { btn.onclick = async () => {
    const hide = btn.dataset.to === "1";
    if (hide && !confirm("Hide this group from search, its page, and new bookings? Existing bookings are unaffected.")) return;
    try { await api.post(`/api/admin/groups/${encodeURIComponent(btn.dataset.hide)}/hide`, { hidden: hide }); toast("Done"); reload(); } catch (e) { toast(e.message, "error"); }
  }; });
  app.querySelectorAll("[data-feat]").forEach((btn) => { btn.onclick = async () => {
    try { await api.post(`/api/admin/groups/${encodeURIComponent(btn.dataset.feat)}/feature`, { days: Number(btn.dataset.days) }); toast("Done"); reload(); } catch (e) { toast(e.message, "error"); }
  }; });
  app.querySelectorAll("[data-ns]").forEach((btn) => { btn.onclick = async () => {
    const refund = btn.dataset.ns === "refund";
    if (!confirm(refund ? `Refund ${cents(Number(btn.dataset.amt))} to the customer? The group's payout is reversed.` : "Mark this report as not confirmed? No money moves.")) return;
    try { await api.post(`/api/admin/bookings/${encodeURIComponent(btn.dataset.b)}/noshow`, { refund }); toast("Done"); reload(); } catch (e) { toast(e.message, "error"); }
  }; });
  app.querySelectorAll("[data-badge]").forEach((btn) => { btn.onclick = async () => {
    try { await api.post(`/api/admin/groups/${encodeURIComponent(btn.dataset.g)}/badges`, { [btn.dataset.badge]: btn.dataset.to === "1" }); toast("Done"); reload(); } catch (e) { toast(e.message, "error"); }
  }; });
  const showLink = (url) => {
    document.getElementById("iresult").innerHTML = `<div class="note ok">Private link (shown once). Send it to the group:<br><code id="ilink">${esc(url)}</code><br><button type="button" class="btn small" id="icopy">Copy link</button></div>`;
    document.getElementById("icopy").onclick = async () => { try { await navigator.clipboard.writeText(url); toast("Copied"); } catch { window.prompt("Copy this link", url); } };
  };
  document.getElementById("iform").onsubmit = async (e) => {
    e.preventDefault();
    const f = Object.fromEntries(new FormData(e.target)), err = document.getElementById("ierr"); err.textContent = "";
    try { const r = await api.post("/api/admin/invites", { name: f.name, type: f.type, zip: f.zip, rate: Number(f.rate), story: f.story }); e.target.reset(); showLink(r.claim_url); }
    catch (ex) { err.textContent = ex.message; }
  };
  app.querySelectorAll("[data-newlink]").forEach((btn) => { btn.onclick = async () => { try { showLink((await api.post(`/api/admin/invites/${encodeURIComponent(btn.dataset.newlink)}/regenerate`)).claim_url); } catch (e) { toast(e.message, "error"); } }; });
  app.querySelectorAll("[data-delinv]").forEach((btn) => { btn.onclick = async () => { if (!confirm("Delete this invitation and its draft listing?")) return; try { await api.del(`/api/admin/invites/${encodeURIComponent(btn.dataset.delinv)}`); reload(); } catch (e) { toast(e.message, "error"); } }; });
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
