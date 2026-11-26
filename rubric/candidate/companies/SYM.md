---
ticker: SYM
name: Symbotic Inc.
as_of: 2026-11-18
asset_class: operating
filer: domestic (10-K / 10-Q / 8-K); CIK 0001837240
fiscal_year_end: last Saturday of September (FY26 ended 2026-09-26)
currency: USD
fx_as_of: n/a (USD base; cellumation is EUR-denominated, terms undisclosed)
base_usd: 3080000000
base_basis: "Q4 FY26 revenue guide $760-780M, midpoint x 4 (Q3 FY26 release, 2026-08-05). No annual guide."
alt_base: false
base_refresh_due: 2026-11-23   # Q4 FY26 print; sheet goes stale after it until the owner approves a new base
tiny_usd: 15400000             # 0.5% of base (B > $100M)
lead_usd: 308000000            # 10% of base
shares_total: 603900000        # 128.9M Class A + 71.4M V-1 + 403.6M V-3 at 2026-06-27
shares_class_a: 129900000      # at 2026-08-03
dilution_denominator: shares_total   # Up-C: OpCo units exchange 1:1 into Class A, so d uses all classes
market_cap_usd_approx: 23000000000   # Form 4 prints $37.5-39.7, 2026-10-26 to 11-02
terms: ["Symbotic", "Symbotic Inc.", "Symbotic LLC", "Symbotic Holdings", "SymBot", "BreakPack", "SymMicro", "SyMicro", "APD", "FoxBot", "celluveyor", "cellumation", "Walmart Advanced Systems & Robotics", "ARMS Innovations", "Exol", "GreenBox Systems"]
aliases: ["SVF Investment Corp. 3", "SVF 3"]
match_traps:
  - {term: "Fox", case: sensitive, rule: "Fox Corp.; accept FoxBot only"}
  - {term: "ARMS", case: sensitive, rule: "accept only with Symbotic or warehouse-optimization context"}
  - {term: "Exol", case: insensitive, rule: "reject Exol Lubricants"}
  - {term: "GreenBox", case: insensitive, rule: "reject GreenBox POS"}
  - {term: "Alphabot", case: insensitive, rule: "not Alphabet"}
  - {term: "SYM", case: sensitive, rule: "reject inside other tickers or words (symposium, Symrise)"}
  - {term: "Symbiotic", case: insensitive, rule: "accept only with warehouse or Walmart context"}
  - {term: "APD", case: sensitive, rule: "accept only with Symbotic or Walmart store-system context"}
thesis_drivers: [walmart_scope, backlog_conversion, concentration, new_products, execution, holder_overhang]
open_items:
  - {id: q4fy26_print, what: "Q4/FY26 results, first FY27 quarterly guide, backlog incl. EMAA conversion, 10-K", expires_at: 2026-11-30}
  - {id: emaa_backlog, what: "Amount of the 2026-10-29 EMAA booked into backlog (cap $6.92B)", expires_at: 2027-02-28}
  - {id: replacement_program, what: "Completion of the Q2 FY26 component replacement program, guided within one year", expires_at: 2027-05-31}
  - {id: exol_sites, what: "Exol Los Angeles, Dallas, New Jersey, Chicago sites, 'planned within 12 months' of 2026-04-08", expires_at: 2027-04-08}
  - {id: apd_acceptance, what: "First Walmart APD acceptance (triggers $175M ASR deferred payment) or 400-system option exercise", expires_at: 2027-09-30, note: "review date set by sheet, not a company deadline"}
industry_links:
  - {id: robotics_trade, kind: policy, area: "US trade actions on imported industrial robots, warehouse automation systems and their components (Section 232 findings and proclamations, tariffs, quotas)", actors: "President, Commerce/BIS, USTR", core: false}
group_keys: [earnings_calendar, deployment_wave_SYM, sym_exol]
removed: []
---

# SYM — Symbotic Inc.
_Researched 2026-11-18. Nasdaq: SYM (Class A). CIK 0001837240. The fiscal year ends on the last Saturday of September; FY26 ended 2026-09-26. Q4/FY26 results: the company's notice "Symbotic Announces Date for Reporting Fourth Quarter and Fiscal Year 2026 Financial Results" was published 2026-10-29 20:01 UTC (`symbotic` feed, first seen 20:03 UTC; [IR copy](https://ir.symbotic.com/news-releases/news-release-details/symbotic-announces-date-reporting-fourth-quarter-and-fiscal-3)). The stated date is expected to be Monday 2026-11-23 after the close, with a 5:00 p.m. ET webcast. The date could not be re-verified on 2026-11-18: the IR page returned 403 and no web search was available. Prior quarters were same-day releases with a 5:00 p.m. ET webcast. The FY25 10-K was filed the same day as the Q4 8-K (2025-11-24), so expect the FY26 10-K on or near the results date. After the print, this sheet is stale (core §12.3) until the owner approves the new base._

_Sweep note: every core band, floor and noise rule is now applied by reference to the core. The ranges below that differ from the core are thesis lifts. Each names its `thesis_drivers` id. The sheet has no `owner:<date>` lines._

## Identity & matching
- **Legal entities:**
  - Symbotic Inc. (Delaware), formerly the SPAC SVF Investment Corp. 3 ("SVF 3"). It de-SPACed in 2022-06.
  - Symbotic Holdings LLC is the OpCo. Its units back the Class V shares.
  - Symbotic LLC is the operating subsidiary. It signs the Walmart agreements: the 2026-10-29 EMAA is among Walmart Inc., Symbotic Inc. and Symbotic LLC.
- **Share classes and people:**
  - Cohen-family trusts hold Class V-3 (3 votes per share). Rick Cohen is CEO and Chair.
  - Class V-1 holders include Walmart, with 61.35M OpCo units.
  - CFO: Izzy (Izilda) Martins. CTO: James Kuffner.
- **Products** (match only with Symbotic, Walmart DC or Exol context):
  - Symbotic System, SymBot and BreakPack (each-picking).
  - SymMicro, for micro-fulfillment. Transcripts garble it as "SyMicro".
  - APD, the store systems for Walmart online pickup and delivery.
  - FoxBot and celluveyor.
- **Subsidiaries and acquired businesses** (news naming only these is SYM news):
  - **Walmart Advanced Systems & Robotics (ASR):** bought 2025-01-27 for $200M cash. It is the base of the APD/store product. Deferred consideration ([8-K 2025-01-16](https://www.sec.gov/Archives/edgar/data/1837240/000119312525007370/d916752d8k.htm)):
    - $175M is payable when Walmart accepts the first APD.
    - Another $175M is payable if Walmart exercises the Additional APD Option.
  - **ARMS Innovations** ("Warehouse Operations Optimization"): the acquisition was announced 2026-07-02 (IR release in feed).
  - **cellumation GmbH** (Bremen; celluveyor modular sortation): the acquisition was announced 2026-10-13 and distributed 10-15. Terms were not disclosed. It keeps operating under its own name ([supplychaindive copy](https://www.supplychaindive.com/press-release/20261015-symbotic-announces-acquisition-of-cellumation-advancing-next-generation-so-1/)).
- **Exol (GreenBox Systems LLC):**
  - Joint venture: 35% Symbotic Holdings, 65% SoftBank's Sunlight Investment Corp.
  - It is an equity-method VIE and a related party, not a subsidiary (10-Q).
  - Exol's own releases count as SYM news only when they name sites, tenants or Symbotic systems.
- **Collisions to reject:** the `match_traps` in the front matter. Quote and profile pages ("Symbotic (SYM)", "シンボティック A") score 0-5 with `reason:source_quality`.
- **Cross-sheet collisions:** no covered-universe term collides with SYM's terms. SoftBank, Walmart and GreyOrange are not covered names, so their items are SYM items only under core §9.

## What the stock trades on
1. **Walmart scope and backlog adds** (`walmart_scope`). The 2026-10-29 Enterprise MAA carries an initial commitment of about $6.0B of spend. It could add up to $6.92B of backlog on top of $22.5B (2026-06-27).
2. **Backlog conversion and margin** (`backlog_conversion`).
   - 77 Systems in Deployment in Q3 FY26.
   - Revenue is measured against the quarterly guide.
   - Q3 gross margin: 22.3% GAAP, 25.0% adjusted.
3. **Customer concentration** (`concentration`). Walmart (Customer A) was 90.5% of Q3 FY26 revenue. The diversification story is new logos (AWG, Medline), the Exol network ramp and Walmex.
4. **New product lines reaching revenue** (`new_products`):
   - APD: a contingent 400-system option, over $5B, not in backlog.
   - SymMicro and BreakPack.
   - cellumation sortation.
   - ARMS software.
5. **Execution and quality** (`execution`).
   - A Q2 FY26 component replacement program and targeted recall added $34.3M of warranty liability. Completion is guided within one year.
   - FCF swings with milestone billing: Q3 FCF was -$164.6M; nine-month FCF was +$242.8M.
6. **Holder overhang** (`holder_overhang`).
   - Walmart holds 76.35M shares, 12.6% fully diluted (13D/A 2026-08-07).
   - SoftBank holds 39.8M Class A (13D/A 2026-05-29).
   - Cohen-family trust 13D filings and conversions.

## Materiality bases
- **Revenue base B = $3,080M.** This is the Q4 FY26 guide of $760-780M, midpoint times 4 ([Q3 FY26 release, 2026-08-05](https://www.sec.gov/Archives/edgar/data/1837240/000183724026000042/q3268-k_ex991.htm)). There is no annual guide.
  - Refresh at the Q4 print with the Q1 FY27 guide.
  - Until the owner approves the new base, keep $3,080M and note the new figure in `why` if it changes the band.
- **Q3 FY26 actuals:** revenue $720.8M (+22% y/y), adjusted EBITDA $95.2M, net income $55.0M, cash $1,746.4M.
- **Backlog:**
  - $22.5B RPO at 2026-06-27 ([10-Q](https://www.sec.gov/Archives/edgar/data/1837240/000183724026000043/sym-20260627.htm)). About 15% is expected to convert in the next 12 months.
  - The pro-forma ceiling with the October EMAA is about $29.4B, before Q4 burn.
  - Test new deals against B, never against backlog.
- **Shares:**
  - 603.9M total at 2026-06-27: 128.9M Class A, 71.4M V-1, 403.6M V-3.
  - 129.9M Class A at 2026-08-03.
  - Market cap is about $23B at the 2026-10-26 to 11-02 Form 4 prices of $37.5-39.7.
- **Order and contract lines** (core §4.2.1; test total contract value and note the annual run rate separately):
  - **Tiny:** under $15.4M (0.5% of B).
  - **Lead:** $308M or more (p ≥ 10).
  - Between the two, score by the core p table: 1-3% is $30.8-92.4M; 3-10% is $92.4-308M.
  - A new named enterprise customer is **not** a Lead criterion by itself. Score it by the new-logo rule in the Digest ladder below.
  - SYM is a large cap (B > $1B). Below-tiny orders follow core §4.2.1: 25-39, or 55-65 for a first customer, new country or first production-scale buy.
- **Capital:** apply core §4.2.2 and do not use sheet thresholds.
  - d = new shares ÷ 603.9M total shares, because OpCo units exchange into Class A. Flag `pct_is_dilution`.
  - Score holder sales by the 13D/A row in the floors section below, as a percentage of total shares.

## Event ladder for this name
**Lead (90-100)**
- **A Walmart master-agreement change or a new multi-billion addendum** (`walmart_scope`). Example: [Walmart and Symbotic Expand Commercial Agreement (8-K Items 1.01/7.01), 2026-10-29](https://www.sec.gov/Archives/edgar/data/1837240/000119312526437874/d182210d8k.htm).
  - Scoring: V = the $6.0B initial commitment, so p = 194.8 → `floor:lead_order`, 93-97.
  - "Up to $6.92B backlog" is a ceiling. Report it as a ceiling; it is not V.
  - Scope: 25 U.S. RDCs, with market program addenda (MPAs) for select Americas markets.
  - It includes a $125M Walmart-funded racking development program addendum (DPA).
  - Walmart gains a director-recommendation right (while it holds more than 5%) and two board observers (while it is more than 50% of revenue).
  - A non-compete limits sales to a specified company.
- **Any order, addendum or backlog disclosure with p ≥ 10** (≥ $308M), company-reported included (core §4.2.1).
- **Same-day results** where guidance changes ≥ 10% at the midpoint, the print misses by ≥ 20%, or backlog shows a step-change (core §3 results rule).
- **APD acceptance or exercise of the 400-system option** (`new_products`, `resolves:apd_acceptance`).
  - The option is over $5B, so p ≫ 10.
  - Either event also triggers a $175M ASR deferred payment by SYM.
- **An acquisition of SYM** (`floor:buyout`).
- **A Walmart termination or cancellation, or a change-of-control termination right being triggered.** Score it as `key_loss`, mirroring the win at original size (core 1.02: 75-95).
- **Restatement or non-reliance** (core: 4.02 at 88-98, `floor:existence`). Precedent: 8-K Item 4.02 on 2024-11-18.

**Digest (70-89)**
- **Same-day results with figures, in line with guidance:** `floor:results` 80. Example: [Q3 FY26 results, 2026-08-05](https://www.sec.gov/Archives/edgar/data/1837240/000183724026000042/q3268-k_ex991.htm).
- **New-logo system orders: 75-85.**
  - Basis: a binding order with a named counterparty and no value defaults to 70-78, plus a +5-10 first-customer novelty (core §4.2.1, §4.3). Use the higher end when it is a new vertical (`concentration`).
  - With a stated value, score by p. Only p ≥ 10 reaches Lead.
  - Example: "Associated Wholesale Grocers and Symbotic Announce Major Warehouse Automation Project at Gulf Coast Division Support Center" (2026-03-31), no value stated, about 80.
- **A new or expanded product recall or replacement program: 75-89** (`execution`, `floor:key_loss` analog).
  - The reference is the Q2 FY26 program: a $34.3M warranty charge, about 1.1% of B.
  - Score higher with a larger charge or when Walmart systems are named.
- **Own acquisitions, signed or closed: 75-88** (core `deal`, `floor:deal_signed`).
  - Tuck-ins: cellumation (2026-10-13) and ARMS Innovations (2026-07-02). Zenith scored the cellumation release 70; the target is 78.
  - Use the top of the range when consideration ≥ $308M. Lead is only via owner mark.
- **CEO or CFO in or out:** 75-88, plus 5-10 if abrupt (`floor:neo_ceo_cfo`). President or CTO: 70-85 (`floor:neo`).
- **Exol site go-lives or named tenants:** 70-80 (`proof`, `concentration`, `group:sym_exol`, label "related-party JV"; `resolves:exol_sites` for the four planned sites).
  - Example: the Exol Atlanta launch, 2026-04-08 ([exol.com](https://exol.com/resources/exol-launches-u-s-physical-ai-facilities-and-groundbreaking-fulfillment-as-a-service-model-to-expand-access-to-enterprise-grade-automation/)).
  - A first Walmex or SymMicro go-live also scores 70-80 (`deployment_wave_SYM` if several).
- **Earnings-date notices:** fixed 75, `group:earnings_calendar`, `floor:calendar`.

**Borderline (40-69)**
- **Equity offerings below 5% dilution:** 55-70 (core §4.2.2), plus 5 for a ≥ 15% discount. Example: [8-K 2025-12-08](https://www.sec.gov/Archives/edgar/data/1837240/000119312525311363/d69186d8k.htm).
  - 11.5M shares: 8.0M primary, about $425M net, about 1.3% of 603.9M; 3.5M sold by holders.
  - Score about 62, `pct_is_dilution`.
  - Larger raises follow the core table.
- **SYM strategic investments:** 55-69. Example: the Nyobolt Series C, about $50M, 2026-04-07 (10-Q subsequent event). That is about 1.6% of B, and an investment is not an order.
- **Securities-litigation steps,** scored on incremental change only (core `legal`, procedural 30-55). Example: *Decker v. Symbotic Inc.*, D. Mass. No. 1:24-cv-12976.
  - The motion to dismiss was granted in part and denied in part on 2026-07-23.
  - A scheduling conference followed on 2026-08-31 (Q3 10-Q).
  - Zenith scored a related "Suit Says" article 55.
  - A settlement with dollars scores 65-85.
- **Exol partnerships with no site:** 55-65 (scope rule: named counterparty, concrete integration, no volume). Examples: Manhattan Associates (2026-05-14), GreyOrange (2026-07-22).
- **Board-only director appointments:** 25-45 (core 5.02). Example: Steve Pagliuca, effective 2026-08-04, disclosed under Item 5.02 inside the Q3 earnings 8-K. If that 8-K is canonical, this is part of the results item.
- **Strategic-investment fair-value gains** ($19.4M in Q3 FY26): part of the results item, not a separate item.
- **Product launches with no customer:** 55-65 (core `product`).
- **Shelf registrations with no takedown:** 40-55. Precedent: S-3ASR on 2025-12-03.

**Reject (<40)**
- Awards and list items, program memberships, bio pages (core §7).
- Director 10b5-1 sales: 15-35 (core Form 4).
- Bloggers retelling the $22.5B backlog (Zenith: 20), as `already_covered`.
- Earnings recaps more than 24h after the print and guidance retellings more than 72h after (core §7, `late_repost`).
- Price-move pieces (Zenith: 5-15), as `out_of_scope`.

## Always surface (floors)
Core §6 floors apply unchanged: results 80, guidance 80, existence 85, neo_ceo_cfo 75, neo 70, deficiency 70, calendar 75, order 70. Only these sheet floors add to them:
- **8-K Item 1.01 or 1.02 naming Walmart, Walmex or Exol:** at least 85 (`walmart_scope` / `concentration` thesis lift).
  - Item 1.01 or 1.02 with a new customer: score by the new-logo rule, at least 75.
- **A recall, a replacement program, or a warranty charge of $25M or more:** at least 75 (`execution`).
- **A Walmart release or newsroom item naming Symbotic, BreakPack, SymMicro or APD:** at least 75 (`walmart_scope`; core §9 rule 1, since the source names the company).
- **SC 13D/A from Walmart (CIK 0000104169), SoftBank Group (CIK 0001065521) or the Cohen trusts:** 70-80 when holdings change by ≥ 1% of total shares (≥ 6.0M shares) or Item 4 adds a plan (`holder_overhang`). Other 13D/A filings score below 30 (core).
- **424B5 or S-3ASR takedown with new primary shares:** core §4.2.2, with no sheet floor.

## Noise patterns
These are real examples from the `symbotic` feed, all notified=1.
- **Lists and awards, 5-15, `reason:promotional`:**
  - "Symbotic Named to Fast Company's Annual List of the World's Most Innovative Companies of 2026" (2026-03-24).
  - "…New England's Fastest-Growing Companies by The Boston Globe" (2026-03-18).
  - "…100 Rating… Corporate Equality Index" (2026-02-09).
- **Program memberships, 10-20, `reason:promotional`:**
  - "Symbotic Joins Stanford Robotics Center Industrial Affiliates Program" (2026-08-25).
  - "Symbotic Joins DoW SkillBridge Program" (2026-04-23).
- **Bio-page scrapes, 0-5, `reason:source_quality`:** "Steve Pagliuca" was ingested twice:
  - ir.symbotic.com/board-member/steve-pagliuca, published 2026-08-05.
  - ir.symbotic.com/management/steve-pagliuca, published 2026-08-20 and first seen 2026-09-03.
  - The real event is Item 5.02 inside the earnings 8-K.
- **EDGAR archive burst** (core §8, R-0050): 40 `edgar_sym` rows dated 2024-05-06 to 2026-08-05, all first seen 2026-08-31T21:21.
  - They include the 2024 10-Q/As, NT 10-K and DEF 14As.
  - Each item more than 21 days old scores 0-9, `reason:stale`, `archive_burst`, `source_repair`.
  - The Q3 FY26 8-K and 10-Q in the burst arrived 26 days after the 08-05 release, so they are stale too. The 08-05 release stays canonical.
- **Bare EDGAR titles** ("Symbotic Inc.: 8-K filed 2026-10-29"): open the filing and grade the items and figures inside (core §5). An 8-K that only repeats a published release is `duplicate`, score null, `dup_of` the release.
- **Off-feed noise:**
  - Director 10b5-1 sales, 15-25. Krasnow sold 2,000 shares at $42.72 ($85K), which Zenith scored 58. Kane's similar sale at $43.17 was scored 38. Krasnow and Kane each sold 2,000 shares on 2026-11-02 at about $37.5-39.7.
  - Seeking Alpha, Motley Fool and Zacks pieces: under 20, `out_of_scope` (stock-move or commentary pieces), or `late_repost` per core §7.

## Catalyst calendar
- **Q4/FY26 print, expected 2026-11-23** (`resolves:q4fy26_print`). Expect:
  - The first FY27 quarterly guide, which sets the new base.
  - Backlog including any EMAA conversion (`resolves:emaa_backlog`).
  - The 10-K: risk factors, Walmart %, recall status.
- **About early February 2027:** Q1 FY27 results (2026-02-04 last year; notice about 3 weeks before). Then about early May (Q2) and early August (Q3).
- **About mid-January 2027:** DEF 14A (filed 2026-01-16 and 2025-01-17). Routine proxy: 10-20.
- **About early March 2027:** annual meeting (5.07 8-Ks on 2026-03-09 and 2025-03-10). Routine: 10-25.
- **By 2027-04-08:** Exol Los Angeles, Dallas, New Jersey and Chicago sites. Exol's 2026-04-08 release said they were "planned within 12 months" (`exol_sites`).
- **By about 2027-05:** completion of the replacement program, guided within one year of Q2 FY26 (`replacement_program`).
- **Rolling:**
  - First APD acceptance by Walmart and the 400-system option (`apd_acceptance`).
  - cellumation integration.
  - *Decker* class action: discovery and settlement.
  - Walmex first DC, AWG Gulf Coast build, Medline deployment.

## Customers, programs, agencies & counterparties
- **Walmart (Customer A, 90.5% of Q3 FY26 revenue, `big`, disclosure: release + filing):**
  - The 2022 Second A&R MAA covers all 42 RDCs.
  - The 2025 APD MAA carries $520M of R&D fees ($230M, $165M and $125M over two years) and a contingent 400-system option.
  - The 2026-10-29 EMAA includes the MPAs and the $125M DPA.
  - Spokesperson: Rob Montgomery, EVP Walmart U.S. Supply Chain Operations.
- **Walmex** (Nueva Wal-Mart de México): a separate commercial agreement (disclosure: filing / call).
- **Exol and SoftBank:** a $7.5B SoftBank and Symbotic commitment to a six-site, 6M sq ft network. Atlanta and one California site are open. Label it a related-party JV.
- **Other named customers** (Q3 FY26 deck):
  - C&S Wholesale Grocers (related party), UNFI, Albertsons and Southern Glazer's.
  - Medline, the first health-care customer, added FY25.
  - AWG, announced 2026-03-31.
  - A DC closure or system cancellation at any of these is `money` bad news, scored by size (core §9 rule 2).
- **Call-only disclosures:** customer and timeline statements on the earnings call are `mgmt_claim` (-15, cap 75). They count without a release.

## Competitors & read-through
- **Witron** (Walmart perishable DCs): a Witron or other rival win at Walmart or another sheet customer, in SYM's category, scores 50-69 as a possible loss (core §9 rule 4). It is `money` bad news (70+) only if replacement of Symbotic is confirmed.
- **Others:** AutoStore, Ocado, Dematic, Knapp, Exotec, Locus, GreyOrange (now an Exol partner).
- **All other competitor items** (financings, launches, wins elsewhere, market studies) are `out_of_scope`, 0-15.
- **Published text:** name Symbotic only when the source does. Never add read-through tails.

## Source coverage gaps
Collector and ops notes (missing feeds, poller URLs, scraper filters) have moved to the worker doc `sources/SYM.md`. Only the facts the grader needs for freshness and canonical choice stay here:
- **Ownership filings never reach `edgar_sym`.** Missing 13D/A, Form 4, Form 144 or Form 3 rows are never `insufficient_evidence`, and their absence never lowers another item's score. When one arrives late through another channel, apply core §8 freshness (`late_first_sighting` if it is the first public record).
- **`edgar_sym` lags by days to weeks.** The 2026-08-05 8-K and 10-Q arrived 2026-08-31. Always gate on the filing date, not `first_seen`. A late 8-K is canonical only if no release for the same event exists.
- **Exol releases and the Walmart newsroom are not collected.** Trade-press copies of them can be the first record. Grade them on the event date.
- **IR bio and management pages** (/management/, /board-member/) are scrapes, not events.

## Grader notes
- **Release and 8-K.** The release (GlobeNewswire or ir.symbotic.com) and the 8-K arrive about 30 minutes apart (2026-10-29: 20:03 vs 20:32 UTC).
  - If both arrive in one run, the release is canonical. `why` and `note_hook` add the 8-K-only facts: the $6.92B backlog cap, the $125M DPA, board rights, the non-compete and the termination terms. The 8-K is `duplicate`, null score.
  - If the 8-K arrives in a later run, it is an update graded on the new terms only, usually 45-70, with `reason:new_information`.
- **Wording discipline (never conflate):**
  - "Initial commitment of spend" is not revenue.
  - "Up to $6.92B backlog" is a ceiling.
  - The 400 APD systems are a contingent option, not backlog.
  - "Systems in Deployment" (77) and "Operational Systems" (56) in Q3 FY26 are different KPIs.
- **Value units:** backlog is quoted in billions. Test new deals against B ($3,080M), never against backlog.
- **Related parties:** C&S and Exol are related parties. Label Exol orders "related-party JV".
- **Copies of one event:**
  - Syndicated or trade-press copies with no new figure are `duplicate`, score null, with `dup_of` the canonical.
  - Later retellings that restate the event are `already_covered`, under 40, citing the prior item id.
  - Zenith marked more than 10 cellumation copies this way, which is correct.
- **Group keys:** use only `earnings_calendar`, `deployment_wave_SYM` and `sym_exol` (pattern `<ticker>_<slug>`). Replace the old `earnings_dates` key.
- **Profile staleness:** the legacy SYM profiles predate the 2026-10-29 EMAA, cellumation and the recall. Do not use them. Dropped: the legacy "Adjacent comparables" list.

---
Verification note: no web search was possible on 2026-11-18 (the shared search budget was used up), and the IR date notice returned HTTP 403. Production D1 (read-only) confirms the date notice item (published 2026-10-29T20:01:12Z), the Walmart EMAA release (20:02:32Z) and the `edgar_sym` 8-K (first seen 20:32:20Z). The 2026-11-23 date and the other facts carry over from the earlier research pass and were not re-checked online. Dilution for the 2025-12 offering was recomputed as 8.0M / 603.9M ≈ 1.3%, while the earlier sheet said about 1.4%; the difference is the denominator date. The open_items `expires_at` values for apd_acceptance and emaa_backlog are sheet review dates, not company deadlines.
