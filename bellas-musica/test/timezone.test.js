import test, { mock } from "node:test";
import assert from "node:assert/strict";
import { todayStr, setTimezone, daysBetween } from "../server/util.js";
import { refundForCancel } from "../server/pricing.js";

test("'today' is the business calendar day, not the host's UTC day", () => {
  mock.timers.enable({ apis: ["Date"], now: new Date("2026-10-11T01:30:00Z") }); // 8:30pm on Oct 10 in Chicago
  try {
    setTimezone("America/Chicago");
    assert.equal(todayStr(), "2026-10-10");
    setTimezone("America/Los_Angeles");
    assert.equal(todayStr(), "2026-10-10");
    setTimezone("Asia/Tokyo"); // already the next morning there
    assert.equal(todayStr(), "2026-10-11");
    assert.throws(() => setTimezone("Not/AZone"));
  } finally { setTimezone("America/Chicago"); mock.timers.reset(); }
});

test("a cancellation exactly 7 days out at 8:30pm Chicago still gets the full Moderate refund", () => {
  mock.timers.enable({ apis: ["Date"], now: new Date("2026-10-11T01:30:00Z") });
  try {
    setTimezone("America/Chicago");
    const b = { payment_status: "paid", deposit_cents: 10000, policy: "moderate", date: "2026-10-17" }; // 7 days after Oct 10
    assert.equal(daysBetween(todayStr(), b.date), 7);
    assert.equal(refundForCancel(b, todayStr()), 10000);
  } finally { mock.timers.reset(); }
});
