import test from "node:test";
import assert from "node:assert/strict";
import { startApp, client, inDays, makeGroup } from "./helpers.js";

test("saved groups: saving is idempotent and private; only live groups can be saved; hidden ones drop out of the list", async () => {
  const S = await startApp({ DEMO_SEED: "0" });
  try {
    const owner = client(S.base), ana = client(S.base), bo = client(S.base), anon = client(S.base);
    await owner.signup("fv-o@example.com", "Fav Owner"); await ana.signup("fv-a@example.com", "Ana Garcia"); await bo.signup("fv-b@example.com", "Beto Ruiz");
    const a = await makeGroup(owner, { name: "Alpha Band", dates: [inDays(20)] }), b = await makeGroup(owner, { name: "Bravo Band", dates: [inDays(20)] });
    const draft = await makeGroup(owner, { name: "Draft Band", draft: true });
    assert.equal((await anon.post(`/api/favorites/${a}`, {})).status, 401);
    assert.equal((await anon.get("/api/my/favorites")).status, 401);
    assert.equal((await ana.post(`/api/favorites/${draft}`, {})).status, 404); // a draft isn't visible to customers
    assert.equal((await ana.post("/api/favorites/nope", {})).status, 404);
    assert.deepEqual((await ana.post(`/api/favorites/${a}`, {})).json, { saved: true });
    assert.deepEqual((await ana.post(`/api/favorites/${a}`, {})).json, { saved: true }); // again: no error, no duplicate
    await ana.post(`/api/favorites/${b}`, {});
    const list = (await ana.get("/api/my/favorites")).json;
    assert.deepEqual(list.ids, [b, a]); assert.deepEqual(list.groups.map((g) => g.name), ["Bravo Band", "Alpha Band"]); // newest first
    assert.ok(Number.isInteger(list.groups[0].from_cents) && list.groups[0].city === "Chicago");
    assert.deepEqual(Object.keys(list.groups[0]).filter((k) => /owner|phone|stripe|email|token/i.test(k)), []);
    assert.deepEqual((await ana.get("/api/my/favorites?ids=1")).json, { ids: [b, a] }); // the light version for hearts
    assert.deepEqual((await bo.get("/api/my/favorites")).json.ids, []); // private to each person
    // removing is idempotent too; a hidden group leaves the list but can still be un-saved
    S.db.run("UPDATE groups SET hidden = 1 WHERE id = ?", b);
    assert.deepEqual((await ana.get("/api/my/favorites")).json.groups.map((g) => g.name), ["Alpha Band"]);
    assert.deepEqual((await ana.post(`/api/favorites/${b}`, { saved: false })).json, { saved: false });
    assert.deepEqual((await ana.post(`/api/favorites/${b}`, { saved: false })).json, { saved: false });
    assert.deepEqual((await ana.get("/api/my/favorites?ids=1")).json.ids, [a]);
    assert.equal((await ana.post(`/api/favorites/${b}`, {})).status, 404); // hidden: can't be saved again
  } finally { await S.close(); }
});

test("shortlists: a read-only snapshot link anyone can open; only live groups and the sharer's first name show; the owner can revoke it", async () => {
  const S = await startApp({ DEMO_SEED: "0" });
  try {
    const owner = client(S.base), ana = client(S.base), bo = client(S.base), anon = client(S.base);
    await owner.signup("sl-o@example.com", "Sl Owner"); await ana.signup("sl-a@example.com", "Ana Garcia Lopez"); await bo.signup("sl-b@example.com", "Beto Ruiz");
    const ids = [];
    for (const n of ["One", "Two", "Three"]) ids.push(await makeGroup(owner, { name: `${n} Band`, dates: [inDays(20 + ids.length)] }));
    assert.equal((await ana.post("/api/shortlists", {})).status, 400); // nothing saved yet
    assert.equal((await anon.post("/api/shortlists", {})).status, 401);
    for (const id of ids) await ana.post(`/api/favorites/${id}`, {});
    const made = await ana.post("/api/shortlists", { title: "Quince music" });
    assert.equal(made.status, 200); assert.match(made.json.token, /^[\w-]{12,}$/); assert.match(made.json.url, /#\/shortlist\//);
    const pub = (await anon.get(`/api/shortlists/${made.json.token}`)); // no login needed
    assert.equal(pub.status, 200);
    assert.deepEqual([pub.json.title, pub.json.by], ["Quince music", "Ana"]); // first name only
    assert.deepEqual(pub.json.groups.map((g) => g.name), ["Three Band", "Two Band", "One Band"]); // the order they were saved, newest first
    assert.ok(!JSON.stringify(pub.json).match(/sl-a@example|Lopez|owner_id|stripe/i));
    // it is a snapshot: un-saving later doesn't change what the partner sees...
    await ana.post(`/api/favorites/${ids[0]}`, { saved: false });
    assert.equal((await anon.get(`/api/shortlists/${made.json.token}`)).json.groups.length, 3);
    // ...but a group that stops being live disappears from it
    S.db.run("UPDATE groups SET hidden = 1 WHERE id = ?", ids[1]);
    assert.deepEqual((await anon.get(`/api/shortlists/${made.json.token}`)).json.groups.map((g) => g.name), ["Three Band", "One Band"]);
    // bad or unknown tokens are plain 404s
    for (const t of ["short", "x".repeat(60), "nonexistenttoken1", "..%2F..%2Fetc"]) assert.equal((await anon.get(`/api/shortlists/${t}`)).status, 404, t);
    // listing and revoking: only the owner
    assert.equal((await ana.get("/api/my/shortlists")).json.shortlists.length, 1);
    assert.equal((await bo.get("/api/my/shortlists")).json.shortlists.length, 0);
    assert.equal((await bo.del(`/api/shortlists/${made.json.token}`)).status, 404);
    assert.equal((await ana.del(`/api/shortlists/${made.json.token}`)).status, 200);
    assert.equal((await anon.get(`/api/shortlists/${made.json.token}`)).status, 404);
    assert.equal((await ana.del(`/api/shortlists/${made.json.token}`)).status, 404);
    // a cap keeps the table from being filled
    for (let i = 0; i < 20; i++) assert.equal((await ana.post("/api/shortlists", {})).status, 200);
    assert.equal((await ana.post("/api/shortlists", {})).status, 400);
    // deleting the account removes saved groups and kills the links
    const tok = (await ana.get("/api/my/shortlists")).json.shortlists[0].token;
    assert.equal((await ana.post("/api/me/delete", { password: "correct horse battery" })).status, 200);
    assert.equal((await anon.get(`/api/shortlists/${tok}`)).status, 404);
    assert.equal(S.db.get("SELECT COUNT(*) c FROM favorites").c, 0);
    assert.equal(S.db.get("SELECT COUNT(*) c FROM shortlist_items").c, 0);
  } finally { await S.close(); }
});
