"""Phase 2 story dedup: Left out names story copies (skip reason `story_dup`, `copy_of`).
Pure helpers only: no network, no Streamlit run, no pandas.

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

COPY = {"id": 12, "kind": "coverage", "ticker": "ACME", "source_key": "acme_wire", "url": "https://example.com/acme-copy",
        "title": "Acme Robotics wins <pilot> order", "first_seen": "2026-01-02T03:04:05Z", "skip_reason": "story_dup",
        "copy_of": 7}


class StoryLeftOutTest(unittest.TestCase):
    def test_skip_text_names_story_dup(self):
        self.assertEqual(zf.SKIP_TEXT["story_dup"], "Copy of a queued story")
        self.assertEqual(zf.skip_text("story_dup"), "Copy of a queued story")
        self.assertIn("Copy of a queued story 3", zf.left_out_counts_html({"story_dup": 3}))

    def test_left_out_item_names_the_canonical(self):
        out = zf.left_out_item_html(COPY)
        self.assertIn('<span class="z-badge reject">Copy of a queued story</span>', out)
        self.assertIn("copy of item 7</span>", out)
        self.assertIn('href="https://example.com/acme-copy"', out)
        self.assertIn("Acme Robotics wins &lt;pilot&gt; order</a>", out)
        self.assertIn("copy of item 7", zf.left_out_item_html({**COPY, "copy_of": "7"}))

    def test_no_copy_line_when_absent(self):
        # An older Worker sends no copy_of; other skip reasons carry none either.
        old = {k: v for k, v in COPY.items() if k != "copy_of"}
        self.assertNotIn("copy of item", zf.left_out_item_html(old))
        self.assertNotIn("copy of item", zf.left_out_item_html({**COPY, "copy_of": None}))
        self.assertNotIn("copy of item", zf.left_out_item_html({**COPY, "skip_reason": "muted_source", "copy_of": None}))

    def test_copy_of_is_an_escaped_int(self):
        for bad in ("<b>7</b>", "7; x", "", "abc", 0, -3, True, 1.5j):
            self.assertIsNone(zf.copy_of_id({"copy_of": bad}), bad)
            self.assertNotIn("copy of item", zf.left_out_item_html({**COPY, "copy_of": bad}))
        self.assertEqual(zf.copy_of_id({"copy_of": 42}), 42)
        self.assertEqual(zf.copy_of_id({"copy_of": " 42 "}), 42)
        self.assertNotIn("<b>7", zf.left_out_item_html({**COPY, "copy_of": "<b>7</b>"}))


if __name__ == "__main__":
    unittest.main()
