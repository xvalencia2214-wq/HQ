// Lineup and pay: the musicians or workers a vendor sends to its gigs. The team picks who works each booking (with what
// each gets paid), sends each one the time and address on WhatsApp, and marks them paid; the payroll shows, per month,
// what each person is owed and was paid.
import { HttpError, int, now, str } from "../util.js";
import { normalizePhone } from "../sms.js";
import { getGroup, isTeam, requireOwner } from "../shared.js";
import { durationOf } from "../schedule.js";

const MAX_CREW = 60, MAX_LINEUP = 40;

export default function crewRoutes(ctx, add) {
  const { db } = ctx;
  const crewView = (c) => ({ id: c.id, name: c.name, phone: c.phone, role: c.role, pay_cents: c.pay_cents, active: Boolean(c.active) });
  const fields = (body, cur = {}) => {
    const out = {};
    if (body.name !== undefined || !cur.id) out.name = str(body.name, "Name", { required: true, min: 2, max: 60 });
    if (body.role !== undefined) out.role = str(body.role, "Role", { max: 40 });
    if (body.phone !== undefined) {
      const raw = str(body.phone, "Phone", { max: 30 });
      if (raw && !normalizePhone(raw)) throw new HttpError(400, "Enter a valid US phone number");
      out.phone = raw ? normalizePhone(raw) : "";
    }
    if (body.pay !== undefined) out.pay_cents = Math.round(Number(int(Math.round(Number(body.pay) * 100), "Pay", { min: 0, max: 500000 })));
    if (body.active !== undefined) out.active = body.active ? 1 : 0;
    return out;
  };
  const ownedCrew = (user, id) => {
    const c = db.get("SELECT * FROM crew WHERE id = ?", Number(id));
    if (!c || !isTeam(db, user, getGroup(db, c.group_id))) throw new HttpError(404, "Not found");
    return c;
  };

  add("GET", "/api/groups/:id/crew", ({ params, user }) => {
    const g = requireOwner(db, user, params.id);
    return { crew: db.all("SELECT * FROM crew WHERE group_id = ? ORDER BY active DESC, name", g.id).map(crewView) };
  }, { auth: true });
  add("POST", "/api/groups/:id/crew", ({ params, body, user }) => {
    const g = requireOwner(db, user, params.id);
    if (db.get("SELECT COUNT(*) c FROM crew WHERE group_id = ?", g.id).c >= MAX_CREW) throw new HttpError(400, `Up to ${MAX_CREW} people`);
    const f = fields(body);
    db.run("INSERT INTO crew (group_id, name, phone, role, pay_cents, created_at) VALUES (?, ?, ?, ?, ?, ?)", g.id, f.name, f.phone || "", f.role || "", f.pay_cents || 0, now());
    return { crew: db.all("SELECT * FROM crew WHERE group_id = ? ORDER BY active DESC, name", g.id).map(crewView) };
  }, { auth: true });
  add("PATCH", "/api/crew/:cid", ({ params, body, user }) => {
    const c = ownedCrew(user, params.cid), f = fields(body, c), keys = Object.keys(f);
    if (keys.length) db.run(`UPDATE crew SET ${keys.map((k) => `${k} = ?`).join(", ")} WHERE id = ?`, ...keys.map((k) => f[k]), c.id);
    return { crew: crewView(db.get("SELECT * FROM crew WHERE id = ?", c.id)) };
  }, { auth: true });
  // Someone who already worked a gig is kept (inactive) so the pay history stays right.
  add("DELETE", "/api/crew/:cid", ({ params, user }) => {
    const c = ownedCrew(user, params.cid);
    if (db.get("SELECT 1 AS x FROM booking_crew WHERE crew_id = ?", c.id)) db.run("UPDATE crew SET active = 0 WHERE id = ?", c.id);
    else db.run("DELETE FROM crew WHERE id = ?", c.id);
    return { ok: true };
  }, { auth: true });

  // ---- a booking's lineup ----
  const teamBooking = (user, id) => {
    const b = db.get("SELECT b.*, g.owner_id, g.name AS group_name FROM bookings b JOIN groups g ON g.id = b.group_id WHERE b.id = ?", String(id));
    if (!b || !isTeam(db, user, { id: b.group_id, owner_id: b.owner_id })) throw new HttpError(404, "Booking not found");
    return b;
  };
  const lineupOf = (b) => db.all(`SELECT c.id AS crew_id, c.name, c.role, c.phone, x.pay_cents, x.sent_at, x.paid_at FROM booking_crew x JOIN crew c ON c.id = x.crew_id
    WHERE x.booking_id = ? ORDER BY c.name`, b.id);
  const lineupView = (b) => {
    const arrive = db.get("SELECT at FROM party_timeline WHERE booking_id = ? ORDER BY at LIMIT 1", b.id);
    return {
      booking: { id: b.id, date: b.date, time: b.time, minutes: durationOf(b), event_type: b.event_type, guests: b.guests, status: b.status,
        // the address and the family's name go out to the crew only once the booking is confirmed
        address: b.status === "confirmed" ? b.address : "", customer: b.status === "confirmed" ? b.name : "", arrive: arrive ? arrive.at : "", group_name: b.group_name },
      lineup: lineupOf(b),
      total_cents: lineupOf(b).reduce((n, x) => n + x.pay_cents, 0)
    };
  };
  add("GET", "/api/bookings/:id/lineup", ({ params, user }) => lineupView(teamBooking(user, params.id)), { auth: true });
  add("PUT", "/api/bookings/:id/lineup", ({ params, body, user }) => {
    const b = teamBooking(user, params.id);
    if (!["requested", "confirmed"].includes(b.status)) throw new HttpError(400, "Lineups are for upcoming bookings");
    if (!Array.isArray(body.members) || body.members.length > MAX_LINEUP) throw new HttpError(400, "Pick people from your list");
    const picks = new Map();
    for (const m of body.members) {
      const c = db.get("SELECT * FROM crew WHERE id = ? AND group_id = ?", Number(m && m.crewId), b.group_id);
      if (!c) throw new HttpError(400, "Pick people from your list");
      picks.set(c.id, m.pay !== undefined && m.pay !== null && m.pay !== "" ? int(Math.round(Number(m.pay) * 100), "Pay", { min: 0, max: 500000 }) : c.pay_cents);
    }
    db.tx(() => {
      // people taken off the lineup go; who stays keeps their sent/paid marks
      for (const x of lineupOf(b)) if (!picks.has(x.crew_id)) db.run("DELETE FROM booking_crew WHERE booking_id = ? AND crew_id = ? AND paid_at = 0", b.id, x.crew_id);
      for (const [cid, pay] of picks) db.run(`INSERT INTO booking_crew (booking_id, crew_id, pay_cents) VALUES (?, ?, ?)
        ON CONFLICT(booking_id, crew_id) DO UPDATE SET pay_cents = CASE WHEN paid_at = 0 THEN excluded.pay_cents ELSE pay_cents END`, b.id, cid, pay);
    });
    return lineupView(b);
  }, { auth: true });
  const mark = (col) => ({ params, body, user }) => {
    const b = teamBooking(user, params.id);
    const on = col === "sent_at" ? true : body.paid !== false;
    if (!db.run(`UPDATE booking_crew SET ${col} = ? WHERE booking_id = ? AND crew_id = ?`, on ? now() : 0, b.id, Number(params.cid)).changes) throw new HttpError(404, "Not on this lineup");
    return lineupView(b);
  };
  add("POST", "/api/bookings/:id/lineup/:cid/sent", mark("sent_at"), { auth: true });
  add("POST", "/api/bookings/:id/lineup/:cid/paid", mark("paid_at"), { auth: true });

  // ---- payroll: per person, for the gigs in a month ----
  add("GET", "/api/groups/:id/payroll", ({ params, query, user }) => {
    const g = requireOwner(db, user, params.id);
    const month = /^\d{4}-(0[1-9]|1[0-2])$/.test(query.month || "") ? query.month : new Date().toISOString().slice(0, 7);
    const rows = db.all(`SELECT c.id, c.name, c.role, x.pay_cents, x.paid_at, b.id AS booking_id, b.date, b.time, b.event_type FROM booking_crew x
      JOIN crew c ON c.id = x.crew_id JOIN bookings b ON b.id = x.booking_id
      WHERE c.group_id = ? AND b.date LIKE ? AND b.status IN ('requested','confirmed') ORDER BY b.date, b.time`, g.id, month + "-%");
    const people = new Map();
    for (const r of rows) {
      const p = people.get(r.id) || { id: r.id, name: r.name, role: r.role, gigs: 0, owed_cents: 0, paid_cents: 0, items: [] };
      p.gigs++; if (r.paid_at) p.paid_cents += r.pay_cents; else p.owed_cents += r.pay_cents;
      p.items.push({ booking_id: r.booking_id, date: r.date, time: r.time, event_type: r.event_type, pay_cents: r.pay_cents, paid: Boolean(r.paid_at) });
      people.set(r.id, p);
    }
    const list = [...people.values()].sort((a, b) => b.owed_cents - a.owed_cents || a.name.localeCompare(b.name));
    return { month, people: list, owed_cents: list.reduce((n, p) => n + p.owed_cents, 0), paid_cents: list.reduce((n, p) => n + p.paid_cents, 0) };
  }, { auth: true });
}
