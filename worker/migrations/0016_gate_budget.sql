-- Phase 0 gates: rows the new arrival rules (or an admin rescue) admit wait,
-- held, until the daily grading budget releases them (worker/src/budget.js).
-- admit: why the row was let in (record_late, seed_window, seed_fresh, rescue);
-- NULL for every row the old rules queued. released_at: when the budget
-- released it. Additive only: four nullable columns and two partial indexes.
ALTER TABLE items ADD COLUMN admit TEXT;
ALTER TABLE items ADD COLUMN released_at TEXT;
ALTER TABLE aux_items ADD COLUMN admit TEXT;
ALTER TABLE aux_items ADD COLUMN released_at TEXT;
CREATE INDEX idx_items_admit ON items(released_at, admit, nm_first_seen) WHERE admit IS NOT NULL;
CREATE INDEX aux_items_admit ON aux_items(released_at, admit, nm_first_seen) WHERE admit IS NOT NULL;
