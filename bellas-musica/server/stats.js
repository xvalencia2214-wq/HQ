import { todayStr } from "./util.js";

// Cookie-less, anonymous counters ("how many searches today", "how many views did this group get").
// No IP addresses, no user ids: just a number per day, per event, per subject (a ZIP or a group).
export function createStats(db) {
  return {
    count(key, ref = "") {
      db.run("INSERT INTO stats_daily (day, key, ref, n) VALUES (?, ?, ?, 1) ON CONFLICT(day, key, ref) DO UPDATE SET n = n + 1", todayStr(), key, String(ref).slice(0, 80));
    },
    // Total for a key over the last `days` days, optionally for one subject.
    total(key, days = 30, ref) {
      const since = new Date(); since.setDate(since.getDate() - days);
      const from = `${since.getFullYear()}-${String(since.getMonth() + 1).padStart(2, "0")}-${String(since.getDate()).padStart(2, "0")}`;
      return db.get(`SELECT COALESCE(SUM(n), 0) n FROM stats_daily WHERE key = ? AND day >= ?${ref !== undefined ? " AND ref = ?" : ""}`, ...(ref !== undefined ? [key, from, ref] : [key, from])).n;
    },
    top(key, days = 30, limit = 10) {
      const since = new Date(); since.setDate(since.getDate() - days);
      const from = `${since.getFullYear()}-${String(since.getMonth() + 1).padStart(2, "0")}-${String(since.getDate()).padStart(2, "0")}`;
      return db.all("SELECT ref, SUM(n) n FROM stats_daily WHERE key = ? AND day >= ? AND ref != '' GROUP BY ref ORDER BY n DESC LIMIT ?", key, from, limit);
    },
    daily(key, days = 30) {
      const since = new Date(); since.setDate(since.getDate() - days);
      const from = `${since.getFullYear()}-${String(since.getMonth() + 1).padStart(2, "0")}-${String(since.getDate()).padStart(2, "0")}`;
      return db.all("SELECT day, SUM(n) n FROM stats_daily WHERE key = ? AND day >= ? GROUP BY day ORDER BY day", key, from);
    }
  };
}
