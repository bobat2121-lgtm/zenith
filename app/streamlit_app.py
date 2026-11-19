"""Zenith — graded research feed for the covered universe.

Reads zenith-core's /v1/feed and posts analyst labels to /v1/feedback.
Configure with .streamlit/secrets.toml (ZENITH_API, ZENITH_APP_TOKEN) or the
same names as environment variables.
"""
from __future__ import annotations

import html
import os
from datetime import datetime, timedelta, timezone
from pathlib import Path

import requests
import streamlit as st

st.set_page_config(page_title="Zenith", page_icon="⚡", layout="centered")


def setting(name: str) -> str:
    try:
        if name in st.secrets:
            return str(st.secrets[name])
    except Exception:
        pass
    return os.environ.get(name, "")


API = setting("ZENITH_API").rstrip("/")
TOKEN = setting("ZENITH_APP_TOKEN")
HEADERS = {"authorization": f"Bearer {TOKEN}"}
LABELS = [("high", "High"), ("medium", "Medium"), ("low", "Low"), ("noise", "Noise")]
VIEWS = {
    "For you": {"min_score": 70},
    "Latest": {},
    "Label queue": {"unlabeled": "1", "state": "graded"},
    "Lead only": {"min_score": 90},
}

css = Path(__file__).with_name("feed.css")
if css.exists():
    st.markdown(f"<style>{css.read_text(encoding='utf-8')}</style>", unsafe_allow_html=True)

if not API or not TOKEN:
    st.error("Set ZENITH_API and ZENITH_APP_TOKEN in .streamlit/secrets.toml.")
    st.stop()


@st.cache_data(ttl=30, show_spinner=False)
def get_json(path: str, params: tuple) -> dict:
    r = requests.get(f"{API}{path}", headers=HEADERS, params=dict(params), timeout=20)
    r.raise_for_status()
    return r.json()


def post_label(item_id: int, label: str, note: str | None = None) -> None:
    r = requests.post(f"{API}/v1/feedback", headers=HEADERS, json={"item_id": item_id, "label": label, "note": note or None}, timeout=20)
    r.raise_for_status()
    get_json.clear()


def ago(iso: str | None) -> str:
    if not iso:
        return ""
    try:
        t = datetime.fromisoformat(iso.replace("Z", "+00:00"))
    except ValueError:
        return iso[:10]
    s = (datetime.now(timezone.utc) - t).total_seconds()
    if s < 3600:
        return f"{max(1, int(s // 60))}m"
    if s < 86400:
        return f"{int(s // 3600)}h"
    if s < 86400 * 7:
        return f"{int(s // 86400)}d"
    return t.strftime("%b %d")


def source_badge(key: str) -> str:
    if key.startswith("edgar_") or key.endswith("_sec_northland"):
        return "SEC"
    if key.endswith("_press") or key in ("mbody", "draganfly"):
        return "Wire"
    return "Issuer"


# ---- sidebar ---------------------------------------------------------------
with st.sidebar:
    st.markdown('<div class="z-brand">ZEN<span>I</span>TH</div><div class="z-sub">covered-universe research feed</div>', unsafe_allow_html=True)
    st.write("")
    view = st.radio("View", list(VIEWS), index=0, label_visibility="collapsed")
    try:
        stats = get_json("/v1/stats", ())
    except Exception as e:  # noqa: BLE001
        st.error(f"API unavailable: {e}")
        st.stop()
    tickers = st.multiselect("Companies", stats.get("tickers", []), placeholder="All covered companies")
    if view == "For you":
        min_score = st.select_slider("Signal", options=[60, 70, 80], value=70,
                                     format_func=lambda v: {60: "Broad 60+", 70: "Balanced 70+", 80: "Tight 80+"}[v])
    else:
        min_score = None
    st.divider()
    states = {s["state"]: s["n"] for s in stats.get("by_state", [])}
    bands = {b["band"]: b["n"] for b in stats.get("by_band", [])}
    c1, c2 = st.columns(2)
    c1.metric("Graded", states.get("graded", 0))
    c2.metric("Waiting", states.get("pending", 0) + states.get("claimed", 0))
    c1.metric("Lead", bands.get("lead", 0))
    c2.metric("Your labels", stats.get("labels", 0))
    run = stats.get("last_run") or {}
    st.caption(f"Rubric {stats.get('rubric_version')} · last grader run {ago(run.get('last_seen_at')) or 'never'}"
               + (" ago" if run.get("last_seen_at") else ""))
    if st.button("Refresh"):
        get_json.clear()
        st.rerun()

# ---- feed ------------------------------------------------------------------
st.session_state.setdefault("limit", 40)
params = dict(VIEWS[view])
if min_score is not None:
    params["min_score"] = min_score
params["limit"] = st.session_state["limit"]


def render_card(it: dict) -> None:
    band = it.get("band") or "pending"
    score = it.get("score")
    if band == "duplicate":
        badge = '<span class="z-badge duplicate">duplicate</span>'
    elif score is not None:
        badge = f'<span class="z-badge {band}">{score} · {band}</span>'
    else:
        badge = '<span class="z-badge pending">grading…</span>'
    also = "".join(f'<span class="z-badge also">also {html.escape(a)}</span>' for a in (it.get("also") or "").split(",") if a)
    label = f'<span class="z-label">· you: {html.escape(it["label"])}</span>' if it.get("label") else ""
    head = (f'<b>{html.escape(it["ticker"])}</b> <span class="z-badge src">{source_badge(it["source_key"])}</span> '
            f'· {ago(it.get("first_seen"))} {badge} {also} {label}')
    title = f'<a href="{html.escape(it["url"], quote=True)}" target="_blank">{html.escape(it["title"])}</a>'
    why = f'<div class="z-why">{html.escape(it["why"])}</div>' if it.get("why") else ""
    hook = f'<div class="z-hook">Note hook: {html.escape(it["note_hook"])}</div>' if it.get("note_hook") else ""
    avatar_cls = "z-avatar lead" if band == "lead" else "z-avatar"
    st.markdown(
        f'<div class="z-card"><div class="{avatar_cls}">{html.escape(it["ticker"][:4])}</div><div class="z-body">'
        f'<div class="z-head">{head}</div><div class="z-title">{title}</div>{why}{hook}</div></div>',
        unsafe_allow_html=True,
    )
    if it.get("snippet"):
        with st.expander("Excerpt", expanded=False):
            st.caption(it["snippet"])
    if it.get("band"):
        cols = st.columns([1, 1, 1, 1, 2])
        for col, (value, text) in zip(cols, LABELS):
            if col.button(text, key=f"lbl-{it['item_id']}-{value}", type="primary" if it.get("label") == value else "secondary"):
                post_label(it["item_id"], value)
                st.toast(f"Labeled {it['ticker']} as {text}")
                st.rerun()
        with cols[4].popover("Why it matters"):
            note = st.text_area("Your note", key=f"note-{it['item_id']}", placeholder="One line on why this matters (or doesn't)")
            choice = st.radio("Label", [t for _, t in LABELS], horizontal=True, key=f"nl-{it['item_id']}")
            if st.button("Save", key=f"save-{it['item_id']}"):
                post_label(it["item_id"], dict((t, v) for v, t in LABELS)[choice], note)
                st.toast("Saved")
                st.rerun()


# A timedelta (not "120s") keeps Streamlit from importing pandas, whose native
# DLLs are blocked by Windows Application Control on this machine.
@st.fragment(run_every=timedelta(seconds=120))
def feed() -> None:
    items: list[dict] = []
    if tickers:
        for t in tickers:
            items += get_json("/v1/feed", tuple(sorted({**params, "ticker": t}.items())))["items"]
        items.sort(key=lambda x: x["item_id"], reverse=True)
    else:
        items = get_json("/v1/feed", tuple(sorted(params.items())))["items"]
    if not items:
        st.info("Nothing here yet. The grader routine runs hourly; ungraded items show in Latest.")
        return
    for it in items:
        with st.container(border=True):
            render_card(it)
    if len(items) >= st.session_state["limit"] and st.session_state["limit"] < 200:
        if st.button("Load more"):
            st.session_state["limit"] += 40
            st.rerun()


st.markdown(f"#### {view}")
feed()
