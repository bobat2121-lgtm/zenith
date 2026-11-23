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
| `worker/` | zenith-core: `src/ingest.js` (cursor over news-monitor-db), `src/excerpt.js` (opening text of each release), `src/index.js` (API), `migrations/`. |
| `grader/` | What the hourly routine runs: `GRADER.md` (procedure) and `zenith.mjs` (API CLI). |
| `app/` | Streamlit feed. Views: For you (≥70), Latest, Label queue, Lead only. Labels High/Medium/Low/Noise and Too high/Too low, recorded against the grade on the card, plus a "why it matters" note feed back to the grader. |
| `scripts/sync-covered.mjs` | Regenerates `worker/src/covered.json` from news-monitor's lane policy, `coveredTicker` sources and every source's `role`/`affects`. |

## API (bearer tokens: ADMIN_TOKEN, GRADER_TOKEN, APP_TOKEN)

| Route | Role |
|---|---|
| `GET /health` | public |
| `GET /v1/rubric[/TICKER]` | grader |
| `POST /v1/queue/claim` `{limit, run_id}` | grader |
| `POST /v1/grades` `{claim_id, run_id, rubric_version, model, grades[]}` | grader |
| `GET /v1/labels?since=` | grader |
| `GET /v1/feed?limit&before_id&ticker&min_score&state&unlabeled&order=newest` (recent Leads first, then newest; page with `before_id` = the last page's `next_before_id`, passed back unchanged: it is negative while the pinned Leads continue) | app |
| `POST /v1/feedback` `{item_id, label, note, ticker or grade_id}` | app |
| `GET /v1/stats` | grader, app |
| `POST /v1/admin/ingest`, `/v1/admin/enrich`, `/v1/admin/requeue` `{item_ids}` or `{mode: "late_flags"}` or `{mode: "sec_excerpts", retry_failed?}` (covered tickers only; repeat until `remaining` is 0, `waiting` counts items in retry backoff) | admin |

## Operate

```bash
npm test                         # rebuilds the rubric module, runs unit tests
npm run sync:covered             # after news-monitor covered-lane changes
cd worker && npx wrangler deploy # deploy (rubric is bundled at build time)
```

Run the app locally: `app/.venv/Scripts/python -m streamlit run app/streamlit_app.py`
with `app/.streamlit/secrets.toml` holding `ZENITH_API` and `ZENITH_APP_TOKEN`.

Hosted on Streamlit Community Cloud (for labelling from any device):
- New app → repository `bobat2121-lgtm/zenith`, branch `main`, main file `app/streamlit_app.py`, Python 3.12.
- App settings → Secrets: `ZENITH_API` and `ZENITH_APP_TOKEN` in TOML, as in `app/.streamlit/secrets.toml`.
- The repository is private, so the app is private: only the owner and invited viewers can open it. The app token reaches only feed, stats and feedback.
- The theme comes from `.streamlit/config.toml` at the repository root (a copy of `app/.streamlit/config.toml`, which local runs use).

Secrets live only in Worker secrets, the routine's environment variables and git-ignored
local files. Excerpts are fetched only for the grader and shown as short snippets.
