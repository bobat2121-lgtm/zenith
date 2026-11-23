"""Zenith app tests: unittest + Streamlit AppTest, with `requests` mocked (no network).

Run from the repository root:
  app/.venv/Scripts/python -m unittest discover -s app/tests -v
"""
from __future__ import annotations

import copy
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
                       "/v1/source-yield": copy.deepcopy(SOURCE_YIELD), "/v1/left-out": left_out}
        self.gets, self.posts = [], []
        self.post_status = 200
        self.post_errors: dict[str, tuple[int, str]] = {}
        self.missing: set[str] = set()

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
        items = copy.deepcopy(self.items[path])
        if params.get("unlabeled") == "1":
            # Labelled cards leave an unlabeled feed (To label, Unlabeled only).
            done = {b["item_id"] for p, b, _ in self.posts if p.endswith("/feedback")}
            items = [i for i in items if i["item_id"] not in done and not i.get("label")]
        if params.get("sort") == "to_label":
            items = [i for i in items if i.get("state") == "graded"]
        return Resp({"items": items, "next_before_id": None})

    def post(self, url, headers=None, json=None, timeout=None):
        path = url.removeprefix(API)
        self.posts.append((path, json, dict(headers or {})))
        if path in self.post_errors:
            status, error = self.post_errors[path]
            return Resp({"error": error}, status)
        if path == "/v1/source-prefs" and self.post_status < 400:
            # The saved preference comes back on the next /v1/source-yield.
            for row in self.routes["/v1/source-yield"]["coverage"] + self.routes["/v1/source-yield"]["aux"]:
                if row["source_key"] == json["source_key"]:
                    row["pref"] = None if json["action"] == "normal" else json["action"]
        return Resp({"ok": True} if self.post_status < 400 else {"error": "bad"}, self.post_status)

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
        self.assertEqual(zf.label_choices({"band": None}), [])
        self.assertEqual(zf.label_choices({"band": "duplicate", "score": None}), ["high", "medium", "low", "noise"])
        self.assertEqual(zf.label_choices({"band": "digest", "score": 75}),
                         ["high", "medium", "low", "noise", "too_high", "too_low"])

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
        self.assertEqual([t.value for t in self.at.toast], ["Labeled High"])

    def test_label_control_shows_server_label_and_directional_only_when_scored(self):
        self.run_app()
        scored = self.at.segmented_control(key="cov-lbl-11-RCAT")
        self.assertEqual(scored.options, ["High", "Medium", "Low", "Noise", "Too high", "Too low"])
        dup = self.at.segmented_control(key="cov-lbl-10-UMAC")
        self.assertEqual(dup.options, ["High", "Medium", "Low", "Noise"])
        self.assertEqual(dup.value, "noise")
        # The pending card has no label control.
        self.assertEqual(len(self.at.segmented_control), 3)  # mode switch + two graded cards

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
        self.at.button(key="cov-lbl-11-RCAT:save").click()
        self.run_app()
        self.assertEqual(self.api.posts[-1][:2], ("/v1/feedback", {"item_id": 11, "label": "medium",
                                                                  "note": "Sole-source; moves FY27 numbers",
                                                                  "ticker": "RCAT", "grade_id": 101}))
        self.assertEqual([t.value for t in self.at.toast], ["Saved"])

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
        self.at.button(key="aux-lbl-501:save").click()
        self.run_app()
        self.assertEqual(self.api.posts[-1][:2], ("/v1/aux/feedback", {"item_id": 501, "label": "high",
                                                                      "note": "Raises the bar for RCAT's next round"}))
        # The pending auxiliary card has no label control.
        self.assertEqual([w.key for w in self.at.segmented_control], ["aux-mode", "aux-lbl-501"])

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
        # Confidence < 0.6 first; then 60-79 nearest 70; then the rest by score desc.
        self.assertEqual(ordered, [2, 8, 4, 3, 5, 1, 6, 7])
        merged = zf.merge_items([[items[0], items[2]], [items[1], items[0]]], "to_label")
        self.assertEqual([i["item_id"] for i in merged], [2, 3, 1])
        # The other sorts keep pinned Leads first, then newest.
        self.assertEqual([i["item_id"] for i in zf.merge_items([[items[0], items[2]], [items[1]]])], [3, 2, 1])

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
        self.assertEqual(lines[:3], ["Gaps over 2 h between grader runs, last 7 days: 2.",
                                     "  Nov 23 08:11 UTC to Nov 23 14:05 UTC (5.9 h)", "  Nov 20 01:00 UTC to Nov 20 04:00 UTC (3 h)"])
        self.assertIn("usage limit refused the hourly grader run", lines[-1])
        self.assertEqual(zf.gap_lines({"grader": {"gaps_7d": None}})[0], "No gaps over 2 h between grader runs in the last 7 days.")
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
        self.assertTrue(any("usage limit refused the hourly grader run" in t for t in self.texts()))
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

    # A3 ----------------------------------------------------------------------------
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
        self.assertIn("No gaps over 2 h between grader runs in the last 7 days.", self.captions())


if __name__ == "__main__":
    unittest.main()
