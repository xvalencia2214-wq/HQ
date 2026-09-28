import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { startApp, client, inDays, makeGroup, bookingBody, fakeStripe } from "./helpers.js";
import { openDb } from "../server/db.js";

const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(64, 1)]).toString("base64");
const mine = async (c, id) => (await c.get("/api/my/groups")).json.groups.find((g) => g.id === id);

test("new listings are drafts: invisible until they meet the bar, then live; pausing hides them again", async () => {
  const S = await startApp();
  try {
    const owner = client(S.base), other = client(S.base), anon = client(S.base);
    await owner.signup("pb-o@example.com", "Pub Owner"); await other.signup("pb-x@example.com", "Pub Other");
    const gid = (await owner.post("/api/groups", { name: "Draft Band", type: "Mariachi", zip: "60608", rate: 300, members: 5, story: "Too short" })).json.id;
    let g = await mine(owner, gid);
    assert.equal(g.status, "draft"); assert.deepEqual(g.publish_missing, ["photos", "story", "events", "dates"]);
    // invisible to everyone but the owner
    assert.equal((await anon.get(`/api/groups/${gid}`)).status, 404); assert.equal((await other.get(`/api/groups/${gid}`)).status, 404);
    assert.equal((await owner.get(`/api/groups/${gid}`)).status, 200);
    assert.ok(!(await anon.get("/api/search?zip=60608&limit=50")).json.results.some((x) => x.id === gid));
    assert.doesNotMatch(await (await fetch(S.base + `/g/${gid}`)).text(), /Draft Band/);
    assert.doesNotMatch(await (await fetch(S.base + "/sitemap.xml")).text(), new RegExp(gid));
    assert.equal((await other.post("/api/bookings", bookingBody(gid, inDays(30)))).status, 404);
    // publishing: names exactly what is missing, and only succeeds when everything is there
    let r = await owner.post(`/api/groups/${gid}/publish`);
    assert.equal(r.status, 400); assert.deepEqual(r.json.missing, ["photos", "story", "events", "dates"]);
    await owner.post(`/api/groups/${gid}/photos`, { data: PNG });
    await owner.patch(`/api/groups/${gid}`, { story: "We are a family mariachi from Pilsen and we love playing for quinceañeras.", events: ["Quinceañera"] });
    assert.deepEqual((await owner.post(`/api/groups/${gid}/publish`)).json.missing, ["dates"]);
    await owner.post(`/api/groups/${gid}/availability/weekends`, { weeks: 2 });
    r = await owner.post(`/api/groups/${gid}/publish`); assert.equal(r.status, 200); assert.equal(r.json.status, "live");
    assert.ok(S.db.get("SELECT published_at p FROM groups WHERE id = ?", gid).p > 0);
    assert.equal((await anon.get(`/api/groups/${gid}`)).status, 200);
    assert.ok((await anon.get("/api/search?zip=60608&limit=50")).json.results.some((x) => x.id === gid));
    assert.match(await (await fetch(S.base + `/g/${gid}`)).text(), /Draft Band/);
    assert.match(await (await fetch(S.base + "/sitemap.xml")).text(), new RegExp(gid));
    // a customer books, then the group pauses: new customers can't find it, the existing customer still can
    const cust = client(S.base); await cust.signup("pb-c@example.com", "Pub Cust");
    const d = (await anon.get(`/api/groups/${gid}`)).json.next_open;
    const b = (await cust.post("/api/bookings", bookingBody(gid, d, { time: (await anon.get(`/api/groups/${gid}/availability?month=${d.slice(0, 7)}`)).json.days[d][0] }))).json.booking; assert.ok(b);
    await cust.post(`/api/groups/${gid}/messages`, { text: "hello" });
    r = await owner.post(`/api/groups/${gid}/pause`, { paused: true }); assert.equal(r.json.status, "paused");
    assert.equal((await anon.get(`/api/groups/${gid}`)).status, 404); assert.equal((await other.post(`/api/groups/${gid}/messages`, { text: "hi" })).status, 404);
    assert.ok(!(await anon.get("/api/search?zip=60608&limit=50")).json.results.some((x) => x.id === gid));
    assert.equal((await cust.get(`/api/groups/${gid}`)).status, 200); // they have a booking here
    assert.equal((await cust.post(`/api/groups/${gid}/messages`, { text: "still there?" })).status, 200);
    assert.equal((await owner.post(`/api/groups/${gid}/pause`, { paused: false })).json.status, "live");
    assert.equal((await anon.get(`/api/groups/${gid}`)).status, 200);
    // the site owner's hide beats everything, and a hidden group cannot publish itself back
    S.db.run("UPDATE groups SET hidden = 1 WHERE id = ?", gid);
    assert.equal((await cust.get(`/api/groups/${gid}`)).status, 404);
    assert.equal((await owner.post(`/api/groups/${gid}/publish`)).status, 403);
    // pausing a draft makes no sense
    const g2 = (await owner.post("/api/groups", { name: "Another Draft", type: "Banda", zip: "60623", rate: 400, members: 9 })).json.id;
    assert.equal((await owner.post(`/api/groups/${g2}/pause`, { paused: true })).status, 400);
    // strangers can't publish or pause
    assert.equal((await other.post(`/api/groups/${g2}/publish`)).status, 403);
    assert.equal((await other.post(`/api/groups/${g2}/pause`, { paused: true })).status, 403);
  } finally { await S.close(); }
});

test("in live-payments mode a group cannot publish before payouts are ready", async () => {
  const F = await fakeStripe();
  const S = await startApp({ STRIPE_SECRET_KEY: "sk_test_x", STRIPE_WEBHOOK_SECRET: "whsec_x", STRIPE_API_BASE: F.url });
  try {
    const owner = client(S.base); await owner.signup("lp@example.com", "Live Pub");
    const gid = (await owner.post("/api/groups", { name: "Payout Band", type: "Mariachi", zip: "60608", rate: 300, members: 5, story: "A family band that has played weddings in Chicago for twenty years." })).json.id;
    await owner.patch(`/api/groups/${gid}`, { events: ["Wedding"] }); await owner.post(`/api/groups/${gid}/photos`, { data: PNG }); await owner.post(`/api/groups/${gid}/availability/weekends`, { weeks: 2 });
    assert.deepEqual((await owner.post(`/api/groups/${gid}/publish`)).json.missing, ["payouts"]);
    await owner.post(`/api/groups/${gid}/stripe/onboard`); await owner.post(`/api/groups/${gid}/stripe/refresh`);
    assert.equal((await owner.post(`/api/groups/${gid}/publish`)).status, 200);
  } finally { await S.close(); await F.close(); }
});

test("invite and claim: a one-time link hands a draft to exactly one person", async () => {
  const S = await startApp({ ADMIN_EMAILS: "iv-admin@example.com" });
  try {
    const admin = client(S.base), a = client(S.base), b = client(S.base), anon = client(S.base);
    await admin.signup("iv-admin@example.com", "Iv Admin"); await a.signup("iv-a@example.com", "Iva A"); await b.signup("iv-b@example.com", "Ivo B");
    assert.equal((await a.post("/api/admin/invites", { name: "Nope Band", type: "Mariachi", zip: "60608" })).status, 404); // admin only
    assert.equal((await admin.post("/api/admin/invites", { name: "x", type: "Mariachi", zip: "60608" })).status, 400);
    assert.equal((await admin.post("/api/admin/invites", { name: "Bad Zip Band", type: "Mariachi", zip: "00000" })).status, 400);
    const inv = (await admin.post("/api/admin/invites", { name: "Los Invitados", type: "Banda", zip: "60623", rate: 700, members: 12, story: "Sent to us on WhatsApp." })).json;
    const token = inv.claim_url.match(/#\/claim\/([\w-]+)$/)[1];
    assert.equal(S.db.get("SELECT COUNT(*) c FROM groups WHERE claim_token_hash = ?", token).c, 0); // only a hash is stored
    assert.equal(S.db.get("SELECT owner_id o, invited i, published_at p FROM groups WHERE id = ?", inv.group_id).o, null);
    assert.equal((await admin.get("/api/admin/summary")).json.invites.length, 1);
    // a stranger with the link can preview it (that's how they know it is theirs) but nothing more
    const pre = (await anon.get(`/api/claim/${token}`)).json.group; assert.deepEqual([pre.name, pre.type, pre.city], ["Los Invitados", "Banda", "Chicago, IL"]);
    assert.equal((await anon.get("/api/claim/" + "x".repeat(32))).status, 404);
    assert.equal((await anon.post(`/api/claim/${token}`)).status, 401); // must log in to claim
    assert.equal((await anon.get(`/api/groups/${inv.group_id}`)).status, 404); // drafts are invisible
    // two people race for the same link: exactly one wins
    const [r1, r2] = await Promise.all([a.post(`/api/claim/${token}`), b.post(`/api/claim/${token}`)]);
    assert.deepEqual([r1.status, r2.status].sort(), [200, 404]); // the loser sees "no longer valid"
    const winner = r1.status === 200 ? a : b;
    const g = await mine(winner, inv.group_id); assert.equal(g.status, "draft"); assert.equal(g.name, "Los Invitados"); assert.equal(g.rate_cents, 70000);
    assert.equal((await anon.get(`/api/claim/${token}`)).status, 404); // the link is spent
    assert.equal((await admin.get("/api/admin/summary")).json.invites.length, 0);
    // regenerate revokes the old link; unclaimed invites can be deleted; claimed ones cannot
    const inv2 = (await admin.post("/api/admin/invites", { name: "Second Invite", type: "Mariachi", zip: "60402" })).json;
    const t2 = inv2.claim_url.match(/\/([\w-]+)$/)[1];
    const fresh = (await admin.post(`/api/admin/invites/${inv2.group_id}/regenerate`)).json.claim_url.match(/\/([\w-]+)$/)[1];
    assert.equal((await anon.get(`/api/claim/${t2}`)).status, 404); assert.equal((await anon.get(`/api/claim/${fresh}`)).status, 200);
    assert.equal((await admin.del(`/api/admin/invites/${inv2.group_id}`)).status, 200); assert.equal((await anon.get(`/api/claim/${fresh}`)).status, 404);
    assert.equal((await admin.del(`/api/admin/invites/${inv.group_id}`)).status, 404);
    assert.ok(S.db.all("SELECT action FROM admin_log").some((l) => l.action === "create invite"));
  } finally { await S.close(); }
});

test("upgrading an older database adds the new columns and keeps existing groups live", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bm-mig-"));
  const file = path.join(dir, "old.db");
  const old = new DatabaseSync(file);
  old.exec("CREATE TABLE groups (id TEXT PRIMARY KEY, owner_id INTEGER, demo INTEGER NOT NULL DEFAULT 0, name TEXT NOT NULL, type TEXT NOT NULL, zip TEXT NOT NULL, rate_cents INTEGER NOT NULL, created_at INTEGER NOT NULL)");
  old.exec("CREATE TABLE users (id INTEGER PRIMARY KEY, email TEXT NOT NULL UNIQUE COLLATE NOCASE, name TEXT NOT NULL, phone TEXT NOT NULL DEFAULT '', sms_opt_in INTEGER NOT NULL DEFAULT 0, lang TEXT NOT NULL DEFAULT 'en', pass_hash TEXT NOT NULL, created_at INTEGER NOT NULL)");
  old.exec("INSERT INTO groups VALUES ('real-old', 5, 0, 'Old Real', 'Mariachi', '60608', 30000, 1700000000), ('sample-old', NULL, 1, 'Old Sample', 'Banda', '60608', 30000, 1700000000)");
  old.close();
  const db = openDb({ dbPath: file, dataDir: dir });
  try {
    const cols = db.all("PRAGMA table_info(groups)").map((c) => c.name);
    for (const c of ["hidden", "paused", "published_at", "invited", "claim_token_hash"]) assert.ok(cols.includes(c), c);
    assert.ok(db.all("PRAGMA table_info(users)").map((c) => c.name).includes("email_verified"));
    assert.equal(db.get("SELECT published_at p FROM groups WHERE id = 'real-old'").p, 1700000000); // stays live
    assert.equal(db.get("SELECT published_at p FROM groups WHERE id = 'sample-old'").p, 0); // samples are live by rule, not by date
    assert.ok(openDb({ dbPath: file, dataDir: dir })); // opening it again is a no-op
  } finally { db.raw.close(); }
});
