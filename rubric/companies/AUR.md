---
ticker: AUR
name: Aurora Innovation, Inc.
as_of: 2026-11-18
verified: "EDGAR submissions (CIK0001828108) and the IR press-release list checked 2026-11-18: no filings after the 2026-11-06 SCHEDULE 13G/A, no releases after 2026-10-28. Web search budget was exhausted, so non-primary items after 2026-11-06 were not rechecked."
asset_class: operating
filer: domestic (10-K, 10-Q, 8-K, 424B5, S-3; Section 16 Forms 3/4/144; SCHEDULE 13D/13G by holders)
cik: "0001828108"
exchange: Nasdaq Global Select (AUR); AUROW warrants expired 2026-11-03, 25-NSE filed 2026-11-02
fx_as_of: n/a (all figures USD)
base:
  core_default_usd: 9000000          # FY2026 guide ~$9M (Q3 letter 2026-10-28), core rule: guidance midpoint
  core_default_tiny_usd: 90000       # 1% of B (B < $100M)
  core_default_lead_usd: 900000      # 10% of B
  core_default_status: degenerate    # every disclosed truck order would be Lead; not used for orders
  alt_base: true
  alt_base_status: proposed, needs owner sign-off
  alt_base_basis: "Company 2027 targets (Q3 letter 2026-10-28; investor day 2026-09-23): >1,000 trucks exiting 2027 and ~$200M 2027 revenue"
  unit_base_trucks: 1000             # primary yardstick, p = trucks / 1,000 x 100
  unit_tiny_trucks: 5                # 0.5% (dollar alt base > $100M)
  unit_lead_trucks: 100              # 10%
  alt_base_usd: 200000000
  alt_tiny_usd: 1000000              # 0.5% of $200M
  alt_lead_usd: 20000000             # 10% of $200M
shares_outstanding: 2020447857       # 1,730,329,427 Class A + 290,118,430 Class B, as of 2026-10-21
last_price_usd: 5.12                 # 424B5 last sale, 2026-10-27
market_cap_usd: 10340000000
one_pct_dilution: "~20.2M shares, ~$103M at $5.12"
liquidity_2026_09_30_usd: {cash: 141000000, short_term_investments: 893000000, long_term_investments: 183000000}
terms: ["Aurora Innovation", "Aurora Operations", "Aurora Driver", "AUR", "Urmson", "FirstLight"]
aliases:
  - {term: "Aurora", case: sensitive, require_any: ["truck", "trucking", "autonomous", "autonomy", "driverless", "self-driving", "Aurora Driver", "Urmson", "AUR"]}
  - {term: "FirstLight", case: sensitive, require_any: ["lidar"]}
traps:
  - {term: "Aurora Flight Sciences", case: insensitive, owner: Boeing}
  - {term: "Aurora Cannabis", case: insensitive, ticker: ACB}
  - {term: "Aurora Mobile", case: insensitive, ticker: JG}
  - {term: "Aurora Solar", case: insensitive}
  - {term: "Amazon Aurora", case: insensitive, note: database}
  - {term: "Advocate Aurora", case: insensitive}
  - {term: "Aurora supercomputer", case: insensitive, note: Argonne}
  - {term: "aurora borealis", case: insensitive}
  - {term: "Aurora, CO / Aurora, IL / Aurora council / Aurora city", case: insensitive, note: "city government, e.g. data-center moratorium stories Oct 2026"}
  - {term: "Waabi / PlusAI on Volvo, International or Ryder trucks", case: insensitive, note: "other autonomy stacks"}
  - {term: "Bot Auto", case: insensitive, note: "private autonomy developer; never BOT (RoboStrategy) and never AUR"}
thesis_drivers: [ramp, daas_conversion, cash_dilution, unit_economics, regulatory, safety]
open_items:
  - {id: roush_20wk, text: "Roush at 20 trucks/week on two shifts by early December 2026", expires_at: 2026-12-31}
  - {id: direct_to_site, text: "Driverless direct-to-site operations for several customers in November 2026", expires_at: 2026-12-31}
  - {id: fleet_200, text: ">200 driverless trucks by end-February 2027 (slipped from exit-2026)", expires_at: 2027-03-31}
  - {id: q4_cash_use, text: "Q4 2026 cash use ~$250M", expires_at: 2027-03-15}
  - {id: volvo_driverless, text: "Fully driverless operations on Volvo VNL Autonomous in early 2027", expires_at: 2027-06-30}
  - {id: gp_positive, text: "Run-rate positive gross profit in 1H 2027", expires_at: 2027-08-31}
  - {id: aumovio_sop, text: "AUMOVIO Gen-3 kit start of production 2H 2027", expires_at: 2028-02-28}
  - {id: trucks_1000, text: ">1,000 trucks exiting 2027", expires_at: 2028-03-31}
  - {id: daas_conversion, text: "Hirschbach or Charger 500-truck MOU converted to a binding DaaS agreement", expires_at: 2028-12-31}
  - {id: teamsters_ca, text: "Teamsters suit against California DMV heavy-duty AV rules: ruling", expires_at: 2027-12-31}
groups: [earnings_calendar, deployment_wave_AUR]
---

# AUR — Aurora Innovation, Inc.
_Researched 2026-11-18. Nasdaq Global Select: AUR. The public and private warrants (AUROW, $11.50 strike) expired 2026-11-03; Nasdaq filed the [25-NSE](https://www.sec.gov/Archives/edgar/data/1828108/000135445726001046/xslF25X02/primary_doc.xml) on 2026-11-02. CIK 0001828108. Fiscal year ends Dec 31. Q4/FY2026 results are not yet dated. Expect mid-February 2027: FY2025 came out 2026-02-11, and the date notice usually comes about 3 weeks ahead (2026-10-07 for 2026-10-28). Shares outstanding as of 2026-10-21: 1,730,329,427 Class A plus 290,118,430 Class B, 2,020,447,857 in total. Last sale on 2026-10-27 was $5.12 (424B5), for a market cap of about $10.3B. EDGAR and the IR list were rechecked on 2026-11-18. Nothing new was filed after 2026-11-06 and nothing new released after 2026-10-28._

## Identity & matching
- **Legal entities:** Aurora Innovation, Inc. (issuer). Aurora Operations, Inc. is the operating company, the 424B5 filer and the name used in FMCSA and Federal Register dockets.
- **Products and brands:**
  - Aurora Driver (also "Aurora Driver-powered").
  - Second-generation driverless trucks on the International LT, launched 2026-07-22 ([IR](https://ir.aurora.tech/news-events/press-releases/detail/144/aurora-launches-second-generation-driverless-trucks-in-u-s-to-meet-customer-demand)).
  - FirstLight lidar, counted only with lidar context.
  - Gen-3 hardware kit built by AUMOVIO (formerly Continental) under Hardware-as-a-Service.
  - Driver-as-a-Service (DaaS) and Transport-as-a-Service (TaaS).
- **Alias guard (case-sensitive "Aurora"):** "Aurora" counts only alongside a trucking, autonomy or driverless term, or alongside AUR, Urmson or Aurora Driver.
- **Reject these collisions (score 0-5, `reason:off_entity`):**
  - Aurora Flight Sciences (Boeing), Aurora Cannabis (ACB), Aurora Mobile (JG), Aurora Solar, Amazon Aurora (database), Advocate Aurora Health, the Argonne "Aurora" supercomputer, the aurora borealis.
  - The cities of Aurora, CO and Aurora, IL. Real example: the October 2026 run of Aurora, CO data-center moratorium stories ("Aurora postpones vote on data center moratorium", 2026-10-19; "Aurora council to vote on indefinite data center moratorium", 2026-10-23).
  - Volvo, International or Ryder trucks running Waabi or PlusAI stacks.
  - FedEx, Schneider, Werner or Uber Freight news about other autonomy developers.
- **Cross-sheet collisions (check before scoring):**
  - "Bot Auto" is a private autonomy developer. It is never BOT (RoboStrategy) and never an AUR item.
  - Kodiak AI (KDK) items that do not name Aurora belong to the KDK sheet only.
  - An item naming both Aurora and Kodiak gets one object per ticker (`#AUR`, `#KDK`, `also:` flags) only when each company is directly involved.

## What the stock trades on
1. **Production ramp and truck count (`ramp`).**
   - Roush is targeting 20 trucks/week by early December, on two shifts (16 hours a day).
   - The fleet should pass 200 trucks by end-February 2027, slipped from "200 by exit-2026".
   - More than 1,000 trucks exiting 2027.
   - Source: [Q3 letter](https://www.sec.gov/Archives/edgar/data/1828108/000182810826000092/aurora26q3shareholderlet.htm).
2. **Conversion to binding DaaS orders (`daas_conversion`).**
   - The Hirschbach and Charger 500-truck MOUs are both non-binding. Hirschbach deliveries begin in 2027; Charger's run through 2027-28.
   - Carrier-owned trucks pay $0.85 or more per mile.
3. **Cash burn against liquidity and dilution (`cash_dilution`).**
   - Q3 operating cash use was about $170M, plus $36M capex. Q4 cash use is guided to about $250M.
   - Cash and short-term investments were about $1.03B.
   - The ATM was refreshed to $1B on 2026-10-28, and Uber is selling down its stake.
4. **Unit economics and long-range targets (`unit_economics`).**
   - Run-rate positive gross profit in 1H 2027 (previously end-2026).
   - 2027: more than 1,000 trucks and about $200M revenue.
   - Run-rate FCF positive in 2028 at about 7,500 trucks.
   - 2030: more than 30,000 trucks, more than $5B revenue and about 60% gross margin ([Trucking Dive](https://www.truckingdive.com/news/aurora-targets-30k-driverless-trucks-5b-revenue-in-2030/833800/)).
5. **Regulatory path (`regulatory`).**
   - The FMCSA warning-beacon exemption has been granted.
   - Aurora holds the California DMV drivered heavy-duty testing permit; a Teamsters suit challenges the DMV rules.
   - The federal BUILD America 250 Act passed House T&I 62-2 in May 2026.
6. **Safety record (`safety`).** The company reports 100% on-time delivery since launch and more than 500K commercial driverless miles by September 2026. Any driverless incident resets the thesis.

## Materiality bases
- **Core default base (not used for orders).**
  - The core rule takes the FY2026 guide: about $9M, cut from $14-16M (Q3 letter, 2026-10-28; the $14-16M was reiterated in the Q2 letter). Q3 revenue was $3M and 9M revenue $6M.
  - Core math gives a tiny line of $90K and a lead line of $0.9M, so every disclosed truck order would be Lead. That makes the default degenerate for orders.
  - Results, guidance and capital still use core rules unchanged.
- **Alternative base (`alt_base: true`, proposed, needs owner sign-off).**
  - The basis is the company-stated 2027 targets: more than 1,000 trucks exiting 2027 and about $200M of 2027 revenue (Q3 letter, 2026-10-28; investor day, 2026-09-23).
  - Until the owner marks it `owner:<date>`, the grader uses it, adds `needs_owner` to every magnitude-dependent score of 70 or more, and caps confidence at 0.7 on those scores.
  - It uses the company's own figures, so no denominator is invented.
- **Unit yardstick (primary, when a truck count is stated).** p = trucks ÷ 1,000 × 100, recorded in `magnitude_pct_of_base`. Tiny is 0.5%, or 5 trucks; lead is 10%, or 100 trucks. Core 4.2.1 bands:

  | Trucks | p | Binding | Quantified `mou` / `pilot` |
  |---|---|---|---|
  | ≥100 | ≥10 | 90-97 (`floor:lead_order`) | 78-85 |
  | 30-99 | 3-10 | 80-89 | 70-78 |
  | 10-29 | 1-3 | 72-80 | 64-72 |
  | 5-9 | 0.5-1 | 70-74 | 60-64 |
  | <5 | <0.5 | 25-39; a first customer or new lane scores 55-65 | 25-39 |

  - The 500-truck Hirschbach and Charger MOUs give p = 50, which falls in the MOU column at 78-85 (core anchor 80). A non-binding commitment never reaches Lead, whatever the truck count. Only a binding commitment of 100 or more trucks does.
- **Dollar yardstick (no truck count stated).** V ÷ $200M. Tiny is $1.0M and lead $20M. "Hundreds of millions" language with no figure gets `magnitude_usd: null` and is graded on the stated truck count or on status.
- **Liquidity at 2026-09-30:** $141M cash, $893M short-term investments and $183M long-term investments. The Q4 cash-use guide is about $250M.
- **Capital events (core 4.2.2, dilution not cash).**
  - Basic shares are 2.02B. 1% dilution is about 20.2M shares, or about $103M at $5.12. d = 5% is about $520M; d = 10% is about $1.03B.
  - ATM capacity is $1B: $245.8M left over plus $754.2M new (424B5, 2026-10-28, [SEC](https://www.sec.gov/Archives/edgar/data/1828108/000162828026067914/auroraoperations-424b5oct2.htm)). The new capacity is 7.3% of market cap, so the core new-ATM row gives 60-72. A `cash_dilution` thesis lift of +5-10 puts the item at 70-80.
  - Cumulative ATM gross proceeds are $1.17B on 189.5M shares.
  - Quarterly ATM usage under 1% of shares belongs in the results card and is not an item. Q3 usage was 6M shares for $41M net, of which $23M funded RSU tax.

## Event ladder for this name
Core bands apply. This list gives only AUR examples, the rank_high lifts tied to thesis drivers, and the readings of AUR-specific stages.
- **Lead (90-100)**
  - Same-day results that change guidance or a truck target. Example: ["Aurora Announces Third Quarter 2026 Results" (2026-10-28)](https://ir.aurora.tech/news-events/press-releases/detail/155/aurora-announces-third-quarter-2026-results). It cut the FY revenue guide from $14-16M to about $9M, about -40% at the midpoint, and moved the 200-truck milestone to end-February. That meets the core guidance-change Lead test; `ramp` lift.
  - An analyst or investor day with new long-range targets. Example: ["Aurora Outlines 2030 Vision to Scale to 30,000 Driverless Trucks" (2026-09-23)](https://ir.aurora.tech/news-events/press-releases/detail/152/aurora-outlines-2030-vision-to-scale-to-30000-driverless-trucks-at-analyst-and-investor-day). New targets act as guidance.
  - A binding DaaS order or conversion of 100 or more trucks (`floor:lead_order`, `resolves:daas_conversion`).
  - rank_high (`safety`): any Aurora Driver crash report, NHTSA probe, recall, fleet pause or grounding.
  - rank_high (`ramp`): a further ramp slip that threatens the 1,000-truck exit-2027 target (`trucks_1000`), or a miss on `fleet_200`.
  - rank_high (founder-CEO): a departure of Chris Urmson.
- **Digest (70-89)**
  - Non-binding MOUs with truck counts. p = 50 puts them at 78-85, with status `mou`, never "order":
    - ["Charger Logistics and Aurora to Begin Scaling Autonomous Fleet to 500 Trucks" (2026-10-26)](https://ir.aurora.tech/news-events/press-releases/detail/154/charger-logistics-and-aurora-to-begin-scaling-autonomous-fleet-to-500-trucks).
    - ["Leading Carrier Selects Aurora to Scale Autonomous Fleet to 500 Trucks" (Hirschbach, 2026-04-30)](https://ir.aurora.tech/news-events/press-releases/detail/136/leading-carrier-selects-aurora-to-scale-autonomous-fleet-to-500-trucks). Core anchor: 80.
  - Final regulator decisions naming Aurora (`floor:regulator`):
    - The FMCSA five-year cab-beacon exemption for Aurora and other Level 4 carriers, effective 2026-10-07 to 2031-10-07, published 2026-10-09 ([FR 2026-20734](https://www.federalregister.gov/d/2026-20734)). Core anchor: 85.
    - The California DMV drivered heavy-duty testing permit, reported 2026-08-14 ([TechCrunch](https://techcrunch.com/2026/08/14/self-driving-trucks-are-officially-testing-on-california-highways/)): 75-80.
  - New driverless lanes, routes or direct-to-site operations: `proof` 70-85 per core, `group:deployment_wave_AUR` when several land together. Example: ["Volvo and Aurora Launch Autonomous Truck Route to Oklahoma City" (2026-05-05)](https://ir.aurora.tech/news-events/press-releases/detail/137/volvo-and-aurora-launch-autonomous-truck-route-to-oklahoma-city).
  - New named customer contracts, binding, with no truck count: 70-78 by the core no-value default. Examples: ["Charger Logistics to Deploy Second-Generation Driverless Trucks" (2026-07-28)](https://ir.aurora.tech/news-events/press-releases/detail/146/charger-logistics-to-deploy-second-generation-driverless-trucks) and Value Truck (2026-07-27).
  - The ATM upsize (2026-10-28): 70-80 (see Materiality bases).
  - CEO (Urmson), CFO (David Maday) or President (Ossa Fisher) in or out: core people rung, `floor:neo_ceo_cfo` 75 for CEO or CFO, `floor:neo` 70 for the President; +5-10 if abrupt.
  - Uber block sales reported on a SCHEDULE 13D/A with an updated Item 4 disposition, at 1% of outstanding (about 20M shares) or more: 65-75 (core 13D/A Item 4 range, `cash_dilution` lift). Example: [SCHEDULE 13D/A, 2026-09-17](https://www.sec.gov/Archives/edgar/data/1828108/000155278126000494/xslSCHEDULE_13D_X02/primary_doc.xml). It reported 29,369,611 shares (1.5%) sold on 2026-09-15 at $6.205, leaving 157.1M Class A shares (9.2% per the filing).
  - Volvo or PACCAR production-line timing for Aurora-equipped trucks, when the source names Aurora: `proof` 70-80.
  - Results-date notices: fixed 75, `group:earnings_calendar`, `floor:calendar`. Example: ["Aurora to Host Third Quarter 2026 Business Review Conference Call on October 28, 2026" (2026-10-07)](https://ir.aurora.tech/news-events/press-releases/detail/153/aurora-to-host-third-quarter-2026-business-review-conference-call-on-october-28-2026).
  - Investor-day notices: `floor:investor_day` 80. Aurora listed in November 2021, so the 85 first-ever or newly-listed tier does not apply. Example: "Aurora to Host Analyst & Investor Day on September 23, 2026" (2026-09-02).
- **Borderline (40-69)**
  - Late trade-press pieces that add a new management fact, graded on the increment with `reason:new_information` and the 4-21-day timeliness discount. Example: ["Aurora's truck production schedule delayed by supply, quality issues" (Trucking Dive, 2026-11-06)](https://www.truckingdive.com/news/auroras-truck-production-schedule-delayed-by-supply-quality-issues/873378/), which reports wire harnessing moving to an outside supplier: 45-60. Without a new fact it is `late_repost` under core §7.
  - Mileage milestones outside results (500K commercial driverless miles, September 2026): 50-65.
  - Third-party safety assessments, e.g. Edge Case (2026-06-25): 45-60.
  - Partner-led operations releases that name Aurora: Volvo/DSV (2026-05-13), AVI-SPL with Volvo (2026-06-18). `proof` 60-69 as named-customer deployments, `group:deployment_wave_AUR`.
  - AUMOVIO line bring-up progress with no production date change: 50-65. An SOP slip moves `aumovio_sop` and ranks as a `ramp` slip.
  - CA DMV permit-list changes that name Aurora without a new phase: 40-55.
  - An FMCSA application or comment notice naming Aurora Operations, e.g. [FR 2026-07288 (2026-04-15)](https://www.federalregister.gov/documents/2026/04/15/2026-07288/parts-and-accessories-necessary-for-safe-operation-application-for-exemption-from-aurora-operations): 55-65 (`pre_award`-like stage; not a decision).
  - A director-only 8-K 5.02, e.g. the 2026-02-27 Hughes Johnson exit and Wehner appointment: 25-45 per core.
- **Reject (<40)**
  - Investor-conference and retail town-hall notices, `reason:promotional`: "Aurora to Present at Upcoming Investor Conferences" (2026-08-20); "Aurora to Host a Retail Investor Town Hall on August 20, 2026" (2026-08-06).
  - Sponsorships: "Arrow McLaren Adds Autonomous Trucking Pioneer Aurora as Official Partner" (2026-08-04), 10-20.
  - Partner Summit notices (35+ carriers) with no new commitments or counts: 20-35.
  - Late recaps of the investor day or of earnings, e.g. Trucking Dive's "Aurora targets 30K driverless trucks, $5B revenue in 2030" (2026-10-26, a month after the event): `stale` under core §8.
  - Price targets and ratings: <20.
  - Form 144s and routine Form 4 sales, mostly 10b5-1 (e.g. the 2026-08-05 to 2026-08-21 cluster): core Form 4/144 rules, 15-35. Only a non-10b5-1 CEO or CFO sale of 10% or more of holdings reaches 55-75.
  - The AUROW 25-NSE (2026-11-02): about 20, `reason:below_materiality`. The $11.50-strike warrants expired worthless, so the filing is administrative.

## Always surface (floors)
Core §6 floors apply. These are AUR identifiers mapped to them, plus the lifts the sheet documents.
- 8-K Item 2.02 or the same-day results release: `floor:results` 80, figures first. A guidance or truck-target change goes Lead under core §3.
- 8-K Item 5.02: `floor:neo_ceo_cfo` 75 for Urmson or Maday; `floor:neo` 70 for another named executive officer (Fisher). Director-only changes are 25-45.
- 8-K Items 1.01 or 8.01 with a customer agreement: grade by the unit or dollar yardstick. `floor:order` 70 applies to a binding order of at least 5 trucks or $1M with a named counterparty.
- 424B5 or S-3 adding capacity or a new offering: core 4.2.2 rows (new ATM 60-72 at under 20% of market cap; priced takedowns by d), plus a `cash_dilution` lift of +5-10.
- SCHEDULE 13D/A by Uber Technologies (Neben Holdings) reporting sales of 1% of outstanding or more: 65-75. Smaller amendments score <30.
- Federal Register or FMCSA notices naming "Aurora Operations, Inc.": a final disposition takes `floor:regulator` 75 (anchor 85). An application or comment period is 55-65.
- An NHTSA SGO crash report, investigation or recall involving the Aurora Driver: rank_high (`safety`) 90 or more. A company-disclosed government probe also carries `floor:probe` 80.
- A California DMV permit-phase change (drivered testing, then driverless testing, then deployment): `floor:regulator` 75.
- Hirschbach, Charger or Volvo Autonomous Solutions statements about Aurora truck plans, including when the headline says only "leading carrier":
  - A conversion to binding terms is `floor:lead_order` 90, `resolves:daas_conversion`.
  - A delay or cancellation mirrors the MOU at size, 78-85, with `floor:key_loss` 70.
- Results-date notice: fixed 75, `group:earnings_calendar`.

## Noise patterns
- **edgar_aur archive burst (core §8, R-0050).**
  - On 2026-08-31 at 21:21:27Z the feed delivered 40 filings dated 2024-04-05 to 2026-07-29 (10-Qs, 8-Ks, 424B5s, DEF 14As, SC 13D/A 2024-05-08). They all share one first_seen stamp.
  - Gate each item on its filing date. Anything older than 21 days scores 0-9 with `reason:stale`, `archive_burst` and `source_repair`.
- **aurora IR backfill.** Releases from 2026-04-15 to 2026-07-08 were all first seen 2026-07-09T18:31Z. Apply the same date gate.
- **Results arrive four times.** On 2026-10-28 the aurora release came at 20:17Z, the 8-K at 20:22Z, the 10-Q at 20:31Z and the 424B5 at 20:39Z.
  - The company release is canonical.
  - The 8-K and 10-Q are duplicates (`score: null`, `dup_of:`) unless they add facts such as the warrant expiry or share count.
  - The 424B5 is graded separately as the ATM event.
- **Bare form titles,** e.g. "Aurora Innovation, Inc.: 424B5 filed 2026-10-28". Open the filing (`read_source: true`) and grade the content (the $1B ATM), never the receipt. If the figures cannot be extracted, cap at 55 with `no_figures`.
- **Promotional and IR notices** (conferences, town halls, the Arrow McLaren IndyCar partnership): 10-20, `reason:promotional`.
- **Syndicated echoes.** FreightWaves (2026-10-28), Trucking Dive and others carried the Charger MOU over 1-3 days.
  - These are `already_covered`, citing the release item, unless they add a fact. Example of an added fact: FreightWaves reported Charger's 481 power units from its FMCSA registration.
  - Recap and retelling windows (24h for results, 72h for guidance) follow core §7.
- **Off-entity city news** (Aurora, CO / IL councils, moratoria, police): 0-5, `reason:off_entity`.

## Catalyst calendar
- November 2026: driverless direct-to-site operations for several customers (`direct_to_site`). Site-to-site operations for most customers follow "over the coming months".
- Early December 2026: Roush reaches 20 trucks/week (`roush_20wk`).
- Late 2026: AUMOVIO line bring-up at New Braunfels, TX.
- Q4 2026: cash use of about $250M (`q4_cash_use`), tested at Q4 results.
- About mid-February 2027: Q4/FY2026 results and the 2027 outlook. The date notice is expected about 3 weeks earlier.
- End of February 2027: more than 200 driverless trucks (`fleet_200`).
- Early 2027: fully driverless operations on the Volvo VNL Autonomous (`volvo_driverless`). Volvo plans more than 300 driverless trucks in 2027 and full industrial production in 2028. PACCAR timing is undated.
- 1H 2027: run-rate positive gross profit (`gp_positive`).
- 2027-28: possible definitive Hirschbach and Charger DaaS agreements, with deliveries (`daas_conversion`).
- 2H 2027: start of production of the AUMOVIO Gen-3 kit (`aumovio_sop`).
- Context only (no score unless an item names Aurora):
  - BUILD America 250 Act floor action.
  - The Teamsters California lawsuit against the DMV heavy-truck rules (`teamsters_ca`; a ruling that names the DMV AV rules counts under core §9 rule 3).
  - Further Uber 13D/A sell-downs (amendments came 2026-06-04, 2026-08-19 and 2026-09-17).
  - The 2027 annual meeting proxy, expected around early April 2027 (the 2026 proxy was filed 2026-04-02). A routine proxy is 10-20.

## Customers, programs, agencies & counterparties
- **Carriers and customers** (`big` cannot be set: revenue shares are not disclosed):
  - Hirschbach: 500-truck DaaS MOU; driverless customer since April 2025. Disclosure: release.
  - Charger Logistics: July 2026 contract plus a 500-truck MOU; Dallas-Laredo. Disclosure: release.
  - Uber Freight: launch customer.
  - Werner; McLane (partnership 2026-05-06); Value Truck.
  - Detmar Logistics: Midland, TX to the Capital Sand mine site.
  - FedEx and Schneider: supervised pilots in 2025, per the FY2025 10-K. Disclosure: filing_only.
  - DSV and AVI-SPL: through Volvo Autonomous Solutions.
- **Manufacturing:** Roush (upfits International LT trucks); AUMOVIO (Gen-3 kit, Hardware-as-a-Service, New Braunfels); NVIDIA (DRIVE Thor); Volvo Autonomous Solutions (VNL Autonomous, New River Valley, VA); PACCAR (Peterbilt and Kenworth lines).
- **Agencies:** FMCSA (warning-device exemption); NHTSA (SGO crash reporting); USDOT (Automated Vehicles National Strategy FY2026-2030); California DMV; Texas DMV and DPS.
- **Holders:** Uber Technologies (157.1M Class A, 9.2% per its 13D/A); Index Ventures (13D/A filed 2026-08-07).

## Competitors & read-through
- Core §9 governs. Score an item for AUR only when the source names Aurora, a sheet product, or a sheet customer acting on Aurora trucks. Published `why` and `note_hook` never state relative-pace or beneficiary claims.
- **Kodiak AI** (KDK, also covered) competes on Dallas-Houston and in California. A Kodiak launch that does not name Aurora is a KDK item only and `out_of_scope` for AUR.
- **Rival wins at key accounts** (Kodiak, Waabi, PlusAI, Torc, Bot Auto) at Hirschbach, Charger, Werner, McLane or Uber Freight: 50-69 for AUR as a possible loss (core §9 rule 4). If replacement of Aurora is confirmed, `money` bad news at 70 or more.
- **Context only, out of scope for AUR unless Aurora is named:**
  - Waabi on the Volvo VNL Autonomous (Volvo capacity).
  - PlusAI factory-fit on International trucks.
  - Torc / Daimler Truck, Bot Auto and Tesla Semi.

## Source coverage gaps
- Collector endpoints and feed-repair notes move to the worker doc `sources/AUR.md`; they are not grader-loaded.
- Grader-facing facts:
  - edgar_aur does not deliver Forms 3, 4 and 144 or the "SCHEDULE 13D/A", "SCHEDULE 13G" and "SCHEDULE 13G/A" form types. Examples that never arrived: the Uber sell-downs of 2026-08-19 and 2026-09-17, the 13G/A of 2026-10-30, the 13G of 2026-11-05 and the 13G/A of 2026-11-06.
  - Missing owner filings, a missing expected 8-K, or no item from FMCSA, NHTSA or the CA DMV is never `insufficient_evidence` and never lowers a score.
  - Operational posts on aurora.tech/newsroom do not appear on the IR list. When they arrive through press, the earliest primary copy is canonical.

## Grader notes
- **Results:** state these figures:
  - revenue against prior guidance;
  - truck count against target;
  - operating cash use and capex;
  - cash and short-term investments;
  - quarterly ATM usage;
  - the 1,000-truck exit-2027 target.
- **Status language:**
  - Hirschbach and Charger are "non-binding MOU", never "order".
  - The FMCSA item is an "exemption granted" (five years, Level 4 carriers with notice), not a rule change.
  - California is a "drivered testing permit", not driverless operation.
  - Trucks "built" are not trucks "in fleet".
- **Magnitude:**
  - Use the unit yardstick when trucks are stated and the dollar alt base otherwise.
  - Write the test in `why`, e.g. "500-truck non-binding MOU, 50% of 1,000-truck exit-2027 target".
  - Add `needs_owner` to magnitude-dependent scores of 70 or more until the alt base is owner-marked.
  - Never use the $9M FY guide for orders.
- **Units:** results are stated in whole millions. Driverless miles are cumulative commercial driverless miles, which differ from total autonomous miles.
- **Shareholder letter vs 10-Q:** the shareholder letter (8-K Exhibit 99.1) is primary. Its HTML is image-based, so extract the hidden text layer. The 10-Q usually adds only ATM, warrant and share-count details.
- **Already-covered:** cite the same-event item. A new figure from the call (harness outsourcing, a shift change) reopens the story as `new_information`.
- **Stale facts in old profiles,** superseded as of 2026-10-28:
  - "200 trucks by exit-2026" and "about $80M exit-2026 TaaS run-rate" (both from the Q2 letter).
  - FY2026 revenue of $14-16M.
  - The "20 trucks/week in October" target (now early December).
  - "Fully allocated for 2026".
  - The FMCSA request as pending: it was granted.
  - The old sheet lines "non-binding 300 or more trucks = Lead" and "$2M dollar tiny". Both are removed in favour of core 4.2.1 math.
