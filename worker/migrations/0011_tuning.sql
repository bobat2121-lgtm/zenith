-- Reliability and tuning without labels (plans/round4-reliability-tuning.md,
-- Part Z). Additive only.
--
-- Reason codes on labels (Z5): why the analyst gave a label, optional and valid
-- with any label. One of not_material, duplicate, wrong_company, stale,
-- marketing, not_my_focus, missed_detail (the grader missed a figure: "too
-- low"). NULL when none was given; the API refuses any other value.
ALTER TABLE feedback ADD COLUMN reason TEXT;
ALTER TABLE aux_feedback ADD COLUMN reason TEXT;

-- Source preferences (Z7), saved from the app's Tuning page. One row per source
-- that is not 'normal' (saving normal deletes the row):
--   mute    items ingested afterwards are stored skipped (skip_reason
--           'muted_source') in items and aux_items, so the grader never spends
--           on them; its graded cards are hidden from both feeds
--   demote  For You orders its cards as if scored 15 lower; stored scores,
--           bands, Latest and alerts do not change
-- SEC sources and the covered companies' own channels cannot be muted.
CREATE TABLE IF NOT EXISTS source_prefs (
  source_key TEXT PRIMARY KEY,
  action TEXT NOT NULL CHECK (action IN ('mute','demote')),
  note TEXT,
  updated_at TEXT NOT NULL
);

-- meta aux_rv_cursor (Z11): the one-time catch-up of rival-source rows from the
-- 14-day aux backfill start up to aux_nm_cursor ('done' when finished), as
-- aux_cs_cursor in migration 0009. No schema change.

-- Left out (Z9) and the grader health backlog (Z3) read skipped and pending items by time.
CREATE INDEX IF NOT EXISTS idx_items_skipped ON items(state, skip_reason, nm_first_seen);
CREATE INDEX IF NOT EXISTS aux_items_skipped ON aux_items(state, skip_reason, nm_first_seen);
CREATE INDEX IF NOT EXISTS idx_items_source ON items(source_key, state);
CREATE INDEX IF NOT EXISTS aux_items_source ON aux_items(source_key, state);
CREATE INDEX IF NOT EXISTS idx_runs_started ON runs(started_at);
