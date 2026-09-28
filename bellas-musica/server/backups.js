import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { todayStr } from "./util.js";

// A consistent copy of the database (safe while the server runs). The copy is checked before it counts as a backup.
export function backupTo(rawDb, dest) {
  const tmp = dest + ".partial";
  fs.rmSync(tmp, { force: true });
  rawDb.exec(`VACUUM INTO '${tmp.replace(/'/g, "''")}'`);
  const copy = new DatabaseSync(tmp);
  try {
    const ok = copy.prepare("PRAGMA quick_check").get();
    if (Object.values(ok)[0] !== "ok") throw new Error("backup failed its integrity check");
  } finally { copy.close(); }
  fs.renameSync(tmp, dest);
  return dest;
}

const NAME = /^bellas-(\d{4}-\d{2}-\d{2})\.db$/;
export function listBackups(dir) {
  if (!dir || !fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter((f) => NAME.test(f)).sort().map((f) => ({ file: f, path: path.join(dir, f), mtime: fs.statSync(path.join(dir, f)).mtimeMs }));
}

// Daily: make today's backup if it doesn't exist, keep the newest `keep`, and shout if the newest is stale.
export function backupIfNeeded(ctx) {
  const { config, db, alert } = ctx;
  if (!config.backupDir) return null;
  fs.mkdirSync(config.backupDir, { recursive: true });
  const dest = path.join(config.backupDir, `bellas-${todayStr()}.db`);
  let made = null;
  if (!fs.existsSync(dest)) {
    try { backupTo(db.raw, dest); made = dest; }
    catch (e) { alert(`Nightly backup FAILED: ${e.message}`, "backup"); }
  }
  const all = listBackups(config.backupDir);
  for (const old of all.slice(0, Math.max(0, all.length - config.backupKeep))) fs.rmSync(old.path, { force: true });
  const newest = listBackups(config.backupDir).at(-1);
  if (!newest || Date.now() - newest.mtime > 36 * 3600_000) alert("No database backup in the last 36 hours", "backup-stale");
  return made;
}

export function backupStatus(config) {
  if (!config.backupDir) return { enabled: false };
  const list = listBackups(config.backupDir);
  return { enabled: true, count: list.length, last_at: list.length ? Math.floor(list.at(-1).mtime / 1000) : null, keep: config.backupKeep };
}
