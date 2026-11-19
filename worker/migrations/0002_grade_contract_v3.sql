-- Align grades with the core rubric v3 output contract:
--  * duplicates carry score NULL and band 'duplicate'
--  * every grade records the covered ticker it was graded for, so one item can
--    carry a primary grade plus covered-to-covered grades ("123#UMAC")
--  * dup_of keeps the canonical item a duplicate points to
-- SQLite cannot alter CHECK constraints, so the table is rebuilt.

CREATE TABLE grades_v3 (
  id                 INTEGER PRIMARY KEY AUTOINCREMENT,
  item_id            INTEGER NOT NULL REFERENCES items(id),
  ticker             TEXT,
  run_id             TEXT,
  rubric_version     TEXT NOT NULL,
  model              TEXT,
  score              INTEGER CHECK (score IS NULL OR score BETWEEN 0 AND 100),
  band               TEXT NOT NULL CHECK (band IN ('lead','digest','borderline','reject','duplicate')),
  rung               TEXT,
  event_type         TEXT,
  status_label       TEXT,
  magnitude_usd      REAL,
  magnitude_pct      REAL,
  thesis_drivers     TEXT NOT NULL DEFAULT '[]',
  why                TEXT NOT NULL,
  note_hook          TEXT,
  confidence         REAL,
  read_source        INTEGER NOT NULL DEFAULT 0,
  flags              TEXT NOT NULL DEFAULT '[]',
  dup_of             TEXT,
  graded_at          TEXT NOT NULL,
  CHECK ((score IS NULL) = (band = 'duplicate'))
);

INSERT INTO grades_v3 (id, item_id, ticker, run_id, rubric_version, model, score, band, rung, event_type, status_label,
  magnitude_usd, magnitude_pct, thesis_drivers, why, note_hook, confidence, read_source, flags, graded_at)
SELECT g.id, g.item_id, i.ticker, g.run_id, g.rubric_version, g.model, g.score, g.band, g.rung, g.event_type, g.status_label,
  g.magnitude_usd, g.magnitude_pct, g.thesis_drivers, g.why, g.note_hook, g.confidence, g.read_source, g.flags, g.graded_at
FROM grades g JOIN items i ON i.id = g.item_id;

DROP TABLE grades;
ALTER TABLE grades_v3 RENAME TO grades;
CREATE INDEX IF NOT EXISTS idx_grades_item ON grades(item_id, id DESC);
CREATE INDEX IF NOT EXISTS idx_grades_ticker ON grades(ticker, item_id);
