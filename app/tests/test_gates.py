"""Phase 0 gates: the app's pure helpers for the new skip label (plans/phase0-build-spec.md,
Appendix A section 7). No network, no Streamlit run, no pandas.

Run from the repository root:
  app/.venv/Scripts/python -m unittest discover -s app/tests -v
"""
from __future__ import annotations

import sys
import unittest
from pathlib import Path

APP = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(APP))

import zenith_feed as zf  # noqa: E402


class UndatedBurstTest(unittest.TestCase):
    def test_skip_text_names_undated_burst(self):
        self.assertEqual(zf.SKIP_TEXT["undated_burst"], "Undated burst")
        self.assertEqual(zf.skip_text("undated_burst"), "Undated burst")
        self.assertEqual(zf.skip_text("archive_seed"), "Archive seed")

    def test_left_out_counts_treats_undated_burst_like_archive_seed(self):
        counts = {"stale_on_arrival": 40, "undated_burst": 12, "archive_seed": 900, "muted_source": 3, "grading_failed": 0}
        rows, archive = zf.left_out_counts(counts)
        self.assertEqual(rows, [("stale_on_arrival", 40), ("muted_source", 3)])
        self.assertEqual(archive, 912)
        self.assertEqual(zf.left_out_counts({"undated_burst": 5}), ([], 5))
        self.assertEqual(zf.left_out_counts(None), ([], 0))

    def test_left_out_counts_html_keeps_undated_burst_out_of_the_main_line(self):
        out = zf.left_out_counts_html({"undated_burst": 4, "rival_no_key_account": 2})
        self.assertIn("Rival, no key account 2", out)
        self.assertNotIn("Undated burst", out)
        self.assertIn(": 4</div>", out)

    def test_no_pandas(self):
        self.assertNotIn("pandas", sys.modules)


# Integration I-4 (plans/phase0-build-spec.md section 6): the held line in the Grader section.
BACKLOG = {"coverage_pending": 4, "aux_pending": 6, "headlines_waiting": 2}
BACKLOG_LINE = "Backlog: 4 coverage items pending, 6 auxiliary pending, 2 graded cards waiting for a headline."


class GraderHeldTest(unittest.TestCase):
    def test_grader_details_shows_held_and_budget(self):
        backlog = {**BACKLOG, "coverage_held": 3, "aux_held": 9, "released_today": 7,
                   "budget": {"total": 20, "per_source": 5, "guard": 60}, "double_graded_24h": 1}
        details = zf.grader_details({"grader": {"status": "ok", "backlog": backlog}})
        self.assertIn(BACKLOG_LINE + " 12 held for the daily grading budget (7 released today of 20).", details)
        # Fields from an older or partial zenith-core: no released_today, or no budget.
        self.assertEqual(zf.held_budget_text({"aux_held": 2}), " 2 held for the daily grading budget.")
        self.assertEqual(zf.held_budget_text({"coverage_held": 1, "released_today": 4}),
                         " 1 held for the daily grading budget (4 released today).")
        self.assertEqual(zf.held_budget_text({"coverage_held": "<b>x</b>", "aux_held": None, "released_today": 0, "budget": {"total": 20}}),
                         " 0 held for the daily grading budget (0 released today of 20).")

    def test_grader_details_without_held_fields_is_unchanged(self):
        details = zf.grader_details({"grader": {"status": "ok", "backlog": dict(BACKLOG)}})
        self.assertIn(BACKLOG_LINE, details)
        self.assertFalse(any("held" in line for line in details))
        self.assertEqual(zf.held_budget_text(None), "")
        self.assertEqual(zf.held_budget_text({"released_today": 3, "budget": {"total": 20}}), "")

    def test_no_pandas_after_grader_details(self):
        self.assertNotIn("pandas", sys.modules)


if __name__ == "__main__":
    unittest.main()
