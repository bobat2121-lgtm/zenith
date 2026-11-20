```yaml
ticker: AXON
name: Axon Enterprise, Inc.
as_of: 2026-11-18
asset_class: operating
filer_type: domestic_10k            # 10-K / 10-Q / 8-K; CIK 0001069183
fiscal_year_end: 12-31
last_print: 2026-11-05              # Q3 2026
next_print_expected: 2027-02-late   # not announced
currency: USD
fx_as_of: n/a                       # base in USD; convert non-USD deals at the event-date rate
base_usd: 3620000000
base_basis: "FY2026 guidance midpoint ($3.61-3.63B), set 2026-11-05"
alt_base: false                     # old ~$3,697M (32-34% guide) is retired
tiny_usd: 18100000                  # 0.5% of base (base > $100M)
lead_usd: 362000000                 # 10% of base
shares_outstanding: 81432712        # at 2026-10-30, 10-Q
market_cap_usd_approx: 26000000000-28000000000   # 81.4M shares at ~$318-345; recheck the live price
terms: ["Axon Enterprise", "Axon", "TASER", "Dedrone", "Dedrone Defense", "Axon Fusus", "Fusus", "Axon 911", "Carbyne", "Prepared", "Sky-Hero", "Draft One", "Axon Evidence", "Evidence.com", "Axon Body", "Axon Air", "Axon ALPR", "DedroneTracker.AI", "DedroneDefender"]
aliases: ["TASER International (pre-2017)", "Invictus Apps, Inc. (Prepared)", "Dedrone Holdings"]
match_traps:
  - {term: "Axon", case: sensitive, rule: "needs Enterprise, TASER, police, DFR or Scottsdale context"}
  - {term: "axon", case: lower, rule: "neuron or biology sense: off_entity"}
  - {term: "taser / tased", case: lower, rule: "a police-incident story is not company news"}
  - {term: "Prepared|Carbyne|Fusus|Vision|Guardian|Outpost|Draft One", case: sensitive, rule: "needs an Axon or 911/police context"}
  - {term: "Axon Vision|Axon Networks|Axonics|AxonOps|Axon Active", case: insensitive, rule: "off_entity 0-5"}
  - {term: "Skydio", case: insensitive, rule: "an AXON item only when it names Axon or is a step under the Axon-Skydio agreement; Skydio defense items (Army SRR) are never AXON"}
thesis_drivers: [fy_guide, fed_dedrone, sw_arr_ai, bookings, dfr_skydio, device_refresh, fcf_margin]
open_items:
  - {id: skydio_tender, desc: "Skydio tender offer settles (cash; equity consideration follows)", expires_at: 2026-12-31}
  - {id: skydio_secondary, desc: "Committed secondary settles; stake steps to ~37% fully diluted", expires_at: 2027-03-31}
  - {id: fed_dedrone_130m, desc: "~$130M of federal Dedrone deployments slipped out of 2026: a dated deployment, award or recognition statement", expires_at: 2027-12-31}
  - {id: ice_cew_followon, desc: "ICE CEW follow-on award, extension or protest; incumbent IDV 70CMSW23D00000003 ends 2027-08-21", expires_at: 2027-08-21}
group_keys: [axon_awards, earnings_calendar, deployment_wave_AXON]
key_customers: [DHS/ICE, DHS OPO C-UAS IDIQ, CBP, U.S. Marshals, VA police, NY DOCCS, Maryland DPSCS]
```

# AXON — Axon Enterprise, Inc.
_Researched 2026-11-18. Nasdaq: AXON. CIK 0001069183. Delaware corporation, based in Scottsdale, AZ. Fiscal year ends Dec 31._
- **Next print:** Q4/FY2026 is expected in late February 2027 but has not been announced. Last year the 8-K Item 2.02 was filed 2026-02-24 and the 10-K on 2026-02-25, with the date notice about two weeks ahead.
- **Last print:** Q3 2026 on 2026-11-05.
- **Shares outstanding:** 81,432,712 at 2026-10-30 ([10-Q](https://www.sec.gov/Archives/edgar/data/1069183/000162828026071242/axon-20260930.htm)).
- **Web check 2026-11-18:** the Reno and Cleveland articles were re-read. Neither states a contract value.

Bands, floors, the dilution math, freshness and duplicate rules all come from the core rubric. This sheet keeps only Axon's bases, its entity terms, and the lifts tied to its thesis drivers, each marked with its driver id.

## Identity & matching
- **Legal entities:**
  - Axon Enterprise, Inc. (formerly TASER International; renamed in 2017).
  - Dedrone Holdings / Dedrone Defense, LLC. This is the federal contracting arm and holds a slot on DHS C-UAS IDIQ 70RDA226D00000001.
  - Prepared (Invictus Apps, Inc.; acquired 2025-10-01).
  - Carbyne (Axon 911).
  - Fusus (Axon Fusus).
  - Sky-Hero.
- **Products that make an item AXON news:**
  - TASER 10, TASER 7, TASER Ion (new in 2026) and X26P.
  - Axon Body 4, and Body 5 / Body 5 Pro (announced 2026-10-24).
  - Axon Fleet 3.
  - Axon Evidence (Evidence.com), Draft One, Axon Assistant and Axon Guardian.
  - The AI Era Plan and the OSP 7/10 bundles.
  - Axon 911, Axon Air (DFR), Axon Records and Axon Fusus.
  - Axon ALPR (Outpost/Lightpost).
  - DedroneTracker.AI / DedroneDefender.
  - The ARC marketplace.
- **Skydio (investee).** Axon owned about 15% at 2026-09-30. Its stake rises to about 37% fully diluted once the 2026-11-05 deal fully settles; the primary tranche closed 2026-11-05. Axon is becoming Skydio's exclusive U.S. and Canada public-safety distributor.
  - **Counts as AXON news:**
    - items that name Axon, such as a public-safety or DFR sale through Axon, or distribution terms;
    - steps under the Axon-Skydio agreement (tender, secondary, cash/stock mix, ownership %).
  - **Out of scope (core §9, 0-15):** Skydio financings, valuations or bookings that do not name Axon. Log them in the catalyst calendar as context only.
  - **Never AXON news:** Skydio defense items such as Army SRR.
- **Context guards and rejects:** see `match_traps` in the front matter. Also reject the following as `off_entity` 0-5:
  - D-Fend, DroneShield and DroneSense, unless Axon is named;
  - stories about politicians' AXON share trades.

## What the stock trades on
1. **`fy_guide`: revenue growth vs guidance.** FY2026 guidance was cut to $3.61-3.63B, about 30% growth, from 32-34%. That is about -2% at the midpoint ($3,620M vs about $3,697M). StockStory reported an 18.4% drop to $317.59 after the print.
2. **`fed_dedrone`: federal timing.** About $130M from three federal Dedrone deployments dropped out of 2026: about $30M from Q3 and about $100M from Q4. Management attributes the slip to deployment timing.
3. **`sw_arr_ai`: Software & Services, ARR and AI attach.**
   - Software & Services revenue: $437.0M (+43%).
   - ARR: $1.75B (+40%). NRR: 126%.
   - AI ARR: above $100M.
4. **`bookings`: bookings and large deals.**
   - Future contracted bookings: $15.8B (+39%).
   - GAAP RPO: $10.2B.
   - Five-year bookings: +25% YTD.
   - Nine-figure state corrections, city and federal deals drive this line.
5. **`dfr_skydio`: the DFR/Skydio bet.** About $1.2B buys a stake rising to about 37%, now about 90% cash. The deal raises net debt and weighs on FCF.
6. **`device_refresh`: TASER 10/Ion and Body 5 timing.**
   - Connected Devices revenue: $471.5M, +16% y/y and -6.9% q/q.
   - TASER revenue: $233.0M, vs $238.0M a year earlier.
7. **`fcf_margin`: margins and free cash flow.**
   - Adjusted gross margin: 59.2%, vs 62.7%.
   - FY FCF guidance was cut to $350-400M from $450M.
   - YTD FCF: -$74.5M.

## Materiality bases
- **Revenue base B = $3,620M.** This is the midpoint of the FY2026 guide of $3.61-3.63B, set 2026-11-05 ([Q3 release](https://investor.axon.com/2026-11-05-Axon-reports-record-Q3-2026-revenue-of-909-million,-up-28-year-over-year)).
  - It replaces the old base of about $3,697M.
  - **Tiny line:** $18.1M (0.5%).
  - **Lead line:** $362M (10%).
  - Test total contract value, or obligated value when stated. Note the annual run-rate separately.
- **Q3 2026:**
  - Revenue $908.6M; adjusted EBITDA $235.7M; non-GAAP EPS $1.72.
  - **Q4 guide:** revenue $990M-1.01B; adjusted EBITDA $245-250M.
- **Bookings:**
  - Future contracted bookings: $15.8B, with 20-25% expected to convert within 12 months.
  - GAAP RPO: $10.2B.
  - ARR: $1.75B.
- **Liquidity:**
  - **Cash:** about $1.7B in cash and short-term investments.
  - **Notes:** about $2.9B of convertible and senior notes. This includes $1.15B of 0% converts due 2031, issued 2026-09-18 with a conversion price of about $652.06 and capped calls to $1,049.94 ([8-K](https://www.sec.gov/Archives/edgar/data/1069183/000119312526395997/d476163d8k.htm)).
  - **Net debt:** $1.2B.
  - **Revolver:** $300M rises to $500M, plus a $150M accordion. This comes from the second amendment in the 8-K of 2026-09-15, effective with the notes ([8-K](https://www.sec.gov/Archives/edgar/data/1069183/000119312526391320/d17675d8k.htm)).
- **Market cap:** roughly $26-28B, on 81.4M shares at about $318-345 after the print. This is approximate; recheck the live price.
- **Capital yardsticks (core 4.2.2):**
  - **Dilution d for the convert:** 1.15B ÷ $652.06 = about 1.76M shares, or 2.2% of shares outstanding.
  - **Debt test:** principal is 31.8% of B, so a debt or convert of this size is scored on the core debt row (principal ≥25% of B).
  - **Stock-for-deal:** test the 3.02 share issuance against 81.4M shares, subject to the 19.99% issuance cap in the Skydio agreement.
- **Large-cap grouping applies (B > $1B).** Named public-agency awards below the $18.1M tiny line go to `group:axon_awards` at 60-68. The merged card surfaces at 70+.

## Event ladder for this name
Use the core ladder. The lines below give Axon examples and its thesis lifts.

- **Lead (90-100):**
  - **Results with core Lead triggers:** a guidance change of ≥10% at the midpoint, a withdrawal, or a ≥20% miss. The Q3 2026 cut of about 2% at the midpoint does not qualify.
  - **A single named award or order ≥ $362M** (`floor:lead_order`).
  - **A lead override:** a first order from a new U.S. military service, federal agency or foreign government, at or above the tiny line. Axon already sells to most federal law-enforcement agencies, so confirm the buyer is genuinely new.
  - **Own acquisition or investment ≥ $362M.** These score as a `deal`, plus a `dfr_skydio` or relevant thesis lift. Example: "Axon Invests $1.2 Billion in Skydio to Build the Future of Drone as First Responder" (2026-11-05; [release](https://investor.axon.com/2026-11-05-Axon-Invests-1-2-Billion-in-Skydio-to-Build-the-Future-of-Drone-as-First-Responder); [8-K Items 1.01/3.02](https://www.sec.gov/Archives/edgar/data/1069183/000162828026071150/axon-20261105.htm)). It is 33% of B, about 92.
  - **Abrupt CEO or CFO exit.** CEO is Rick Smith (founder); COO and CFO is Brittany Bagley. Use core people 75-88, plus 5-10 for an abrupt exit.
  - **A final federal ban or restriction naming Axon or an Axon product** (TASER, Axon body cameras, Axon ALPR). A category ban that names no Axon product is `out_of_scope`, unless a sheet customer acts on it (core §9.2).
- **Digest (70-89):**
  - **Same-day quarterly results without a Lead trigger.** Results and guidance floors are both 80. Example: "Axon reports record Q3 2026 revenue of $909 million, up 28% year over year" (2026-11-05), about 85-88. It carries a ~2% FY cut, the ~$130M federal Dedrone slip and non-GAAP EPS of $1.72 below consensus.
  - **Named deals ≥ $18.1M,** graded by core 4.2.1:
    - $18.1-36.2M: 70-74.
    - $36.2-109M: 72-80.
    - $109-362M: 80-89.
    - Any named federal or state DOC deal ≥ tiny is at least 70 (`floor:order`).
  - **Shareholder-letter deals are unnamed** ($258M and $115M state DOC deals, a $40M metro PD, a $21M international TASER 10 deal, an $18M federal Dedrone deployment and a $10M healthcare deal). They belong in the results item, not separate items.
  - **ICE CEW award, extension or protest:** ≥70 (`ice_cew_followon`; key customer).
  - **DHS C-UAS task orders to Dedrone Defense:** ≥70 (`fed_dedrone`; sheet program). A dated federal Dedrone deployment or recognition statement resolves `fed_dedrone_130m` (floor 80).
  - **Convertible or debt raises,** scored on the core debt row. Example: "Axon Announces Pricing of $1.0 Billion Offering of 0% Convertible Senior Notes Due 2031" (2026-09-16), about 78. The priced notice is the canonical copy.
  - **Flagship launches (core product 55-75).** Example: "Axon Announces Body 5: Next-Generation Camera Built for the AI Era" (2026-10-24, [release](https://investor.axon.com/2026-10-24-Axon-Announces-Body-5-Next-Generation-Camera-Built-for-the-AI-Era)), about 70. It has no GA date and no named customer.
  - **Skydio deal steps: ≥70** (`dfr_skydio` thesis lift).
    - Example: the 8-K of 2026-11-18 (event date 2026-11-13) settles the tender and secondary in cash. This moves Skydio consideration to about 90% cash from about 60%; $127.5M was already paid at the primary closing ([8-K](https://www.sec.gov/Archives/edgar/data/1069183/000162828026074663/axon-20261113.htm)). About 72.
    - The tender settlement resolves `skydio_tender`. The secondary settlement resolves `skydio_secondary`. Both have floor 80.
  - **Earnings-date notice:** fixed at 72, `group:earnings_calendar`. Example: "Axon to Release Third Quarter 2026 Earnings on November 5, 2026" (2026-10-22).
  - **Named executive officer changes** (CEO Rick Smith; COO and CFO Brittany Bagley; President Josh Isner). CEO or CFO is 75-88; other NEOs 70-85.
- **Borderline (40-69):**
  - **Named public-agency awards, renewals and Flock-to-Axon switches below $18.1M, or with no stated value.** Score 60-68, `group:axon_awards`, so the merged card surfaces at 70+.
    - Reno council approved the consolidation contract 5-2, adding 200+ ALPRs that replace Flock hardware; no value stated ([2026-10-22](https://www.fox5vegas.com/2026/10/22/reno-council-approves-axon-consolidation-contract/)). About 64.
    - Santa Fe five-year DFR contract: $2.2M, p = 0.06. The core anchor is 66.
    - A stated value ≥ tiny moves the item to 4.2.1.
  - **Council first readings and committee referrals:** `pre_award`, "requests" or "considers", about 58-62, `group:axon_awards`. Example: Cleveland's ALPR ordinance had a first reading and went to committee ([2026-11-09](https://www.cleveland19.com/2026/11/10/cleveland-city-council-considers-contract-with-axon-license-plate-reader-system/)); no value stated. About 60. The final vote follows the award line above.
  - **Aggregate federal momentum with units but no dollars.** Score 62-68, `group:axon_awards`. Example: "Axon Reports Significant Momentum Across Federal Sector as U.S. Government Fiscal Year Closes" (2026-10-15; 22,000+ cameras and DEMS licences, 1,600+ TASER 10s for VA police; [newsroom](https://www.axon.com/newsroom/press-releases/axon-reports-significant-momentum-across-federal-sector-as-u-s-government-fiscal-year-closes)), about 65.
  - **Multi-state corrections roundups** (deployment proof). Example: "State Corrections Institutions Modernize Operations with Axon" (2026-10-08; NY DOCCS 42 facilities; Maryland DPSCS 17 facilities; [newsroom](https://www.axon.com/newsroom/press-releases/state-corrections-institutions-modernize-operations-with-axon)), about 60-65.
    - The Maryland contract runs $4.1M a year from 2025-09 to 2035-08, about $41M total. It started in 2025, so it is not a new award. Do not score the $41M as a fresh order.
  - **Single-agency DFR go-lives with no new contract:** 50-60, `group:deployment_wave_AXON`. Example: "Axon Air 'Drone as First Responder' Program Soars into Howard County, Maryland" (2026-11-12), about 55.
  - **City or state cancellations, pauses or rival replacements.** These rank like the matching win.
    - Below tiny: 60-68 in `axon_awards`.
    - At a key customer (front matter): `money` bad news, `floor:key_loss` 70.
- **Reject (below 40):**
  - Bare EDGAR receipts that add nothing (score as duplicates; see Noise patterns).
  - DEF 14A / DEFA14A.
  - Webinars, Axon Week sessions and awards (promotional).
  - Results recaps and guidance retellings past the core §7 windows (24h for results, 72h for guidance), as `late_repost`.
  - Politicians' share-trade stories.
  - Third-party MOUs to join ARC unless they carry a volume.
  - Form 4 10b5-1 sales and Form 144 (core §5).
  - Board-only 8-K Item 5.02s at about 30-40. Examples: director non-renewals on 2026-03-11 and 2026-04-10; two directors appointed 2026-07-10.

## Always surface (floors)
Core floors apply as written: `results` 80, `guidance` 80, `calendar` 72 fixed, `neo_ceo_cfo` 75, `neo` 70, `order` 70, `lead_order` 90, `deal_signed` 75, `key_loss` 70 and `open_item` 80. The lifts below are specific to Axon:
- **Skydio transaction steps ≥70.** These are settlements, cash/stock mix and ownership %. Lift: `dfr_skydio`. The tender and secondary settlements resolve their open items (floor 80).
- **Any award, extension, cancellation or protest on ICE conducted-energy-weapon vehicles ≥70.** Incumbent IDV 70CMSW23D00000003 (T10) has an end date of 2027-08-21 on USAspending after a 2026-08-14 modification. Lift: `ice_cew_followon`.
- **DHS C-UAS IDIQ task orders naming Dedrone Defense ≥70.** IDIQ 70RDA226D00000001 is Track 1, $1.5B ceiling, ordering 2026-08-01 to 2031-07-31. A task order's obligated value is tested against the tiny line. The ceiling is `ceiling_only`. Lift: `fed_dedrone`.
- **Cancellations or pauses at a key customer: `floor:key_loss` 70.** Below-tiny city losses follow the 60-68 award line.

## Noise patterns
- **Archive bursts (core §8):** score 0-9, `reason:stale`, `archive_burst`, `source_repair`, on the event date.
  - On 2026-08-31 at 21:21, `edgar_axon` back-filled 40 filings dated 2024-08-06 to 2026-08-06 (10-Qs, 10-K, 8-Ks, DEF 14A/DEFA14A) in one crawl.
  - On 2026-07-29 at 15:34, the `axon` IR key back-filled 5 releases dated 2026-02-24 to 2026-07-22.
- **Bare form titles.** Examples: "AXON ENTERPRISE, INC.: 8-K filed 2026-11-05" (two that day: Item 2.02, and Items 1.01/3.02 for Skydio), "10-Q filed 2026-11-06", "424B5 filed 2026-09-15" and "424B5 filed 2026-09-17".
  - These duplicate the release. Score them `score: null`, `dup_of` the canonical release.
  - Rank one only on what it adds:
    - the 10-Q adds GAAP RPO of $10.2B;
    - the 8-K of 2026-09-15 adds the revolver terms;
    - the 8-K of 2026-09-21 adds the final note size and conversion price.
- **Proxy filings:** DEF 14A and DEFA14A pairs (e.g. both filed 2026-04-16) score below 20.
- **Paired financing releases:** the proposed and priced notices (2026-09-15/16) are one event. The priced notice is the canonical copy.
- **Syndicated copies:** finviz, investingnews, placera, ariva, suasnews and DroneXL copy Axon releases. They are duplicates unless they add a fact.
- **Skydio-only stories** that do not name Axon are out of scope (0-15). Examples: Skydio funding rounds, valuations, Skydio's own bookings claims, and Army SRR.

## Catalyst calendar
- **Skydio settlements** (`skydio_tender`, `skydio_secondary`):
  - The tender offer settles in Q4 2026. Equity consideration is issued after it.
  - The committed secondary follows in Q1 2027.
  - Watch the tranche amounts, the 19.99% issuance cap and the ownership step to about 37%.
- **Federal Dedrone deployments** (`fed_dedrone_130m`): about $130M dropped out of 2026. Timing is unknown, with 2027 likely.
- **Body 5 / Body 5 Pro:** the GA date is "to be announced soon". A GA notice is product context (core product 35-55 unless it carries a named customer or order). Axon Guardian moved to GA under the AI Era Plan, per the 2026-11-05 letter.
- **TASER Ion:** ramp.
- **ICE CEW procurement** (`ice_cew_followon`): watch for a follow-on award. The incumbent T10 IDV runs to 2027-08-21 per USAspending.
- **Q4/FY2026 results and first FY2027 guidance:** about late February 2027. The date notice is about two weeks ahead.
- **Axon Week:** spring 2027 (promotional, not an investor day).
- **Proxy and AGM:**
  - DEF 14A about mid-April 2027 (filed 2026-04-16 last year).
  - AGM about late May to early June 2027.
- **Q1 2027 results:** about early May 2027 (2026-05-06 last year).
- **Cleveland ALPR ordinance:** in committee after its first reading on 2026-11-09.
- **DHS C-UAS IDIQ:** ordering runs 2026-08-01 to 2031-07-31.
- **Context only, never scored as AXON items:**
  - Skydio financings and valuation marks that do not name Axon. The stake's value moves with them, but per core §9 they are not AXON news.

## Customers, programs, agencies & counterparties
- **Federal (USAspending IDVs; all key customers):**
  - DHS/ICE (CEW T10: 70CMSW23D00000003).
  - DHS Office of Procurement Operations (CEW: 70RFP325DEH000002; C-UAS IDIQ: 70RDA226D00000001, Dedrone Defense).
  - CBP (body-worn cameras: 70B03C23D00000006).
  - U.S. Marshals (TASER 10 IDIQ).
  - VA police (cameras and evidence; 1,600+ TASER 10s in FY2026).
  - Secret Service, DEA, ATF, IRS and the National Park Service.
- **State DOCs (key):**
  - NY DOCCS (42 facilities).
  - Maryland DPSCS ($4.1M a year, 2025-09 to 2035-08).
  - The two unnamed Q3 state DOC deals ($258M and $115M).
- **Cities (not key; below-tiny line):**
  - Reno: consolidation contract, 200+ ALPRs replacing Flock hardware.
  - Cleveland: ALPR, pending.
  - Howard County, MD: DFR.
  - Santa Fe: DFR, $2.2M over five years.
  - The unnamed $40M metro PD.
- **Enterprise:** an unnamed healthcare provider ($10M, Q3).
- **Skydio:** investee and exclusive U.S./Canada public-safety distribution partner.
- **Unnamed deals:** shareholder-letter deals are unnamed. Never attach them to a named city or state without a source.

## Competitors & read-through
- **Motorola Solutions:** cameras, evidence, ALPR, and counter-drone through D-Fend.
  - An MSI win at a sheet key account in Axon's category scores 50-69 as a possible loss (core §9.4).
  - Confirmed replacement is `money` bad news, at 70+.
- **Flock Safety:** ALPR and drones. City switches from Flock to Axon are AXON items because Axon is named. They follow the award line (60-68 below tiny).
- **ONDS (covered):** counter-drone rival through Sentrycs and DZYNE. An item that names both companies is direct involvement for both.
- **Rekor (REKR, not covered since 2026-11-20):** ALPR rival. Its own news is out of scope unless it names Axon or wins at an Axon key account (core §9 rule 4).
- **DroneShield:** counter-drone rival.
- **Everything else is `out_of_scope`.** This covers peer wins, peer financings, sector budgets and Skydio-only news. Grade an item only when it names Axon or one of its products, or when a key customer acts on a product in Axon's category (core §9.2).

## Source coverage gaps
Grader-facing facts only. Collector and query notes move to the worker file `sources/AXON.md`.
- **Thin `axon` press key:** it delivered 9 releases from 2026-08-20 to 2026-11-18 and missed every council vote.
  - Council items arrive through local news. The event date is the vote or reading date in the article, not the crawl time.
  - Missing coverage is never `insufficient_evidence` for an item that did arrive.
- **Two release channels:**
  - The Axon newsroom (axon.com/newsroom) carries releases that investor.axon.com does not, such as the federal momentum and corrections roundups. Either copy is a company release, so treat it as canonical.
  - Dedrone and Skydio newsrooms count only when the item names Axon or Dedrone.
- **EDGAR rows:** some `edgar_axon` rows carry 8-K item numbers (e.g. 2026-09-21); most do not. Open the filing before scoring above 39 (core §5).

## Grader notes
- **Bookings are not revenue.**
  - Future contracted bookings ($15.8B) and five-year bookings are multi-year; only 20-25% converts within 12 months.
  - GAAP RPO ($10.2B) is a separate, smaller figure. Never conflate them.
- **Contract value.** Council items often quote the total value of a 5-10 year consolidation that rolls existing contracts together.
  - Test total contract value against the $18.1M tiny line.
  - State that the amount is not incremental, and give the annual figure.
- **Guidance math.** The Q3 2026 cut is about -2% at the midpoint ($3,620M vs about $3,697M). That keeps the print at Digest (85-88), not Lead. Lead needs ≥10% at the midpoint, a withdrawal, or a ≥20% miss.
- **Financing.**
  - The convert was announced at $1.0B and closed at $1.15B with the full over-allotment.
  - The Skydio cash mix moved from about 60% (about $720M) to about 90%.
  - Do not add these amounts together.
- **Skydio's figures.** Skydio's "about $1 billion of bookings this fiscal year" is Skydio's own figure, not Axon's.
  - Under the distribution deal, Axon books Skydio revenue net in Software & Services.
  - For a Skydio hardware sale through Axon, test total contract value but note "Axon books net".
- **Edition timing.** Axon releases go out on PR Newswire at 21:01 UTC, and the 8-K arrives within about an hour (21:25 and 22:01 on 2026-11-05). The release is the canonical copy.
- **Calendar items.** Axon Week and conference sessions are not investor days. Score them as promotional, below 25.
- **Published text.** State what happened, for example "Reno council votes 5-2 to approve Axon consolidation contract." Add no implication or read-through commentary.
