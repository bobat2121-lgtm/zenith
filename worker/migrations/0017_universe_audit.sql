-- 0017: universe groundwork and an append-only audit log (phase 1).
-- Public repo: seeds only the placeholder universe; no names, tickers or emails.

CREATE TABLE universes (
  id TEXT PRIMARY KEY,
  label TEXT NOT NULL,
  created_at TEXT NOT NULL
);
INSERT INTO universes (id, label, created_at) VALUES ('u1', 'default', '2026-11-25T00:00:00Z');

-- No REFERENCES (D1 refuses a REFERENCES column with a non-NULL default) and no CHECK
-- (phase 7 adds 'u2' without a rebuild). Constant default: schema-only, no row rewrite.
ALTER TABLE items                ADD COLUMN universe_id TEXT NOT NULL DEFAULT 'u1';
ALTER TABLE aux_items            ADD COLUMN universe_id TEXT NOT NULL DEFAULT 'u1';
ALTER TABLE grades               ADD COLUMN universe_id TEXT NOT NULL DEFAULT 'u1';
ALTER TABLE aux_grades           ADD COLUMN universe_id TEXT NOT NULL DEFAULT 'u1';
ALTER TABLE feedback             ADD COLUMN universe_id TEXT NOT NULL DEFAULT 'u1';
ALTER TABLE aux_feedback         ADD COLUMN universe_id TEXT NOT NULL DEFAULT 'u1';
ALTER TABLE source_prefs         ADD COLUMN universe_id TEXT NOT NULL DEFAULT 'u1';
ALTER TABLE expansion_candidates ADD COLUMN universe_id TEXT NOT NULL DEFAULT 'u1';
ALTER TABLE recall_events        ADD COLUMN universe_id TEXT NOT NULL DEFAULT 'u1';
ALTER TABLE deliveries           ADD COLUMN universe_id TEXT NOT NULL DEFAULT 'u1';
ALTER TABLE reports              ADD COLUMN universe_id TEXT NOT NULL DEFAULT 'u1';

-- Who did what. One row per human or token action; never updated, never deleted.
-- before_json / after_json: ids, labels, statuses, counts. Never note or event text.
CREATE TABLE audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  universe_id TEXT NOT NULL DEFAULT 'u1',
  at TEXT NOT NULL,
  actor TEXT NOT NULL,
  via TEXT NOT NULL,
  action TEXT NOT NULL,
  target_kind TEXT NOT NULL,
  target_id TEXT,
  before_json TEXT CHECK (before_json IS NULL OR json_valid(before_json)),
  after_json TEXT CHECK (after_json IS NULL OR json_valid(after_json)),
  request_id TEXT
);
CREATE INDEX audit_log_at ON audit_log(at);
CREATE INDEX audit_log_target ON audit_log(target_kind, target_id);

CREATE TRIGGER audit_log_no_update BEFORE UPDATE ON audit_log
BEGIN SELECT RAISE(ABORT, 'audit_log is append-only'); END;
CREATE TRIGGER audit_log_no_delete BEFORE DELETE ON audit_log
BEGIN SELECT RAISE(ABORT, 'audit_log is append-only'); END;
