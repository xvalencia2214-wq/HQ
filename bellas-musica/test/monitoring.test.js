import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { startApp, client } from "./helpers.js";
import { parseDsn } from "../server/alerts.js";

async function fakeSentry() {
  const events = [];
  const server = http.createServer(async (req, res) => {
    let raw = ""; for await (const c of req) raw += c;
    events.push({ url: req.url, method: req.method, auth: req.headers["x-sentry-auth"], body: JSON.parse(raw || "{}") });
    res.writeHead(200, { "Content-Type": "application/json" }); res.end('{"id":"x"}');
  });
  await new Promise((r) => server.listen(0, r));
  return { events, port: server.address().port, close: () => new Promise((r) => server.close(r)) };
}
const settle = () => new Promise((r) => setTimeout(r, 120));

test("Sentry DSN parsing: good ones become a store URL and key; bad ones turn Sentry off instead of crashing", () => {
  assert.deepEqual(parseDsn("https://abc123@o999.ingest.sentry.io/4507"), { key: "abc123", url: "https://o999.ingest.sentry.io/api/4507/store/" });
  assert.deepEqual(parseDsn("http://k@127.0.0.1:9000/42"), { key: "k", url: "http://127.0.0.1:9000/api/42/store/" });
  for (const bad of ["", "nonsense", "https://o999.ingest.sentry.io/4507", "https://k@host/notanumber", "ftp://k@host/1", undefined]) assert.equal(parseDsn(bad), null, String(bad));
});

test("browser crash reports: alert you (and Sentry) once per problem, strip private bits, ignore junk, and can't be used to flood", async () => {
  const sentry = await fakeSentry();
  const S = await startApp({ SENTRY_DSN: `http://pubkey@127.0.0.1:${sentry.port}/42`, RATE_CLIENTERROR: "12" });
  try {
    const c = client(S.base);
    const report = (b) => c.post("/api/client-error", b);
    const r = await report({ message: "TypeError: x is undefined", source: "http://localhost:3000/js/views/group.js?v=3#frag", line: 120, route: "#/reset/SECRETTOKEN123?x=1" });
    assert.equal(r.status, 200); await settle();
    assert.equal(sentry.events.length, 1);
    const e = sentry.events[0];
    assert.equal(e.method, "POST"); assert.equal(e.url, "/api/42/store/"); assert.match(e.auth, /sentry_key=pubkey/); assert.match(e.auth, /sentry_version=7/);
    assert.equal(e.body.level, "error"); assert.equal(e.body.platform, "node"); assert.match(e.body.event_id, /^[0-9a-f]{32}$/);
    assert.match(e.body.message, /Browser error on #\/reset: TypeError: x is undefined \(\/js\/views\/group\.js:120\)/);
    assert.ok(!JSON.stringify(e.body).includes("SECRETTOKEN123")); // a reset/claim/shortlist link is never copied into an alert
    assert.ok(!JSON.stringify(e.body).includes("localhost:3000") && !JSON.stringify(e.body).includes("?v=3"));
    // the same problem again within 10 minutes is not sent again; a different one is
    await report({ message: "TypeError: x is undefined", route: "#/group/abc" }); await settle(); assert.equal(sentry.events.length, 1);
    await report({ message: "RangeError: something else", route: "#/discover" }); await settle(); assert.equal(sentry.events.length, 2);
    // bad input is refused, nothing is stored
    assert.equal((await report({})).status, 400); assert.equal((await report({ message: "" })).status, 400);
    // long text is cut, and nothing breaks with odd values
    const odd = await report({ message: "x".repeat(5000), route: 123, source: {}, line: "nope" }); assert.equal(odd.status, 400); // message above the 300-character cap is rejected, not stored
    assert.equal((await report({ message: "y".repeat(300), route: 123, source: {}, line: "nope" })).status, 200);
    // a flood is capped per minute (RATE_CLIENTERROR=12 here)
    let blocked = 0; for (let i = 0; i < 10; i++) if ((await report({ message: `flood ${i}` })).status === 429) blocked++;
    assert.ok(blocked >= 5, `expected the flood to be limited, only ${blocked} blocked`);
    await settle(); assert.ok(sentry.events.length <= 10);
    // the server's own failures reach Sentry too
    const before = sentry.events.length;
    S.ctx.alert("REFUND FAILED for booking test123", "refund-test123"); await settle();
    assert.equal(sentry.events.length, before + 1); assert.match(sentry.events.at(-1).body.message, /REFUND FAILED/);
    S.ctx.alert("REFUND FAILED for booking test123", "refund-test123"); await settle(); assert.equal(sentry.events.length, before + 1); // de-duplicated
  } finally { await S.close(); await sentry.close(); }
});

test("without Sentry or a webhook, alerts only log and the browser-report route still works", async () => {
  const S = await startApp();
  try {
    assert.equal((await client(S.base).post("/api/client-error", { message: "boom", route: "#/x" })).status, 200);
  } finally { await S.close(); }
});
