// Owner tools. There is no email service, so this is how you help someone who forgot their password.
//   npm run admin -- reset-password someone@example.com
//   npm run admin -- stats
import crypto from "node:crypto";
import { loadConfig } from "./config.js";
import { openDb } from "./db.js";
import { hashPassword } from "./auth.js";

const [cmd, arg] = process.argv.slice(2);
const db = openDb(loadConfig());
try {
  if (cmd === "reset-password" && arg) {
    const u = db.get("SELECT id FROM users WHERE email = ?", arg.toLowerCase());
    if (!u) { console.error("No user with that email."); process.exitCode = 1; }
    else {
      const pw = crypto.randomBytes(9).toString("base64url");
      db.run("UPDATE users SET pass_hash = ? WHERE id = ?", await hashPassword(pw), u.id);
      db.run("DELETE FROM sessions WHERE user_id = ?", u.id);
      console.log(`New temporary password for ${arg}: ${pw}\nTell them to change it under Account. All their sessions were signed out.`);
    }
  } else if (cmd === "stats") {
    console.log("users:", db.get("SELECT COUNT(*) c FROM users").c, "| groups:", db.get("SELECT COUNT(*) c FROM groups WHERE demo = 0").c, "(+ sample:", db.get("SELECT COUNT(*) c FROM groups WHERE demo = 1").c + ")");
    for (const r of db.all("SELECT status, payment_status, COUNT(*) c, SUM(deposit_cents) d, SUM(platform_fee_cents) f FROM bookings GROUP BY status, payment_status")) {
      console.log(`bookings ${r.status}/${r.payment_status}: ${r.c}  deposits $${(r.d / 100).toFixed(2)}  platform fees $${(r.f / 100).toFixed(2)}`);
    }
  } else {
    console.log("Usage: npm run admin -- reset-password <email> | stats");
    process.exitCode = 1;
  }
} finally { db.raw.close(); }
