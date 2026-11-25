# Zenith

A graded research feed for the analyst's **covered universe**: the public companies
in news-monitor's 8-minute lane (26 tickers, listed in `worker/src/covered.json`).

```
news-monitor (collection, 195 sources)
      │  read-only rowid cursor on news-monitor-db
      ▼
zenith-core Worker (Cloudflare, D1 zenith-db)
  ingest every 5 min → excerpt fetch → queue (claims with 45-min leases)
  serves the rubric, accepts grades and analyst labels, serves the feed
      ▲                                   │
      │ hourly Claude routine (grader)    │ /v1/feed, /v1/feedback
      │ grader/GRADER.md + grader/zenith.mjs
                                          ▼
                         Streamlit app (app/) — black/red X-style feed
```

## Pieces

| Path | What |
|---|---|
| `rubric/core.md`, `rubric/companies/<TICKER>.md` | The grading rubric. Bundled into the Worker at deploy (`npm run build:rubric`); its content hash is the rubric version stamped on every grade. |
| `worker/` | zenith-core: `src/ingest.js` (cursor over news-monitor-db), `src/excerpt.js` (opening text of each release), `src/index.js` (API), `src/auxiliary.js` (auxiliary names: own tables, cursor, claim, grades and feed; never touches coverage rows), `src/headlines.js` (the headline-only pass: its own lease columns, never touches grades or grading state), `migrations/`. |
| `grader/` | What the hourly routine runs: `GRADER.md` (procedure) and `zenith.mjs` (API CLI). |
| `app/` | Streamlit app, four pages: **Coverage Universe** (`/v1/feed`, the default), **Brief** (`/v1/brief` as data: Leads and Digests since a chosen time, waiting items, items to label, and the next 30 days from `/v1/calendar`; no model call and nothing sent anywhere), **Auxiliary Names** (`/v1/aux/feed`, every company or program outside coverage) and **Tuning** (calibration, source tuning, the grader section with held rows and the daily grading budget, and the Recall scoreboard from `/v1/recall`, counts only). The two feed pages each have a For You (Signal 60/70/80/90+, recent Leads pinned) / Latest (newest, pending included) switch, a Companies / Names filter and an Unlabeled only toggle. One-glance cards: name, source or status, score · band, age, the title as `<headline> - <tag>` (the grader's plain-language headline and item type; the original title until an item has one), the grader's one-line why, read-through chips on auxiliary cards. The Coverage page also shows a one-line source-health strip (SEC fast path, failing IR probes), an ops strip under the grader strip (news-monitor open alerts and failing managed-lane checks, `/v1/news-ops`) and a Site changes expander (`/v1/site-changes`, `/v1/source-health`). Labels High/Medium/Low/Noise and Too high/Too low, recorded against the grade on the card, plus a "why it matters" note feed back to the grader. |
| `scripts/sync-covered.mjs` | Regenerates `worker/src/covered.json` from news-monitor's lane policy, `coveredTicker` sources and every source's `role`/`affects`, `worker/src/aux-sources.json` (every other company or program source, as auxiliary names; counterparty filters built for a covered company, such as co-mention searches, FPDS feeds and Drone Dominance, are marked `coverage_subject` with the tickers they affect) and `worker/src/site-sources.json` (site-structure watchers and probes with the covered ticker each watches). |

## API (bearer tokens: ADMIN_TOKEN, GRADER_TOKEN, APP_TOKEN)

| Route | Role |
|---|---|
| `GET /health` | public |
| `GET /v1/rubric[/TICKER]` | grader |
| `POST /v1/queue/claim` `{limit, run_id}` | grader |
| `POST /v1/grades` `{claim_id, run_id, rubric_version, model, grades[]}` (each grade may carry `headline` and `tag`, both or neither: core.md section 10; stored on the item, a `#TICKER` grade's only when the item has none) | grader |
| `GET /v1/labels?since=` | grader |
| `GET /v1/feed?limit&before_id&ticker&min_score&state&unlabeled&order=newest` (items carry `headline` and `headline_tag`, null until written; recent Leads first, then newest; page with `before_id` = the last page's `next_before_id`, passed back unchanged: it is negative while the pinned Leads continue; rows held for the daily grading budget are hidden unless `include_held=1`, also on `/v1/aux/feed`; an undated card's Lead band is shown as `digest`, with the grade's own band in `stored_band`, and it pins as a recent Lead only when the owner labelled it High) | app |
| `POST /v1/feedback` `{item_id, label, note, reason?, ticker or grade_id}` (`reason`: not_material, duplicate, wrong_company, stale, marketing, not_my_focus or missed_detail; feeds return it as `my_reason`, labels as `reason`) | app |
| `GET /v1/stats` (an `aux` block: by_state, by_band, entities, last_ingest_at) | grader, app |
| `GET /v1/rubric/aux` (auxiliary rubric, own `rubric_version`; 503 until built) | grader |
| `POST /v1/aux/claim` `{limit 1-40, run_id}`, `POST /v1/aux/grades` `{claim_id, run_id, rubric_version, model, grades[]}` (optional `headline` and `tag`, as coverage) | grader |
| `POST /v1/headlines/claim` `{limit 1-60 (40), days 1-60 (30)}` → `{claim_id, lease_minutes, days, items: [{kind: coverage|aux, item_id, ticker or entity, title, url, published, first_seen, excerpt (1,200 chars), score, band, why}], remaining}`: graded items with no headline, coverage first, newest first; a 45-minute lease on its own columns (`headline_claim_id`, `headline_claimed_until`) | grader |
| `POST /v1/headlines` `{claim_id, headlines: [{kind, item_id, headline, tag}]}` → `{accepted, rejected: [{kind, item_id, error}], results}`: items from the claim only; writes the headline and tag, never a grade, score or state | grader |
| `GET /v1/aux/recent?entity&days`, `GET /v1/aux/labels?limit&days` (labels the current grade falls outside of) | grader |
| `GET /v1/aux/feed?limit&before_id&entity&min_score&state&unlabeled&order=newest&pin_lead_hours` (same paging and `headline`, `headline_tag` as `/v1/feed`, newest by news-monitor arrival; hides skipped, duplicate and covered, and coverage-subject items until graded) | app |
| `POST /v1/aux/feedback` `{item_id, label, note, reason?}` | app |
| `GET /v1/feed?sort=to_label`, `GET /v1/aux/feed?sort=to_label` (graded, unlabeled cards of 14 days: confidence < 0.6, then 60-79 nearest 70, then by score; no paging) | app |
| `GET /v1/calibration` → `{coverage: {..., text}, aux: {same shape, by_entity}, reasons: {code: n}}` | grader, app |
| `GET /v1/ops` → `{grader: {last_run_at, last_run, runs_24h, gaps_7d: [{from, to, hours}], status: ok\|late\|down, checks, backlog: {coverage_pending, aux_pending, headlines_waiting, oldest_aux_pending_at, coverage_held, aux_held, released_today, budget: {total, per_source, guard}, double_graded_24h}}, as_of}` (pending counts leave out held rows; `released_today` counts held rows released since 00:00 UTC; `double_graded_24h` counts news-monitor rows graded in both pipelines with a grade in the last 24 h) | app |
| `GET /v1/source-prefs`, `POST /v1/source-prefs` `{source_key, action: mute\|demote\|normal, note?}` (mute: new items skipped as `muted_source` and cards hidden; demote: For You counts the source 15 lower; never an SEC source (`edgar_*` or an aux source marked `sec`) or a covered company's own channel) | app |
| `GET /v1/source-yield?days=30` → `{coverage: [...], aux: [...]}`: per source `{graded, high, reject, duplicate, covered, last_high_at, pref, suggest}` | app |
| `GET /v1/left-out?kind=coverage\|aux&reason&days=14&limit=50` (skipped items and `counts` by skip reason; `archive_seed` only when asked for), `POST /v1/left-out/grade` `{kind, id}` (back to pending; 400 while its source is muted or its copy shows on the other page) | app |
| `POST /v1/admin/aux-ingest` (the cron runs it after the coverage ingest and enrich) | admin |
| `GET /v1/site-changes?days=14&limit=50[&tickers=KDK,RCAT]` (news-monitor `site_structure_changes`: `{items: [{id, ticker, source_key, kind, section, detail, detected_at, notable}]}`, newest first; `tickers` filters before the limit, and notable rows are kept first when over it; a section told with its new child sitemap is listed once; `notable` = a new IR, events, presentations, investor-day, press or news section, matched on whole path words) | app |
| `GET /v1/source-health` (`{edgar_fast_path: {last_match_at, matches_24h, matches_7d}, ir_probes: {checked_at, failing: [{key, ticker, label, since, error}], ok}, as_of}`; a block is null when its news-monitor table is missing; a feed or sitemap probe that answers an HTML page is failing) | app |
| `GET /v1/brief?since=` (the brief as data: `{kind, generated_at, from, to, today, window: since\|last_brief, leads_digests: [{ticker, items}], counterparty, waiting: {count, counterparty_count, oldest, held, items}, catalysts, health, to_label, text}`; graded rows carry `headline`, `headline_tag`; waiting, counts, catalysts and items to label cover today's covered tickers only; rows held for the daily grading budget are not waiting and are counted in `waiting.held`; the next 7 days include council agendas; no model call and nothing sent anywhere; `since` is clamped to 7 days, and a `since` that does not parse falls back to the last brief) | app |
| `GET /v1/calendar?days=30&from&ticker` (`{calendar_version, from, days, ticker, entries: [{ticker, kind, start, end, precision, text, ...}]}`: the sheet's dates, graded notices and council agendas (a `legistar_*` item whose title gives `, agenda YYYY-MM-DD`, names the routed company and carries no rival marker), covered tickers only) | app |
| `GET /v1/news-ops` (`{alerts: {open, open_count, bing_open, resolved_24h}, managed: {configured, failing, failing_count, last_attempt, config_updated_at}, as_of}`: news-monitor's open alerts (Bing feed flaps counted apart in `bing_open`) and the managed lane's failing checks; a block is null when its news-monitor table is missing; SELECT only on news-monitor-db) | app |
| `GET /v1/recall` (`{total, by_status: {on_time, late, partial, missed}, by_kind, by_ticker, sources, checked_at, loaded_at}`: the recall scoreboard; `events=1` adds the event list for the admin token only; 503 "apply migration 0015" until the table exists) | app, admin |
| `POST /v1/admin/recall` `{source, events[1-200], replace?, dry_run?}` (validates each event, resolves its captured item by exact URL, upserts `recall_events` by id; `replace` deletes rows of that source whose id is not in the payload. The events are kept outside this repo and loaded only through this route) | admin |
| `POST /v1/admin/ingest`, `/v1/admin/enrich`, `/v1/admin/requeue` `{item_ids}` or `{mode: "late_flags"}` or `{mode: "sec_excerpts", retry_failed?}` (covered tickers only; repeat until `remaining` is 0, `waiting` counts items in retry backoff) | admin |
| `POST /v1/admin/requeue` `{mode: "rescue", since: YYYY-MM-DD, until?, reasons?, kind?: coverage\|aux\|both, sources?, fit?: rubric\|all, limit? 1-300 (60), dry_run?}` (turns skipped rows (`archive_seed`, `stale_on_arrival`, `rival_no_key_account`) back into rows held for the daily grading budget, `admit = 'rescue'`, one row per news-monitor row in the pipeline that owns it; it never releases anything itself. **Do not run before 2026-11-29 16:00 UTC; `dry_run` first.**) | admin |

**Daily grading budget** (`worker/src/budget.js`, migration 0016). The arrival gate admits some rows that would once have been dropped or graded at once (official records past the 14-day line, a bounded window of a new source's first poll, a new non-covered source's fresh seed rows) as *held*: `admit` set, `released_at` NULL, `state` still `pending`. Held rows are never claimed and never counted as waiting. Every 5-minute tick releases held rows, at most 20 a UTC day across both pipelines, at most 5 per source, and only while the claimable queue of that pipeline is under 60; a new source's fresh seed rows go first. Override with the Worker secrets `GATE_BUDGET_TOTAL`, `GATE_BUDGET_PER_SOURCE` and `GATE_QUEUE_GUARD`. Each news-monitor row is graded in one pipeline only.

## Operate

```bash
npm test                         # rebuilds the rubric module, runs unit tests
npm run sync:covered             # after news-monitor covered-lane changes
cd worker && npx wrangler deploy # deploy (rubric is bundled at build time)
```

Run the app locally: `app/.venv/Scripts/python -m streamlit run app/streamlit_app.py`
with `app/.streamlit/secrets.toml` holding `ZENITH_API` and `ZENITH_APP_TOKEN`.
The entrypoint only sets up `st.navigation`; the pages are `app/views/*.py` and the shared feed code is
`app/zenith_feed.py`. Tests (requests mocked, no network): `app/.venv/Scripts/python -m unittest discover -s app/tests -v`.

Hosted on Streamlit Community Cloud (for labelling from any device):
- New app → repository `bobat2121-lgtm/zenith`, branch `main`, main file `app/streamlit_app.py`, Python 3.12.
- App settings → Secrets: `ZENITH_API` and `ZENITH_APP_TOKEN` in TOML, as in `app/.streamlit/secrets.toml`.
- The repository is private, so the app is private: only the owner and invited viewers can open it. The app token reaches only feed, stats and feedback (coverage and auxiliary).
- The theme comes from `.streamlit/config.toml` at the repository root (a copy of `app/.streamlit/config.toml`, which local runs use).

Secrets live only in Worker secrets, the routine's environment variables and git-ignored
local files. Excerpts are fetched only for the grader and shown as short snippets.
