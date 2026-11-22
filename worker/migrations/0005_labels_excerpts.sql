-- When an item's excerpt was last fetched with the current reader (SEC filings
-- start at their first Item heading and add Ex-99.1; figures are kept over
-- filler). NULL on existing rows, so the admin SEC refresh re-reads every
-- sec.gov item once.
ALTER TABLE items ADD COLUMN excerpt_at TEXT;

-- Every sec.gov fetch so far ran without CONTACT_EMAIL, so none was a real
-- try: clear those counts and statuses so the filings are read once it is set.
UPDATE items SET excerpt_status = NULL, excerpt_tries = 0, excerpt_next_at = NULL
 WHERE (url LIKE 'https://www.sec.gov/%' OR url LIKE 'https://sec.gov/%' OR url LIKE 'http://www.sec.gov/%')
   AND (excerpt_status IS NULL OR excerpt_status = 'skipped_sec_needs_contact');
