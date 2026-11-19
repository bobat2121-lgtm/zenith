-- Excerpt fetches become retryable (429/5xx/timeouts, and SEC items once a
-- contact email is configured), and a grade is stored at most once per
-- (item, ticker, run) so a resubmitted file cannot double-grade.

ALTER TABLE items ADD COLUMN excerpt_tries INTEGER NOT NULL DEFAULT 0;
ALTER TABLE items ADD COLUMN excerpt_next_at TEXT;

-- Retry the statuses that were written as final before this migration.
UPDATE items SET excerpt_status = NULL
 WHERE excerpt_status IN ('skipped_sec_needs_contact', 'error', 'error_timeout')
    OR excerpt_status LIKE 'http_5%' OR excerpt_status = 'http_429';

CREATE UNIQUE INDEX IF NOT EXISTS idx_grades_once ON grades(item_id, ticker, run_id) WHERE run_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_items_excerpt ON items(excerpt_status, excerpt_next_at);
