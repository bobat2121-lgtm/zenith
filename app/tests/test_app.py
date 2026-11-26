"""Zenith app tests: unittest + Streamlit AppTest, with `requests` mocked (no network).

Run from the repository root:
  app/.venv/Scripts/python -m unittest discover -s app/tests -v
"""
from __future__ import annotations

import copy
import re
import sys
import unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path
from unittest import mock

APP = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(APP))

import zenith_feed as zf  # noqa: E402
from streamlit.testing.v1 import AppTest  # noqa: E402

API = "https://zenith.test"
TOKEN = "app-test-token"


def iso(hours_ago: float) -> str:
    return (datetime.now(timezone.utc) - timedelta(hours=hours_ago)).strftime("%Y-%m-%dT%H:%M:%SZ")


STATS = {
    "rubric_version": "abc123", "tickers": ["RCAT", "UMAC", "KTOS"], "labels": 4,
    "by_state": [{"state": "graded", "n": 10}, {"state": "pending", "n": 2}],
    "by_band": [{"band": "lead", "n": 1}], "last_run": {"last_seen_at": iso(1)},
    "aux": {"by_state": [{"state": "graded", "n": 7}, {"state": "claimed", "n": 1}], "by_band": [{"band": "lead", "n": 2}],
            "entities": [{"name": "Anduril", "n": 5}, {"name": "Skydio", "n": 2}], "last_ingest_at": iso(0.2)},
}
COVERAGE_ITEMS = [
    {"item_id": 11, "ticker": "RCAT", "grade_ticker": "RCAT", "grade_id": 101, "source_key": "rcat_press",
     "title": "Red Cat wins <script>alert(1)</script> Army order", "url": "https://example.com/rcat",
     "first_seen": iso(2), "state": "graded", "score": 92, "band": "lead", "why": "Program of record <b>award</b>",
     "snippet": "Opening paragraph.", "pinned": 1, "also": "UMAC:71", "label": None},
    {"item_id": 10, "ticker": "UMAC", "grade_ticker": "UMAC", "grade_id": 100, "source_key": "edgar_umac",
     "title": "UMAC 8-K", "url": "javascript:alert(1)", "first_seen": iso(5), "state": "graded",
     "score": None, "band": "duplicate", "why": "Same award as item 11", "pinned": 0, "label": "noise"},
    {"item_id": 9, "ticker": "KTOS", "source_key": "ktos_press", "title": "Kratos update", "url": "https://example.com/k",
     "first_seen": iso(0.5), "state": "pending", "score": None, "band": None, "pinned": 0, "label": None},
]
AUX_ITEMS = [
    {"item_id": 501, "entity": "Anduril <img src=x>", "entity_key": "anduril", "status": "private", "source_key": "anduril",
     "title": "Anduril raises $2.5B", "url": "https://example.com/anduril", "first_seen": iso(3), "state": "graded",
     "score": 95, "band": "lead", "why": "Largest <i>defense</i> tech round", "pinned": 1,
     "reads_through": [{"ticker": "RCAT", "direction": "-"}, {"ticker": "KTOS", "direction": "±"}],
     "snippet": "Anduril today announced...", "label": None},
    {"item_id": 500, "entity": "Waymo", "entity_key": "waymo", "status": "unknown", "source_key": "waymo",
     "title": "Waymo pending item", "url": "https://example.com/waymo", "first_seen": iso(1), "state": "pending",
     "score": None, "band": None, "pinned": 0, "reads_through": [], "label": None},
]
HEALTH = {
    "edgar_fast_path": {"last_match_at": iso(2), "matches_24h": 3, "matches_7d": 9},
    "ir_probes": {"checked_at": iso(5), "ok": 25, "failing": [
        {"key": "probe_sym_ir_events_rss", "ticker": "SYM", "label": "SYM events", "since": iso(5), "error": "akamai challenge, HTTP 403"},
        {"key": "probe_kdk_ir_news_rss", "ticker": "KDK", "label": "KDK <news>", "since": iso(5), "error": "timeout <b>"}]},
    "as_of": iso(0),
}
SITE_CHANGES = [
    {"id": 3, "ticker": "UMAC", "source_key": "site_unusual", "kind": "section_gone", "section": "/blog/",
     "detail": "section /blog/ gone (had 9 URLs)", "detected_at": iso(1), "notable": False},
    {"id": 2, "ticker": "RCAT", "source_key": "site_redcat_ir", "kind": "section_new", "section": "/investor-day/",
     "detail": "new section /investor-day/ (3 URLs) <script>x</script>", "detected_at": iso(30), "notable": True},
    {"id": 1, "ticker": "AUR", "source_key": "site_aurora", "kind": "child_new", "section": "/news/",
     "detail": "new child sitemap", "detected_at": iso(3), "notable": True},
    {"id": 4, "ticker": None, "source_key": "site_maymobility", "kind": "index_moved", "section": None,
     "detail": "sitemap index moved", "detected_at": iso(2), "notable": False},
]


OPS = {
    "grader": {
        "last_run_at": iso(0.2), "last_run": {"claimed": 12, "graded": 11}, "runs_24h": 18, "status": "ok",
        "gaps_7d": [{"from": "2026-11-23T08:11:00Z", "to": "2026-11-23T14:05:00Z", "hours": 5.9},
                    {"from": "2026-11-20T01:00:00Z", "to": "2026-11-20T04:00:00Z", "hours": 3}],
        "checks": [{"key": "grader_stale", "state": "ok", "detail": "Grader has not run since 9:00 ET."},
                   {"key": "queue_stale", "state": "fail", "detail": "3 covered items waiting <b>over</b> 75 min"}],
        "backlog": {"coverage_pending": 4, "aux_pending": 96, "headlines_waiting": 239,
                    "oldest_aux_pending_at": "2026-11-09T10:00:00Z"},
    },
    "as_of": "2026-11-23T14:20:00Z",
}


# ---- Zenith show (phase 0) fixtures: synthetic names, numbers and dates only ----------
BRIEF = {
    "kind": "brief", "generated_at": "2026-11-24T13:05:00Z", "from": "2026-11-23T13:00:00Z", "to": "2026-11-24T13:05:00Z",
    "today": "2026-11-24", "window": "since",
    "leads_digests": [{"ticker": "RCAT", "items": [
        {"grade_id": 1, "item_id": 11, "ticker": "RCAT", "item_ticker": "RCAT", "score": 92, "band": "lead",
         "why": "Program of record <b>award</b>", "graded_at": iso(1), "title": "Red Cat wins <script>alert(1)</script> order",
         "url": "https://example.com/rcat", "headline": None, "headline_tag": None, "role": None},
        {"grade_id": 2, "item_id": 12, "ticker": "RCAT", "item_ticker": "UMAC", "score": 75, "band": "digest",
         "why": "Joint supply deal", "graded_at": iso(2), "title": "UMAC and Red Cat deal", "url": "javascript:alert(1)",
         "headline": "Red Cat signs a supply deal", "headline_tag": "Contract", "role": None}]}],
    "counterparty": [{"grade_id": 3, "item_id": 13, "ticker": "KTOS", "item_ticker": "KTOS", "role": "customer", "score": 78,
                      "band": "digest", "why": "Testco orders 50 units", "graded_at": iso(3), "title": "Testco orders units",
                      "url": "https://example.com/cp", "headline": None, "headline_tag": None}],
    "waiting": {"count": 0, "counterparty_count": 0, "oldest": None, "items": []},
    "catalysts": [{"ticker": "AXON", "kind": "council_agenda", "start": "2026-11-27", "end": "2026-11-27", "precision": "day",
                   "confirmed": True, "text": "[AXON] Testville City Council 26-3: Axon contract — In Committee, agenda 2026-11-27",
                   "url": "https://testville.example.gov/26-3", "item_id": 40}],
    "health": {"grader_last_run": iso(0.5), "graded_in_window": 12,
               "news_monitor": {"failing": [{"key": "rcat_press", "ticker": "RCAT", "fail_count": 4, "last_ok": "2026-11-20T10:00:00Z",
                                             "last_error": "HTTP 403"}]}},
    "to_label": [{"item_id": 11, "ticker": "RCAT", "title": "Red Cat order", "url": "https://example.com/rcat", "score": 92,
                  "why": "top grade"}],
    "text": ["**Zenith brief** (Discord text, never shown in the app)"],
}
CALENDAR = {"calendar_version": "c-test", "from": "2026-11-24", "days": 30, "ticker": None, "entries": [
    {"ticker": "MSTR", "kind": "catalyst", "start": "2026-11-30", "end": "2026-11-30", "precision": "day", "text": "Test index change takes effect"},
    {"ticker": "RCAT", "kind": "graded_notice", "start": "2026-11-30", "end": "2026-11-30", "precision": "day", "confirmed": True,
     "text": "Red Cat to report <b>results</b>", "time": "4:30 pm ET", "url": "javascript:alert(1)", "item_id": 7},
    {"ticker": "AXON", "kind": "council_agenda", "start": "2026-12-08", "end": "2026-12-08", "precision": "day", "confirmed": True,
     "text": "[AXON] Testville City Council 26-3: Axon contract — In Committee, agenda 2026-12-08", "url": "https://testville.example.gov/26-3"},
    {"ticker": "MSTR", "kind": "catalyst", "start": "2026-11-30", "end": "2026-11-30", "precision": "day", "recurring": True,
     "text": "Weekly holdings 8-K"},
    {"ticker": "MSTR", "kind": "catalyst", "start": "2026-12-07", "end": "2026-12-07", "precision": "day", "recurring": True,
     "text": "Weekly holdings 8-K"},
    {"ticker": "KTOS", "kind": "status_event", "start": "2026-11-25", "end": "2026-11-25", "precision": "day", "text": "A status event"},
    {"ticker": "UMAC", "kind": "open_item_expiry", "start": "2026-12-01", "end": "2026-12-01", "precision": "day", "text": "Review the open item"},
    {"ticker": "UMAC", "kind": "catalyst", "start": "2026-12-02", "end": "2026-12-02", "precision": "day", "context": True, "text": "A context line"},
    {"ticker": "RCAT", "kind": "catalyst", "start": "2026-10-01", "end": "2026-12-31", "precision": "quarter", "approx": True,
     "text": "Expected program award"},
    {"ticker": "KTOS", "kind": "catalyst", "start": "2026-01-01", "end": "2027-02-04", "precision": "range", "text": "A long range"},
    {"ticker": "UMAC", "kind": "catalyst", "start": "2026-12-18", "end": "2026-12-18", "precision": "day", "deadline": True,
     "text": "Filing deadline"},
]}
NEWS_OPS = {
    "alerts": {"open": [
        {"source_key": "lane:strategic_noncompany", "rule": "lateness", "opened_at": "2026-11-24T01:40:00Z", "last_seen_at": iso(0.2),
         "acknowledged": False, "snoozed": False, "detail": {"lane": "strategic_noncompany", "p95_ratio": 2.1, "cadence_min": [60, 1440]}},
        {"source_key": "ticker:RCAT", "rule": "crosscheck_missing_release", "opened_at": "2026-11-23T17:07:00Z", "last_seen_at": iso(0.2),
         "acknowledged": False, "snoozed": False, "detail": {"ticker": "RCAT", "form": "8-K", "items": ["7.01", "9.01"],
                                                             "url": "https://www.sec.gov/test-filing"}},
        {"source_key": "testco_site", "rule": "outage", "opened_at": "2026-11-23T00:11:00Z", "last_seen_at": iso(0.2),
         "acknowledged": True, "snoozed": False, "detail": {"fail_count": 4, "last_error": "sitemap 429 <b>"}}],
        "open_count": 2, "bing_open": 1, "resolved_24h": 3},
    "managed": {"configured": 120, "failing": [
        {"key": "m_testbot", "name": "Test Robotics <i>", "fail_count": 178, "last_ok": "2026-10-01T00:00:00Z",
         "last_attempt": iso(0.1), "last_error": "HTTP 404"},
        {"key": "m_testlog", "name": "Test Logistics", "fail_count": 84, "last_ok": None, "last_attempt": iso(0.1), "last_error": "HTTP 403"}],
        "failing_count": 2, "last_attempt": iso(0.1), "config_updated_at": "2026-10-05T00:00:00Z"},
    "as_of": iso(0),
}
RECALL = {
    "total": 7, "by_status": {"on_time": 3, "late": 2, "partial": 1, "missed": 1},
    "by_kind": [{"kind": "filing", "on_time": 2, "late": 1, "partial": 1, "missed": 0, "total": 4},
                {"kind": "news", "on_time": 1, "late": 1, "partial": 0, "missed": 1, "total": 3}],
    "by_ticker": [{"ticker": "RCAT", "on_time": 2, "late": 1, "partial": 1, "missed": 0, "total": 4}],
    "sources": ["test-seed"], "checked_at": "2026-01-15", "loaded_at": "2026-01-15T10:00:00Z",
}


def summary(n, agree, too_high, too_low):
    scored = agree + too_high + too_low
    return {"n": n, "agree": agree, "too_high": too_high, "too_low": too_low, "unscored": n - scored, "scored": scored,
            "agreement": round(100 * agree / scored) if scored else None, "labels": {}}


CALIBRATION = {
    "coverage": {"this_week": summary(3, 2, 1, 0), "all_time": summary(10, 6, 3, 1),
                 "misses": [{"item_id": 11, "ticker": "RCAT", "label": "low", "score": 92, "band": "lead",
                             "title": "Red Cat <b>wins</b> order", "verdict": "too_high"}]},
    "aux": {"this_week": summary(0, 0, 0, 0), "all_time": summary(2, 1, 0, 1),
            "misses": [{"item_id": 501, "entity": "Anduril", "label": "high", "score": 55, "title": "Anduril raises",
                        "verdict": "too_low"}]},
    "reasons": {"stale": 3, "missed_detail": 1, "wrong_company": 0},
}
SOURCE_YIELD = {
    "coverage": [
        {"source_key": "rcat_press", "graded": 30, "high": 12, "reject": 5, "duplicate": 2, "last_high_at": "2026-11-21T10:00:00Z",
         "pref": None, "suggest": None},
        {"source_key": "heo", "graded": 26, "high": 0, "reject": 25, "duplicate": 0, "last_high_at": None, "pref": None,
         "suggest": "mute"},
    ],
    "aux": [
        {"source_key": "anduril", "graded": 20, "high": 8, "reject": 4, "duplicate": 1, "covered": 2,
         "last_high_at": "2026-11-22T10:00:00Z", "pref": None, "suggest": None},
        {"source_key": "google_suncatcher", "graded": 25, "high": 0, "reject": 24, "duplicate": 0, "covered": 1,
         "last_high_at": None, "pref": "demote", "suggest": "mute"},
        {"source_key": "tfvector", "graded": 6, "high": 1, "reject": 5, "duplicate": 0, "covered": 0,
         "last_high_at": None, "pref": "mute", "suggest": "demote"},
    ],
}
LEFT_OUT = [
    {"id": 301, "kind": "coverage", "ticker": "SERV", "source_key": "serv_rel", "url": "https://example.com/serv",
     "title": "Vancouver City Council cancels Serve's <robot> pilot", "first_seen": iso(5), "skip_reason": "rival_no_key_account"},
    {"id": 300, "kind": "coverage", "ticker": "RCAT", "source_key": "heo", "url": "javascript:alert(1)",
     "title": "HEO webinar", "first_seen": iso(8), "skip_reason": "muted_source"},
    {"id": 299, "kind": "coverage", "ticker": "KTOS", "source_key": "ktos_press", "url": "https://example.com/old",
     "title": "Old archive story", "first_seen": iso(200), "skip_reason": "archive_seed"},
    {"id": 801, "kind": "aux", "entity": "Waymo", "source_key": "waymo", "url": "https://example.com/w",
     "title": "Waymo item", "first_seen": iso(3), "skip_reason": "grading_failed"},
]


SEC_URL = "https://www.sec.gov/Archives/edgar/data/1956955/000168316826008046/umac_8k.htm"
# /v1/expansion/candidates rows, shaped as zenith-core's shapeRow returns them (plans/round5 D1).
EXPANSION = [
    {"id": 7, "name": "Upgrade Energy", "dedupe_key": "upgrade energy", "status": "pending", "relation": "acquired",
     "subject": "UMAC", "origins": ["sec_filing", "grader_relation"], "tickers": ["UMAC"], "sightings": 1,
     "seen": ["coverage:18"],
     "evidence": [{"kind": "coverage", "item_id": 18, "url": SEC_URL, "title": "Unusual Machines, Inc.: 8-K filed 2026-10-23",
                   "at": "2026-10-23T20:00:00Z", "origin": "sec_filing", "party": "DroneNX LLC d/b/a Upgrade Energy"},
                  {"kind": "coverage", "item_id": 18, "url": SEC_URL, "title": "Unusual Machines, Inc.: 8-K filed 2026-10-23",
                   "at": "2026-10-23T20:00:00Z", "origin": "grader_relation"}],
     "known": ["sheet_term:UMAC"], "similar": [], "decisions": [], "decision": None, "approved_tickers": None,
     "compiled_at": None, "compiled_ref": None, "created_at": iso(30), "last_seen_at": iso(1),
     "actions": ["approve", "reject"], "decidable": True, "blocked": None},
    {"id": 12, "name": "Genesis AI", "dedupe_key": "genesis ai", "status": "pending", "relation": None, "subject": None,
     "origins": ["aux_entity"], "tickers": [], "sightings": 1, "seen": ["aux:222"],
     "evidence": [{"kind": "aux", "item_id": 222, "url": "https://news.example.com/genesis", "title": "Genesis AI raises $105M seed",
                   "at": "2026-11-10T12:00:00Z", "origin": "aux_entity"}],
     "known": None, "similar": [{"id": 13, "name": "Genesis", "status": "pending"}], "decisions": [], "decision": None,
     "approved_tickers": None, "compiled_at": None, "compiled_ref": None, "created_at": iso(40), "last_seen_at": iso(2),
     "actions": ["approve", "reject"], "decidable": True, "blocked": None},
    {"id": 9, "name": "UNMAS", "dedupe_key": "unmas", "status": "pending", "relation": "award", "subject": "SPAI",
     "origins": ["grader_relation"], "tickers": ["SPAI"], "sightings": 4,
     "seen": ["coverage:259", "coverage:260", "coverage:261", "coverage:262"],
     "evidence": [{"kind": "coverage", "item_id": 262, "url": "javascript:alert(1)", "title": "SPAI <script>x</script> award",
                   "at": "2026-11-20T12:00:00Z", "origin": "grader_relation"}]
                 + [{"kind": "coverage", "item_id": n, "url": f"https://ir.example.com/{n}", "title": f"Safe Pro item {n}",
                     "at": "2026-11-01T12:00:00Z", "origin": "grader_relation"} for n in (261, 260, 259)],
     "known": ["key_account:SPAI"], "similar": [], "decisions": [], "decision": None, "approved_tickers": None,
     "compiled_at": None, "compiled_ref": None, "created_at": iso(50), "last_seen_at": iso(3),
     "actions": ["approve", "reject"], "decidable": True, "blocked": None},
    {"id": 5, "name": "Stemme", "dedupe_key": "stemme", "status": "approved", "relation": "acquired", "subject": "ONDS",
     "origins": ["grader_relation"], "tickers": ["ONDS"], "sightings": 1, "seen": ["coverage:206"],
     "evidence": [{"kind": "coverage", "item_id": 206, "url": "https://ir.example.com/206", "title": "Ondas to acquire Stemme",
                   "at": "2026-11-05T12:00:00Z", "origin": "grader_relation"}],
     "known": None, "similar": [],
     "decisions": [{"at": "2026-11-24T10:00:00Z", "by": "app", "action": "approve", "reason": None, "note": None, "tickers": ["ONDS"]}],
     "decision": {"at": "2026-11-24T10:00:00Z", "by": "app", "action": "approve", "reason": None, "note": None, "tickers": ["ONDS"]},
     "approved_tickers": ["ONDS"], "compiled_at": None, "compiled_ref": None, "created_at": iso(60), "last_seen_at": iso(4),
     "actions": ["reject"], "decidable": True, "blocked": None},
    {"id": 20, "name": "Rockwell Automation", "dedupe_key": "rockwell automation", "status": "known", "relation": "partner",
     "subject": "AGILOX", "origins": ["grader_relation"], "tickers": [], "sightings": 1, "seen": ["aux:1859"],
     "evidence": [{"kind": "aux", "item_id": 1859, "url": "https://news.example.com/rockwell", "title": "Rockwell and AGILOX",
                   "at": "2026-11-12T12:00:00Z", "origin": "grader_relation"}],
     "known": ["aux_item:ia_rockwell"], "similar": [], "decisions": [], "decision": None, "approved_tickers": None,
     "compiled_at": None, "compiled_ref": None, "created_at": iso(70), "last_seen_at": iso(5),
     "actions": ["reopen"], "decidable": False,
     "blocked": "already has its own source (aux_item:ia_rockwell): use Not the same company to reopen it first"},
]
EXP_NEXT = {"approve": "approved", "reject": "rejected", "reopen": "pending"}


def left_out(params: dict) -> dict:
    """/v1/left-out as zenith-core answers it: archive_seed only when asked for, counts for the window."""
    rows = [r for r in LEFT_OUT if r["kind"] == params.get("kind", "coverage")]
    counts: dict = {}
    for r in rows:
        counts[r["skip_reason"]] = counts.get(r["skip_reason"], 0) + 1
    reason = params.get("reason")
    items = [r for r in rows if (r["skip_reason"] == reason if reason else r["skip_reason"] != "archive_seed")]
    return {"items": items[:int(params.get("limit", 50))], "counts": counts}


class Resp:
    def __init__(self, data, status: int = 200):
        self.data, self.status_code = data, status

    def raise_for_status(self):
        if self.status_code >= 400:
            raise zf.requests.HTTPError(f"{self.status_code} Client Error")

    def json(self):
        return self.data


class FakeApi:
    """Stands in for zenith-core: records every call, answers from fixtures."""

    def __init__(self):
        self.stats = copy.deepcopy(STATS)
        self.items = {"/v1/feed": copy.deepcopy(COVERAGE_ITEMS), "/v1/aux/feed": copy.deepcopy(AUX_ITEMS),
                      "/v1/site-changes": copy.deepcopy(SITE_CHANGES)}
        self.health = copy.deepcopy(HEALTH)
        self.routes = {"/v1/ops": copy.deepcopy(OPS), "/v1/calibration": copy.deepcopy(CALIBRATION),
                       "/v1/source-yield": copy.deepcopy(SOURCE_YIELD), "/v1/left-out": left_out,
                       "/v1/expansion/candidates": self.expansion,
                       # Zenith show (phase 0)
                       "/v1/brief": copy.deepcopy(BRIEF), "/v1/calendar": copy.deepcopy(CALENDAR),
                       "/v1/news-ops": copy.deepcopy(NEWS_OPS), "/v1/recall": copy.deepcopy(RECALL)}
        self.candidates = copy.deepcopy(EXPANSION)
        self.gets, self.posts = [], []
        self.post_status = 200
        self.post_errors: dict[str, tuple[int, str]] = {}
        self.missing: set[str] = set()
        self.old_feed = False  # True: a feed from before round 4, without my_reason
        self.by_ticker: dict[str, list[dict]] | None = None  # /v1/feed?ticker= answers, per ticker

    def get(self, url, headers=None, params=None, timeout=None):
        path = url.removeprefix(API)
        params = dict(params or {})
        self.gets.append((path, params, dict(headers or {})))
        if path in self.missing:
            return Resp({"error": "not found"}, 404)
        if path == "/v1/stats":
            return Resp(self.stats)
        if path == "/v1/source-health":
            return Resp(self.health)
        if path in self.routes:
            route = self.routes[path]
            return Resp(copy.deepcopy(route(params) if callable(route) else route))
        if path == "/v1/feed" and params.get("ticker") and self.by_ticker is not None:
            items = copy.deepcopy(self.by_ticker.get(params["ticker"], []))
        else:
            items = copy.deepcopy(self.items[path])
        if path in ("/v1/feed", "/v1/aux/feed") and not self.old_feed:
            for i in items:
                i.setdefault("my_reason", None)
        if params.get("unlabeled") == "1":
            # Labelled cards leave an unlabeled feed (To label, Unlabeled only), per graded ticker.
            done = {(b["item_id"], b.get("ticker")) for p, b, _ in self.posts if p.endswith("/feedback")}
            items = [i for i in items if (i["item_id"], i.get("grade_ticker") or i.get("ticker")) not in done
                     and not i.get("label")]
        if params.get("sort") == "to_label":
            items = [i for i in items if i.get("state") == "graded"]
        if "min_score" in params:
            # For You (Z13): a card whose latest label is Noise leaves it.
            last = {(b["item_id"], b.get("ticker")): b.get("label") for p, b, _ in self.posts if p.endswith("/feedback")}
            items = [i for i in items if last.get((i["item_id"], i.get("grade_ticker") or i.get("ticker"))) != "noise"]
        return Resp({"items": items, "next_before_id": None})

    def post(self, url, headers=None, json=None, timeout=None):
        path = url.removeprefix(API)
        self.posts.append((path, json, dict(headers or {})))
        if path in self.post_errors:
            status, error = self.post_errors[path]
            return Resp({"error": error}, status)
        if path == "/v1/expansion/decide" and self.post_status < 400:
            # The decided row moves to its new status, as zenith-core moves it.
            for row in self.candidates:
                if row["id"] == json["id"]:
                    row["status"] = EXP_NEXT[json["action"]]
                    row["actions"] = {"approved": ["reject"], "rejected": ["approve"], "pending": ["approve", "reject"]}[row["status"]]
                    row["blocked"] = None
        if path == "/v1/source-prefs" and self.post_status < 400:
            # The saved preference comes back on the next /v1/source-yield.
            for row in self.routes["/v1/source-yield"]["coverage"] + self.routes["/v1/source-yield"]["aux"]:
                if row["source_key"] == json["source_key"]:
                    row["pref"] = None if json["action"] == "normal" else json["action"]
        return Resp({"ok": True} if self.post_status < 400 else {"error": "bad"}, self.post_status)

    def expansion(self, params: dict) -> dict:
        """/v1/expansion/candidates: the rows in one status, plus counts of every status."""
        status = params.get("status", "pending")
        counts = {s: 0 for s in ("pending", "approved", "rejected", "compiled", "known")}
        for r in self.candidates:
            counts[r["status"]] += 1
        rows = [r for r in self.candidates if r["status"] == status][:int(params.get("limit", 50))]
        return {"status": status, "days": 30 if status in ("rejected", "compiled") else None, "limit": 50, "counts": counts,
                "reject_reasons": [v for v, _ in zf.EXP_REASONS], "candidates": rows}

    def feed_calls(self, path: str) -> list[dict]:
        return [p for g, p, _ in self.gets if g == path]


# ---- pure functions -------------------------------------------------------------
class PureFunctions(unittest.TestCase):
    def test_feed_params(self):
        self.assertEqual(zf.feed_params("For You", 70, False), {"min_score": 70})
        self.assertEqual(zf.feed_params("Latest", None, False), {"order": "newest"})
        self.assertEqual(zf.feed_params("Latest", None, True), {"order": "newest", "unlabeled": "1", "state": "graded"})
        self.assertEqual(zf.feed_params("For You", 90, True), {"min_score": 90, "unlabeled": "1", "state": "graded"})

    def test_label_request_coverage(self):
        it = {"item_id": 7, "ticker": "UMAC", "grade_ticker": "RCAT", "grade_id": 55}
        self.assertEqual(zf.label_request(zf.COVERAGE, it, "high"),
                         ("/v1/feedback", {"item_id": 7, "label": "high", "note": None, "ticker": "RCAT", "grade_id": 55}))
        path, body = zf.label_request(zf.COVERAGE, {"item_id": 8, "ticker": "KTOS"}, "low", "why")
        self.assertEqual((path, body), ("/v1/feedback", {"item_id": 8, "label": "low", "note": "why", "ticker": "KTOS"}))

    def test_label_request_auxiliary(self):
        it = {"item_id": 9, "entity": "Anduril", "score": 80}
        self.assertEqual(zf.label_request(zf.AUXILIARY, it, "too_high"), ("/v1/aux/feedback", {"item_id": 9, "label": "too_high"}))
        self.assertEqual(zf.label_request(zf.AUXILIARY, it, "high", "big round"),
                         ("/v1/aux/feedback", {"item_id": 9, "label": "high", "note": "big round"}))

    def test_label_choices(self):
        # Ungraded: the four labels, no directional ones (zenith-core records them with no grade).
        self.assertEqual(zf.label_choices({"band": None}), ["high", "medium", "low", "noise"])
        self.assertEqual(zf.label_choices({"band": None, "score": None}), ["high", "medium", "low", "noise"])
        self.assertEqual(zf.label_choices({"band": "duplicate", "score": None}), ["high", "medium", "low", "noise"])
        self.assertEqual(zf.label_choices({"band": "digest", "score": 75}),
                         ["high", "medium", "low", "noise", "too_high", "too_low"])

    def test_note_toast(self):
        self.assertEqual(zf.note_toast("low", "low"), "Saved")
        self.assertEqual(zf.note_toast(None, "high"), "Saved · Labeled High: pinned to For You")
        self.assertEqual(zf.note_toast("high", "noise"), "Saved · Labeled Noise: removed from For You")

    def test_merge_items(self):
        merged = zf.merge_items([[{"item_id": 1}, {"item_id": 5, "pinned": 1}], [{"item_id": 3}, {"item_id": 1}]])
        self.assertEqual([i["item_id"] for i in merged], [5, 3, 1])

    def test_safe_url(self):
        self.assertTrue(zf.safe_url("https://x.test/a"))
        self.assertTrue(zf.safe_url("http://x.test/a"))
        self.assertFalse(zf.safe_url("javascript:alert(1)"))
        self.assertFalse(zf.safe_url(None))

    def test_read_through_chips(self):
        chips = zf.read_through_chips([{"ticker": "RCAT", "direction": "-"}, {"ticker": "KTOS", "direction": "+"},
                                       {"ticker": "UMAC", "direction": "±"}, {"direction": "+"}, "junk"])
        self.assertIn("→ RCAT −", chips)
        self.assertIn("→ KTOS +", chips)
        self.assertIn("→ UMAC ±", chips)
        self.assertEqual(chips.count("z-chip"), 3)
        self.assertIn("→ RCAT +", zf.read_through_chips('[{"ticker": "RCAT", "direction": "+"}]'))
        self.assertEqual(zf.read_through_chips("not json"), "")
        self.assertIn("&lt;b&gt;", zf.read_through_chips([{"ticker": "<b>", "direction": "<i>"}]))

    def test_card_html_escapes_untrusted_text(self):
        it = {"item_id": 1, "entity": "Evil <img src=x onerror=alert(1)>", "status": "<b>", "band": "lead\" onclick=\"x",
              "score": "<9>", "title": "T <script>x</script>", "url": "https://e.test/?a=\"><script>",
              "why": "W <iframe>", "first_seen": "<now>", "event_date": "<d>",
              "reads_through": [{"ticker": "<RCAT>", "direction": "-"}]}
        out = zf.card_html(zf.AUXILIARY, it)
        for raw in ("<img", "<script>", "<iframe>", "<RCAT>", "<b>", "<9>", "\" onclick", "<now>", "<d>"):
            self.assertNotIn(raw, out)
        self.assertIn('class="z-badge other"', out)  # an unknown band never reaches the class attribute raw
        self.assertIn("Evil &lt;img", out)
        self.assertIn("W &lt;iframe&gt;", out)
        self.assertIn('href="https://e.test/?a=&quot;&gt;&lt;script&gt;"', out)

    def test_card_html_coverage(self):
        out = zf.card_html(zf.COVERAGE, COVERAGE_ITEMS[0])
        self.assertIn('<div class="z-card lead">', out)
        self.assertIn('<b class="z-name">RCAT</b>', out)
        self.assertIn(">Wire<", out)
        self.assertIn("92 · lead", out)
        self.assertIn("also UMAC:71", out)
        self.assertNotIn("z-chip", out)
        dup = zf.card_html(zf.COVERAGE, COVERAGE_ITEMS[1])
        self.assertNotIn("<a ", dup)  # javascript: link is not linked
        self.assertIn('z-badge duplicate">duplicate<', dup)
        pending = zf.card_html(zf.COVERAGE, COVERAGE_ITEMS[2])
        self.assertIn("grading…", pending)

    def test_card_html_auxiliary(self):
        out = zf.card_html(zf.AUXILIARY, AUX_ITEMS[0])
        self.assertIn('<b class="z-name">Anduril &lt;img src=x&gt;</b>', out)
        self.assertIn(">Private<", out)
        self.assertIn("95 · lead", out)
        self.assertIn("→ RCAT −", out)
        self.assertIn("→ KTOS ±", out)
        self.assertIn(">Other<", zf.card_html(zf.AUXILIARY, AUX_ITEMS[1]))

    def test_link_text_headline_and_tag(self):
        it = {"title": "RoboStrategy, Inc. Updates Net Asset Value as of October 31, 2026",
              "headline": "RoboStrategy Portfolio NAV hits $289 million. Up 4.1% in October.", "headline_tag": "Press release"}
        self.assertEqual(zf.link_text(it), "RoboStrategy Portfolio NAV hits $289 million. Up 4.1% in October. - Press release")
        # A filing headline keeps its form tag; stray whitespace and line breaks collapse.
        self.assertEqual(zf.link_text({"title": "Agility Robotics, Inc.: 8-K/A filed 2026-11-13",
                                       "headline": "  Agility Robotics amends its 8-K:\n adds audited financials ",
                                       "headline_tag": "8-K/A"}),
                         "Agility Robotics amends its 8-K: adds audited financials - 8-K/A")
        # zenith-core stores both or neither; a headline alone still shows (no dangling " - ").
        self.assertEqual(zf.link_text({"title": "T", "headline": "Headline only", "headline_tag": None}), "Headline only")

    def test_link_text_without_headline(self):
        self.assertEqual(zf.link_text({"title": "Red Cat wins Army order", "headline": None, "headline_tag": None}),
                         "Red Cat wins Army order")
        self.assertEqual(zf.link_text({"title": "Red Cat wins Army order"}), "Red Cat wins Army order")
        self.assertEqual(zf.link_text({"title": "Kratos  update\n", "headline": "   ", "headline_tag": "News"}), "Kratos update")
        self.assertEqual(zf.link_text({}), "")
        self.assertEqual(zf.link_text({"title": "Agility Robotics, Inc.: 8-K/A filed 2026-11-13"}),
                         "Agility Robotics, Inc.: 8-K/A filed 2026-11-13 - 8-K/A")
        for title, form in [("Red Cat Holdings, Inc.: 10-Q filed 2026-11-12", "10-Q"),
                            ("Kratos: 8-K filed 2026-11-10", "8-K"), ("Acme: SC 13D/A filed 2026-11-01", "SC 13D/A"),
                            ("Acme: NT 10-K filed 2026-03-31", "NT 10-K"), ("Acme: 424B5 filed 2026-11-03", "424B5"),
                            ("Acme: Form 4 filed 2026-11-04", "Form 4"), ("Acme Robotics: D filed 2026-11-05", "D"),
                            # news-monitor's filingTitle: "<company>: <form>[ [Items ...]] filed <date>".
                            ("Aurora Innovation, Inc.: 8-K [Items 7.01, 9.01] filed 2026-08-20", "8-K"),
                            ("Acme: 8-K/A [Items 5.02] filed 2026-11-13", "8-K/A"),
                            ("Satellogic: 8-K filed 2026-11-13 [Items 2.02, 9.01]", "8-K")]:
            self.assertEqual(zf.title_form(title), form, title)
            self.assertEqual(zf.link_text({"title": title}), f"{title} - {form}")
        # Only "<form> filed" counts: a press release that mentions a form gets no tag.
        # The form must sit right after "<company>: ", so prose such as "Series D filed" is not a Form D.
        for title in ("UMAC 8-K", "Red Cat reports Q3 results in its 10-Q", "Form D-style raise filed", "ABC-8-K filed",
                      "Anduril's Series D filed with the SEC", "Acme: Plan C filed in court", "Acme says 8-K filed today",
                      "Acme: 8-K [Items 2.02 filed 2026-11-13"):
            self.assertIsNone(zf.title_form(title), title)
            self.assertEqual(zf.link_text({"title": title}), title)
        self.assertEqual(zf.link_text({"title": "Acme: 8-K filed 2026-11-10 - 8-K"}), "Acme: 8-K filed 2026-11-10 - 8-K")

    def test_card_link_escapes_headline(self):
        it = {"item_id": 1, "ticker": "RCAT", "title": "Original <b>title</b>", "url": "https://e.test/a",
              "headline": "Red Cat <script>alert(1)</script> wins & \"ships\"", "headline_tag": "<i>News</i>",
              "band": "digest", "score": 75}
        out = zf.card_html(zf.COVERAGE, it)
        self.assertIn('rel="noopener noreferrer">Red Cat &lt;script&gt;alert(1)&lt;/script&gt; wins &amp; &quot;ships&quot; - '
                      '&lt;i&gt;News&lt;/i&gt;</a>', out)
        for raw in ("<script>", "<i>", "<b>", "Original"):
            self.assertNotIn(raw, out)  # the original title moves to the Excerpt expander
        # No safe link: the same text, unlinked.
        self.assertIn('<div class="z-title">Red Cat &lt;script&gt;', zf.card_html(zf.COVERAGE, dict(it, url="javascript:x")))
        filing = zf.card_html(zf.COVERAGE, {"item_id": 2, "ticker": "AGIL", "url": "https://sec.test/x",
                                            "title": "Agility Robotics, Inc.: 8-K/A filed 2026-11-13"})
        self.assertIn(">Agility Robotics, Inc.: 8-K/A filed 2026-11-13 - 8-K/A</a>", filing)

    def test_long_headline_wraps_inside_the_card(self):
        word = "A" * 400  # one unbroken run, longer than any card is wide
        headline = " ".join(["Portfolio NAV hits $289 million."] * 10) + " " + word
        out = zf.card_html(zf.AUXILIARY, {"item_id": 3, "entity": "RoboStrategy", "url": "https://e.test/r",
                                          "title": "t", "headline": headline, "headline_tag": "Press release"})
        self.assertIn(f"{headline} - Press release</a>", out)  # shown whole, never cut
        self.assertEqual(out.count('<div class="z-title">'), 1)
        css = (APP / "feed.css").read_text(encoding="utf-8")
        rule = css[css.index(".z-title {"):]
        rule = rule[:rule.index("}")]
        self.assertIn("overflow-wrap: anywhere", rule)  # wraps normally instead of widening the card
        self.assertNotIn("nowrap", rule)
        self.assertNotIn("line-clamp", rule)

    def test_excerpt_lines(self):
        it = {"title": "Original <b>title</b>\nsecond line", "headline": "H", "headline_tag": "News",
              "snippet": "Opening <i>paragraph</i>.", "note_hook": "Hook"}
        self.assertEqual(zf.excerpt_lines(it), ("Excerpt", ["Original: Original <b>title</b> second line", "Note hook: Hook",
                                                           "Opening <i>paragraph</i>."]))
        # A headline with no excerpt still opens the expander, so the original title stays readable.
        self.assertEqual(zf.excerpt_lines({"title": "T", "headline": "H"}), ("Excerpt", ["Original: T"]))
        self.assertEqual(zf.excerpt_lines({"title": "T", "snippet": "S"}), ("Excerpt", ["Original: T", "S"]))
        self.assertEqual(zf.excerpt_lines({"title": "T", "note_hook": "N"}), ("Note hook", ["Note hook: N"]))
        self.assertEqual(zf.excerpt_lines({"title": "T"}), (None, []))
        self.assertEqual(zf.excerpt_lines({"snippet": "S"}), ("Excerpt", ["S"]))

    def test_health_strip_html(self):
        out = zf.health_strip_html(HEALTH)
        self.assertIn("SEC fast path: last 2h ago", out)
        self.assertIn('IR probes: <span class="z-bad">2 failing</span> (<span class="z-bad">SYM events</span>, '
                      '<span class="z-bad">KDK &lt;news&gt;</span>)', out)
        self.assertNotIn("<news>", out)
        ok = zf.health_strip_html({"edgar_fast_path": {"last_match_at": None, "matches_24h": 0, "matches_7d": 0},
                                   "ir_probes": {"checked_at": iso(1), "failing": [], "ok": 27}})
        self.assertIn("SEC fast path: no matches yet · IR probes: all 27 OK", ok)
        self.assertIn("SEC fast path: unavailable · IR probes: unavailable",
                      zf.health_strip_html({"edgar_fast_path": None, "ir_probes": None}))
        self.assertIn("IR probes: no checks yet", zf.health_strip_html({"ir_probes": {"failing": [], "ok": 0}}))
        self.assertIn("last Nov 02", zf.health_strip_html({"edgar_fast_path": {"last_match_at": "2025-11-02T10:00:00Z"}}))
        many = {"ir_probes": {"ok": 1, "failing": [{"key": f"probe_{i}", "label": f"P{i}"} for i in range(6)]}}
        many_out = zf.health_strip_html(many)
        self.assertIn("6 failing", many_out)
        self.assertIn("P3</span>, +2 more)", many_out)
        self.assertNotIn("P4", many_out)

    def test_health_strip_flags_stale_probe_checks(self):
        # Probes run once a day; a check older than 36h means news-monitor stopped probing.
        stale = zf.health_strip_html({"ir_probes": {"checked_at": iso(72), "ok": 25, "failing": []}})
        self.assertIn('IR probes: <span class="z-bad">last checked 3d ago</span>', stale)
        self.assertNotIn("all 25 OK", stale)
        failing = copy.deepcopy(HEALTH)
        failing["ir_probes"]["checked_at"] = iso(40)
        self.assertIn('<span class="z-bad">last checked 1d ago</span>', zf.health_strip_html(failing))
        self.assertNotIn("SYM events", zf.health_strip_html(failing))
        self.assertIn("all 25 OK", zf.health_strip_html({"ir_probes": {"checked_at": iso(30), "ok": 25, "failing": []}}))
        self.assertIn("last checked Nov 02",
                      zf.health_strip_html({"ir_probes": {"checked_at": "2025-11-02T10:00:00Z", "ok": 1, "failing": []}}))

    def test_health_details(self):
        lines = zf.health_details(HEALTH)
        self.assertIn("3 filings matched in 24h, 9 in 7 days", lines[0])
        self.assertTrue(lines[1].startswith("IR probes: 25 OK, 2 failing; last checked 5h ago."))
        self.assertIn("SYM events (probe_sym_ir_events_rss): akamai challenge, HTTP 403, failing as of", lines[2])
        self.assertIn("KDK <news> (probe_kdk_ir_news_rss): timeout <b>", lines[3])  # plain text, shown with st.text
        self.assertEqual(zf.health_details({"edgar_fast_path": None, "ir_probes": None}),
                         ["SEC fast path: no data (edgar_latest_matches unavailable).", "IR probes: no data (probe results unavailable)."])

    def test_site_changes_for(self):
        rows = zf.site_changes_for(SITE_CHANGES, ["RCAT", "AUR", "UMAC", "SYM"])
        self.assertEqual([c["id"] for c in rows], [1, 2, 3])  # notable first, newest first within each group
        self.assertEqual([c["id"] for c in zf.site_changes_for(SITE_CHANGES, ["umac"])], [3])
        self.assertEqual(zf.site_changes_for(SITE_CHANGES, []), [])
        self.assertEqual(zf.site_changes_for([None, "x", {"ticker": None}], ["RCAT"]), [])

    def test_site_change_html_escapes(self):
        out = zf.site_change_html(SITE_CHANGES[1])
        self.assertIn('<div class="z-site notable">', out)
        self.assertIn('<b class="z-name">RCAT</b><span class="z-badge lead">notable</span>', out)
        self.assertIn(">New section<", out)
        self.assertIn("<code>/investor-day/</code>", out)
        self.assertIn("&lt;script&gt;", out)
        self.assertNotIn("<script>", out)
        evil = zf.site_change_html({"ticker": "<i>", "kind": "<b>", "section": "<s>", "detail": "<u>", "detected_at": "<d>"})
        for raw in ("<i>", "<b>", "<s>", "<u>", "<d>"):
            self.assertNotIn(raw, evil)
        self.assertNotIn("notable", evil)

    def test_filter_options(self):
        self.assertEqual(zf.filter_options(zf.COVERAGE, STATS), (["RCAT", "UMAC", "KTOS"], {}))
        self.assertEqual(zf.filter_options(zf.AUXILIARY, STATS), (["Anduril", "Skydio"], {"Anduril": 5, "Skydio": 2}))
        self.assertEqual(zf.filter_options(zf.AUXILIARY, {"tickers": ["RCAT"]}), ([], {}))


# ---- the app --------------------------------------------------------------------
class AppBase(unittest.TestCase):
    """The app under AppTest, against FakeApi."""

    def setUp(self):
        self.api = FakeApi()
        patches = [mock.patch("requests.get", self.api.get), mock.patch("requests.post", self.api.post)]
        for p in patches:
            p.start()
            self.addCleanup(p.stop)
        zf.get_json.clear()
        self.at = AppTest.from_file(str(APP / "streamlit_app.py"), default_timeout=60)
        self.at.secrets["ZENITH_API"] = API
        self.at.secrets["ZENITH_APP_TOKEN"] = TOKEN

    def run_app(self):
        self.at.run()
        self.assertFalse(self.at.exception, [e.value for e in self.at.exception])
        return self.at

    def open_aux(self):
        self.run_app()
        self.at.switch_page("views/auxiliary.py")
        return self.run_app()

    def cards(self) -> list[str]:
        return [m.value for m in self.at.markdown if 'class="z-card' in m.value]

    def metrics(self) -> dict:
        return {m.label: m.value for m in self.at.sidebar.metric}

    def page_text(self) -> str:
        return "\n".join(m.value for m in self.at.markdown)


class AppPages(AppBase):
    # coverage ------------------------------------------------------------------
    def test_missing_secrets_stop_the_app(self):
        at = AppTest.from_file(str(APP / "streamlit_app.py"), default_timeout=60)
        with mock.patch.dict("os.environ", {"ZENITH_API": "", "ZENITH_APP_TOKEN": ""}):
            at.run()
        self.assertIn("ZENITH_API", at.error[0].value)
        self.assertEqual(self.api.gets, [])

    def test_coverage_is_the_default_page_for_you(self):
        self.run_app()
        self.assertIn("#### Coverage Universe", self.page_text())
        self.assertEqual(self.at.segmented_control(key="cov-mode").value, "For You")
        self.assertEqual(self.api.feed_calls("/v1/feed"), [{"min_score": 70, "limit": 40}])
        self.assertEqual(self.api.feed_calls("/v1/aux/feed"), [])
        path, _, headers = self.api.gets[0]
        self.assertEqual((path, headers["authorization"]), ("/v1/stats", f"Bearer {TOKEN}"))
        cards = self.cards()
        self.assertEqual(len(cards), 3)
        self.assertIn("&lt;script&gt;", cards[0])
        self.assertNotIn("<script>", self.page_text().split("</style>")[-1])
        self.assertEqual(self.at.multiselect(key="cov-filter").options, ["RCAT", "UMAC", "KTOS"])
        # Windows Application Control blocks pandas' DLLs on the dev machine.
        self.assertNotIn("pandas", sys.modules)
        self.assertEqual(self.metrics(), {"Graded": "10", "Waiting": "2", "Lead": "1", "Your labels": "4"})

    def test_coverage_shows_source_health_and_site_changes(self):
        self.run_app()
        text = self.page_text()
        self.assertIn("SEC fast path: last 2h ago", text)
        self.assertIn('<span class="z-bad">SYM events</span>', text)
        self.assertIn("KDK &lt;news&gt;", text)
        self.assertIn("SYM events (probe_sym_ir_events_rss): akamai challenge, HTTP 403", "\n".join(t.value for t in self.at.text))
        self.assertEqual([g for g, _, _ in self.api.gets if g in ("/v1/source-health", "/v1/site-changes")],
                         ["/v1/source-health", "/v1/site-changes"])
        # The shown companies go to the server, so one site's burst cannot crowd them out of the 50.
        self.assertEqual(self.api.feed_calls("/v1/site-changes"), [{"days": 14, "limit": 50, "tickers": "KTOS,RCAT,UMAC"}])
        exp = [e for e in self.at.expander if e.label.startswith("Site changes")]
        self.assertEqual([e.label for e in exp], ["Site changes · last 14 days (2) · 1 notable"])  # RCAT and UMAC are shown
        sites = [m.value for m in self.at.markdown if 'class="z-site' in m.value]
        self.assertEqual(len(sites), 2)
        self.assertIn(">RCAT<", sites[0])  # the notable one first
        self.assertIn(">UMAC<", sites[1])
        self.assertNotIn("<script>", text.split("</style>")[-1])

    def test_site_changes_follow_the_companies_filter(self):
        self.api.stats["tickers"] = ["RCAT", "UMAC", "AUR"]
        self.run_app()
        self.assertIn("Site changes · last 14 days (3) · 2 notable", [e.label for e in self.at.expander])
        self.at.multiselect(key="cov-filter").set_value(["UMAC"])
        self.run_app()
        self.assertIn("Site changes · last 14 days (1)", [e.label for e in self.at.expander])
        self.assertEqual(self.api.feed_calls("/v1/site-changes")[-1]["tickers"], "UMAC")
        self.api.items["/v1/site-changes"] = []
        zf.get_json.clear()
        self.run_app()
        self.assertIn("No site structure changes for these companies in the last 14 days.", [c.value for c in self.at.caption])

    def test_coverage_before_the_signal_routes_exist(self):
        self.api.missing.update({"/v1/source-health", "/v1/site-changes"})
        self.run_app()
        self.assertIn("Source health unavailable", [c.value for c in self.at.caption])
        self.assertFalse([e for e in self.at.expander if e.label.startswith("Site changes")])
        self.assertEqual(len(self.cards()), 3)

    def test_latest_switch_changes_params(self):
        self.run_app()
        self.at.segmented_control(key="cov-mode").set_value("Latest")
        self.run_app()
        self.assertEqual(self.api.feed_calls("/v1/feed")[-1], {"order": "newest", "limit": 40})
        self.assertEqual(len(self.at.select_slider), 0)  # Signal is a For You setting
        self.assertIn("grading…", self.cards()[2])

    def test_signal_sets_min_score(self):
        self.run_app()
        self.at.select_slider(key="cov-signal").set_value(90)
        self.run_app()
        self.assertEqual(self.api.feed_calls("/v1/feed")[-1], {"min_score": 90, "limit": 40})

    def test_unlabeled_only_toggle(self):
        self.run_app()
        self.at.toggle(key="cov-unlabeled").set_value(True)
        self.run_app()
        self.assertEqual(self.api.feed_calls("/v1/feed")[-1], {"min_score": 70, "unlabeled": "1", "state": "graded", "limit": 40})

    def test_companies_filter_passes_ticker(self):
        self.run_app()
        self.at.multiselect(key="cov-filter").set_value(["RCAT", "KTOS"])
        self.run_app()
        calls = self.api.feed_calls("/v1/feed")[-2:]
        self.assertEqual(calls, [{"min_score": 70, "limit": 40, "ticker": "RCAT"}, {"min_score": 70, "limit": 40, "ticker": "KTOS"}])
        self.assertEqual(len(self.cards()), 3)  # the same items from both calls show once

    def test_label_posts_coverage_feedback(self):
        self.run_app()
        self.at.segmented_control(key="cov-lbl-11-RCAT").set_value("high")
        self.run_app()
        self.assertEqual(len(self.api.posts), 1)
        path, body, headers = self.api.posts[0]
        self.assertEqual(path, "/v1/feedback")
        self.assertEqual(body, {"item_id": 11, "label": "high", "note": None, "ticker": "RCAT", "grade_id": 101})
        self.assertEqual(headers["authorization"], f"Bearer {TOKEN}")
        self.assertEqual([t.value for t in self.at.toast], ["Labeled High: pinned to For You"])

    def test_label_control_shows_server_label_and_directional_only_when_scored(self):
        self.run_app()
        scored = self.at.segmented_control(key="cov-lbl-11-RCAT")
        self.assertEqual(scored.options, ["High", "Medium", "Low", "Noise", "Too high", "Too low"])
        dup = self.at.segmented_control(key="cov-lbl-10-UMAC")
        self.assertEqual(dup.options, ["High", "Medium", "Low", "Noise"])
        self.assertEqual(dup.value, "noise")
        # The pending card keeps its "grading…" badge and offers the four labels, no directional ones.
        self.assertIn("grading…", self.cards()[2])
        self.assertEqual(self.at.segmented_control(key="cov-lbl-9-KTOS").options, ["High", "Medium", "Low", "Noise"])
        self.assertEqual(len(self.at.segmented_control), 4)  # mode switch + three cards

    def test_failed_label_is_reported_and_reverted(self):
        self.api.post_status = 400
        self.run_app()
        self.at.segmented_control(key="cov-lbl-11-RCAT").set_value("too_low")
        self.run_app()
        self.assertEqual(self.at.toast[0].value, "Label not saved: bad")
        self.assertIsNone(self.at.segmented_control(key="cov-lbl-11-RCAT").value)

    def test_note_popover_posts_label_and_note(self):
        self.run_app()
        self.at.text_area(key="cov-lbl-11-RCAT:note").input("Sole-source; moves FY27 numbers")
        self.at.radio(key="cov-lbl-11-RCAT:nl").set_value("medium")
        self.run_app()  # picking a label reruns the card, which enables Save
        self.at.button(key="cov-lbl-11-RCAT:save").click()
        self.run_app()
        self.assertEqual(self.api.posts[-1][:2], ("/v1/feedback", {"item_id": 11, "label": "medium",
                                                                  "note": "Sole-source; moves FY27 numbers",
                                                                  "ticker": "RCAT", "grade_id": 101}))
        self.assertEqual([t.value for t in self.at.toast], ["Saved · Labeled Medium: the grader will learn from it"])

    def test_note_on_an_unlabeled_card_needs_a_label(self):
        # Review finding: the radio defaulted to High, so a note silently labelled (and pinned) the card.
        self.run_app()
        self.assertIsNone(self.at.radio(key="cov-lbl-11-RCAT:nl").value)
        self.assertTrue(self.at.button(key="cov-lbl-11-RCAT:save").disabled)
        self.assertIsNone(self.at.radio(key="cov-lbl-9-KTOS:nl").value)  # the pending card too
        self.at.text_area(key="cov-lbl-11-RCAT:note").input("Sole-source")
        self.run_app()
        self.assertTrue(self.at.button(key="cov-lbl-11-RCAT:save").disabled)
        self.assertEqual(self.api.posts, [])
        self.at.radio(key="cov-lbl-11-RCAT:nl").set_value("high")
        self.run_app()
        self.assertFalse(self.at.button(key="cov-lbl-11-RCAT:save").disabled)
        self.at.button(key="cov-lbl-11-RCAT:save").click()
        self.run_app()
        self.assertEqual(self.api.posts[-1][1]["label"], "high")
        self.assertEqual([t.value for t in self.at.toast], ["Saved · Labeled High: pinned to For You"])

    def test_note_on_a_labelled_card_keeps_its_label(self):
        self.run_app()
        self.assertEqual(self.at.radio(key="cov-lbl-10-UMAC:nl").value, "noise")
        self.assertFalse(self.at.button(key="cov-lbl-10-UMAC:save").disabled)
        self.at.text_area(key="cov-lbl-10-UMAC:note").input("Same award")
        self.at.button(key="cov-lbl-10-UMAC:save").click()
        self.run_app()
        self.assertEqual(self.api.posts[-1][1]["label"], "noise")
        self.assertEqual([t.value for t in self.at.toast], ["Saved"])

    def test_for_you_keeps_a_card_labelled_noise_for_its_reason(self):
        # Review finding: Noise in For You removed the card on the next rerun, with its reason picker.
        self.run_app()
        self.at.segmented_control(key="cov-lbl-11-RCAT").set_value("noise")
        self.run_app()
        self.assertEqual([t.value for t in self.at.toast], ["Labeled Noise: removed from For You"])
        self.assertNotIn(11, [i["item_id"] for i in self.api.get(API + "/v1/feed", params={"min_score": 70}).json()["items"]])
        self.assertEqual(len(self.cards()), 3)  # still on screen, in its place (pinned, first)
        self.assertEqual(self.at.segmented_control(key="cov-lbl-11-RCAT").value, "noise")
        self.assertIn("Removed from For You", " ".join(c.value for c in self.at.main.caption))
        self.assertEqual([w.key for w in self.at.segmented_control if w.key.startswith("cov-lbl-")][0], "cov-lbl-11-RCAT")
        self.at.selectbox(key="cov-lbl-11-RCAT:rsn-down").set_value("marketing")
        self.run_app()
        self.assertEqual(self.api.posts[-1][1], {"item_id": 11, "label": "noise", "note": None, "ticker": "RCAT",
                                                 "grade_id": 101, "reason": "marketing"})
        self.assertEqual(self.at.selectbox(key="cov-lbl-11-RCAT:rsn-down").value, "marketing")
        # A new Signal floor starts the list again: the card is gone.
        self.at.select_slider(key="cov-signal").set_value(60)
        self.run_app()
        self.assertEqual(len(self.cards()), 2)
        self.assertNotIn("Removed from For You", " ".join(c.value for c in self.at.main.caption))

    def test_load_more_raises_the_limit(self):
        self.api.items["/v1/feed"] = [dict(COVERAGE_ITEMS[0], item_id=i, label=None) for i in range(40, 0, -1)]
        self.run_app()
        self.at.button(key="cov-more").click()
        self.run_app()
        self.assertEqual(self.api.feed_calls("/v1/feed")[-1], {"min_score": 70, "limit": 80})

    def excerpts(self) -> list[list[str]]:
        return [[t.value for t in e.text] for e in self.at.expander if e.label == "Excerpt"]

    def test_coverage_cards_show_headlines(self):
        self.api.items["/v1/feed"][0].update(headline="Red Cat wins $20M <b>Army</b> SRR order", headline_tag="Press release")
        self.api.items["/v1/feed"][1].update(title="Unusual Machines, Inc.: 8-K/A filed 2026-11-13", headline=None,
                                             headline_tag=None)
        self.run_app()
        cards = self.cards()
        self.assertIn(">Red Cat wins $20M &lt;b&gt;Army&lt;/b&gt; SRR order - Press release</a>", cards[0])
        self.assertNotIn("Red Cat wins &lt;script&gt;", cards[0])
        self.assertIn('<div class="z-title">Unusual Machines, Inc.: 8-K/A filed 2026-11-13 - 8-K/A</div>', cards[1])
        self.assertIn(">Kratos update</a>", cards[2])
        self.assertNotIn("<b>Army", self.page_text().split("</style>")[-1])
        # The original title is the Excerpt's first line, as plain text.
        self.assertEqual(self.excerpts(), [["Original: Red Cat wins <script>alert(1)</script> Army order", "Opening paragraph."]])

    def test_auxiliary_cards_show_headlines(self):
        self.api.items["/v1/aux/feed"][0].update(headline="Anduril raises $2.5B Series G at $30.5B valuation",
                                                 headline_tag="News")
        self.api.items["/v1/aux/feed"][1].update(headline="Waymo expands <robotaxi> service to Miami", headline_tag="Blog")
        self.open_aux()
        cards = self.cards()
        self.assertIn(">Anduril raises $2.5B Series G at $30.5B valuation - News</a>", cards[0])
        self.assertIn(">Waymo expands &lt;robotaxi&gt; service to Miami - Blog</a>", cards[1])
        self.assertEqual(self.excerpts(), [["Original: Anduril raises $2.5B", "Anduril today announced..."],
                                           ["Original: Waymo pending item"]])

    # auxiliary -----------------------------------------------------------------
    def test_auxiliary_page_renders(self):
        self.open_aux()
        self.assertIn("#### Auxiliary Names", self.page_text())
        self.assertEqual(self.api.feed_calls("/v1/aux/feed"), [{"min_score": 70, "limit": 40}])
        cards = self.cards()
        self.assertEqual(len(cards), 2)
        self.assertIn("Anduril &lt;img src=x&gt;", cards[0])
        self.assertIn("→ RCAT −", cards[0])
        self.assertIn(">Private<", cards[0])
        self.assertIn("grading…", cards[1])
        self.assertEqual(self.at.multiselect(key="aux-filter").options, ["Anduril (5)", "Skydio (2)"])
        self.assertEqual(self.metrics(), {"Graded": "7", "Waiting": "1", "Lead": "2", "Names": "2"})
        # Source health and site changes are Coverage-page only.
        self.assertNotIn("SEC fast path", self.page_text())
        self.assertFalse([e for e in self.at.expander if e.label.startswith("Site changes")])

    def test_auxiliary_latest_and_unlabeled(self):
        self.open_aux()
        self.at.segmented_control(key="aux-mode").set_value("Latest")
        self.run_app()
        self.assertEqual(self.api.feed_calls("/v1/aux/feed")[-1], {"order": "newest", "limit": 40})
        self.at.toggle(key="aux-unlabeled").set_value(True)
        self.run_app()
        self.assertEqual(self.api.feed_calls("/v1/aux/feed")[-1], {"order": "newest", "unlabeled": "1", "state": "graded", "limit": 40})

    def test_auxiliary_names_filter_passes_entity(self):
        self.open_aux()
        self.at.multiselect(key="aux-filter").set_value(["Anduril"])
        self.run_app()
        self.assertEqual(self.api.feed_calls("/v1/aux/feed")[-1], {"min_score": 70, "limit": 40, "entity": "Anduril"})

    def test_auxiliary_label_posts_aux_feedback(self):
        self.open_aux()
        key = "aux-lbl-501"
        self.assertEqual(self.at.segmented_control(key=key).options, ["High", "Medium", "Low", "Noise", "Too high", "Too low"])
        self.at.segmented_control(key=key).set_value("too_high")
        self.run_app()
        self.assertEqual([p[:2] for p in self.api.posts], [("/v1/aux/feedback", {"item_id": 501, "label": "too_high"})])
        self.assertEqual(self.api.feed_calls("/v1/feed"), [{"min_score": 70, "limit": 40}])  # only the first page load

    def test_auxiliary_note_posts_to_aux_feedback(self):
        self.open_aux()
        self.at.text_area(key="aux-lbl-501:note").input("Raises the bar for RCAT's next round")
        self.at.radio(key="aux-lbl-501:nl").set_value("high")
        self.run_app()  # picking a label reruns the card, which enables Save
        self.at.button(key="aux-lbl-501:save").click()
        self.run_app()
        self.assertEqual(self.api.posts[-1][:2], ("/v1/aux/feedback", {"item_id": 501, "label": "high",
                                                                      "note": "Raises the bar for RCAT's next round"}))
        # The pending auxiliary card has a label control too, without the directional labels.
        self.assertEqual([w.key for w in self.at.segmented_control], ["aux-mode", "aux-lbl-501", "aux-lbl-500"])
        self.assertEqual(self.at.segmented_control(key="aux-lbl-500").options, ["High", "Medium", "Low", "Noise"])

    def test_auxiliary_page_before_the_aux_api_exists(self):
        del self.api.stats["aux"]
        self.api.missing.add("/v1/aux/feed")
        self.open_aux()
        self.assertIn("Auxiliary Names feed unavailable", self.at.warning[0].value)
        self.assertEqual(self.at.multiselect(key="aux-filter").options, [])
        self.assertIn("No auxiliary ingest yet", [c.value for c in self.at.sidebar.caption])

    def test_settings_are_kept_per_page(self):
        self.run_app()
        self.at.segmented_control(key="cov-mode").set_value("Latest")
        self.run_app()
        self.at.switch_page("views/auxiliary.py")
        self.run_app()
        self.assertEqual(self.at.segmented_control(key="aux-mode").value, "For You")
        self.at.switch_page("views/coverage.py")
        self.run_app()
        self.assertEqual(self.at.segmented_control(key="cov-mode").value, "Latest")
        self.assertEqual(self.api.feed_calls("/v1/feed")[-1], {"order": "newest", "limit": 40})


# ---- round 4: grader health, Tuning, reasons, To label (pure) ------------------------
def css_rule(selector: str) -> str:
    css = (APP / "feed.css").read_text(encoding="utf-8")
    rule = css[css.index(selector):]
    return rule[:rule.index("}")]


class TuningFunctions(unittest.TestCase):
    def test_to_label_feed_params(self):
        want = {"sort": "to_label", "unlabeled": "1", "state": "graded"}
        self.assertEqual(zf.feed_params("To label", None, False), want)  # Unlabeled only is implied
        self.assertEqual(zf.feed_params("To label", 70, True), want)  # no Signal floor
        self.assertEqual(zf.MODES, ("For You", "Latest", "To label"))

    def test_to_label_order(self):
        items = [{"item_id": 1, "score": 95, "confidence": 0.9}, {"item_id": 2, "score": 40, "confidence": 0.5},
                 {"item_id": 3, "score": 72, "confidence": 0.8}, {"item_id": 4, "score": 69, "confidence": 0.7},
                 {"item_id": 5, "score": 61, "confidence": None}, {"item_id": 6, "score": 85}, {"item_id": 7, "score": None},
                 {"item_id": 8, "score": 79, "confidence": 0.59}]
        ordered = [i["item_id"] for i in sorted(items, key=zf.to_label_key)]
        # Confidence < 0.6 first; then 60-79 nearest 70; then the rest; score desc within each step.
        self.assertEqual(ordered, [8, 2, 4, 3, 5, 1, 6, 7])
        merged = zf.merge_items([[items[0], items[2]], [items[1], items[0]]], "to_label")
        self.assertEqual([i["item_id"] for i in merged], [2, 3, 1])
        # The other sorts keep pinned Leads first, then newest.
        self.assertEqual([i["item_id"] for i in zf.merge_items([[items[0], items[2]], [items[1]]])], [3, 2, 1])

    def test_to_label_order_breaks_ties_like_the_server(self):
        # TO_LABEL_ORDER: step, distance from 70, score DESC, then id DESC.
        low = [[{"item_id": 5, "confidence": 0.5, "score": 50}, {"item_id": 4, "confidence": 0.5, "score": 30}],
               [{"item_id": 3, "confidence": 0.4, "score": 95}]]
        self.assertEqual([i["item_id"] for i in zf.merge_items(low, "to_label")], [3, 5, 4])
        near = [[{"item_id": 5, "score": 65}], [{"item_id": 3, "score": 75}]]
        self.assertEqual([i["item_id"] for i in zf.merge_items(near, "to_label")], [3, 5])
        same = [[{"item_id": 6, "score": 85}], [{"item_id": 9, "score": 85}, {"item_id": 7, "score": None}]]
        self.assertEqual([i["item_id"] for i in zf.merge_items(same, "to_label")], [9, 6, 7])

    def test_reason_choices(self):
        down = ["not_material", "duplicate", "wrong_company", "stale", "marketing", "not_my_focus"]
        for label in ("low", "noise", "too_high"):
            self.assertEqual(zf.reason_choices(label), down, label)
        for label in ("high", "too_low"):
            self.assertEqual(zf.reason_choices(label), ["missed_detail"], label)
        for label in ("medium", None, "junk"):
            self.assertEqual(zf.reason_choices(label), [], label)
        self.assertEqual([zf.REASON_TEXT[r] for r in down],
                         ["Not material", "Duplicate", "Wrong company", "Stale", "Marketing", "Not my focus"])
        self.assertEqual(zf.REASON_TEXT["missed_detail"], "Missed detail")

    def test_label_request_with_reason(self):
        it = {"item_id": 7, "ticker": "RCAT", "grade_id": 55}
        self.assertEqual(zf.label_request(zf.COVERAGE, it, "noise", None, "stale"),
                         ("/v1/feedback", {"item_id": 7, "label": "noise", "note": None, "ticker": "RCAT", "grade_id": 55,
                                           "reason": "stale"}))
        self.assertEqual(zf.label_request(zf.AUXILIARY, {"item_id": 9}, "too_low", "n", "missed_detail"),
                         ("/v1/aux/feedback", {"item_id": 9, "label": "too_low", "note": "n", "reason": "missed_detail"}))
        self.assertNotIn("reason", zf.label_request(zf.AUXILIARY, {"item_id": 9}, "high")[1])

    def test_card_reason(self):
        self.assertEqual(zf.card_reason({"my_reason": "stale"}), "stale")
        self.assertIsNone(zf.card_reason({"my_reason": "<b>"}))
        self.assertIsNone(zf.card_reason({}))  # an older zenith-core has no my_reason

    def test_time_texts(self):
        self.assertEqual(zf.run_ago(iso(0.2)), "12 min ago")
        self.assertEqual(zf.run_ago(iso(3)), "3h ago")
        self.assertEqual(zf.day_text("2026-11-09T10:00:00Z"), "Nov 9")
        self.assertEqual(zf.utc_text("2026-11-23T08:11:00Z"), "Nov 23 08:11 UTC")
        self.assertEqual(zf.utc_text("2026-11-23T03:11:00-05:00"), "Nov 23 08:11 UTC")
        self.assertEqual(zf.utc_text("junk"), "junk")
        self.assertEqual(zf.day_text(None), "")

    def test_grader_strip_html(self):
        self.assertEqual(zf.grader_strip_html(OPS),
                         '<div class="z-health">Grader: last run 12 min ago · Aux backlog 96 (oldest Nov 9) · '
                         'Headlines waiting 239</div>')
        for status in ("late", "down"):
            ops = copy.deepcopy(OPS)
            ops["grader"].update(status=status, last_run_at=iso(2))
            self.assertIn(f'Grader: <span class="z-bad">{status} · last run 2h ago</span> · Aux backlog 96', zf.grader_strip_html(ops))
        never = zf.grader_strip_html({"grader": {"status": "down"}})
        self.assertEqual(never, '<div class="z-health">Grader: <span class="z-bad">down · no runs yet</span></div>')
        # Missing or junk backlog fields read as 0; no "oldest" without a backlog.
        sparse = zf.grader_strip_html({"grader": {"status": "ok", "last_run_at": iso(1),
                                                  "backlog": {"aux_pending": None, "oldest_aux_pending_at": "2026-11-09T10:00:00Z"}}})
        self.assertIn("Aux backlog 0 · Headlines waiting 0", sparse)
        self.assertNotIn("oldest", sparse)
        self.assertNotIn("z-bad", sparse)
        self.assertNotIn("<x>", zf.grader_strip_html({"grader": {"status": "<x>", "backlog": {"aux_pending": 1,
                                                                                              "oldest_aux_pending_at": "<x>"}}}))
        for junk in (None, {}, {"grader": "x"}, []):
            self.assertEqual(zf.grader_strip_html(junk), '<div class="z-health">Grader: not available yet</div>')

    def test_gap_lines_and_details(self):
        lines = zf.gap_lines(OPS)
        self.assertEqual(lines[:3], ["Missed grader runs, last 7 days: 2.",
                                     "  Nov 23 08:11 UTC to Nov 23 14:05 UTC (5.9 h)", "  Nov 20 01:00 UTC to Nov 20 04:00 UTC (3 h)"])
        self.assertIn("usage limit refused a scheduled grader run", lines[-1])
        self.assertEqual(zf.gap_lines({"grader": {"gaps_7d": None}})[0], "No missed grader runs in the last 7 days.")
        self.assertIn("not available yet", zf.gap_lines({})[0])
        details = zf.grader_details(OPS)
        self.assertTrue(details[0].startswith("Status: ok. Last run "))
        self.assertIn("Last run: claimed 12, graded 11.", details)
        self.assertIn("Runs in the last 24 h: 18.", details)
        self.assertIn("Backlog: 4 coverage items pending, 96 auxiliary pending (oldest first seen Nov 9 10:00 UTC), "
                      "239 graded cards waiting for a headline.", details)
        self.assertIn("Check grader_stale: ok", details)  # an ok check's detail is not shown
        self.assertIn("Check queue_stale: fail. 3 covered items waiting <b>over</b> 75 min", details)  # plain text (st.text)
        self.assertEqual(zf.grader_details({"grader": {}}), ["Status: unknown. No grader run recorded."])

    # Phase 2 (PR-C6): one golden-replay line from ops.replay. Synthetic values only.
    def replay_lines(self, replay=..., **grader):
        ops = {"grader": dict(grader)}
        if replay is not ...:
            ops["replay"] = replay
        return [x for x in zf.grader_details(ops) if "replay" in x.lower()]

    def test_replay_line_absent_without_a_replay(self):
        self.assertEqual(self.replay_lines(), [])  # an older zenith-core: no "replay" key
        self.assertEqual(self.replay_lines(None), [])  # before migration 0018
        self.assertEqual(self.replay_lines({"armed": None, "last": None}), [])  # nothing armed or finished yet
        self.assertEqual(self.replay_lines({}), [])
        for junk in ("x", [], 3, {"armed": "x", "last": []}):
            self.assertEqual(self.replay_lines(junk), [])
        self.assertEqual([x for x in zf.grader_details(OPS) if "replay" in x.lower()], [])
        # Whole output, not only lines naming "replay": a null, empty or junk replay adds,
        # drops and changes nothing anywhere in the details.
        self.assertNotIn("replay", OPS)
        for base in (OPS, {"grader": {}}):
            want = zf.grader_details(base)
            for replay in (None, {}, {"armed": None, "last": None}, "x", [], 3, {"armed": "x", "last": []}):
                ops = copy.deepcopy(base)
                ops["replay"] = replay
                self.assertEqual(zf.grader_details(ops), want, replay)

    def test_replay_line_while_armed(self):
        armed = {"kind": "baseline", "scope": "full", "rubric_version": "r-test0000", "n_graded": 7, "n_items": 40}
        self.assertEqual(self.replay_lines({"armed": armed, "last": None}),
                         ["Golden replay armed: baseline r-test0000 (scope full), 7/40 graded."])
        # Armed wins over an older finished replay: still one line.
        last = {"kind": "baseline", "status": "done", "finished_at": "2026-11-20T10:00:00Z", "verdict": "done"}
        self.assertEqual(len(self.replay_lines({"armed": armed, "last": last})), 1)
        # Missing keys do not raise.
        self.assertEqual(self.replay_lines({"armed": {}}), ["Golden replay armed: ?."])
        self.assertEqual(self.replay_lines({"armed": {"kind": "candidate", "n_items": 12}}),
                         ["Golden replay armed: candidate, 0/12 graded."])

    def test_replay_line_after_a_replay(self):
        last = {"kind": "candidate", "status": "failed", "finished_at": "2026-11-20T10:00:00Z", "verdict": "failed"}
        self.assertEqual(self.replay_lines({"armed": None, "last": last}),
                         ["Last golden replay: candidate, failed (finished Nov 20 10:00 UTC)."])
        # No verdict (an aborted row may have none): the status stands in; missing keys do not raise.
        self.assertEqual(self.replay_lines({"last": {"kind": "baseline", "status": "aborted"}}),
                         ["Last golden replay: baseline, aborted."])
        self.assertEqual(self.replay_lines({"last": {}}), ["Last golden replay: ?, unknown."])

    def test_replay_line_names_no_item_code(self):
        # Even if a future zenith-core added per-item fields, only kind, scope, version and counts show.
        armed = {"kind": "candidate", "scope": "targets", "n_graded": 1, "n_items": 2,
                 "code": "Z-TEST1", "reasons": ["Z-TEST2 missed"], "misses": ["Z-TEST3"]}
        last = {"kind": "baseline", "verdict": "passed", "regressions": ["Z-TEST4"]}
        for replay in ({"armed": armed}, {"last": last}):
            line = " ".join(self.replay_lines(replay))
            self.assertNotIn("Z-TEST", line)

    def test_calibration_parts(self):
        cov, aux, reasons = zf.calibration_parts(CALIBRATION)
        self.assertEqual((cov["all_time"]["n"], aux["all_time"]["n"], reasons["stale"]), (10, 2, 3))
        # An older zenith-core: the coverage report alone, at the top level.
        old = copy.deepcopy(CALIBRATION["coverage"])
        self.assertEqual(zf.calibration_parts(old), (old, None, {}))
        self.assertEqual(zf.calibration_parts(None), (None, None, {}))
        self.assertEqual(zf.calibration_parts({"coverage": "x", "aux": None, "reasons": []}), (None, None, {}))

    def test_calibration_tables(self):
        cov, aux, reasons = zf.calibration_parts(CALIBRATION)
        self.assertEqual(zf.calibration_rows(cov, aux), [["Coverage", 10, "60% of 10", 3, 1, "67% of 3"],
                                                         ["Auxiliary", 2, "50% of 2", 0, 1, "n/a"]])
        self.assertEqual(zf.calibration_rows(cov, None)[1], ["Auxiliary", "not available yet", "", "", "", ""])
        self.assertEqual(zf.calibration_misses(cov, aux), [
            ["Coverage", "RCAT", 92, "Low", "graded too high", "Red Cat <b>wins</b> order"],
            ["Auxiliary", "Anduril", 55, "High", "graded too low", "Anduril raises"]])
        many = {"misses": [{"ticker": "X", "score": None, "label": "noise", "verdict": "too_high"}] * 7}
        self.assertEqual(len(zf.calibration_misses(many, None)), 5)
        self.assertEqual(zf.calibration_misses(many, None)[0][2], "dup")
        self.assertEqual(zf.reason_rows(reasons), [["Stale", 3], ["Missed detail", 1]])
        self.assertFalse(zf.calibration_empty(cov, aux, reasons))
        self.assertTrue(zf.calibration_empty({"all_time": summary(0, 0, 0, 0)}, None, {"stale": 0}))
        self.assertFalse(zf.calibration_empty(None, None, {"stale": 1}))

    def test_html_table_escapes(self):
        out = zf.html_table(["<h>", "T"], [["<td>", "Red <b>x</b>"]], wrap=1)
        self.assertIn("<th>&lt;h&gt;</th>", out)
        self.assertIn("<td>&lt;td&gt;</td><td class=\"wrap\">Red &lt;b&gt;x&lt;/b&gt;</td>", out)
        self.assertTrue(out.startswith('<div class="z-scroll">'))

    def test_source_yield_rows(self):
        rows = zf.yield_rows(SOURCE_YIELD["aux"] + [None, {"graded": 3}])
        self.assertEqual([r["source_key"] for r in rows], ["google_suncatcher", "tfvector", "anduril"])  # suggested first
        self.assertEqual([zf.pref_of(r) for r in rows], ["demote", "mute", "normal"])
        self.assertEqual(zf.pref_of({"pref": {"action": "mute"}}), "mute")
        self.assertEqual(zf.pref_of({"pref": "junk"}), "normal")
        self.assertIsNone(zf.suggest_of({"suggest": "delete"}))
        aux = zf.yield_line_html(SOURCE_YIELD["aux"][1], "aux")
        self.assertIn('<b class="z-name">google_suncatcher</b><span class="z-badge lead">suggested: mute</span>', aux)
        self.assertIn("graded 25 · high 0 · reject 24 · duplicate 0 · covered 1 · no high yet", aux)
        cov = zf.yield_line_html(SOURCE_YIELD["coverage"][0], "coverage")
        self.assertIn("graded 30 · high 12 · reject 5 · duplicate 2 · last high Nov 21", cov)
        self.assertNotIn("covered", cov)
        self.assertNotIn("suggested", cov)
        evil = zf.yield_line_html({"source_key": "<k>", "graded": "<g>", "last_high_at": "<d>"}, "aux")
        for raw in ("<k>", "<g>", "<d>"):
            self.assertNotIn(raw, evil)
        self.assertEqual(zf.widget_slug("ia_<x> y"), "ia__x__y")
        # One row per widget key: a repeated key, or two that slug alike, keep the first.
        twins = zf.yield_rows([{"source_key": "a.b", "graded": 1}, {"source_key": "a_b", "graded": 2},
                               {"source_key": "c"}, {"source_key": "a.b", "graded": 3}])
        self.assertEqual([(r["source_key"], r.get("graded")) for r in twins], [("a.b", 1), ("c", None)])

    def test_left_out_helpers(self):
        counts = {"rival_no_key_account": 168, "archive_seed": 900, "muted_source": 12, "grading_failed": 0}
        self.assertEqual(zf.left_out_counts(counts), ([("rival_no_key_account", 168), ("muted_source", 12)], 900))
        self.assertEqual(zf.left_out_counts(None), ([], 0))
        out = zf.left_out_counts_html(counts)
        self.assertIn("Skipped in the last 14 days: Rival, no key account 168 · Muted source 12</div>", out)
        self.assertIn("Archive seed (history loaded at first ingest, never news): 900", out)
        self.assertIn("nothing</div>", zf.left_out_counts_html({}))
        self.assertNotIn("Archive seed", zf.left_out_counts_html({}))
        self.assertIn("&lt;weird&gt; 2", zf.left_out_counts_html({"<weird>": 2}))
        item = zf.left_out_item_html(LEFT_OUT[0])
        self.assertIn('<b class="z-name">SERV</b><span class="z-badge reject">Rival, no key account</span>', item)
        self.assertIn('href="https://example.com/serv"', item)
        self.assertIn("Serve&#x27;s &lt;robot&gt; pilot</a>", item)
        unsafe = zf.left_out_item_html(LEFT_OUT[1])
        self.assertNotIn("<a ", unsafe)
        self.assertIn(">Waymo<", zf.left_out_item_html(LEFT_OUT[3]))

    def test_not_found_detection(self):
        self.assertTrue(zf.is_not_found(zf.requests.HTTPError("404 Client Error")))
        err = zf.requests.HTTPError("x")
        err.response = Resp({}, 404)
        self.assertTrue(zf.is_not_found(err))
        self.assertFalse(zf.is_not_found(zf.requests.HTTPError("500 Server Error")))

    def test_new_rows_follow_the_label_button_wrapping_rules(self):
        # 375 px: the reason select and the yield rows never spill past the card; button text never wraps.
        reason = css_rule('div[class*="st-key-zreason-"] {')
        self.assertIn("max-width: 100%", reason)
        self.assertIn("min-width: 0", reason)
        self.assertIn("white-space: nowrap", css_rule('div[class*="st-key-zreason-"] [data-baseweb="select"] * {'))
        row = css_rule('div[class*="st-key-zyield-"], div[class*="st-key-zconfirm-"] {')
        self.assertIn("flex-wrap: wrap !important", row)
        button = css_rule('div[class*="st-key-zyield-"] [data-testid="stButtonGroup"] button {')
        for prop in ("white-space: nowrap", "min-width: max-content", "flex: 0 0 auto"):
            self.assertIn(prop, button)
        self.assertIn("overflow-x: auto", css_rule(".z-scroll {"))
        self.assertIn("flex-wrap: wrap !important", css_rule("div.st-key-zgrader {"))
        # A wrapped strip or yield row keeps its control below the text, not over it.
        margin = css_rule('div.st-key-zhealth [data-testid="stMarkdownContainer"], div.st-key-zgrader')
        self.assertIn('div[class*="st-key-zyield-"] [data-testid="stMarkdownContainer"]', margin)
        self.assertIn("margin-bottom: 0", margin)
        self.assertLessEqual(220, 375 - 2 * 16)  # the reason select's fixed width fits a phone card


# ---- round 4 (the app) ----------------------------------------------------------------
class Round4Pages(AppBase):
    def open_tuning(self):
        self.run_app()
        self.at.switch_page("views/tuning.py")
        return self.run_app()

    def texts(self) -> list[str]:
        return [t.value for t in self.at.text]

    def captions(self) -> list[str]:
        return [c.value for c in self.at.caption]

    # A1 ----------------------------------------------------------------------------
    def test_coverage_shows_grader_strip_and_gaps(self):
        self.run_app()
        self.assertIn("Grader: last run 12 min ago · Aux backlog 96 (oldest Nov 9) · Headlines waiting 239", self.page_text())
        self.assertIn("Nov 23 08:11 UTC to Nov 23 14:05 UTC (5.9 h)", [t.strip() for t in self.texts()])
        self.assertTrue(any("usage limit refused a scheduled grader run" in t for t in self.texts()))
        self.assertIn(("/v1/ops", {}), [(g, p) for g, p, _ in self.api.gets])

    def test_grader_strip_is_red_when_late(self):
        self.api.routes["/v1/ops"]["grader"].update(status="down", last_run_at=iso(5))
        self.run_app()
        self.assertIn('Grader: <span class="z-bad">down · last run 5h ago</span>', self.page_text())

    def test_grader_strip_before_ops_exists(self):
        self.api.missing.add("/v1/ops")
        self.run_app()
        self.assertIn("Grader health not available yet", self.captions())
        self.assertEqual(len(self.cards()), 3)

    def test_auxiliary_page_has_no_grader_strip(self):
        self.open_aux()
        self.assertNotIn("Grader:", self.page_text())

    # A4 ----------------------------------------------------------------------------
    def test_to_label_sort_on_both_pages(self):
        self.run_app()
        self.assertEqual(self.at.segmented_control(key="cov-mode").options, ["For You", "Latest", "To label"])
        self.at.segmented_control(key="cov-mode").set_value("To label")
        self.run_app()
        self.assertEqual(self.api.feed_calls("/v1/feed")[-1], {"sort": "to_label", "unlabeled": "1", "state": "graded", "limit": 40})
        self.assertEqual(len(self.at.select_slider), 0)  # no Signal floor
        self.assertEqual(len(self.at.toggle), 0)  # Unlabeled only is implied
        self.assertTrue(any(c.startswith("To label:") for c in [c.value for c in self.at.sidebar.caption]))
        self.at.switch_page("views/auxiliary.py")
        self.run_app()
        self.at.segmented_control(key="aux-mode").set_value("To label")
        self.run_app()
        self.assertEqual(self.api.feed_calls("/v1/aux/feed")[-1], {"sort": "to_label", "unlabeled": "1", "state": "graded", "limit": 40})

    def test_to_label_with_names_keeps_the_teaching_order(self):
        self.api.items["/v1/feed"] = [dict(COVERAGE_ITEMS[0], item_id=20, score=95, confidence=0.9, label=None),
                                      dict(COVERAGE_ITEMS[0], item_id=21, score=71, confidence=0.8, label=None)]
        self.run_app()
        self.at.segmented_control(key="cov-mode").set_value("To label")
        self.at.multiselect(key="cov-filter").set_value(["RCAT", "KTOS"])
        self.run_app()
        self.assertEqual([c["ticker"] for c in self.api.feed_calls("/v1/feed")[-2:]], ["RCAT", "KTOS"])
        cards = self.cards()
        self.assertEqual(len(cards), 2)
        self.assertIn("71 · lead", cards[0])  # nearest 70 before the 95, not newest first

    def test_to_label_keeps_a_labelled_card_for_its_reason(self):
        self.run_app()
        self.at.segmented_control(key="cov-mode").set_value("To label")
        self.run_app()
        self.assertEqual(len(self.cards()), 1)  # RCAT 11 only: UMAC 10 is labelled, KTOS 9 is pending in the fixture
        self.at.segmented_control(key="cov-lbl-11-RCAT").set_value("noise")
        self.run_app()
        # The server now leaves it out, but it stays on screen with its label and a reason picker.
        self.assertEqual(len(self.cards()), 1)
        self.assertEqual(self.at.segmented_control(key="cov-lbl-11-RCAT").value, "noise")
        self.at.selectbox(key="cov-lbl-11-RCAT:rsn-down").set_value("marketing")
        self.run_app()
        self.assertEqual(self.api.posts[-1][:2], ("/v1/feedback", {"item_id": 11, "label": "noise", "note": None, "ticker": "RCAT",
                                                                  "grade_id": 101, "reason": "marketing"}))
        self.assertEqual(self.at.selectbox(key="cov-lbl-11-RCAT:rsn-down").value, "marketing")
        # Leaving To label drops the kept card.
        self.at.segmented_control(key="cov-mode").set_value("Latest")
        self.run_app()
        self.at.segmented_control(key="cov-mode").set_value("To label")
        self.run_app()
        self.assertEqual(len(self.cards()), 0)
        self.assertIn("Nothing to label", self.at.info[0].value)

    def test_to_label_with_names_shows_an_item_once_after_a_label(self):
        # Item 11 is graded for both picked names: one card, under UMAC (the later batch).
        base = dict(COVERAGE_ITEMS[0], item_id=11, score=72, confidence=0.9, label=None, also="UMAC:71")
        self.api.by_ticker = {"RCAT": [dict(base, grade_ticker="RCAT", grade_id=101)],
                              "UMAC": [dict(base, grade_ticker="UMAC", grade_id=102, score=71)]}
        self.run_app()
        self.at.segmented_control(key="cov-mode").set_value("To label")
        self.at.multiselect(key="cov-filter").set_value(["RCAT", "UMAC"])
        self.run_app()
        labels = lambda: [w.key for w in self.at.segmented_control if w.key.startswith("cov-lbl-")]  # noqa: E731
        self.assertEqual(labels(), ["cov-lbl-11-UMAC"])
        self.at.segmented_control(key="cov-lbl-11-UMAC").set_value("noise")
        self.run_app()  # no duplicate card key
        # The UMAC grade is labelled; the RCAT one still waits, so it takes the card's place.
        self.assertEqual(labels(), ["cov-lbl-11-RCAT"])
        self.assertIsNone(self.at.segmented_control(key="cov-lbl-11-RCAT").value)
        self.at.segmented_control(key="cov-lbl-11-RCAT").set_value("low")
        self.run_app()
        # Both grades labelled: one kept card, with the latest label.
        self.assertEqual(labels(), ["cov-lbl-11-RCAT"])
        self.assertEqual(self.at.segmented_control(key="cov-lbl-11-RCAT").value, "low")
        self.assertEqual(len(self.cards()), 1)

    def test_to_label_card_keeps_its_place_after_a_label(self):
        self.api.items["/v1/feed"] = [
            dict(COVERAGE_ITEMS[0], item_id=20, score=90, confidence=0.5, label=None),
            dict(COVERAGE_ITEMS[0], item_id=19, score=40, confidence=0.5, label=None),
            dict(COVERAGE_ITEMS[0], item_id=18, score=70, confidence=0.9, label=None)]
        self.run_app()
        self.at.segmented_control(key="cov-mode").set_value("To label")
        self.run_app()
        order = lambda: [w.key for w in self.at.segmented_control if w.key.startswith("cov-lbl-")]  # noqa: E731
        self.assertEqual(order(), ["cov-lbl-20-RCAT", "cov-lbl-19-RCAT", "cov-lbl-18-RCAT"])
        self.at.segmented_control(key="cov-lbl-20-RCAT").set_value("low")
        self.run_app()
        self.assertEqual(order(), ["cov-lbl-20-RCAT", "cov-lbl-19-RCAT", "cov-lbl-18-RCAT"])

    # A3 ----------------------------------------------------------------------------
    def test_no_reason_picker_on_an_older_feed(self):
        # A feed without my_reason comes from a zenith-core that drops reasons: no picker.
        self.api.old_feed = True
        self.run_app()
        self.assertEqual(self.at.segmented_control(key="cov-lbl-10-UMAC").value, "noise")
        self.assertEqual(len(self.at.selectbox), 0)
        self.at.segmented_control(key="cov-lbl-11-RCAT").set_value("low")
        self.run_app()
        self.assertEqual(len(self.at.selectbox), 0)
        self.assertNotIn("reason", self.api.posts[-1][1])

    def test_reason_picker_follows_the_label(self):
        self.run_app()
        # UMAC 10 is labelled Noise on the server: the down reasons, empty until picked.
        noise = self.at.selectbox(key="cov-lbl-10-UMAC:rsn-down")
        self.assertEqual(noise.options, ["Not material", "Duplicate", "Wrong company", "Stale", "Marketing", "Not my focus"])
        self.assertIsNone(noise.value)
        # RCAT 11 has no label: no picker.
        self.assertEqual([s.key for s in self.at.selectbox], ["cov-lbl-10-UMAC:rsn-down"])
        self.at.segmented_control(key="cov-lbl-11-RCAT").set_value("too_low")
        self.run_app()
        self.api.items["/v1/feed"][0]["label"] = "too_low"  # the server's label after the post
        zf.get_json.clear()
        self.run_app()
        up = self.at.selectbox(key="cov-lbl-11-RCAT:rsn-up")
        self.assertEqual(up.options, ["Missed detail"])
        up.set_value("missed_detail")
        self.run_app()
        self.assertEqual(self.api.posts[-1][1], {"item_id": 11, "label": "too_low", "note": None, "ticker": "RCAT",
                                                 "grade_id": 101, "reason": "missed_detail"})
        self.assertEqual(self.at.toast[0].value, "Reason saved: Missed detail")
        # Medium takes no reason.
        self.api.items["/v1/feed"][0]["label"] = "medium"
        zf.get_json.clear()
        self.run_app()
        self.assertEqual([s.key for s in self.at.selectbox], ["cov-lbl-10-UMAC:rsn-down"])

    def test_reason_picker_shows_the_saved_reason_and_keeps_the_note(self):
        self.api.items["/v1/feed"][1].update(my_reason="duplicate", label_note="same as 11")
        self.run_app()
        picker = self.at.selectbox(key="cov-lbl-10-UMAC:rsn-down")
        self.assertEqual(picker.value, "duplicate")
        picker.set_value("stale")
        self.run_app()
        self.assertEqual(self.api.posts[-1][1], {"item_id": 10, "label": "noise", "note": "same as 11", "ticker": "UMAC",
                                                 "grade_id": 100, "reason": "stale"})

    def test_failed_reason_is_reported_and_reverted(self):
        self.api.post_errors["/v1/feedback"] = (400, "reason must be one of ...")
        self.run_app()
        self.at.selectbox(key="cov-lbl-10-UMAC:rsn-down").set_value("stale")
        self.run_app()
        self.assertEqual(self.at.toast[0].value, "Reason not saved: reason must be one of ...")
        self.assertIsNone(self.at.selectbox(key="cov-lbl-10-UMAC:rsn-down").value)

    def test_auxiliary_reason_posts_aux_feedback(self):
        self.api.items["/v1/aux/feed"][0]["label"] = "too_high"
        self.open_aux()
        self.at.selectbox(key="aux-lbl-501:rsn-down").set_value("wrong_company")
        self.run_app()
        self.assertEqual(self.api.posts[-1][:2], ("/v1/aux/feedback", {"item_id": 501, "label": "too_high",
                                                                      "reason": "wrong_company"}))

    def test_note_keeps_the_saved_reason(self):
        self.api.items["/v1/feed"][1]["my_reason"] = "duplicate"
        self.run_app()
        self.at.text_area(key="cov-lbl-10-UMAC:note").input("Same award")
        self.at.radio(key="cov-lbl-10-UMAC:nl").set_value("noise")
        self.at.button(key="cov-lbl-10-UMAC:save").click()
        self.run_app()
        self.assertEqual(self.api.posts[-1][1]["reason"], "duplicate")

    # A2 ----------------------------------------------------------------------------
    def test_tuning_is_the_third_page(self):
        text = (APP / "streamlit_app.py").read_text(encoding="utf-8")
        pages = [text.index(f'"views/{p}.py"') for p in ("coverage", "auxiliary", "tuning")]
        self.assertEqual(pages, sorted(pages))
        self.open_tuning()
        md = self.page_text()
        for heading in ("#### Tuning", "##### Calibration", "##### Source yield", "##### Left out", "##### Grader"):
            self.assertIn(heading, md)
        self.assertLess(md.index("##### Calibration"), md.index("##### Source yield"))
        self.assertLess(md.index("##### Left out"), md.index("##### Grader"))
        self.assertNotIn("pandas", sys.modules)
        self.assertNotIn("<b>wins", md.split("</style>")[-1])

    def test_tuning_calibration(self):
        self.open_tuning()
        md = self.page_text()
        self.assertIn("<td>Coverage</td><td>10</td><td>60% of 10</td><td>3</td><td>1</td><td>67% of 3</td>", md)
        self.assertIn("<td>Auxiliary</td><td>2</td><td>50% of 2</td><td>0</td><td>1</td><td>n/a</td>", md)
        self.assertIn('Red Cat &lt;b&gt;wins&lt;/b&gt; order', md)
        self.assertIn("<td>Anduril</td>", md)
        self.assertIn("<td>Stale</td><td>3</td>", md)
        self.assertNotIn("Wrong company</td>", md)  # zero counts are left out

    def test_tuning_calibration_without_labels(self):
        self.api.routes["/v1/calibration"] = {"coverage": {"all_time": summary(0, 0, 0, 0), "misses": []},
                                              "aux": {"all_time": summary(0, 0, 0, 0)}, "reasons": {}}
        self.open_tuning()
        self.assertIn("No labels yet", self.at.info[0].value)

    def test_tuning_calibration_from_an_older_worker(self):
        self.api.routes["/v1/calibration"] = copy.deepcopy(CALIBRATION["coverage"])
        self.open_tuning()
        self.assertIn("<td>Auxiliary</td><td>not available yet</td>", self.page_text())
        self.assertIn("Reason counts not available yet.", self.captions())

    def test_tuning_before_the_round4_routes_exist(self):
        self.api.missing.update({"/v1/calibration", "/v1/source-yield", "/v1/left-out", "/v1/ops"})
        self.open_tuning()
        captions = self.captions()
        for what in ("Calibration", "Source yield", "Left out", "Grader health"):
            self.assertIn(f"{what} not available yet.", captions)

    def test_source_yield_rows_and_suggestions(self):
        self.open_tuning()
        self.assertEqual([e.label for e in self.at.expander if " sources" in e.label],
                         ["Coverage · 2 sources · 1 suggested", "Auxiliary · 3 sources · 2 suggested"])
        rows = [m.value for m in self.at.markdown if 'class="z-yield"' in m.value]
        self.assertEqual(len(rows), 5)
        self.assertIn("heo</b><span class=\"z-badge lead\">suggested: mute</span>", rows[0])  # suggested first
        self.assertIn("rcat_press", rows[1])
        self.assertIn("suggested: mute", rows[2])
        self.assertIn("suggested: demote", rows[3])
        prefs = {w.key: w.value for w in self.at.segmented_control if w.key.startswith("tune-pref-")}
        self.assertEqual(prefs, {"tune-pref-coverage-heo": "normal", "tune-pref-coverage-rcat_press": "normal",
                                 "tune-pref-aux-google_suncatcher": "demote", "tune-pref-aux-tfvector": "mute",
                                 "tune-pref-aux-anduril": "normal"})
        control = self.at.segmented_control(key="tune-pref-coverage-heo")
        self.assertEqual(control.options, ["Mute", "Demote", "Normal"])
        self.assertIn("muted sources are not graded", control.help)
        self.assertEqual(self.api.feed_calls("/v1/source-yield"), [{"days": 30}])

    def test_demote_and_normal_save_at_once(self):
        self.open_tuning()
        self.at.segmented_control(key="tune-pref-coverage-rcat_press").set_value("demote")
        self.run_app()
        self.assertEqual(self.api.posts[-1][:2], ("/v1/source-prefs", {"source_key": "rcat_press", "action": "demote"}))
        self.assertEqual([t.value for t in self.at.toast], ["Demoted rcat_press"])
        self.at.segmented_control(key="tune-pref-aux-tfvector").set_value("normal")
        self.run_app()
        self.assertEqual(self.api.posts[-1][:2], ("/v1/source-prefs", {"source_key": "tfvector", "action": "normal"}))

    def test_mute_asks_for_a_confirm_click(self):
        self.open_tuning()
        self.at.segmented_control(key="tune-pref-coverage-heo").set_value("mute")
        self.run_app()
        self.assertEqual(self.api.posts, [])  # nothing saved yet
        self.assertTrue(any(c.startswith("Mute heo? Muted sources are not graded") for c in self.captions()))
        self.at.button(key="tune-pref-coverage-heo:yes").click()
        self.run_app()
        self.assertEqual([p[:2] for p in self.api.posts], [("/v1/source-prefs", {"source_key": "heo", "action": "mute"})])
        self.assertEqual(self.at.segmented_control(key="tune-pref-coverage-heo").value, "mute")
        self.assertFalse([b for b in self.at.button if b.key == "tune-pref-coverage-heo:yes"])

    def test_mute_cancel_reverts(self):
        self.open_tuning()
        self.at.segmented_control(key="tune-pref-aux-anduril").set_value("mute")
        self.run_app()
        self.at.button(key="tune-pref-aux-anduril:no").click()
        self.run_app()
        self.assertEqual(self.api.posts, [])
        self.assertEqual(self.at.segmented_control(key="tune-pref-aux-anduril").value, "normal")

    def test_refused_mute_is_reported_and_reverted(self):
        self.api.post_errors["/v1/source-prefs"] = (400, "edgar sources cannot be muted")
        self.open_tuning()
        self.at.segmented_control(key="tune-pref-coverage-rcat_press").set_value("mute")
        self.run_app()
        self.at.button(key="tune-pref-coverage-rcat_press:yes").click()
        self.run_app()
        self.assertEqual(self.at.toast[0].value, "rcat_press not saved: edgar sources cannot be muted")
        self.assertEqual(self.at.segmented_control(key="tune-pref-coverage-rcat_press").value, "normal")

    def test_left_out_counts_items_and_grade_it(self):
        self.open_tuning()
        md = self.page_text()
        self.assertIn("Skipped in the last 14 days: Muted source 1 · Rival, no key account 1</div>", md)
        self.assertIn("Archive seed (history loaded at first ingest, never news): 1", md)
        self.assertEqual(self.api.feed_calls("/v1/left-out"), [{"days": 14, "kind": "coverage", "limit": 20}])
        left = [m.value for m in self.at.markdown if "z-badge reject" in m.value]
        self.assertEqual(len(left), 2)  # archive_seed is left out unless asked for
        self.assertIn("Serve&#x27;s &lt;robot&gt; pilot</a>", left[0])
        self.assertEqual(self.at.selectbox(key="tune-left-reason").options,
                         ["All reasons (archive seed apart)", "Muted source", "Rival, no key account", "Archive seed"])
        self.at.button(key="tune-grade-coverage-301").click()
        self.run_app()
        self.assertEqual(self.api.posts[-1][:2], ("/v1/left-out/grade", {"kind": "coverage", "id": 301}))
        self.assertEqual([t.value for t in self.at.toast], ["Queued: the next grader run grades it"])

    def test_left_out_reason_and_kind_pickers(self):
        self.open_tuning()
        self.at.selectbox(key="tune-left-reason").set_value("archive_seed")
        self.run_app()
        self.assertEqual(self.api.feed_calls("/v1/left-out")[-1], {"days": 14, "kind": "coverage", "limit": 20, "reason": "archive_seed"})
        self.assertIn("Old archive story", self.page_text())
        self.at.selectbox(key="tune-left-reason").set_value("")
        self.at.segmented_control(key="tune-left-kind").set_value("aux")
        self.run_app()
        self.assertEqual(self.api.feed_calls("/v1/left-out")[-1], {"days": 14, "kind": "aux", "limit": 20})
        self.assertIn(">Waymo<", self.page_text())
        self.at.button(key="tune-grade-aux-801").click()
        self.run_app()
        self.assertEqual(self.api.posts[-1][:2], ("/v1/left-out/grade", {"kind": "aux", "id": 801}))

    def test_left_out_items_without_an_id(self):
        rows = [{"kind": "coverage", "ticker": "X", "source_key": "s", "title": "no id 1", "skip_reason": "grading_failed"},
                {"kind": "coverage", "ticker": "Y", "source_key": "s", "title": "no id 2", "skip_reason": "grading_failed"}]
        self.api.routes["/v1/left-out"] = lambda params: {"items": rows, "counts": {"grading_failed": 2}}
        self.open_tuning()
        left = [m.value for m in self.at.markdown if "z-badge reject" in m.value]
        self.assertEqual(len(left), 2)
        self.assertFalse([b for b in self.at.button if (b.key or "").startswith("tune-grade-")])

    def test_refused_grade_it_is_reported(self):
        self.api.post_errors["/v1/left-out/grade"] = (400, "source heo is still muted")
        self.open_tuning()
        self.at.button(key="tune-grade-coverage-300").click()
        self.run_app()
        self.assertEqual(self.at.toast[0].value, "Not queued: source heo is still muted")

    def test_tuning_grader_section(self):
        self.open_tuning()
        self.assertIn("Grader: last run 12 min ago · Aux backlog 96 (oldest Nov 9) · Headlines waiting 239", self.page_text())
        self.assertIn("Last run: claimed 12, graded 11.", self.texts())
        self.assertIn("Check queue_stale: fail. 3 covered items waiting <b>over</b> 75 min", self.texts())
        self.assertIn("<td>Nov 23 08:11 UTC</td><td>Nov 23 14:05 UTC</td><td>5.9 h</td>", self.page_text())
        self.assertTrue(any("usage limit refused" in c and "As of Nov 23 14:20 UTC." in c for c in self.captions()))

    def test_tuning_grader_without_gaps(self):
        self.api.routes["/v1/ops"]["grader"]["gaps_7d"] = []
        self.open_tuning()
        self.assertIn("No missed grader runs in the last 7 days.", self.captions())

    def test_tuning_no_replay_line_before_a_replay(self):
        # Phase 2 (PR-C6): no line while nothing is armed or finished.
        self.api.routes["/v1/ops"]["replay"] = {"armed": None, "last": None}
        self.open_tuning()
        self.assertIn("Last run: claimed 12, graded 11.", self.texts())
        self.assertFalse([t for t in self.texts() if "golden replay" in t.lower()])

    def test_tuning_replay_line(self):
        # Phase 2 (PR-C6): one line while a replay is armed.
        self.api.routes["/v1/ops"]["replay"] = {
            "armed": {"kind": "baseline", "scope": "full", "rubric_version": "r-test0000", "n_graded": 3, "n_items": 9},
            "last": None}
        self.open_tuning()
        self.assertEqual([t for t in self.texts() if "golden replay" in t.lower()],
                         ["Golden replay armed: baseline r-test0000 (scope full), 3/9 graded."])


if __name__ == "__main__":
    unittest.main()


# ---- round 4 addendum (A5 labels before grading, F1 controls the server refuses) ----------
class AddendumFunctions(unittest.TestCase):
    def test_label_toasts(self):
        self.assertEqual(zf.label_toast("high"), "Labeled High: pinned to For You")
        self.assertEqual(zf.label_toast("noise"), "Labeled Noise: removed from For You")
        for label, text in (("medium", "Medium"), ("low", "Low"), ("too_high", "Too high"), ("too_low", "Too low")):
            self.assertEqual(zf.label_toast(label), f"Labeled {text}: the grader will learn from it")

    def test_your_pick_badge(self):
        it = dict(AUX_ITEMS[1], owner_pick=1)
        self.assertIn('<span class="z-badge pick">Your pick</span>', zf.card_html(zf.AUXILIARY, it))
        self.assertIn("grading…", zf.card_html(zf.AUXILIARY, it))
        self.assertNotIn("Your pick", zf.card_html(zf.AUXILIARY, AUX_ITEMS[1]))
        self.assertNotIn("Your pick", zf.card_html(zf.COVERAGE, dict(COVERAGE_ITEMS[0], owner_pick=0)))

    def test_pref_locked_and_left_blocked(self):
        self.assertIsNone(zf.pref_locked({"source_key": "heo"}))  # an older zenith-core: no mutable field
        self.assertIsNone(zf.pref_locked({"source_key": "heo", "mutable": True, "lock": None}))
        self.assertEqual(zf.pref_locked({"mutable": False, "lock": "sec"}), "SEC filings \u2014 can't be muted")
        self.assertEqual(zf.pref_locked({"mutable": False, "lock": "own_channel"}), "Own channel \u2014 can't be muted")
        self.assertEqual(zf.pref_locked({"mutable": False, "lock": "unknown"}), "Own channel / SEC \u2014 can't be muted")
        self.assertIsNone(zf.left_blocked({"id": 1}))
        self.assertIsNone(zf.left_blocked({"id": 1, "gradeable": True, "blocked": None}))
        self.assertEqual(zf.left_blocked({"gradeable": False, "blocked": "heo is still muted"}), "heo is still muted")
        self.assertEqual(zf.left_blocked({"gradeable": False}), "it can't be sent back to the grader from here")

    def test_mode_row_wraps_at_phone_width(self):
        row = css_rule('div[class*="st-key-zmode-"] {')
        self.assertIn("flex-wrap: wrap !important", row)
        self.assertIn("max-width: 100%", row)
        button = css_rule('div[class*="st-key-zmode-"] [data-testid="stButtonGroup"] button,')
        for prop in ("white-space: nowrap", "min-width: max-content", "flex: 0 0 auto"):
            self.assertIn(prop, button)


class AddendumPages(AppBase):
    def open_tuning(self):
        self.run_app()
        self.at.switch_page("views/tuning.py")
        return self.run_app()

    def guide_text(self) -> str:
        return "\n".join([m.value for m in self.at.markdown] + [c.value for c in self.at.caption])

    def test_how_labels_work_on_both_pages(self):
        for open_page in (self.run_app, self.open_aux):
            open_page()
            self.assertIn("How labels work", [p.proto.popover.label for p in self.at.get("popover")])
            text = self.guide_text()
            self.assertIn("**High:** must see. Always shows in For You, whatever the score. Teaches the grader to score items like this 80+.", text)
            self.assertIn("**Medium:** worth knowing. Teaches the grader that items like this belong around 60-89. "
                          "Where the card shows doesn't change.", text)
            self.assertIn("**Low:** minor. Teaches the grader 30-69. Where the card shows doesn't change.", text)
            self.assertIn("**Noise:** not useful. Removes the card from For You. Teaches the grader to score items like this under 30.", text)
            self.assertIn("**Too high / Too low:** the score is off in that direction. Teaches the grader. "
                          "Where the card shows doesn't change.", text)
            self.assertIn("**Reason (optional):** tells the grader why, e.g. stale, wrong company or marketing.", text)
            self.assertIn("A label never rewrites this card's score. Every hourly grader run reads your labels from the last 30 days "
                          "and applies them to similar new items. You can change a label any time; the latest one counts.", text)

    def test_label_control_has_the_short_help(self):
        self.run_app()
        self.assertEqual(self.at.segmented_control(key="cov-lbl-11-RCAT").help, zf.LABEL_HELP)
        self.assertIn("High: always in For You", zf.LABEL_HELP)
        self.assertIn("Noise: out of For You", zf.LABEL_HELP)

    def test_ungraded_card_offers_four_labels_and_posts_without_a_grade(self):
        self.open_aux()
        self.assertEqual(self.at.segmented_control(key="aux-lbl-500").options, ["High", "Medium", "Low", "Noise"])
        self.at.segmented_control(key="aux-lbl-500").set_value("high")
        self.run_app()
        self.assertEqual(self.api.posts[-1][:2], ("/v1/aux/feedback", {"item_id": 500, "label": "high"}))
        self.assertEqual([t.value for t in self.at.toast], ["Labeled High: pinned to For You"])

    def test_ungraded_coverage_card_posts_its_ticker(self):
        self.run_app()
        self.at.segmented_control(key="cov-lbl-9-KTOS").set_value("noise")
        self.run_app()
        self.assertEqual(self.api.posts[-1][:2], ("/v1/feedback", {"item_id": 9, "label": "noise", "note": None, "ticker": "KTOS"}))
        self.assertEqual([t.value for t in self.at.toast], ["Labeled Noise: removed from For You"])

    def test_teaching_labels_say_the_grader_learns(self):
        self.run_app()
        self.at.segmented_control(key="cov-lbl-11-RCAT").set_value("medium")
        self.run_app()
        self.assertEqual([t.value for t in self.at.toast], ["Labeled Medium: the grader will learn from it"])

    def test_pinned_card_shows_your_pick(self):
        self.api.items["/v1/aux/feed"][1]["owner_pick"] = 1
        self.api.items["/v1/aux/feed"][1]["label"] = "high"
        self.open_aux()
        cards = self.cards()
        self.assertNotIn("Your pick", cards[0])
        self.assertIn('<span class="z-badge pick">Your pick</span>', cards[1])
        self.assertIn("grading…", cards[1])
        self.assertEqual(self.at.segmented_control(key="aux-lbl-500").value, "high")

    def test_locked_sources_have_no_mute_or_demote(self):
        cov = self.api.routes["/v1/source-yield"]["coverage"]
        cov.append({"source_key": "redcat", "graded": 12, "high": 0, "reject": 12, "duplicate": 0, "last_high_at": None,
                    "pref": None, "suggest": None, "mutable": False, "lock": "own_channel"})
        cov.append({"source_key": "edgar_rcat", "graded": 4, "high": 0, "reject": 4, "duplicate": 0, "last_high_at": None,
                    "pref": None, "suggest": None, "mutable": False, "lock": "sec"})
        cov[0]["mutable"] = True
        self.open_tuning()
        keys = [w.key for w in self.at.segmented_control if w.key.startswith("tune-pref-")]
        self.assertIn("tune-pref-coverage-rcat_press", keys)
        self.assertNotIn("tune-pref-coverage-redcat", keys)
        self.assertNotIn("tune-pref-coverage-edgar_rcat", keys)
        text = self.page_text()
        self.assertIn("Own channel \u2014 can&#x27;t be muted", text)
        self.assertIn("SEC filings \u2014 can&#x27;t be muted", text)

    def test_left_out_hides_grade_it_when_the_server_would_refuse(self):
        LEFT = [dict(LEFT_OUT[0], gradeable=False, blocked="already on the Auxiliary page (aux item 9, <pending>)"),
                dict(LEFT_OUT[1], gradeable=True, blocked=None)]
        self.api.routes["/v1/left-out"] = lambda params: {"items": copy.deepcopy(LEFT), "counts": {"rival_no_key_account": 1, "muted_source": 1}}
        self.open_tuning()
        keys = [b.key for b in self.at.button]
        self.assertNotIn("tune-grade-coverage-301", keys)
        self.assertIn("tune-grade-coverage-300", keys)
        self.assertIn("Can't grade it: already on the Auxiliary page (aux item 9, &lt;pending&gt;)", self.page_text())


# ---- round 5 (D3): the Expansion queue on the Tuning page ------------------------------
WORKER = APP.parent / "worker" / "src" / "expansion.js"


class ExpansionFunctions(unittest.TestCase):
    def test_reject_reasons_mirror_the_worker(self):
        src = WORKER.read_text(encoding="utf-8")
        line = next(ln for ln in src.splitlines() if ln.startswith("export const REJECT_REASONS"))
        self.assertEqual([v for v, _ in zf.EXP_REASONS], re.findall(r'"([a-z_]+)"', line))
        statuses = next(ln for ln in src.splitlines() if ln.startswith("export const STATUSES"))
        self.assertEqual(set(zf.EXP_STATUS_TEXT), set(re.findall(r'"([a-z_]+)"', statuses)))

    def test_relation_known_similar_and_decision_texts(self):
        self.assertEqual(zf.relation_text(EXPANSION[0]), "acquired by UMAC")
        self.assertEqual(zf.relation_text(EXPANSION[2]), "awarded SPAI")
        self.assertEqual(zf.relation_text(EXPANSION[1]), "")  # an aux entity row has no relation or subject
        self.assertEqual(zf.known_note("key_account:SPAI"), "already a SPAI key account, no source")
        self.assertEqual(zf.known_note("sheet_term:UMAC"), "already a UMAC sheet term, no source")
        self.assertEqual(zf.known_note("aux_item:ia_rockwell"), "own source ia_rockwell (Auxiliary items)")
        self.assertEqual(zf.similar_text(EXPANSION[1]["similar"]), "similar: #13 Genesis")
        self.assertEqual(zf.similar_text([{"id": "x", "name": "bad"}]), "")
        self.assertEqual(zf.decision_text(EXPANSION[3]), "Approved Nov 24 for ONDS")
        self.assertEqual(zf.decision_text({"decision": {"at": "2026-11-24T10:00:00Z", "action": "reject", "reason": "too_small",
                                                        "note": "a seed round", "tickers": None}}),
                         "Rejected Nov 24: Too small (a seed round)")
        self.assertEqual(zf.decision_text({"decision": {"at": "2026-11-24T10:00:00Z", "action": "approve", "tickers": []}}),
                         "Approved Nov 24 with no tickers")
        self.assertEqual(zf.decision_text(EXPANSION[0]), "")

    def test_sec_filing_card_shows_origin_and_party(self):
        out = zf.expansion_card_html(EXPANSION[0])
        self.assertIn('<b class="z-name">Upgrade Energy</b>', out)
        self.assertIn("acquired by UMAC", out)
        self.assertIn('<span class="z-badge also">UMAC</span>', out)
        self.assertIn('<span class="z-badge src">SEC filing</span><span class="z-badge src">Grader</span>', out)
        self.assertIn("1 sighting<", out)
        self.assertIn("Known: already a UMAC sheet term, no source", out)
        self.assertIn("party: DroneNX LLC d/b/a Upgrade Energy", out)
        self.assertIn(f'<a href="{SEC_URL}" target="_blank" rel="noopener noreferrer">', out)
        self.assertIn("Coverage #18 · SEC filing · Oct 23", out)
        self.assertIn("Aux entity", zf.expansion_card_html(EXPANSION[1]))
        self.assertIn("similar: #13 Genesis", zf.expansion_card_html(EXPANSION[1]))

    def test_card_escapes_and_shows_three_evidence_links(self):
        row = dict(EXPANSION[2], name="UNMAS <img src=x>", subject="SPAI<b>", tickers=["SPAI<i>"], origins=["grader_relation", "odd<o>"])
        out = zf.expansion_card_html(row)
        for raw in ("<img", "<script>", "<b>", "<i>", "<o>"):
            self.assertNotIn(raw, out)
        self.assertIn("UNMAS &lt;img src=x&gt;", out)
        self.assertIn("SPAI &lt;script&gt;x&lt;/script&gt; award", out)
        self.assertNotIn("javascript:", out)  # an unsafe link is text, not a link
        self.assertEqual(out.count('class="z-exp-ev"'), 3)
        self.assertNotIn("Safe Pro item 259", out)  # the 4th evidence entry is not shown
        self.assertIn("4 sightings", out)
        self.assertIn("Known: already a SPAI key account, no source", out)

    def test_known_card_says_why_it_takes_no_decision(self):
        out = zf.expansion_card_html(EXPANSION[4])
        self.assertIn("Known: own source ia_rockwell (Auxiliary items)", out)
        self.assertIn("Already has its own source (aux_item:ia_rockwell): use Not the same company to reopen it first", out)

    def test_card_says_what_it_is_from_the_grader(self):
        row = dict(EXPANSION[3], about="Swiss maker of electric motor gliders", about_fallback=None, about_source="grader")
        out = zf.expansion_card_html(row)
        self.assertIn("What it is: Swiss maker of electric motor gliders", out)
        self.assertNotIn("Seen as:", out)
        # Right under the name line, before the notes and the evidence.
        self.assertLess(out.index("</div>"), out.index("What it is:"))
        self.assertLess(out.index("What it is:"), out.index('class="z-exp-ev"'))

    def test_card_falls_back_to_how_it_was_seen_in_muted_style(self):
        row = dict(EXPANSION[1], about=None, about_source="grade_headline",
                   about_fallback="Genesis AI raises $105M seed for robot foundation models. A large seed round.")
        out = zf.expansion_card_html(row)
        self.assertIn('<span class="z-health">Seen as: Genesis AI raises $105M seed for robot foundation models. A large seed round.</span>', out)
        self.assertNotIn("What it is:", out)
        # The grader's about wins when both are present.
        both = zf.expansion_card_html(dict(row, about="Robot foundation-model startup"))
        self.assertIn("What it is: Robot foundation-model startup", both)
        self.assertNotIn("Seen as:", both)
        # Neither (an older zenith-core): no line text, only the search link.
        plain = zf.expansion_card_html(EXPANSION[1])
        self.assertNotIn("What it is:", plain)
        self.assertNotIn("Seen as:", plain)
        self.assertIn("Search the web", plain)

    def test_card_about_lines_are_escaped(self):
        out = zf.expansion_card_html(dict(EXPANSION[0], about="Maker <script>alert(1)</script> & co"))
        self.assertNotIn("<script>", out)
        self.assertIn("What it is: Maker &lt;script&gt;alert(1)&lt;/script&gt; &amp; co", out)
        out = zf.expansion_card_html(dict(EXPANSION[0], about=None, about_fallback='"DroneNX <b>LLC</b>" in 8-K'))
        self.assertNotIn("<b>LLC", out)
        self.assertIn("Seen as: &quot;DroneNX &lt;b&gt;LLC&lt;/b&gt;&quot; in 8-K", out)

    def test_card_has_a_web_search_link_for_the_quoted_name(self):
        out = zf.expansion_card_html(EXPANSION[0])
        self.assertIn('<a class="z-exp-search" href="https://www.bing.com/search?q=%22Upgrade+Energy%22" target="_blank" '
                      'rel="noopener noreferrer">Search the web</a>', out)
        self.assertEqual(zf.web_search_url("  AT&T   Labs "), "https://www.bing.com/search?q=%22AT%26T+Labs%22")
        self.assertIsNone(zf.web_search_url(""))
        self.assertTrue(zf.safe_url(zf.web_search_url("Stemme")))
        # A hostile name stays inside the query: encoded, then escaped for the attribute.
        out = zf.expansion_card_html(dict(EXPANSION[0], name='Evil" onclick="x <img>'))
        href = re.search(r'class="z-exp-search" href="([^"]*)"', out).group(1)
        self.assertTrue(href.startswith("https://www.bing.com/search?q=%22Evil%22+onclick%3D%22x+%3Cimg%3E%22"), href)
        self.assertNotIn("<img>", out)
        self.assertNotIn('onclick="x', out)

    def test_decide_body_and_toast(self):
        row = EXPANSION[0]
        self.assertEqual(zf.decide_body(row, "approve", None, ["umac", "RCAT"]), {"id": 7, "action": "approve", "tickers": ["RCAT", "UMAC"]})
        self.assertEqual(zf.decide_body(row, "approve"), {"id": 7, "action": "approve"})
        self.assertEqual(zf.decide_body(row, "reject", "too_small"), {"id": 7, "action": "reject", "reason": "too_small"})
        self.assertEqual(zf.decide_body(row, "reopen"), {"id": 7, "action": "reopen"})
        self.assertEqual(zf.decide_toast(row, {"id": 7, "action": "approve", "tickers": ["UMAC"]}),
                         "Approved Upgrade Energy for UMAC: the weekly compile gives it a source")
        self.assertEqual(zf.decide_toast(row, {"id": 7, "action": "reject", "reason": "wrong_name"}), "Rejected Upgrade Energy: Wrong name")
        self.assertEqual(zf.decide_toast(row, {"id": 7, "action": "reopen"}), "Reopened Upgrade Energy: back in Pending")

    def test_rows_need_a_numeric_id_once(self):
        rows = zf.exp_rows([EXPANSION[0], dict(EXPANSION[0]), {"id": "7; drop"}, {"id": True}, {"id": -1}, "x", EXPANSION[1]])
        self.assertEqual([r["id"] for r in rows], [7, 12])
        self.assertEqual(zf.exp_actions({"status": "known"}), ["reopen"])  # no actions field: zenith-core's rules
        self.assertEqual(zf.exp_actions({"status": "compiled", "actions": []}), [])
        self.assertEqual(zf.exp_actions({"status": "pending", "actions": ["approve", "drop"]}), ["approve"])
        self.assertEqual(zf.exp_counts_text({"pending": 3, "known": 1}), "Pending 3 · Approved 0 · Rejected 0 · Known 1 · Compiled 0")

    def test_expansion_rows_wrap_at_phone_width(self):
        row = css_rule('div[class*="st-key-zexp-"], div[class*="st-key-zexpconfirm-"] {')
        self.assertIn("flex-wrap: wrap !important", row)
        self.assertIn("max-width: 100%", row)
        button = css_rule('div[class*="st-key-zexp-"] button, div[class*="st-key-zexpconfirm-"] button {')
        for prop in ("white-space: nowrap", "min-width: max-content", "flex: 0 0 auto"):
            self.assertIn(prop, button)


class ExpansionPages(AppBase):
    def open_tuning(self):
        self.run_app()
        self.at.switch_page("views/tuning.py")
        return self.run_app()

    def captions(self) -> list[str]:
        return [c.value for c in self.at.caption]

    def exp_cards(self) -> list[str]:
        return [m.value for m in self.at.markdown if 'class="z-card z-exp"' in m.value]

    def toasts(self) -> list[str]:
        return [t.value for t in self.at.toast]

    def test_queue_sits_before_source_yield(self):
        self.open_tuning()
        md = self.page_text()
        self.assertLess(md.index("##### Calibration"), md.index("##### Expansion queue"))
        self.assertLess(md.index("##### Expansion queue"), md.index("##### Source yield"))
        self.assertEqual(self.api.feed_calls("/v1/expansion/candidates"), [{"limit": 50, "status": "pending"}])
        self.assertEqual(self.at.segmented_control(key="tune-exp-status").options, ["Pending", "Approved", "Rejected", "Known"])
        self.assertIn("Pending 3 · Approved 1 · Rejected 0 · Known 1 · Compiled 0", md)
        cards = self.exp_cards()
        self.assertEqual(len(cards), 3)
        self.assertIn("Upgrade Energy", cards[0])
        self.assertIn("SEC filing", cards[0])
        self.assertIn("party: DroneNX LLC d/b/a Upgrade Energy", cards[0])
        self.assertNotIn("<script>", md.split("</style>")[-1])
        # Widget keys come from the numeric id only.
        keys = [w.key for w in list(self.at.button) + list(self.at.selectbox) + list(self.at.multiselect)
                if (w.key or "").startswith("tune-exp-")]
        self.assertTrue(keys)
        self.assertTrue(all(re.fullmatch(r"tune-exp-\d+:[a-z]+", k) for k in keys), keys)
        self.assertNotIn("pandas", sys.modules)

    def test_not_available_yet_on_an_older_worker(self):
        self.api.missing.add("/v1/expansion/candidates")
        self.open_tuning()
        self.assertIn("Expansion queue not available yet.", self.captions())
        self.assertEqual(self.exp_cards(), [])
        self.assertIn("##### Source yield", self.page_text())  # the rest of the page still renders
        self.assertNotIn("pandas", sys.modules)

    def test_approve_posts_the_prefilled_tickers_and_toasts(self):
        self.open_tuning()
        picker = self.at.multiselect(key="tune-exp-7:tk")
        self.assertEqual(picker.value, ["UMAC"])
        self.assertEqual(picker.options, ["KTOS", "RCAT", "UMAC"])  # the covered tickers from /v1/stats
        self.at.button(key="tune-exp-7:approve").click()
        self.run_app()
        self.assertEqual(self.api.posts[-1][:2], ("/v1/expansion/decide", {"id": 7, "action": "approve", "tickers": ["UMAC"]}))
        self.assertEqual(self.api.posts[-1][2]["authorization"], f"Bearer {TOKEN}")
        self.assertEqual(self.toasts(), ["Approved Upgrade Energy for UMAC: the weekly compile gives it a source"])
        self.assertFalse(any("Upgrade Energy" in c for c in self.exp_cards()))  # it left Pending (the cache was cleared)

    def test_approve_with_tickers_added(self):
        self.open_tuning()
        self.at.multiselect(key="tune-exp-12:tk").set_value(["RCAT", "KTOS"])
        self.run_app()
        self.at.button(key="tune-exp-12:approve").click()
        self.run_app()
        self.assertEqual(self.api.posts[-1][:2], ("/v1/expansion/decide", {"id": 12, "action": "approve", "tickers": ["KTOS", "RCAT"]}))
        self.assertEqual(self.toasts(), ["Approved Genesis AI for KTOS, RCAT: the weekly compile gives it a source"])

    def test_reject_asks_for_a_confirm_click_and_cancel_reverts(self):
        self.open_tuning()
        self.at.selectbox(key="tune-exp-12:reason").set_value("too_small")
        self.run_app()
        self.assertEqual(self.api.posts, [])  # nothing saved yet
        self.assertTrue(any(c.startswith("Reject Genesis AI (Too small)?") for c in self.captions()))
        self.at.button(key="tune-exp-12:no").click()
        self.run_app()
        self.assertEqual(self.api.posts, [])
        self.assertIsNone(self.at.selectbox(key="tune-exp-12:reason").value)
        self.assertFalse([b for b in self.at.button if b.key == "tune-exp-12:yes"])
        self.at.selectbox(key="tune-exp-12:reason").set_value("too_small")
        self.run_app()
        self.at.button(key="tune-exp-12:yes").click()
        self.run_app()
        self.assertEqual([p[:2] for p in self.api.posts],
                         [("/v1/expansion/decide", {"id": 12, "action": "reject", "reason": "too_small"})])
        self.assertEqual(self.toasts(), ["Rejected Genesis AI: Too small"])
        self.assertFalse(any("Genesis AI" in c for c in self.exp_cards()))

    def test_reject_reasons_in_the_picker(self):
        self.open_tuning()
        self.assertEqual(self.at.selectbox(key="tune-exp-7:reason").options,
                         ["Not relevant", "Wrong name", "Duplicate", "Already tracked", "Too small", "No free source"])

    def test_known_row_offers_only_not_the_same_company(self):
        self.open_tuning()
        self.at.segmented_control(key="tune-exp-status").set_value("known")
        self.run_app()
        self.assertEqual(self.api.feed_calls("/v1/expansion/candidates")[-1], {"limit": 50, "status": "known"})
        cards = self.exp_cards()
        self.assertEqual(len(cards), 1)
        self.assertIn("Rockwell Automation", cards[0])
        keys = [b.key for b in self.at.button if (b.key or "").startswith("tune-exp-")]
        self.assertEqual(keys, ["tune-exp-20:reopen"])
        self.assertEqual(self.at.button(key="tune-exp-20:reopen").label, "Not the same company")
        self.assertFalse([s for s in self.at.selectbox if (s.key or "").startswith("tune-exp-")])
        self.at.button(key="tune-exp-20:reopen").click()
        self.run_app()
        self.assertEqual(self.api.posts[-1][:2], ("/v1/expansion/decide", {"id": 20, "action": "reopen"}))
        self.assertEqual(self.toasts(), ["Reopened Rockwell Automation: back in Pending"])
        self.assertIn("No known names.", self.captions())

    def test_refused_decision_is_reported(self):
        self.api.post_errors["/v1/expansion/decide"] = (400, "candidate 7 is compiled into the build list: it takes no more decisions")
        self.open_tuning()
        self.at.button(key="tune-exp-7:approve").click()
        self.run_app()
        self.assertEqual(self.toasts(), ["Upgrade Energy not saved: candidate 7 is compiled into the build list: it takes no more decisions"])
        self.assertTrue(any("Upgrade Energy" in c for c in self.exp_cards()))  # still pending
        self.at.selectbox(key="tune-exp-9:reason").set_value("duplicate")
        self.run_app()
        self.at.button(key="tune-exp-9:yes").click()
        self.run_app()
        self.assertTrue(self.toasts()[0].startswith("UNMAS not saved: "))
        self.assertIsNone(self.at.selectbox(key="tune-exp-9:reason").value)

    def test_refused_approve_after_a_reason_keeps_picker_and_confirm_in_step(self):
        self.api.post_errors["/v1/expansion/decide"] = (400, "nope")
        self.open_tuning()
        self.at.selectbox(key="tune-exp-7:reason").set_value("duplicate")
        self.run_app()
        self.assertTrue([b for b in self.at.button if b.key == "tune-exp-7:yes"])
        self.at.button(key="tune-exp-7:approve").click()
        self.run_app()
        self.assertEqual(self.toasts(), ["Upgrade Energy not saved: nope"])
        # No reason left showing without its confirm row.
        self.assertIsNone(self.at.selectbox(key="tune-exp-7:reason").value)
        self.assertFalse([b for b in self.at.button if b.key == "tune-exp-7:yes"])
        # Picking the same reason again brings the confirm back.
        self.at.selectbox(key="tune-exp-7:reason").set_value("duplicate")
        self.run_app()
        self.assertTrue([b for b in self.at.button if b.key == "tune-exp-7:yes"])

    def test_approved_filter_offers_reject_only(self):
        self.open_tuning()
        self.at.segmented_control(key="tune-exp-status").set_value("approved")
        self.run_app()
        cards = self.exp_cards()
        self.assertEqual(len(cards), 1)
        self.assertIn("Approved Nov 24 for ONDS", cards[0])
        self.assertIn("acquired by ONDS", cards[0])
        self.assertFalse([b for b in self.at.button if b.key == "tune-exp-5:approve"])
        self.assertTrue([s for s in self.at.selectbox if s.key == "tune-exp-5:reason"])

    def test_empty_rejected_list_says_its_window(self):
        self.open_tuning()
        self.at.segmented_control(key="tune-exp-status").set_value("rejected")
        self.run_app()
        self.assertIn("No rejected names in the last 30 days.", self.captions())


# ---- bill autonomy lines (Coverage card) ---------------------------------------------
BILL_LINES = {
    "v": 1, "status": "ok", "package": "BILLS-119hr3838rh", "bill": "H.R. 3838", "version": "RH", "stage": "reported in House",
    "totals": {"lines": 3, "request": 780888000, "bill": 808888000, "change": 28000000, "request_lines": 2},
    "groups": [
        {"name": "Drones / small UAS", "lines": 2, "request": 726034000, "bill": 754034000, "change": 28000000, "request_lines": 1, "rows": [
            {"kind": "line", "item": "SMALL UNMANNED AERIAL SYSTEMS <b>", "account": "AIRCRAFT PROCUREMENT, ARMY", "line": "057",
             "request": 726034000, "bill": 744034000, "change": 18000000, "changes": [{"item": "FPV/PBAS Systems", "change": 18000000}], "in_total": True},
            {"kind": "change", "item": "Small UAS for Marine Corps training", "account": "OPERATION AND MAINTENANCE, MARINE CORPS",
             "inside": "010 OPERATIONAL FORCES", "request": None, "bill": None, "change": 10000000, "in_total": True}]},
        {"name": "Provisions (no amount)", "lines": 1, "request": 0, "bill": 0, "change": 0, "request_lines": 0, "rows": [
            {"kind": "provision", "item": "None of the funds may be used to purchase a drone <script>", "account": None,
             "section": "SEC. 875. Sourcing", "request": None, "bill": None, "change": None, "in_total": False}]},
    ],
    "more": 0,
}


class BillLinesUnit(unittest.TestCase):
    def test_usd(self):
        self.assertEqual([zf.usd(v) for v in (1534000000, 726034000, 509000, 250, -27000000, None, True)],
                         ["$1.53B", "$726.0M", "$509K", "$250", "-$27.0M", "-", "-"])
        self.assertEqual([zf.signed_usd(v) for v in (18000000, -5000000, 0, None)], ["+$18.0M", "-$5.0M", "0", "-"])

    def test_summary(self):
        self.assertEqual(zf.bill_lines_summary(BILL_LINES),
                         "Autonomy lines: H.R. 3838 RH (reported in House): 3 lines, $808.9M (request $780.9M)")
        self.assertEqual(zf.bill_lines_summary({"status": "retry"}), "Autonomy lines: reading the bill text")
        self.assertEqual(zf.bill_lines_summary({"status": "failed", "error": "http_404"}),
                         "Autonomy lines: the bill text could not be read (http_404)")
        self.assertIsNone(zf.bill_lines_summary(None))
        no_request = dict(BILL_LINES, totals={"lines": 1, "bill": 5e9, "request": 0, "request_lines": 0})
        self.assertIn("$5.00B (no request figures)", zf.bill_lines_summary(no_request))

    def test_summary_never_shows_a_zero_total(self):
        # An appropriations act with no autonomy terms: no lines, never "0 lines, $0".
        none = {"status": "ok", "package": "BILLS-119hr4016rh", "bill": "H.R. 4016", "version": "RH", "stage": "reported in House",
                "totals": {"lines": 0, "request": 0, "bill": 0, "change": 0, "request_lines": 0}, "groups": []}
        self.assertEqual(zf.bill_lines_summary(none), "Autonomy lines: H.R. 4016 RH (reported in House): none in the bill text")
        self.assertEqual(zf.bill_lines_html(none), "")
        report = dict(none, package="CRPT-119hrpt162", bill="H. Rept. 119-162", version="report", stage="committee report")
        self.assertEqual(zf.bill_lines_summary(report), "Autonomy lines: H. Rept. 119-162 report (committee report): none in the report text")
        # Lines, but the only amount row is not added.
        uncounted = dict(none, totals={"lines": 3, "request": 0, "bill": 0, "change": 0, "request_lines": 0})
        self.assertEqual(zf.bill_lines_summary(uncounted), "Autonomy lines: H.R. 4016 RH (reported in House): 3 lines, no amounts counted")
        self.assertIn("(report text only)", zf.bill_lines_summary(dict(BILL_LINES, package="CRPT-119hrpt162")))

    def test_grouped_table(self):
        out = zf.bill_lines_html(BILL_LINES)
        self.assertEqual(out.count('<details class="z-bl">'), 2)
        self.assertIn("<summary>Drones / small UAS: 2 lines, $754.0M (request $726.0M)</summary>", out)
        self.assertIn("<summary>Provisions (no amount): 1 lines, no amounts</summary>", out)
        self.assertIn("<th>Item</th><th>Account</th><th>Request</th><th>Bill</th><th>Change</th>", out)
        self.assertIn("<td>AIRCRAFT PROCUREMENT, ARMY, line 057</td><td>$726.0M</td><td>$744.0M</td><td>+$18.0M</td>", out)
        self.assertIn("↳ FPV/PBAS Systems", out)
        self.assertIn("OPERATION AND MAINTENANCE, MARINE CORPS, inside 010 OPERATIONAL FORCES</td><td>-</td><td>-</td><td>+$10.0M", out)
        self.assertIn("<td>no amount</td>", out)
        for raw in ("<b>", "<script>"):
            self.assertNotIn(raw, out)
        self.assertEqual(zf.bill_lines_html({"status": "failed"}), "")
        self.assertIn("+5 smaller lines", zf.bill_lines_html(dict(BILL_LINES, more=5)))

    def test_card_summary_line(self):
        it = dict(COVERAGE_ITEMS[2], source_key="drv_govinfo_defense_bills", role="program", bill_lines=BILL_LINES)
        out = zf.card_html(zf.COVERAGE, it)
        self.assertIn('<div class="z-bl-sum">Autonomy lines: H.R. 3838 RH (reported in House): 3 lines, $808.9M (request $780.9M)</div>', out)
        self.assertNotIn("z-bl-sum", zf.card_html(zf.COVERAGE, COVERAGE_ITEMS[0]))


class BillLinesCard(AppBase):
    def test_coverage_card_shows_the_grouped_autonomy_lines(self):
        self.api.items["/v1/feed"][2].update(source_key="drv_govinfo_defense_bills", role="program", bill_lines=BILL_LINES)
        self.run_app()
        self.assertIn("z-bl-sum", self.cards()[2])
        exp = [e for e in self.at.expander if e.label.startswith("Autonomy lines")]
        self.assertEqual([e.label for e in exp], ["Autonomy lines (3, $808.9M)"])
        tables = [m.value for m in exp[0].markdown]
        self.assertEqual(len(tables), 1)
        self.assertIn("<summary>Drones / small UAS: 2 lines, $754.0M (request $726.0M)</summary>", tables[0])
        self.assertNotIn("<script>", tables[0])

    def test_no_counted_amount_is_not_shown_as_zero(self):
        bl = dict(BILL_LINES, totals={"lines": 3, "request": 0, "bill": 0, "change": 0, "request_lines": 0})
        self.api.items["/v1/feed"][2].update(source_key="drv_govinfo_defense_bills", role="program", bill_lines=bl)
        self.run_app()
        self.assertIn("3 lines, no amounts counted", self.cards()[2])
        exp = [e.label for e in self.at.expander if e.label.startswith("Autonomy lines")]
        self.assertEqual(exp, ["Autonomy lines (3, no amounts counted)"])

    def test_a_failed_read_shows_only_the_summary(self):
        self.api.items["/v1/feed"][2].update(bill_lines={"status": "failed", "error": "http_503"})
        self.run_app()
        self.assertIn("could not be read (http_503)", self.cards()[2])
        self.assertFalse([e for e in self.at.expander if e.label.startswith("Autonomy lines")])


# ---- Zenith show (phase 0): Brief page, ops strip, recall --------------------------------
class ShowFunctions(unittest.TestCase):
    def test_brief_since_floors_to_the_hour(self):
        now = datetime(2026, 11, 24, 13, 47, 12, tzinfo=timezone.utc)
        self.assertEqual(zf.brief_since(24, now), "2026-11-23T13:00:00Z")
        self.assertEqual(zf.brief_since(12, now), "2026-11-24T01:00:00Z")
        self.assertEqual(zf.brief_since(72, now), "2026-11-21T13:00:00Z")
        self.assertEqual(zf.BRIEF_WINDOWS, {"12 h": 12, "24 h": 24, "3 days": 72})
        self.assertTrue(zf.brief_since(24).endswith(":00:00Z"))

    def test_brief_item_html_escapes_and_links_only_http(self):
        rows = BRIEF["leads_digests"][0]["items"]
        out = zf.brief_item_html(rows[0])
        self.assertIn("&lt;script&gt;", out)
        self.assertNotIn("<script>", out)
        self.assertIn("&lt;b&gt;award&lt;/b&gt;", out)
        self.assertIn('href="https://example.com/rcat"', out)
        self.assertIn("92 · lead", out)
        self.assertIn('class="z-card lead"', out)
        cross = zf.brief_item_html(rows[1])
        self.assertNotIn("href=", cross)
        self.assertNotIn("javascript", cross)
        self.assertIn('<span class="z-badge src">from UMAC</span>', cross)
        long = zf.brief_item_html({**rows[0], "why": "w" * 400})
        self.assertIn("w" * 239 + "…", long)
        self.assertNotIn("w" * 240, long)

    def test_brief_item_uses_headline_then_title(self):
        rows = BRIEF["leads_digests"][0]["items"]
        self.assertIn("Red Cat signs a supply deal - Contract", zf.brief_item_html(rows[1]))
        self.assertIn("Red Cat wins &lt;script&gt;", zf.brief_item_html(rows[0]))
        cp = zf.brief_counterparty_html(BRIEF["counterparty"][0])
        self.assertIn("<b>KTOS</b> ← customer · 78 · ", cp)
        self.assertIn("Testco orders units", cp)
        label = zf.brief_label_html(BRIEF["to_label"][0])
        self.assertIn("item 11 · <b>RCAT 92</b>", label)
        self.assertIn("<i>top grade</i>", label)
        waiting = zf.brief_waiting_html({"ticker": "SYM", "title": "Testco <x>", "url": "ftp://x", "nm_first_seen": iso(3)})
        self.assertIn("<b>SYM</b> · 3h · Testco &lt;x&gt;", waiting)
        self.assertNotIn("href", waiting)

    def test_brief_health_lines(self):
        lines = zf.brief_health_lines(BRIEF["health"])
        self.assertTrue(lines[0].startswith("Grader last ran "))
        self.assertEqual(lines[1], "12 grades in this window.")
        self.assertEqual(lines[2], "news-monitor: 1 covered source failing.")
        self.assertEqual(lines[3], "  rcat_press (RCAT): 4 fails, last ok Nov 20 10:00 UTC")
        self.assertEqual(zf.brief_health_lines({"news_monitor": {"failing": []}})[-1], "news-monitor: all covered sources OK.")
        self.assertEqual(zf.brief_health_lines({"news_monitor": {"error": "no such table"}})[-1], "news-monitor: unavailable (no such table).")
        self.assertEqual(zf.brief_health_lines(None)[0], "Grader has never run.")

    def test_calendar_groups_dated_weekly_windows(self):
        g = zf.calendar_groups(CALENDAR["entries"], "2026-11-24")
        self.assertEqual([d for d, _ in g["dated"]], ["2026-11-30", "2026-12-08", "2026-12-18"])
        # Within a day: confirmed first, then ticker.
        self.assertEqual([e["ticker"] for e in g["dated"][0][1]], ["RCAT", "MSTR"])
        self.assertEqual([(e["ticker"], e["weekday"]) for e in g["weekly"]], [("MSTR", "Monday")])
        self.assertEqual([e["text"] for e in g["windows"]], ["Expected program award"])
        self.assertEqual(g["long"], 1)
        self.assertEqual(zf.calendar_day_label("2026-11-30"), "Mon Nov 30")

    def test_calendar_hides_status_events_context_and_review_dates_by_default(self):
        g = zf.calendar_groups(CALENDAR["entries"], "2026-11-24")
        texts = [e["text"] for _, es in g["dated"] for e in es]
        for hidden in ("A status event", "A context line", "Review the open item"):
            self.assertNotIn(hidden, texts)
        # A day before today is not listed.
        self.assertEqual(zf.calendar_groups(CALENDAR["entries"], "2026-12-01")["dated"][0][0], "2026-12-08")

    def test_calendar_review_toggle_and_ticker_filter(self):
        g = zf.calendar_groups(CALENDAR["entries"], "2026-11-24", review=True)
        self.assertIn("2026-12-01", [d for d, _ in g["dated"]])
        g = zf.calendar_groups(CALENDAR["entries"], "2026-11-24", ticker="RCAT")
        self.assertEqual([e["ticker"] for _, es in g["dated"] for e in es], ["RCAT"])
        self.assertEqual(g["weekly"], [])
        self.assertEqual(len(g["windows"]), 1)
        self.assertEqual(g["long"], 0)

    def test_calendar_entry_tags(self):
        e = CALENDAR["entries"]
        notice = zf.calendar_entry_html(e[1])
        self.assertIn("confirmed notice", notice)
        self.assertIn("(4:30 pm ET)", notice)
        self.assertIn("&lt;b&gt;results&lt;/b&gt;", notice)
        self.assertNotIn("href", notice)  # a javascript: url gets no link
        agenda = zf.calendar_entry_html(e[2])
        self.assertIn("council agenda (as first seen)", agenda)
        self.assertNotIn("confirmed notice", agenda)
        self.assertIn('href="https://testville.example.gov/26-3"', agenda)
        window = zf.calendar_entry_html(e[8])
        self.assertIn("estimate", window)
        self.assertIn("from Oct 1 to Dec 31 (quarter)", window)
        self.assertIn("deadline", zf.calendar_entry_html(e[10]))
        weekly = zf.calendar_groups(e, "2026-11-24")["weekly"][0]
        self.assertIn("weekly on Monday", zf.calendar_entry_html(weekly))
        self.assertIn("Fri Nov 27", zf.calendar_entry_html(BRIEF["catalysts"][0], show_day=True))

    def test_calendar_entry_html_decided_and_deferred(self):
        # Phase 1 (Legistar vote results): a council agenda closed or deferred by a decision row.
        decided = {**BRIEF["catalysts"][0], "closed": True, "outcome": "2026-11-27 City Council: <b>APPROVED</b> (carried 6-1)",
                   "outcome_day": "2026-11-30", "outcome_url": "https://testville.example.gov/26-3#vote-77", "item_id_outcome": 41}
        out = zf.calendar_entry_html(decided, show_day=True, day_key="outcome_day")
        self.assertIn("decided: 2026-11-27 City Council: &lt;b&gt;APPROVED&lt;/b&gt; (carried 6-1)", out)
        self.assertNotIn("<b>APPROVED", out)
        self.assertNotIn("council agenda (as first seen)", out)
        self.assertNotIn("deferred:", out)
        self.assertIn('href="https://testville.example.gov/26-3#vote-77"', out)
        self.assertIn("Mon Nov 30", out)  # the outcome day, not the agenda day
        self.assertNotIn("Fri Nov 27</span>", out)
        self.assertIn("Fri Nov 27", zf.calendar_entry_html(decided, show_day=True))  # day_key defaults to start
        deferred = {**decided, "closed": None, "deferred": True, "outcome": "2026-11-27 City Council: TABLED (carried 7-0)"}
        out = zf.calendar_entry_html(deferred)
        self.assertIn("deferred: 2026-11-27 City Council: TABLED (carried 7-0)", out)
        self.assertNotIn("decided:", out)
        # Without an outcome_url (or with an unsafe one) the link falls back to the agenda row, or none.
        self.assertIn('href="https://testville.example.gov/26-3"', zf.calendar_entry_html({**decided, "outcome_url": None}))
        self.assertNotIn("href", zf.calendar_entry_html({**decided, "outcome_url": "javascript:alert(1)"}))
        # An undecided agenda keeps its tag and link.
        plain = zf.calendar_entry_html(BRIEF["catalysts"][0])
        self.assertIn("council agenda (as first seen)", plain)
        self.assertIn('href="https://testville.example.gov/26-3"', plain)

    def test_ops_strip_counts_names_and_more(self):
        out = zf.ops_strip_html(NEWS_OPS)
        self.assertIn('News-monitor: <span class="z-bad">2 open alerts</span> (strategic noncompany lane late, '
                      'RCAT release missing for a filing)', out)
        self.assertIn('Managed lane: <span class="z-bad">2 of 120 failing</span>', out)
        many = copy.deepcopy(NEWS_OPS)
        many["alerts"]["open"] = [{"source_key": f"src_{i}", "rule": "outage"} for i in range(5)]
        many["alerts"]["open_count"] = 5
        out = zf.ops_strip_html(many)
        self.assertIn("5 open alerts</span> (src_0 outage, src_1 outage, src_2 outage, +2 more)", out)

    def test_ops_strip_red_only_when_something_is_open(self):
        quiet = {"alerts": {"open": [], "open_count": 0, "bing_open": 2, "resolved_24h": 0},
                 "managed": {"configured": 120, "failing": [], "failing_count": 0}}
        out = zf.ops_strip_html(quiet)
        self.assertNotIn("z-bad", out)
        self.assertIn("News-monitor: no open alerts · Managed lane: 0 of 120 failing", out)

    def test_ops_strip_unavailable_blocks(self):
        self.assertIn("News-monitor: unavailable · Managed lane: <span", zf.ops_strip_html({**NEWS_OPS, "alerts": None}))
        self.assertIn("Managed lane: unavailable", zf.ops_strip_html({**NEWS_OPS, "managed": None}))
        lines = zf.ops_details({"alerts": None, "managed": None})
        self.assertTrue(lines[0].startswith("News-monitor alerts: unavailable"))
        self.assertTrue(lines[1].startswith("Managed lane: unavailable"))

    def test_ops_strip_has_no_grader_gaps(self):
        text = zf.ops_strip_html(NEWS_OPS) + "\n".join(zf.ops_details(NEWS_OPS))
        self.assertNotIn("Grader", text)
        self.assertNotIn("Gaps", text)

    def test_ops_details_lines(self):
        lines = zf.ops_details(NEWS_OPS)
        self.assertEqual(lines[0], "strategic noncompany lane: late, open since Nov 24 01:40 UTC")
        self.assertEqual(lines[1], "RCAT: release missing for a filing, open since Nov 23 17:07 UTC, items 7.01, 9.01, "
                                   "https://www.sec.gov/test-filing")
        self.assertEqual(lines[2], "testco_site: outage, open since Nov 23 00:11 UTC, 4 fails, sitemap 429 <b> (acknowledged)")
        self.assertEqual(lines[3], "Bing feed flaps are left out (1 open now): they clear by themselves in about 18 minutes.")
        self.assertEqual(lines[4], "Managed lane: 2 of 120 sources failing (3 or more fails in a row).")
        self.assertEqual(lines[5], "  Test Robotics <i> (m_testbot): 178 fails, last ok Oct 1, HTTP 404")
        self.assertEqual(lines[6], "  Test Logistics (m_testlog): 84 fails, never ok, HTTP 403")

    def test_alert_name_and_rule_text(self):
        self.assertEqual(zf.alert_name({"source_key": "lane:strategic_noncompany"}), "strategic noncompany lane")
        self.assertEqual(zf.alert_name({"source_key": "ticker:RCAT"}), "RCAT")
        self.assertEqual(zf.alert_name({"source_key": "scale:bing"}), "capacity")
        self.assertEqual(zf.alert_name({"source_key": "testco"}), "testco")
        self.assertEqual(zf.rule_text("silence"), "silent")
        self.assertEqual(zf.rule_text("layout_drift"), "page layout changed")
        self.assertEqual(zf.rule_text("feed_html"), "page, not a feed")
        self.assertEqual(zf.rule_text("some_new_rule"), "some new rule")
        self.assertEqual(zf.detail_text(["7.01", "9.01"]), "7.01, 9.01")
        self.assertEqual(zf.detail_text(50), "50")

    def test_recall_rows_and_summary(self):
        self.assertEqual(zf.recall_rows(RECALL), [["All", 3, 2, 1, 1, 7], ["Filings", 2, 1, 1, 0, 4], ["Releases and news", 1, 1, 0, 1, 3]])
        self.assertEqual(zf.recall_summary(RECALL), "7 events · 3 on time (43%) · 2 late · 1 partial · 1 missed · checked Jan 15")
        self.assertEqual(zf.recall_summary({"total": 0, "by_status": {}}), "0 events · 0 on time · 0 late · 0 partial · 0 missed")


class ShowPages(AppBase):
    def open_page(self, view: str):
        self.run_app()
        self.at.switch_page(f"views/{view}.py")
        return self.run_app()

    def captions(self) -> list[str]:
        return [c.value for c in self.at.caption]

    def texts(self) -> list[str]:
        return [t.value for t in self.at.text]

    def test_brief_is_the_second_page(self):
        text = (APP / "streamlit_app.py").read_text(encoding="utf-8")
        pages = [text.index(f'"views/{p}.py"') for p in ("coverage", "brief", "auxiliary", "tuning")]
        self.assertEqual(pages, sorted(pages))
        self.assertIn('url_path="brief"', text)

    def test_brief_page_sections_and_since_param(self):
        self.open_page("brief")
        calls = self.api.feed_calls("/v1/brief")
        self.assertEqual(len(calls), 1)
        self.assertTrue(calls[0]["since"].endswith(":00:00Z"), calls)
        md = self.page_text()
        for heading in ("#### Brief", "##### Leads and Digests (2)", "##### Counterparty items that passed (1)",
                        "##### Waiting for a grade (0 covered, 0 counterparty)", "##### Next 7 days (1)", "##### Health",
                        "##### Label these (1)", "##### Calendar · next 30 days"):
            self.assertIn(heading, md)
        self.assertLess(md.index("##### Leads and Digests"), md.index("##### Calendar"))
        self.assertIn("&lt;script&gt;", md)
        self.assertNotIn("<script>", md.split("</style>")[-1])
        self.assertNotIn("Discord text", md)
        self.assertIn("Queue is clear.", self.captions())
        self.assertIn("council agenda (as first seen)", md)
        self.assertIn("rcat_press (RCAT): 4 fails, last ok Nov 20 10:00 UTC", [t.strip() for t in self.texts()])
        self.assertTrue(any(c.startswith("Since Nov 23 13:00 UTC · built Nov 24 13:05 UTC") for c in self.captions()))
        self.assertNotIn("pandas", sys.modules)

    def test_brief_page_no_council_outcomes_section_without_the_field(self):
        self.open_page("brief")  # the fixture has no council_outcomes (an older zenith-core)
        self.assertNotIn("Council outcomes", self.page_text())
        self.assertFalse(self.at.exception, [e.value for e in self.at.exception])

    def test_brief_page_council_outcomes_section(self):
        self.api.routes["/v1/brief"]["council_outcomes"] = [
            {"ticker": "AXON", "kind": "council_agenda", "start": "2026-11-20", "end": "2026-11-20", "precision": "day",
             "confirmed": True, "text": "[AXON] Testville City Council 26-5: Axon contract — Agenda Ready, agenda 2026-11-20",
             "url": "https://testville.example.gov/26-5", "item_id": 42, "deferred": True,
             "outcome": "2026-11-23 City Council: TABLED (carried 7-0)", "outcome_day": "2026-11-23",
             "outcome_url": "https://testville.example.gov/26-5#vote-78", "item_id_outcome": 43}]
        self.open_page("brief")
        md = self.page_text()
        self.assertIn("##### Council outcomes, last 7 days (1)", md)
        self.assertLess(md.index("##### Next 7 days"), md.index("##### Council outcomes"))
        self.assertLess(md.index("##### Council outcomes"), md.index("##### Health"))
        self.assertIn("deferred: 2026-11-23 City Council: TABLED (carried 7-0)", md)
        self.assertIn("Mon Nov 23", md)
        self.assertIn('href="https://testville.example.gov/26-5#vote-78"', md)

    def test_brief_window_switch_changes_since(self):
        self.open_page("brief")
        first = self.api.feed_calls("/v1/brief")[-1]["since"]
        self.at.segmented_control(key="brief-window").set_value("3 days").run()
        self.assertFalse(self.at.exception, [e.value for e in self.at.exception])
        second = self.api.feed_calls("/v1/brief")[-1]["since"]
        gap = datetime.fromisoformat(first.replace("Z", "+00:00")) - datetime.fromisoformat(second.replace("Z", "+00:00"))
        self.assertEqual(gap, timedelta(hours=48))

    def test_brief_page_not_available_yet(self):
        self.api.missing = {"/v1/brief"}
        self.open_page("brief")
        self.assertIn("Brief not available yet.", self.captions())
        md = self.page_text()
        self.assertIn("##### Calendar · next 30 days", md)
        self.assertIn("Mon Nov 30", md)

    def test_brief_page_calendar_section_and_company_filter(self):
        self.open_page("brief")
        self.assertEqual(self.api.feed_calls("/v1/calendar"), [{"days": 30}])
        md = self.page_text()
        for text in ("Mon Nov 30", "Tue Dec 8", "Test index change takes effect", "Weekly holdings 8-K", "confirmed notice"):
            self.assertIn(text, md)
        self.assertNotIn("Review the open item", md)
        self.assertNotIn("A status event", md)
        self.assertEqual([e.label for e in self.at.expander if e.label.startswith("Windows")], ["Windows open in the next 30 days (1)"])
        self.assertEqual(self.at.selectbox(key="cal-ticker").options, ["All", "RCAT", "UMAC", "KTOS"])
        self.at.selectbox(key="cal-ticker").set_value("RCAT").run()
        md = self.page_text().split("##### Calendar")[-1]
        self.assertIn("Red Cat to report", md)
        self.assertNotIn("Test index change", md)
        self.assertNotIn("Weekly holdings", md)
        self.at.toggle(key="cal-review").set_value(True)
        self.at.selectbox(key="cal-ticker").set_value("UMAC").run()
        self.assertIn("Review the open item", self.page_text())

    def test_coverage_shows_the_ops_strip_after_the_grader_strip(self):
        self.run_app()
        md = self.page_text()
        self.assertIn("News-monitor: <span", md)
        self.assertLess(md.index("Grader: last run"), md.index("News-monitor:"))
        self.assertEqual(len(self.api.feed_calls("/v1/news-ops")), 1)
        self.assertEqual(len(self.api.feed_calls("/v1/ops")), 1)
        self.assertIn("Bing feed flaps are left out (1 open now): they clear by themselves in about 18 minutes.", self.texts())

    def test_ops_strip_not_available_yet(self):
        self.api.missing.add("/v1/news-ops")
        self.run_app()
        self.assertIn("News-monitor ops not available yet", self.captions())
        self.assertEqual(len(self.cards()), 3)

    def test_tuning_shows_recall_last(self):
        self.open_page("tuning")
        md = self.page_text()
        self.assertIn("##### Recall", md)
        self.assertLess(md.index("##### Grader"), md.index("##### Recall"))
        self.assertIn("7 events · 3 on time (43%) · 2 late · 1 partial · 1 missed · checked Jan 15", md)
        self.assertIn("<td>Releases and news</td>", md)
        self.assertNotIn("Test event", md)
        self.assertEqual(self.api.feed_calls("/v1/recall"), [{}])

    def test_recall_not_loaded_yet(self):
        self.api.routes["/v1/recall"] = {"total": 0, "by_status": {}, "by_kind": [], "by_ticker": [], "sources": []}
        self.open_page("tuning")
        self.assertIn("Recall scoreboard not loaded yet.", [i.value for i in self.at.info])

    def test_recall_not_available_yet(self):
        self.api.missing.add("/v1/recall")
        self.open_page("tuning")
        self.assertIn("Recall not available yet.", self.captions())
