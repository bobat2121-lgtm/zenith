-- Recall scoreboard (plans/portal-architecture-audit-2026-11-24.md, phase 0 step 6).
-- One row per audited material event. Rows are loaded by POST /v1/admin/recall from a seed
-- file kept outside the public repo; this file holds no events.
CREATE TABLE IF NOT EXISTS recall_events (
  id TEXT PRIMARY KEY,                 -- "<TICKER>-<k>", k = position among that ticker's events in the audit
  ticker TEXT NOT NULL,
  event TEXT NOT NULL,
  event_date TEXT,                     -- YYYY-MM-DD
  kind TEXT NOT NULL CHECK (kind IN ('filing','regulator','local_government','program_award','register','trade_press','news')),
  public_url TEXT,
  status TEXT NOT NULL CHECK (status IN ('on_time','late','partial','missed')),
  captured_kind TEXT CHECK (captured_kind IN ('coverage','aux')),
  captured_item_id INTEGER,            -- items.id or aux_items.id
  captured_ref TEXT,                   -- the audit's capture evidence, short
  first_seen TEXT,                     -- first sighting (ISO), when known
  lag_days REAL,
  verdict TEXT CHECK (verdict IN ('confirmed','partly')),
  verdict_ref TEXT,                    -- "miss:TICKER:n" in the audit
  notes TEXT,
  source TEXT NOT NULL,                -- the seed's source label, e.g. an audit date
  checked_at TEXT NOT NULL,
  loaded_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS recall_events_status ON recall_events(status, kind);
CREATE INDEX IF NOT EXISTS recall_events_ticker ON recall_events(ticker);
