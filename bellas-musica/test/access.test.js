// Access audit: every route in the app, called by someone who is not logged in and by a logged-in stranger, against real
// data that belongs to a vendor and a family. Nothing of theirs may change, and logged-out writes must be refused.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { startApp, client, inDays, makeGroup, bookingBody } from "./helpers.js";

const routesDir = path.resolve("server/routes");
const ROUTES = fs.readdirSync(routesDir).flatMap((f) => [...fs.readFileSync(path.join(routesDir, f), "utf8").matchAll(/add\("(GET|POST|PUT|PATCH|DELETE)", "([^"]+)"/g)].map((m) => ({ method: m[1], path: m[2], file: f })));
// writes anyone may make without an account (sign-up and login, the Stripe webhook, anonymous counters and crash reports,
// the waitlist, and the family-party link whose secret token is the permission)
const PUBLIC_WRITES = new Set(["/api/auth/register", "/api/auth/login", "/api/auth/logout", "/api/auth/forgot", "/api/auth/reset", "/api/auth/verify", "/api/quote", "/api/stripe/webhook", "/api/feed/event", "/api/client-error", "/api/waitlist", "/api/fp/:token/vote", "/api/fp/:token/comments", "/api/fp/:token/picks"]);

test("access audit: logged out, every write is refused (except the public ones); a stranger can't change anyone else's things", async () => {
  assert.ok(ROUTES.length > 150, `found ${ROUTES.length} routes`);
  const S = await startApp({ DEMO_SEED: "0" });
  try {
    const o = client(S.base), c = client(S.base), x = client(S.base), anon = client(S.base);
    await o.signup("acc-o@example.com", "Owen Owner", { phone: "312-555-0170", sms_opt_in: true });
    await c.signup("acc-c@example.com", "Cora Client", { phone: "312-555-0171" });
    await x.signup("acc-x@example.com", "Xavi Stranger", { phone: "312-555-0172" });
    // the vendor's things
    const g = await makeGroup(o, { dates: [inDays(0 + 12), inDays(13), inDays(14)] });
    const pkg = (await o.post(`/api/groups/${g}/packages`, { name: "Serenata", description: "Five songs", hours: 1, price: 300 })).json;
    const addon = (await o.post(`/api/groups/${g}/addons`, { name: "Trumpet", description: "One more", price: 50 })).json;
    const crew = (await o.post(`/api/groups/${g}/crew`, { name: "Toño", role: "Violin", phone: "312-555-0173", pay: 100 })).json;
    const link = (await o.post(`/api/groups/${g}/paylinks`, { clientName: "Karla", date: inDays(14), time: "7:30 PM", hours: 2, event: "Wedding", guests: 80, eventZip: "60608", total: 900, depositPct: 50, days: 3 })).json;
    const inv = (await o.post(`/api/groups/${g}/team/invite`, {})).json;
    // the family's things: a confirmed booking (with an extra and a tip), a party
    const b = (await c.post("/api/bookings", bookingBody(g, inDays(12)))).json.booking;
    await c.post(`/api/bookings/${b.id}/simulate-pay`);
    await o.patch(`/api/bookings/${b.id}`, { action: "accept" });
    const b2 = (await c.post("/api/bookings", bookingBody(g, inDays(13)))).json.booking;
    await c.post(`/api/bookings/${b2.id}/simulate-pay`);
    S.db.run("UPDATE bookings SET date = ? WHERE id = ?", inDays(0), b.id);
    await o.post(`/api/bookings/${b.id}/extras`, { kind: "hour", hours: 1 });
    const extra = S.db.get("SELECT id FROM extras WHERE booking_id = ?", b.id).id;
    const tip = (await c.post(`/api/bookings/${b.id}/tips`, { amount: 20 })).json;
    const party = (await c.post("/api/parties", { name: "Quince de Sofía", date: inDays(12), event: "Quinceañera", guests: 100, zip: "60608", budget: 5000 })).json;
    const partyId = party.party?.id || party.id;
    await c.post(`/api/groups/${g}/messages`, { text: "Hola" });
    const ids = {
      id: [g, b.id, b2.id, partyId], pid: [pkg.package?.id ?? pkg.id], aid: [addon.addon?.id ?? addon.id], eid: [extra], tid: [tip.tip_id], cid: [crew.crew?.id ?? crew.id ?? 1, S.db.get("SELECT id FROM users WHERE email = 'acc-c@example.com'").id],
      lid: [link.link.id], iid: [inv.team?.invites?.[0]?.id ?? "x"], uid: [S.db.get("SELECT id FROM users WHERE email = 'acc-o@example.com'").id], groupId: [g], gid: [g], bid: ["x"], fid: ["x"], token: ["x".repeat(24)], zip: ["60608"]
    };
    for (const [k, v] of Object.entries(ids)) assert.ok(v.every((y) => y !== undefined && y !== null && y !== "undefined"), `setup failed for ${k}: ${JSON.stringify(v)}`);
    assert.ok(S.db.get("SELECT COUNT(*) c FROM crew").c === 1 && S.db.get("SELECT COUNT(*) c FROM pay_links").c === 1 && S.db.get("SELECT COUNT(*) c FROM tips").c === 1 && S.db.get("SELECT COUNT(*) c FROM parties").c === 1 && S.db.get("SELECT COUNT(*) c FROM extras").c === 1, "setup");
    const TABLES = ["groups", "packages", "addons", "availability", "photos", "bookings", "extras", "tips", "crew", "booking_crew", "pay_links", "team_invites", "group_team", "parties", "party_timeline", "balance_parts", "reviews", "bundles", "bundle_members", "push_subs"];
    const snap = () => JSON.stringify(TABLES.map((t) => S.db.all(`SELECT * FROM ${t} ORDER BY rowid`).map((r) => { const { updated_at, ...rest } = r; return rest; })));
    const expand = (p) => { let out = [p]; for (const k of Object.keys(ids)) if (p.includes(":" + k)) out = out.flatMap((q) => ids[k].map((v) => q.replace(":" + k, encodeURIComponent(String(v))))); return out; };
    const BODY = { action: "cancel", name: "Hacked", text: "hacked", note: "hacked", accept: true, received: true, amount: 50, price: 1, hours: 1, kind: "hour", status: "paid", code: "0000", dates: {}, rows: [], ids: [], groupId: g, bookingIds: [b2.id, b.id], reply: "hacked reply", rating: 1, password: "x", hidden: true, weekly_discount_pct: 30, capacity: 20, members: [], picks: [] };

    // 1. logged out: every write needs an account, except the public ones
    const loose = [];
    for (const r of ROUTES) if (r.method !== "GET" && !PUBLIC_WRITES.has(r.path)) for (const u of expand(r.path)) {
      const res = await anon[r.method === "DELETE" ? "del" : r.method.toLowerCase()](u, BODY);
      if (res.status !== 401 && res.status !== 404) loose.push(`${r.method} ${u} -> ${res.status}`);
    }
    assert.deepEqual(loose, [], "logged-out writes that weren't refused");

    // 2. a logged-in stranger tries everything (twice, in case a first call opens something); nothing of theirs changes
    const before = snap(), server500 = [];
    for (let round = 0; round < 2; round++) for (const r of ROUTES) {
      if (/^\/api\/(auth|me)\b/.test(r.path)) continue; // the stranger's own account
      for (const u of expand(r.path)) {
        const res = await x[r.method === "DELETE" ? "del" : r.method.toLowerCase()](u, r.method === "GET" ? undefined : BODY);
        if (res.status >= 500 && !(res.status === 503 && r.path === "/api/stripe/webhook")) server500.push(`${r.method} ${u} -> ${res.status}`);
      }
    }
    assert.deepEqual(server500, [], "server errors");
    const after = snap();
    if (before !== after) {
      const a = JSON.parse(before), z = JSON.parse(after);
      TABLES.forEach((t, i) => { if (JSON.stringify(a[i]) !== JSON.stringify(z[i])) assert.fail(`a stranger changed ${t}: ${JSON.stringify(z[i].filter((row) => !a[i].some((r0) => JSON.stringify(r0) === JSON.stringify(row)))).slice(0, 600)}`); });
    }
    // 3. and can't read private things
    for (const u of [`/api/groups/${g}/bookings`, `/api/groups/${g}/team`, `/api/groups/${g}/crew`, `/api/groups/${g}/paylinks`, `/api/groups/${g}/earnings`, `/api/my/bookings`, `/api/tips/${tip.tip_id}`, `/api/extras/${extra}`, `/api/parties/${partyId}`]) {
      const res = await x.get(u);
      if (u === "/api/my/bookings") assert.equal(res.json.bookings.length, 0);
      else assert.ok([403, 404].includes(res.status), `${u} -> ${res.status}`);
    }
  } finally { await S.close(); }
});
