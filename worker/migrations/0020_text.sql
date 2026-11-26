-- 0020: Phase 2 Part A: a shadow page read for auxiliary items, and the excerpt cap
-- that was applied, so cut rates can be measured per budget. Additive only: 7 columns,
-- no table and no index (nothing here is indexed, so writing these adds no index rows).
-- Schema only: no Worker code reads or writes these yet.
--
-- aux_items.excerpt and excerpt_status keep their meaning (what the feed carried). A
-- page read goes only to page_*, so every existing reader of excerpt is unchanged.
ALTER TABLE aux_items ADD COLUMN page_excerpt TEXT;
ALTER TABLE aux_items ADD COLUMN page_status TEXT;
ALTER TABLE aux_items ADD COLUMN page_tries INTEGER NOT NULL DEFAULT 0;
ALTER TABLE aux_items ADD COLUMN page_next_at TEXT;
ALTER TABLE aux_items ADD COLUMN page_at TEXT;
ALTER TABLE aux_items ADD COLUMN page_cap INTEGER;
ALTER TABLE items ADD COLUMN excerpt_cap INTEGER;
