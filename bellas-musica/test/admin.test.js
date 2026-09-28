import test from "node:test";
import assert from "node:assert/strict";
import { startApp, client, inDays, makeGroup, bookingBody } from "./helpers.js";

test("admin: only listed emails get in; summary numbers add up; hide, comp-feature, reset password are logged", async () => {
  const S = await startApp({ ADMIN_EMAILS: " Boss@Example.com , other@x.com " });
  try {
    const boss = client(S.base), owner = client(S.base), cust = client(S.base), anon = client(S.base);
    const b = await boss.signup("boss@example.com", "The Boss"); assert.equal(b.is_admin, true); // case-insensitive
    assert.equal((await owner.signup("adm-o@example.com", "Adm Owner")).is_admin, false);
    await cust.signup("adm-c@example.com", "Adm Cust");
    for (const c of [anon, owner, cust]) assert.equal((await c.get("/api/admin/summary")).status, 404); // even logged-out visitors just see "not found"
    assert.equal((await owner.post("/api/admin/groups/x/hide", { hidden: true })).status, 404);

    // some business: one confirmed booking, one refunded booking
    const d = inDays(30), d2 = inDays(31);
    const gid = await makeGroup(owner, { name: "Admin Band", dates: [d, d2] });
    const b1 = (await cust.post("/api/bookings", bookingBody(gid, d))).json.booking; await cust.post(`/api/bookings/${b1.id}/simulate-pay`); await owner.patch(`/api/bookings/${b1.id}`, { action: "accept" });
    const b2 = (await cust.post("/api/bookings", bookingBody(gid, d2))).json.booking; await cust.post(`/api/bookings/${b2.id}/simulate-pay`); await owner.patch(`/api/bookings/${b2.id}`, { action: "decline" });
    const s = (await boss.get("/api/admin/summary")).json;
    assert.equal(s.users.total, 3); assert.equal(s.groups.real, 1); assert.ok(s.groups.sample >= 10);
    assert.equal(s.bookings.by_status.confirmed, 1); assert.equal(s.bookings.by_status.declined, 1);
    // each booking: 2h x $300 = $600, deposit $150, fee 10% of total = $60. b2 was refunded in full.
    assert.equal(s.money.deposits_collected_cents, 30000); assert.equal(s.money.refunded_cents, 15000); assert.equal(s.money.net_deposits_cents, 15000);
    assert.equal(s.money.platform_fees_kept_cents, 6000); assert.equal(s.bookings.confirmed_value_cents, 60000);
    assert.equal(s.groups_list.find((g) => g.id === gid).owner_email, "adm-o@example.com");
    assert.equal(s.recent_bookings.length, 2);

    // hide / unhide
    assert.equal((await boss.post(`/api/admin/groups/${gid}/hide`, { hidden: true })).json.hidden, true);
    assert.equal((await anon.get(`/api/groups/${gid}`)).status, 404);
    assert.equal((await cust.post("/api/bookings", bookingBody(gid, d2))).status, 404);
    await boss.post(`/api/admin/groups/${gid}/hide`, { hidden: false });
    assert.equal((await anon.get(`/api/groups/${gid}`)).status, 200);
    // comp featured
    await boss.post(`/api/admin/groups/${gid}/feature`, { days: 14 });
    assert.ok(S.db.get("SELECT promoted_until p FROM groups WHERE id = ?", gid).p > Date.now() / 1000 + 13 * 86400);
    assert.equal((await boss.post(`/api/admin/groups/${gid}/feature`, { days: 9999 })).status, 400);
    await boss.post(`/api/admin/groups/${gid}/feature`, { days: 0 });
    assert.equal(S.db.get("SELECT promoted_until p FROM groups WHERE id = ?", gid).p, 0);
    // find a user and reset their password
    const found = (await boss.get("/api/admin/users?q=adm-c")).json.users;
    assert.equal(found.length, 1); assert.equal(found[0].bookings, 2);
    assert.equal((await boss.get("/api/admin/users?q=adm%25c")).json.users.length, 0); // "%" inside a search term is not a wildcard (adm%c would match adm-c)
    assert.equal((await boss.get("/api/admin/users?q=adm_c")).json.users.length, 0); // nor is "_"
    const reset = (await boss.post(`/api/admin/users/${found[0].id}/reset-password`)).json;
    assert.equal((await cust.get("/api/me")).json.user, null); // signed out
    assert.equal((await client(S.base).post("/api/auth/login", { email: "adm-c@example.com", password: reset.temporary_password })).status, 200);
    // everything is in the audit log, newest first
    const actions = (await boss.get("/api/admin/summary")).json.log.map((l) => l.action);
    assert.deepEqual(actions.slice(0, 5), ["reset password", "clear featured", "comp featured", "unhide group", "hide group"]);
  } finally { await S.close(); }
});
