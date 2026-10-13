import { HttpError, int, now, oneOf, rid, str, todayStr } from "../util.js";
import { maskContact } from "./messages.js";

// The guest list of a saved party, RSVPs by link (sent one by one on WhatsApp, or one open link for a family group chat),
// and the court of honor and padrinos of a quinceañera or wedding. The Knot and Zola have guest lists and RSVPs, but only
// for weddings and only in English; this one is built for quinces, bautizos and backyard parties, in both languages.
const MAX_GUESTS = 600, MAX_SEATS = 20, MAX_COURT = 60;
const RSVP = ["yes", "no", "maybe"];

export default function guestRoutes(ctx, add) {
  const { db, limiters, config } = ctx;
  const ownParty = (user, id) => {
    const p = db.get("SELECT * FROM parties WHERE id = ?", String(id));
    if (!p || p.customer_id !== user.id) throw new HttpError(404, "Party not found");
    return p;
  };
  const phoneOf = (v) => {
    if (v === undefined || v === null || v === "") return "";
    const d = String(v).replace(/\D/g, "");
    if (d.length === 10) return d;
    if (d.length === 11 && d[0] === "1") return d.slice(1);
    throw new HttpError(400, "Phone numbers have 10 digits, like 773-555-0101");
  };
  const ensureLink = (p) => {
    if (p.rsvp_token) return p.rsvp_token;
    const token = rid(12);
    db.run("UPDATE parties SET rsvp_token = ? WHERE id = ? AND rsvp_token = ''", token, p.id);
    return db.get("SELECT rsvp_token FROM parties WHERE id = ?", p.id).rsvp_token;
  };
  const guestView = (g) => ({ id: g.id, name: g.name, seats: g.seats, side: g.side, phone: g.phone, rsvp: g.rsvp, coming: g.coming, note: g.note, source: g.source, responded_at: g.responded_at, url: `${config.baseUrl}/#/rsvp/${g.token}` });
  function listView(p) {
    const guests = db.all("SELECT * FROM party_guests WHERE party_id = ? ORDER BY side, name COLLATE NOCASE, id", p.id);
    const sum = (f) => guests.reduce((n, g) => n + f(g), 0);
    return {
      guests: guests.map(guestView),
      totals: { invited: sum((g) => g.seats), yes: sum((g) => (g.rsvp === "yes" ? g.coming : 0)), no: guests.filter((g) => g.rsvp === "no").length, maybe: guests.filter((g) => g.rsvp === "maybe").length, waiting: guests.filter((g) => !g.rsvp).length, rows: guests.length },
      court: db.all("SELECT id, role, name, phone FROM party_court WHERE party_id = ? ORDER BY position, id", p.id),
      rsvp_url: `${config.baseUrl}/#/rsvp/${ensureLink(p)}`, rsvp_note: p.rsvp_note, rsvp_by: p.rsvp_by
    };
  }
  const guestFields = (b, cur = {}) => {
    const out = {};
    if (b.name !== undefined || !cur.id) out.name = maskContact(str(b.name, "Name", { min: 1, max: 60 })).text;
    if (b.seats !== undefined) out.seats = int(b.seats, "How many people", { min: 1, max: MAX_SEATS });
    if (b.side !== undefined) out.side = maskContact(str(b.side, "Group", { max: 40 })).text;
    if (b.phone !== undefined) out.phone = phoneOf(b.phone);
    if (b.rsvp !== undefined) out.rsvp = b.rsvp === "" ? "" : oneOf(b.rsvp, "Answer", RSVP);
    if (b.coming !== undefined) out.coming = int(b.coming, "How many are coming", { min: 0, max: MAX_SEATS });
    if (b.note !== undefined) out.note = maskContact(str(b.note, "Note", { max: 200 })).text;
    return out;
  };
  const insertGuest = (p, f, source = "host") => {
    if (db.get("SELECT COUNT(*) c FROM party_guests WHERE party_id = ?", p.id).c >= MAX_GUESTS) throw new HttpError(400, `At most ${MAX_GUESTS} names on a guest list`);
    const seats = f.seats || 1;
    const info = db.run("INSERT INTO party_guests (party_id, name, seats, side, phone, token, rsvp, coming, note, source, responded_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      p.id, f.name, seats, f.side || "", f.phone || "", rid(12), f.rsvp || "", f.rsvp === "yes" ? Math.min(f.coming ?? seats, seats) : 0, f.note || "", source, f.rsvp ? now() : 0, now());
    return info.lastInsertRowid;
  };

  // ---- the host ----
  add("GET", "/api/parties/:id/guests", ({ params, user }) => listView(ownParty(user, params.id)), { auth: true });

  // one guest, or many pasted at once ("Name, 2, Mom's side, 773-555-0101" per line)
  add("POST", "/api/parties/:id/guests", ({ params, body, user }) => {
    const p = ownParty(user, params.id);
    if (typeof body.lines === "string") {
      const rows = body.lines.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
      if (!rows.length) throw new HttpError(400, "Write one name per line");
      if (rows.length > 300) throw new HttpError(400, "At most 300 names at a time");
      const parsed = rows.map((line, i) => {
        const parts = line.split(/\s*[,;\t]\s*/);
        const f = { name: parts[0] };
        for (const x of parts.slice(1)) {
          if (/^\d{1,2}$/.test(x)) f.seats = Number(x);
          else if (x.replace(/\D/g, "").length >= 7) f.phone = x; // looks like a phone: checked below
          else if (x) f.side = x;
        }
        try { return guestFields(f); } catch (e) { throw new HttpError(400, `Line ${i + 1}: ${e.message}`); }
      });
      db.tx(() => { for (const f of parsed) insertGuest(p, f); });
    } else insertGuest(p, guestFields(body));
    return listView(p);
  }, { auth: true });

  add("PATCH", "/api/parties/:id/guests/:gid", ({ params, body, user }) => {
    const p = ownParty(user, params.id);
    const g = db.get("SELECT * FROM party_guests WHERE id = ? AND party_id = ?", params.gid, p.id);
    if (!g) throw new HttpError(404, "Guest not found");
    const f = guestFields(body, g);
    const seats = f.seats ?? g.seats, rsvp = f.rsvp ?? g.rsvp;
    if (f.rsvp !== undefined || f.coming !== undefined || f.seats !== undefined) {
      f.coming = rsvp === "yes" ? Math.min(f.coming ?? (g.rsvp === "yes" ? g.coming : seats), seats) : 0;
      if (f.rsvp !== undefined && f.rsvp !== g.rsvp) f.responded_at = f.rsvp ? now() : 0;
    }
    const keys = Object.keys(f);
    if (keys.length) db.run(`UPDATE party_guests SET ${keys.map((k) => `${k} = ?`).join(", ")} WHERE id = ?`, ...keys.map((k) => f[k]), g.id);
    return listView(p);
  }, { auth: true });

  add("DELETE", "/api/parties/:id/guests/:gid", ({ params, user }) => {
    const p = ownParty(user, params.id);
    db.run("DELETE FROM party_guests WHERE id = ? AND party_id = ?", params.gid, p.id);
    return listView(p);
  }, { auth: true });

  // what guests read on the invitation page, the RSVP deadline, and a new open link (the old one stops working)
  add("PATCH", "/api/parties/:id/rsvp", ({ params, body, user }) => {
    const p = ownParty(user, params.id);
    if (body.note !== undefined) db.run("UPDATE parties SET rsvp_note = ? WHERE id = ?", maskContact(str(body.note, "Message for your guests", { max: 400 })).text, p.id);
    if (body.by !== undefined) {
      if (body.by !== "" && (!/^\d{4}-\d{2}-\d{2}$/.test(body.by) || body.by > p.date)) throw new HttpError(400, "Pick a date before the party");
      db.run("UPDATE parties SET rsvp_by = ? WHERE id = ?", body.by, p.id);
    }
    if (body.newLink === true) db.run("UPDATE parties SET rsvp_token = ? WHERE id = ?", rid(12), p.id);
    return listView(db.get("SELECT * FROM parties WHERE id = ?", p.id));
  }, { auth: true });

  // court of honor and padrinos: replaced as a whole, like the timeline
  add("PUT", "/api/parties/:id/court", ({ params, body, user }) => {
    const p = ownParty(user, params.id);
    if (!Array.isArray(body.items) || body.items.length > MAX_COURT) throw new HttpError(400, `At most ${MAX_COURT} people`);
    const rows = body.items.map((it) => ({ role: maskContact(str(it?.role, "Role", { min: 1, max: 60 })).text, name: maskContact(str(it?.name, "Name", { min: 1, max: 60 })).text, phone: phoneOf(it?.phone) }));
    db.tx(() => {
      db.run("DELETE FROM party_court WHERE party_id = ?", p.id);
      rows.forEach((r, i) => db.run("INSERT INTO party_court (party_id, role, name, phone, position) VALUES (?, ?, ?, ?, ?)", p.id, r.role, r.name, r.phone, i));
    });
    return listView(p);
  }, { auth: true });

  // ---- the guest: the invitation page (no account), from a personal link or the open one ----
  const byToken = (token) => {
    const t = String(token || "");
    if (!/^[\w-]{12,24}$/.test(t)) throw new HttpError(404, "This invitation link doesn't work. Ask the host for a new one.");
    const g = db.get("SELECT * FROM party_guests WHERE token = ?", t);
    if (g) return { p: db.get("SELECT * FROM parties WHERE id = ?", g.party_id), g };
    const p = db.get("SELECT * FROM parties WHERE rsvp_token = ?", t);
    if (!p) throw new HttpError(404, "This invitation link doesn't work. Ask the host for a new one.");
    return { p, g: null };
  };
  const invitation = (p, g) => ({
    party: { title: p.title, event: p.event, date: p.date, host: (db.get("SELECT name FROM users WHERE id = ?", p.customer_id)?.name || "").split(" ")[0], note: p.rsvp_note, by: p.rsvp_by, past: p.date < todayStr() },
    guest: g ? { name: g.name, seats: g.seats, rsvp: g.rsvp, coming: g.coming, note: g.note } : null
  });
  add("GET", "/api/rsvp/:token", ({ params }) => { const { p, g } = byToken(params.token); return invitation(p, g); });
  add("POST", "/api/rsvp/:token", ({ params, body, ip }) => {
    if (!limiters.chat.check("rsvp:" + ip)) throw new HttpError(429, "Too many answers. Wait a minute.");
    const { p, g } = byToken(params.token);
    if (p.date < todayStr()) throw new HttpError(400, "This party already happened.");
    const rsvp = oneOf(body.rsvp, "Answer", RSVP);
    const note = maskContact(str(body.note, "Note", { max: 200 })).text;
    if (g) {
      const coming = rsvp === "yes" ? int(body.coming ?? g.seats, "How many are coming", { min: 1, max: g.seats }) : 0;
      db.run("UPDATE party_guests SET rsvp = ?, coming = ?, note = ?, responded_at = ? WHERE id = ?", rsvp, coming, note, now(), g.id);
      return { ...invitation(p, db.get("SELECT * FROM party_guests WHERE id = ?", g.id)), token: g.token };
    }
    // the open link: the guest writes their name; they get their own link back to change the answer later
    const name = maskContact(str(body.name, "Your name", { min: 2, max: 60 })).text;
    const coming = rsvp === "yes" ? int(body.coming ?? 1, "How many are coming", { min: 1, max: 10 }) : 0;
    const id = insertGuest(p, { name, seats: Math.max(1, coming), rsvp, coming, note }, "open");
    const ng = db.get("SELECT * FROM party_guests WHERE id = ?", id);
    return { ...invitation(p, ng), token: ng.token };
  });
}
