-- Coverage-subject sources join the auxiliary pipeline (plans/aux-round2.md R2A).
--
-- Counterparty filters built to watch a covered company (co-mention searches
-- such as aglt_rel, FPDS award feeds, Drone Dominance) are now auxiliary
-- sources as well as Coverage sources. aux-route.js marks their items:
--   coverage_subject  1 when the item comes from such a feed (the grader names
--                     the outside company it is about, or grades it
--                     reason:covered_name when it is mainly about the covered
--                     company), else 0
--   affects           the covered tickers the feed was built for, comma
--                     separated as in items.affects ("RCAT,DPRO"); NULL when
--                     coverage_subject is 0
-- meta aux_cs_cursor: the one-time catch-up scan of rows that passed
-- aux_nm_cursor before these sources were routed ('done' when finished).
ALTER TABLE aux_items ADD COLUMN coverage_subject INTEGER NOT NULL DEFAULT 0;
ALTER TABLE aux_items ADD COLUMN affects TEXT;
