-- 0018: golden-set replay tables (phase 2). Additive only: no live table changes.
-- Schema only: no Worker code reads or writes these yet.
-- Public repo: golden expectations live only in the private database, never here.

-- One row per golden item. id is the replay item_id and is never an items.id.
CREATE TABLE golden_items (
  id INTEGER PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,             -- opaque label
  class TEXT NOT NULL CHECK (class IN ('anchor','recall','ladder','holdout','guard')),
  basis TEXT NOT NULL CHECK (basis IN ('core11','sheet','rule','auditor','owner')),
  ticker TEXT NOT NULL,                  -- the item's own ticker (the stored row's, when ref is item:<id>)
  source_key TEXT NOT NULL, role TEXT, affects TEXT,
  title TEXT NOT NULL, url TEXT, published TEXT,
  first_seen TEXT NOT NULL,
  first_seen_rule TEXT NOT NULL CHECK (first_seen_rule IN ('published_plus_1h','real')),
  excerpt TEXT, excerpt_status TEXT, admit TEXT,
  expect TEXT NOT NULL,                  -- JSON {"<TICKER>":[lo,hi]}, null = open bound; or {"<TICKER>":"duplicate"}
  ref TEXT,                              -- 'item:<id>', 'core11:<row>', 'recall:<event id>', 'public:<url>'
  note TEXT, active INTEGER NOT NULL DEFAULT 1,
  added_at TEXT NOT NULL, universe_id TEXT NOT NULL DEFAULT 'u1');

-- One row per replay run of a rubric version against the golden set.
CREATE TABLE replays (
  id TEXT PRIMARY KEY, rubric_version TEXT NOT NULL, base_version TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('baseline','candidate')),
  scope TEXT NOT NULL CHECK (scope IN ('full','sheets','guards','retry')),
  scope_tickers TEXT NOT NULL DEFAULT '[]', iteration INTEGER NOT NULL DEFAULT 1,
  status TEXT NOT NULL CHECK (status IN ('armed','done','passed','failed','aborted')),
  targets TEXT NOT NULL DEFAULT '[]', reference_id TEXT,
  armed_at TEXT NOT NULL, finished_at TEXT, n_items INTEGER NOT NULL,
  n_graded INTEGER NOT NULL DEFAULT 0, summary TEXT,
  universe_id TEXT NOT NULL DEFAULT 'u1');
CREATE INDEX replays_status ON replays(status, armed_at);

-- The work queue of a replay: one row per golden item and pass (2 = confirm re-grade).
CREATE TABLE replay_queue (
  replay_id TEXT NOT NULL, golden_id INTEGER NOT NULL, pass INTEGER NOT NULL DEFAULT 1,
  state TEXT NOT NULL DEFAULT 'pending' CHECK (state IN ('pending','claimed','graded','failed')),
  claim_id TEXT, claimed_until TEXT, attempts INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (replay_id, golden_id, pass));

-- Replay grades. Kept apart from grades and aux_grades, so a replay never writes a live grade.
CREATE TABLE replay_grades (
  replay_id TEXT NOT NULL, golden_id INTEGER NOT NULL, ticker TEXT NOT NULL, pass INTEGER NOT NULL DEFAULT 1,
  run_id TEXT, model TEXT, score INTEGER, band TEXT NOT NULL, rung TEXT, event_type TEXT,
  flags TEXT NOT NULL DEFAULT '[]', why TEXT, confidence REAL, read_source INTEGER,
  graded_at TEXT NOT NULL,
  PRIMARY KEY (replay_id, golden_id, ticker, pass));
CREATE INDEX replay_grades_at ON replay_grades(graded_at);
