-- zenith-core: graded research feed for the covered (8-minute lane) universe.
-- Items are copied from news-monitor-db by rowid cursor; nothing is deleted.

CREATE TABLE IF NOT EXISTS meta (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS items (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  nm_rowid      INTEGER NOT NULL UNIQUE,          -- news-monitor-db items.rowid
  source_key    TEXT NOT NULL,
  ticker        TEXT NOT NULL,
  url           TEXT NOT NULL,
  title         TEXT NOT NULL,
  published     TEXT,
  category      TEXT,
  nm_first_seen TEXT NOT NULL,
  nm_notified   INTEGER,                            -- 0 pending, 1 notified/seeded, 2 duplicate-suppressed
  ingested_at   TEXT NOT NULL,
  -- pending -> claimed -> graded; skipped = stored but not queued (stale seed/backfill)
  state         TEXT NOT NULL DEFAULT 'pending' CHECK (state IN ('pending','claimed','graded','skipped')),
  skip_reason   TEXT,
  claim_id      TEXT,
  claimed_until TEXT,
  attempts      INTEGER NOT NULL DEFAULT 0,
  grade_id      INTEGER,                            -- latest grade
  -- Opening text of the item's page, fetched by the Worker so the grader reads
  -- the release itself (issuer releases and filings only; never shown in full).
  excerpt        TEXT,
  excerpt_status TEXT                               -- null = not tried, ok, http_<code>, skipped_<reason>, error
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_items_source_url ON items(source_key, url);
CREATE INDEX IF NOT EXISTS idx_items_state ON items(state, claimed_until, id);
CREATE INDEX IF NOT EXISTS idx_items_seen ON items(nm_first_seen DESC, id DESC);
CREATE INDEX IF NOT EXISTS idx_items_ticker ON items(ticker, nm_first_seen DESC);

CREATE TABLE IF NOT EXISTS grades (
  id                 INTEGER PRIMARY KEY AUTOINCREMENT,
  item_id            INTEGER NOT NULL REFERENCES items(id),
  run_id             TEXT,
  rubric_version     TEXT NOT NULL,
  model              TEXT,
  score              INTEGER NOT NULL CHECK (score BETWEEN 0 AND 100),
  band               TEXT NOT NULL CHECK (band IN ('lead','digest','borderline','reject')),
  rung               TEXT,
  event_type         TEXT,
  status_label       TEXT,
  magnitude_usd      REAL,
  magnitude_pct      REAL,
  thesis_drivers     TEXT NOT NULL DEFAULT '[]',   -- JSON array
  why                TEXT NOT NULL,
  note_hook          TEXT,
  confidence         REAL,
  read_source        INTEGER NOT NULL DEFAULT 0,
  flags              TEXT NOT NULL DEFAULT '[]',   -- JSON array
  graded_at          TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_grades_item ON grades(item_id, id DESC);

CREATE TABLE IF NOT EXISTS feedback (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  item_id     INTEGER NOT NULL REFERENCES items(id),
  label       TEXT NOT NULL CHECK (label IN ('high','medium','low','noise')),
  note        TEXT,
  grade_id    INTEGER,                              -- grade shown when the label was given
  created_at  TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_feedback_item ON feedback(item_id, id DESC);
CREATE INDEX IF NOT EXISTS idx_feedback_time ON feedback(created_at);

CREATE TABLE IF NOT EXISTS runs (
  id             TEXT PRIMARY KEY,
  started_at     TEXT NOT NULL,
  last_seen_at   TEXT NOT NULL,
  claimed        INTEGER NOT NULL DEFAULT 0,
  graded         INTEGER NOT NULL DEFAULT 0,
  rejected       INTEGER NOT NULL DEFAULT 0,
  rubric_version TEXT,
  model          TEXT
);
