-- 0028: source recommendations (phase 4, Part E, PR-RE1). Additive only.
-- Three new tables, four indexes and one new nullable column; no row is written or rewritten.
-- Schema only: no Worker code reads or writes these yet (PR-RE2 and PR-RE3 do).
-- Public repo: no name, ticker, CIK, accession, host or decision is seeded here.
-- Applies after 0027 or, if the integrator applies phase 4 before phase 3's 0025, before 0025:
-- nothing here reads a 0025, 0026 or 0027 object (it needs universes from 0017 and
-- sec_subsidiaries from 0012).
-- Feature 5: recommendations hold one analyst's opinion, so universe_id is NOT NULL with no default
-- and references universes; a missing bind fails instead of filing the row as u1's. The universe
-- always comes from the authenticated actor (lib.js universeOf), never from a request body.
-- feed_probes and sec_seed_done hold shared facts and carry no universe_id; a website the owner
-- typed is kept private to that universe by feed_probes.origin 'owner:<universe>'.

-- recommendations: per analyst. One row per (universe, target, subject); kind is a mutable label
-- (a changed kind is an UPDATE of the row, logged in decisions).
--   kind        entity | edge | ids | alias | legistar | source_class
--   target_key  the dedupe key of the name; 'alias:<old name key>'; 'legistar:<slug>'; 'class:<miss class>'
--   subject     the covered ticker or registry entity key it relates to; '' when none
--   triggers    JSON [{ trigger, weight, record, at, ref }] strongest first; top_trigger the strongest
--   strength    0-100, ordering only; never hides a row
--   proposal    JSON { entity, not_entity?, ambiguous?, ids, edge, parent?, website?, feeds, task? }
--   evidence    JSON, newest 8 first [{ kind, item_id?, accession?, record?, url, host, title, at, trigger }]
--   seen        JSON, every distinct evidence key (coverage:<id>, aux:<id>, sec:<accession>, nm:<source>:<record>, dh:<id>)
--   hosts       JSON, distinct story hosts counted for strength and reopen (syndicated copies count once)
--   candidate_id / candidate_status / candidate_decided_at   the u1 expansion_candidates row it mirrors
--               (NULL for other universes)
--   decisions   append-only JSON [{ at, by, action, reason, note, edge_kind, from_kind?, to_kind? }]
--   applied     JSON of the registry rows an approve wrote, and any task
--   history     1 when every evidence row came from the look-back seed
CREATE TABLE IF NOT EXISTS recommendations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  universe_id TEXT NOT NULL REFERENCES universes(id),
  kind TEXT NOT NULL CHECK (kind IN ('entity','edge','ids','alias','legistar','source_class')),
  target_key TEXT NOT NULL,
  subject TEXT NOT NULL DEFAULT '',
  name TEXT NOT NULL,
  top_trigger TEXT NOT NULL,
  triggers TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(triggers)),
  strength INTEGER NOT NULL DEFAULT 0 CHECK (strength BETWEEN 0 AND 100),
  proposal TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(proposal)),
  evidence TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(evidence)),
  seen TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(seen)),
  hosts TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(hosts)),
  candidate_id INTEGER,
  candidate_status TEXT,
  candidate_decided_at TEXT,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','approved','rejected','snoozed','known')),
  snooze_until TEXT,
  decisions TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(decisions)),
  applied TEXT CHECK (applied IS NULL OR json_valid(applied)),
  history INTEGER NOT NULL DEFAULT 0 CHECK (history IN (0,1)),
  probe_state TEXT NOT NULL DEFAULT 'todo' CHECK (probe_state IN ('todo','done','none')),
  probe_next_at TEXT,
  created_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  UNIQUE (universe_id, target_key, subject)
);
-- The panel's open list and counts, per universe.
CREATE INDEX IF NOT EXISTS rec_open ON recommendations(universe_id, status, strength DESC, last_seen_at DESC);
-- The probes due on a tick (partial: only rows still to probe).
CREATE INDEX IF NOT EXISTS rec_probe ON recommendations(probe_next_at) WHERE probe_state = 'todo';
-- The u1 mirror of expansion_candidates.
CREATE INDEX IF NOT EXISTS rec_candidate ON recommendations(candidate_id) WHERE candidate_id IS NOT NULL;

-- feed_probes: what a deterministic probe found for a target. origin 'auto' rows are shared;
-- 'owner:<universe>' rows (a website the owner typed) are visible only to that universe.
--   detail      JSON { cik, name, entries, newest, slug, why, feed_host }
CREATE TABLE IF NOT EXISTS feed_probes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  target_key TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('robots','sec_cik','newsroom_rss','ir_page','legistar_client')),
  url TEXT NOT NULL,
  origin TEXT NOT NULL DEFAULT 'auto',
  status TEXT NOT NULL CHECK (status IN ('ok','possible','not_found','robots','blocked','error','not_feed','off_domain')),
  http INTEGER,
  tries INTEGER NOT NULL DEFAULT 0,
  detail TEXT CHECK (detail IS NULL OR json_valid(detail)),
  checked_at TEXT NOT NULL,
  UNIQUE (target_key, kind, url, origin)
);
CREATE INDEX IF NOT EXISTS feed_probes_target ON feed_probes(target_key, kind);

-- sec_seed_done: accessions the look-back seed has finished (shared fact; a primary-key membership
-- test). accession is declared NOT NULL as well as PRIMARY KEY: a TEXT primary key of a rowid table
-- accepts NULL in SQLite otherwise, and length(NULL) passes the CHECK.
CREATE TABLE IF NOT EXISTS sec_seed_done (
  accession TEXT NOT NULL PRIMARY KEY CHECK (length(accession) = 18),
  cik TEXT NOT NULL,
  outcome TEXT NOT NULL CHECK (outcome IN ('read','skipped','failed')),
  at TEXT NOT NULL
);

-- An EX-21 baseline read from a filing that has no zenith item: item_id 0 (a documented sentinel;
-- item_id stays NOT NULL) and accession set. Existing rows read NULL; the current reader of the
-- table selects only names and filed.
ALTER TABLE sec_subsidiaries ADD COLUMN accession TEXT;
