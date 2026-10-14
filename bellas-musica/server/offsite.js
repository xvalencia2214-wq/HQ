// Off-site backups: every night the database copy, and every photo and document not sent yet, go to a storage bucket
// somewhere else (Cloudflare R2, Amazon S3, Backblaze B2: anything that speaks the S3 API). If the server's disk is ever
// lost, `npm run restore` brings it all back. No packages: requests are signed here (AWS Signature Version 4).
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { now, todayStr } from "./util.js";
import { backupTo } from "./backups.js";

const sha256 = (data) => crypto.createHash("sha256").update(data).digest("hex");
const hmac = (key, data) => crypto.createHmac("sha256", key).update(data).digest();
const enc = (s) => encodeURIComponent(s).replace(/[!'()*]/g, (c) => "%" + c.charCodeAt(0).toString(16).toUpperCase());

// Signs one request. `headers` are lower-case names; the host and the date stamp are added.
export function signV4({ method, url, headers = {}, payloadHash, keyId, secret, region, service = "s3", amzDate }) {
  const u = new URL(url);
  const h = { ...headers, host: u.host, "x-amz-date": amzDate, "x-amz-content-sha256": payloadHash };
  const names = Object.keys(h).map((k) => k.toLowerCase()).sort();
  const canonicalHeaders = names.map((k) => `${k}:${String(h[k]).trim().replace(/\s+/g, " ")}\n`).join("");
  const query = [...u.searchParams].map(([k, v]) => [enc(k), enc(v)]).sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : a[1] < b[1] ? -1 : 1)).map(([k, v]) => `${k}=${v}`).join("&");
  const canonical = [method, u.pathname, query, canonicalHeaders, names.join(";"), payloadHash].join("\n");
  const day = amzDate.slice(0, 8), scope = `${day}/${region}/${service}/aws4_request`;
  const toSign = ["AWS4-HMAC-SHA256", amzDate, scope, sha256(canonical)].join("\n");
  const key = hmac(hmac(hmac(hmac("AWS4" + secret, day), region), service), "aws4_request");
  const signature = crypto.createHmac("sha256", key).update(toSign).digest("hex");
  return { ...h, authorization: `AWS4-HMAC-SHA256 Credential=${keyId}/${scope}, SignedHeaders=${names.join(";")}, Signature=${signature}` };
}

const stamp = () => new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
const objectUrl = (cfg, key) => `${cfg.url.replace(/\/+$/, "")}/${key.split("/").map(enc).join("/")}`;

async function s3(cfg, method, key, body) {
  const url = objectUrl(cfg, key), payloadHash = sha256(body || "");
  const headers = signV4({ method, url, headers: body ? { "content-type": "application/octet-stream" } : {}, payloadHash, keyId: cfg.keyId, secret: cfg.secret, region: cfg.region, amzDate: stamp() });
  delete headers.host; // fetch sets it
  const res = await fetch(url, { method, headers, body: body || undefined });
  if (!res.ok) throw new Error(`${method} ${key}: ${res.status} ${(await res.text().catch(() => "")).slice(0, 200)}`);
  return res;
}
export const s3Put = (cfg, key, body) => s3(cfg, "PUT", key, body);
export const s3Get = async (cfg, key) => Buffer.from(await (await s3(cfg, "GET", key)).arrayBuffer());

export const offsiteConfig = (config) => (config.offsite && config.offsite.url && config.offsite.keyId && config.offsite.secret ? config.offsite : null);

// The private folders that hold what people uploaded: photos (public) and licence documents (private).
const FOLDERS = (config) => [["uploads", config.uploadDir], ["documents", path.join(config.dataDir, "documents")]];

// Run from the hourly job: today's database copy once, then any file not sent yet (a few hundred per run).
let running = false; // a slow upload never overlaps the next hour's run
export async function offsiteBackup(ctx, opts = {}) {
  if (running) return { sent: 0, busy: true };
  running = true;
  try { return await offsiteRun(ctx, opts); } finally { running = false; }
}
async function offsiteRun(ctx, { maxFiles = 300 } = {}) {
  const { db, config } = ctx, cfg = offsiteConfig(config);
  if (!cfg) return { sent: 0 };
  const sentAlready = (name) => Boolean(db.get("SELECT 1 AS x FROM offsite_files WHERE name = ?", name));
  const mark = (name, size) => db.run("INSERT OR REPLACE INTO offsite_files (name, size, at) VALUES (?, ?, ?)", name, size, now());
  let sent = 0;
  try {
    // files first, then the database: so the day's database copy lists every file already safe
    for (const [prefix, dir] of FOLDERS(config)) {
      if (!fs.existsSync(dir)) continue;
      for (const f of fs.readdirSync(dir)) {
        if (sent >= maxFiles) break;
        const name = `${prefix}/${f}`, full = path.join(dir, f);
        if (sentAlready(name) || !fs.statSync(full).isFile()) continue;
        const body = fs.readFileSync(full);
        await s3Put(cfg, name, body);
        mark(name, body.length); sent++;
      }
    }
    const dbName = `db/bellas-${todayStr()}.db`;
    if (!sentAlready(dbName)) {
      mark(dbName, 0); // in the copy itself, so a restore knows this day was sent
      const tmp = backupTo(db.raw, path.join(config.dataDir, ".offsite.db")); // a fresh, checked copy (safe while the app runs)
      try { const body = fs.readFileSync(tmp); await s3Put(cfg, dbName, body); mark(dbName, body.length); sent++; }
      catch (e) { db.run("DELETE FROM offsite_files WHERE name = ?", dbName); throw e; }
      finally { fs.rmSync(tmp, { force: true }); }
    }
    db.run("INSERT OR REPLACE INTO offsite_files (name, size, at) VALUES ('_last_ok', 0, ?)", now());
  } catch (e) {
    ctx.alert(`Off-site backup FAILED: ${e.message}. It will try again in an hour.`, "offsite");
  }
  const last = db.get("SELECT at FROM offsite_files WHERE name = '_last_ok'");
  if (last && now() - last.at > 36 * 3600) ctx.alert("No off-site backup in the last 36 hours", "offsite-stale");
  return { sent };
}

export function offsiteStatus(ctx) {
  const cfg = offsiteConfig(ctx.config);
  if (!cfg) return { enabled: false };
  const last = ctx.db.get("SELECT at FROM offsite_files WHERE name = '_last_ok'");
  const files = ctx.db.get("SELECT COUNT(*) c FROM offsite_files WHERE name NOT LIKE 'db/%' AND name != '_last_ok'").c;
  return { enabled: true, last_at: last ? last.at : null, files };
}

// Bring a lost server back: the database of a given day, then every photo and document it lists as sent.
export async function restoreFromOffsite(config, date, log = console.log) {
  const cfg = offsiteConfig(config);
  if (!cfg) throw new Error("Set BACKUP_S3_URL, BACKUP_S3_KEY_ID and BACKUP_S3_SECRET first");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error("Give the day to restore, like 2026-10-14");
  const dbFile = path.join(config.dataDir, "app.db");
  if (fs.existsSync(dbFile)) fs.renameSync(dbFile, `${dbFile}.before-restore-${Date.now()}`); // never overwrite: keep what was there
  fs.writeFileSync(dbFile, await s3Get(cfg, `db/bellas-${date}.db`));
  log(`Database of ${date} restored.`);
  const { DatabaseSync } = await import("node:sqlite");
  const copy = new DatabaseSync(dbFile);
  const names = new Set();
  try {
    for (const r of copy.prepare("SELECT name FROM offsite_files WHERE name NOT LIKE 'db/%' AND name != '_last_ok'").all()) names.add(r.name);
    // and what the database points at, in case it was sent after this copy was made
    for (const r of copy.prepare("SELECT file FROM photos UNION SELECT file FROM review_photos").all()) names.add(`uploads/${r.file}`);
    for (const r of copy.prepare("SELECT file FROM documents").all()) names.add(`documents/${r.file}`);
  } finally { copy.close(); }
  let n = 0, missing = 0;
  for (const name of names) {
    const [prefix, file] = name.split("/");
    const dir = Object.fromEntries(FOLDERS(config))[prefix];
    if (!dir || !file || file !== path.basename(file)) continue;
    fs.mkdirSync(dir, { recursive: true });
    const dest = path.join(dir, file);
    if (fs.existsSync(dest)) continue;
    try { fs.writeFileSync(dest, await s3Get(cfg, name)); n++; } catch { missing++; }
  }
  log(`${n} photos and documents restored.${missing ? ` ${missing} were not in the backup.` : ""}`);
  return { files: n, missing };
}
