// Team logins: the owner invites helpers (the band leader's wife, a manager, an office person) who can answer requests and
// messages, run the calendar and lineups. The invite is a one-time link the owner sends by WhatsApp or email.
import crypto from "node:crypto";
import { HttpError, now, rid, str } from "../util.js";
import { getGroup, newId, requireOwner, requireRealOwner } from "../shared.js";

const MAX_TEAM = 10, INVITE_DAYS = 7;
const hash = (t) => crypto.createHash("sha256").update("team:" + String(t)).digest("hex");
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export default function teamRoutes(ctx, add) {
  const { db, config, notify } = ctx;

  const teamView = (g) => ({
    owner: (() => { const u = db.get("SELECT id, name, email FROM users WHERE id = ?", g.owner_id); return u ? { id: u.id, name: u.name, email: u.email } : null; })(),
    members: db.all("SELECT u.id, u.name, u.email, t.created_at FROM group_team t JOIN users u ON u.id = t.user_id WHERE t.group_id = ? ORDER BY t.created_at", g.id),
    invites: db.all("SELECT id, email, created_at, expires_at FROM team_invites WHERE group_id = ? AND used_at = 0 AND expires_at > ? ORDER BY created_at DESC", g.id, now())
  });

  add("GET", "/api/groups/:id/team", ({ params, user }) => {
    const g = requireOwner(db, user, params.id);
    return { team: teamView(g), my_role: g.owner_id === user.id ? "owner" : "manager" };
  }, { auth: true });

  add("POST", "/api/groups/:id/team/invite", ({ params, body, user }) => {
    const g = requireRealOwner(db, user, params.id);
    const email = str(body.email, "Email", { max: 120 }).toLowerCase();
    if (email && !EMAIL_RE.test(email)) throw new HttpError(400, "Enter a valid email, or leave it empty to share the link yourself");
    const count = db.get("SELECT COUNT(*) c FROM group_team WHERE group_id = ?", g.id).c + db.get("SELECT COUNT(*) c FROM team_invites WHERE group_id = ? AND used_at = 0 AND expires_at > ?", g.id, now()).c;
    if (count >= MAX_TEAM) throw new HttpError(400, `A listing can have up to ${MAX_TEAM} helpers`);
    if (email && email === String(user.email).toLowerCase()) throw new HttpError(400, "That's you: you already own this listing");
    // invitations send email to any address: a few a day is plenty for a real team
    if (db.get("SELECT COUNT(*) c FROM team_invites WHERE created_by = ? AND created_at > ?", user.id, now() - 86400).c >= 15) throw new HttpError(429, "That's a lot of invitations for one day. Try again tomorrow.");
    const token = rid(24), id = newId("ti");
    db.run("INSERT INTO team_invites (id, group_id, email, token_hash, created_by, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?)", id, g.id, email, hash(token), user.id, now(), now() + INVITE_DAYS * 86400);
    const url = `${config.baseUrl}/#/team/${token}`;
    if (email) {
      const existing = db.get("SELECT id, lang FROM users WHERE email = ?", email);
      if (existing) notify.to(existing.id, "team.invite", { group: g.name, from: user.name, url });
      else notify.toEmail(email, user.lang, "team.invite", { group: g.name, from: user.name, url });
    }
    return { url, team: teamView(g) };
  }, { auth: true });

  add("DELETE", "/api/groups/:id/team/invites/:iid", ({ params, user }) => {
    const g = requireRealOwner(db, user, params.id);
    db.run("UPDATE team_invites SET expires_at = 0 WHERE id = ? AND group_id = ?", params.iid, g.id);
    return { team: teamView(g) };
  }, { auth: true });

  // The owner removes someone, or a helper leaves on their own.
  add("DELETE", "/api/groups/:id/team/:uid", ({ params, user }) => {
    const g = getGroup(db, params.id), uid = Number(params.uid);
    if (!(g.owner_id === user.id || uid === user.id)) throw new HttpError(403, "Only the owner of this listing can do that");
    if (!db.run("DELETE FROM group_team WHERE group_id = ? AND user_id = ?", g.id, uid).changes) throw new HttpError(404, "Not on the team");
    return g.owner_id === user.id ? { team: teamView(g) } : { left: true };
  }, { auth: true });

  // The invite page: who is inviting you, to which listing.
  const findInvite = (token) => {
    const inv = /^[\w-]{20,64}$/.test(String(token)) ? db.get("SELECT * FROM team_invites WHERE token_hash = ?", hash(token)) : null;
    if (!inv || inv.used_at || inv.expires_at <= now()) throw new HttpError(404, "This invitation isn't valid any more. Ask for a new one.");
    return inv;
  };
  add("GET", "/api/team-invite/:token", ({ params }) => {
    const inv = findInvite(params.token), g = getGroup(db, inv.group_id);
    const from = db.get("SELECT name FROM users WHERE id = ?", inv.created_by);
    return { invite: { group: g.name, group_id: g.id, type: g.type, from: from ? from.name.split(" ")[0] : "" } };
  });
  add("POST", "/api/team-invite/:token/accept", ({ params, user }) => {
    const inv = findInvite(params.token), g = getGroup(db, inv.group_id);
    if (g.owner_id === user.id) throw new HttpError(400, "You already own this listing");
    // an invitation sent to an email address is for that person's account only (a forwarded link isn't enough)
    if (inv.email && inv.email !== String(user.email).toLowerCase()) throw new HttpError(403, `This invitation is for ${inv.email.replace(/^(.).*(@.*)$/, "$1…$2")}. Log in with that account.`);
    db.tx(() => {
      db.run("INSERT OR IGNORE INTO group_team (group_id, user_id, added_by, created_at) VALUES (?, ?, ?, ?)", g.id, user.id, inv.created_by, now());
      db.run("UPDATE team_invites SET used_by = ?, used_at = ? WHERE id = ? AND used_at = 0", user.id, now(), inv.id);
    });
    if (g.owner_id) notify.to(g.owner_id, "team.joined", { group: g.name, member: user.name, url: `${config.baseUrl}/#/dashboard?g=${g.id}&tab=listing` });
    return { group_id: g.id };
  }, { auth: true });
}
