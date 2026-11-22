-- Delivery: Lead pushes to Discord, scheduled reports (morning and evening
-- briefs, the weekly calibration report) and ops incidents (grader heartbeat).
-- Nothing here changes how items are graded.

-- One Discord message per (channel, item, ticker). A cross-ticker grade
-- ("123#UMAC") gets its own message. A re-grade edits the same message, using
-- the message id Discord returned (webhook ?wait=true).
CREATE TABLE IF NOT EXISTS deliveries (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  channel       TEXT NOT NULL,                      -- 'lead'
  item_id       INTEGER NOT NULL REFERENCES items(id),
  ticker        TEXT NOT NULL,                      -- the grade's ticker
  grade_id      INTEGER,                            -- grade the message shows now
  score         INTEGER,
  band          TEXT,
  message_id    TEXT,
  -- posting = claimed by a cron tick (lease in claimed_until); posted; retracted =
  -- re-graded out of the push band (message edited to say so); failed = retry later
  status        TEXT NOT NULL CHECK (status IN ('posting','posted','retracted','failed')),
  attempts      INTEGER NOT NULL DEFAULT 0,
  claimed_until TEXT,
  last_error    TEXT,
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL,
  UNIQUE (channel, item_id, ticker)
);
CREATE INDEX IF NOT EXISTS idx_deliveries_status ON deliveries(channel, status, created_at);

-- One row per scheduled report slot, so a slot is posted once even when two
-- crons fire at the same minute or a catch-up tick retries it.
CREATE TABLE IF NOT EXISTS reports (
  slot        TEXT PRIMARY KEY,                     -- 'brief_am:2026-11-23', 'calibration:2026-11-23'
  kind        TEXT NOT NULL,                        -- brief_am | brief_pm | calibration
  window_from TEXT,
  window_to   TEXT,
  status      TEXT NOT NULL CHECK (status IN ('sending','sent','failed')),
  attempts    INTEGER NOT NULL DEFAULT 0,
  message_ids TEXT,                                 -- JSON array of Discord message ids
  error       TEXT,
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_reports_kind ON reports(kind, status, window_to);

-- Ops incidents: one alert when a check starts failing, one recovery notice.
CREATE TABLE IF NOT EXISTS incidents (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  key              TEXT NOT NULL,                   -- 'grader_stale' | 'queue_stale'
  opened_at        TEXT NOT NULL,
  detail           TEXT,
  alerted_at       TEXT,                            -- NULL until the alert reached Discord
  resolved_at      TEXT,                            -- NULL while open
  recovery_detail  TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_incidents_open ON incidents(key) WHERE resolved_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_grades_graded_at ON grades(graded_at);
