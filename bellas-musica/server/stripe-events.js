// Stripe events beyond payments: chargebacks (disputes) and changes to a vendor's payout account.
// The webhook in routes/bookings.js hands every verified event here first.
import { now } from "./util.js";
import { defineTemplates, usd } from "./emails.js";

const B = "Bella's Música";
defineTemplates({
  "payouts.off.group": { transactional: true,
    en: (v) => ({ subject: "Action needed: your payouts are paused", lines: [`Hi ${v.name},`, `Stripe paused payouts for ${v.group}, so families can't pay deposits to you right now.`, "Open Payments on your dashboard and finish what Stripe asks for. It usually takes a few minutes."], cta: { label: "Fix my payouts", url: v.url }, sms: `${B}: Stripe paused payouts for ${v.group}. Open Payments to fix it: ${v.url}` }),
    es: (v) => ({ subject: "Acción necesaria: tus pagos están en pausa", lines: [`Hola ${v.name},`, `Stripe pausó los pagos de ${v.group}, así que las familias no pueden pagarte depósitos ahora.`, "Abre Pagos en tu panel y termina lo que pide Stripe. Normalmente toma unos minutos."], cta: { label: "Arreglar mis pagos", url: v.url }, sms: `${B}: Stripe pausó los pagos de ${v.group}. Abre Pagos para arreglarlo: ${v.url}` }) }
});

// What a Connect account allows: deposits can reach the vendor, and Stripe has checked who the owner is.
export function accountStatus(acct) {
  const transfersOk = acct.capabilities?.transfers === undefined || acct.capabilities.transfers === "active";
  const ready = Boolean(acct.charges_enabled && acct.payouts_enabled && transfersOk);
  // Stripe only turns payouts on once it has checked who the person is (name, date of birth, SSN, and an ID document when
  // it asks for one). Nothing outstanding or overdue: we show "ID checked". We never see or keep the ID itself.
  const req = acct.requirements || {};
  const idOk = ready && !req.disabled_reason && !(req.past_due || []).length && !(req.currently_due || []).some((r) => /verification|individual|representative|id_number|dob|ssn/.test(r));
  return { ready, idOk };
}

// Save what Stripe says about a vendor's account. Payouts that were on and are now off: tell the vendor and the owner.
export function applyAccount(ctx, acct) {
  const { db } = ctx;
  if (!acct || !acct.id) return 0;
  const { ready, idOk } = accountStatus(acct);
  const groups = db.all("SELECT * FROM groups WHERE stripe_account_id = ?", String(acct.id));
  for (const g of groups) {
    db.run("UPDATE groups SET stripe_ready = ?, id_checked = ?, stripe_checked_at = ? WHERE id = ?", ready ? 1 : 0, idOk ? 1 : 0, now(), g.id);
    if (g.stripe_ready && !ready) {
      ctx.alert(`PAYOUTS PAUSED by Stripe for ${g.name} (${g.id}). It can't take deposits until the vendor finishes what Stripe asks for.`, "payouts-off-" + g.id);
      ctx.notify.toGroup(g, "payouts.off.group", { group: g.name, url: `${ctx.config.baseUrl}/#/dashboard?g=${encodeURIComponent(g.id)}&tab=payments` }, { phone: g.contact_phone });
    }
  }
  return groups.length;
}

// Which booking a payment belongs to (a deposit, a balance, a part, an extra, a tip, or a whole cart).
function bookingOfPayment(db, pi) {
  if (!pi) return null;
  const direct = db.get("SELECT id, group_id FROM bookings WHERE stripe_payment_intent = ? OR balance_pi = ? LIMIT 1", pi, pi);
  if (direct) return direct;
  for (const table of ["balance_parts", "extras", "tips"]) {
    const r = db.get(`SELECT b.id, b.group_id FROM ${table} x JOIN bookings b ON b.id = x.booking_id WHERE x.pi = ? LIMIT 1`, pi);
    if (r) return r;
  }
  return db.get("SELECT b.id, b.group_id FROM carts c JOIN bookings b ON b.cart_id = c.id WHERE c.pi = ? LIMIT 1", pi) || null;
}

// A chargeback: record it, and tell the owner right away (Stripe gives only a few days to answer with evidence).
export function applyDispute(ctx, type, d) {
  const { db } = ctx;
  if (!d || !d.id) return;
  const pi = String(d.payment_intent || ""), b = bookingOfPayment(db, pi);
  const dueBy = Number(d.evidence_details?.due_by || 0), t = now();
  const before = db.get("SELECT status FROM disputes WHERE id = ?", String(d.id));
  db.run(`INSERT INTO disputes (id, payment_intent, booking_id, group_id, amount_cents, reason, status, due_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET status = excluded.status, due_by = CASE WHEN excluded.due_by > 0 THEN excluded.due_by ELSE disputes.due_by END, amount_cents = excluded.amount_cents, updated_at = excluded.updated_at`,
    String(d.id), pi, b?.id || "", b?.group_id || "", Number(d.amount || 0), String(d.reason || ""), String(d.status || ""), dueBy, t, t);
  const what = `${usd(Number(d.amount || 0))}${b ? ` on booking ${b.id}` : ""} (${pi || "no payment id"})`;
  if (type === "charge.dispute.created" || !before) {
    const due = dueBy ? new Date(dueBy * 1000).toISOString().slice(0, 10) : "soon";
    ctx.alert(`CHARGEBACK: a customer disputed ${what}, reason "${d.reason || "unknown"}". Answer it in your Stripe dashboard (Payments > Disputes) before ${due}: send the booking, the messages and the signed agreement.`, "dispute-" + d.id);
  } else if (type === "charge.dispute.closed") {
    ctx.alert(`Chargeback ${d.status === "won" ? "WON" : d.status === "lost" ? "LOST" : "closed (" + d.status + ")"}: ${what}.`, "dispute-closed-" + d.id);
  }
}

// Called by the webhook for every verified event. True when it was one of these.
export function handleStripeEvent(ctx, event) {
  const obj = event.data?.object || {};
  if (event.type === "account.updated") { applyAccount(ctx, obj); return true; }
  if (/^charge\.dispute\./.test(event.type)) { applyDispute(ctx, event.type, obj); return true; }
  return false;
}

// The daily safety net for a missed webhook: re-read the payout accounts not checked in the last day (a few per run).
export async function recheckAccounts(ctx, { limit = 20 } = {}) {
  const { db, stripe } = ctx;
  if (!stripe.live) return 0;
  const rows = db.all("SELECT DISTINCT stripe_account_id a FROM groups WHERE stripe_account_id != '' AND demo = 0 AND stripe_checked_at < ? ORDER BY stripe_checked_at LIMIT ?", now() - 86400, limit);
  let n = 0;
  for (const r of rows) {
    try { applyAccount(ctx, { ...(await stripe.getAccount(r.a)), id: r.a }); n++; }
    catch { db.run("UPDATE groups SET stripe_checked_at = ? WHERE stripe_account_id = ?", now(), r.a); } // try again tomorrow
  }
  return n;
}
