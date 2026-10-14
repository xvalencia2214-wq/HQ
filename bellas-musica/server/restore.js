// Bring the site back from the off-site bucket after a lost disk:
//   npm run restore -- 2026-10-14      (the day's database, then every photo and document it lists)
// Stop the site first (or run it on the new disk before starting it). What was on the disk is kept, renamed.
import { loadConfig } from "./config.js";
import { restoreFromOffsite } from "./offsite.js";

const date = process.argv[2] || "";
try { await restoreFromOffsite(loadConfig(), date); console.log("Done. Start the site again."); }
catch (e) { console.error("Restore failed:", e.message); process.exit(1); }
