import test from "node:test";
import assert from "node:assert/strict";
import { startApp, client, inDays, makeGroup, bookingBody, fakeStripe, postWebhook } from "./helpers.js";

const TINY_PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(64, 1)]).toString("base64");
const row = (S, id) => S.db.get("SELECT * FROM bookings WHERE id = ?", id);
const parts = (S, id) => S.db.all("SELECT payer_name, amount_cents, status, refund_cents FROM balance_parts WHERE booking_id = ? ORDER BY rowid", id);
// a confirmed booking: $300/hr x 3 = $900, 25% deposit $225, balance $675
async function confirmed(S, owner, cust, gid, date, extra = {}) {
  const b = (await cust.post("/api/bookings", bookingBody(gid, date, { hours: 3, ...extra }))).json.booking;
  if (S.ctx.stripe.live) return b;
  await cust.post(`/api/bookings/${b.id}/simulate-pay`);
  await owner.patch(`/api/bookings/${b.id}`, { action: "accept" });
  return b;
}

test("payment plan and padrinos: the balance in parts, validation, refunds back to each payer, and money that isn't needed goes back", async () => {
  const S = await startApp({ DEMO_SEED: "0" });
  try {
    const owner = client(S.base), cust = client(S.base), tio = client(S.base), other = client(S.base);
    await owner.signup("pp-o@example.com", "Parts Owner"); await cust.signup("pp-c@example.com", "Rosa Martinez"); await tio.signup("pp-t@example.com", "Juan Martinez"); await other.signup("pp-x@example.com", "Otro");
    const ds = [inDays(20), inDays(21), inDays(22), inDays(23)];
    const gid = await makeGroup(owner, { name: "Parts Band", dates: ds });
    const b = await confirmed(S, owner, cust, gid, ds[0]);
    const pay = (c, id) => c.post(`/api/parts/${id}/simulate-pay`);

    // validation
    const part = (body, c = cust, id = b.id) => c.post(`/api/bookings/${id}/parts`, body);
    assert.equal((await part({ amount: 10 })).status, 400);     // under $20
    assert.equal((await part({ amount: 700 })).status, 400);    // more than is left
    assert.equal((await part({ amount: "x" })).status, 400);
    assert.equal((await part({ amount: 100 }, other)).status, 404); // not their booking
    const unconfirmed = (await cust.post("/api/bookings", bookingBody(gid, ds[1], { hours: 3 }))).json.booking;
    assert.equal((await part({ amount: 100 }, cust, unconfirmed.id)).status, 400); // not paid/confirmed yet

    // installment 1 by the customer
    const p1 = await part({ amount: 200 });
    assert.equal(p1.status, 200); assert.equal(p1.json.payment.mode, "simulated");
    assert.equal((await pay(other, p1.json.part_id)).status, 404); // only the payer can pay it
    assert.equal((await pay(cust, p1.json.part_id)).status, 200);
    let v = (await cust.get("/api/my/bookings")).json.bookings.find((x) => x.id === b.id);
    assert.equal(v.balance_paid_cents, 20000); assert.equal(v.balance_left_cents, 47500);
    assert.equal(v.can_pay_balance, false); assert.equal(v.can_pay_part, true);
    assert.equal((await cust.post(`/api/bookings/${b.id}/balance`)).status, 400); // the one-shot balance is closed once parts exist
    assert.equal((await pay(cust, p1.json.part_id)).status, 200); // paying the same part twice changes nothing
    assert.equal(row(S, b.id).balance_parts_cents, 20000);

    // a padrino pays through the family link
    const party = (await cust.post("/api/parties", { date: ds[0], zip: "60608" })).json.party;
    const token = party.share_url.split("/fp/")[1];
    const pad = (body, c = tio) => c.post(`/api/fp/${token}/padrino`, body);
    assert.equal((await client(S.base).post(`/api/fp/${token}/padrino`, { bookingId: b.id, amount: 100 })).status, 401); // needs an account
    assert.equal((await pad({ bookingId: unconfirmed.id, amount: 100 })).status, 404); // a different date: not this party's vendor
    assert.equal((await pad({ bookingId: b.id, amount: 300, name: "Tío Juan", note: "Padrino de música" })).status, 200);
    const tioPart = S.db.get("SELECT id FROM balance_parts WHERE payer_name = 'Tío Juan'").id;
    assert.equal((await pay(tio, tioPart)).status, 200);
    v = (await cust.get("/api/my/bookings")).json.bookings.find((x) => x.id === b.id);
    assert.equal(v.balance_left_cents, 17500);
    assert.deepEqual(v.parts.map((p) => [p.payer_name, p.amount_cents, p.by_customer]), [["Rosa", 20000, true], ["Tío Juan", 30000, false]]);
    const fam = (await client(S.base).get(`/api/fp/${token}`)).json.party;
    assert.equal(fam.vendors[0].balance_left_cents, 17500);
    // the group sees who paid
    const forGroup = (await owner.get(`/api/groups/${gid}/bookings`)).json.bookings.find((x) => x.id === b.id);
    assert.equal(forGroup.balance_paid_cents, 50000);
    // emails: the customer hears about the padrino, the group about each payment
    const mail = S.db.all("SELECT kind FROM email_log").map((r) => r.kind);
    assert.ok(mail.includes("part.padrino.customer") && mail.includes("part.paid.customer") && mail.filter((k) => k === "part.paid.group").length >= 2, JSON.stringify(mail));

    // two people try to pay the rest at the same time: the second payment goes back in full
    const r1 = (await part({ rest: true })).json.part_id, r2 = (await pad({ bookingId: b.id, rest: true, name: "Tía Lupe" })).json.part_id;
    assert.equal((await pay(cust, r1)).status, 200);
    assert.equal(row(S, b.id).balance_status, "paid");
    assert.equal((await pay(tio, r2)).status, 409);
    assert.equal(S.db.get("SELECT status FROM balance_parts WHERE id = ?", r2).status, "stray");
    assert.equal(S.db.get("SELECT cents FROM extra_refunds WHERE payment_intent = ?", "sim_part_" + r2).cents, 17500);
    assert.equal((await part({ amount: 20 })).status, 400); // nothing left

    // the customer cancels 20 days out (moderate policy: 100%): every payment goes back to whoever paid it
    assert.equal((await cust.patch(`/api/bookings/${b.id}`, { action: "cancel" })).status, 200);
    const after = row(S, b.id);
    assert.equal(after.refund_cents, 22500); assert.equal(after.balance_refund_cents, 67500); assert.equal(after.balance_status, "refunded");
    assert.deepEqual(parts(S, b.id).filter((p) => p.status !== "stray").map((p) => [p.payer_name, p.refund_cents, p.status]), [["Rosa", 20000, "refunded"], ["Tío Juan", 30000, "refunded"], ["Rosa", 17500, "refunded"]]);

    // a 50% refund (4 days out) is split newest-first: only the latest payments are touched
    const near = inDays(4);
    await owner.put(`/api/groups/${gid}/availability`, { dates: { [near]: ["2:00 PM"] } });
    const b2 = await confirmed(S, owner, cust, gid, near);
    const q1 = (await part({ amount: 300 }, cust, b2.id)).json.part_id; await pay(cust, q1);
    const q2 = (await part({ amount: 100 }, cust, b2.id)).json.part_id; await pay(cust, q2);
    await cust.patch(`/api/bookings/${b2.id}`, { action: "cancel" });
    const a2 = row(S, b2.id);
    assert.equal(a2.refund_cents, 11250); assert.equal(a2.balance_refund_cents, 20000); // 50% of the $225 deposit, 50% of the $400 paid
    assert.deepEqual(parts(S, b2.id).map((p) => [p.amount_cents, p.refund_cents]), [[30000, 10000], [10000, 10000]]);

    // the group marks the balance paid in cash: a pending payment is no longer accepted
    const b3 = await confirmed(S, owner, cust, gid, ds[2]);
    const late = (await part({ amount: 100 }, cust, b3.id)).json.part_id;
    await owner.post(`/api/bookings/${b3.id}/balance-offline`, { received: true });
    assert.equal((await pay(cust, late)).status, 409);
    assert.equal(row(S, b3.id).balance_parts_cents, 0);
    // the group cancelling refunds everything paid in parts too
    const b4 = await confirmed(S, owner, cust, gid, ds[3]);
    const x = (await part({ amount: 250 }, cust, b4.id)).json.part_id; await pay(cust, x);
    await owner.patch(`/api/bookings/${b4.id}`, { action: "cancel" });
    assert.equal(row(S, b4.id).balance_refund_cents, 25000);
  } finally { await S.close(); }
});

test("one checkout for the whole party, and vendor bundles (simulated)", async () => {
  const S = await startApp({ DEMO_SEED: "0" });
  try {
    const mo = client(S.base), vo = client(S.base), cust = client(S.base), other = client(S.base);
    await mo.signup("ck-m@example.com", "Music Owner"); await vo.signup("ck-v@example.com", "Vendor Owner"); await cust.signup("ck-c@example.com", "Ana Cliente"); await other.signup("ck-x@example.com", "Otro");
    const d = inDays(25), d2 = inDays(26);
    const mus = await makeGroup(mo, { name: "Mariachi Uno", dates: [d, d2] });
    const tent = (await vo.post("/api/groups", { name: "Carpas Uno", type: "Tents", zip: "60608", members: 2, story: "Tents delivered, staked and taken down by our crew, rain or shine." })).json.id;
    await vo.patch(`/api/groups/${tent}`, { events: ["Wedding"] }); await vo.put(`/api/groups/${tent}/availability`, { dates: { [d]: ["12:00 PM", "2:00 PM"], [d2]: ["12:00 PM"] } });
    await vo.post(`/api/groups/${tent}/photos`, { data: TINY_PNG }); await vo.post(`/api/groups/${tent}/packages`, { name: "20x40 tent", description: "", hours: 1, price: 600 });
    assert.equal((await vo.post(`/api/groups/${tent}/publish`)).status, 200);
    const pkg = (await cust.get(`/api/groups/${tent}`)).json.packages[0].id;

    // bundle: created by the tent company, accepted by the mariachi
    const mk = await vo.post(`/api/groups/${tent}/bundles`, { name: "Carpa + Mariachi", discount_pct: 10, partners: [`https://site.test/#/group/${mus}`] });
    assert.equal(mk.status, 200); assert.equal(mk.json.bundle.active, false);
    for (const bad of [{ name: "x", discount_pct: 10, partners: [mus] }, { name: "Combo", discount_pct: 50, partners: [mus] }, { name: "Combo", discount_pct: 10, partners: [] }, { name: "Combo", discount_pct: 10, partners: ["nope"] }, { name: "Combo", discount_pct: 10, partners: [tent] }])
      assert.equal((await vo.post(`/api/groups/${tent}/bundles`, bad)).status, 400, JSON.stringify(bad));
    assert.equal((await other.post(`/api/groups/${tent}/bundles`, { name: "Combo", discount_pct: 10, partners: [mus] })).status, 403);
    assert.deepEqual((await cust.get(`/api/groups/${mus}/bundle-deals`)).json.bundles, []); // not active until everyone accepts
    assert.ok(S.db.all("SELECT kind FROM email_log").some((r) => r.kind === "bundle.invite.group"));
    assert.equal((await other.post(`/api/bundles/${mk.json.bundle.id}/accept`, { groupId: mus })).status, 403);
    assert.equal((await mo.post(`/api/bundles/${mk.json.bundle.id}/accept`, { groupId: mus })).json.bundle.active, true);
    const deals = (await cust.get(`/api/groups/${mus}/bundle-deals`)).json.bundles;
    assert.equal(deals.length, 1); assert.equal(deals[0].discount_pct, 10); assert.deepEqual(deals[0].members.map((m) => m.name).sort(), ["Carpas Uno", "Mariachi Uno"]);

    // two holds for the same day, paid in one checkout: bundle discount applied to each
    const h1 = (await cust.post("/api/bookings", bookingBody(mus, d, { hours: 3 }))).json.booking;
    const h2 = (await cust.post("/api/bookings", bookingBody(tent, d, { packageId: pkg, time: "12:00 PM" }))).json.booking;
    assert.equal((await cust.post("/api/cart", { bookingIds: [h1.id] })).status, 400);
    assert.equal((await other.post("/api/cart", { bookingIds: [h1.id, h2.id] })).status, 404);
    const plain1 = row(S, h1.id), plain2 = row(S, h2.id);
    const preview = (await cust.post("/api/cart/preview", { bookingIds: [h1.id, h2.id] })).json;
    assert.equal(preview.discount_cents, 15000);
    assert.equal((await other.post("/api/cart/preview", { bookingIds: [h1.id, h2.id] })).status, 404);
    const cart = await cust.post("/api/cart", { bookingIds: [h1.id, h2.id] });
    assert.equal(cart.status, 200);
    // the discount lives in the cart until it is paid: the bookings still cost the full price on their own
    for (const [id, plain] of [[h1.id, plain1], [h2.id, plain2]]) { const r = row(S, id); assert.equal(r.discount_cents, 0); assert.equal(r.total_cents, plain.total_cents); assert.equal(r.deposit_cents, plain.deposit_cents); }
    const items = (await cust.get(`/api/carts/${cart.json.cart_id}`)).json.cart.items;
    assert.deepEqual(items.map((x) => x.discount_cents), [9000, 6000]);
    assert.equal(items[0].deposit_cents, Math.ceil(81000 * 0.25));
    assert.equal(cart.json.amount_cents, items[0].deposit_cents + items[1].deposit_cents);
    assert.equal(cart.json.amount_cents, preview.amount_cents);
    const again = await cust.post("/api/cart", { bookingIds: [h1.id, h2.id] }); // making the cart again gives the same price
    assert.equal(again.json.amount_cents, cart.json.amount_cents);
    assert.equal((await other.post(`/api/carts/${cart.json.cart_id}/simulate-pay`)).status, 404);
    assert.equal((await cust.post(`/api/carts/${cart.json.cart_id}/simulate-pay`)).status, 200);
    const r1 = row(S, h1.id), r2 = row(S, h2.id);
    assert.equal(r1.discount_cents, 9000); assert.equal(r1.total_cents, 81000); assert.equal(r1.deposit_cents, Math.ceil(81000 * 0.25));
    assert.equal(r2.discount_cents, 6000); assert.equal(r2.total_cents, 54000);
    assert.equal(cart.json.amount_cents, r1.deposit_cents + r2.deposit_cents);
    for (const id of [h1.id, h2.id]) { const r = row(S, id); assert.equal(r.status, "requested"); assert.equal(r.payment_status, "paid"); assert.equal(r.cart_id, cart.json.cart_id); }
    assert.equal((await cust.post("/api/cart", { bookingIds: [h1.id, h2.id] })).status, 400); // already paid
    // paying the earlier cart too: the deposits were already paid, so that money goes back (what that cart charged)
    await cust.post(`/api/carts/${again.json.cart_id}/simulate-pay`);
    const back = S.db.all("SELECT * FROM extra_refunds WHERE payment_intent LIKE ?", `sim_cart_${again.json.cart_id}#%`);
    assert.equal(back.length, 2); assert.equal(back.reduce((n, x) => n + x.cents, 0), again.json.amount_cents);

    // no discount when the bundle isn't complete (only the tent) or on different days
    const h3 = (await cust.post("/api/bookings", bookingBody(tent, d2, { packageId: pkg, time: "12:00 PM" }))).json.booking;
    // (the mariachi already plays 2-5 PM that day, so 4:00 PM is taken; noon to 2 still fits)
    assert.equal((await cust.post("/api/bookings", bookingBody(mus, d, { hours: 2, time: "4:00 PM" }))).status, 409);
    const h4 = (await cust.post("/api/bookings", bookingBody(mus, d, { hours: 2, time: "12:00 PM" }))).json.booking;
    const c34 = await cust.post("/api/cart", { bookingIds: [h3.id, h4.id] });
    assert.equal(c34.json.amount_cents, row(S, h3.id).deposit_cents + row(S, h4.id).deposit_cents);
    assert.deepEqual((await cust.get(`/api/carts/${c34.json.cart_id}`)).json.cart.items.map((x) => x.discount_cents), [0, 0]);

    // a bundle cart that is left unpaid can't be used to pay one vendor alone at the bundle price
    const h5 = (await cust.post("/api/bookings", bookingBody(mus, d2, { hours: 3, time: "2:00 PM" }))).json.booking;
    const c35 = await cust.post("/api/cart", { bookingIds: [h3.id, h5.id] });
    const items35 = (await cust.get(`/api/carts/${c35.json.cart_id}`)).json.cart.items;
    assert.ok(items35.every((x) => x.discount_cents > 0));
    const full5 = row(S, h5.id).total_cents;
    await cust.post(`/api/bookings/${h5.id}/simulate-pay`);
    assert.equal(row(S, h5.id).discount_cents, 0); assert.equal(row(S, h5.id).total_cents, full5);
    // and if that cart is paid later anyway, the vendor already paid on its own gets its cart share back
    await cust.post(`/api/carts/${c35.json.cart_id}/simulate-pay`);
    assert.equal(S.db.get("SELECT cents FROM extra_refunds WHERE payment_intent = ?", `sim_cart_${c35.json.cart_id}#${h5.id}`).cents, items35.find((x) => x.id === h5.id).deposit_cents);
    assert.equal(row(S, h3.id).cart_id, c35.json.cart_id); assert.ok(row(S, h3.id).discount_cents > 0);

    // leaving the bundle ends it
    assert.equal((await mo.del(`/api/bundles/${mk.json.bundle.id}?groupId=${mus}`)).status, 200);
    assert.deepEqual((await cust.get(`/api/groups/${tent}/bundle-deals`)).json.bundles, []);
  } finally { await S.close(); }
});

test("live Stripe: one checkout = one charge, a transfer to each vendor, and refunds that take back the vendor's share; parts refund on their own payments", async () => {
  const F = await fakeStripe();
  const SECRET = "whsec_test_money2";
  const S = await startApp({ DEMO_SEED: "0", STRIPE_SECRET_KEY: "sk_test_x", STRIPE_WEBHOOK_SECRET: SECRET, STRIPE_API_BASE: F.url, PLATFORM_FEE_PCT: "10" });
  let seq = 0;
  const hook = (object) => postWebhook(S.base, { id: `evt_m2_${++seq}`, type: "checkout.session.completed", data: { object: { payment_status: "paid", ...object } } }, SECRET);
  try {
    const o1 = client(S.base), o2 = client(S.base), cust = client(S.base);
    await o1.signup("lv-1@example.com", "Owner One"); await o2.signup("lv-2@example.com", "Owner Two"); await cust.signup("lv-c@example.com", "Live Cust");
    const d = inDays(30);
    const g1 = await makeGroup(o1, { name: "Live One", dates: [d] }), g2 = await makeGroup(o2, { name: "Live Two", dates: [d] });
    const b1 = (await cust.post("/api/bookings", bookingBody(g1, d, { hours: 3 }))).json.booking;      // $900, deposit $225, fee $90
    const b2 = (await cust.post("/api/bookings", bookingBody(g2, d, { hours: 2, time: "4:00 PM" }))).json.booking; // $600, deposit $150, fee $60
    const c = await cust.post("/api/cart", { bookingIds: [b1.id, b2.id] });
    assert.equal(c.status, 200); assert.equal(c.json.payment.mode, "stripe");
    const sess = [...F.calls].reverse().find((x) => x.url === "/v1/checkout/sessions");
    assert.equal(sess.form["payment_intent_data[transfer_group]"], c.json.cart_id);
    assert.equal(sess.form["payment_intent_data[transfer_data][destination]"], undefined); // not a destination charge
    assert.equal(sess.form["line_items[0][price_data][unit_amount]"], "22500"); assert.equal(sess.form["line_items[1][price_data][unit_amount]"], "15000");
    // the individual checkouts were closed
    assert.ok(F.calls.filter((x) => /\/expire$/.test(x.url)).length >= 2);

    // a wrong amount is ignored; the right one marks both paid and transfers each vendor its share
    await hook({ amount_total: 100, payment_intent: "pi_cart", metadata: { kind: "cart", cart_id: c.json.cart_id } });
    assert.equal(row(S, b1.id).payment_status, "unpaid");
    await hook({ amount_total: 37500, payment_intent: "pi_cart", metadata: { kind: "cart", cart_id: c.json.cart_id } });
    assert.equal(row(S, b1.id).status, "requested"); assert.equal(row(S, b2.id).status, "requested");
    const tr = F.state.transfers;
    assert.equal(tr.length, 2);
    assert.deepEqual(tr.map((t) => [t.amount, t.destination, t.transfer_group, t.source_transaction]).sort(), [["13500", "acct_test_1", c.json.cart_id, "ch_test_pi_cart"], ["9000", "acct_test_1", c.json.cart_id, "ch_test_pi_cart"]].sort());
    // the same event again: no second transfer
    await hook({ amount_total: 37500, payment_intent: "pi_cart", metadata: { kind: "cart", cart_id: c.json.cart_id } });
    assert.equal(F.state.transfers.length, 2);

    // group 2 declines: full refund from the shared charge (no reverse_transfer flag), and its whole transfer is reversed
    await o2.patch(`/api/bookings/${b2.id}`, { action: "decline" });
    const ref = F.state.refunded.at(-1);
    assert.deepEqual(ref, { pi: "pi_cart", amount: 15000 });
    const refCall = [...F.calls].reverse().find((x) => x.url === "/v1/refunds");
    assert.equal(refCall.form.reverse_transfer, undefined); assert.equal(refCall.form.refund_application_fee, undefined);
    assert.deepEqual(F.state.reversals.at(-1), { transfer: row(S, b2.id).stripe_transfer_id, amount: 9000 });
    // group 1 accepts; the customer cancels 4 days... (30 days out = 100%): reversal of the vendor's full share
    await o1.patch(`/api/bookings/${b1.id}`, { action: "accept" });
    await cust.patch(`/api/bookings/${b1.id}`, { action: "cancel" });
    assert.deepEqual(F.state.reversals.at(-1), { transfer: row(S, b1.id).stripe_transfer_id, amount: 13500 });
    assert.equal(row(S, b1.id).refund_cents, 22500);

    // a balance part in live mode: its own checkout to the vendor, refunded on its own payment
    const b3 = (await cust.post("/api/bookings", bookingBody(g1, d, { hours: 3, time: "4:00 PM" }))).json.booking;
    await hook({ amount_total: b3.deposit_cents, payment_intent: "pi_b3", metadata: { kind: "booking", booking_id: b3.id } });
    await o1.patch(`/api/bookings/${b3.id}`, { action: "accept" });
    const pt = await cust.post(`/api/bookings/${b3.id}/parts`, { amount: 100 });
    assert.equal(pt.json.payment.mode, "stripe");
    const ps = [...F.calls].reverse().find((x) => x.url === "/v1/checkout/sessions");
    assert.equal(ps.form["payment_intent_data[metadata][kind]"], "part"); assert.equal(ps.form["payment_intent_data[transfer_data][destination]"], "acct_test_1");
    assert.equal(ps.form["payment_intent_data[application_fee_amount]"], undefined);
    await hook({ amount_total: 999, payment_intent: "pi_part", metadata: { kind: "part", part_id: pt.json.part_id } }); // wrong amount: ignored
    assert.equal(row(S, b3.id).balance_parts_cents, 0);
    await hook({ amount_total: 10000, payment_intent: "pi_part", metadata: { kind: "part", part_id: pt.json.part_id } });
    assert.equal(row(S, b3.id).balance_parts_cents, 10000);
    await o1.patch(`/api/bookings/${b3.id}`, { action: "cancel" });
    const partRefund = [...F.calls].reverse().find((x) => x.url === "/v1/refunds" && x.form.payment_intent === "pi_part");
    assert.equal(partRefund.form.amount, "10000"); assert.equal(partRefund.form.reverse_transfer, "true"); assert.equal(partRefund.form.refund_application_fee, undefined);

    // a deposit paid on its own checkout just before the family starts one checkout: it is recorded, and no cart is made
    const b4 = (await cust.post("/api/bookings", bookingBody(g1, d, { hours: 2, time: "2:00 PM" }))).json.booking;
    const b5 = (await cust.post("/api/bookings", bookingBody(g2, d, { hours: 2, time: "12:00 PM" }))).json.booking;
    const cartsBefore = S.db.get("SELECT COUNT(*) c FROM carts").c;
    F.state.sessionPaid = true; F.state.sessionAmount = b4.deposit_cents;
    const late = await cust.post("/api/cart", { bookingIds: [b4.id, b5.id] });
    F.state.sessionPaid = false;
    assert.equal(late.status, 409);
    assert.equal(row(S, b4.id).payment_status, "paid"); assert.equal(row(S, b4.id).status, "requested");
    assert.equal(S.db.get("SELECT COUNT(*) c FROM carts").c, cartsBefore);
  } finally { await S.close(); await F.close(); }
});
