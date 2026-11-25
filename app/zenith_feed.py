"""Shared code for Zenith's pages.

Coverage Universe reads /v1/feed and labels through /v1/feedback, exactly as the
single-page app did. Auxiliary Names reads /v1/aux/feed and labels through
/v1/aux/feedback. Both read /v1/stats (auxiliary counts live under stats.aux).
Tuning reads /v1/calibration, /v1/expansion/candidates, /v1/source-yield,
/v1/left-out and /v1/ops and writes /v1/expansion/decide (approve, reject,
reopen), /v1/source-prefs and /v1/left-out/grade; it also reads /v1/recall
(counts only). The Coverage page shows /v1/ops as its grader strip and
/v1/news-ops as its ops strip. Brief reads /v1/brief and /v1/calendar. A route an older zenith-core lacks shows "not available yet".
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
from urllib.parse import quote_plus, urlparse

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


# ---- Bill autonomy lines (unit tested) --------------------------------------------
# /v1/feed's bill_lines for a bill item (zenith-core bill-lines.js): status "ok" with
# groups of rows and totals in dollars, "retry" while the bill is read, or "failed".
def usd(value) -> str:
    """$1.23B / $726.0M / $509K / $250, like zenith-core's grader block; "-" when unknown."""
    if not isinstance(value, (int, float)) or isinstance(value, bool):
        return "-"
    a, sign = abs(value), "-" if value < 0 else ""
    if a >= 1e9:
        return f"{sign}${a / 1e9:.{1 if a >= 1e11 else 2}f}B"
    if a >= 1e6:
        return f"{sign}${a / 1e6:.1f}M"
    if a >= 1e3:
        return f"{sign}${round(a / 1e3)}K"
    return f"{sign}${a:g}"


def signed_usd(value) -> str:
    if not isinstance(value, (int, float)) or isinstance(value, bool):
        return "-"
    if value == 0:
        return "0"
    return f"+{usd(value)}" if value > 0 else usd(value)


def _request_text(t: dict) -> str:
    return f"request {usd(t.get('request'))}" if t.get("request_lines") else "no request figures"


def bill_lines_summary(bl) -> str | None:
    """One plain line for the card: the bill, its stage and the overall autonomy total."""
    if not isinstance(bl, dict):
        return None
    status = bl.get("status")
    if status == "retry":
        return "Autonomy lines: reading the bill text"
    if status == "failed":
        return f"Autonomy lines: the bill text could not be read ({one_line(bl.get('error')) or 'error'})"
    if status != "ok":
        return None
    t = bl.get("totals") or {}
    name = one_line(f"{bl.get('bill') or ''} {bl.get('version') or ''}")
    stage = f" ({one_line(bl.get('stage'))})" if bl.get("stage") else ""
    report = str(bl.get("package") or "").startswith("CRPT-")
    # No lines, or no amount counted: never "$0" (the program amounts of an
    # appropriations act are in its committee report).
    if not t.get("lines"):
        return f"Autonomy lines: {name}{stage}: none in the {'report' if report else 'bill'} text"
    note = " (report text only)" if report else ""
    return f"Autonomy lines: {name}{stage}: {bill_lines_total_text(t)}{note}"


def bill_lines_total_text(t: dict) -> str:
    """'N lines, $X (request $Y)', or 'N lines, no amounts counted' when no counted
    line carries an amount."""
    if not (t.get("bill") or t.get("change") or t.get("request_lines")):
        return f"{_num(t.get('lines'))} lines, no amounts counted"
    return f"{_num(t.get('lines'))} lines, {usd(t.get('bill'))} ({_request_text(t)})"


def bill_line_rows(group: dict) -> list[list[str]]:
    """Item, account, request, bill, change for one group's table. A change made inside
    another line shows where it sits; changes listed under a line are shown under it
    with an arrow and are not added again."""
    out = []
    for r in group.get("rows") or []:
        if not isinstance(r, dict):
            continue
        item = one_line(r.get("item"))
        if r.get("note"):
            item += f" ({one_line(r['note'])})"
        where = one_line(r.get("account") or r.get("section"))
        if r.get("line"):
            where += f", line {one_line(r['line'])}"
        if r.get("inside"):
            where += f", inside {one_line(r['inside'])}"
        if r.get("kind") == "provision":
            out.append([item, where, "-", "no amount", "-"])
            continue
        out.append([item, where, usd(r.get("request")), usd(r.get("bill")), signed_usd(r.get("change"))])
        for c in (r.get("changes") or [])[:12]:
            if isinstance(c, dict):
                out.append([f"↳ {one_line(c.get('item'))}", "", "", "", signed_usd(c.get("change"))])
    return out


def bill_lines_html(bl) -> str:
    """Grouped, collapsible tables: one <details> per group, its header carrying the
    group's total. Every string is escaped (html_table)."""
    if not isinstance(bl, dict) or bl.get("status") != "ok":
        return ""
    parts = []
    for g in bl.get("groups") or []:
        if not isinstance(g, dict):
            continue
        sums = "no amounts" if g.get("name") == "Provisions (no amount)" else f"{usd(g.get('bill'))} ({_request_text(g)})"
        head = html.escape(f"{one_line(g.get('name'))}: {_num(g.get('lines'))} lines, {sums}")
        table = html_table(["Item", "Account", "Request", "Bill", "Change"], bill_line_rows(g), wrap=0)
        parts.append(f'<details class="z-bl"><summary>{head}</summary>{table}</details>')
    more = _num(bl.get("more"))
    if more:
        parts.append(f'<div class="z-bl-more">+{more} smaller lines not stored (they are in the totals)</div>')
    return "".join(parts)


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
    # A bill item's autonomy total (the grouped table is in the card's expander).
    summary = bill_lines_summary(it.get("bill_lines")) if page.kind != "aux" else None
    bl = f'<div class="z-bl-sum">{html.escape(summary)}</div>' if summary else ""
    lead = " lead" if it.get("band") == "lead" else ""
    return (f'<div class="z-card{lead}"><div class="z-head">{head}</div>'
            f'<div class="z-title">{title}</div>{why}{bl}{rt}</div>')


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
GAP_NOTE = ("A gap usually means the account's usage limit refused a scheduled grader run: the routine "
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


def _plural(n: int, word: str) -> str:
    return f"{n} {word}" + ("" if n == 1 else "s")


def open_gap_of(g) -> dict | None:
    """The grader block's open gap (phase 1 /v1/ops), or None (none, or an older zenith-core)."""
    gap = g.get("open_gap") if isinstance(g, dict) else None
    return gap if isinstance(gap, dict) else None


def _missed(gap: dict) -> int:
    return max(1, _num(gap.get("missed_runs")))


def _every(g: dict, gap: dict | None = None) -> int | None:
    """Expected minutes between grader runs: the open gap's, else the grader block's."""
    for src in (gap or {}, g or {}):
        if src.get("expected_every_min") is not None and _num(src.get("expected_every_min")) > 0:
            return _num(src["expected_every_min"])
    return None


def released_by_source(backlog) -> tuple[list[dict], int | None]:
    """(rows, per_source) from backlog.released_by_source_today: rows of {source_key, n}, most
    first; per_source from the rows, the field's own object or backlog.budget. ([], None) when absent."""
    if not isinstance(backlog, dict):
        return [], None
    field = backlog.get("released_by_source_today")
    rows, cap = field, None
    if isinstance(field, dict):
        cap = field.get("per_source")
        rows = next((field[k] for k in ("top", "sources", "items") if isinstance(field.get(k), list)), [])
    rows = [r for r in rows or [] if isinstance(r, dict)] if isinstance(rows, list) else []
    if cap is None:
        cap = next((r["per_source"] for r in rows if r.get("per_source") is not None), None)
    budget = backlog.get("budget")
    if cap is None and isinstance(budget, dict):
        cap = budget.get("per_source")
    return sorted(rows, key=lambda r: -_num(r.get("n"))), (_num(cap) if cap is not None else None)


def grader_strip_html(ops) -> str:
    """One line: "Grader: last run 12 min ago · Aux backlog 96 (oldest Nov 9) · Headlines
    waiting 239 · Budget 20/20 today (max 4/5 per source)", the run part red when the grader
    is late or down or has missed runs. Escaped."""
    g = grader_of(ops)
    if g is None:
        return '<div class="z-health">Grader: not available yet</div>'
    last, status = g.get("last_run_at"), str(g.get("status") or "")
    run = f"last run {html.escape(run_ago(last))}" if last else "no runs yet"
    gap = open_gap_of(g)
    if gap is not None:
        run = f"{_plural(_missed(gap), 'run')} missed · {run}"
    if status in BAD_STATUS or gap is not None:
        run = f'<span class="z-bad">{html.escape(status or "late")} · {run}</span>'
    parts = [f"Grader: {run}"]
    backlog = g.get("backlog")
    if isinstance(backlog, dict):
        aux = f"Aux backlog {_num(backlog.get('aux_pending'))}"
        if _num(backlog.get("aux_pending")) and backlog.get("oldest_aux_pending_at"):
            aux += f" (oldest {html.escape(day_text(backlog['oldest_aux_pending_at']))})"
        parts += [aux, f"Headlines waiting {_num(backlog.get('headlines_waiting'))}"]
        budget = backlog.get("budget")
        if "released_today" in backlog and isinstance(budget, dict) and budget.get("total") is not None:
            use = f"Budget {_num(backlog.get('released_today'))}/{_num(budget.get('total'))} today"
            rows, cap = released_by_source(backlog)
            if rows:
                use += f" (max {_num(rows[0].get('n'))}/{cap if cap is not None else '?'} per source)"
            parts.append(use)
    return f'<div class="z-health">{" · ".join(parts)}</div>'


def open_gap_line(ops) -> str | None:
    """ "Now: no run since Nov 25 14:08 UTC (2 missed, expected every 30 min)." or None."""
    g = grader_of(ops)
    gap = open_gap_of(g)
    if gap is None:
        return None
    since = gap.get("from") or g.get("last_run_at")
    every = _every(g, gap)
    return (f"Now: no run since {utc_text(since)} ({_missed(gap)} missed"
            + (f", expected every {every} min" if every else "") + ").")


def gaps_header(ops) -> str:
    """The count of missed-run gaps in 7 days; never "No missed" while a gap is open."""
    gaps = grader_gaps(ops)
    if gaps:
        return f"Missed grader runs, last 7 days: {len(gaps)}."
    if open_gap_of(grader_of(ops)) is not None:
        return "No earlier missed grader runs in the last 7 days."
    return "No missed grader runs in the last 7 days."


def gap_lines(ops) -> list[str]:
    """Plain-text lines for the strip's popover: an open gap first, then the missed-run gaps in
    7 days, and why they happen."""
    if grader_of(ops) is None:
        return ["Grader health is not available yet (this zenith-core has no /v1/ops)."]
    now = open_gap_line(ops)
    lines = ([now] if now else []) + [gaps_header(ops)]
    for x in grader_gaps(ops):
        missed = f", {_num(x.get('missed_runs'))} missed" if x.get("missed_runs") is not None else ""
        lines.append(f"  {utc_text(x.get('from'))} to {utc_text(x.get('to'))} ({_hours(x.get('hours'))}{missed})")
    return lines + [GAP_NOTE]


def held_budget_text(backlog) -> str:
    """' N held for the daily grading budget (M released today of T).' when /v1/ops
    reports held rows (backlog.coverage_held / aux_held, released_today, budget.total);
    '' for an older zenith-core without those fields. Plain text (st.text)."""
    if not isinstance(backlog, dict) or not any(k in backlog for k in ("coverage_held", "aux_held")):
        return ""
    held = _num(backlog.get("coverage_held")) + _num(backlog.get("aux_held"))
    budget = backlog.get("budget")
    total = budget.get("total") if isinstance(budget, dict) else None
    if "released_today" in backlog:
        released = _num(backlog.get("released_today"))
        tail = f" ({released} released today of {_num(total)})" if total is not None else f" ({released} released today)"
    else:
        tail = ""
    return f" {held} held for the daily grading budget{tail}."


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
    if _every(g):
        lines.append(f"Expected every {_every(g)} min.")
    backlog = g.get("backlog")
    if isinstance(backlog, dict):
        oldest = backlog.get("oldest_aux_pending_at")
        lines.append(f"Backlog: {_num(backlog.get('coverage_pending'))} coverage items pending, "
                     f"{_num(backlog.get('aux_pending'))} auxiliary pending"
                     + (f" (oldest first seen {utc_text(oldest)})" if oldest else "")
                     + f", {_num(backlog.get('headlines_waiting'))} graded cards waiting for a headline."
                     + held_budget_text(backlog))
    lines += grades_today_lines(g)
    if isinstance(backlog, dict):
        lines += backlog_phase1_lines(backlog)
    for c in g.get("checks") or []:
        if isinstance(c, dict):
            state = str(c.get("state") or "?")
            detail = one_line(c.get("detail")) if state != "ok" else ""
            lines.append(f"Check {c.get('key') or '?'}: {state}" + (f". {detail}" if detail else ""))
    return lines


def _grades_part(name: str, d) -> str:
    if not isinstance(d, dict):
        return ""
    paths = [("budgeted", "budgeted"), ("fast_path", "fast path"), ("regrade", "re-grades"), ("own_lane", "own lane")]
    inner = ", ".join(f"{text} {_num(d.get(k))}" for k, text in paths if k in d)
    return f"{name} {_num(d.get('n'))}" + (f" ({inner})" if inner else "")


def grades_today_lines(g) -> list[str]:
    """ "Grades today (UTC): coverage 12 (budgeted 4, fast path 7, re-grades 1, own lane 5);
    auxiliary 3 (...)." from grader.grades_today; [] for an older zenith-core."""
    today = g.get("grades_today") if isinstance(g, dict) else None
    if not isinstance(today, dict):
        return []
    parts = [p for p in (_grades_part("coverage", today.get("coverage")), _grades_part("auxiliary", today.get("aux"))) if p]
    return [f"Grades today (UTC): {'; '.join(parts)}."] if parts else []


def backlog_phase1_lines(backlog: dict) -> list[str]:
    """Tuning lines for the phase 1 backlog fields, each only when /v1/ops sends it."""
    lines = []
    rows, cap = released_by_source(backlog)
    if rows:
        lines.append("Released today by source: " + ", ".join(
            f"{one_line(r.get('source_key')) or '?'} {_num(r.get('n'))}/{cap if cap is not None else '?'}" for r in rows) + ".")
    stuck, stale = backlog.get("stuck_claims"), backlog.get("stale_claims")
    stuck = stuck if isinstance(stuck, dict) else {}
    stale = stale if isinstance(stale, dict) else {}
    counts = [_num(stuck.get("coverage")), _num(stuck.get("aux")), _num(stale.get("coverage")), _num(stale.get("aux"))]
    if any(counts):
        lines.append(f"Claims not returned after 15 min: coverage {counts[0]}, auxiliary {counts[1]} "
                     f"(lease expired: {counts[2]}/{counts[3]}).")
    held = _num(backlog.get("source_cap_held"))
    if held > 0:
        budget = backlog.get("budget")
        per = budget.get("per_source") if isinstance(budget, dict) else None
        lines.append(f"Held by the source cap: {held} (hidden from the feeds until released"
                     + (f", at most {_num(per)} per source a day" if per is not None else "") + ").")
    return lines


# ---- Phase 1: grader banner (/v1/ops on every Streamlit page; unit tested) -----------
# Red when the grader missed a scheduled run, is late or down, or left coverage claims
# unreturned. Aux stuck or stale claims and the queue_stale check never trigger it (aux
# lease expiries are routine; queue_stale is on Tuning). Never starts with "Grader:", the strip.
def grader_alert(ops) -> str | None:
    """Plain text for the banner, or None when all is well (or there is no grader block)."""
    g = grader_of(ops)
    if g is None:
        return None
    status = str(g.get("status") or "")
    gap = open_gap_of(g)
    unfinished = g.get("last_run_unfinished") is True
    if status not in BAD_STATUS and gap is None and not unfinished:
        return None
    parts = []
    if gap is not None:
        since = gap.get("from") or g.get("last_run_at")
        every = _every(g, gap)
        lead = (f"Grader down: missed {_plural(_missed(gap), 'run')}," if status == "down"
                else f"Grader missed {_plural(_missed(gap), 'run')}:")
        parts.append(f"{lead} last activity {utc_text(since)} ({run_ago(since)})"
                     + (f", expected every {every} min" if every else ""))
    elif status in BAD_STATUS:
        # An older zenith-core (no open_gap): its status alone.
        last = g.get("last_run_at")
        parts.append(f"Grader {status}: " + (f"last run {run_ago(last)}" if last else "no run recorded"))
    if unfinished:
        backlog = g.get("backlog") if isinstance(g.get("backlog"), dict) else {}
        stuck = backlog.get("stuck_claims") if isinstance(backlog.get("stuck_claims"), dict) else {}
        c = _num(stuck.get("coverage"))
        what = f"{_plural(c, 'coverage item')}" if c else "coverage items"
        parts.append(f"Last run stopped part-way: {what} claimed over 15 min ago and not returned")
    return " · ".join(parts) or None


def grader_banner_html(ops) -> str:
    """The banner's HTML (escaped), or "" when there is nothing to show."""
    text = grader_alert(ops)
    return f'<div class="z-banner">{html.escape(text)}</div>' if text else ""


def grader_banner() -> None:
    """Every Streamlit page: the red grader banner, from the cached /v1/ops the strip shares."""
    ops, _ = optional_json("/v1/ops")
    banner = grader_banner_html(ops) if ops is not None else ""
    if banner:
        st.markdown(banner, unsafe_allow_html=True)


# ---- Zenith show (phase 0) ---------------------------------------------------------
# The Coverage page's news-monitor ops strip (/v1/news-ops), the Brief page (/v1/brief,
# /v1/calendar) and the Tuning page's Recall section (/v1/recall). Pure functions are
# unit tested; every server string is escaped and links must be http(s).

# ---- News-monitor ops strip (/v1/news-ops; unit tested) ----
OPS_NAMES = 3
ALERT_TEXT = {"outage": "outage", "break": "break", "crosscheck_missing_release": "release missing for a filing",
              "crosscheck_missing_filing": "filing missing for a release", "lateness": "late",
              "never_yielded": "never yielded", "owner_empty": "empty newsroom", "all_excluded": "all items excluded",
              "redirect_host": "redirected off-host", "feed_html": "page, not a feed", "no_state": "never polled",
              "scale_trigger": "capacity trigger", "silence": "silent", "layout_drift": "page layout changed"}
BING_NOTE = "Bing feed flaps are left out ({n} open now): they clear by themselves in about 18 minutes."


def rule_text(rule) -> str:
    rule = str(rule or "")
    return ALERT_TEXT.get(rule, rule.replace("_", " "))


def alert_name(a: dict) -> str:
    """ "lane:strategic_noncompany" -> "strategic noncompany lane"; "ticker:ONDS" -> "ONDS";
    "scale:..." -> "capacity"; otherwise the source key."""
    key = str((a or {}).get("source_key") or "?")
    if key.startswith("lane:"):
        return f"{key[5:].replace('_', ' ')} lane"
    if key.startswith("ticker:"):
        return key[7:]
    if key.startswith("scale:"):
        return "capacity"
    return key


def detail_text(v) -> str:
    """A detail value as text: a list joined with ", " (items 7.01, 9.01). The caller escapes it."""
    return ", ".join(str(x) for x in v) if isinstance(v, list) else str(v)


def _alerts_of(news_ops) -> dict | None:
    a = news_ops.get("alerts") if isinstance(news_ops, dict) else None
    return a if isinstance(a, dict) else None


def _managed_of(news_ops) -> dict | None:
    m = news_ops.get("managed") if isinstance(news_ops, dict) else None
    return m if isinstance(m, dict) else None


def _open_alerts(alerts: dict) -> list[dict]:
    return [a for a in alerts.get("open") or [] if isinstance(a, dict)]


def ops_strip_html(news_ops) -> str:
    """One line: "News-monitor: 3 open alerts (strategic noncompany lane late, ONDS release missing
    for a filing, pi outage) · Managed lane: 7 of 120 failing". A part is red only when its count is
    above 0; a missing block reads "unavailable". Every value is escaped."""
    alerts = _alerts_of(news_ops)
    if alerts is None:
        nm = "unavailable"
    else:
        counted = [a for a in _open_alerts(alerts) if not a.get("acknowledged") and not a.get("snoozed")]
        n = _num(alerts.get("open_count"))
        if n:
            names = [f"{alert_name(a)} {rule_text(a.get('rule'))}" for a in counted[:OPS_NAMES]]
            more = f", +{n - OPS_NAMES} more" if n > OPS_NAMES else ""
            listed = f" ({html.escape(', '.join(names))}{more})" if names else ""
            nm = f'<span class="z-bad">{n} open alert{"" if n == 1 else "s"}</span>{listed}'
        else:
            nm = "no open alerts"
    managed = _managed_of(news_ops)
    if managed is None:
        lane = "unavailable"
    else:
        failing = _num(managed.get("failing_count"))
        text = f"{failing} of {_num(managed.get('configured'))} failing"
        lane = f'<span class="z-bad">{text}</span>' if failing else text
    return f'<div class="z-health">News-monitor: {nm} · Managed lane: {lane}</div>'


def ops_details(news_ops) -> list[str]:
    """Plain-text lines for the strip's Alerts popover (st.text, never Markdown): each open alert,
    the Bing note, then each failing managed source. No grader gaps (the grader strip has them)."""
    lines = []
    alerts = _alerts_of(news_ops)
    if alerts is None:
        lines.append("News-monitor alerts: unavailable (ops_alerts could not be read).")
    else:
        rows = _open_alerts(alerts)
        if not rows:
            lines.append("News-monitor: no open alerts.")
        for a in rows:
            d = a.get("detail") if isinstance(a.get("detail"), dict) else {}
            line = f"{alert_name(a)}: {rule_text(a.get('rule'))}, open since {utc_text(a.get('opened_at'))}"
            if "fail_count" in d:
                line += f", {_num(d['fail_count'])} fails"
            if d.get("last_error"):
                line += f", {one_line(d['last_error'])}"
            if d.get("items") not in (None, "", []):
                line += f", items {detail_text(d['items'])}"
            if d.get("url") and safe_url(d.get("url")):
                line += f", {d['url']}"
            if a.get("acknowledged"):
                line += " (acknowledged)"
            if a.get("snoozed"):
                line += " (snoozed)"
            lines.append(line)
        lines.append(BING_NOTE.format(n=_num(alerts.get("bing_open"))))
    managed = _managed_of(news_ops)
    if managed is None:
        lines.append("Managed lane: unavailable (its tables could not be read).")
    else:
        failing = [f for f in managed.get("failing") or [] if isinstance(f, dict)]
        lines.append(f"Managed lane: {len(failing)} of {_num(managed.get('configured'))} sources failing (3 or more fails in a row).")
        for f in failing:
            last = f"last ok {day_text(f['last_ok'])}" if f.get("last_ok") else "never ok"
            err = f", {one_line(f['last_error'])}" if f.get("last_error") else ""
            lines.append(f"  {one_line(f.get('name')) or f.get('key')} ({f.get('key')}): {_num(f.get('fail_count'))} fails, {last}{err}")
    return lines


def ops_strip() -> None:
    """Coverage page: news-monitor's open alerts and the managed lane, details in a popover.
    It never calls /v1/ops (the grader strip above it does)."""
    news_ops, why = optional_json("/v1/news-ops")
    if news_ops is None:
        st.caption(f"News-monitor ops {why}")
        return
    row = st.container(horizontal=True, gap="small", vertical_alignment="center", key="zops")
    row.markdown(ops_strip_html(news_ops), unsafe_allow_html=True, width="content")
    with row.popover("Alerts", width="content"):
        for line in ops_details(news_ops):
            st.text(line)


# ---- Brief and calendar (/v1/brief, /v1/calendar; unit tested) ----
BRIEF_WINDOWS = {"12 h": 12, "24 h": 24, "3 days": 72}
BRIEF_DEFAULT = "24 h"
BRIEF_CAP = {"graded": 40, "counterparty": 15, "waiting": 20}
CAL_DAYS = 30
CAL_WINDOW_MAX_DAYS = 92
CAL_HIDDEN_KINDS = ("status_event",)
WEEKDAYS = ("Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday")


def _clip(text, n: int) -> str:
    s = one_line(text)
    return s if len(s) <= n else s[: n - 1].rstrip() + "…"


def _link(url, text: str) -> str:
    """Escaped text, linked only when the url is http(s)."""
    t = html.escape(text)
    if safe_url(url):
        return f'<a href="{html.escape(str(url), quote=True)}" target="_blank" rel="noopener noreferrer">{t}</a>'
    return t


def brief_since(hours, now: datetime | None = None) -> str:
    """now - hours, floored to the UTC hour: a stable ?since= for get_json's 30 s cache."""
    t = (now or datetime.now(timezone.utc)).astimezone(timezone.utc) - timedelta(hours=float(hours))
    return t.strftime("%Y-%m-%dT%H:00:00Z")


def brief_item_html(r: dict) -> str:
    """A Lead or Digest row as a compact card: ticker, score · band, age; the link text
    (headline - tag, else the title); the why line clipped to 240."""
    ticker, item_ticker = str(r.get("ticker") or ""), str(r.get("item_ticker") or "")
    src = (f'<span class="z-badge src">from {html.escape(item_ticker)}</span>'
           if item_ticker and item_ticker != ticker else "")
    when = r.get("graded_at")
    age = f'<span class="z-age">{html.escape(ago(when))}</span>' if when else ""
    why = f'<div class="z-why">{html.escape(_clip(r.get("why"), 240))}</div>' if r.get("why") else ""
    lead = " lead" if r.get("band") == "lead" else ""
    return (f'<div class="z-card{lead}"><div class="z-head"><b class="z-name">{html.escape(ticker)}</b>{band_badge(r)}{src}{age}</div>'
            f'<div class="z-title">{_link(r.get("url"), link_text(r))}</div>{why}</div>')


def brief_counterparty_html(r: dict) -> str:
    """TICKER ← role · score · link text — why (180)."""
    why = f" — {html.escape(_clip(r.get('why'), 180))}" if r.get("why") else ""
    return (f'<div class="z-cal"><b>{html.escape(str(r.get("ticker") or ""))}</b> ← {html.escape(str(r.get("role") or ""))}'
            f' · {html.escape(str(r.get("score") if r.get("score") is not None else "?"))} · {_link(r.get("url"), link_text(r))}{why}</div>')


def brief_waiting_html(r: dict) -> str:
    """TICKER · age since first seen · title link."""
    seen = r.get("nm_first_seen")
    age = f" · {html.escape(ago(seen))}" if seen else ""
    return f'<div class="z-cal"><b>{html.escape(str(r.get("ticker") or ""))}</b>{age} · {_link(r.get("url"), link_text(r))}</div>'


def brief_health_lines(h) -> list[str]:
    """Plain text: the grader's last run, grades in this window, and news-monitor's covered sources."""
    h = h if isinstance(h, dict) else {}
    last = h.get("grader_last_run")
    lines = [f"Grader last ran {utc_text(last)} ({run_ago(last)})." if last else "Grader has never run.",
             f"{_num(h.get('graded_in_window'))} grades in this window."]
    nm = h.get("news_monitor")
    if not isinstance(nm, dict) or nm.get("error"):
        err = one_line(nm.get("error")) if isinstance(nm, dict) else "no data"
        lines.append(f"news-monitor: unavailable ({err}).")
        return lines
    failing = [f for f in nm.get("failing") or [] if isinstance(f, dict)]
    if not failing:
        lines.append("news-monitor: all covered sources OK.")
        return lines
    lines.append(f"news-monitor: {len(failing)} covered source{'' if len(failing) == 1 else 's'} failing.")
    for f in failing:
        ok = f"last ok {utc_text(f['last_ok'])}" if f.get("last_ok") else "never ok"
        lines.append(f"  {f.get('key')} ({f.get('ticker')}): {_num(f.get('fail_count'))} fails, {ok}")
    return lines


def brief_label_html(r: dict) -> str:
    """item N · TICKER score · title link · why it was picked."""
    return (f'<div class="z-cal">item {html.escape(str(r.get("item_id")))} · <b>{html.escape(str(r.get("ticker") or ""))}'
            f' {html.escape(str(r.get("score") if r.get("score") is not None else ""))}</b> · {_link(r.get("url"), link_text(r))}'
            f' · <i>{html.escape(one_line(r.get("why")))}</i></div>')


def _day(value) -> datetime | None:
    try:
        return datetime.strptime(str(value)[:10], "%Y-%m-%d")
    except ValueError:
        return None


def _span_days(e: dict) -> int:
    start, end = _day(e.get("start")), _day(e.get("end") or e.get("start"))
    return (end - start).days + 1 if start and end else 1


def calendar_groups(entries, today: str, ticker: str | None = None, review: bool = False) -> dict:
    """{"dated": [(day, [entries])], "weekly": [entries + weekday], "windows": [entries], "long": n}.
    Status events and context lines are always left out, review dates unless review."""
    keep = []
    for e in entries or []:
        if not isinstance(e, dict) or e.get("kind") in CAL_HIDDEN_KINDS or e.get("context"):
            continue
        if e.get("kind") == "open_item_expiry" and not review:
            continue
        if ticker and e.get("ticker") != ticker:
            continue
        keep.append(e)
    dated: dict[str, list] = {}
    weekly, seen, windows, long = [], set(), [], 0
    for e in keep:
        start = str(e.get("start") or "")
        if e.get("recurring"):
            key = (e.get("ticker"), e.get("text"))
            if key in seen:
                continue
            seen.add(key)
            d = _day(start)
            weekly.append({**e, "weekday": WEEKDAYS[d.weekday()] if d else ""})
        elif e.get("precision") == "day":
            if start >= str(today):
                dated.setdefault(start, []).append(e)
        elif _span_days(e) <= CAL_WINDOW_MAX_DAYS:
            windows.append(e)
        else:
            long += 1
    days = [(d, sorted(es, key=lambda e: (not e.get("confirmed"), str(e.get("ticker") or "")))) for d, es in sorted(dated.items())]
    windows.sort(key=lambda e: (str(e.get("start") or ""), str(e.get("ticker") or "")))
    return {"dated": days, "weekly": weekly, "windows": windows, "long": long}


def calendar_day_label(day) -> str:
    """ "Mon Nov 30"."""
    d = _day(day)
    return f"{d:%a} {d:%b} {d.day}" if d else str(day or "")


def calendar_entry_html(e: dict, show_day: bool = False) -> str:
    """TICKER · text, then its tags (confirmed notice, council agenda (as first seen), estimate,
    deadline, weekly, the time) and a source link. A window says from when to when. Escaped."""
    tags = []
    kind = e.get("kind")
    if kind == "graded_notice":
        tags.append("confirmed notice")
    elif kind == "council_agenda":
        tags.append("council agenda (as first seen)")
    if e.get("approx"):
        tags.append("estimate")
    if e.get("deadline"):
        tags.append("deadline")
    if e.get("recurring"):
        tags.append(f"weekly{' on ' + e['weekday'] if e.get('weekday') else ''}")
    if e.get("time"):
        tags.append(f"({one_line(e['time'])})")
    when = ""
    if e.get("precision") != "day" and not e.get("recurring"):
        when = (f'<span class="z-age">from {html.escape(day_text(e.get("start")))} to {html.escape(day_text(e.get("end") or e.get("start")))}'
                f' ({html.escape(str(e.get("precision") or ""))})</span> ')
    elif show_day:
        when = f'<span class="z-age">{html.escape(calendar_day_label(e.get("start")))}</span> '
    tag = "".join(f' <span class="z-age">· {html.escape(t)}</span>' for t in tags)
    src = (f' · <a href="{html.escape(str(e["url"]), quote=True)}" target="_blank" rel="noopener noreferrer">source</a>'
           if safe_url(e.get("url")) else "")
    return (f'<div class="z-cal">{when}<b>{html.escape(str(e.get("ticker") or ""))}</b> · '
            f'{html.escape(one_line(e.get("text")))}{tag}{src}</div>')


def _html_rows(rows) -> None:
    for r in rows:
        st.markdown(r, unsafe_allow_html=True)


def brief_sections(data: dict) -> None:
    """The brief's sections, in its own order, from GET /v1/brief."""
    groups = [g for g in data.get("leads_digests") or [] if isinstance(g, dict)]
    n_graded = sum(len(g.get("items") or []) for g in groups)
    st.markdown(f"##### Leads and Digests ({n_graded})")
    if not n_graded:
        st.caption("None graded in this window.")
    shown = 0
    for g in groups:
        if shown >= BRIEF_CAP["graded"]:
            break
        st.markdown(f"**{html.escape(str(g.get('ticker') or ''))}**")
        for r in g.get("items") or []:
            if shown >= BRIEF_CAP["graded"]:
                break
            if isinstance(r, dict):
                st.markdown(brief_item_html(r), unsafe_allow_html=True)
                shown += 1
    if n_graded > BRIEF_CAP["graded"]:
        st.caption(f"… and {n_graded - BRIEF_CAP['graded']} more on the Coverage page.")

    cp = [r for r in data.get("counterparty") or [] if isinstance(r, dict)]
    st.markdown(f"##### Counterparty items that passed ({len(cp)})")
    if not cp:
        st.caption("None.")
    _html_rows(brief_counterparty_html(r) for r in cp[: BRIEF_CAP["counterparty"]])
    if len(cp) > BRIEF_CAP["counterparty"]:
        st.caption(f"… and {len(cp) - BRIEF_CAP['counterparty']} more.")

    w = data.get("waiting") if isinstance(data.get("waiting"), dict) else {}
    items = [r for r in w.get("items") or [] if isinstance(r, dict)]
    count, cp_count = _num(w.get("count")), _num(w.get("counterparty_count"))
    oldest = f" · oldest {run_ago(w['oldest'])}" if w.get("oldest") else ""
    st.markdown(f"##### Waiting for a grade ({count} covered, {cp_count} counterparty){html.escape(oldest)}")
    if not items:
        st.caption("Queue is clear.")
    _html_rows(brief_waiting_html(r) for r in items[: BRIEF_CAP["waiting"]])
    if count > BRIEF_CAP["waiting"]:
        st.caption(f"… and {count - BRIEF_CAP['waiting']} more.")

    cats = [e for e in data.get("catalysts") or [] if isinstance(e, dict)]
    st.markdown(f"##### Next 7 days ({len(cats)})")
    if not cats:
        st.caption("Nothing dated.")
    _html_rows(calendar_entry_html(e, show_day=True) for e in cats)

    st.markdown("##### Health")
    for line in brief_health_lines(data.get("health")):
        st.text(line)

    picks = [r for r in data.get("to_label") or [] if isinstance(r, dict)]
    st.markdown(f"##### Label these ({len(picks)})")
    if not picks:
        st.caption("Nothing unlabelled this week.")
    else:
        st.caption("Label it on the Coverage page.")
    _html_rows(brief_label_html(r) for r in picks)


def brief_calendar() -> None:
    """The next 30 days from GET /v1/calendar: dated entries by day, weekly lines, then windows."""
    st.markdown(f"##### Calendar · next {CAL_DAYS} days")
    data, why = optional_json("/v1/calendar", (("days", CAL_DAYS),))
    if data is None:
        st.caption(f"Calendar {why}.")
        return
    entries = [e for e in data.get("entries") or [] if isinstance(e, dict)]
    today = str(data.get("from") or datetime.now(timezone.utc).strftime("%Y-%m-%d"))
    stats, _ = optional_json("/v1/stats")
    tickers = [str(t) for t in (stats or {}).get("tickers") or [] if t] or sorted({str(e["ticker"]) for e in entries if e.get("ticker")})
    ctl = st.container(horizontal=True, gap="small", vertical_alignment="center", key="zcal")
    pick = ctl.selectbox("Company", ["All"] + tickers, key="cal-ticker", persist_state="session", width=180)
    review = ctl.toggle("Show review dates", key="cal-review")
    groups = calendar_groups(entries, today, None if pick in (None, "All") else pick, review)
    if not groups["dated"]:
        st.caption(f"Nothing dated in the next {CAL_DAYS} days.")
    for day, es in groups["dated"]:
        st.markdown(f'<div class="z-cal-day">{html.escape(calendar_day_label(day))}</div>', unsafe_allow_html=True)
        _html_rows(calendar_entry_html(e) for e in es)
    if groups["weekly"]:
        st.markdown('<div class="z-cal-day">Weekly</div>', unsafe_allow_html=True)
        _html_rows(calendar_entry_html(e) for e in groups["weekly"])
    with st.expander(f"Windows open in the next {CAL_DAYS} days ({len(groups['windows'])})", expanded=False):
        if not groups["windows"]:
            st.caption("No windows.")
        _html_rows(calendar_entry_html(e) for e in groups["windows"])
        if groups["long"]:
            st.caption(f"{groups['long']} longer spans (over {CAL_WINDOW_MAX_DAYS} days) are not listed.")
    st.caption("Dates come from the company sheets, graded date notices and council agendas.")


def render_brief() -> None:
    """The Brief page: the brief as data (no model, nothing sent anywhere), then the calendar."""
    with st.sidebar:
        st.markdown('<div class="z-brand">ZEN<span>I</span>TH</div><div class="z-sub">brief and calendar</div>',
                    unsafe_allow_html=True)
        st.write("")
        if st.button("Refresh", key="brief-refresh"):
            get_json.clear()
            st.rerun()
    _show_flash()
    grader_banner()
    st.markdown("#### Brief")
    window = st.segmented_control("Window", list(BRIEF_WINDOWS), default=BRIEF_DEFAULT, required=True, key="brief-window",
                                  persist_state="session", label_visibility="collapsed") or BRIEF_DEFAULT
    data, why = optional_json("/v1/brief", (("since", brief_since(BRIEF_WINDOWS.get(window, 24))),))
    if data is None:
        st.caption(f"Brief {why}.")
    else:
        st.caption(f"Since {utc_text(data.get('from'))} · built {utc_text(data.get('generated_at'))} from the database, no model")
        brief_sections(data)
    brief_calendar()


# ---- Recall scoreboard (/v1/recall; unit tested) ----
RECALL_STATUS = [("on_time", "On time"), ("late", "Late"), ("partial", "Partial"), ("missed", "Missed")]
RECALL_KIND_TEXT = {"filing": "Filings", "regulator": "Regulators", "local_government": "Local government",
                    "program_award": "Program awards", "register": "Registers", "trade_press": "Trade press",
                    "news": "Releases and news"}
RECALL_CAPTION = ("Material events from the audit miss test. On time: captured and graded promptly. Late: captured 3 or "
                  "more days after the event. Partial: part of it captured. Missed: not captured.")


def recall_rows(data) -> list[list]:
    """An All row (from by_status and total), then one row per kind: [kind, on time, late, partial, missed, total]."""
    data = data if isinstance(data, dict) else {}
    st_ = data.get("by_status") if isinstance(data.get("by_status"), dict) else {}
    rows = [["All"] + [_num(st_.get(k)) for k, _ in RECALL_STATUS] + [_num(data.get("total"))]]
    for k in data.get("by_kind") or []:
        if isinstance(k, dict):
            kind = str(k.get("kind") or "")
            rows.append([RECALL_KIND_TEXT.get(kind, kind.replace("_", " "))] + [_num(k.get(s)) for s, _ in RECALL_STATUS]
                        + [_num(k.get("total"))])
    return rows


def recall_summary(data) -> str:
    """ "7 events · 3 on time (43%) · 2 late · 1 partial · 1 missed · checked Nov 24" (synthetic numbers)."""
    data = data if isinstance(data, dict) else {}
    st_ = data.get("by_status") if isinstance(data.get("by_status"), dict) else {}
    total = _num(data.get("total"))
    on_time = _num(st_.get("on_time"))
    pct = f" ({round(100 * on_time / total)}%)" if total else ""
    parts = [f"{total} event{'' if total == 1 else 's'}", f"{on_time} on time{pct}", f"{_num(st_.get('late'))} late",
             f"{_num(st_.get('partial'))} partial", f"{_num(st_.get('missed'))} missed"]
    if data.get("checked_at"):
        parts.append(f"checked {day_text(data['checked_at'])}")
    return " · ".join(parts)


def tuning_recall() -> None:
    """Tuning page: the recall scoreboard. Counts only; no event text reaches the app."""
    data, why = optional_json("/v1/recall")
    if data is None:
        st.caption(f"Recall {why}.")
        return
    if not _num(data.get("total")):
        st.info("Recall scoreboard not loaded yet.")
        return
    st.markdown(f'<div class="z-health">{html.escape(recall_summary(data))}</div>', unsafe_allow_html=True)
    _table(["Kind", "On time", "Late", "Partial", "Missed", "Total"], recall_rows(data))
    st.caption(RECALL_CAPTION)


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
             "grading_failed": "Grading failed", "undated_burst": "Undated burst"}
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


def web_search_url(name) -> str | None:
    """A Bing search for the quoted name, or None when there is no name."""
    name = one_line(name)
    if not name:
        return None
    return "https://www.bing.com/search?q=" + quote_plus(f'"{name}"')


def about_html(row: dict) -> str:
    """What the candidate is: "What it is: <about>" (grader text), else a muted "Seen as: <about_fallback>",
    then a "Search the web" link for the quoted name. Escaped."""
    about = one_line(row.get("about"))
    fallback = one_line(row.get("about_fallback"))
    if about:
        text = f'<span class="z-exp-about-text">What it is: {html.escape(about)}</span>'
    elif fallback:
        text = f'<span class="z-health">Seen as: {html.escape(fallback)}</span>'
    else:
        text = ""
    url = web_search_url(row.get("name"))
    link = (f'<a class="z-exp-search" href="{html.escape(url, quote=True)}" target="_blank" rel="noopener noreferrer">Search the web</a>'
            if url and safe_url(url) else "")
    if not text and not link:
        return ""
    return f'<div class="z-exp-about">{text}{" " if text and link else ""}{link}</div>'


def expansion_card_html(row: dict) -> str:
    """Name, relation and subject, tickers, sightings, origins; what it is (or how it was seen) and a web search
    link; notes, then up to 3 evidence links. Escaped."""
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
    return f'<div class="z-card z-exp"><div class="z-head">{"".join(head)}</div>{about_html(row)}{notes}{ev}</div>'


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


# Phase 0 gates: archive pages are left out of the main list; undated_burst (a
# later burst of undated pages) is counted with archive_seed.
ARCHIVE_REASONS = ("archive_seed", "undated_burst")


def left_out_counts(counts) -> tuple[list[tuple[str, int]], int]:
    """([(skip_reason, n)] most first, without archive_seed and undated_burst; their count together)."""
    counts = counts if isinstance(counts, dict) else {}
    rows = sorted(((str(k), _num(v)) for k, v in counts.items() if k not in ARCHIVE_REASONS and _num(v) > 0),
                  key=lambda r: (-r[1], r[0]))
    return rows, sum(_num(counts.get(k)) for k in ARCHIVE_REASONS)


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
    table = bill_lines_html(it.get("bill_lines")) if page.kind != "aux" else ""
    if table:
        t = it["bill_lines"].get("totals") or {}
        amount = usd(t.get("bill")) if (t.get("bill") or t.get("change") or t.get("request_lines")) else "no amounts counted"
        with st.expander(f"Autonomy lines ({_num(t.get('lines'))}, {amount})", expanded=False):
            # Escaped in bill_lines_html; only its own tags reach the page.
            st.markdown(table, unsafe_allow_html=True)
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

    # Phase 1: after the sidebar, so /v1/stats stays the first GET.
    grader_banner()
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
        # Zenith show (phase 0): news-monitor alerts and the managed lane.
        ops_strip()

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
    now = open_gap_line(ops)
    if now:
        st.text(now)
    gaps = grader_gaps(ops)
    if gaps:
        _table(["From", "To", "Gap"], [[utc_text(g.get("from")), utc_text(g.get("to")), _hours(g.get("hours"))] for g in gaps])
    else:
        st.caption(gaps_header(ops))
    st.caption(GAP_NOTE + (f" As of {utc_text(ops['as_of'])}." if ops.get("as_of") else ""))


def _exp_key(row: dict) -> str:
    # The numeric id only: no server text goes into a widget key.
    return f"tune-exp-{exp_id(row)}"


def _decide(row: dict, action: str) -> None:
    key = _exp_key(row)
    reason = st.session_state.get(f"{key}:reason") if action == "reject" else None
    tickers = st.session_state.get(f"{key}:tk") if action == "approve" else None
    # Any decision clears the reject picker and its confirm together, saved or not:
    # a reason left showing with no confirm row could not be re-picked to get it back.
    st.session_state.pop(f"{key}:confirm", None)
    st.session_state[f"{key}:reason"] = None
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
    grader_banner()
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
    # Zenith show (phase 0): the recall scoreboard, last.
    st.markdown("##### Recall")
    tuning_recall()
