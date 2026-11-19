---
ticker: XTRAF
name: Xtract One Technologies Inc.
as_of: 2026-11-18
asset_class: operating
filer_type: sedar_only        # Canadian issuer; SEC files Form D only (CIK 0001684505); no 8-K/6-K/Form 4
source_keys: [xtractone]
fiscal_year_end: "07-31"
base:
  value_local: 28.8           # C$M, FY2026 revenue (year to 2026-07-31), release 2026-10-21
  currency: CAD
  value_usd: 20.7             # US$M at fx below
  base_basis: last_fy         # no numeric guidance; quarters lumpy, do not annualise Q4
  alt_base: false
fx_as_of: 2026-10-01          # USD/CAD ~0.719 (C$28.8M ~ US$20.7M); rate not re-verified this pass, flag needs_owner if a score sits on a band edge
small_base: true              # B < US$25M -> core 4.2.1 small-base rule applies
tiny_usd: 207000              # 1% of B (C$288K)
lead_usd: 2070000             # 10% of B (C$2.88M)
shares_basic: 260.1M          # 2026-11-18
market_cap: C$92.3M (~US$66M) # 2026-11-18, price C$0.355
cash: C$17.3M, no debt        # 2026-07-31
terms: ["xtract one", "xtract one technologies", "smartgateway", "xtract one gateway"]
guarded_terms:                # match only if "Xtract One" appears in the same item
  - "smart gateway"
  - "gateway"
  - "patron screening"
aliases: ["Patriot One Technologies (historical filings only, renamed 2022-05-20)"]
traps:
  - {term: "Xtract", case: insensitive, rule: "alone = Xtract Resources plc; reject"}
  - {term: "XTRA", case: sensitive, rule: "TSX ticker, but also XTRA Lease, Xtra Mart; require Xtract One"}
  - {term: "Patriot One", case: insensitive, rule: "generic phrase unless historical filing of the issuer"}
  - {term: "Gateway / SmartGate / Smart Gateway", case: insensitive, rule: "networking, IoT, airport e-gates, place names; require weapons-screening context and Xtract One"}
  - {term: "patron screening", case: insensitive, rule: "also hits EVLV, CEIA, generic venue pieces; check EVLV sheet first"}
  - {term: "MSG / Sphere", case: insensitive, rule: "only with Xtract One named"}
thesis_drivers: [bookings, backlog_conversion, profitability, gross_margin, verticals, ab2975_hospitals, dilution]
open_items:
  - {id: q1_fy27_bookings, question: "Do Q1 FY2027 bookings recover from Q4 FY2026 C$6.0M?", expires_at: 2027-01-31}
  - {id: pending_installs, question: "Conversion of C$18.4M agreements pending installation (next disclosed figure)", expires_at: 2027-01-31}
  - {id: shelf_takedown, question: "First prospectus supplement or placement under the 2026-04-15 base shelf", expires_at: 2028-05-15}
group_keys: [earnings_calendar, wd_roundup]
---

# XTRAF — Xtract One Technologies Inc.

_Researched 2026-11-18. Listings: TSX XTRA (primary) and OTCQX XTRAF. SEC CIK 0001684505; EDGAR shows Patriot One Technologies Inc. as the former name until 2022-05-20. The only SEC filings are Form D (last 2025-06-23). EDGAR shows a 1231 fiscal year end, but the real one is **July 31**. Continuous disclosure goes to SEDAR+. Next earnings: Q1 FY2027 (quarter ended 2026-10-31), expected December 2026 (estimate). The FY2026 print was 2026-10-21 after the close, with the call on 2026-10-22 (verified on the [StockTitan copy](https://www.stocktitan.net/news/XTRAF/xtract-one-announces-fiscal-2026-fourth-quarter-and-full-year-xvrji8sic6fa.html)). Price was C$0.355 and market cap C$92.3M on 260.1M shares, 52-week change -47.8%, as of 2026-11-18 ([stockanalysis](https://stockanalysis.com/quote/tsx/XTRA/statistics/)). Sheet values restate the core only where they add a name-specific figure; everything else defers to core v3.0._

## Identity & matching
- **Legal entity:** Xtract One Technologies Inc., Toronto, formerly Patriot One Technologies. Match "Patriot One Technologies" only for historical filings, never bare "Patriot".
- **Products:**
  - **SmartGateway** (also "Smart Gateway"): walk-through screening for venues and hospitals, e.g. Hazel Hawkins (3 SmartGateways, 2026-07-30 release).
  - **Xtract One Gateway** (also "Gateway"): for schools and workplaces. It is a separate product, not SmartGateway renamed. The CEO said it "now contributes about 50% of our bookings" ([BNN Bloomberg, 2026-11-10](https://www.bnnbloomberg.ca/investment-trends/2026/11/10/xtract-one-technologies-more-than-doubles-revenue-as-ai-powered-screening-helps-make-schools-safer/)); treat this as a management claim.
- **Channel names that count as XTRAF news** when the item names an Xtract One product: Integrated Protection Services (IPS; pharma rollout, 2026-07-14).
- **Collisions to reject** (0-5, `reason:off_entity`): see `traps` in the front matter. "Gateway", "Smart Gateway" and "patron screening" match only when the same item names Xtract One.
- **Cross-sheet collision:** "patron screening", "weapons screening" and venue/school wins also match EVLV (and SSTI SafePointe). Check the EVLV sheet before scoring; an item naming only Evolv is never XTRAF.

## What the stock trades on
1. **`bookings` — bookings and their conversion to revenue.** Q4 FY2026 bookings were C$6.0M against a record C$16.5M a year earlier (-64%). FY bookings were C$32.2M against C$38.5M. Bookings re-acceleration is the swing factor.
2. **`backlog_conversion`:** contractual backlog C$25.6M (+66% y/y from C$15.5M; C$10.5M expected within 12 months), plus C$18.4M of agreements pending installation (down from C$34.0M as installs completed; excluded from backlog).
3. **`profitability`:** FY2026 adjusted EBITDA -C$3.5M (vs -C$8.6M); Q4 -C$0.7M (vs -C$2.7M).
4. **`gross_margin`:** 58% for FY2026 (from 66%) and 57% in Q4 (from 71%).
5. **`ab2975_hospitals` and `verticals`:** company-named wins at California hospitals (AB 2975 compliance), Texas and other K-12 districts (Gateway), Canadian provincial health systems, and multi-site enterprises (the US airline, pharma via IPS). The regulations themselves are context, not items (see Competitors & read-through).
6. **`dilution`:** a final base shelf prospectus filed 2026-04-15 against a C$92M market cap and C$17.3M of cash.

## Materiality bases
- **Revenue base B:** FY2026 revenue (year to 2026-07-31) of **C$28.8M (~US$20.7M)**, up 108% from C$13.9M. Source: FY2026 results release, 2026-10-21 ([IR](https://investors.xtractone.com/news-releases/news-release-details/xtract-one-announces-fiscal-2026-fourth-quarter-and-full-year-0); the IR site returns 403 to fetchers, figures checked on the StockTitan copy).
  - There is no numeric guidance.
  - Quarters are lumpy: H2 revenue C$18.5M, Q4 C$8.2M, so Q3 about C$10.3M. Use C$28.8M, not a quarterly run-rate.
- **Small-base name:** B < US$25M, so core 4.2.1 small-base rule applies: any new, repeat or expanded **named** paying customer, contract or deployment scores ≥70 without a value (`floor:small_base`).
- **Order lines**, tested on total contract value (TCV), with the annual run rate noted separately in `why`:
  - Tiny: **US$207K (C$288K)**, 1% of B.
  - Lead: **US$2.07M (C$2.88M)**, 10% of B.
  - Between the two, use the core 4.2.1 table on p = V ÷ B × 100.
- **No value given:** most "Selected by" releases carry only unit counts. Do not convert units to dollars; there is no per-system price. Use the core no-value rule (binding named order 70-78) and the small-base floor; null `magnitude_usd` and `magnitude_pct_of_base`. Unit counts go in `why` as stated.
- **Currency:** C$ unless stated. US deals are often quoted in US$; convert at the event-date rate and state both.
- **Capital:** score by core 4.2.2 on 260.1M basic shares. Reference counts: 5% = 13.0M shares, 10% = 26.0M, 20% = 52.0M. ATM capacity is tested against the C$92.3M market cap (20% = ~C$18.5M).

## Event ladder for this name
Bands and floors are the core's; this list maps XTRAF's recurring items onto them.

**Lead (90-100)**
- Same-day results that move the `bookings` driver (+5-15 thesis lift on the core results floor of 80), or hit a core Lead test (going concern, ≥20% miss). Example: "Xtract One Announces Fiscal 2026 Fourth Quarter and Full Year Results", 2026-10-21: revenue C$28.8M (+108%), Q4 bookings C$6.0M (-64%), backlog C$25.6M + C$18.4M pending. Figures first.
- A single binding order with TCV ≥ US$2.07M (C$2.88M) (`floor:lead_order`).
- A takeover bid or agreement for Xtract One (`rung:control`, `floor:buyout` at agreement, bid result or close).

**Digest (70-89)**
- Any other same-day results with figures: 80 minimum (`floor:results`).
- Named district, health-system, venue or enterprise orders and expansions: 70-78 at the small-base floor with no value; by the 4.2.1 table when a primary source gives a value. Repeat customers ("Expands") rank at least level with a first install. Group `wd_roundup`. Examples:
  - "Xtract One Technologies Selected by Willis Independent School District", 2026-10-19: 15 systems (11 Gateway plus 4 SmartGateway). The board approved the 15 Xtract One units 5-0, reported 2026-10-02 ([click2houston](https://click2houston.com/news/local/2026/10/02/willis-isd-approves-15-new-weapons-screeners-after-guns-found-at-high-school)); that report gives no dollar amount. Score 72-78; if the release states a value, apply the table (e.g. US$1M would be p = 4.8 → 80-89).
  - "Xtract One Technologies Selected by Metro Toronto Convention Centre", 2026-08-27: 16 Gateways on a five-year contract, value not given. 72-78.
  - "Xtract One Selected by Health PEI for Phased Rollout", 2026-04-20: provincial health system, 74-80.
  - "Expands California Healthcare Footprint With Multiple Deployments", 2026-07-30: Hazel Hawkins 3 and Contra Costa 3, San Mateo expanding. 74-80 (`ab2975_hospitals`).
  - "Further Expands Into Pharmaceutical and Life Sciences Manufacturing With New Multi-State Deployment", 2026-07-14: via IPS in CA, AZ and OH, initial deployments about $0.5M (p ≈ 2.4 if US$) → 72-80.
  - "Xtract One Expands AI-Powered Security Deployment with Leading U.S. Airline Company", 2026-08-19: 5 more Gateways on subscription at 3 more sites. Customer unnamed, so no `small_base` floor; score 70-76 as an individual airline expansion (core 7).
  - Single hospitals and single districts with no value also sit here at 70-75, not Borderline: "Expands Healthcare Footprint with Peterborough Regional Health Centre Deployment", 2026-06-26; "Selected by University of Michigan Health-West", 2026-03-26; Granville County Public Schools, 2026-04-30.
  - A paid seasonal event deployment ("Selected to Protect the Pacific National Exhibition this Summer", 2026-06-17): 70-72. If the text shows a trial or unpaid use, use the core pilot rule instead.
- A province-wide or state-wide agreement naming Xtract One: binding → by the order table; framework with no volume → core scope rule (55-65), with units, sites or term → 60-85; `verticals` may lift one rung.
- A prospectus supplement, bought deal or private placement: by core 4.2.2 dilution table (`floor:capital_big` at d ≥10% or ≥15% discount).
- Displacement of a named rival at a named account, when the source names Xtract One: `money`, by the order rules.
- CEO or CFO in or out: 75-88 (`floor:neo_ceo_cfo`); President or COO 70-85. Other officers 25-50.
- An early-warning report or disclosed stake change naming Xtract One by MSG Sports, MSG Entertainment or Sphere Entertainment: grade like an SC 13D row (new or exiting strategic holder ≥5%: 70-85).
- A TSX deficiency or continued-listing review: 70-78 (`floor:deficiency`); a delisting decision 85-95.

**Borderline (40-69)**
- A base shelf with no takedown: 40-55. Example: "Xtract One Files Final Base Shelf Prospectus", 2026-04-15.
- UK NPSA or other catalogue listings that no named buyer requires: 40-55.
- Flagship product launches with no customer: 55-65.
- Hires below officer level that come with new figures.
- A rival win at a sheet key account (core 9.4): 50-69 as a possible loss; 70+ `money` bad news if replacement of Xtract One is confirmed.

**Reject (<40)**
- AGM voting results: 10-25. Example: 2026-11-17.
- "Achieves SOC 2 Type II Certification", 2026-11-02: 15-30.
- Investor-conference participation: Planet MicroCap Toronto 2026-10-26, iAccess Alpha 2026-09-10: 0-20, `reason:promotional`.
- Analyst price-target pieces, stock-move pieces: <20, `reason:out_of_scope`.
- Software-release blogs, trade-show booths: 0-20, `reason:promotional`.
- Results recaps >24h after the print, and guidance or bookings retellings >72h after: <30, `reason:late_repost` (core 7).
- Cal/OSHA, Martyn's Law or other regulatory items that do not name Xtract One: 0-15, `reason:out_of_scope`.

## Always surface (floors)
Core floors apply as written; the XTRAF-specific identifiers are:
- Results releases ("Announces Fiscal 20xx ... Results") and SEDAR+ MD&A figures: `floor:results` 80, figures first.
- Earnings-date and conference-call notices ("Announces Fiscal ... Conference Call", e.g. 2026-10-13 and 2026-05-26): fixed **72**, `floor:calendar`, `group:earnings_calendar`, `reason:calendar_card`.
- Any named paying customer order, expansion or deployment: `floor:small_base` 70.
- Any prospectus supplement under the 2026-04-15 shelf, bought deal, private placement or Form D under CIK 0001684505: graded by core 4.2.2; first takedown resolves `shelf_takedown` (`floor:open_item` 80 while unexpired).
- The Q1 FY2027 print resolves `q1_fy27_bookings` and `pending_installs` (`floor:open_item` 80; the results floor already applies).
- A material change report, or a CEO or CFO change (CEO Peter Evans; CFO per the latest MD&A): `floor:neo_ceo_cfo` 75.
- Any action naming Xtract One by MSG Sports, Madison Square Garden Entertainment or Sphere Entertainment: grade on the ladder; never `out_of_scope`.

## Noise patterns
These are the patterns in the `xtractone` feed since it was activated on 2026-07-09. All items have notified=1; no grading filter was applied.
- **Conference and IR notices:** Planet MicroCap on 2026-06-07 and 2026-06-12 (two IR URLs for the same conference; the second is `duplicate`) and 2026-10-26; iAccess Alpha 2026-09-10. Score 0-20, `reason:promotional`.
- **Administrative items:** AGM results (2026-11-17), SOC 2 (2026-11-02). Score 15-25.
- **IR analyst-profile pages posted as news:** "Gianluca Tucci" (2026-08-25) and "Rob Goff" (2026-08-12), from investors.xtractone.com/analyst/*. Score 0-5, `reason:source_quality`, `source_repair`.
- **Archive burst on source activation:** 10 items first seen at 2026-07-09T18:31:14Z with event dates from 2026-03-26 to 2026-06-26 (core 8, R-0050). They include the Q3 results and call notice, the shelf, Health PEI, Granville, UM Health-West, Peterborough, the PNE and both Planet MicroCap notices. Gate each on its own event date; >21 days old → 0-9, `reason:stale`, `archive_burst`, `source_repair`.
- **Missed signal:** no missed primary disclosure. The Willis ISD board vote (local TV, 2026-10-02) came 17 days before the company release; if the vote story was graded first, the release is an update only if it adds value or terms.

## Catalyst calendar
- **December 2026 (estimate):** Q1 FY2027 results. The call notice comes about 1-2 weeks ahead (9 days for FY26, 15 days for Q3). Key test: whether bookings recover from C$6.0M (`q1_fy27_bookings`).
- **About March 2027 (estimate):** Q2 FY2027. **About mid-June 2027:** Q3 (Q3 FY26 printed 2026-06-10). **About late October 2027:** FY2027 (FY26 printed 2026-10-21).
- **Context only, not items unless the source names Xtract One:**
  - **By 2027-03-01:** Cal/OSHA Standards Board must adopt the AB 2975 hospital weapons-screening standard; hospital compliance follows within 90 days of adoption. The discussion-draft comment period closed 2026-10-12 ([Ogletree, 2026-09-16](https://ogletree.com/insights-resources/blog-posts/cal-osha-releases-hospital-weapons-screening-discussion-draft/)). The company's 2026-07-30 release puts the hospital deadline at "March, 2027".
  - **No earlier than about April 2027:** UK Martyn's Law commencement (Royal Assent April 2025, implementation period of at least 24 months; SIA is the regulator).
  - **Spring and summer 2027:** US school-board budget votes for 2027-28. A vote naming Xtract One is an item (core 9.2).
- **Pending installs:** C$18.4M converts to revenue over FY2027. The pharma IPS rollout continues "this year and next".

## Customers, programs, agencies & counterparties
- **MSG family** (MSG Sports, MSG Entertainment, Sphere): historically the anchor venue customer. Any action naming Xtract One is surfaced.
- **Unnamed "Leading U.S. airline":** employee screening. First site (SmartGateway) in 2023, then 5 more Gateways at 3 more sites (2026-08-19).
- **Canadian health:** Health PEI (2026-04-20), Peterborough Regional Health Centre (2026-06-26).
- **US health:** University of Michigan Health-West (2026-03-26). AB 2975 accounts: San Mateo Medical Center, Hazel Hawkins Memorial Hospital, Contra Costa Health (2026-07-30).
- **Schools:** Willis ISD (2026-10-19), Granville County Public Schools (2026-04-30), Manor ISD (prior deployment cited in the Willis release).
- **Venues and other:** Metro Toronto Convention Centre (2026-08-27), Pacific National Exhibition (2026-06-17).
- **Enterprise:** a multi-state pharma customer via IPS (2026-07-14); "Fortune 100" organizations in the pipeline (FY26 release; `prospective`, cap 39).
- **Treatment (core 9.2):** a board vote, purchase order, renewal, pause or cancellation by any of these for weapons screening counts as an XTRAF item without a company release. Published text names Xtract One only when the source does.

## Competitors & read-through
- **Evolv (EVLV, covered).** An item naming both is direct involvement for both (one object per ticker, `also:`).
- **CEIA OpenGate, SoundThinking SafePointe** (SSTI taken private by Transom Capital, closed 2026-11-18), **Liberty Defense HEXWAVE, ZeroEyes, Omnilert:** compete for the same budgets.
- **Rule (core 9):** an item counts for XTRAF only if it names Xtract One or its products, or a sheet-listed customer acts on weapons screening, or a rival wins at a sheet key account (50-69 possible loss; 70+ if replacement is confirmed). Regulations (AB 2975, Martyn's Law), sector studies, peer wins and peer financings that do not name Xtract One are `out_of_scope`, 0-15.

## Source coverage gaps
Grader-relevant facts only; collector notes live in `sources/XTRAF.md`.
- No covered key reaches SEDAR+ (MD&A, material change reports, prospectus supplements, early-warning reports), SEDI insider trades or EDGAR Form D. Silence on these channels is never `insufficient_evidence`.
- There are no Form 4s for this name; Canadian insider trades are on SEDI only.
- The IR site and GlobeNewswire return 403 to fetchers. For `read_source`, read the body from a StockTitan or Nasdaq copy, but keep the IR item as canonical.

## Grader notes
- **Canonical source:** investors.xtractone.com. Copies on GlobeNewswire, Nasdaq, Yahoo, Barchart, StockTitan and Stockhouse are duplicates: `score: null`, `dup_of:<canonical id>`, unless they add a figure, counterparty, stage, site or date.
- **"Selected by"** is the company's standard order wording. It usually carries no dollar value; use the unit count in `why` and the small-base floor. It does not mean "pilot". "Expands" means a repeat customer.
- **Bookings are total contract value** and include multi-year subscriptions. Never call bookings revenue.
- **Backlog definitions differ.** Calls sometimes quote a combined figure; releases split it. Always quote the split: C$25.6M contractual plus C$18.4M pending installation at FY26.
- **Unnamed customers** ("Leading U.S. airline", the pharma customer): never attach a name by inference.
- **Stale facts:** C$13.9M is FY2025 revenue. Use the FY2026 base above.
- **Bad news ranks like good news.** The Q4 bookings drop, the gross-margin slide (71% to 57% in Q4), a lost key account and any discounted offering rank at the same level as wins of the same size.
- **Verification this pass:** FY2026 figures re-checked on the StockTitan copy of the 2026-10-21 release; the Willis vote (15 units, 5-0) re-checked on click2houston, which gives no dollar amount. The USD/CAD rate was not re-verified; `fx_as_of` uses the implied ~0.719.
