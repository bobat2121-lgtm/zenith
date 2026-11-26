-- 0021: Phase 3 Part A: the portal tables. Additive only: 2 new tables, no index, no
-- change to any existing table. Schema only: no Worker code reads or writes these yet.

-- Portal opens per UTC day, view, client class and sign-in path (phase 3).
-- No user agent, IP, email, actor hash or item id is stored.
CREATE TABLE portal_views (
  universe_id TEXT NOT NULL DEFAULT 'u1',
  day TEXT NOT NULL,      -- UTC date YYYY-MM-DD
  view TEXT NOT NULL,     -- today|companies|company|competitors|industry|rare|search|brief|pair
  client TEXT NOT NULL,   -- phone|phone_home|tablet|desktop
  via TEXT NOT NULL,      -- access|session
  n INTEGER NOT NULL DEFAULT 0,
  first_at TEXT NOT NULL,
  last_at TEXT NOT NULL,
  PRIMARY KEY (universe_id, day, view, client, via)
) WITHOUT ROWID;

-- Session-mode pairing codes (phase 3): at most one live row; only the SHA-256 is stored.
CREATE TABLE portal_pairings (
  id INTEGER PRIMARY KEY,
  code_sha256 TEXT NOT NULL,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  used_at TEXT,
  fails INTEGER NOT NULL DEFAULT 0
);
