"""Shared feed code for Zenith's two pages.

Coverage Universe reads /v1/feed and labels through /v1/feedback, exactly as the
single-page app did. Auxiliary Names reads /v1/aux/feed and labels through
/v1/aux/feedback. Both read /v1/stats (auxiliary counts live under stats.aux).
Titles, excerpts and grader text are untrusted: every string that reaches HTML
is escaped, links must be http(s), and excerpts render as plain text.
"""
from __future__ import annotations

import html
import json
import os
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from urllib.parse import urlparse

import requests
import streamlit as st


def setting(name: str) -> str:
    try:
        if name in st.secrets:
            return str(st.secrets[name])
    except Exception:
        pass
    return os.environ.get(name, "")


def api_base() -> str:
    return setting("ZENITH_API").rstrip("/")


def auth_headers() -> dict:
    return {"authorization": f"Bearer {setting('ZENITH_APP_TOKEN')}"}


LABELS = [("high", "High"), ("medium", "Medium"), ("low", "Low"), ("noise", "Noise")]
# Directional labels: the score shown should have been lower / higher.
DIRECTIONAL = [("too_high", "Too high"), ("too_low", "Too low")]
LABEL_TEXT = dict(LABELS + DIRECTIONAL)
MODES = ("For You", "Latest")
SIGNALS = {60: "Broad 60+", 70: "Balanced 70+", 80: "Tight 80+", 90: "Lead 90+"}
PAGE_SIZE = 40
MAX_LIMIT = 200
# Band names double as CSS classes, so only these reach a class attribute.
BANDS = ("lead", "digest", "borderline", "reject", "duplicate", "covered")
ROLE_BADGE = {"relationship": "Partner", "customer": "Customer", "program": "Program", "rival": "Rival", "index_event": "Index"}
STATUS_TAG = {"public": "Public", "private": "Private", "program": "Program", "media": "Media"}
# Read-through direction as shown on the chip ("→ RCAT −").
DIRECTION = {"+": "+", "-": "−", "−": "−", "±": "±"}


@dataclass(frozen=True)
class FeedPage:
    kind: str            # "cov" | "aux": prefixes this page's widget keys
    title: str
    tagline: str
    feed_path: str
    feedback_path: str
    filter_label: str
    filter_param: str    # the feed's filter parameter for one selected name
    filter_placeholder: str


COVERAGE = FeedPage("cov", "Coverage Universe", "covered-universe research feed", "/v1/feed", "/v1/feedback",
                    "Companies", "ticker", "All covered companies")
AUXILIARY = FeedPage("aux", "Auxiliary Names", "material news beyond coverage", "/v1/aux/feed", "/v1/aux/feedback",
                     "Names", "entity", "All auxiliary names")


# ---- pure helpers (unit tested) ---------------------------------------------
def feed_params(mode: str, min_score: int | None, unlabeled: bool) -> dict:
    """Feed query for the For You | Latest switch and the Unlabeled only toggle.

    For You: graded at or above the Signal floor, recent Leads pinned first (the
    API's default). Latest: newest first, everything not skipped, pending included.
    """
    params: dict = {"min_score": min_score} if mode == MODES[0] and min_score is not None else {"order": "newest"}
    if unlabeled:
        # The old Label queue: graded cards you have not labelled yet.
        params.update(unlabeled="1", state="graded")
    return params


def shown_name(page: FeedPage, it: dict) -> str:
    if page.kind == "aux":
        name = str(it.get("entity") or it.get("entity_key") or "")
        # Routed names carry peer-note tags ("NeutraDC (Telkom Indonesia subsidiary; ...)"):
        # the card shows the name alone so the head line stays short.
        short = name.split(" (", 1)[0].strip()
        return short or name
    # A cross-ticker card is shown (and labelled) under its own ticker.
    return str(it.get("grade_ticker") or it.get("ticker") or "")


def label_choices(it: dict) -> list[str]:
    """Labels a card offers: none until graded; Too high / Too low need a score."""
    if not it.get("band"):
        return []
    return [v for v, _ in LABELS] + ([v for v, _ in DIRECTIONAL] if it.get("score") is not None else [])


def label_request(page: FeedPage, it: dict, label: str, note: str | None = None) -> tuple[str, dict]:
    """(path, body) of the POST that records a label for this card."""
    if page.kind == "aux":
        # Recorded against the item's current auxiliary grade server-side.
        body = {"item_id": it["item_id"], "label": label}
        if note:
            body["note"] = note
        return page.feedback_path, body
    body = {"item_id": it["item_id"], "label": label, "note": note or None,
            "ticker": it.get("grade_ticker") or it["ticker"]}
    if it.get("grade_id") is not None:
        body["grade_id"] = it["grade_id"]
    return page.feedback_path, body


def merge_items(batches) -> list[dict]:
    # One item can match several selected names: show it once, in the API's
    # order (recent Leads first, then newest).
    items = {i["item_id"]: i for batch in batches for i in batch}
    return sorted(items.values(), key=lambda x: (x.get("pinned") or 0, x["item_id"]), reverse=True)


def short_date(day: str | None) -> str:
    try:
        return datetime.strptime(str(day)[:10], "%Y-%m-%d").strftime("%b %d")
    except ValueError:
        return str(day or "")[:10]


def ago(iso: str | None) -> str:
    if not iso:
        return ""
    try:
        t = datetime.fromisoformat(iso.replace("Z", "+00:00"))
    except ValueError:
        return iso[:10]
    if t.tzinfo is None:
        t = t.replace(tzinfo=timezone.utc)
    s = (datetime.now(timezone.utc) - t).total_seconds()
    if s < 3600:
        return f"{max(1, int(s // 60))}m"
    if s < 86400:
        return f"{int(s // 3600)}h"
    if s < 86400 * 7:
        return f"{int(s // 86400)}d"
    return t.strftime("%b %d")


def safe_url(url: str | None) -> bool:
    return bool(url) and urlparse(str(url)).scheme in ("http", "https")


def source_badge(key: str, role: str | None = None) -> str:
    # Counterparty sources (customers, partners, programs, rivals, index providers).
    if role:
        return ROLE_BADGE.get(role, "Counterparty")
    if key.startswith("edgar_") or key.endswith("_sec_northland"):
        return "SEC"
    if key.endswith("_press") or key in ("mbody", "draganfly"):
        return "Wire"
    return "Issuer"


def status_tag(status: str | None) -> str:
    return STATUS_TAG.get(str(status or ""), "Other")


def one_line(text) -> str:
    return " ".join(str(text or "").split())


def band_badge(it: dict) -> str:
    band, score = it.get("band"), it.get("score")
    if not band:
        return '<span class="z-badge pending">grading…</span>'
    cls = band if band in BANDS else "other"
    text = html.escape(str(band))
    if score is None or band in ("duplicate", "covered"):
        return f'<span class="z-badge {cls}">{text}</span>'
    return f'<span class="z-badge {cls}">{html.escape(str(score))} · {text}</span>'


def read_through(value) -> list[dict]:
    if isinstance(value, str):
        try:
            value = json.loads(value)
        except ValueError:
            return []
    return [r for r in value or [] if isinstance(r, dict) and r.get("ticker")]


def read_through_chips(value) -> str:
    chips = []
    for r in read_through(value):
        ticker = html.escape(str(r["ticker"]))
        sign = html.escape(DIRECTION.get(r.get("direction"), str(r.get("direction") or "")))
        chips.append(f'<span class="z-chip" title="reads through to {ticker}">→ {ticker} {sign}</span>')
    return "".join(chips)


def card_html(page: FeedPage, it: dict) -> str:
    """Line 1: name, source/status tag, score · band, age. Line 2: the title.
    Line 3: the grader's one-line why (clamped by CSS); auxiliary read-through chips."""
    name = html.escape(shown_name(page, it))
    if page.kind == "aux":
        tag = status_tag(it.get("status"))
        extra = ""
    else:
        tag = source_badge(str(it.get("source_key") or ""), it.get("role"))
        extra = "".join(f'<span class="z-badge also">also {html.escape(a)}</span>' for a in str(it.get("also") or "").split(",") if a)
    seen = it.get("first_seen")
    age = f'<span class="z-age" title="first seen {html.escape(str(seen or ""), quote=True)}">{html.escape(ago(seen))}</span>' if seen else ""
    # The event date, when it is older than news-monitor's first sighting.
    event = f'<span class="z-age">· event {html.escape(short_date(it["event_date"]))}</span>' if it.get("event_date") else ""
    head = (f'<b class="z-name">{name}</b><span class="z-badge src">{html.escape(tag)}</span>'
            f'{band_badge(it)}{age}{event}{extra}')
    title_text = html.escape(one_line(it.get("title")))
    title = (f'<a href="{html.escape(str(it["url"]), quote=True)}" target="_blank" rel="noopener noreferrer">{title_text}</a>'
             if safe_url(it.get("url")) else title_text)
    why = f'<div class="z-why">{html.escape(one_line(it["why"]))}</div>' if it.get("why") else ""
    chips = read_through_chips(it.get("reads_through")) if page.kind == "aux" else ""
    rt = f'<div class="z-rt">{chips}</div>' if chips else ""
    lead = " lead" if it.get("band") == "lead" else ""
    return (f'<div class="z-card{lead}"><div class="z-head">{head}</div>'
            f'<div class="z-title">{title}</div>{why}{rt}</div>')


# ---- API ----------------------------------------------------------------------
@st.cache_data(ttl=30, show_spinner=False)
def get_json(path: str, params: tuple) -> dict:
    r = requests.get(f"{api_base()}{path}", headers=auth_headers(), params=dict(params), timeout=20)
    r.raise_for_status()
    return r.json()


def post_label(page: FeedPage, it: dict, label: str, note: str | None = None) -> None:
    path, body = label_request(page, it, label, note)
    r = requests.post(f"{api_base()}{path}", headers=auth_headers(), json=body, timeout=20)
    if r.status_code >= 400:
        # zenith-core explains a refused label ("too_high needs a scored grade ...").
        try:
            reason = r.json().get("error")
        except Exception:  # noqa: BLE001
            reason = None
        raise RuntimeError(reason or f"HTTP {r.status_code}")
    get_json.clear()


def fetch_items(page: FeedPage, params: dict, picked: tuple) -> list[dict]:
    if not picked:
        return get_json(page.feed_path, tuple(sorted(params.items())))["items"]
    return merge_items(get_json(page.feed_path, tuple(sorted({**params, page.filter_param: p}.items())))["items"]
                       for p in picked)


# ---- labels -------------------------------------------------------------------
FLASH = "z-flash"


def _flash(message: str, error: bool = False) -> None:
    # Callbacks run before the page; the toast shows on the run that follows.
    st.session_state[FLASH] = (message, error)


def _show_flash() -> None:
    message, error = st.session_state.pop(FLASH, (None, False))
    if message:
        st.toast(message, icon=":material/error:" if error else ":material/check:")


def _sync_label(key: str, server_label: str | None) -> None:
    # The label control shows the server's label: set it before the widget is
    # drawn whenever the server's value changed (or the widget state was dropped).
    seen = f"{key}:srv"
    if key not in st.session_state or st.session_state.get(seen, "\0") != server_label:
        st.session_state[key] = server_label
        st.session_state[seen] = server_label


def _on_label(page: FeedPage, it: dict, key: str) -> None:
    value, seen = st.session_state.get(key), f"{key}:srv"
    if value is None or value == st.session_state.get(seen):
        return
    try:
        post_label(page, it, value)
    except Exception as e:  # noqa: BLE001
        st.session_state[key] = st.session_state.get(seen)
        _flash(f"Label not saved: {e}", error=True)
        return
    st.session_state[seen] = value
    _flash(f"Labeled {LABEL_TEXT.get(value, value)}")


def _on_note(page: FeedPage, it: dict, key: str) -> None:
    value = st.session_state.get(f"{key}:nl")
    note = (st.session_state.get(f"{key}:note") or "").strip()
    try:
        post_label(page, it, value, note or None)
    except Exception as e:  # noqa: BLE001
        _flash(f"Note not saved: {e}", error=True)
        return
    st.session_state[key] = value
    st.session_state[f"{key}:srv"] = value
    st.session_state[f"{key}:note"] = ""
    _flash("Saved")


def card_key(page: FeedPage, it: dict) -> str:
    # Coverage: the item under the ticker it is shown for. Auxiliary: the item
    # alone (grader text never goes into a widget key).
    if page.kind == "aux":
        return f"aux-lbl-{it['item_id']}"
    return f"cov-lbl-{it['item_id']}-{shown_name(page, it)}"


def render_card(page: FeedPage, it: dict) -> None:
    st.markdown(card_html(page, it), unsafe_allow_html=True)
    if it.get("snippet") or it.get("note_hook"):
        with st.expander("Excerpt" if it.get("snippet") else "Note hook", expanded=False):
            # Third-party and grader text: never rendered as Markdown.
            if it.get("note_hook"):
                st.text(f"Note hook: {it['note_hook']}")
            if it.get("snippet"):
                st.text(it["snippet"])
    choices = label_choices(it)
    if not choices:
        return
    key = card_key(page, it)
    _sync_label(key, it.get("label"))
    # One wrapping row (not fixed columns): each button keeps its word on one
    # line, and on a narrow screen the row breaks onto a second line inside the card.
    row = st.container(horizontal=True, gap="small", vertical_alignment="center", key=f"zlabels-{key}")
    row.segmented_control("Label", choices, format_func=LABEL_TEXT.get, required=True, key=key,
                          label_visibility="collapsed", width="content", on_change=_on_label, args=(page, it, key))
    with row.popover("Why it matters", width="content"):
        st.text_area("Your note", key=f"{key}:note", placeholder="One line on why this matters (or doesn't)")
        current = it.get("label")
        st.radio("Label", choices, format_func=LABEL_TEXT.get, horizontal=True, key=f"{key}:nl",
                 index=choices.index(current) if current in choices else 0)
        st.button("Save", key=f"{key}:save", on_click=_on_note, args=(page, it, key))


# ---- page -----------------------------------------------------------------------
def _more(limit_key: str) -> None:
    st.session_state[limit_key] = min(MAX_LIMIT, st.session_state.get(limit_key, PAGE_SIZE) + PAGE_SIZE)


# A timedelta (not "120s") keeps Streamlit from importing pandas, whose native
# DLLs are blocked by Windows Application Control on this machine.
@st.fragment(run_every=timedelta(seconds=120))
def feed(page: FeedPage, base: tuple, picked: tuple) -> None:
    _show_flash()
    limit_key, sig_key = f"{page.kind}-limit", f"{page.kind}-sig"
    # A new sort, signal or filter starts again from one page of cards.
    if st.session_state.get(sig_key) != (base, picked):
        st.session_state[sig_key] = (base, picked)
        st.session_state[limit_key] = PAGE_SIZE
    limit = st.session_state.setdefault(limit_key, PAGE_SIZE)
    try:
        items = fetch_items(page, {**dict(base), "limit": limit}, picked)
    except Exception as e:  # noqa: BLE001
        st.warning(f"{page.title} feed unavailable: {e}")
        return
    if not items:
        st.info("Nothing here yet. The grader routine runs hourly; ungraded items show in Latest.")
        return
    for it in items:
        # Keyed so feed.css can style cards (class st-key-zcard-...).
        with st.container(border=True, key=f"zcard-{page.kind}-{it['item_id']}"):
            render_card(page, it)
    if len(items) >= limit and limit < MAX_LIMIT:
        st.button("Load more", key=f"{page.kind}-more", on_click=_more, args=(limit_key,))


def _metrics(page: FeedPage, stats: dict) -> None:
    src = stats if page.kind == "cov" else (stats.get("aux") or {})
    states = {s.get("state"): s.get("n", 0) for s in src.get("by_state") or []}
    bands = {b.get("band"): b.get("n", 0) for b in src.get("by_band") or []}
    c1, c2 = st.columns(2)
    c1.metric("Graded", states.get("graded", 0))
    c2.metric("Waiting", states.get("pending", 0) + states.get("claimed", 0))
    c1.metric("Lead", bands.get("lead", 0))
    if page.kind == "cov":
        c2.metric("Your labels", stats.get("labels", 0))
        run = stats.get("last_run") or {}
        st.caption(f"Rubric {stats.get('rubric_version')} · last grader run {ago(run.get('last_seen_at')) or 'never'}"
                   + (" ago" if run.get("last_seen_at") else ""))
    else:
        c2.metric("Names", len(src.get("entities") or []))
        last = src.get("last_ingest_at")
        st.caption(f"Last auxiliary ingest {ago(last)} ago" if last else "No auxiliary ingest yet")


def filter_options(page: FeedPage, stats: dict) -> tuple[list[str], dict]:
    """(options, counts) for the sidebar filter: covered tickers, or auxiliary
    names graded in the last 30 days (most first)."""
    if page.kind == "cov":
        return list(stats.get("tickers") or []), {}
    entities = [e for e in (stats.get("aux") or {}).get("entities") or [] if isinstance(e, dict) and e.get("name")]
    return [str(e["name"]) for e in entities], {str(e["name"]): e.get("n") for e in entities}


def render(page: FeedPage) -> None:
    with st.sidebar:
        st.markdown(f'<div class="z-brand">ZEN<span>I</span>TH</div><div class="z-sub">{html.escape(page.tagline)}</div>',
                    unsafe_allow_html=True)
        st.write("")
        try:
            stats = get_json("/v1/stats", ())
        except Exception as e:  # noqa: BLE001
            st.error(f"API unavailable: {e}")
            st.stop()

    head, switch = st.columns([3, 2], vertical_alignment="bottom")
    head.markdown(f"#### {page.title}")
    mode = switch.segmented_control("Sort", MODES, default=MODES[0], required=True, key=f"{page.kind}-mode",
                                    label_visibility="collapsed", width="stretch", persist_state="session") or MODES[0]

    with st.sidebar:
        options, counts = filter_options(page, stats)
        fkey = f"{page.kind}-filter"
        # Keep a selected name that has dropped out of the list selectable.
        options += [n for n in st.session_state.get(fkey) or [] if n not in options]
        picked = st.multiselect(page.filter_label, options, key=fkey, placeholder=page.filter_placeholder,
                                format_func=lambda n: f"{n} ({counts[n]})" if counts.get(n) else n,
                                persist_state="session")
        min_score = None
        if mode == MODES[0]:
            min_score = st.select_slider("Signal", options=list(SIGNALS), value=70, format_func=SIGNALS.get,
                                         key=f"{page.kind}-signal", persist_state="session")
        unlabeled = st.toggle("Unlabeled only", key=f"{page.kind}-unlabeled", persist_state="session",
                              help="Graded cards you have not labelled yet")
        st.divider()
        _metrics(page, stats)
        if st.button("Refresh", key=f"{page.kind}-refresh"):
            get_json.clear()
            st.rerun()

    feed(page, tuple(sorted(feed_params(mode, min_score, unlabeled).items())), tuple(picked))
