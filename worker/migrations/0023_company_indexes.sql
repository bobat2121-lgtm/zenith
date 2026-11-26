-- 0023: Phase 3 Part B: live-row indexes for the Company page. Additive only: 3 new
-- indexes, no table, no column, no data. No Worker code depends on them yet; the
-- Company page's reads (phase 3) use them once this file is applied.

-- A covered name's aux sources, live rows only, by first-seen window. The partial
-- WHERE matches a query's `state != 'skipped'` (an IN list of the other states
-- does not imply it, so such a query keeps the older indexes).
CREATE INDEX IF NOT EXISTS aux_items_source_live ON aux_items(source_key, nm_first_seen) WHERE state != 'skipped';
-- A covered name's competitor entities, live rows only, by first-seen window.
CREATE INDEX IF NOT EXISTS aux_items_entity_live ON aux_items(entity_key, nm_first_seen) WHERE state != 'skipped';
-- Grades of other names' items that were graded for this name, by grading time.
CREATE INDEX IF NOT EXISTS idx_grades_ticker_graded ON grades(ticker, graded_at);
