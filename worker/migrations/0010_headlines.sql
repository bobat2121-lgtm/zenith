-- Plain-language headlines (plans/headlines-round3.md). Additive only.
--
-- The grader writes a headline (what the item highlights, the key figures
-- first, 8-140 characters) and a tag (the SEC form exactly as filed, or one of
-- Press release, Presentation, Shareholder letter, Event, Contract notice,
-- Program notice, News, Blog, Video, Filing, Report, Interview) with each grade,
-- or later in a headline-only pass. They live on the item, not the grade, so a
-- regrade or the headline pass can replace them without touching scores:
--   headline, headline_tag  shown by the app as "<headline> - <tag>"; NULL until written
--   headline_at             when they were written
-- The headline pass (POST /v1/headlines/claim, POST /v1/headlines) leases items
-- on its own columns and never touches state, claim_id, claimed_until or
-- attempts, so it can never disturb grading:
--   headline_claim_id, headline_claimed_until
ALTER TABLE items ADD COLUMN headline TEXT;
ALTER TABLE items ADD COLUMN headline_tag TEXT;
ALTER TABLE items ADD COLUMN headline_at TEXT;
ALTER TABLE items ADD COLUMN headline_claim_id TEXT;
ALTER TABLE items ADD COLUMN headline_claimed_until TEXT;
CREATE INDEX IF NOT EXISTS idx_items_headline_claim ON items(headline_claim_id);

ALTER TABLE aux_items ADD COLUMN headline TEXT;
ALTER TABLE aux_items ADD COLUMN headline_tag TEXT;
ALTER TABLE aux_items ADD COLUMN headline_at TEXT;
ALTER TABLE aux_items ADD COLUMN headline_claim_id TEXT;
ALTER TABLE aux_items ADD COLUMN headline_claimed_until TEXT;
CREATE INDEX IF NOT EXISTS aux_items_headline_claim ON aux_items(headline_claim_id);
