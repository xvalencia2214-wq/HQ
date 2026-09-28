import crypto from "node:crypto";
import { HttpError, str } from "../util.js";
import { lookupZip } from "../geo.js";

export const hashClaim = (t) => crypto.createHash("sha256").update(String(t)).digest("hex");

// You create a draft listing from what a group sent you and give them a one-time link. Whoever opens it while logged in owns it.
export default function claimRoutes(ctx, add) {
  const { db, stripe, limiters } = ctx;
  const find = (token) => {
    if (typeof token !== "string" || token.length < 20 || token.length > 100) return null;
    return db.get("SELECT * FROM groups WHERE claim_token_hash = ? AND claim_token_hash != '' AND owner_id IS NULL", hashClaim(token));
  };

  add("GET", "/api/claim/:token", ({ params, ip }) => {
    if (!limiters.auth.check(`${ip}|claim`)) throw new HttpError(429, "Too many attempts. Try again later.");
    const g = find(params.token);
    if (!g) throw new HttpError(404, "This invitation link is not valid any more.");
    const z = lookupZip(g.zip);
    return { group: { name: g.name, type: g.type, city: z ? `${z.city}, ${z.state}` : "", story: g.story } };
  });

  add("POST", "/api/claim/:token", ({ params, user, ip }) => {
    if (!limiters.auth.check(`${ip}|claim`)) throw new HttpError(429, "Too many attempts. Try again later.");
    if (db.get("SELECT COUNT(*) c FROM groups WHERE owner_id = ?", user.id).c >= 5) throw new HttpError(400, "Group limit reached");
    const g = find(params.token);
    if (!g) throw new HttpError(404, "This invitation link is not valid any more.");
    // Compare-and-set so two people opening the link at once can't both win.
    const res = db.run("UPDATE groups SET owner_id = ?, claim_token_hash = '', invited = 0 WHERE id = ? AND owner_id IS NULL AND claim_token_hash = ?", user.id, g.id, hashClaim(params.token));
    if (res.changes !== 1) throw new HttpError(409, "Someone already claimed this listing.");
    if (!stripe.live) db.run("UPDATE groups SET stripe_ready = 1 WHERE id = ?", g.id);
    return { ok: true, group_id: g.id };
  }, { auth: true });
}
