import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { startApp, client, inDays, makeGroup, bookingBody } from "./helpers.js";

test("Twilio: sends from the platform number with basic auth; failures are logged, never thrown", async () => {
  const seen = [];
  let fail = false;
  const srv = http.createServer(async (req, res) => {
    let body = ""; for await (const c of req) body += c;
    seen.push({ url: req.url, auth: req.headers.authorization, form: Object.fromEntries(new URLSearchParams(body)) });
    res.writeHead(fail ? 500 : 201, { "Content-Type": "application/json" }); res.end("{}");
  });
  await new Promise((r) => srv.listen(0, r));
  const S = await startApp({ TWILIO_ACCOUNT_SID: "ACtest", TWILIO_AUTH_TOKEN: "tok", TWILIO_FROM: "+15550001111", TWILIO_API_BASE: `http://127.0.0.1:${srv.address().port}` });
  try {
    const owner = client(S.base), cust = client(S.base);
    await owner.signup("tw-o@example.com", "Tw Owner", { phone: "312-555-0177", sms_opt_in: true });
    await cust.signup("tw-c@example.com", "Tw Cust", {});
    const d = inDays(20);
    const g = await makeGroup(owner, { name: "Twilio Band", dates: [d, inDays(21)] });
    const b = (await cust.post("/api/bookings", bookingBody(g, d))).json.booking;
    await cust.post(`/api/bookings/${b.id}/simulate-pay`);
    await new Promise((r) => setTimeout(r, 150));
    assert.equal(seen.length, 1);
    assert.equal(seen[0].url, "/2010-04-01/Accounts/ACtest/Messages.json");
    assert.equal(seen[0].auth, "Basic " + Buffer.from("ACtest:tok").toString("base64"));
    assert.equal(seen[0].form.To, "+13125550177"); assert.equal(seen[0].form.From, "+15550001111");
    assert.equal(S.db.get("SELECT sent FROM sms_log").sent, 1);
    // provider outage: the booking flow still works and the error is recorded
    fail = true;
    const b2 = (await cust.post("/api/bookings", bookingBody(g, inDays(21)))).json.booking;
    const paid = await cust.post(`/api/bookings/${b2.id}/simulate-pay`);
    assert.equal(paid.status, 200);
    await new Promise((r) => setTimeout(r, 150));
    assert.match(S.db.all("SELECT error FROM sms_log ORDER BY id DESC LIMIT 1")[0].error, /Twilio 500/);
  } finally { await S.close(); srv.closeAllConnections?.(); srv.close(); }
});
