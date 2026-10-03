import crypto from "node:crypto";
import { HttpError } from "./util.js";

// Minimal Stripe REST client (Checkout, Connect Express, refunds) plus webhook verification.
// With no STRIPE_SECRET_KEY the app runs in "simulated" mode and never contacts Stripe.
function flatten(value, prefix, out) {
  if (value === undefined || value === null) return out;
  if (Array.isArray(value)) value.forEach((v, i) => flatten(v, `${prefix}[${i}]`, out));
  else if (typeof value === "object") for (const [k, v] of Object.entries(value)) flatten(v, prefix ? `${prefix}[${k}]` : k, out);
  else out.push([prefix, String(value)]);
  return out;
}

export function verifyWebhook(rawBody, header, secret, { toleranceSec = 300, nowSec = Math.floor(Date.now() / 1000) } = {}) {
  if (!secret) throw new HttpError(400, "Webhook secret not configured");
  const parts = String(header || "").split(",").map((p) => p.trim().split("="));
  const t = parts.find(([k]) => k === "t")?.[1];
  const sigs = parts.filter(([k]) => k === "v1").map(([, v]) => v);
  if (!t || !sigs.length) throw new HttpError(400, "Bad signature header");
  if (Math.abs(nowSec - Number(t)) > toleranceSec) throw new HttpError(400, "Signature timestamp outside tolerance");
  const expected = crypto.createHmac("sha256", secret).update(`${t}.`).update(rawBody).digest("hex");
  const ok = sigs.some((s) => s.length === expected.length && crypto.timingSafeEqual(Buffer.from(s), Buffer.from(expected)));
  if (!ok) throw new HttpError(400, "Bad signature");
  try { return JSON.parse(rawBody.toString("utf8")); } catch { throw new HttpError(400, "Bad webhook body"); }
}

export function createStripe(config) {
  const live = Boolean(config.stripeKey);

  async function call(method, path, params, idempotencyKey) {
    if (!live) throw new Error("Stripe is not configured");
    const flat = flatten(params, "", []);
    const headers = { Authorization: `Bearer ${config.stripeKey}` };
    if (idempotencyKey) headers["Idempotency-Key"] = idempotencyKey;
    let url = config.stripeApi + path, body;
    if (method === "GET") { if (flat.length) url += "?" + new URLSearchParams(flat); }
    else { headers["Content-Type"] = "application/x-www-form-urlencoded"; body = new URLSearchParams(flat); }
    let res;
    try { res = await fetch(url, { method, headers, body }); } catch { throw new HttpError(502, "Could not reach the payment provider"); }
    const json = await res.json().catch(() => ({}));
    if (!res.ok) throw new HttpError(502, json?.error?.message || "Payment provider error");
    return json;
  }

  return {
    live,
    mode: live ? "stripe" : "simulated",

    // Deposit for a booking: charged to the platform, transferred to the group's connected account minus our fee.
    checkoutForBooking({ booking, group, successUrl, cancelUrl, attempt = "" }) {
      return call("POST", "/v1/checkout/sessions", {
        mode: "payment",
        success_url: successUrl,
        cancel_url: cancelUrl,
        client_reference_id: booking.id,
        expires_at: Math.floor(Date.now() / 1000) + 2400, // Stripe requires 30 min or more; our slot hold is 30 min and late payments are handled
        line_items: [{ quantity: 1, price_data: { currency: "usd", unit_amount: booking.deposit_cents, product_data: { name: `Deposit: ${group.name} on ${booking.date}` } } }],
        payment_intent_data: {
          application_fee_amount: booking.platform_fee_cents,
          transfer_data: { destination: group.stripe_account_id },
          metadata: { kind: "booking", booking_id: booking.id }
        },
        metadata: { kind: "booking", booking_id: booking.id }
      }, `checkout-booking-${booking.id}${attempt ? "-" + attempt : ""}`); // a payment link can be paid days later: a new checkout each time
    },

    checkoutForFeature({ feature, group, successUrl, cancelUrl }) {
      return call("POST", "/v1/checkout/sessions", {
        mode: "payment",
        success_url: successUrl,
        cancel_url: cancelUrl,
        client_reference_id: feature.id,
        line_items: [{ quantity: 1, price_data: { currency: "usd", unit_amount: feature.amount_cents, product_data: { name: feature.name || `Featured placement (30 days): ${group.name}` } } }],
        payment_intent_data: { metadata: { kind: "feature", feature_id: feature.id } },
        metadata: { kind: "feature", feature_id: feature.id }
      }, `checkout-feature-${feature.id}`);
    },

    // The rest of the price, paid after the group confirms. No platform fee here: it was already taken from the deposit.
    checkoutForBalance({ booking, group, successUrl, cancelUrl }) {
      return call("POST", "/v1/checkout/sessions", {
        mode: "payment", success_url: successUrl, cancel_url: cancelUrl, client_reference_id: booking.id,
        expires_at: Math.floor(Date.now() / 1000) + 2400,
        line_items: [{ quantity: 1, price_data: { currency: "usd", unit_amount: booking.total_cents - booking.deposit_cents, product_data: { name: `Balance: ${group.name} on ${booking.date}` } } }],
        payment_intent_data: { transfer_data: { destination: group.stripe_account_id }, metadata: { kind: "balance", booking_id: booking.id } },
        metadata: { kind: "balance", booking_id: booking.id }
      }, `checkout-balance-${booking.id}-${Math.floor(Date.now() / 600000)}`); // retries within 10 minutes reuse the same session
    },
    // Part of the balance (a payment plan installment or a padrino). Same as the balance: no platform fee, all to the group.
    checkoutForPart({ part, booking, group, successUrl, cancelUrl }) {
      return call("POST", "/v1/checkout/sessions", {
        mode: "payment", success_url: successUrl, cancel_url: cancelUrl, client_reference_id: part.id,
        expires_at: Math.floor(Date.now() / 1000) + 2400,
        line_items: [{ quantity: 1, price_data: { currency: "usd", unit_amount: part.amount_cents, product_data: { name: `${group.name} on ${booking.date} (part of the balance)` } } }],
        payment_intent_data: { transfer_data: { destination: group.stripe_account_id }, metadata: { kind: "part", part_id: part.id, booking_id: booking.id } },
        metadata: { kind: "part", part_id: part.id, booking_id: booking.id }
      }, `checkout-part-${part.id}`);
    },
    // Added at the party (one more hour, an add-on): straight to the vendor, with the platform fee on it like the booking.
    checkoutForExtra({ extra, booking, group, successUrl, cancelUrl }) {
      return call("POST", "/v1/checkout/sessions", {
        mode: "payment", success_url: successUrl, cancel_url: cancelUrl, client_reference_id: extra.id,
        expires_at: Math.floor(Date.now() / 1000) + 2400,
        line_items: [{ quantity: 1, price_data: { currency: "usd", unit_amount: extra.amount_cents, product_data: { name: `${group.name} on ${booking.date}: ${extra.label}` } } }],
        payment_intent_data: { application_fee_amount: extra.fee_cents, transfer_data: { destination: group.stripe_account_id }, metadata: { kind: "extra", extra_id: extra.id, booking_id: booking.id } },
        metadata: { kind: "extra", extra_id: extra.id, booking_id: booking.id }
      }, `checkout-extra-${extra.id}-${Math.floor(Date.now() / 600000)}`);
    },
    // A tip after the party: to the vendor, keeping only the card processing cost.
    checkoutForTip({ tip, booking, group, successUrl, cancelUrl }) {
      return call("POST", "/v1/checkout/sessions", {
        mode: "payment", success_url: successUrl, cancel_url: cancelUrl, client_reference_id: tip.id,
        expires_at: Math.floor(Date.now() / 1000) + 2400,
        line_items: [{ quantity: 1, price_data: { currency: "usd", unit_amount: tip.amount_cents, product_data: { name: `Propina for ${group.name}` } } }],
        payment_intent_data: { ...(tip.fee_cents ? { application_fee_amount: tip.fee_cents } : {}), transfer_data: { destination: group.stripe_account_id }, metadata: { kind: "tip", tip_id: tip.id, booking_id: booking.id } },
        metadata: { kind: "tip", tip_id: tip.id, booking_id: booking.id }
      }, `checkout-tip-${tip.id}`);
    },
    // Several deposits in one charge. The money stays with the platform until we transfer each vendor its share
    // (separate charges and transfers), grouped by transfer_group so Stripe shows them together.
    checkoutForCart({ cart, lines, successUrl, cancelUrl }) {
      return call("POST", "/v1/checkout/sessions", {
        mode: "payment", success_url: successUrl, cancel_url: cancelUrl, client_reference_id: cart.id,
        expires_at: Math.floor(Date.now() / 1000) + 2400,
        line_items: lines.map((l) => ({ quantity: 1, price_data: { currency: "usd", unit_amount: l.amount, product_data: { name: l.name } } })),
        payment_intent_data: { transfer_group: cart.id, metadata: { kind: "cart", cart_id: cart.id } },
        metadata: { kind: "cart", cart_id: cart.id }
      }, `checkout-cart-${cart.id}`);
    },
    getPaymentIntent: (id) => call("GET", `/v1/payment_intents/${encodeURIComponent(id)}`),
    transfer: ({ amountCents, destination, group, sourceCharge, key }) => call("POST", "/v1/transfers", { amount: amountCents, currency: "usd", destination, transfer_group: group, ...(sourceCharge ? { source_transaction: sourceCharge } : {}) }, key),
    reverseTransfer: ({ transfer, amountCents, key }) => call("POST", `/v1/transfers/${encodeURIComponent(transfer)}/reversals`, { amount: amountCents }, key),
    expireCheckoutSession: (id) => call("POST", `/v1/checkout/sessions/${encodeURIComponent(id)}/expire`, {}),

    getCheckoutSession: (id) => call("GET", `/v1/checkout/sessions/${encodeURIComponent(id)}`),

    // Refund a deposit. reverse_transfer pulls the money back from the group; the app fee is returned too.
    // destination=false: a cart charge (the platform holds the money); the vendor's transfer is reversed separately.
    refund({ paymentIntent, amountCents, key, applicationFee = true, destination = true }) {
      return call("POST", "/v1/refunds", { payment_intent: paymentIntent, amount: amountCents, ...(destination ? { reverse_transfer: "true", ...(applicationFee ? { refund_application_fee: "true" } : {}) } : {}) }, key);
    },

    createAccount: (email) => call("POST", "/v1/accounts", { type: "express", country: "US", email, capabilities: { card_payments: { requested: true }, transfers: { requested: true } } }),
    accountLink: (account, refreshUrl, returnUrl) => call("POST", "/v1/account_links", { account, refresh_url: refreshUrl, return_url: returnUrl, type: "account_onboarding" }),
    getAccount: (id) => call("GET", `/v1/accounts/${encodeURIComponent(id)}`)
  };
}
