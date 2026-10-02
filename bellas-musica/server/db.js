import { DatabaseSync } from "node:sqlite";
import path from "node:path";

const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY,
  email TEXT NOT NULL UNIQUE COLLATE NOCASE,
  name TEXT NOT NULL,
  phone TEXT NOT NULL DEFAULT '',
  sms_opt_in INTEGER NOT NULL DEFAULT 0,
  email_verified INTEGER NOT NULL DEFAULT 0,
  email_notify INTEGER NOT NULL DEFAULT 1,
  lang TEXT NOT NULL DEFAULT 'en',
  pass_hash TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS groups (
  id TEXT PRIMARY KEY,
  owner_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  demo INTEGER NOT NULL DEFAULT 0,
  name TEXT NOT NULL,
  type TEXT NOT NULL,
  zip TEXT NOT NULL,
  rate_cents INTEGER NOT NULL,
  members INTEGER NOT NULL DEFAULT 1,
  story TEXT NOT NULL DEFAULT '',
  events TEXT NOT NULL DEFAULT '[]',
  songs TEXT NOT NULL DEFAULT '[]',
  max_guests INTEGER NOT NULL DEFAULT 150,
  sound_system INTEGER NOT NULL DEFAULT 0,
  dress_code TEXT NOT NULL DEFAULT '',
  set_minutes INTEGER NOT NULL DEFAULT 45,
  travel_miles INTEGER NOT NULL DEFAULT 30,
  travel_fee_cents INTEGER NOT NULL DEFAULT 0,
  deposit_pct INTEGER NOT NULL DEFAULT 25,
  cancel_policy TEXT NOT NULL DEFAULT 'moderate',
  video_provider TEXT NOT NULL DEFAULT '',
  video_id TEXT NOT NULL DEFAULT '',
  contact_phone TEXT NOT NULL DEFAULT '',
  promoted_until INTEGER NOT NULL DEFAULT 0,
  stripe_account_id TEXT NOT NULL DEFAULT '',
  stripe_ready INTEGER NOT NULL DEFAULT 0,
  hidden INTEGER NOT NULL DEFAULT 0,
  paused INTEGER NOT NULL DEFAULT 0,
  published_at INTEGER NOT NULL DEFAULT 0,
  invited INTEGER NOT NULL DEFAULT 0,
  claim_token_hash TEXT NOT NULL DEFAULT '',
  seed_rating REAL NOT NULL DEFAULT 0,
  seed_reviews INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_groups_zip ON groups(zip);
CREATE TABLE IF NOT EXISTS photos (
  id TEXT PRIMARY KEY,
  group_id TEXT NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  file TEXT NOT NULL,
  position INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS packages (
  id INTEGER PRIMARY KEY,
  group_id TEXT NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  hours INTEGER NOT NULL,
  price_cents INTEGER NOT NULL,
  private_customer_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
  expires_at INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS availability (
  group_id TEXT NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  date TEXT NOT NULL,
  slots TEXT NOT NULL,
  PRIMARY KEY (group_id, date)
);
CREATE TABLE IF NOT EXISTS bookings (
  id TEXT PRIMARY KEY,
  group_id TEXT NOT NULL REFERENCES groups(id),
  customer_id INTEGER NOT NULL REFERENCES users(id),
  date TEXT NOT NULL,
  time TEXT NOT NULL,
  hours INTEGER NOT NULL,
  package_id INTEGER,
  package_name TEXT NOT NULL DEFAULT '',
  event_type TEXT NOT NULL,
  guests INTEGER NOT NULL,
  event_zip TEXT NOT NULL,
  name TEXT NOT NULL,
  phone TEXT NOT NULL,
  address TEXT NOT NULL,
  message TEXT NOT NULL DEFAULT '',
  subtotal_cents INTEGER NOT NULL,
  travel_fee_cents INTEGER NOT NULL DEFAULT 0,
  total_cents INTEGER NOT NULL,
  deposit_cents INTEGER NOT NULL,
  platform_fee_cents INTEGER NOT NULL,
  policy TEXT NOT NULL,
  status TEXT NOT NULL,
  payment_status TEXT NOT NULL DEFAULT 'unpaid',
  stripe_session_id TEXT NOT NULL DEFAULT '',
  stripe_payment_intent TEXT NOT NULL DEFAULT '',
  refund_cents INTEGER NOT NULL DEFAULT 0,
  reminder_sent INTEGER NOT NULL DEFAULT 0,
  reminder7_sent INTEGER NOT NULL DEFAULT 0,
  reminder1_sent INTEGER NOT NULL DEFAULT 0,
  balance_status TEXT NOT NULL DEFAULT 'unpaid',
  balance_pi TEXT NOT NULL DEFAULT '',
  balance_session_id TEXT NOT NULL DEFAULT '',
  balance_refund_cents INTEGER NOT NULL DEFAULT 0,
  balance_paid_at INTEGER NOT NULL DEFAULT 0,
  resched_status TEXT NOT NULL DEFAULT '',
  resched_date TEXT NOT NULL DEFAULT '',
  resched_time TEXT NOT NULL DEFAULT '',
  resched_note TEXT NOT NULL DEFAULT '',
  resched_at INTEGER NOT NULL DEFAULT 0,
  resched_count INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_bookings_group ON bookings(group_id, date);
CREATE INDEX IF NOT EXISTS idx_bookings_customer ON bookings(customer_id);
-- One live booking per group/date/time. Expired or cancelled bookings free the slot.
CREATE UNIQUE INDEX IF NOT EXISTS uq_slot ON bookings(group_id, date, time)
  WHERE status IN ('pending_payment','requested','confirmed');
CREATE TABLE IF NOT EXISTS messages (
  id INTEGER PRIMARY KEY,
  group_id TEXT NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  customer_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  sender TEXT NOT NULL CHECK (sender IN ('customer','group')),
  text TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_messages_thread ON messages(group_id, customer_id, id);
CREATE TABLE IF NOT EXISTS admin_log (
  id INTEGER PRIMARY KEY,
  admin_email TEXT NOT NULL,
  action TEXT NOT NULL,
  target TEXT NOT NULL DEFAULT '',
  details TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS waitlist (
  id INTEGER PRIMARY KEY,
  email TEXT NOT NULL COLLATE NOCASE,
  zip TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('customer','group')),
  lang TEXT NOT NULL DEFAULT 'en',
  created_at INTEGER NOT NULL,
  UNIQUE (email, zip, kind)
);
-- Groups a customer saved, and read-only shortlists they share ("send my 3 favorites to my partner").
CREATE TABLE IF NOT EXISTS favorites (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  group_id TEXT NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, group_id)
);
CREATE TABLE IF NOT EXISTS shortlists (
  token TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS shortlist_items (
  token TEXT NOT NULL REFERENCES shortlists(token) ON DELETE CASCADE,
  group_id TEXT NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  position INTEGER NOT NULL,
  PRIMARY KEY (token, group_id)
);
-- "Get quotes": a customer describes an event once and it goes to the few groups that can really do it.
CREATE TABLE IF NOT EXISTS event_requests (
  id TEXT PRIMARY KEY,
  customer_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  event TEXT NOT NULL,
  date TEXT NOT NULL,
  guests INTEGER NOT NULL,
  hours INTEGER NOT NULL,
  zip TEXT NOT NULL,
  note TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS event_request_groups (
  request_id TEXT NOT NULL REFERENCES event_requests(id) ON DELETE CASCADE,
  group_id TEXT NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  PRIMARY KEY (request_id, group_id)
);
CREATE TABLE IF NOT EXISTS stats_daily (
  day TEXT NOT NULL,
  key TEXT NOT NULL,
  ref TEXT NOT NULL DEFAULT '',
  n INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (day, key, ref)
);
-- A payment that arrived when it should not stand (a duplicate, or after a cancellation) is refunded in full and recorded here.
CREATE TABLE IF NOT EXISTS extra_refunds (
  id INTEGER PRIMARY KEY,
  booking_id TEXT NOT NULL,
  payment_intent TEXT NOT NULL,
  cents INTEGER NOT NULL,
  reason TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS thread_reads (
  group_id TEXT NOT NULL,
  customer_id INTEGER NOT NULL,
  side TEXT NOT NULL CHECK (side IN ('customer','group')),
  last_id INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (group_id, customer_id, side)
);
CREATE TABLE IF NOT EXISTS reviews (
  id INTEGER PRIMARY KEY,
  booking_id TEXT NOT NULL UNIQUE REFERENCES bookings(id),
  group_id TEXT NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  customer_id INTEGER NOT NULL REFERENCES users(id),
  rating INTEGER NOT NULL CHECK (rating BETWEEN 1 AND 5),
  text TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS payments_feature (
  id TEXT PRIMARY KEY,
  group_id TEXT NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  amount_cents INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  stripe_session_id TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS email_log (
  id INTEGER PRIMARY KEY,
  to_email TEXT NOT NULL,
  subject TEXT NOT NULL,
  body TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT '',
  sent INTEGER NOT NULL DEFAULT 0,
  error TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS auth_tokens (
  token_hash TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('reset','verify')),
  expires_at INTEGER NOT NULL,
  used_at INTEGER
);
CREATE TABLE IF NOT EXISTS sms_log (
  id INTEGER PRIMARY KEY,
  to_phone TEXT NOT NULL,
  body TEXT NOT NULL,
  sent INTEGER NOT NULL DEFAULT 0,
  error TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS webhook_events (
  id TEXT PRIMARY KEY,
  created_at INTEGER NOT NULL
);
`;

export function openDb(config) {
  const db = new DatabaseSync(config.dbPath || path.join(config.dataDir, "app.db"));
  db.exec("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;");
  db.exec(SCHEMA);
  // Databases created before a column existed get it added (CREATE TABLE IF NOT EXISTS never alters).
  const ensureColumn = (table, column, ddl) => {
    if (db.prepare(`PRAGMA table_info(${table})`).all().some((c) => c.name === column)) return false;
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${ddl}`);
    return true;
  };
  ensureColumn("event_requests", "start_time", "TEXT NOT NULL DEFAULT ''");
  ensureColumn("event_requests", "budget_min", "INTEGER NOT NULL DEFAULT 0");
  ensureColumn("event_requests", "budget_max", "INTEGER NOT NULL DEFAULT 0");
  ensureColumn("event_requests", "stage", "TEXT NOT NULL DEFAULT ''");
  ensureColumn("event_requests", "size", "TEXT NOT NULL DEFAULT ''");
  ensureColumn("bookings", "checkin_fails", "INTEGER NOT NULL DEFAULT 0");
  ensureColumn("bookings", "checkin_locked_until", "INTEGER NOT NULL DEFAULT 0");
  ensureColumn("bookings", "checkin_code", "TEXT NOT NULL DEFAULT ''");
  ensureColumn("bookings", "checked_in_at", "INTEGER NOT NULL DEFAULT 0");
  ensureColumn("bookings", "noshow_status", "TEXT NOT NULL DEFAULT ''");   // '' | reported | refunded | rejected
  ensureColumn("bookings", "noshow_note", "TEXT NOT NULL DEFAULT ''");
  ensureColumn("bookings", "noshow_reply", "TEXT NOT NULL DEFAULT ''");
  ensureColumn("bookings", "noshow_at", "INTEGER NOT NULL DEFAULT 0");
  ensureColumn("reviews", "reply", "TEXT NOT NULL DEFAULT ''");
  ensureColumn("reviews", "reply_at", "INTEGER NOT NULL DEFAULT 0");
  ensureColumn("groups", "verified", "INTEGER NOT NULL DEFAULT 0");
  ensureColumn("groups", "insured", "INTEGER NOT NULL DEFAULT 0");
  ensureColumn("packages", "private_customer_id", "INTEGER REFERENCES users(id) ON DELETE CASCADE");
  ensureColumn("packages", "expires_at", "INTEGER NOT NULL DEFAULT 0");
  ensureColumn("groups", "hidden", "INTEGER NOT NULL DEFAULT 0");
  ensureColumn("groups", "paused", "INTEGER NOT NULL DEFAULT 0");
  ensureColumn("groups", "invited", "INTEGER NOT NULL DEFAULT 0");
  ensureColumn("groups", "claim_token_hash", "TEXT NOT NULL DEFAULT ''");
  // Groups that already existed when the draft/publish step was introduced stay live.
  if (ensureColumn("groups", "published_at", "INTEGER NOT NULL DEFAULT 0")) db.exec("UPDATE groups SET published_at = created_at WHERE demo = 0 AND owner_id IS NOT NULL");
  ensureColumn("bookings", "balance_status", "TEXT NOT NULL DEFAULT 'unpaid'");
  ensureColumn("bookings", "balance_pi", "TEXT NOT NULL DEFAULT ''");
  ensureColumn("bookings", "balance_session_id", "TEXT NOT NULL DEFAULT ''");
  ensureColumn("bookings", "balance_refund_cents", "INTEGER NOT NULL DEFAULT 0");
  ensureColumn("bookings", "balance_paid_at", "INTEGER NOT NULL DEFAULT 0");
  ensureColumn("bookings", "resched_status", "TEXT NOT NULL DEFAULT ''");
  ensureColumn("bookings", "resched_date", "TEXT NOT NULL DEFAULT ''");
  ensureColumn("bookings", "resched_time", "TEXT NOT NULL DEFAULT ''");
  ensureColumn("bookings", "resched_note", "TEXT NOT NULL DEFAULT ''");
  ensureColumn("bookings", "resched_at", "INTEGER NOT NULL DEFAULT 0");
  ensureColumn("bookings", "resched_count", "INTEGER NOT NULL DEFAULT 0");
  ensureColumn("bookings", "reminder7_sent", "INTEGER NOT NULL DEFAULT 0");
  ensureColumn("bookings", "reminder1_sent", "INTEGER NOT NULL DEFAULT 0");
  ensureColumn("users", "email_verified", "INTEGER NOT NULL DEFAULT 0");
  ensureColumn("users", "email_notify", "INTEGER NOT NULL DEFAULT 1");
  const q = {
    all: (sql, ...p) => db.prepare(sql).all(...p),
    get: (sql, ...p) => db.prepare(sql).get(...p),
    run: (sql, ...p) => db.prepare(sql).run(...p),
    tx(fn) {
      db.exec("BEGIN IMMEDIATE");
      try { const r = fn(); db.exec("COMMIT"); return r; } catch (e) { db.exec("ROLLBACK"); throw e; }
    },
    raw: db
  };
  return q;
}
