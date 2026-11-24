-- Automatic source expansion: capture and approve queue
-- (plans/round5-expansion-approve-queue.md, Parts B5 and C1). Additive only:
-- two new tables and one index; no existing table changes.
--
-- Candidates: names Zenith already sees but that have no source of their own,
-- from three places (origins):
--   grader_relation  a kept `relations` entry of an accepted grade (Part A)
--   sec_filing       a party in a covered company's own 8-K, EX-2.1, EX-10 or
--                    a new EX-21 subsidiary (Part B)
--   aux_entity       an accepted aux grade's own entity, score 70+ and
--                    event_type financing or acquisition (Part C2)
-- One row per dedupe key (C3). A sighting upserts ON CONFLICT(dedupe_key): it
-- adds its "<kind>:<item_id>" to seen only when absent (a regrade, a requeue
-- or a second path on the same item adds no sighting), merges origins,
-- tickers and known notes, puts the item first in evidence (the newest 5, for
-- display only) and sets last_seen_at. It never changes status: a rejected
-- name stays rejected.
--
-- Status (C4):
--   pending   new name, waiting for the owner
--   known     has its own source (a covered name, an aux-sources.json source,
--             or an aux_items entity already in zenith-db); the owner may
--             reopen it ("not the same company") to pending
--   approved  the owner approved it (tickers in the last decision)
--   rejected  the owner rejected it (reason in the last decision)
--   compiled  written into plans/triage/build-list.json by the weekly compile
--             (Part E); takes no more decisions
-- decisions is the audit column: append-only JSON
-- [{ at, by, action, reason, note, tickers }], written with
-- json_insert(decisions, '$[#]', json(?)). by is the role (app or admin):
-- tokens carry no identity.
CREATE TABLE IF NOT EXISTS expansion_candidates (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  dedupe_key TEXT NOT NULL UNIQUE,      -- the normalized name (C3)
  name TEXT NOT NULL,                   -- display name as first seen
  origins TEXT NOT NULL DEFAULT '[]',   -- JSON: grader_relation | sec_filing | aux_entity
  relation TEXT,                        -- the first relation type; NULL for an aux entity
  subject TEXT,                         -- the ticker or aux entity it relates to
  tickers TEXT NOT NULL DEFAULT '[]',   -- JSON: linked covered tickers
  seen TEXT NOT NULL DEFAULT '[]',      -- JSON: every distinct evidence item, "coverage:206" or "aux:224", never capped; sightings = its length
  evidence TEXT NOT NULL DEFAULT '[]',  -- JSON: [{ kind, item_id, url, title, at, origin, party? }], newest 5
  known TEXT,                           -- JSON or NULL: registry matches, e.g. ["key_account:SPAI"], ["sheet_term:UMAC"], ["aux_source:anduril"]
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected','compiled','known')),
  decisions TEXT NOT NULL DEFAULT '[]', -- the audit column (above)
  compiled_at TEXT,
  compiled_ref TEXT,                    -- the build-list entry id
  created_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_expansion_status_seen ON expansion_candidates(status, last_seen_at);

-- EX-21 subsidiary lists per filer (Part B5). The first sight of a CIK is a
-- baseline and makes no candidate; a later filing (filed on or after the
-- stored one) turns each new key into a subsidiary candidate and replaces the
-- list. More than 20 new names in one diff is a re-baseline.
CREATE TABLE IF NOT EXISTS sec_subsidiaries (
  cik TEXT PRIMARY KEY,                 -- from the item URL's /Archives/edgar/data/<cik>/ folder
  ticker TEXT NOT NULL,
  names TEXT NOT NULL,                  -- JSON array of dedupe keys (C3)
  item_id INTEGER NOT NULL,             -- the coverage item whose EX-21 this is
  filed TEXT NOT NULL,                  -- the filing date from the item title
  updated_at TEXT NOT NULL
);

-- meta expansion_backfill_at (D4): set when the one-time aux-entity backfill
-- over the last 30 days of aux grades has run. Part B keeps
-- sec_parties_cursor, sec_parties_seed, sec_parties_pause_until and
-- sec_parties_tries in meta. No schema change.
