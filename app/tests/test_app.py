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
        self.gets, self.posts = [], []
        self.post_status = 200
        self.missing: set[str] = set()

    def get(self, url, headers=None, params=None, timeout=None):
        path = url.removeprefix(API)
        self.gets.append((path, dict(params or {}), dict(headers or {})))
        if path in self.missing:
            return Resp({"error": "not found"}, 404)
        if path == "/v1/stats":
            return Resp(self.stats)
        if path == "/v1/source-health":
            return Resp(self.health)
        return Resp({"items": copy.deepcopy(self.items[path]), "next_before_id": None})

    def post(self, url, headers=None, json=None, timeout=None):
        self.posts.append((url.removeprefix(API), json, dict(headers or {})))
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
class AppPages(unittest.TestCase):
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


if __name__ == "__main__":
    unittest.main()
