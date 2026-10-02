// Prints the exact amounts Stripe should show for a booking, so you can check your test-mode run line by line.
//   npm run stripe:expect -- 600 25 moderate        (total in dollars, deposit %, policy; all optional)
import { buildQuote, refundParts, POLICIES, balanceCents } from "./pricing.js";
import { loadConfig } from "./config.js";
import { addDays, todayStr } from "./util.js";

const [totalArg, pctArg, policyArg] = process.argv.slice(2);
const totalDollars = Number(totalArg || 600), pct = Number(pctArg || 25), policy = POLICIES[policyArg] ? policyArg : "moderate";
if (!(totalDollars >= 1) || !(pct >= 20 && pct <= 50)) { console.error("Usage: npm run stripe:expect -- <total in dollars> <deposit % 20-50> <flexible|moderate|strict>"); process.exit(1); }
const feePct = loadConfig(process.env).platformFeePct;
const usd = (c) => "$" + (c / 100).toFixed(2);
const group = { rate_cents: 0, travel_miles: 999, travel_fee_cents: 0, deposit_pct: pct, cancel_policy: policy };
const q = buildQuote({ group, pkg: { hours: 3, price_cents: Math.round(totalDollars * 100) }, hours: 3, distanceMiles: 0, feePct });

console.log(`\nA ${usd(q.total_cents)} booking, ${pct}% deposit, ${policy} policy, platform fee ${feePct}% of the total\n`);
console.log("What Stripe should show");
console.log(`  1. Deposit charge .................. ${usd(q.deposit_cents)}   (customer pays this when booking)`);
console.log(`     your application fee ............ ${usd(q.platform_fee_cents)}   (${feePct}% of ${usd(q.total_cents)}, never more than the deposit)`);
console.log(`     transfer to the group ........... ${usd(q.deposit_cents - q.platform_fee_cents)}`);
console.log(`  2. Balance charge .................. ${usd(q.balance_cents)}   (paid later in the app; NO application fee, full amount transferred to the group)\n`);

console.log(`If the customer cancels (${policy}): \"${POLICIES[policy].text.en}\"`);
console.log("  Days before the event | % refunded | Deposit refund | Balance refund (if it was paid) | Total back");
const today = todayStr();
for (const days of [60, 30, 14, 10, 7, 5, 3, 2, 1]) {
  const b = { policy, date: addDays(today, days), payment_status: "paid", balance_status: "paid", deposit_cents: q.deposit_cents, total_cents: q.total_cents };
  const p = refundParts(b, today);
  console.log(`  ${String(days).padStart(21)} | ${String(p.pct).padStart(10)}% | ${usd(p.deposit).padStart(14)} | ${usd(p.balance).padStart(31)} | ${usd(p.deposit + p.balance).padStart(10)}`);
}
console.log(`\nIf the group declines or cancels, or an admin refunds a no-show: everything paid in the app comes back (${usd(q.deposit_cents)} deposit${q.balance_cents ? ` + ${usd(q.balance_cents)} balance` : ""}), the group's transfer is reversed, and your ${usd(q.platform_fee_cents)} fee is refunded on the deposit.`);
console.log(`Check the balance too: owed on the day = ${usd(balanceCents({ total_cents: q.total_cents, deposit_cents: q.deposit_cents }))}.\n`);
