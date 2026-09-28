// Sends hostile input to every API route, as every kind of user. Nothing may ever crash (5xx).
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { startApp, client, inDays, makeGroup, bookingBody } from "./helpers.js";

const routes = [];
for (const f of fs.readdirSync("server/routes")) {
  for (const m of fs.readFileSync(path.join("server/routes", f), "utf8").matchAll(/add\("(GET|POST|PUT|PATCH|DELETE)", "([^"]+)"/g)) routes.push({ method: m[1], pattern: m[2] });
}

const big = "x".repeat(20_000);
const NASTY = [
  {}, [], null, "string", 12345, true,
  { name: null, email: null, password: null, text: null, rate: null, zip: null, date: null, time: null },
  { name: 123, email: {}, password: [], text: 7, rate: "abc", zip: 60608, date: 20261001, time: ["2:00 PM"], hours: "2; DROP TABLE users", guests: -1 },
  { name: big, text: big, story: big, message: big, address: big, password: big, email: big + "@x.com" },
  { __proto__: { admin: true }, constructor: { prototype: { polluted: 1 } }, "__proto__x": 1 },
  JSON.parse('{"__proto__": {"isAdmin": true}, "constructor": {"prototype": {"x": 1}}}'),
  { hours: 1e999, price: Infinity, rate: -5, deposit_pct: 1e9, guests: 1.5, members: "1e3", days: NaN, weeks: -1, rating: 99 },
  { name: "'; DROP TABLE users; --", text: "<script>alert(1)</script>", story: "\u0000\u0001‮", zip: "6060'8", song: "%_\\" },
  { dates: { "2026-13-45": ["x"], "not a date": 5 }, songs: [1, null, {}, "ok"], events: "Wedding", data: "not base64!!", video_url: "javascript:alert(1)", action: {} },
  { dates: Object.fromEntries(Array.from({ length: 500 }, (_, i) => [`2027-01-${String(i % 28 + 1).padStart(2, "0")}-${i}`, ["12:00 PM"]])) },
  { groupId: "../../etc/passwd", packageId: "1 OR 1=1", eventZip: "00000", acceptPolicy: "true" }
];

test("hostile input never crashes any route (any user, any payload)", async () => {
  const S = await startApp({ ADMIN_EMAILS: "fz-admin@example.com", RATE_AUTH: "1000000", RATE_API: "10000000", STRIPE_WEBHOOK_SECRET: "whsec_fuzz" });
  try {
    const anon = client(S.base), cust = client(S.base), owner = client(S.base), admin = client(S.base);
    await Promise.all([cust.signup("fz-c@example.com", "Fz Cust"), owner.signup("fz-o@example.com", "Fz Owner"), admin.signup("fz-admin@example.com", "Fz Admin")]);
    const d = inDays(30);
    const gid = await makeGroup(owner, { name: "Hostile Band", dates: [d] });
    const b = (await cust.post("/api/bookings", bookingBody(gid, d))).json.booking;
    await cust.post(`/api/groups/${gid}/messages`, { text: "hi" });
    const pid = (await owner.post(`/api/groups/${gid}/packages`, { name: "Pkg", hours: 1, price: 100 })).json.packages[0].id;
    const real = { id: gid, pid, bid: b.id, cid: 1, fid: "f-none", zip: "60608", token: "x" };
    const fills = (pattern, junk) => pattern.replace(/:(\w+)/g, (_, k) => junk ? encodeURIComponent(junk[k] ?? junk.any) : encodeURIComponent(real[k] ?? real.id));
    const junkParams = [null, { any: "does-not-exist", cid: "abc", zip: "abcde", pid: "-1", bid: "nope" }, { any: "../../etc/passwd", cid: "1;2", pid: "1e999", zip: "'--" }, { any: "%00", cid: "99999999999999999999", pid: "0" }];
    let requests = 0; const bad = [];
    for (const who of [["anon", anon], ["customer", cust], ["owner", owner], ["admin", admin]]) {
      for (const r of routes) {
        if (r.pattern === "/api/me/delete" || r.pattern === "/api/auth/logout") continue; // would end the session we are testing with
        const payloads = r.method === "GET" || r.method === "DELETE" ? [undefined] : NASTY;
        for (const jp of junkParams) for (const body of payloads) {
          const url = fills(r.pattern, jp) + (r.method === "GET" && r.pattern.includes("month") || /availability|calendar/.test(r.pattern) ? "?month=2026-99&zip=%27&q=%25&lat=x&lon=&date=x&limit=-1&radius=1e9" : "?zip=abc&guests=x&max=-1&sort=drop&limit=99999&date=2020-01-01&song=%25");
          let res;
          try { res = await who[1].raw(r.method, url, body); } catch (e) { bad.push(`${who[0]} ${r.method} ${url} -> threw ${e.message}`); continue; }
          requests++;
          if (res.status >= 500) bad.push(`${who[0]} ${r.method} ${url} body=${JSON.stringify(body)?.slice(0, 80)} -> ${res.status} ${JSON.stringify(res.json)?.slice(0, 100)}`);
        }
      }
    }
    // raw garbage: invalid JSON, wrong content type, truncated body, huge body
    for (const [ct, raw] of [["application/json", "{not json"], ["application/json", '{"a":'], ["application/json", "[[[[[[[["], ["text/plain", "hello"], ["application/json", "x".repeat(300_000)], ["application/x-www-form-urlencoded", "a=b"]]) {
      for (const p of ["/api/auth/login", "/api/auth/register", "/api/quote", "/api/bookings", "/api/stripe/webhook", `/api/groups/${gid}/photos`]) {
        const res = await fetch(S.base + p, { method: "POST", headers: { "Content-Type": ct, "Stripe-Signature": "t=1,v1=00" }, body: raw }); requests++;
        if (res.status >= 500) bad.push(`raw ${ct} ${raw.slice(0, 20)} -> ${p} ${res.status}`);
      }
    }
    // hostile paths and methods
    for (const p of ["/api", "/api/", "/api//", "/%", "/%zz", "/..%2f..%2fetc%2fpasswd", "/g/%00", "/b/../..", "/uploads/", "/uploads/%2e%2e%2fapp.db", "/static/../server/config.js", "/api/groups/%", "/api/groups/" + "a".repeat(5000)]) {
      for (const m of ["GET", "POST", "PUT", "DELETE", "HEAD", "OPTIONS", "PATCH"]) { const res = await fetch(S.base + p, { method: m }).catch(() => ({ status: 0 })); requests++; if (res.status >= 500) bad.push(`${m} ${p} -> ${res.status}`); }
    }
    console.log(`  ${requests} hostile requests sent to ${routes.length} routes`);
    assert.deepEqual(bad.slice(0, 15), [], `${bad.length} requests caused a server error`);
    // the server is still healthy and nothing was polluted
    assert.deepEqual(await (await fetch(S.base + "/api/health")).json(), { ok: true });
    assert.equal({}.polluted, undefined); assert.equal({}.isAdmin, undefined); assert.equal({}.admin, undefined);
    assert.equal(S.db.get("SELECT COUNT(*) c FROM users").c, 3); // tables intact
  } finally { await S.close(); }
});
