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
-- A saved party: one date and place, a budget, what is still needed, a family link, a day-of timeline.
CREATE TABLE IF NOT EXISTS parties (
  id TEXT PRIMARY KEY,
  customer_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title TEXT NOT NULL DEFAULT '',
  event TEXT NOT NULL DEFAULT '',
  date TEXT NOT NULL,
  zip TEXT NOT NULL,
  guests INTEGER NOT NULL DEFAULT 0,
  budget_cents INTEGER NOT NULL DEFAULT 0,
  needs TEXT NOT NULL DEFAULT '[]',
  template TEXT NOT NULL DEFAULT '',
  share_token TEXT NOT NULL UNIQUE,
  credits_public INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_parties_customer ON parties(customer_id);
CREATE TABLE IF NOT EXISTS party_picks (
  party_id TEXT NOT NULL REFERENCES parties(id) ON DELETE CASCADE,
  group_id TEXT NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  added_by TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL,
  PRIMARY KEY (party_id, group_id)
);
CREATE TABLE IF NOT EXISTS party_votes (
  party_id TEXT NOT NULL REFERENCES parties(id) ON DELETE CASCADE,
  group_id TEXT NOT NULL,
  voter TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (party_id, group_id, voter)
);
CREATE TABLE IF NOT EXISTS party_comments (
  id INTEGER PRIMARY KEY,
  party_id TEXT NOT NULL REFERENCES parties(id) ON DELETE CASCADE,
  group_id TEXT NOT NULL DEFAULT '',
  name TEXT NOT NULL,
  text TEXT NOT NULL,
  is_owner INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS party_timeline (
  id INTEGER PRIMARY KEY,
  party_id TEXT NOT NULL REFERENCES parties(id) ON DELETE CASCADE,
  at TEXT NOT NULL,
  label TEXT NOT NULL,
  booking_id TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS idx_timeline_booking ON party_timeline(booking_id);
-- Part of a booking's balance paid on its own: a payment plan, or a padrino paying toward a vendor.
CREATE TABLE IF NOT EXISTS balance_parts (
  id TEXT PRIMARY KEY,
  booking_id TEXT NOT NULL REFERENCES bookings(id),
  payer_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  payer_name TEXT NOT NULL DEFAULT '',
  note TEXT NOT NULL DEFAULT '',
  amount_cents INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',          -- pending | paid | partial_refund | refunded | stray
  session_id TEXT NOT NULL DEFAULT '',
  pi TEXT NOT NULL DEFAULT '',
  refund_cents INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  paid_at INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_parts_booking ON balance_parts(booking_id);
-- Several deposits paid in one checkout (one charge, then a transfer to each vendor).
CREATE TABLE IF NOT EXISTS carts (
  id TEXT PRIMARY KEY,
  customer_id INTEGER NOT NULL REFERENCES users(id),
  booking_ids TEXT NOT NULL,
  amount_cents INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',          -- pending | paid
  session_id TEXT NOT NULL DEFAULT '',
  pi TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL
);
-- Vendors that sell together: book all of them for the same day in one checkout and each gives the discount.
CREATE TABLE IF NOT EXISTS bundles (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  discount_pct INTEGER NOT NULL,
  created_by TEXT NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS bundle_members (
  bundle_id TEXT NOT NULL REFERENCES bundles(id) ON DELETE CASCADE,
  group_id TEXT NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  accepted INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (bundle_id, group_id)
);
-- Helpers who run a listing with its owner (answer requests and messages, manage the calendar and lineups). Payouts, the
-- team itself and paid upgrades stay with the owner.
CREATE TABLE IF NOT EXISTS group_team (
  group_id TEXT NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  added_by INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (group_id, user_id)
);
CREATE TABLE IF NOT EXISTS team_invites (
  id TEXT PRIMARY KEY,
  group_id TEXT NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  email TEXT NOT NULL DEFAULT '',
  token_hash TEXT NOT NULL UNIQUE,
  created_by INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  used_by INTEGER NOT NULL DEFAULT 0,
  used_at INTEGER NOT NULL DEFAULT 0
);
-- A vendor's payment link for a client it found itself (WhatsApp, Facebook, word of mouth): the time is held until the
-- link expires; the client opens it, signs in and pays the deposit, and the booking is confirmed right away.
CREATE TABLE IF NOT EXISTS pay_links (
  id TEXT PRIMARY KEY,
  group_id TEXT NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  created_by INTEGER NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  client_name TEXT NOT NULL,
  title TEXT NOT NULL,
  date TEXT NOT NULL,
  time TEXT NOT NULL,
  minutes INTEGER NOT NULL,
  event_type TEXT NOT NULL,
  guests INTEGER NOT NULL,
  event_zip TEXT NOT NULL,
  address TEXT NOT NULL DEFAULT '',
  note TEXT NOT NULL DEFAULT '',
  total_cents INTEGER NOT NULL,
  deposit_cents INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'open',            -- open | used | cancelled
  expires_at INTEGER NOT NULL,
  booking_id TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_pay_links_group ON pay_links(group_id, date);
-- The musicians or workers a vendor sends to its gigs, and who worked (and was paid for) each booking.
CREATE TABLE IF NOT EXISTS crew (
  id INTEGER PRIMARY KEY,
  group_id TEXT NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  phone TEXT NOT NULL DEFAULT '',
  role TEXT NOT NULL DEFAULT '',
  pay_cents INTEGER NOT NULL DEFAULT 0,
  active INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS booking_crew (
  booking_id TEXT NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
  crew_id INTEGER NOT NULL REFERENCES crew(id) ON DELETE CASCADE,
  pay_cents INTEGER NOT NULL DEFAULT 0,
  sent_at INTEGER NOT NULL DEFAULT 0,
  paid_at INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (booking_id, crew_id)
);
-- Added at the party: one more hour, an add-on, or anything else, paid in the app or in cash.
CREATE TABLE IF NOT EXISTS extras (
  id TEXT PRIMARY KEY,
  booking_id TEXT NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,                              -- hour | addon | other
  label TEXT NOT NULL,
  minutes INTEGER NOT NULL DEFAULT 0,
  amount_cents INTEGER NOT NULL,
  fee_cents INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL,                            -- asked (by the family) | offered (waiting for payment) | paid | cash | declined | cancelled
  asked_by TEXT NOT NULL,                          -- customer | group
  session_id TEXT NOT NULL DEFAULT '',
  pi TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL,
  paid_at INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_extras_booking ON extras(booking_id);
-- Propinas: a tip the family leaves after the party. It all goes to the vendor (only the card processing cost is kept).
CREATE TABLE IF NOT EXISTS tips (
  id TEXT PRIMARY KEY,
  booking_id TEXT NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
  customer_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  amount_cents INTEGER NOT NULL,
  fee_cents INTEGER NOT NULL DEFAULT 0,
  note TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'pending',          -- pending | paid
  session_id TEXT NOT NULL DEFAULT '',
  pi TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL,
  paid_at INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_tips_booking ON tips(booking_id);
-- Weekly gigs (a restaurant's mariachi every Friday): the bookings of one series, paid in one checkout.
CREATE TABLE IF NOT EXISTS series (
  id TEXT PRIMARY KEY,
  customer_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  group_id TEXT NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  weeks INTEGER NOT NULL,
  discount_pct INTEGER NOT NULL DEFAULT 0,
  cart_id TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL
);
-- Times blocked by a vendor's own calendar (imported from Google/Apple/Outlook through its private iCal link).
CREATE TABLE IF NOT EXISTS ext_busy (
  group_id TEXT NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  date TEXT NOT NULL,
  start_min INTEGER NOT NULL,
  end_min INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_busy ON ext_busy(group_id, date);
-- Licenses, permits and insurance a vendor uploads for the site owner to check (kept out of the public uploads folder).
CREATE TABLE IF NOT EXISTS documents (
  id TEXT PRIMARY KEY,
  group_id TEXT NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  file TEXT NOT NULL,
  mime TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  expires TEXT NOT NULL DEFAULT '',
  note TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL,
  reviewed_at INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS review_photos (
  id INTEGER PRIMARY KEY,
  review_id INTEGER NOT NULL REFERENCES reviews(id) ON DELETE CASCADE,
  file TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS addons (
  id INTEGER PRIMARY KEY,
  group_id TEXT NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  price_cents INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_addons_group ON addons(group_id);
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
  ensureColumn("groups", "min_hours", "INTEGER NOT NULL DEFAULT 1");
  ensureColumn("users", "ref_code", "TEXT NOT NULL DEFAULT ''");          // a vendor's referral code
  ensureColumn("users", "referred_by", "INTEGER NOT NULL DEFAULT 0");
  ensureColumn("users", "ref_rewarded", "INTEGER NOT NULL DEFAULT 0");
  ensureColumn("users", "signup_source", "TEXT NOT NULL DEFAULT ''");     // ?src= partner link (church, dress shop...)
  ensureColumn("users", "notify_channel", "TEXT NOT NULL DEFAULT 'sms'"); // sms | whatsapp
  ensureColumn("groups", "fee_discount_until", "INTEGER NOT NULL DEFAULT 0"); // referral reward: half fee until then
  ensureColumn("groups", "pro_until", "INTEGER NOT NULL DEFAULT 0");
  ensureColumn("groups", "licensed", "INTEGER NOT NULL DEFAULT 0");
  ensureColumn("groups", "weather_policy", "TEXT NOT NULL DEFAULT ''");
  ensureColumn("groups", "ical_token", "TEXT NOT NULL DEFAULT ''");
  ensureColumn("groups", "ical_import_url", "TEXT NOT NULL DEFAULT ''");
  ensureColumn("groups", "ical_synced_at", "INTEGER NOT NULL DEFAULT 0");
  ensureColumn("groups", "ical_error", "TEXT NOT NULL DEFAULT ''");
  ensureColumn("payments_feature", "kind", "TEXT NOT NULL DEFAULT 'feature'"); // feature | pro
  ensureColumn("event_requests", "category", "TEXT NOT NULL DEFAULT 'music'");
  ensureColumn("bookings", "balance_parts_cents", "INTEGER NOT NULL DEFAULT 0"); // balance paid in parts (plan or padrinos), gross
  ensureColumn("bookings", "cart_id", "TEXT NOT NULL DEFAULT ''");
  ensureColumn("bookings", "stripe_transfer_id", "TEXT NOT NULL DEFAULT ''");   // cart bookings: our transfer to the vendor
  ensureColumn("bookings", "transfer_cents", "INTEGER NOT NULL DEFAULT 0");
  ensureColumn("bookings", "transfer_reversed_cents", "INTEGER NOT NULL DEFAULT 0");
  ensureColumn("bookings", "bundle_id", "TEXT NOT NULL DEFAULT ''");
  ensureColumn("bookings", "discount_cents", "INTEGER NOT NULL DEFAULT 0");
  // the price of each deposit in a cart (bundle discounts): written to the booking only when the cart is paid
  ensureColumn("carts", "items_json", "TEXT NOT NULL DEFAULT ''");
  ensureColumn("groups", "hourly", "INTEGER NOT NULL DEFAULT 1"); // 0: booked by package only (tents, food trucks...)
  ensureColumn("bookings", "addons_json", "TEXT NOT NULL DEFAULT '[]'");
  ensureColumn("bookings", "addons_cents", "INTEGER NOT NULL DEFAULT 0");
  ensureColumn("event_requests", "expanded", "INTEGER NOT NULL DEFAULT 0");
  ensureColumn("event_request_groups", "round", "INTEGER NOT NULL DEFAULT 1");
  ensureColumn("event_request_groups", "asked_at", "INTEGER NOT NULL DEFAULT 0");
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
  // Any start time, short sets, several crews: who can take a booking when is checked in server/schedule.js (which lets
  // a listing with 2 trucks take 2 bookings at the same time, so the old one-booking-per-time index goes).
  ensureColumn("groups", "capacity", "INTEGER NOT NULL DEFAULT 1");     // bookings it can serve at once
  ensureColumn("groups", "buffer_min", "INTEGER NOT NULL DEFAULT 0");   // travel/setup time kept free after each booking
  ensureColumn("packages", "minutes", "INTEGER NOT NULL DEFAULT 0");    // a short set (20-minute serenata); 0 = `hours`
  ensureColumn("bookings", "duration_min", "INTEGER NOT NULL DEFAULT 0"); // 0 = hours * 60 (older bookings)
  ensureColumn("bookings", "hold_until", "INTEGER NOT NULL DEFAULT 0");   // unpaid hold deadline for payment links (0 = 30 minutes)
  db.exec("DROP INDEX IF EXISTS uq_slot");
  ensureColumn("bookings", "series_id", "TEXT NOT NULL DEFAULT ''");       // one of a weekly series
  ensureColumn("groups", "weekly_discount_pct", "INTEGER NOT NULL DEFAULT 0"); // off each date when booked every week
  ensureColumn("users", "daily_text", "INTEGER NOT NULL DEFAULT 1");        // vendors: the morning summary text
  ensureColumn("users", "daily_text_on", "TEXT NOT NULL DEFAULT ''");       // ...last day it was sent
  ensureColumn("bookings", "direct", "INTEGER NOT NULL DEFAULT 0");        // booked through the vendor's own payment link
  ensureColumn("bookings", "link_id", "TEXT NOT NULL DEFAULT ''");
  ensureColumn("groups", "needs_json", "TEXT NOT NULL DEFAULT '[]'");       // what the vendor needs from the family (power, parking...)
  ensureColumn("bookings", "needs_json", "TEXT NOT NULL DEFAULT '[]'");     // what the family confirmed when booking
  ensureColumn("packages", "holiday", "TEXT NOT NULL DEFAULT ''");          // a holiday serenata: mothers_day | guadalupe
  ensureColumn("packages", "holiday_date", "TEXT NOT NULL DEFAULT ''");     // ...bookable only on this date
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
