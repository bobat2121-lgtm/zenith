-- 0022: Phase 3 Part E: the stored weekday brief. Additive only: 1 new table, no other
-- index, no change to any existing table. Schema only: no Worker code reads or writes it yet.

-- One stored brief per America/New_York day and kind, built by the 5-minute tick (phase 3).
-- Not the Discord reports table. No open counter here: portal_views counts the opens.
CREATE TABLE IF NOT EXISTS brief_days (
  universe_id TEXT NOT NULL DEFAULT 'u1',
  day TEXT NOT NULL,              -- America/New_York date of the build, YYYY-MM-DD
  kind TEXT NOT NULL,             -- 'brief_am'
  status TEXT NOT NULL CHECK (status IN ('ok','failed')),
  attempts INTEGER NOT NULL DEFAULT 1,
  window_from TEXT,
  window_to TEXT,
  built_at TEXT NOT NULL,
  counts TEXT CHECK (counts IS NULL OR json_valid(counts)),
  contents TEXT CHECK (contents IS NULL OR json_valid(contents)),
  error TEXT,
  PRIMARY KEY (universe_id, day, kind)
);
