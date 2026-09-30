import { HttpError, now, rid, str } from "../util.js";
import { LIVE_SQL, firstPhotos, publicGroup, ratingMap, ratingOf } from "../shared.js";

const MAX_SAVED = 100, MAX_SHORTLISTS = 20;

// Saved groups (the heart) and read-only shortlists: a link to a snapshot of the groups you picked, for a partner or a family group chat.
export default function favoriteRoutes(ctx, add) {
  const { db, config } = ctx;

  // Cards for a list of group ids: only groups that are live right now, in the order given.
  function cards(ids) {
    if (!ids.length) return [];
    const rows = db.all(`SELECT * FROM groups WHERE ${LIVE_SQL} AND id IN (${ids.map(() => "?").join(",")})`, ...ids);
    const byId = new Map(rows.map((g) => [g.id, g]));
    const ratings = ratingMap(db), photos = firstPhotos(db);
    const minPrice = new Map(db.all("SELECT group_id, MIN(price_cents) m FROM packages WHERE private_customer_id IS NULL GROUP BY group_id").map((r) => [r.group_id, r.m]));
    return ids.filter((id) => byId.has(id)).map((id) => {
      const g = byId.get(id);
      return publicGroup(ctx, g, { rating: ratingOf(g, ratings), fields: { photo: photos.has(g.id) ? "/uploads/" + photos.get(g.id) : null, from_cents: minPrice.get(g.id) ?? g.rate_cents } });
    });
  }
  const savedIds = (userId) => db.all("SELECT group_id FROM favorites WHERE user_id = ? ORDER BY created_at DESC, rowid DESC", userId).map((r) => r.group_id);

  add("GET", "/api/my/favorites", ({ query, user }) => {
    const ids = savedIds(user.id);
    if (query.ids) return { ids }; // just the hearts, for the buttons on every card
    return { groups: cards(ids), ids };
  }, { auth: true });

  // Idempotent: { saved: true } saves, { saved: false } removes; asking twice changes nothing.
  add("POST", "/api/favorites/:groupId", ({ params, body, user }) => {
    const id = str(params.groupId, "Group", { required: true, max: 80 });
    if (body.saved === false) { db.run("DELETE FROM favorites WHERE user_id = ? AND group_id = ?", user.id, id); return { saved: false }; }
    if (!db.get(`SELECT 1 AS x FROM groups WHERE id = ? AND ${LIVE_SQL}`, id)) throw new HttpError(404, "Group not found");
    if (!db.get("SELECT 1 AS x FROM favorites WHERE user_id = ? AND group_id = ?", user.id, id)) {
      if (db.get("SELECT COUNT(*) c FROM favorites WHERE user_id = ?", user.id).c >= MAX_SAVED) throw new HttpError(400, `You can save up to ${MAX_SAVED} groups.`);
      db.run("INSERT INTO favorites (user_id, group_id, created_at) VALUES (?, ?, ?)", user.id, id, now());
    }
    return { saved: true };
  }, { auth: true });

  // Snapshot the current hearts into a link anyone can open. Later changes to your hearts don't change the link.
  add("POST", "/api/shortlists", ({ body, user }) => {
    const live = cards(savedIds(user.id));
    if (!live.length) throw new HttpError(400, "Save at least one group first.");
    if (db.get("SELECT COUNT(*) c FROM shortlists WHERE user_id = ?", user.id).c >= MAX_SHORTLISTS) throw new HttpError(400, "You have too many shared lists. Remove one first.");
    const token = rid(12);
    const title = str(body.title, "Title", { max: 60 });
    db.tx(() => {
      db.run("INSERT INTO shortlists (token, user_id, title, created_at) VALUES (?, ?, ?, ?)", token, user.id, title, now());
      live.forEach((g, i) => db.run("INSERT INTO shortlist_items (token, group_id, position) VALUES (?, ?, ?)", token, g.id, i));
    });
    return { token, url: `${config.baseUrl}/#/shortlist/${token}` };
  }, { auth: true });

  // Public: anyone with the link. Shows only groups that are still live, and only the sharer's first name.
  add("GET", "/api/shortlists/:token", ({ params }) => {
    if (!/^[\w-]{12,40}$/.test(params.token)) throw new HttpError(404, "This list isn't available.");
    const s = db.get("SELECT s.title, u.name FROM shortlists s JOIN users u ON u.id = s.user_id WHERE s.token = ?", params.token);
    if (!s) throw new HttpError(404, "This list isn't available.");
    const ids = db.all("SELECT group_id FROM shortlist_items WHERE token = ? ORDER BY position", params.token).map((r) => r.group_id);
    return { title: s.title, by: String(s.name).trim().split(/\s+/)[0], groups: cards(ids) };
  });

  add("GET", "/api/my/shortlists", ({ user }) => ({
    shortlists: db.all("SELECT token, title, created_at, (SELECT COUNT(*) FROM shortlist_items i WHERE i.token = shortlists.token) AS n FROM shortlists WHERE user_id = ? ORDER BY created_at DESC", user.id)
      .map((s) => ({ ...s, url: `${config.baseUrl}/#/shortlist/${s.token}` }))
  }), { auth: true });

  add("DELETE", "/api/shortlists/:token", ({ params, user }) => {
    const res = db.run("DELETE FROM shortlists WHERE token = ? AND user_id = ?", params.token, user.id);
    if (res.changes !== 1) throw new HttpError(404, "List not found");
    return { ok: true };
  }, { auth: true });
}
