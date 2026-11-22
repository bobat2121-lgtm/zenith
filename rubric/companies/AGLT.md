```yaml
---
ticker: AGLT
name: Agility Robotics, Inc.
as_of: 2026-11-18
asset_class: operating
filer: domestic (10-K, 10-Q, 8-K); emerging growth company; non-accelerated; former SPAC shell (Rule 144(i) applies)
cik: "0002074973"          # registrant, the former CCXI
cik_legacy: "0001727116"   # Old Robot Holdings, Inc.; filed 15-15D 2026-11-09
fiscal_year_end: "12-31"
fx_as_of: n/a              # all figures in USD
base_usd: 300000000
base_basis: "Digit 5 committed multi-year order book (1,000 robots, 3-yr RaaS, milestone-contingent), merger documents, as of May 2026"
alt_base: true             # revenue is not a usable base (FY2025 $1.78M; LTM ~$0.40M)
revenue_base_usd: 1780000  # FY2025; below $25M, so core 4.2.1 small-base rule applies
small_base: true
tiny_usd: 1500000          # 0.5% of base_usd (core formula, B > $100M)
lead_usd: 30000000         # 10% of base_usd
lead_units: 100            # robots in one named order
shares_outstanding: 242089880   # at close 2026-11-04; 10-Q cover 2026-11-12
last_price_usd: 7.17       # close 2026-11-17
market_cap_usd: 1736000000
terms: ["Agility Robotics", "AGLT", "AGLTW", "Digit 5", "Digit 4", "Digit v4", "Agility Arc", "RoboFab"]
aliases:
  - {term: "Churchill Capital Corp XI", valid_from: 2026-06-24, context: "this merger only"}
  - {term: "CCXI", valid_from: 2026-06-24, context: "this merger only"}
  - {term: "Old Robot Holdings", context: "legacy operating company"}
traps:
  - {term: "Agility", case: insensitive, rule: "alone is off_entity unless 'Robotics', Digit or Agility Arc in the same item (Agility Global, Agility PR, Agility CMS, 'business agility')"}
  - {term: "CCXI", case: sensitive, rule: "before 2025-12-17 (SPAC 424B4) = ChemoCentryx/Amgen; 0-9 source_quality under aglt_press"}
  - {term: "Churchill Capital", case: insensitive, rule: "other Churchill SPACs (e.g. IV became Lucid) are off_entity"}
  - {term: "Digit", case: sensitive, rule: "only in a robot or humanoid context; a number or the Digit app is off_entity"}
  - {term: "Arc", case: sensitive, rule: "bare 'Arc' never matches; only 'Agility Arc'"}
  - {term: "1X / Hexagon", case: insensitive, rule: "off_entity outside a humanoid context; rival news is out_of_scope under core section 9"}
thesis_drivers: [digit5_orderbook, digit5_timing_safety, customer_breadth, cash_runway, supply_overhang]
open_items:
  - {id: digit5_warrant_agreement, text: "Definitive warrant agreement with, or public naming of, the related-party Digit 5 order customer", expires_at: 2027-03-31}
  - {id: digit5_early_access, text: "First Digit 5 early-access customer delivery (guided H1 2027)", expires_at: 2027-07-31}
  - {id: lockup_early_release, text: "Sponsor/legacy lock-up early release (VWAP >= $12.00 for 15 trading days in any 180-trading-day window)", expires_at: 2027-05-03}
groups: [earnings_calendar, deployment_wave_AGLT, aglt_resale_s1]   # aglt_resale_s1 uses the proposed core <ticker>_<slug> pattern
---
```

# AGLT — Agility Robotics, Inc.
_Researched 2026-11-18. Nasdaq: AGLT (common) and AGLTW (warrants, $11.50 strike). First trade was 2026-11-05. The Churchill Capital Corp XI (CCXI) de-SPAC closed 2026-11-04. Registrant CIK 0002074973 is the former CCXI. The legacy operating company is "Old Robot Holdings, Inc.", CIK 0001727116 (renamed 2026-10-13; filed 15-15D 2026-11-09). Fiscal year ends Dec 31. Emerging growth company and former shell. No earnings date has been announced. The first public-company print (FY2026 10-K plus release) is due by about 2027-03-31 (90 days, non-accelerated filer). Bands, floors and form grades not restated here follow the core rubric. Lines below differ from core only where they cite a thesis driver or an `owner:` mark._

## Identity & matching
- **Match:** the front-matter `terms` and `aliases`. "Churchill Capital Corp XI" or "CCXI" counts only when the item is about this merger and dated on or after 2026-06-24.
- **Products and sites:**
  - "Digit" only in a robot or humanoid context. Versions: "Digit 4" or "Digit v4", and "Digit 5" (unveiled 2026-09-15).
  - "Agility Arc" (never a bare "Arc").
  - "RoboFab" (Salem, OR; 70,000 sq ft; designed for up to 10,000 robots a year).
  - Fremont, CA physical-AI facility (opened 2026-07-16).
  - Pittsburgh: 50,000 sq ft lease signed 2026-10-02, 8 years, $4.45M fixed base rent; announced 2026-10-21.
- **People:**
  - CEO and Chair Peggy Johnson; CFO Michael Beer; COO Jennifer Hunter.
  - President Daniel Diez (promoted from Chief Business Officer, announced 2026-11-18); CTO Prasanna Velagapudi.
  - Co-founder and Chief Robot Officer Jonathan Hurst (13D 2026-11-12: 12,652,759 shares, 5.2%).
  - GC/CAO/Secretary Anastasia (Ana) Lang; Chief Hardware Officer Marco Marroquin; Chief Product Officer Christopher "Sully" Sullivan (2026-11-18).
  - Sources: super 8-K 2026-11-06, https://www.sec.gov/Archives/edgar/data/2074973/000121390026116898/ea0311204-8k_churchill11.htm, and https://www.agilityrobotics.com/content/agility-robotics-evolves-executive-leadership-team-to-support-next-phase-of-growth-as-a-public-company
- **Reject (collisions; see front-matter `traps`):**
  - "Agility" alone: Agility Global (Kuwait), Agility PR, Agility CMS, "business agility". Score 0-5, `reason:off_entity`.
  - **ChemoCentryx**, the old Nasdaq CCXI (bought by Amgen in 2022). Any CCXI item dated before the SPAC 424B4 (2025-12-17) is ChemoCentryx/Amgen. Under a covered key it is contamination: 0-9, `reason:source_quality`, `source_repair`.
  - Other Churchill SPACs (e.g. IV became Lucid). Unrelated EDGAR filers with "Agility" in the name.
  - "Digit" used as a number, or the Digit app. 1X or Hexagon outside a humanoid context.
- **Cross-sheet check:** before scoring, check the core section 1 collision table. NVIDIA, Amazon and Foxconn appear in other sheets, and a co-mention of them is not AGLT news.

## What the stock trades on
1. **`digit5_orderbook`: converting the order book.**
   - The order book is "more than $300 million in committed multi-year orders for Digit 5". The 2026-10-26 release says it is "subject to satisfaction of certain contractual milestones" and "does not represent current-period revenue".
   - The merger prospectus (424B3, 2026-10-13) ties the orders to 1,000 Digit 5 robots on a three-year RaaS contract.
   - The S-1 says this is one customer, and the warrant note calls it a related party.
2. **`digit5_timing_safety`: Digit 5 timing and safety.**
   - Early access is expected in H1 2027 and general availability by end-2027.
   - Safety work: "cooperatively safe" design, Digit v4 NRTL field evaluations, and ANSI/A3 R15.108 and ISO 25785-1 work (neither is final yet). A CE mark is expected.
3. **`customer_breadth`: customers beyond the anchor.**
   - Named: GXO (2 more US sites), the AGCO Hesston pilot, Toyota TMMC, Schaeffler, Mercado Libre.
   - Three unnamed paid-program manufacturers: an automaker selling more than 3M vehicles a year, a top auto-components maker, and a global consumer-products maker.
   - More than 30 prospects, plus 2 early US Armed Services subcontract leads ("no agreements have been signed").
4. **`cash_runway`: cash burn against liquidity.** 9M-2026 operating cash use was $131.6M against pro forma cash of $398.0M at 9/30. Any primary raise is dilutive.
5. **`supply_overhang`: share supply.** Per the two S-1s filed 2026-11-10:
   - The sponsor/legacy resale S-1 registers 160,899,555 shares: 160,810,584 common plus 88,971 warrant shares, about 66.5% of the 242,089,880 outstanding. These holders are locked up until on or after 2027-05-03.
   - The PIPE resale S-1 registers 20,102,500 shares (8.3%). The S-1 says "the PIPE Shares are not subject to lock-up restrictions".
   - Together that is about 181.0M shares, or 74.8% of shares outstanding.
   - The S-1 also registers up to 4,212,500 primary warrant shares (about $48.4M at $11.50).
   - The stock closed at $7.17 on 2026-11-17 (about $1.74B market cap), down from $11.51 on day one and below the $10 PIPE price.

## Materiality bases
- **Order base B (alt base; see front matter):** the $300M Digit 5 order book. Tiny is $1.5M (0.5%), lead is $30M (10%) or ≥100 robots in one named order. p = V ÷ $300M.
- **Small-base rule applies.** Revenue is not a usable base and is below $25M (core 4.2.1 names AGLT at $1.78M). Any new, repeat or expanded named paying customer, site or deployment scores ≥70 without a value (`floor:small_base`). Below-tiny sizing never pushes such an item under 70.
- **Revenue (context only):**
  - 9M-2026 net sales were $361K, −79% y/y (trade $179K, related-party $182K). H1 was $174K, so Q3 was about $187K.
  - FY2025 was $1.78M; LTM is about $0.40M.
  - 10%+ customers in 9M-2026 (all unnamed): D 50%, B 28%, F 21%.
  - Sources: 8-K/A 2026-11-13, Ex.99.3 https://www.sec.gov/Archives/edgar/data/2074973/000121390026119809/ea031195901ex99-3.htm and MD&A Ex.99.4 https://www.sec.gov/Archives/edgar/data/2074973/000121390026119809/ea031195901ex99-4.htm
- **Liquidity:**
  - Pro forma cash is $398.0M: $64.9M legacy + $0.2M CCXI + $332.9M net. The $332.9M is trust $162.9M + PIPE $201.0M − costs $31.0M (Ex.99.5).
  - Plus $7.1M restricted cash.
  - 9M-2026 net loss was $458.7M, including $314.8M stock compensation and a $15.1M SAFE fair-value loss.
  - Going-concern doubt was "alleviated" after the close.
- **Shares:** 242,089,880 (front matter). Dilution steps on that count:
  - 5% = 12.1M shares (about $87M at $7.17).
  - 10% = 24.2M shares (about $174M).
  - 20% = 48.4M shares (about $347M).
  - Score raises by core 4.2.2. Put d in `magnitude_pct_of_base` and flag `pct_is_dilution`.
- **Warrants:** 4,140,000 public warrants at $11.50; full exercise is d = 1.7%. Any redemption notice is graded by core 4.2.2.

## Event ladder for this name
- **Lead (90-100)**
  - A named Digit 5 fleet order of ≥100 robots or ≥$30M, or the first production-scale Digit 5 order (`floor:lead_order`).
  - The $300M customer named, its milestones met or missed, or the order cut or cancelled. This is a `digit5_orderbook` thesis lift: naming is ≥85; a cut or miss mirrors the win at 90+.
  - A primary raise with d ≥20% (core 85-95), or d ≥10% with a ≥15% discount or toxic terms.
  - An abrupt CEO or CFO exit (core 75-88, +5-10).
  - A serious Digit safety incident or recall at a customer site (`legal`, lifted by `digit5_timing_safety`).
  - Results with a going-concern return or guidance withdrawal.
  - Historical examples:
    - "Agility Robotics and Churchill Capital Corp XI Complete Business Combination", 2026-11-04 (`floor:listing`, 90+), https://www.agilityrobotics.com/content/agility-robotics-and-churchill-capital-corp-xi-complete-business-combination
    - "Agility Robotics To Host Analyst Investor Day": 90 (core anchor; owner "arguably #1"; held 2026-10-06).
    - "Agility Unveils Digit 5 Humanoid Robot Built for Cooperatively Safe Work at Scale", 2026-09-15, https://www.agilityrobotics.com/content/agility-unveils-digit-5-humanoid-robot-built-for-cooperatively-safe-work-at-scale (flagship launch released together with the order-book disclosure).
    - "Agility Robotics to Go Public Through $2.5 Billion Merger with Churchill Capital Corp XI", 2026-06-24 (`control`, agreement).
- **Digest (70-89)**
  - A new named customer, site expansion or commercial agreement (`floor:small_base`, 70+; more with volume per the core scope rule).
  - First-period financials: `floor:results` 80, figures first.
  - A capital raise with d 5-20% (core 70-88).
  - Other executive-officer changes (`floor:neo`, 70). The CEO or CFO in or out is `floor:neo_ceo_cfo`, 75.
  - Lock-up early release triggered (`resolves:lockup_early_release`, 80).
  - A Digit 5 early-access delivery (`resolves:digit5_early_access`, 80).
  - A final safety certification naming Digit (CE mark, NRTL listing, R15.108 conformity): `permission`, 70-90.
  - A company-reported pipeline update with new figures, 70-78. If it only restates the $300M, it is below 40, `reason:already_covered`.
  - Examples:
    - "GXO and Agility Robotics Expand Partnership to Accelerate Deployment of Humanoids in U.S. Operations", 2026-10-26: 75-82. Covers Statesville NC and Lebanon TN, early 2027, Digit 4 first. https://www.agilityrobotics.com/content/gxo-and-agility-robotics-expand-partnership-to-accelerate-deployment-of-humanoids-in-u-s-operations
    - "Agility Robotics Announces Commercial Agreement With Toyota Motor Manufacturing Canada", 2026-02-19: 75-80.
    - "Churchill Capital Corp XI Shareholders Approve Business Combination…", 2026-11-02: `control` procedural step, 75-85.
    - The 8-K/A with Legacy Agility 9M financials, 2026-11-13: 80+, first record of operating results.
    - "…Announce Expected Gross Capital Raise of Approximately $465 Million…", 2026-10-30: 70-78. Breakdown: $164M trust, $201M PIPE, $100M prior equity.
    - "Agility Robotics Evolves Executive Leadership Team…", 2026-11-18: 70-74 (`floor:neo`). It formalizes titles; nobody departs.
    - "Agility Robotics Highlights Commercial Momentum and Growing Enterprise Demand for Digit Humanoid Robot", 2026-10-26: 70-78 on its new figures only.
- **Borderline (40-69)**
  - **Resale S-1 card** (`group:aglt_resale_s1`): 62-70.
    - Covers both 2026-11-10 S-1s: about 181.0M shares (74.8%), of which 20.1M PIPE shares (8.3%) carry no lock-up. The rest are locked until 2027-05-03 or the $12 VWAP release.
    - State the share counts and lock-up terms in `why`. The core rule for resale ≥20% of outstanding is 60-70; the supply-overhang driver puts it at the top.
    - S-1/As score below 20 unless terms change. An EFFECT notice scores 0-15 (core).
  - **A pilot with a named major counterparty:** 60-69. Example: "AGCO and Agility Robotics Advance Smart Manufacturing with Humanoid Robot Pilot in Hesston, Kansas, Facility", 2026-10-20 (pilot starts 2027).
  - **Named technology partners integrating with Digit 5** (core scope rule: named counterparty with a concrete integration and no volume is 55-65):
    - "Agility Robotics Expands NVIDIA Collaboration…", 2026-10-22: 58-65. Digit 5 is the inaugural launch partner for NVIDIA Halos.
    - Nyobolt battery partner, 2026-10-15: 55-60.
    - FORT Robotics safety MOU (Sept 2026; announced 2026-10-01): 55-58.
  - **S-4 declared effective, setting the vote date (2026-10-13):** 45-60 (core).
  - **New facilities or leases** (Pittsburgh 2026-10-21, Fremont 2026-07-16): 45-55.
  - **Board and committee appointments** (2026-09-29, 2026-10-19): 30-45 (core: director-only).
- **Reject (<40)**
  - Conference attendance, e.g. "Agility Robotics to Attend Upcoming Investor Conferences", 2026-08-27 (promotional, 0-20).
  - CEO honors, e.g. "Agility Robotics CEO Peggy Johnson Selected to Join Project Meridian", 2026-10-06 (promotional).
  - Blog and thought-leadership posts.
  - Forms 3 and 4 at closing (codes A, M, F, G, J: 0-10).
  - 13G/13G/A (<20-40). The founder's at-close 13D (Hurst, 2026-11-12, 5.2%, no new Item 4 plan): below 30.
  - S-1/A amendments and 425 reprints.
  - Stock-move pieces, price targets and analyst initiations (core section 7).

## Always surface (floors)
Use the core section 6 floors as written: `results` 80; `neo_ceo_cfo` 75; `neo` 70; `deficiency` 70; `capital_big` 75; `calendar` 75 fixed; `order` 70; `lead_order` 90; `key_loss` 70. These lines are specific to this name:
- **8-K items:** open the filing (the feed drops item numbers) and grade by core section 5.
  - 1.01 or 2.03 financings by core 4.2.2.
  - 3.01: watch the post-de-SPAC holder-count and public-float tests as well as the $1.00 bid price.
- **Results:** the first operating figures are the 8-K/A Ex.99.3 and 99.4. The registrant 10-Q of 2026-11-13 covers the CCXI shell's Q3 (trust account) and is not results: below 25. The FY2026 10-K with release gets `floor:results` 80, figures first.
- **Earnings-date notices:** `floor:calendar` 75 fixed, `group:earnings_calendar`.
- **Digit 5 order counterparty** (`digit5_orderbook` thesis lift): any disclosure naming the customer, or the definitive warrant agreement, has floor 85 and flag `resolves:digit5_warrant_agreement`.
  - Legacy terms: 453 warrants per robot sourced, 1,000-robot minimum (453,000 total).
  - Exercise price and terms were not final as of 2026-11-13.
- **8.01 naming an order:** `floor:order` 70; `floor:lead_order` 90 at ≥$30M or ≥100 robots.
- **Named customers** (GXO, Schaeffler, Toyota TMMC, Mercado Libre, AGCO, Amazon):
  - A Digit deployment, expansion, pause or cancellation has floor 70 even without an Agility release (core section 9.2; `floor:small_base`; `floor:key_loss` for a pause or cancellation).
  - Published text names Agility only if the source does.

## Noise patterns
From news-monitor keys `agility`, `aglt_press` and `edgar_aglt`:
- **aglt_press contamination (Nasdaq symbol query).**
  - 20 rows, all first seen 2026-11-18T23:03.
  - 9 are ChemoCentryx/Amgen 2022 items, e.g. "AMGEN TO ACQUIRE CHEMOCENTRYX FOR $4 BILLION IN CASH" (2022-08-04). Score 0-9, `reason:source_quality`, `source_repair`. They never reach the feed.
  - The other 11 are Agility releases dated 2026-06-24 to 2026-10-15, already seen via `agility`: `duplicate`, `dup_of` the first copy.
- **agility sitemap archive bursts.**
  - 59 undated old posts, first seen 2026-07-29 (e.g. "Digit Attends CES 2020", "Agility Robotics Raises 20 Million", the GXO RaaS and Mercado Libre 2025-12-10 releases). Score 0-9, `reason:stale`, `archive_burst`, `source_repair`.
  - A 9-item burst on 2026-10-26 with blank dates: AGCO, NVIDIA, Pittsburgh, Nyobolt, S-4 effective, audit chair, GXO, momentum, Hurst Q&A. Gate each item on its own event date (core section 8).
- **Blog posts:** below 20, `reason:promotional`. Examples: "Jonathan Hurst Answers Your Questions About Building Digit 5", "Scaling A New Market Category", "Agility's Humanoid Deployment Process", "Beyond the Hype".
- **edgar_aglt backfill.**
  - 27 rows first seen 2026-11-18T23:03 with bare titles ("Agility Robotics, Inc.: 8-K filed …").
  - Rows over 21 days old score 0-9, `reason:stale`, `archive_burst`. These include CCXI's own S-1 (2025-11-18), S-1/A, 424B4 (2025-12-17), 2025 8-Ks and the 2026 shell 10-K/10-Qs.
  - 8-Ks dated 2026-10-13, 10-30 and 11-02 reprint merger releases: duplicates, or below 25 unless they add new terms.
  - The 2026-11-06 super 8-K is the canonical source for close terms. Do not drop it as a duplicate.
  - Backfilled filings 4-21 days old take the core 4.5 timeliness discount (-5 to -10, original date in `why`).
- **Conference attendance, CEO honors and board-to-be announcements:** below 25, promotional.
- **Recaps:** results recaps over 24h old and guidance retellings over 72h old follow core section 7 (`reason:late_repost`).

## Catalyst calendar
- **Late Nov to Dec 2026:** resale S-1s declared effective (EFFECT 0-15). From then the 20,102,500 PIPE shares are freely resalable (no lock-up).
- **Dec 2026 to Jan 2027:**
  - First sell-side initiations (noise, under 30).
  - A possible definitive warrant agreement with the Digit 5 related-party customer (`digit5_warrant_agreement`).
- **Early 2027:** GXO Statesville and Lebanon deployments start on Digit 4 (`group:deployment_wave_AGLT`). The AGCO Hesston pilot starts in 2027.
- **By about 2027-03-31:** FY2026 10-K and first earnings release. Watch the order book, deployed robots and burn.
- **H1 2027:** Digit 5 early customer access (`digit5_early_access`), the first test of the $300M milestones.
- **2027-05-03:** sponsor/legacy lock-up expires ("on or after May 3, 2027", S-1). The 180-day restriction ends early if VWAP is ≥$12.00 for 15 trading days within any 180-trading-day period (13D, 2026-11-12; `lockup_early_release`).
- **About mid-May 2027:** Q1-2027 10-Q. **About June 2027:** first annual meeting.
- **About Nov 2027:** former-shell Rule 144 restriction lifts, one year after the Form 10 information in the 2026-11-06 super 8-K, per the S-1 risk factor.
- **End-2027:** Digit 5 general availability.

## Customers, programs, agencies & counterparties
- **Digit 5 order customer (unnamed, related party):** holds the whole $300M book. Terms: 1,000 robots, three-year RaaS, milestone-contingent; warrants vest with deployments.
- **GXO Logistics** (`big`, release): first humanoid RaaS deal (2024).
  - More than 100,000 totes at Flowery Branch, GA.
  - 2 new sites in early 2027.
- **Schaeffler** (related party, release): investor, supplier and customer. Committed to scale Digit 5 across its manufacturing footprint.
- **Toyota Motor Manufacturing Canada** (release): RaaS agreement after a pilot, 2026-02-19. No unit count given.
- **Mercado Libre** (release): San Antonio, TX, 2025-12-10.
- **AGCO** (release): Hesston, KS pilot agreement, 2026-10-20.
- **Amazon** (investor, filing_only): holds 8.55% (20.7M shares).
  - Paid a $367,500 deposit in 2024 for 5 robots.
  - Holds the Oct 2022 warrant for up to 26.58M shares at $0.93. 16,471 had vested at close, and 3,294 more vest per incremental robot bought.
  - Any new Amazon purchase scores ≥70 (`floor:small_base`).
  - A separate July 2021 warrant to an unnamed potential customer (358 shares per robot; no robots bought) was cancelled for no consideration in Sept 2026.
- **Foxconn:** led the $201M PIPE; listed as a strategic investor.
- **NVIDIA:** investor. Digit 5 is the inaugural humanoid launch partner for NVIDIA Halos for Robotics; the collaboration was expanded 2026-10-22.
- **Nyobolt:** battery partner. **FORT Robotics:** safety MOU.
- **US Armed Services subcontract leads:** score only on a signing. A first military-service order is the core lead override (floor 90 when V ≥ tiny).

## Competitors & read-through
- **Rivals:** Figure AI, Apptronik, Tesla Optimus, Boston Dynamics (Hyundai), 1X, UBTech, Unitree, Sanctuary, NEURA. Their wins, financings and launches are `out_of_scope` (0-15).
- **Only these read-throughs count (core section 9):**
  - A rival win at a named Agility account (GXO, Schaeffler, Toyota TMMC, Mercado Libre, AGCO, Amazon) is a possible loss at 50-69. If replacement of Digit is confirmed, it is `money` bad news at 70+.
  - A humanoid safety regulation or standard (ISO 25785-1, ANSI/A3 R15.108, OSHA NRTL) counts only when the source names Agility or Digit (core 9.3). Otherwise it is out_of_scope and belongs in the catalyst calendar as context only.
- Published text states facts only, and names Agility only when the source does.

## Source coverage gaps
Collector and ops notes (feed repairs, URLs to add) live in the worker doc `sources/AGLT.md`. The facts below are what the grader needs to judge freshness and pick the canonical copy:
- **aglt_press** returns ChemoCentryx history and nothing after 2026-10-15. Silence there is never `insufficient_evidence`.
- **agility sitemap rows carry no date.** Take the event date from the /content/ page or the press-releases list. If neither is available, state "date unknown" in `why` and cap confidence at 0.6.
- **Close and vote releases were suppressed.** The 2026-11-04 closing release, the 2026-11-02 vote release, the analyst-day notice and the audit-chair release were suppressed as duplicates (notified=2). The first primary copy in the feed is the edgar_aglt backfill of 2026-11-18, which takes core 4.5 timeliness.
- **EDGAR rows lose 8-K item numbers.** Open the filing (`read_source: true`) before scoring above 39.
- **Not collected:** customer newsrooms (GXO, AGCO, Schaeffler, Toyota Canada) and safety-standard news. A missing customer item is not evidence of no event.

## Grader notes
- **Committed orders.** The "committed orders" are milestone-contingent. Write "committed, subject to milestones"; never call them revenue or backlog. Do not count the $300M again when later releases restate it (`reason:already_covered`).
- **Canonical copy.** Each release can appear up to 3 times: the agility sitemap, aglt_press, and an 8-K/425 exhibit. The company release is canonical. Audit the 8-K for new terms and grade only the increment.
- **Two Q3-2026 "10-Q" sources.** The registrant 10-Q (2026-11-13) is the CCXI shell. Legacy operating figures are in the 8-K/A Ex.99.3/99.4.
- **Sizing.** Revenue is tiny, so never size orders against it. Use the $300M order book (p), units and counterparty, with the small-base floor for named customers. Stock comp inflates losses, so lead with cash burn.
- **Literal labels.** Label a pilot, CAP engagement, MOU or partnership literally. A named Fortune-500 pilot scores 60-69, not noise.
- **Related-party sales** (Schaeffler, the Digit 5 customer, investor robot purchases) are disclosed separately. Say so in `why`.
- **Leadership release.** The 2026-11-18 release formalizes titles already in the close 8-K (Diez as President). Grade it as an exec-change Digest (70-74), not a departure.
- **Stale profile text.** The old "trades as CCXI / pending close" text is wrong: the deal closed on 2026-11-04. If an item contradicts this sheet, trust the item and flag `sheet_stale`.
- **Group keys:** use only `earnings_calendar`, `deployment_wave_AGLT` and `aglt_resale_s1` (the `<ticker>_<slug>` pattern).

---
Verification notes (2026-11-18, SEC EDGAR):
- Verified: resale S-1 counts and PIPE lock-up language (accessions 0001213900-26-118025 and -118037); the lock-up expiry "on or after May 3, 2027"; the $12.00 VWAP 15-of-180-trading-day early release (Hurst 13D, 0001213900-26-118976); the Rule 144(i) former-shell restriction; the list of recent filings.
- Not re-verified: other figures carried over from the prior sheet.
