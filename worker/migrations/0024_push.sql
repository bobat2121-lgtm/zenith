-- Phase 3 Part E (PR-E4): web push for graded Leads, shipped off. Additive only.
-- The four tables stay empty while PUSH_ENABLED and the VAPID_* secrets are unset:
-- the push routes answer 403/404 and the cron's push stage returns "off" with no
-- database call (push-routes.js pushOn, push.js pushTick).
--   push_subs    one browser push subscription per row. endpoint is a capability
--                URL on an allow-listed push service: never logged, audited or returned.
--   push_events  graded Leads only, one per (item, ticker); capped rows are stored, not sent.
--   push_sends   one row per (event, subscription) send attempt.
--   push_tests   test notifications, kept apart from Leads (3 a UTC day per person).
CREATE TABLE IF NOT EXISTS push_subs (
  id INTEGER PRIMARY KEY AUTOINCREMENT, universe_id TEXT NOT NULL DEFAULT 'u1',
  actor TEXT NOT NULL,              -- 'access:<16 hex>' (lib.js whoForMobile); never 'access:unknown'
  endpoint TEXT NOT NULL UNIQUE,    -- allow-listed push service URL; a capability: never logged, audited or returned
  p256dh TEXT NOT NULL, auth TEXT NOT NULL,   -- base64url, 65 and 16 bytes
  platform TEXT,                    -- apple | google | mozilla | microsoft (from the host)
  created_at TEXT NOT NULL, last_ok_at TEXT, last_status INTEGER,
  fail_count INTEGER NOT NULL DEFAULT 0, revoked_at TEXT, revoked_why TEXT   -- user | gone_404 | gone_410 | failures | cap
);
CREATE INDEX IF NOT EXISTS push_subs_live ON push_subs(universe_id, actor) WHERE revoked_at IS NULL;
CREATE TABLE IF NOT EXISTS push_events (          -- graded Leads only
  id INTEGER PRIMARY KEY AUTOINCREMENT, universe_id TEXT NOT NULL DEFAULT 'u1',
  item_id INTEGER NOT NULL, ticker TEXT NOT NULL, grade_id INTEGER NOT NULL, score INTEGER,
  status TEXT NOT NULL CHECK (status IN ('pending','sent','partial','failed','capped','stale')),
  attempts INTEGER NOT NULL DEFAULT 0, next_at TEXT, created_at TEXT NOT NULL, sent_at TEXT,
  UNIQUE (universe_id, item_id, ticker)
);
CREATE INDEX IF NOT EXISTS push_events_day ON push_events(universe_id, created_at);
CREATE INDEX IF NOT EXISTS push_events_due ON push_events(status, next_at) WHERE status IN ('pending','partial');
CREATE TABLE IF NOT EXISTS push_sends (
  event_id INTEGER NOT NULL, sub_id INTEGER NOT NULL, status INTEGER, attempts INTEGER NOT NULL DEFAULT 0, at TEXT,
  PRIMARY KEY (event_id, sub_id)
);
CREATE TABLE IF NOT EXISTS push_tests (           -- test notifications, kept apart from Leads
  id INTEGER PRIMARY KEY AUTOINCREMENT, universe_id TEXT NOT NULL DEFAULT 'u1',
  actor TEXT NOT NULL, created_at TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pending','sent','failed')), sent_at TEXT
);
CREATE INDEX IF NOT EXISTS push_tests_actor ON push_tests(actor, created_at);
CREATE INDEX IF NOT EXISTS push_tests_pending ON push_tests(id) WHERE status = 'pending';
