-- 0019: exact-key story dedup columns (phase 2). Additive only: 5 nullable columns and
-- 5 partial indexes. No CHECK, no default and no backfill in SQL: keys are computed in
-- JS (SHA-256), and the Worker writes them. Schema only: no Worker code reads or writes
-- these yet. universe_id is untouched.

-- Coverage. story_key is the strongest exact key, one of these shapes:
--   sec:<ticker>:<accession> | piid:<ticker>:<PIID>-<mod> | lgs:<ticker>:<host>:<matter>#<fragment> | t:<hash>
-- story_of is the items.id of the canonical copy; NULL on a canonical.
ALTER TABLE items ADD COLUMN story_key TEXT;
ALTER TABLE items ADD COLUMN story_of INTEGER;

-- Auxiliary. story_key: sec:<accession> | piid:<PIID>-<mod> | lgs:<host>:<matter>#<fragment> | t:<hash>
-- url_key: u:<hash of the canonical URL>. story_of: the aux_items.id of the canonical copy.
ALTER TABLE aux_items ADD COLUMN story_key TEXT;
ALTER TABLE aux_items ADD COLUMN url_key TEXT;
ALTER TABLE aux_items ADD COLUMN story_of INTEGER;

-- Partial: rows without a key (every row written before the backfill) add no index entry.
CREATE INDEX idx_items_story_key ON items(story_key, nm_first_seen) WHERE story_key IS NOT NULL;
CREATE INDEX idx_items_story_of ON items(story_of) WHERE story_of IS NOT NULL;
CREATE INDEX aux_items_story_key ON aux_items(story_key, nm_first_seen) WHERE story_key IS NOT NULL;
CREATE INDEX aux_items_url_key ON aux_items(url_key, nm_first_seen) WHERE url_key IS NOT NULL;
CREATE INDEX aux_items_story_of ON aux_items(story_of) WHERE story_of IS NOT NULL;
