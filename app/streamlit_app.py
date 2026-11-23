"""Zenith — graded research feeds in two pages.

Coverage Universe (default): the covered universe, from zenith-core's /v1/feed,
labels to /v1/feedback. Auxiliary Names: material news on every other company
or program news-monitor follows, from /v1/aux/feed, labels to
/v1/aux/feedback. Both read /v1/stats. These are the only routes the app token
may use. Shared code lives in zenith_feed.py; the pages are in views/.
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
    st.Page("views/auxiliary.py", title="Auxiliary Names", icon=":material/travel_explore:", url_path="auxiliary"),
], position="top").run()
