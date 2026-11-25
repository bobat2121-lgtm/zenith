"""Zenith — four pages: Coverage Universe, Brief, Auxiliary Names, Tuning.

Coverage Universe (default): the covered universe, from zenith-core's /v1/feed,
labels to /v1/feedback. Brief: the brief as data from /v1/brief (no model,
nothing sent anywhere) and the next 30 days from /v1/calendar. Auxiliary Names:
material news on every other company or program news-monitor follows, from
/v1/aux/feed, labels to /v1/aux/feedback. Both feeds read /v1/stats; the
Coverage page also reads /v1/source-health, /v1/site-changes, /v1/ops and
/v1/news-ops (news-monitor alerts and the managed lane). Tuning reads
/v1/calibration, /v1/expansion/candidates, /v1/source-yield, /v1/left-out,
/v1/ops and /v1/recall (counts only), and saves /v1/expansion/decide,
/v1/source-prefs and /v1/left-out/grade. These are the only routes the app
calls; the app token may also call /v1/expansion/compiled, which only the
weekly compile uses (the recall loader is an admin route the app never calls). Shared code lives in zenith_feed.py; the
pages are in views/.
Configure with .streamlit/secrets.toml (ZENITH_API, ZENITH_APP_TOKEN) or the
same names as environment variables.
"""
from __future__ import annotations

from pathlib import Path

import streamlit as st

from zenith_feed import api_base, setting

st.set_page_config(page_title="Zenith", page_icon="⚡", layout="centered")

css = Path(__file__).with_name("feed.css")
if css.exists():
    st.markdown(f"<style>{css.read_text(encoding='utf-8')}</style>", unsafe_allow_html=True)

if not api_base() or not setting("ZENITH_APP_TOKEN"):
    st.error("Set ZENITH_API and ZENITH_APP_TOKEN in .streamlit/secrets.toml.")
    st.stop()

st.navigation([
    st.Page("views/coverage.py", title="Coverage Universe", icon=":material/star:", default=True),
    st.Page("views/brief.py", title="Brief", icon=":material/today:", url_path="brief"),
    st.Page("views/auxiliary.py", title="Auxiliary Names", icon=":material/travel_explore:", url_path="auxiliary"),
    st.Page("views/tuning.py", title="Tuning", icon=":material/tune:", url_path="tuning"),
], position="top").run()
