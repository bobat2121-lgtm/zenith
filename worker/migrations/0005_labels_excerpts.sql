-- When an item's excerpt was last fetched with the current reader (SEC filings
-- start at their first Item heading and add Ex-99.1; figures are kept over
-- filler). NULL on existing rows, so the admin SEC refresh re-reads every
-- sec.gov item once.
ALTER TABLE items ADD COLUMN excerpt_at TEXT;

-- Every sec.gov fetch so far ran without CONTACT_EMAIL, so none was a real
-- try: clear those counts and statuses so the filings are read once it is set.
UPDATE items SET excerpt_status = NULL, excerpt_tries = 0, excerpt_next_at = NULL
 WHERE (url LIKE 'https://www.sec.gov/%' OR url LIKE 'https://sec.gov/%' OR url LIKE 'http://www.sec.gov/%')
   AND (excerpt_status IS NULL OR excerpt_status = 'skipped_sec_needs_contact');

-- Labels are recorded against the grade being shown (a cross-ticker card is
-- labelled under its own ticker), and the analyst can say a score was too high
-- or too low as well as high / medium / low / noise.
-- SQLite cannot alter CHECK constraints, so the feedback table is rebuilt.

CREATE TABLE feedback_v2 (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  item_id     INTEGER NOT NULL REFERENCES items(id),
  label       TEXT NOT NULL CHECK (label IN ('high','medium','low','noise','too_high','too_low')),
  note        TEXT,
  grade_id    INTEGER,                              -- grade shown when the label was given
  ticker      TEXT,                                 -- the ticker that grade is for
  created_at  TEXT NOT NULL
);

INSERT INTO feedback_v2 (id, item_id, label, note, grade_id, ticker, created_at)
SELECT f.id, f.item_id, f.label, f.note, f.grade_id, COALESCE(g.ticker, i.ticker), f.created_at
  FROM feedback f JOIN items i ON i.id = f.item_id LEFT JOIN grades g ON g.id = f.grade_id;

DROP TABLE feedback;
ALTER TABLE feedback_v2 RENAME TO feedback;
CREATE INDEX IF NOT EXISTS idx_feedback_item ON feedback(item_id, ticker, id DESC);
CREATE INDEX IF NOT EXISTS idx_feedback_time ON feedback(created_at);
