"""Phase 1 grader banner: unit tests and AppTest pages (synthetic fixtures only).

Run from the repository root:
  app/.venv/Scripts/python -m unittest discover -s app/tests -v
"""
from __future__ import annotations

import copy
import sys
import unittest
from pathlib import Path

APP = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(APP))
sys.path.insert(0, str(Path(__file__).resolve().parent))

import zenith_feed as zf  # noqa: E402
import test_app as ta  # noqa: E402  (fixtures and the AppTest base; imported as a module so its tests do not run twice)

iso = ta.iso


def ops_p1(**grader) -> dict:
    """The phase 0 OPS fixture plus the phase 1 /v1/ops fields, all healthy."""
    ops = copy.deepcopy(ta.OPS)
    g = ops["grader"]
    g.update(expected_every_min=30, open_gap=None, last_run_unfinished=False,
             grades_today={"coverage": {"n": 12, "regrade": 1, "budgeted": 4, "fast_path": 7, "own_lane": 5},
                           "aux": {"n": 3, "regrade": 0, "budgeted": 1, "fast_path": 2, "own_lane": 0},
                           "top_sources": [{"source_key": "test_src_a", "n": 4}]})
    g["backlog"].update(stuck_claims={"coverage": 0, "aux": 0}, stale_claims={"coverage": 0, "aux": 0},
                        oldest_coverage_waiting_at=None, coverage_held=2, aux_held=0, released_today=20,
                        budget={"total": 20, "per_source": 5, "guard": 60},
                        released_by_source_today=[{"source_key": "test_src_b", "n": 3, "per_source": 5},
                                                  {"source_key": "test_src_a", "n": 4, "per_source": 5}])
    g.update(grader)
    return ops


def missed(minutes: float, n: int = 1, every: int = 30, status: str = "late", **extra) -> dict:
    """A grader that last ran `minutes` ago and has missed `n` runs."""
    since = iso(minutes / 60)
    return ops_p1(status=status, last_run_at=since,
                  open_gap={"from": since, "minutes": minutes, "missed_runs": n, "expected_every_min": every}, **extra)


class BannerFunctions(unittest.TestCase):
    def test_banner_hidden_when_ok(self):
        # The phase 0 fixture: status ok, no phase 1 fields, a failing queue_stale check.
        self.assertEqual([c["state"] for c in ta.OPS["grader"]["checks"]], ["ok", "fail"])
        self.assertIsNone(zf.grader_alert(ta.OPS))
        self.assertEqual(zf.grader_banner_html(ta.OPS), "")
        self.assertIsNone(zf.grader_alert(ops_p1()))
        for junk in (None, {}, [], {"grader": "x"}, {"grader": {}}):
            self.assertIsNone(zf.grader_alert(junk))

    def test_banner_open_gap_text(self):
        ops = missed(40)
        text = zf.grader_alert(ops)
        since = ops["grader"]["open_gap"]["from"]
        self.assertEqual(text, f"Grader missed 1 run: last activity {zf.utc_text(since)} (40 min ago), expected every 30 min")
        self.assertNotIn("ago ago", text)
        self.assertFalse(text.startswith("Grader:"))
        self.assertTrue(zf.grader_alert(missed(70, n=2)).startswith("Grader missed 2 runs: last activity "))

    def test_banner_down_and_unfinished(self):
        ops = missed(300, n=9, status="down", last_run_unfinished=True)
        ops["grader"]["backlog"]["stuck_claims"] = {"coverage": 2, "aux": 0}
        text = zf.grader_alert(ops)
        self.assertTrue(text.startswith("Grader down: missed 9 runs, last activity "), text)
        self.assertIn("(5h ago), expected every 30 min", text)
        self.assertTrue(text.endswith(" · Last run stopped part-way: 2 coverage items claimed over 15 min ago and not returned"),
                        text)
        # Unfinished alone, status ok: one coverage item.
        ok = ops_p1(last_run_unfinished=True)
        ok["grader"]["backlog"]["stuck_claims"] = {"coverage": 1, "aux": 0}
        self.assertEqual(zf.grader_alert(ok),
                         "Last run stopped part-way: 1 coverage item claimed over 15 min ago and not returned")

    def test_banner_old_ops_fallback(self):
        ops = copy.deepcopy(ta.OPS)
        ops["grader"].update(status="late", last_run_at=iso(2))
        self.assertEqual(zf.grader_alert(ops), "Grader late: last run 2h ago")
        ops["grader"].update(status="down", last_run_at=None)
        self.assertEqual(zf.grader_alert(ops), "Grader down: no run recorded")

    def test_banner_escapes_server_text(self):
        ops = ops_p1(status="down", last_run_at="<script>x</script>",
                     open_gap={"from": "<script>x</script>", "missed_runs": "<b>", "expected_every_min": "<i>"})
        out = zf.grader_banner_html(ops)
        self.assertTrue(out.startswith('<div class="z-banner">Grader down: missed 1 run, last activity '), out)
        self.assertNotIn("<script>", out)
        self.assertIn("&lt;script&gt;", out)
        old = copy.deepcopy(ta.OPS)
        old["grader"].update(status="late", last_run_at="<img src=x>")
        self.assertNotIn("<img", zf.grader_banner_html(old))

    def test_banner_ignores_aux_only_stuck_and_stale_claims(self):
        ops = ops_p1()
        ops["grader"]["backlog"].update(stuck_claims={"coverage": 0, "aux": 13}, stale_claims={"coverage": 0, "aux": 13})
        self.assertIsNone(zf.grader_alert(ops))
        self.assertIn("Claims not returned after 15 min: coverage 0, auxiliary 13 (lease expired: 0/13).",
                      zf.grader_details(ops))
        # All zero: no claims line.
        self.assertFalse(any(x.startswith("Claims not returned") for x in zf.grader_details(ops_p1())))

    def test_gap_lines_open_gap_first(self):
        ops = missed(300, n=9, status="down")
        ops["grader"]["gaps_7d"] = []
        lines = zf.gap_lines(ops)
        since = zf.utc_text(ops["grader"]["open_gap"]["from"])
        self.assertEqual(lines[0], f"Now: no run since {since} (9 missed, expected every 30 min).")
        self.assertFalse(any(x.startswith("No missed") for x in lines), lines)
        self.assertEqual(lines[1], "No earlier missed grader runs in the last 7 days.")
        ops["grader"]["gaps_7d"] = [{"from": "2026-11-23T08:11:00Z", "to": "2026-11-23T14:05:00Z", "hours": 5.9,
                                     "missed_runs": 10, "expected_every_min": 30}]
        lines = zf.gap_lines(ops)
        self.assertEqual(lines[1:3], ["Missed grader runs, last 7 days: 1.", "  Nov 23 08:11 UTC to Nov 23 14:05 UTC (5.9 h, 10 missed)"])
        self.assertIn("a scheduled grader run", lines[-1])
        # No open gap: the popover starts with the count, as before.
        self.assertEqual(zf.gap_lines(ops_p1())[0], "Missed grader runs, last 7 days: 2.")

    def test_strip_shows_budget_use(self):
        out = zf.grader_strip_html(ops_p1())
        self.assertIn("Headlines waiting 239 · Budget 20/20 today (max 4/5 per source)</div>", out)
        self.assertNotIn("z-bad", out)
        # No per-source rows: the total alone; an older zenith-core: no budget part.
        ops = ops_p1()
        ops["grader"]["backlog"]["released_by_source_today"] = []
        self.assertIn("Budget 20/20 today</div>", zf.grader_strip_html(ops))
        self.assertNotIn("Budget", zf.grader_strip_html(ta.OPS))

    def test_strip_red_with_missed_runs(self):
        self.assertIn('Grader: <span class="z-bad">late · 2 runs missed · last run 1h ago</span>',
                      zf.grader_strip_html(missed(70, n=2)))
        self.assertIn('<span class="z-bad">late · 1 run missed · last run 40 min ago</span>', zf.grader_strip_html(missed(40)))

    def test_grader_details_grades_today_per_source_and_source_cap_held(self):
        details = zf.grader_details(ops_p1())
        self.assertIn("Expected every 30 min.", details)
        self.assertIn("Grades today (UTC): coverage 12 (budgeted 4, fast path 7, re-grades 1, own lane 5); "
                      "auxiliary 3 (budgeted 1, fast path 2, re-grades 0, own lane 0).", details)
        self.assertIn("Released today by source: test_src_a 4/5, test_src_b 3/5.", details)
        self.assertFalse(any(x.startswith("Held by the source cap") for x in details))
        ops = ops_p1()
        ops["grader"]["backlog"]["source_cap_held"] = 3
        self.assertIn("Held by the source cap: 3 (hidden from the feeds until released, at most 5 per source a day).",
                      zf.grader_details(ops))
        ops["grader"]["backlog"]["source_cap_held"] = 0
        self.assertFalse(any(x.startswith("Held by the source cap") for x in zf.grader_details(ops)))
        # An older zenith-core: none of the phase 1 lines.
        old = zf.grader_details(ta.OPS)
        for start in ("Expected every", "Grades today", "Released today by source", "Claims not returned", "Held by the source cap"):
            self.assertFalse(any(x.startswith(start) for x in old), start)


class BannerPages(ta.AppBase):
    PAGES = ("coverage", "brief", "auxiliary", "tuning")

    def banners(self) -> list[str]:
        return [m.value for m in self.at.markdown if 'class="z-banner"' in m.value]

    def open_page(self, view: str):
        self.run_app()
        if view != "coverage":
            self.at.switch_page(f"views/{view}.py")
            self.run_app()
        return self.at

    def test_banner_on_all_four_pages_when_down(self):
        down = missed(300, n=9, status="down")
        for view in self.PAGES:
            with self.subTest(view=view):
                self.setUp()
                self.api.routes["/v1/ops"] = copy.deepcopy(down)
                self.open_page(view)
                banners = self.banners()
                self.assertEqual(len(banners), 1, view)
                self.assertIn("Grader down: missed 9 runs, last activity ", banners[0])
                # Above the page's own heading.
                md = self.page_text()
                heading = {"coverage": f"#### {zf.COVERAGE.title}", "brief": "#### Brief",
                           "auxiliary": f"#### {zf.AUXILIARY.title}", "tuning": "#### Tuning"}[view]
                self.assertLess(md.index('class="z-banner"'), md.index(heading), view)

    def test_banner_hidden_on_every_page_when_ok(self):
        for view in self.PAGES:
            with self.subTest(view=view):
                self.setUp()
                self.api.routes["/v1/ops"] = ops_p1()
                self.open_page(view)
                self.assertEqual(self.banners(), [], view)

    def test_banner_hidden_before_ops_exists(self):
        self.api.missing.add("/v1/ops")
        self.open_page("brief")
        self.assertEqual(self.banners(), [])

    def test_banner_from_an_older_worker(self):
        self.api.routes["/v1/ops"]["grader"].update(status="late", last_run_at=ta.iso(2))
        self.open_page("brief")
        self.assertEqual(self.banners(), ['<div class="z-banner">Grader late: last run 2h ago</div>'])

    def test_tuning_shows_aux_claims_without_banner(self):
        ops = ops_p1()
        ops["grader"]["backlog"].update(stuck_claims={"coverage": 0, "aux": 13}, stale_claims={"coverage": 0, "aux": 13})
        self.api.routes["/v1/ops"] = ops
        self.open_page("tuning")
        self.assertEqual(self.banners(), [])
        texts = [t.value for t in self.at.text]
        self.assertIn("Claims not returned after 15 min: coverage 0, auxiliary 13 (lease expired: 0/13).", texts)
        self.assertIn("Expected every 30 min.", texts)

    def test_tuning_open_gap_line_and_caption(self):
        ops = missed(300, n=9, status="down")
        ops["grader"]["gaps_7d"] = []
        self.api.routes["/v1/ops"] = ops
        self.open_page("tuning")
        self.assertTrue(any(t.value.startswith("Now: no run since ") for t in self.at.text))
        captions = [c.value for c in self.at.caption]
        self.assertIn("No earlier missed grader runs in the last 7 days.", captions)
        self.assertNotIn("No missed grader runs in the last 7 days.", captions)

    def test_coverage_first_get_is_still_stats(self):
        self.api.routes["/v1/ops"] = missed(300, n=9, status="down")
        self.run_app()
        self.assertEqual(len(self.banners()), 1)
        path, _, headers = self.api.gets[0]
        self.assertEqual((path, headers["authorization"]), ("/v1/stats", f"Bearer {ta.TOKEN}"))
        # One /v1/ops call per run: the banner and the strip share the cache.
        self.assertEqual(len(self.api.feed_calls("/v1/ops")), 1)


if __name__ == "__main__":
    unittest.main()
