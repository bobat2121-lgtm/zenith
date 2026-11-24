"""Shared code for Zenith's pages.

Coverage Universe reads /v1/feed and labels through /v1/feedback, exactly as the
single-page app did. Auxiliary Names reads /v1/aux/feed and labels through
/v1/aux/feedback. Both read /v1/stats (auxiliary counts live under stats.aux).
Tuning reads /v1/calibration, /v1/expansion/candidates, /v1/source-yield,
/v1/left-out and /v1/ops and writes /v1/expansion/decide (approve, reject,
reopen), /v1/source-prefs and /v1/left-out/grade; the Coverage page shows /v1/ops
as its grader strip. A route an older zenith-core lacks shows "not available yet".
Titles, excerpts and grader text are untrusted: every string that reaches HTML
is escaped, links must be http(s), and excerpts render as plain text.
"""
from __future__ import annotations

import html
import json
import os
import re
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
MODES = ("For You", "Latest", "To label")
# Optional reason codes on a label (the feedback POST's reason). "Missed detail" is
# the "too low" reason: the grader missed a figure.
REASONS = [("not_material", "Not material"), ("duplicate", "Duplicate"), ("wrong_company", "Wrong company"),
           ("stale", "Stale"), ("marketing", "Marketing"), ("not_my_focus", "Not my focus"), ("missed_detail", "Missed detail")]
REASON_TEXT = dict(REASONS)
DOWN_REASONS = [v for v, _ in REASONS[:6]]
UP_REASONS = ["missed_detail"]
SIGNALS = {60: "Broad 60+", 70: "Balanced 70+", 80: "Tight 80+", 90: "Lead 90+"}
# What each label does (the "How labels work" popover; plain text, our own words).
LABEL_GUIDE = [
    ("High", "must see. Always shows in For You, whatever the score. Teaches the grader to score items like this 80+."),
    ("Medium", "worth knowing. Teaches the grader that items like this belong around 60-89. Where the card shows doesn't change."),
    ("Low", "minor. Teaches the grader 30-69. Where the card shows doesn't change."),
    ("Noise", "not useful. Removes the card from For You. Teaches the grader to score items like this under 30."),
    ("Too high / Too low", "the score is off in that direction. Teaches the grader. Where the card shows doesn't change."),
    ("Reason (optional)", "tells the grader why, e.g. stale, wrong company or marketing."),
]
LABEL_GUIDE_FOOTER = ("A label never rewrites this card's score. Every hourly grader run reads your labels from the last "
                      "30 days and applies them to similar new items. You can change a label any time; the latest one counts.")
# The label control's tooltip: the guide, shortened.
LABEL_HELP = ("High: always in For You. Noise: out of For You. Medium, Low, Too high, Too low: the card stays where it is. "
              "Every label teaches the grader on its hourly run; it never rewrites this card's score.")
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
    API's default); zenith-core also keeps every card you labelled High (graded or
    not, recent ones pinned, owner_pick when only your label put it there) and drops
    every card you labelled Noise. Latest: newest first, everything not skipped, pending included.
    To label: graded cards you have not labelled, the ones that teach the grader most
    first (sort=to_label); Unlabeled only is implied.
    """
    if mode == MODES[2]:
        return {"sort": "to_label", "unlabeled": "1", "state": "graded"}
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
    """Labels a card offers: High / Medium / Low / Noise always, graded or not (zenith-core
    records a label on an ungraded card); Too high / Too low only when there is a score."""
    return [v for v, _ in LABELS] + ([v for v, _ in DIRECTIONAL] if it.get("score") is not None else [])


def label_toast(label: str) -> str:
    """What a label click did, in the toast: High pins, Noise removes, the rest teach."""
    text = LABEL_TEXT.get(label, label)
    if label == "high":
        return f"Labeled {text}: pinned to For You"
    if label == "noise":
        return f"Labeled {text}: removed from For You"
    return f"Labeled {text}: the grader will learn from it"


def note_toast(before: str | None, label: str) -> str:
    """The toast after Save in "Why it matters": what the label did too, when the note changed it."""
    return "Saved" if before == label else f"Saved · {label_toast(label)}"


def reason_choices(label: str | None) -> list[str]:
    """Reason codes offered under a label: why the card is worth less (Low, Noise,
    Too high) or more (High, Too low) than graded. Medium and no label offer none."""
    if label in ("low", "noise", "too_high"):
        return DOWN_REASONS
    if label in ("high", "too_low"):
        return UP_REASONS
    return []


def label_request(page: FeedPage, it: dict, label: str, note: str | None = None,
                  reason: str | None = None) -> tuple[str, dict]:
    """(path, body) of the POST that records a label (and its optional reason) for this card."""
    if page.kind == "aux":
        # Recorded against the item's current auxiliary grade server-side.
        body = {"item_id": it["item_id"], "label": label}
        if note:
            body["note"] = note
    else:
        body = {"item_id": it["item_id"], "label": label, "note": note or None,
                "ticker": it.get("grade_ticker") or it["ticker"]}
        if it.get("grade_id") is not None:
            body["grade_id"] = it["grade_id"]
    if reason:
        body["reason"] = reason
    return page.feedback_path, body


def card_reason(it: dict) -> str | None:
    """The reason saved with the card's label (feeds return my_reason beside the label)."""
    reason = it.get("my_reason")
    return reason if reason in REASON_TEXT else None


def to_label_key(it: dict) -> tuple:
    """zenith-core's sort=to_label order (worker lib.js TO_LABEL_ORDER): confidence under
    0.6 first, then scores 60-79 nearest 70 first, then the rest; within each step score
    highest first, then newest first (item id; the aux feed breaks that tie by nm_rowid).
    A full order, so a kept card re-sorts back into the place it had."""
    conf, score = it.get("confidence"), it.get("score")
    score = score if isinstance(score, (int, float)) else None
    item_id = it.get("item_id")
    tail = (-(score if score is not None else -1), -(item_id if isinstance(item_id, int) else 0))
    if isinstance(conf, (int, float)) and conf < 0.6:
        return (0, 0) + tail
    if score is not None and 60 <= score <= 79:
        return (1, abs(score - 70)) + tail
    return (2, 0) + tail


def merge_items(batches, sort: str | None = None) -> list[dict]:
    # One item can match several selected names: show it once, in the API's
    # order (recent Leads first, then newest; or the To label order).
    items = {i["item_id"]: i for batch in batches for i in batch}
    if sort == "to_label":
        return sorted(items.values(), key=to_label_key)
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


# SEC forms as zenith-core's tag vocabulary names them. A title "names" a form when it
# has news-monitor's EDGAR shape "<company>: <form>[ [Items ...]] filed <date>"
# ("Agility Robotics, Inc.: 8-K/A filed 2026-11-13", "Aurora: 8-K [Items 7.01, 9.01] filed ...").
# Anchoring on ": " keeps prose such as "Series D filed with ..." from reading as Form D.
SEC_FORMS = (r"8-K/A|8-K|10-Q/A|10-Q|10-K/A|10-K|6-K/A|6-K|20-F|40-F|S-1/A|S-1|S-3/A|S-3|S-4|S-8|F-1|F-3|424B[1-8]"
             r"|SC 13D/A|SC 13D|SC 13G/A|SC 13G|13F-HR|Form 3|Form 4|Form 5|DEF 14A|DEFA14A|PRE 14A|25-NSE"
             r"|NT 10-Q|NT 10-K|1-U|1-K|C|D")
TITLE_FORM = re.compile(rf":\s+({SEC_FORMS})(?:\s+\[Items[^\]]*\])?\s+filed\b")


def title_form(title) -> str | None:
    """The SEC form an EDGAR title says was filed ("Acme: 8-K/A [Items 5.02] filed ..." -> "8-K/A"), else None."""
    m = TITLE_FORM.search(one_line(title))
    return m.group(1) if m else None


def link_text(it: dict) -> str:
    """Plain (unescaped) text of the card's title link: "<headline> - <tag>" once the
    grader wrote a headline; until then the original title, with " - <form>" when the
    title says which SEC form was filed."""
    headline, tag = one_line(it.get("headline")), one_line(it.get("headline_tag"))
    if headline:
        return f"{headline} - {tag}" if tag else headline
    title = one_line(it.get("title"))
    form = title_form(title)
    return f"{title} - {form}" if form and not title.endswith(f" - {form}") else title


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
    """Line 1: name, source/status tag, score · band, age. Line 2: the link text
    (headline - tag, else the original title; see link_text).
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
    # In For You only because of the owner's High (zenith-core owner_pick).
    pick = '<span class="z-badge pick">Your pick</span>' if it.get("owner_pick") else ""
    head = (f'<b class="z-name">{name}</b><span class="z-badge src">{html.escape(tag)}</span>'
            f'{band_badge(it)}{pick}{age}{event}{extra}')
    title_text = html.escape(link_text(it))
    title = (f'<a href="{html.escape(str(it["url"]), quote=True)}" target="_blank" rel="noopener noreferrer">{title_text}</a>'
             if safe_url(it.get("url")) else title_text)
    why = f'<div class="z-why">{html.escape(one_line(it["why"]))}</div>' if it.get("why") else ""
    chips = read_through_chips(it.get("reads_through")) if page.kind == "aux" else ""
    rt = f'<div class="z-rt">{chips}</div>' if chips else ""
    lead = " lead" if it.get("band") == "lead" else ""
    return (f'<div class="z-card{lead}"><div class="z-head">{head}</div>'
            f'<div class="z-title">{title}</div>{why}{rt}</div>')


# ---- Coverage page: source health and site changes (unit tested) ----------------
# From /v1/source-health and /v1/site-changes: news-monitor's EDGAR fast trigger,
# its Worker-egress probes and its site-structure watchers. Coverage page only.
SITE_DAYS = 14
SITE_LIMIT = 50
STRIP_NAMES = 4
PROBE_STALE_HOURS = 36
SITE_KIND = {
    "section_new": "New section", "section_gone": "Section gone", "child_new": "New sitemap",
    "child_gone": "Sitemap gone", "child_404": "Sitemap 404", "index_moved": "Sitemap moved", "index_gone": "No sitemap",
}


def _ago_text(iso: str | None) -> str:
    # "2h ago" for recent times; ago() gives a date ("Nov 12") past a week.
    a = ago(iso)
    return f"{a} ago" if a[:-1].isdigit() and a[-1:] in ("m", "h", "d") else a


def probes_stale(checked_at: str | None, now: datetime | None = None) -> bool:
    """True when the newest probe check is over PROBE_STALE_HOURS old (probes run once a day)."""
    if not checked_at:
        return False
    try:
        t = datetime.fromisoformat(str(checked_at).replace("Z", "+00:00"))
    except ValueError:
        return False
    if t.tzinfo is None:
        t = t.replace(tzinfo=timezone.utc)
    return (now or datetime.now(timezone.utc)) - t > timedelta(hours=PROBE_STALE_HOURS)


def health_strip_html(health: dict) -> str:
    """One line: "SEC fast path: last 2h ago · IR probes: 2 failing (SYM events, KDK news)",
    failing names in red. Every value is escaped."""
    edgar = health.get("edgar_fast_path")
    if not isinstance(edgar, dict):
        sec = "unavailable"
    elif edgar.get("last_match_at"):
        sec = f"last {html.escape(_ago_text(edgar['last_match_at']))}"
    else:
        sec = "no matches yet"
    probes = health.get("ir_probes")
    if not isinstance(probes, dict):
        ir = "unavailable"
    elif probes_stale(probes.get("checked_at")):
        # Probes run daily: an old check says nothing about today (details in the popover).
        ir = f'<span class="z-bad">last checked {html.escape(_ago_text(probes["checked_at"]))}</span>'
    else:
        failing = [f for f in probes.get("failing") or [] if isinstance(f, dict)]
        if failing:
            names = [f'<span class="z-bad">{html.escape(str(f.get("label") or f.get("key") or "?"))}</span>'
                     for f in failing[:STRIP_NAMES]]
            more = f", +{len(failing) - STRIP_NAMES} more" if len(failing) > STRIP_NAMES else ""
            ir = f'<span class="z-bad">{len(failing)} failing</span> ({", ".join(names)}{more})'
        elif probes.get("ok"):
            ir = f"all {html.escape(str(probes['ok']))} OK"
        else:
            ir = "no checks yet"
    return f'<div class="z-health">SEC fast path: {sec} · IR probes: {ir}</div>'


def health_details(health: dict) -> list[str]:
    """Plain-text lines for the strip's popover (rendered with st.text, never Markdown)."""
    lines = []
    edgar = health.get("edgar_fast_path")
    if isinstance(edgar, dict):
        last = edgar.get("last_match_at")
        lines.append(f"SEC fast path (EDGAR latest-filings trigger): {edgar.get('matches_24h', 0)} filings matched in 24h, "
                     f"{edgar.get('matches_7d', 0)} in 7 days; last match {str(last)[:16].replace('T', ' ') + ' UTC' if last else 'none'}.")
    else:
        lines.append("SEC fast path: no data (edgar_latest_matches unavailable).")
    probes = health.get("ir_probes")
    if isinstance(probes, dict):
        failing = [f for f in probes.get("failing") or [] if isinstance(f, dict)]
        checked = probes.get("checked_at")
        lines.append(f"IR probes: {probes.get('ok', 0)} OK, {len(failing)} failing"
                     + (f"; last checked {_ago_text(checked)}." if checked else "."))
        for f in failing:
            since = str(f.get("since") or "")[:16].replace("T", " ")
            lines.append(f"  {f.get('label') or f.get('key')} ({f.get('key')}): {f.get('error') or 'failing'}"
                         + (f", failing as of {since} UTC" if since else ""))
    else:
        lines.append("IR probes: no data (probe results unavailable).")
    return lines


def site_changes_for(items, tickers) -> list[dict]:
    """The changes for the shown companies: notable first, then newest first."""
    shown = {str(t).upper() for t in tickers or []}
    rows = [c for c in items or [] if isinstance(c, dict) and str(c.get("ticker") or "").upper() in shown]
    rows.sort(key=lambda c: (str(c.get("detected_at") or ""), c.get("id") or 0), reverse=True)
    return sorted(rows, key=lambda c: not c.get("notable"))


def site_change_html(ch: dict) -> str:
    """Ticker · notable mark · kind · age, then the section and news-monitor's change text. Escaped."""
    ticker = html.escape(str(ch.get("ticker") or ""))
    kind = html.escape(SITE_KIND.get(str(ch.get("kind") or ""), str(ch.get("kind") or "change")))
    mark = '<span class="z-badge lead">notable</span>' if ch.get("notable") else ""
    seen = ch.get("detected_at")
    age = (f'<span class="z-age" title="detected {html.escape(str(seen), quote=True)}">{html.escape(ago(seen))}</span>'
           if seen else "")
    section = f'<code>{html.escape(str(ch["section"]))}</code> ' if ch.get("section") else ""
    detail = html.escape(one_line(ch.get("detail")))
    cls = " notable" if ch.get("notable") else ""
    return (f'<div class="z-site{cls}"><div class="z-head"><b class="z-name">{ticker}</b>{mark}'
            f'<span class="z-badge src">{kind}</span>{age}</div><div class="z-site-detail">{section}{detail}</div></div>')


# ---- Grader health (/v1/ops: Coverage strip and Tuning page; unit tested) --------------
GAP_NOTE = ("A gap usually means the account's usage limit refused the hourly grader run: the routine "
            "stops in about a second, before it reaches zenith-core, so no run is recorded.")
BAD_STATUS = ("late", "down")


def _num(value) -> int:
    try:
        return int(value)
    except (TypeError, ValueError):
        return 0


def _when(iso) -> datetime | None:
    try:
        t = datetime.fromisoformat(str(iso).replace("Z", "+00:00"))
    except ValueError:
        return None
    return t if t.tzinfo else t.replace(tzinfo=timezone.utc)


def run_ago(iso: str | None) -> str:
    """ "12 min ago", "3h ago", "2d ago", or a date past a week."""
    a = ago(iso)
    return f"{a[:-1]} min ago" if a.endswith("m") and a[:-1].isdigit() else _ago_text(iso)


def day_text(iso) -> str:
    """ "Nov 9" (no leading zero)."""
    t = _when(iso)
    return f"{t:%b} {t.day}" if t else str(iso or "")[:10]


def utc_text(iso) -> str:
    """ "Nov 22 13:00 UTC"."""
    t = _when(iso)
    if t is None:
        return str(iso or "")
    t = t.astimezone(timezone.utc)
    return f"{t:%b} {t.day} {t:%H:%M} UTC"


def _hours(value) -> str:
    try:
        return f"{round(float(value), 1):g} h"
    except (TypeError, ValueError):
        return "? h"


def grader_of(ops) -> dict | None:
    g = ops.get("grader") if isinstance(ops, dict) else None
    return g if isinstance(g, dict) else None


def grader_gaps(ops) -> list[dict]:
    return [x for x in (grader_of(ops) or {}).get("gaps_7d") or [] if isinstance(x, dict)]


def grader_strip_html(ops) -> str:
    """One line: "Grader: last run 12 min ago · Aux backlog 96 (oldest Nov 9) · Headlines
    waiting 239", the run part red when the grader is late or down. Escaped."""
    g = grader_of(ops)
    if g is None:
        return '<div class="z-health">Grader: not available yet</div>'
    last, status = g.get("last_run_at"), str(g.get("status") or "")
    run = f"last run {html.escape(run_ago(last))}" if last else "no runs yet"
    if status in BAD_STATUS:
        run = f'<span class="z-bad">{html.escape(status)} · {run}</span>'
    parts = [f"Grader: {run}"]
    backlog = g.get("backlog")
    if isinstance(backlog, dict):
        aux = f"Aux backlog {_num(backlog.get('aux_pending'))}"
        if _num(backlog.get("aux_pending")) and backlog.get("oldest_aux_pending_at"):
            aux += f" (oldest {html.escape(day_text(backlog['oldest_aux_pending_at']))})"
        parts += [aux, f"Headlines waiting {_num(backlog.get('headlines_waiting'))}"]
    return f'<div class="z-health">{" · ".join(parts)}</div>'


def gap_lines(ops) -> list[str]:
    """Plain-text lines for the strip's popover: the gaps over 2 h in 7 days, and why they happen."""
    if grader_of(ops) is None:
        return ["Grader health is not available yet (this zenith-core has no /v1/ops)."]
    gaps = grader_gaps(ops)
    lines = [f"Gaps over 2 h between grader runs, last 7 days: {len(gaps)}." if gaps
             else "No gaps over 2 h between grader runs in the last 7 days."]
    lines += [f"  {utc_text(x.get('from'))} to {utc_text(x.get('to'))} ({_hours(x.get('hours'))})" for x in gaps]
    return lines + [GAP_NOTE]


def grader_details(ops) -> list[str]:
    """Plain-text lines for the Tuning page's Grader section (gaps are a table there)."""
    g = grader_of(ops)
    if g is None:
        return ["Grader health is not available yet (this zenith-core has no /v1/ops)."]
    status, last = str(g.get("status") or "unknown"), g.get("last_run_at")
    lines = [f"Status: {status}. Last run {utc_text(last)} ({run_ago(last)})." if last
             else f"Status: {status}. No grader run recorded."]
    run = g.get("last_run")
    if isinstance(run, dict) and any(k in run for k in ("claimed", "graded")):
        lines.append("Last run: " + ", ".join(f"{k} {_num(run[k])}" for k in ("claimed", "graded") if k in run) + ".")
    if "runs_24h" in g:
        lines.append(f"Runs in the last 24 h: {_num(g['runs_24h'])}.")
    backlog = g.get("backlog")
    if isinstance(backlog, dict):
        oldest = backlog.get("oldest_aux_pending_at")
        lines.append(f"Backlog: {_num(backlog.get('coverage_pending'))} coverage items pending, "
                     f"{_num(backlog.get('aux_pending'))} auxiliary pending"
                     + (f" (oldest first seen {utc_text(oldest)})" if oldest else "")
                     + f", {_num(backlog.get('headlines_waiting'))} graded cards waiting for a headline.")
    for c in g.get("checks") or []:
        if isinstance(c, dict):
            state = str(c.get("state") or "?")
            detail = one_line(c.get("detail")) if state != "ok" else ""
            lines.append(f"Check {c.get('key') or '?'}: {state}" + (f". {detail}" if detail else ""))
    return lines


# ---- Tuning page (unit tested) ------------------------------------------------------
YIELD_DAYS = 30
LEFT_DAYS = 14
LEFT_SHOW = 20
PREFS = [("mute", "Mute"), ("demote", "Demote"), ("normal", "Normal")]
PREF_TEXT = dict(PREFS)
PREF_HELP = ("Mute: muted sources are not graded. New items from the source are skipped and its graded cards are "
             "hidden from both feeds; Mute asks for a confirm click. Demote: For You ranks its cards 15 points lower; "
             "Latest, bands and alerts are unchanged. Normal: no change. SEC filings and a covered company's own "
             "newsroom cannot be muted.")
LEFT_KINDS = {"coverage": "Coverage", "aux": "Auxiliary"}
SKIP_TEXT = {"archive_seed": "Archive seed", "muted_source": "Muted source", "rival_no_key_account": "Rival, no key account",
             "grading_failed": "Grading failed"}
VERDICT_TEXT = {"too_high": "graded too high", "too_low": "graded too low"}


def html_table(headers, rows, wrap: int | None = None) -> str:
    """An escaped HTML table that scrolls inside its own box on a narrow screen.
    Column `wrap` (an index) may wrap; the others stay on one line."""
    head = "".join(f"<th>{html.escape(str(h))}</th>" for h in headers)
    cell = lambda i: '<td class="wrap">' if i == wrap else "<td>"  # noqa: E731
    body = "".join("<tr>" + "".join(f"{cell(i)}{html.escape(str(c))}</td>" for i, c in enumerate(r)) + "</tr>"
                   for r in rows)
    return f'<div class="z-scroll"><table class="z-table"><thead><tr>{head}</tr></thead><tbody>{body}</tbody></table></div>'


def calibration_parts(cal) -> tuple[dict | None, dict | None, dict]:
    """(coverage, aux, reasons) from /v1/calibration. An older zenith-core returns the
    coverage report alone, at the top level: no aux and no reasons then."""
    if not isinstance(cal, dict):
        return None, None, {}
    if any(k in cal for k in ("coverage", "aux", "reasons")):
        cov, aux = cal.get("coverage"), cal.get("aux")
    else:
        cov, aux = (cal if "all_time" in cal else None), None
    reasons = cal.get("reasons") if isinstance(cal.get("reasons"), dict) else {}
    return (cov if isinstance(cov, dict) else None), (aux if isinstance(aux, dict) else None), reasons


def _summary(part: dict | None, which: str) -> dict:
    s = (part or {}).get(which)
    return s if isinstance(s, dict) else {}


def _agreement(s: dict) -> str:
    a = s.get("agreement")
    return f"{a}% of {_num(s.get('scored'))}" if isinstance(a, (int, float)) else "n/a"


def calibration_rows(cov: dict | None, aux: dict | None) -> list[list]:
    """Rows of the agreement table: labels, agreement and too-high / too-low counts, all time and this week."""
    rows = []
    for name, part in (("Coverage", cov), ("Auxiliary", aux)):
        if part is None:
            rows.append([name, "not available yet", "", "", "", ""])
            continue
        a, w = _summary(part, "all_time"), _summary(part, "this_week")
        rows.append([name, _num(a.get("n")), _agreement(a), _num(a.get("too_high")), _num(a.get("too_low")), _agreement(w)])
    return rows


def calibration_misses(cov: dict | None, aux: dict | None, top: int = 5) -> list[list]:
    """The top misses of each page: name, grade, your label, which way, title."""
    rows = []
    for name, part in (("Coverage", cov), ("Auxiliary", aux)):
        for m in [m for m in (part or {}).get("misses") or [] if isinstance(m, dict)][:top]:
            score = m.get("score")
            rows.append([name, m.get("ticker") or m.get("entity") or "", "dup" if score is None else score,
                         LABEL_TEXT.get(m.get("label"), m.get("label") or ""),
                         VERDICT_TEXT.get(m.get("verdict"), m.get("verdict") or ""), one_line(m.get("title"))])
    return rows


def reason_rows(reasons: dict) -> list[list]:
    """[reason, count], most first."""
    rows = [(str(k), _num(v)) for k, v in (reasons or {}).items() if _num(v) > 0]
    rows.sort(key=lambda r: (-r[1], r[0]))
    return [[REASON_TEXT.get(k, k), n] for k, n in rows]


def calibration_empty(cov: dict | None, aux: dict | None, reasons: dict) -> bool:
    return not any(_num(_summary(p, "all_time").get("n")) for p in (cov, aux)) and not reason_rows(reasons)


def pref_of(row: dict) -> str:
    """The source's saved preference: mute, demote or normal (no row)."""
    p = row.get("pref")
    if isinstance(p, dict):
        p = p.get("action")
    return p if p in ("mute", "demote") else "normal"


def suggest_of(row: dict) -> str | None:
    s = row.get("suggest")
    return s if s in ("mute", "demote") else None


def yield_rows(rows) -> list[dict]:
    """Suggested rows first, then the server's order (most graded first)."""
    rows = [r for r in rows or [] if isinstance(r, dict) and r.get("source_key")]
    # One row per widget key: a repeated key (or two that slug alike) would collide.
    unique: dict[str, dict] = {}
    for r in rows:
        unique.setdefault(widget_slug(r["source_key"]), r)
    return sorted(unique.values(), key=lambda r: suggest_of(r) is None)


LOCK_TEXT = {"sec": "SEC filings — can't be muted", "own_channel": "Own channel — can't be muted"}


def pref_locked(row: dict) -> str | None:
    """Why zenith-core refuses Mute / Demote for this source (mutable false), else None.
    An older zenith-core has no mutable field: every row keeps its control."""
    if row.get("mutable") is not False:
        return None
    return LOCK_TEXT.get(str(row.get("lock") or ""), "Own channel / SEC — can't be muted")


# ---- Expansion queue (unit tested; plans/round5-expansion-approve-queue.md D3) ---------
EXP_LIMIT = 50
EXP_EVIDENCE = 3
# The status filter. Compiled rows take no decisions, so they are not offered.
EXP_STATUSES = [("pending", "Pending"), ("approved", "Approved"), ("rejected", "Rejected"), ("known", "Known")]
EXP_STATUS_TEXT = dict(EXP_STATUSES + [("compiled", "Compiled")])
# D2: why the owner rejects a candidate (zenith-core's REJECT_REASONS, in its order).
EXP_REASONS = [("not_relevant", "Not relevant"), ("wrong_name", "Wrong name"), ("duplicate", "Duplicate"),
               ("already_tracked", "Already tracked"), ("too_small", "Too small"), ("no_free_source", "No free source")]
EXP_REASON_TEXT = dict(EXP_REASONS)
ORIGIN_TEXT = {"grader_relation": "Grader", "sec_filing": "SEC filing", "aux_entity": "Aux entity"}
# What the candidate is to the subject (the subject's ticker or aux entity).
RELATION_TEXT = {"acquired": "acquired by {s}", "acquirer": "acquirer of {s}", "customer": "customer of {s}",
                 "partner": "partner of {s}", "supplier": "supplier to {s}", "subsidiary": "subsidiary of {s}",
                 "award": "awarded {s}"}
# What zenith-core may do with a row in each status (its allowedActions), for a row without actions.
EXP_ACTIONS = {"pending": ["approve", "reject"], "approved": ["reject"], "rejected": ["approve"], "known": ["reopen"]}
EXP_HELP = ("Names Zenith already sees that have no source of their own. Approve adds the name to the weekly compile, "
            "which gives it its own source; Reject keeps it out, also when it is seen again. Nothing is added without "
            "your approval.")


def exp_id(row) -> int | None:
    """The candidate's numeric id (the only server value in its widget keys), else None."""
    v = row.get("id") if isinstance(row, dict) else None
    return v if isinstance(v, int) and not isinstance(v, bool) and v > 0 else None


def exp_rows(rows) -> list[dict]:
    """Candidate rows with a numeric id, once each, in the server's order (newest seen first)."""
    out, seen = [], set()
    for r in rows or []:
        i = exp_id(r)
        if i is not None and i not in seen:
            seen.add(i)
            out.append(r)
    return out


def exp_actions(row: dict) -> list[str]:
    acts = row.get("actions")
    if isinstance(acts, list):
        return [a for a in acts if a in ("approve", "reject", "reopen")]
    return list(EXP_ACTIONS.get(str(row.get("status") or ""), []))


def _str_list(v) -> list[str]:
    return [str(x) for x in v if isinstance(x, (str, int)) and str(x).strip()] if isinstance(v, list) else []


def relation_text(row: dict) -> str:
    """"acquired by UMAC", "partner of SPAI"; the subject alone, or "" for an aux entity row."""
    subject = one_line(row.get("subject"))
    rel = str(row.get("relation") or "")
    if rel in RELATION_TEXT and subject:
        return RELATION_TEXT[rel].format(s=subject)
    if rel:
        return rel.replace("_", " ")
    return f"related to {subject}" if subject else ""


def known_note(note) -> str:
    """One registry match in plain words: "already a SPAI key account, no source"."""
    kind, _, what = str(note or "").partition(":")
    return {"sheet_term": f"already a {what} sheet term, no source",
            "key_account": f"already a {what} key account, no source",
            "aux_item_prefix": f"maybe the source {what} (name prefix only)",
            "covered": f"a covered name ({what})",
            "aux_source": f"own source {what}",
            "aux_item": f"own source {what} (Auxiliary items)"}.get(kind, str(note or ""))


def similar_text(similar) -> str:
    """"similar: #12 Genesis AI, #9 Genesis" (a word-prefix match; nothing is merged)."""
    parts = [f"#{s['id']} {one_line(s.get('name'))}".strip() for s in similar or []
             if isinstance(s, dict) and isinstance(s.get("id"), int)]
    return f"similar: {', '.join(parts)}" if parts else ""


def decision_text(row: dict) -> str:
    """The latest decision: "Approved Nov 24 for UMAC", "Rejected Nov 24: Too small"."""
    d = row.get("decision")
    if not isinstance(d, dict) or not d.get("action"):
        return ""
    action = str(d["action"])
    out = {"approve": "Approved", "reject": "Rejected", "reopen": "Reopened", "compiled": "Compiled"}.get(action, action)
    if d.get("at"):
        out += f" {day_text(d['at'])}"
    tickers = _str_list(d.get("tickers"))
    if action == "approve":
        out += f" for {', '.join(tickers)}" if tickers else " with no tickers"
    if action == "reject" and d.get("reason"):
        out += f": {EXP_REASON_TEXT.get(str(d['reason']), str(d['reason']))}"
    if one_line(d.get("note")):
        out += f" ({one_line(d['note'])})"
    return out


def evidence_html(ev: dict) -> str:
    """One evidence line: Coverage #18 · SEC filing · party, then the item's title link. Escaped."""
    kind = {"coverage": "Coverage", "aux": "Auxiliary"}.get(str(ev.get("kind") or ""), "Item")
    bits = [f"{kind} #{ev['item_id']}" if isinstance(ev.get("item_id"), int) else kind]
    if ev.get("origin"):
        bits.append(ORIGIN_TEXT.get(str(ev["origin"]), str(ev["origin"])))
    if ev.get("at"):
        bits.append(day_text(ev["at"]))
    party = one_line(ev.get("party"))
    text = html.escape(one_line(ev.get("title")) or "(no title)")
    link = (f'<a href="{html.escape(str(ev["url"]), quote=True)}" target="_blank" rel="noopener noreferrer">{text}</a>'
            if safe_url(ev.get("url")) else text)
    return (f'<div class="z-exp-ev"><span class="z-health">{html.escape(" · ".join(bits))}</span>'
            + (f' <span class="z-badge src">party: {html.escape(party)}</span>' if party else "")
            + f"<div>{link}</div></div>")


def expansion_card_html(row: dict) -> str:
    """Name, relation and subject, tickers, sightings, origins, notes, then up to 3 evidence links. Escaped."""
    head = [f'<b class="z-name">{html.escape(one_line(row.get("name")) or "?")}</b>']
    rel = relation_text(row)
    if rel:
        head.append(f'<span class="z-age">{html.escape(rel)}</span>')
    for t in _str_list(row.get("tickers")):
        head.append(f'<span class="z-badge also">{html.escape(t)}</span>')
    for o in _str_list(row.get("origins")):
        head.append(f'<span class="z-badge src">{html.escape(ORIGIN_TEXT.get(o, o))}</span>')
    n = _num(row.get("sightings"))
    head.append(f'<span class="z-age">{n} sighting{"" if n == 1 else "s"}</span>')
    lines = []
    status = str(row.get("status") or "")
    if status == "compiled":
        lines.append("Compiled into the build list")
    known = [known_note(k) for k in _str_list(row.get("known"))]
    if known:
        lines.append("Known: " + "; ".join(known))
    sim = similar_text(row.get("similar"))
    if sim:
        lines.append(sim)
    dec = decision_text(row)
    if dec:
        lines.append(dec)
    blocked = one_line(row.get("blocked"))
    if blocked:
        lines.append(blocked[:1].upper() + blocked[1:])
    notes = "".join(f'<div class="z-health">{html.escape(x)}</div>' for x in lines)
    evidence = [e for e in row.get("evidence") or [] if isinstance(e, dict)][:EXP_EVIDENCE]
    ev = "".join(evidence_html(e) for e in evidence)
    return f'<div class="z-card z-exp"><div class="z-head">{"".join(head)}</div>{notes}{ev}</div>'


def exp_counts_text(counts) -> str:
    """"Pending 4 · Approved 1 · Rejected 0 · Known 2 · Compiled 0"."""
    counts = counts if isinstance(counts, dict) else {}
    return " · ".join(f"{EXP_STATUS_TEXT[s]} {_num(counts.get(s))}" for s in ("pending", "approved", "rejected", "known", "compiled"))


def decide_body(row: dict, action: str, reason: str | None = None, tickers=None) -> dict:
    """The /v1/expansion/decide body: id and action; reject's reason; approve's tickers when picked."""
    body: dict = {"id": exp_id(row), "action": action}
    if action == "reject":
        body["reason"] = reason
    if action == "approve" and tickers is not None:
        body["tickers"] = sorted({str(t).upper() for t in tickers})
    return body


def decide_toast(row: dict, body: dict) -> str:
    name = one_line(row.get("name")) or f"#{body.get('id')}"
    if body["action"] == "approve":
        tk = body.get("tickers", _str_list(row.get("tickers")))
        return f"Approved {name}" + (f" for {', '.join(tk)}" if tk else "") + ": the weekly compile gives it a source"
    if body["action"] == "reject":
        return f"Rejected {name}: {EXP_REASON_TEXT.get(body.get('reason'), body.get('reason'))}"
    return f"Reopened {name}: back in Pending"


def left_blocked(it: dict) -> str | None:
    """Why Grade it would be refused (gradeable false), else None; an older zenith-core has no gradeable."""
    if it.get("gradeable") is not False:
        return None
    return one_line(it.get("blocked")) or "it can't be sent back to the grader from here"


def yield_line_html(row: dict, kind: str) -> str:
    """Source key, suggestion and counts for one Source yield row. Escaped."""
    key = html.escape(str(row["source_key"]))
    sug = suggest_of(row)
    mark = f'<span class="z-badge lead">suggested: {sug}</span>' if sug else ""
    stats = [f"graded {_num(row.get('graded'))}", f"high {_num(row.get('high'))}", f"reject {_num(row.get('reject'))}",
             f"duplicate {_num(row.get('duplicate'))}"]
    if kind == "aux":
        stats.append(f"covered {_num(row.get('covered'))}")
    stats.append(f"last high {day_text(row['last_high_at'])}" if row.get("last_high_at") else "no high yet")
    return (f'<div class="z-yield"><div class="z-head"><b class="z-name">{key}</b>{mark}</div>'
            f'<div class="z-yield-stats">{html.escape(" · ".join(stats))}</div></div>')


def widget_slug(value) -> str:
    # Server keys go into widget keys only as [A-Za-z0-9_-].
    return re.sub(r"[^A-Za-z0-9_-]", "_", str(value))[:80]


def left_out_counts(counts) -> tuple[list[tuple[str, int]], int]:
    """([(skip_reason, n)] most first, without archive_seed; archive_seed's count)."""
    counts = counts if isinstance(counts, dict) else {}
    rows = sorted(((str(k), _num(v)) for k, v in counts.items() if k != "archive_seed" and _num(v) > 0),
                  key=lambda r: (-r[1], r[0]))
    return rows, _num(counts.get("archive_seed"))


def skip_text(reason) -> str:
    return SKIP_TEXT.get(str(reason or ""), str(reason or "?"))


def left_out_counts_html(counts) -> str:
    rows, seed = left_out_counts(counts)
    shown = " · ".join(f"{html.escape(skip_text(k))} {n}" for k, n in rows) or "nothing"
    out = f'<div class="z-health">Skipped in the last {LEFT_DAYS} days: {shown}</div>'
    if seed:
        out += (f'<div class="z-health">Archive seed (history loaded at first ingest, never news): {seed}</div>')
    return out


def left_out_item_html(it: dict) -> str:
    """Name · skip reason · source · age, then the title link. Escaped."""
    name = html.escape(str(it.get("ticker") or it.get("entity") or ""))
    seen = it.get("first_seen")
    age = f'<span class="z-age">{html.escape(ago(seen))}</span>' if seen else ""
    head = (f'<b class="z-name">{name}</b><span class="z-badge reject">{html.escape(skip_text(it.get("skip_reason")))}</span>'
            f'<span class="z-badge src">{html.escape(str(it.get("source_key") or ""))}</span>{age}')
    text = html.escape(one_line(it.get("title")) or "(no title)")
    title = (f'<a href="{html.escape(str(it["url"]), quote=True)}" target="_blank" rel="noopener noreferrer">{text}</a>'
             if safe_url(it.get("url")) else text)
    return f'<div class="z-card"><div class="z-head">{head}</div><div class="z-title">{title}</div></div>'


# ---- API ----------------------------------------------------------------------
@st.cache_data(ttl=30, show_spinner=False)
def get_json(path: str, params: tuple) -> dict:
    r = requests.get(f"{api_base()}{path}", headers=auth_headers(), params=dict(params), timeout=20)
    r.raise_for_status()
    return r.json()


def is_not_found(e: Exception) -> bool:
    """True for a 404: the route is newer than the zenith-core that answered."""
    status = getattr(getattr(e, "response", None), "status_code", None)
    return status == 404 or str(e).startswith("404")


def optional_json(path: str, params: tuple = ()) -> tuple[dict | None, str | None]:
    """(data, None), or (None, why) when the route cannot answer: "not available yet"
    for a route this zenith-core does not have."""
    try:
        data = get_json(path, params)
    except Exception as e:  # noqa: BLE001
        return None, "not available yet" if is_not_found(e) else f"unavailable: {e}"
    return (data, None) if isinstance(data, dict) else (None, "not available yet")


def post_json(path: str, body: dict) -> None:
    r = requests.post(f"{api_base()}{path}", headers=auth_headers(), json=body, timeout=20)
    if r.status_code >= 400:
        # zenith-core explains a refusal ("too_high needs a scored grade ...").
        try:
            reason = r.json().get("error")
        except Exception:  # noqa: BLE001
            reason = None
        raise RuntimeError(reason or f"HTTP {r.status_code}")
    get_json.clear()


def post_label(page: FeedPage, it: dict, label: str, note: str | None = None, reason: str | None = None) -> None:
    post_json(*label_request(page, it, label, note, reason))


def fetch_items(page: FeedPage, params: dict, picked: tuple) -> list[dict]:
    if not picked:
        return get_json(page.feed_path, tuple(sorted(params.items())))["items"]
    return merge_items((get_json(page.feed_path, tuple(sorted({**params, page.filter_param: p}.items())))["items"]
                        for p in picked), params.get("sort"))


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


def _kept_key(page: FeedPage) -> str:
    return f"{page.kind}-kept"


def _remember(page: FeedPage, it: dict, key: str, label: str | None, reason: str | None, note=None) -> None:
    # To label leaves labelled cards out, and For You drops a card labelled Noise (or one
    # that was in only by your High): one labelled here stays on screen (with its new
    # label) until the sort or filter changes, so its reason can still be set.
    card = {**it, "label": label, "my_reason": reason}
    if note is not None:
        card["label_note"] = note or None
    st.session_state.setdefault(_kept_key(page), {})[key] = card


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
    _remember(page, it, key, value, None, "")
    _flash(label_toast(value))


def _on_reason(page: FeedPage, it: dict, key: str, rkey: str) -> None:
    # Saving a reason re-posts the card's current label (and its note) with the reason.
    label, reason = st.session_state.get(f"{key}:srv"), st.session_state.get(rkey)
    if not label or reason == st.session_state.get(f"{rkey}:srv"):
        return
    try:
        post_label(page, it, label, it.get("label_note") or None, reason)
    except Exception as e:  # noqa: BLE001
        st.session_state[rkey] = st.session_state.get(f"{rkey}:srv")
        _flash(f"Reason not saved: {e}", error=True)
        return
    st.session_state[f"{rkey}:srv"] = reason
    _remember(page, it, key, label, reason)
    _flash(f"Reason saved: {REASON_TEXT[reason]}" if reason else "Reason cleared")


def _on_note(page: FeedPage, it: dict, key: str) -> None:
    value = st.session_state.get(f"{key}:nl")
    if value is None:
        _flash("Pick a label to save the note with", error=True)
        return
    before = st.session_state.get(f"{key}:srv")
    note = (st.session_state.get(f"{key}:note") or "").strip()
    # The saved reason goes with the note while the label it belongs to stays.
    reason = card_reason(it) if it.get("label") == value else None
    try:
        post_label(page, it, value, note or None, reason)
    except Exception as e:  # noqa: BLE001
        _flash(f"Note not saved: {e}", error=True)
        return
    st.session_state[key] = value
    st.session_state[f"{key}:srv"] = value
    st.session_state[f"{key}:note"] = ""
    _remember(page, it, key, value, reason, note)
    _flash(note_toast(before, value))


def card_key(page: FeedPage, it: dict) -> str:
    # Coverage: the item under the ticker it is shown for. Auxiliary: the item
    # alone (grader text never goes into a widget key).
    if page.kind == "aux":
        return f"aux-lbl-{it['item_id']}"
    return f"cov-lbl-{it['item_id']}-{shown_name(page, it)}"


def excerpt_lines(it: dict) -> tuple[str | None, list[str]]:
    """(expander label, plain-text lines) for the card's Excerpt expander, or (None, []).
    The original title comes first ("Original: ..."), so it stays readable once the
    link shows the grader's headline; a card with only a note hook keeps "Note hook"."""
    title = one_line(it.get("title"))
    if it.get("snippet") or (one_line(it.get("headline")) and title):
        lines = [f"Original: {title}"] if title else []
        label = "Excerpt"
    elif it.get("note_hook"):
        lines, label = [], "Note hook"
    else:
        return None, []
    if it.get("note_hook"):
        lines.append(f"Note hook: {it['note_hook']}")
    if it.get("snippet"):
        lines.append(str(it["snippet"]))
    return label, lines


def render_card(page: FeedPage, it: dict) -> None:
    st.markdown(card_html(page, it), unsafe_allow_html=True)
    label, lines = excerpt_lines(it)
    if label:
        with st.expander(label, expanded=False):
            # Third-party and grader text: st.text, never Markdown or HTML.
            for line in lines:
                st.text(line)
    choices = label_choices(it)
    if not choices:
        return
    key = card_key(page, it)
    _sync_label(key, it.get("label"))
    # One wrapping row (not fixed columns): each button keeps its word on one
    # line, and on a narrow screen the row breaks onto a second line inside the card.
    row = st.container(horizontal=True, gap="small", vertical_alignment="center", key=f"zlabels-{key}")
    row.segmented_control("Label", choices, format_func=LABEL_TEXT.get, required=True, key=key, help=LABEL_HELP,
                          label_visibility="collapsed", width="content", on_change=_on_label, args=(page, it, key))
    with row.popover("Why it matters", width="content"):
        st.text_area("Your note", key=f"{key}:note", placeholder="One line on why this matters (or doesn't)")
        current = it.get("label")
        # No label yet: nothing is picked, so a note never records (and pins) High unasked.
        st.radio("Label", choices, format_func=LABEL_TEXT.get, horizontal=True, key=f"{key}:nl",
                 index=choices.index(current) if current in choices else None)
        picked = st.session_state.get(f"{key}:nl")
        if picked is None:
            st.caption("Pick a label to save the note with.")
        st.button("Save", key=f"{key}:save", on_click=_on_note, args=(page, it, key), disabled=picked is None)
    reason_picker(page, it, key)


def reason_picker(page: FeedPage, it: dict, key: str) -> None:
    """Under the label row: an optional reason for the saved label. One compact select,
    so it stays one line at 375 px (feed.css st-key-zreason-*)."""
    label = st.session_state.get(f"{key}:srv")
    choices = reason_choices(label)
    # An older zenith-core has no my_reason in its feed and drops the reason it is sent.
    if not choices or "my_reason" not in it:
        return
    # One widget per reason set, so a label change never leaves a foreign option selected.
    rkey = f"{key}:rsn-{'up' if choices == UP_REASONS else 'down'}"
    reason = card_reason(it) if it.get("label") == label else None
    _sync_label(rkey, reason if reason in choices else None)
    st.container(key=f"zreason-{key}").selectbox(
        "Reason", choices, index=None, format_func=REASON_TEXT.get, key=rkey, placeholder="Reason (optional)",
        label_visibility="collapsed", width=220, on_change=_on_reason, args=(page, it, key, rkey))


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
        st.session_state.pop(_kept_key(page), None)
    limit = st.session_state.setdefault(limit_key, PAGE_SIZE)
    to_label = dict(base).get("sort") == "to_label"
    for_you = "min_score" in dict(base) and not to_label
    try:
        items = fetch_items(page, {**dict(base), "limit": limit}, picked)
    except Exception as e:  # noqa: BLE001
        st.warning(f"{page.title} feed unavailable: {e}")
        return
    fetched = len(items)
    kept: dict = {}
    if to_label or for_you:
        # Cards labelled since this list opened stay in place (the server now leaves them out),
        # one card per item: an item the server still returns (under another picked name) wins,
        # and of two kept cards for one item the later label wins.
        shown = {i["item_id"] for i in items}
        kept = {c["item_id"]: c for c in (st.session_state.get(_kept_key(page)) or {}).values()
                if c["item_id"] not in shown}
        if kept:
            # The kept card keeps the pinned value it was shown with, so it sorts back into its place.
            items = merge_items([items, list(kept.values())], dict(base).get("sort"))
    if not items:
        st.info("Nothing to label: every graded card from the last 14 days has your label." if to_label else
                "Nothing here yet. The grader routine runs hourly; ungraded items show in Latest.")
        return
    for it in items:
        # Keyed so feed.css can style cards (class st-key-zcard-...).
        with st.container(border=True, key=f"zcard-{page.kind}-{it['item_id']}"):
            if for_you and it["item_id"] in kept:
                st.caption("Removed from For You: it stays here until you change the sort or filter.")
            render_card(page, it)
    if fetched >= limit and limit < MAX_LIMIT:
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


def label_guide() -> None:
    """The "How labels work" popover: what each label does, in plain words (our own text)."""
    for name, text in LABEL_GUIDE:
        st.markdown(f"**{name}:** {text}")
    st.caption(LABEL_GUIDE_FOOTER)


def health_strip() -> None:
    """Coverage page: the one-line source-health strip, details in a popover."""
    try:
        health = get_json("/v1/source-health", ())
    except Exception:  # noqa: BLE001
        st.caption("Source health unavailable")
        return
    row = st.container(horizontal=True, gap="small", vertical_alignment="center", key="zhealth")
    row.markdown(health_strip_html(health), unsafe_allow_html=True, width="content")
    with row.popover("Details", width="content"):
        for line in health_details(health):
            st.text(line)


def grader_strip() -> None:
    """Coverage page: the one-line grader health strip from /v1/ops, gaps in a popover."""
    ops, why = optional_json("/v1/ops")
    if ops is None:
        st.caption(f"Grader health {why}")
        return
    row = st.container(horizontal=True, gap="small", vertical_alignment="center", key="zgrader")
    row.markdown(grader_strip_html(ops), unsafe_allow_html=True, width="content")
    with row.popover("Gaps", width="content"):
        for line in gap_lines(ops):
            st.text(line)


def site_changes(tickers) -> None:
    """Coverage page: the last 14 days of site-structure changes for the shown companies."""
    # The server filters by ticker before its limit, so a burst on one site cannot
    # crowd out another company; site_changes_for still filters (older workers ignore it).
    shown = ",".join(sorted({str(t).upper() for t in tickers or []}))
    try:
        items = get_json("/v1/site-changes", (("days", SITE_DAYS), ("limit", SITE_LIMIT), ("tickers", shown)))["items"]
    except Exception:  # noqa: BLE001
        return
    rows = site_changes_for(items, tickers)
    notable = sum(1 for c in rows if c.get("notable"))
    label = f"Site changes · last {SITE_DAYS} days ({len(rows)})" + (f" · {notable} notable" if notable else "")
    with st.expander(label, expanded=False, icon=":material/account_tree:"):
        if not rows:
            st.caption(f"No site structure changes for these companies in the last {SITE_DAYS} days.")
        for ch in rows:
            st.markdown(site_change_html(ch), unsafe_allow_html=True)


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
    # The sort control and, beside it, what each label does; the pair wraps at 375 px (feed.css st-key-zmode-*).
    ctl = switch.container(horizontal=True, gap="small", vertical_alignment="center", key=f"zmode-{page.kind}")
    mode = ctl.segmented_control("Sort", MODES, default=MODES[0], required=True, key=f"{page.kind}-mode",
                                 label_visibility="collapsed", width="content", persist_state="session") or MODES[0]
    with ctl.popover("How labels work", width="content"):
        label_guide()
    if page.kind == "cov":
        health_strip()
        grader_strip()

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
        if mode == MODES[2]:
            unlabeled = True  # To label is unlabeled graded cards by definition.
            st.caption("To label: your unlabeled graded cards from the last 14 days, the ones that teach the "
                       "grader most first (low confidence, then scores nearest 70).")
        else:
            unlabeled = st.toggle("Unlabeled only", key=f"{page.kind}-unlabeled", persist_state="session",
                                  help="Graded cards you have not labelled yet")
        st.divider()
        _metrics(page, stats)
        if st.button("Refresh", key=f"{page.kind}-refresh"):
            get_json.clear()
            st.session_state.pop(_kept_key(page), None)
            st.rerun()

    if page.kind == "cov":
        # The shown companies: the filter's picks, else every covered ticker.
        site_changes(picked or options)
    feed(page, tuple(sorted(feed_params(mode, min_score, unlabeled).items())), tuple(picked))


# ---- Tuning page ------------------------------------------------------------------
def _table(headers, rows, wrap: int | None = None) -> None:
    st.markdown(html_table(headers, rows, wrap), unsafe_allow_html=True)


def tuning_calibration() -> None:
    cal, why = optional_json("/v1/calibration")
    if cal is None:
        st.caption(f"Calibration {why}.")
        return
    cov, aux, reasons = calibration_parts(cal)
    if calibration_empty(cov, aux, reasons):
        st.info("No labels yet. The To label sort shows the cards that teach the grader most.")
        return
    _table(["", "Labels", "Agreement", "Too high", "Too low", "This week"], calibration_rows(cov, aux))
    st.caption("Agreement: the grade falls in your label's range (high 80-100, medium 60-89, low 30-69, noise 0-29). "
               "Too high / too low: the grade was above / below it. All time, except This week.")
    misses = calibration_misses(cov, aux)
    if misses:
        st.markdown("**Largest misses this week**")
        _table(["Page", "Name", "Grade", "Your label", "Miss", "Title"], misses, wrap=5)
    rows = reason_rows(reasons)
    if rows:
        st.markdown("**Reasons given**")
        _table(["Reason", "Labels"], rows)
    elif "reasons" not in cal:
        st.caption("Reason counts not available yet.")


def _on_pref(source_key: str, key: str) -> None:
    value, srv = st.session_state.get(key), st.session_state.get(f"{key}:srv")
    st.session_state.pop(f"{key}:confirm", None)
    if value is None or value == srv:
        return
    if value == "mute":
        st.session_state[f"{key}:confirm"] = True  # Mute waits for a confirm click.
        return
    _save_pref(source_key, value, key)


def _save_pref(source_key: str, action: str, key: str) -> None:
    st.session_state.pop(f"{key}:confirm", None)
    try:
        post_json("/v1/source-prefs", {"source_key": source_key, "action": action})
    except Exception as e:  # noqa: BLE001
        st.session_state[key] = st.session_state.get(f"{key}:srv")
        _flash(f"{source_key} not saved: {e}", error=True)
        return
    st.session_state[key] = action
    st.session_state[f"{key}:srv"] = action
    _flash({"mute": f"Muted {source_key}: its new items are not graded", "demote": f"Demoted {source_key}"}
           .get(action, f"{source_key} back to normal"))


def _cancel_pref(key: str) -> None:
    st.session_state.pop(f"{key}:confirm", None)
    st.session_state[key] = st.session_state.get(f"{key}:srv")


def yield_row(kind: str, row: dict) -> None:
    source_key, slug = str(row["source_key"]), widget_slug(row["source_key"])
    key = f"tune-pref-{kind}-{slug}"
    _sync_label(key, pref_of(row))
    box = st.container(horizontal=True, gap="small", vertical_alignment="center", key=f"zyield-{kind}-{slug}")
    box.markdown(yield_line_html(row, kind), unsafe_allow_html=True)
    locked = pref_locked(row)
    if locked:
        # zenith-core always refuses these: no Mute / Demote to click.
        box.markdown(f'<div class="z-health">{html.escape(locked)}</div>', unsafe_allow_html=True)
        return
    box.segmented_control("Preference", [v for v, _ in PREFS], format_func=PREF_TEXT.get, required=True, key=key,
                          label_visibility="collapsed", width="content", help=PREF_HELP,
                          on_change=_on_pref, args=(source_key, key))
    if st.session_state.get(f"{key}:confirm"):
        ask = st.container(horizontal=True, gap="small", vertical_alignment="center", key=f"zconfirm-{kind}-{slug}")
        ask.caption(f"Mute {source_key}? Muted sources are not graded: its new items are skipped and its cards hidden.")
        ask.button("Confirm mute", key=f"{key}:yes", type="primary", on_click=_save_pref, args=(source_key, "mute", key))
        ask.button("Cancel", key=f"{key}:no", on_click=_cancel_pref, args=(key,))


def tuning_yield() -> None:
    data, why = optional_json("/v1/source-yield", (("days", YIELD_DAYS),))
    if data is None:
        st.caption(f"Source yield {why}.")
        return
    st.caption(f"Last {YIELD_DAYS} days, latest grade per item; high is a score of 70 or more. Muted sources are not "
               "graded; Demote ranks a source's cards 15 points lower in For You.")
    for kind, title in (("coverage", "Coverage"), ("aux", "Auxiliary")):
        rows = yield_rows(data.get(kind))
        suggested = sum(1 for r in rows if suggest_of(r))
        label = f"{title} · {len(rows)} sources" + (f" · {suggested} suggested" if suggested else "")
        with st.expander(label, expanded=bool(suggested)):
            if not rows:
                st.caption(f"No graded {title.lower()} items in the last {YIELD_DAYS} days.")
            for row in rows:
                yield_row(kind, row)


def _grade_left(kind: str, item_id: int) -> None:
    try:
        post_json("/v1/left-out/grade", {"kind": kind, "id": item_id})
    except Exception as e:  # noqa: BLE001
        _flash(f"Not queued: {e}", error=True)
        return
    _flash("Queued: the next grader run grades it")


def tuning_left_out() -> None:
    kind = st.segmented_control("Kind", list(LEFT_KINDS), format_func=LEFT_KINDS.get, default="coverage", required=True,
                                key="tune-left-kind", label_visibility="collapsed") or "coverage"
    base = (("days", LEFT_DAYS), ("kind", kind), ("limit", LEFT_SHOW))
    data, why = optional_json("/v1/left-out", base)
    if data is None:
        st.caption(f"Left out {why}.")
        return
    st.markdown(left_out_counts_html(data.get("counts")), unsafe_allow_html=True)
    rows, seed = left_out_counts(data.get("counts"))
    options = [""] + [k for k, _ in rows] + (["archive_seed"] if seed else [])
    # Keep a picked reason selectable when the other kind has none of it.
    picked = st.session_state.get("tune-left-reason")
    if picked and picked not in options:
        options.append(picked)
    reason = st.selectbox("Skip reason", options, key="tune-left-reason",
                          format_func=lambda r: skip_text(r) if r else "All reasons (archive seed apart)")
    if reason:
        data, why = optional_json("/v1/left-out", base + (("reason", reason),))
        if data is None:
            st.caption(f"Left out {why}.")
            return
    items = [i for i in data.get("items") or [] if isinstance(i, dict)][:LEFT_SHOW]
    if not items:
        st.caption(f"Nothing left out for this reason in the last {LEFT_DAYS} days.")
    for n, it in enumerate(items):
        item_id = it.get("id")
        # The position keeps the key unique when items have no id.
        with st.container(border=True, key=f"zcard-left-{kind}-{n}-{widget_slug(item_id)}"):
            st.markdown(left_out_item_html(it), unsafe_allow_html=True)
            blocked = left_blocked(it)
            if blocked:
                st.markdown(f'<div class="z-health">Can\'t grade it: {html.escape(blocked)}</div>', unsafe_allow_html=True)
            elif isinstance(item_id, int):
                st.button("Grade it", key=f"tune-grade-{kind}-{item_id}", on_click=_grade_left, args=(kind, item_id),
                          help="Back to pending: the next grader run grades it.")


def tuning_grader() -> None:
    ops, why = optional_json("/v1/ops")
    if ops is None:
        st.caption(f"Grader health {why}.")
        return
    st.markdown(grader_strip_html(ops), unsafe_allow_html=True)
    for line in grader_details(ops):
        st.text(line)
    gaps = grader_gaps(ops)
    if gaps:
        _table(["From", "To", "Gap"], [[utc_text(g.get("from")), utc_text(g.get("to")), _hours(g.get("hours"))] for g in gaps])
    else:
        st.caption("No gaps over 2 h between grader runs in the last 7 days.")
    st.caption(GAP_NOTE + (f" As of {utc_text(ops['as_of'])}." if ops.get("as_of") else ""))


def _exp_key(row: dict) -> str:
    # The numeric id only: no server text goes into a widget key.
    return f"tune-exp-{exp_id(row)}"


def _decide(row: dict, action: str) -> None:
    key = _exp_key(row)
    reason = st.session_state.get(f"{key}:reason") if action == "reject" else None
    tickers = st.session_state.get(f"{key}:tk") if action == "approve" else None
    st.session_state.pop(f"{key}:confirm", None)
    if action == "reject":
        st.session_state[f"{key}:reason"] = None  # the picker starts empty again, saved or not
    body = decide_body(row, action, reason, tickers)
    try:
        post_json("/v1/expansion/decide", body)
    except Exception as e:  # noqa: BLE001
        _flash(f"{one_line(row.get('name')) or body['id']} not saved: {e}", error=True)
        return
    _flash(decide_toast(row, body))


def _on_exp_reason(key: str) -> None:
    # Reject waits for a confirm click, like Mute.
    if st.session_state.get(f"{key}:reason"):
        st.session_state[f"{key}:confirm"] = True
    else:
        st.session_state.pop(f"{key}:confirm", None)


def _cancel_exp(key: str) -> None:
    st.session_state.pop(f"{key}:confirm", None)
    st.session_state[f"{key}:reason"] = None


def expansion_row(row: dict, covered: list[str]) -> None:
    key = _exp_key(row)
    with st.container(border=True, key=f"zcard-exp-{exp_id(row)}"):
        st.markdown(expansion_card_html(row), unsafe_allow_html=True)
        actions = exp_actions(row)
        if not actions:
            return
        box = st.container(horizontal=True, gap="small", vertical_alignment="center", key=f"zexp-{exp_id(row)}")
        if "approve" in actions:
            mine = [t for t in _str_list(row.get("tickers")) if t]
            options = sorted(set(covered) | set(mine))
            if options:
                box.multiselect("Tickers", options, default=[t for t in mine if t in options], key=f"{key}:tk",
                                placeholder="Tickers (optional)", label_visibility="collapsed", width=220,
                                help="The covered companies this name's source affects. Optional.")
            box.button("Approve", key=f"{key}:approve", type="primary", on_click=_decide, args=(row, "approve"),
                       help="The weekly compile gives it its own source (with your OK on each deploy).")
        if "reject" in actions:
            box.selectbox("Reject reason", [v for v, _ in EXP_REASONS], index=None, format_func=EXP_REASON_TEXT.get,
                          key=f"{key}:reason", placeholder="Reject: pick a reason", label_visibility="collapsed",
                          width=220, on_change=_on_exp_reason, args=(key,))
        if "reopen" in actions:
            box.button("Not the same company", key=f"{key}:reopen", on_click=_decide, args=(row, "reopen"),
                       help="A name-only match can be wrong: back to Pending, where you can approve or reject it.")
        reason = st.session_state.get(f"{key}:reason")
        if "reject" in actions and reason and st.session_state.get(f"{key}:confirm"):
            ask = st.container(horizontal=True, gap="small", vertical_alignment="center", key=f"zexpconfirm-{exp_id(row)}")
            ask.caption(f"Reject {one_line(row.get('name'))} ({EXP_REASON_TEXT.get(reason, reason)})? "
                        "It stays rejected when it is seen again; you can approve it later.")
            ask.button("Confirm reject", key=f"{key}:yes", type="primary", on_click=_decide, args=(row, "reject"))
            ask.button("Cancel", key=f"{key}:no", on_click=_cancel_exp, args=(key,))


def tuning_expansion() -> None:
    status = st.segmented_control("Status", [v for v, _ in EXP_STATUSES], format_func=dict(EXP_STATUSES).get,
                                  default="pending", required=True, key="tune-exp-status",
                                  label_visibility="collapsed") or "pending"
    data, why = optional_json("/v1/expansion/candidates", (("limit", EXP_LIMIT), ("status", status)))
    if data is None:
        st.caption(f"Expansion queue {why}.")
        return
    st.caption(EXP_HELP)
    st.markdown(f'<div class="z-health">{html.escape(exp_counts_text(data.get("counts")))}</div>', unsafe_allow_html=True)
    stats, _ = optional_json("/v1/stats")
    covered = _str_list((stats or {}).get("tickers"))
    rows = exp_rows(data.get("candidates"))
    if not rows:
        days = data.get("days")
        st.caption(f"No {EXP_STATUS_TEXT.get(status, status).lower()} names"
                   + (f" in the last {_num(days)} days." if days else "."))
    for row in rows:
        expansion_row(row, covered)


def render_tuning() -> None:
    with st.sidebar:
        st.markdown('<div class="z-brand">ZEN<span>I</span>TH</div><div class="z-sub">grader tuning</div>',
                    unsafe_allow_html=True)
        st.write("")
        if st.button("Refresh", key="tune-refresh"):
            get_json.clear()
            st.rerun()
    _show_flash()
    st.markdown("#### Tuning")
    st.markdown("##### Calibration")
    tuning_calibration()
    st.markdown("##### Expansion queue")
    tuning_expansion()
    st.markdown("##### Source yield")
    tuning_yield()
    st.markdown("##### Left out")
    tuning_left_out()
    st.markdown("##### Grader")
    tuning_grader()
