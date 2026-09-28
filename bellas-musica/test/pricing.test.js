import test from "node:test";
import assert from "node:assert/strict";
import { buildQuote, refundPercent, refundForCancel } from "../server/pricing.js";
import { verifyWebhook } from "../server/stripe.js";
import { signWebhook } from "./helpers.js";
import { parseVideo, sniffImage } from "../server/media.js";
import { maskContact } from "../server/routes/messages.js";

test("refund schedules follow each policy", () => {
  assert.equal(refundPercent("flexible", 3), 100);
  assert.equal(refundPercent("flexible", 2), 0);
  assert.equal(refundPercent("moderate", 7), 100);
  assert.equal(refundPercent("moderate", 6), 50);
  assert.equal(refundPercent("moderate", 3), 50);
  assert.equal(refundPercent("moderate", 2), 0);
  assert.equal(refundPercent("strict", 30), 100);
  assert.equal(refundPercent("strict", 29), 50);
  assert.equal(refundPercent("strict", 13), 0);
  assert.equal(refundPercent("nonsense", 10), 100); // unknown policy falls back to moderate
});

test("refund is zero when nothing was paid, and rounds down", () => {
  const b = { payment_status: "paid", deposit_cents: 10001, policy: "moderate", date: "2030-01-10" };
  assert.equal(refundForCancel({ ...b, payment_status: "unpaid" }, "2030-01-01"), 0);
  assert.equal(refundForCancel(b, "2030-01-04"), 5000); // 6 days out: 50% of 10001, rounded down
  assert.equal(refundForCancel(b, "2030-01-01"), 10001);
});

test("quote: hourly, package, travel fee, deposit and fee cap", () => {
  const group = { rate_cents: 30000, travel_miles: 30, travel_fee_cents: 5000, deposit_pct: 25, cancel_policy: "strict" };
  let q = buildQuote({ group, pkg: null, hours: 2, distanceMiles: 10, feePct: 10 });
  assert.deepEqual([q.subtotal_cents, q.travel_fee_cents, q.total_cents, q.deposit_cents, q.platform_fee_cents], [60000, 0, 60000, 15000, 6000]);
  q = buildQuote({ group, pkg: { hours: 3, price_cents: 50000 }, hours: 99, distanceMiles: 45, feePct: 10 });
  assert.equal(q.hours, 3);
  assert.equal(q.total_cents, 55000); // package + travel fee beyond 30 miles
  assert.equal(q.balance_cents, q.total_cents - q.deposit_cents);
  q = buildQuote({ group: { ...group, deposit_pct: 20 }, pkg: null, hours: 1, distanceMiles: 1, feePct: 50 });
  assert.equal(q.platform_fee_cents, q.deposit_cents); // fee can never exceed the deposit
});

test("webhook signature: valid, tampered, stale, wrong secret", () => {
  const body = JSON.stringify({ id: "evt_1", type: "x" });
  const { raw, header } = signWebhook(body, "whsec_test");
  assert.equal(verifyWebhook(Buffer.from(raw), header, "whsec_test").id, "evt_1");
  assert.throws(() => verifyWebhook(Buffer.from(raw + " "), header, "whsec_test"), /signature/i);
  assert.throws(() => verifyWebhook(Buffer.from(raw), header, "whsec_other"), /signature/i);
  const old = signWebhook(body, "whsec_test", Math.floor(Date.now() / 1000) - 3600);
  assert.throws(() => verifyWebhook(Buffer.from(old.raw), old.header, "whsec_test"), /tolerance/i);
  assert.throws(() => verifyWebhook(Buffer.from(raw), "", "whsec_test"));
});

test("video links: only YouTube and Vimeo", () => {
  assert.deepEqual(parseVideo("https://www.youtube.com/watch?v=dQw4w9WgXcQ"), { provider: "youtube", id: "dQw4w9WgXcQ" });
  assert.deepEqual(parseVideo("https://youtu.be/dQw4w9WgXcQ?t=5"), { provider: "youtube", id: "dQw4w9WgXcQ" });
  assert.deepEqual(parseVideo("youtube.com/shorts/dQw4w9WgXcQ"), { provider: "youtube", id: "dQw4w9WgXcQ" });
  assert.deepEqual(parseVideo("https://vimeo.com/123456789"), { provider: "vimeo", id: "123456789" });
  assert.equal(parseVideo("https://evil.example/watch?v=dQw4w9WgXcQ"), null);
  assert.equal(parseVideo("https://youtube.com.evil.example/watch?v=dQw4w9WgXcQ"), null);
  assert.equal(parseVideo("javascript:alert(1)"), null);
  assert.deepEqual(parseVideo(""), { provider: "", id: "" });
});

test("image sniffing trusts bytes, not names", () => {
  assert.equal(sniffImage(Buffer.from("<script>alert(1)</script>....")), null);
  assert.equal(sniffImage(Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(20)])).ext, "jpg");
  assert.equal(sniffImage(Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(20)])).ext, "png");
});

test("chat masks phones and emails but leaves normal text", () => {
  assert.equal(maskContact("Call me at (312) 555-0142 ok").masked, true);
  assert.equal(maskContact("write me: ana@example.com").masked, true);
  assert.equal(maskContact("wa.me/13125550142").masked, true);
  assert.equal(maskContact("Do you play for 150 guests at 6 PM on 10/12?").masked, false);
});
