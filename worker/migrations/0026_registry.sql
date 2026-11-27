-- Phase 4 Part A (PR-RA1): the identifier registry and entity tags. Additive only.
-- Public repo: schema only. No entity, name, id or edge row is inserted here; the registry
-- is loaded by POST /v1/admin/registry from a bundle built outside the repo.
-- Applies after 0025 by default, or before it (wrangler applies every file whose name is not
-- yet in d1_migrations); no statement here reads a table or column that 0025 adds.
-- Open vocabularies (entities.kind, entity_edges.kind, universe_entities.role, entity_ids.kind)
-- carry no CHECK: registry-admin.js validates them against exported lists that later parts extend
-- in code, so a new kind never needs a table rebuild.
-- Per-analyst opinion (universe_entities, entity_edges) carries universe_id NOT NULL with no
-- default; shared facts (entities, entity_ids, item_entities, registry_snapshots) carry none.

-- Who each company, program, agency, outlet or feed is. Facts only; shared across analysts.
CREATE TABLE IF NOT EXISTS entities (
  key        TEXT PRIMARY KEY,            -- the ticker for a listed name; else the aux entity rule (peers key, else source key)
  kind       TEXT NOT NULL,               -- company | program | agency | media | feed (validated in code)
  name       TEXT NOT NULL,
  status     TEXT NOT NULL,               -- public | private | subsidiary | public-pending | program | register_only | media | unknown (a fact only)
  ticker     TEXT,                        -- its own listed ticker, if any
  parent_key TEXT,                        -- owned by (seed value; admin/approve decisions live in registry_overrides)
  same_as    TEXT,                        -- seed merge target (rules a-e); admin merges live in registry_overrides
  origin     TEXT NOT NULL,               -- seed:<scope>:<input> | admin | approve
  retired_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- Which entities a universe covers or tracks: per-analyst opinion.
CREATE TABLE IF NOT EXISTS universe_entities (
  universe_id TEXT NOT NULL,              -- no default: every write names its universe
  entity_key  TEXT NOT NULL,
  role        TEXT NOT NULL,              -- covered | aux | key_account (validated in code)
  origin      TEXT NOT NULL,
  retired_at  TEXT,
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL,
  PRIMARY KEY (universe_id, entity_key, role)
) WITHOUT ROWID;

-- Public identifiers, names, aliases, negative aliases. lens = 'shared' (ids, legal and register
-- names, register traps) or a universe id (rows derived from that analyst's company sheets).
CREATE TABLE IF NOT EXISTS entity_ids (
  kind           TEXT NOT NULL,
  scope          TEXT NOT NULL,           -- 'any', 'title', or a register key
  norm           TEXT NOT NULL,
  entity_key     TEXT NOT NULL,
  lens           TEXT NOT NULL,           -- 'shared' | <universe_id>
  value          TEXT NOT NULL,           -- the spelling the title pass compiles from (never norm)
  qualifier_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(qualifier_json)),
  origin         TEXT NOT NULL,
  retired_at     TEXT,
  created_at     TEXT NOT NULL,
  updated_at     TEXT NOT NULL,
  PRIMARY KEY (kind, scope, norm, entity_key, lens)
) WITHOUT ROWID;
CREATE INDEX IF NOT EXISTS entity_ids_entity ON entity_ids(entity_key, kind);

-- Who is a rival, customer, supplier, program or watch target of whom: opinion, so per universe.
CREATE TABLE IF NOT EXISTS entity_edges (
  universe_id   TEXT NOT NULL,            -- no default
  from_key      TEXT NOT NULL,
  kind          TEXT NOT NULL,            -- rival | peer | customer | supplier | program | partner | channel_partner | relationship | index_event | watch | ... (code list)
  to_key        TEXT NOT NULL,
  direction     TEXT CHECK (direction IS NULL OR direction IN ('-','+','±')),
  evidence_json TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(evidence_json)),
  origin        TEXT NOT NULL,
  retired_at    TEXT,
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL,
  PRIMARY KEY (universe_id, from_key, kind, to_key)
) WITHOUT ROWID;
-- No index on to_key: edgesTo() is served from the in-memory snapshot (edges into an entity plan
-- to the PK prefix on universe_id); a later part that needs SQL by to_key adds the index (additive).

-- Admin and approve decisions over seed rows. A sync never writes this table; the snapshot
-- builder applies it over the seed rows (merge, retire, parent, text_safe, guard).
CREATE TABLE IF NOT EXISTS registry_overrides (
  target_kind TEXT NOT NULL CHECK (target_kind IN ('entity','id','edge')),
  target_key  TEXT NOT NULL,              -- entity key | 'kind|scope|norm|entity|lens' | 'universe|from|kind|to'
  field       TEXT NOT NULL,              -- same_as | parent_key | retired | text_safe | guard (code list)
  value       TEXT,
  universe_id TEXT,                       -- set for edge and universe_entities targets
  origin      TEXT NOT NULL,              -- admin | approve
  at          TEXT NOT NULL,
  retired_at  TEXT,
  PRIMARY KEY (target_kind, target_key, field)
) WITHOUT ROWID;

-- Which entity each stored item is about. Derived data: re-derivable from the item, the registry
-- version and the grades; the tagger replaces an item's non-grade tags when it re-tags.
-- No universe_id: the item row already carries one, and every reader joins the item.
CREATE TABLE IF NOT EXISTS item_entities (
  pipeline   TEXT NOT NULL CHECK (pipeline IN ('coverage','aux')),
  item_id    INTEGER NOT NULL,
  entity_key TEXT NOT NULL,
  role       TEXT NOT NULL CHECK (role IN ('subject','mention','watch','publisher')),
  method     TEXT NOT NULL,
  matched    TEXT,                        -- '<kind>:<norm>'; never title text
  tagger     TEXT NOT NULL,               -- '<registry_version>/<TAGGER_VERSION>'
  tagged_at  TEXT NOT NULL,
  PRIMARY KEY (pipeline, item_id, entity_key)
) WITHOUT ROWID;
CREATE INDEX IF NOT EXISTS item_entities_entity ON item_entities(entity_key, role, item_id);

-- Derived snapshots of one registry version: 'shared#<n>' (entities and ids, chunks of <= 500 KB),
-- 'edges:<universe_id>', 'copy' (news-monitor). Rebuilt on every sync or edit; last 5 versions kept.
CREATE TABLE IF NOT EXISTS registry_snapshots (
  version    TEXT NOT NULL,
  part       TEXT NOT NULL,
  body       TEXT NOT NULL,
  sha256     TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (version, part)
) WITHOUT ROWID;
