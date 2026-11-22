-- Feed text and PDFs as excerpts (newsroom roadmap T8, T9).
--
-- excerpt_status gains four values, set by worker/src/ingest.js and
-- worker/src/excerpt.js (the column is free text, no CHECK to change):
--   feed            the excerpt was built at ingest from the text news-monitor
--                   kept from the item's own feed (news-monitor items.body),
--                   which carried the release itself; the page is not fetched
--   feed_summary    the feed carried only a summary or a teaser and the page
--                   could not be read: the excerpt is that summary
--   pdf             the excerpt was read from a PDF (a covered company's deck,
--                   shareholder letter or stats sheet)
--   pdf_unreadable  the PDF was downloaded but holds no readable text
--
-- excerpt_source: the document the excerpt is read from when it is not the
-- item's own URL. Ingest sets it to the PDF a presentations feed links (Q4 decks
-- carry only "View this Presentation (PDF)"); enrich sets it to the PDF a deck
-- page links or redirects to. NULL = the item's URL.
ALTER TABLE items ADD COLUMN excerpt_source TEXT;

-- excerpt_fallback: the excerpt of a feed's summary or teaser, kept by ingest
-- for an item whose page enrich still fetches. It becomes the excerpt (status
-- feed_summary) only when that read ends without an excerpt of its own.
ALTER TABLE items ADD COLUMN excerpt_fallback TEXT;
