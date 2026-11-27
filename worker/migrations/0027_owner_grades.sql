-- 0027: owner grades on a 1-100 scale and gentle tuning (phase 4, Part F, PR-F1).
-- Additive only: four new columns, two indexes and five new tables; no row is written or rewritten.
-- Schema only: no Worker code reads or writes these yet (PR-F3 does).
-- Public repo: no labels, grades, source keys or names are seeded here.
-- Applies after 0026 or, if the integrator applies phase 4 before phase 3's 0025, before 0025:
-- nothing here reads a 0025 or 0026 object (replay_inputs needs only replays, from 0018).
-- Feature 5: every new table that holds one analyst's opinion carries universe_id NOT NULL with no
-- default, so a missing bind fails instead of writing into u1. The universe always comes from the
-- authenticated actor (lib.js universeOf), never from a request body.

-- The owner's own grade, 1-100, beside the legacy label. label keeps its CHECK from 0005 and is always
-- set, mapped from owner_score by score-bands.js labelFor (90-100 high, 60-89 medium, 30-59 low,
-- 1-29 noise), so every existing label reader keeps working unchanged.
-- undo_of: the feedback id this row undoes (an undo is a new row that copies the grade in force before
-- it); readers need not know it. The score the owner saw is grade_id's score (no shown_score column).
ALTER TABLE feedback ADD COLUMN owner_score INTEGER CHECK (owner_score IS NULL OR owner_score BETWEEN 1 AND 100);
ALTER TABLE feedback ADD COLUMN undo_of INTEGER;
ALTER TABLE aux_feedback ADD COLUMN owner_score INTEGER CHECK (owner_score IS NULL OR owner_score BETWEEN 1 AND 100);
ALTER TABLE aux_feedback ADD COLUMN undo_of INTEGER;
-- The recompute reads aux grades by time (without this it would scan aux_feedback).
CREATE INDEX IF NOT EXISTS aux_feedback_time ON aux_feedback(created_at);

-- Explicit tuning actions. kind 'step': More / Less on a source, topic or entity (step +-2 points), or
-- a delivery setting step (units of the setting). kind 'confirm': the owner lets a grade-derived offset
-- of up to |points| (points < 0) move cards scored 70+ below the 70 line. kind 'switch': delivery
-- 'placement' on (step 1) / off (step -1). An undo sets undone_at; rows are never deleted.
CREATE TABLE IF NOT EXISTS tune_actions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  universe_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('step','confirm','switch')),
  pipeline TEXT NOT NULL CHECK (pipeline IN ('coverage','aux','both')),
  scope_kind TEXT NOT NULL CHECK (scope_kind IN ('source','topic','entity','delivery')),
  scope_key TEXT NOT NULL,
  step INTEGER CHECK (step IS NULL OR (step BETWEEN -5 AND 5 AND step != 0)),
  points REAL CHECK (points IS NULL OR points BETWEEN -8 AND 0),
  preview_json TEXT CHECK (preview_json IS NULL OR json_valid(preview_json)),
  created_at TEXT NOT NULL,
  actor TEXT NOT NULL,
  undone_at TEXT,
  CHECK ((kind = 'step' AND step IS NOT NULL AND points IS NULL)
      OR (kind = 'confirm' AND step IS NULL AND points < 0 AND scope_kind != 'delivery')
      OR (kind = 'switch' AND scope_kind = 'delivery' AND step IN (-1, 1) AND points IS NULL))
);
CREATE INDEX IF NOT EXISTS tune_actions_live ON tune_actions(universe_id, undone_at, scope_kind, scope_key);

-- The current offsets, recomputed from owner grades and actions on every change and lazily once a UTC
-- day (decay). Only non-zero rows are kept. points = clip(from_grades + from_actions, -cap, cap);
-- conf <= 0 is the part allowed to move a 70+ card below 70 (Less actions plus confirmed grade points);
-- held = cards of the last 14 days held at the line by this scope.
CREATE TABLE IF NOT EXISTS tune_offsets (
  universe_id TEXT NOT NULL,
  pipeline TEXT NOT NULL CHECK (pipeline IN ('coverage','aux')),
  scope_kind TEXT NOT NULL CHECK (scope_kind IN ('source','topic','entity')),
  scope_key TEXT NOT NULL,
  points REAL NOT NULL,
  conf REAL NOT NULL CHECK (conf <= 0),
  from_grades REAL NOT NULL,
  from_actions REAL NOT NULL,
  n_grades INTEGER NOT NULL,
  n_agree REAL NOT NULL,
  held INTEGER NOT NULL DEFAULT 0,
  since TEXT NOT NULL,
  computed_at TEXT NOT NULL,
  PRIMARY KEY (universe_id, pipeline, scope_kind, scope_key)
);

-- One row per universe: what the feeds read (one primary-key row per feed call), the recompute's guard
-- and the 14-day effect counts. seen = MAX(audit_log.id) when the recompute read its inputs; a
-- recompute writes only if seen >= the stored one. placement_on is the no-deploy kill switch.
-- universe_id is declared NOT NULL as well as PRIMARY KEY: a TEXT primary key of a rowid table
-- accepts NULL in SQLite otherwise.
CREATE TABLE IF NOT EXISTS tune_meta (
  universe_id TEXT NOT NULL PRIMARY KEY,
  seen INTEGER NOT NULL,
  computed_at TEXT NOT NULL,
  placement_on INTEGER NOT NULL DEFAULT 1 CHECK (placement_on IN (0, 1)),
  offsets_json TEXT NOT NULL CHECK (json_valid(offsets_json)),
  effect_json TEXT NOT NULL CHECK (json_valid(effect_json))
);

-- One row per scope and UTC day on which its points changed (points 0 on the day a scope leaves
-- tune_offsets). WITHOUT ROWID: the key is the table, so SQLite makes no sqlite_autoindex_tune_history_1,
-- whose name would match the '%story%' pattern of phase 2's story-index check (story-schema.test.js, live S2).
CREATE TABLE IF NOT EXISTS tune_history (
  universe_id TEXT NOT NULL,
  day TEXT NOT NULL,
  pipeline TEXT NOT NULL,
  scope_kind TEXT NOT NULL,
  scope_key TEXT NOT NULL,
  points REAL NOT NULL,
  n_grades INTEGER NOT NULL,
  PRIMARY KEY (universe_id, day, pipeline, scope_kind, scope_key)
) WITHOUT ROWID;

-- The frozen owner examples of one owner_examples replay: ids and numbers only, never note or title
-- text. The replay claim rebuilds each line from these ids; replays.summary keeps its codes-only
-- contract. replay_id is TEXT because replays.id is TEXT (0018).
CREATE TABLE IF NOT EXISTS replay_inputs (
  replay_id TEXT NOT NULL REFERENCES replays(id),
  universe_id TEXT NOT NULL,
  pipeline TEXT NOT NULL CHECK (pipeline IN ('coverage','aux')),
  feedback_id INTEGER NOT NULL,
  owner_score INTEGER NOT NULL CHECK (owner_score BETWEEN 1 AND 100),
  graded_score INTEGER,
  PRIMARY KEY (replay_id, pipeline, feedback_id)
);
