-- Counterparty sources: items from customer, partner, program, rival and index
-- sources of the covered companies. role is the source's role (NULL for a
-- covered company's own sources); affects lists the covered tickers it bears on.
ALTER TABLE items ADD COLUMN role TEXT;
ALTER TABLE items ADD COLUMN affects TEXT;

-- The owner removed SoundThinking (SSTI) and Rekor (REKR) from coverage on
-- 2026-11-20: stop queueing their items (graded history stays).
UPDATE items SET state = 'skipped', skip_reason = 'coverage_dropped', claim_id = NULL, claimed_until = NULL
 WHERE ticker IN ('SSTI', 'REKR') AND state IN ('pending', 'claimed');
