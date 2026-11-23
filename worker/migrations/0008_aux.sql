-- Auxiliary names: news from every company or program source outside the
-- covered universe (worker/src/aux-sources.json, routed by aux-route.js). A
-- separate pipeline with its own tables, cursor (meta aux_nm_cursor,
-- aux_last_ingest_at), claim and grade API and feed (worker/src/auxiliary.js).
-- Additive only: nothing here touches items, grades, feedback or runs, so no
-- coverage count, alert, brief or grade changes.

-- Items copied from news-monitor-db by their own rowid cursor.
CREATE TABLE IF NOT EXISTS aux_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  nm_rowid INTEGER NOT NULL UNIQUE,     -- news-monitor-db items.rowid
  source_key TEXT NOT NULL,
  entity_key TEXT NOT NULL,             -- auxRoute(source_key).entity_key
  entity_name TEXT NOT NULL,            -- the routed display name, until a grade names the entity
  status TEXT NOT NULL,                 -- public | private | program | media | unknown
  url TEXT NOT NULL,
  title TEXT NOT NULL,
  published TEXT,
  category TEXT,
  nm_first_seen TEXT NOT NULL,
  ingested_at TEXT NOT NULL,
  -- pending -> claimed -> graded; skipped = stored but not queued (bad_url,
  -- archive_seed, stale_on_arrival, grading_failed)
  state TEXT NOT NULL DEFAULT 'pending' CHECK (state IN ('pending','claimed','graded','skipped')),
  skip_reason TEXT,
  attempts INTEGER NOT NULL DEFAULT 0,
  claim_id TEXT,
  claimed_until TEXT,
  excerpt TEXT,                         -- the feed's own text when it carries the release (status 'feed'); pages are never fetched
  excerpt_status TEXT,
  grade_id INTEGER                      -- current grade (aux_grades.id)
);
CREATE INDEX IF NOT EXISTS aux_items_state ON aux_items(state, nm_first_seen);
CREATE INDEX IF NOT EXISTS aux_items_seen ON aux_items(nm_first_seen);
CREATE INDEX IF NOT EXISTS aux_items_entity ON aux_items(entity_key);

-- Grades measure materiality to that outside company or program (rubric aux),
-- not to a covered ticker. One grade per item and grading run.
CREATE TABLE IF NOT EXISTS aux_grades (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  item_id INTEGER NOT NULL REFERENCES aux_items(id),
  run_id TEXT NOT NULL,
  entity TEXT NOT NULL,                 -- grader's canonical company/program name
  covered_ticker TEXT,                  -- set only with reason:covered_name
  score INTEGER,                        -- NULL for duplicate / covered
  band TEXT NOT NULL,                   -- lead | digest | borderline | reject | duplicate | covered
  event_type TEXT,
  why TEXT,
  reads_through TEXT,                   -- JSON [{ "ticker": "RCAT", "direction": "+|-|±" }]
  flags TEXT,                           -- JSON array, exactly one reason:*
  confidence REAL,
  read_source INTEGER,
  dup_of INTEGER,                       -- aux_items.id of the canonical copy (duplicates)
  rubric_version TEXT,
  model TEXT,
  graded_at TEXT NOT NULL,
  UNIQUE (item_id, run_id)
);
CREATE INDEX IF NOT EXISTS aux_grades_item ON aux_grades(item_id);

-- Analyst labels, recorded against the grade shown (the item's current grade).
CREATE TABLE IF NOT EXISTS aux_feedback (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  item_id INTEGER NOT NULL REFERENCES aux_items(id),
  grade_id INTEGER,
  label TEXT NOT NULL,
  note TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS aux_feedback_item ON aux_feedback(item_id);
