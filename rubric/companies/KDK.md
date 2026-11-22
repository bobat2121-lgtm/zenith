---
ticker: KDK
name: Kodiak AI, Inc.
as_of: 2026-11-18
asset_class: operating
filer: domestic 10-K/10-Q/8-K; accelerated filer; emerging growth company; Delaware; CIK 0001853138
fiscal_year_end: 12-31
currency: USD
fx_as_of: n/a (all figures USD)
base_usd: 11900000
base_basis: "Q3 2026 revenue $2.969M x 4 (no revenue guidance); includes ~$0.5M one-time defense revenue"
base_date: 2026-09-30
alt_base: {used: true, metric: trucks, value: 37, basis: "Atlas trucks at Q3 2026; for DaaS deals with no dollar value"}
small_base: true            # B < $25M, so the core small-base rule applies
tiny_usd: 119000            # 1% of B
lead_usd: 1190000           # 10% of B
shares_basic: 204100000     # 2026-10-30, Q3 10-Q cover
shares_date: 2026-10-30
market_cap_usd: 210000000   # ~ $1.04, the CFO's 2026-11-13 Form 4 price
status_events:
  - {event: de_spac_close, date: 2025-09-24, note: "Ares Acquisition Corp II (AACT) -> Kodiak AI; 'listed <=24 months' until 2027-09-24"}
  - {event: pending_mna, value: none}
terms: ["Kodiak AI", "Kodiak Robotics", "KDK", "KDKRW", "Kodiak Driver", "Driver-as-a-Service", "DaaS", "Gen7", "SensorPods", "Autonomy Readiness Measure", "BreakPoint", "Leonidas AGV", "ROGUE-Fires"]
aliases:
  - {term: "Kodiak", case_sensitive: true, guard: "needs an autonomy, truck or defense term, or KDK / Kodiak AI / Kodiak Robotics"}
  - {term: "ARM", case_sensitive: true, guard: "only as Autonomy Readiness Measure with Kodiak context (formerly 'Safety Case Readiness')"}
  - {term: "Atlas", case_sensitive: true, guard: "only Atlas Energy Solutions (AESI) or Fountainhead"}
  - {term: "Charger", case_sensitive: true, guard: "only Charger USA / Charger Logistics"}
  - {term: "DTL", case_sensitive: true, guard: "only DTL Transport"}
match_traps:
  - {term: "Kodiak", reject: ["Kodiak Gas Services (KGS)", "Kodiak Sciences (KOD)", "Kodiak Copper (TSX-V: KDK)", "Kodiak Cakes", "Kodiak Building Partners", "Chevrolet Kodiak", "Kodiak Island / Pacific Spaceport Complex, Alaska"], case_sensitive: false}
  - {term: "KDK", reject: ["Kodiak Copper, TSX-V"], case_sensitive: true, note: "exchange context decides"}
  - {term: "Atlas", reject: ["Atlas Air", "Atlas Copco", "Boston Dynamics Atlas"], case_sensitive: true}
  - {term: "ARM", reject: ["Arm Holdings (Nasdaq: ARM)"], case_sensitive: true}
  - {term: "Charger", reject: ["Dodge Charger"], case_sensitive: true}
  - {term: "aur-YYYYMMDD.htm", reject: ["Aurora Innovation (AUR) attribution"], note: "KDK's own 8-K filenames; resolve by CIK"}
  - {term: "Bot Auto", reject: ["BOT RoboStrategy"], note: "Bot Auto is a KDK peer, never a KDK or BOT item; see core shared collision table"}
removed: []
thesis_drivers:
  - {id: driver_out, text: "First driver-out long-haul service: IKEA Supply, 5 trucks, I-45 Dallas-Houston, target YE2026"}
  - {id: liquidity, text: "Going-concern paragraph; runway 'into the second quarter of 2027'; dilution"}
  - {id: fleet_ramp, text: "Atlas mid-40s by YE2026, 100 by end-H1 2027; 200 unsupervised trucks / >$50M ARR exiting 2027"}
  - {id: binding_fleet, text: "Binding fleet commitments beyond Atlas (DTL 75 trucks)"}
  - {id: oem_platform, text: "OEM and production hardware: Western Star 49X, International LT, Bosch"}
  - {id: defense, text: "USMC ROGUE-Fires and other defense ground autonomy"}
open_items:
  - {id: driver_out_ye26, text: "IKEA driver-out service on I-45 launched, or slip disclosed", target: 2026-12-31, expires_at: 2027-03-31}
  - {id: atlas_mid40s, text: "Atlas fleet reaches mid-40s trucks", target: 2026-12-31, expires_at: 2027-03-31}
  - {id: financing_q2_27, text: "Financing that extends runway past Q2 2027", expires_at: 2027-06-30}
  - {id: second_lien_jun27, text: "$10M second-lien loans repaid, refinanced or extended", target: 2027-06-01, expires_at: 2027-06-15}
  - {id: nasdaq_bid, text: "Nasdaq $1 bid-price deficiency notice or cure", expires_at: 2027-06-30, note: "clock start unverified; 52-week low $0.96 on 2026-10-23; no 8-K Item 3.01 on EDGAR as of 2026-11-18; flag needs_owner"}
  - {id: atlas_100_h1_27, text: "Atlas 100-truck commitment completed or cut", target: 2027-06-30, expires_at: 2027-08-31}
group_keys: [earnings_calendar, deployment_wave_KDK, kdk_arm_progress]   # kdk_arm_progress uses the proposed core <ticker>_<slug> pattern
---

# KDK — Kodiak AI

_Researched 2026-11-18. Nasdaq: KDK (common) and KDKRW (warrants, $9.28 strike). CIK 0001853138. Fiscal year ends 12-31. On 2026-11-18 the EDGAR submissions feed showed no 8-K after the 2026-11-05 Item 2.02 filing, and no Item 3.01. Q4/FY2026 results are not scheduled yet; expect early-to-mid March 2027. FY2025 results came out 2026-03-10 ([8-K](https://www.sec.gov/Archives/edgar/data/1853138/000162828026016456/aur-20260310.htm)) and the 10-K on 2026-03-11. The date notice usually comes about three weeks ahead; the Q3 notice was 2026-10-15 for 2026-11-05._

_This sheet holds only KDK facts and the KDK-specific lifts that rest on a thesis driver. Bands, floors and form grades not listed here come from the core rubric (v3.0), which they are not repeated from. No line here carries an `owner:` mark yet._

## Identity & matching
- **Legal entities:** Kodiak AI, Inc., formerly Ares Acquisition Corporation II (AACT); the SPAC merger closed 2025-09-24. The operating subsidiary is **Kodiak Robotics, Inc.** It is co-borrower on the Horizon loan and the name on legacy Army and DoD awards.
- **Products and terms:** see `terms` in the front matter. The Leonidas AGV was built with Epirus and GDLS and unveiled 2026-03-24 at AUSA Global Force ([Kodiak blog](https://kodiak.ai/news/kodiak-epirus-gdls-autonomous-counter-uas-vehicle)). Kodiak also has a ROGUE-Fires integration.
- **Aliases and traps:** see `aliases` and `match_traps`. Every match must pass the context guard. A trap hit is `reason:off_entity`, scored 0-5.
- **Filename trap:** Kodiak's results and financing 8-Ks are named `aur-YYYYMMDD.htm` (for example [aur-20261105.htm](https://www.sec.gov/Archives/edgar/data/1853138/000162828026071058/aur-20261105.htm) and aur-20260507.htm). Other 8-Ks use `kdk-` (kdk-20260701.htm). None of these are Aurora (AUR) filings. Resolve by CIK, never by filename.
- **Cross-sheet collisions:** check matches against the core shared collision table before scoring. The ones that apply here:
  - "Bot Auto" is a KDK peer and is never BOT.
  - "Aurora" or AUR items about the Dallas-Houston lane belong to the AUR sheet unless Kodiak is named.
  - "Atlas" here is never Boston Dynamics.

## What the stock trades on
1. **`driver_out`: the first driver-out long-haul launch.** The plan is IKEA Supply, 5 trucks, on a 219-mile stretch of I-45 between Dallas and Houston, targeted by YE2026. ARM is at 99% ([Q3 release](https://www.sec.gov/Archives/edgar/data/1853138/000162828026071058/exhibit991_financialresults.htm); [call recap](https://www.marketbeat.com/instant-alerts/transcript-kodiak-ai-q3-earnings-call-highlights-2026-11-06/)).
2. **`liquidity`: liquidity and dilution.**
   - The Q3 10-Q has a going-concern paragraph. It says cash funds the plan "into the second quarter of 2027" and that funding may include "near-term issuance of equity" ([10-Q](https://www.sec.gov/Archives/edgar/data/1853138/000162828026071686/kdk-20260930.htm)).
   - The stock trades around $1.04, the CFO's sell-to-cover price on 2026-11-13. It set a 52-week low of $0.96 on 2026-10-23 ([Finviz](https://finviz.com/news/418177/kodiak-ai-hits-estimates-as-commercial-milestones-pile-up-but-flat-underlying-revenue-and-a-shrinking-cash-runway-define-the-setup)).
3. **`fleet_ramp`: truck ramp against targets.** Atlas had 37 trucks at Q3, guided to the mid-40s by YE2026 and to its 100-truck commitment by end-H1 2027. Company targets ([call recap](https://www.marketbeat.com/instant-alerts/transcript-kodiak-ai-q3-earnings-call-highlights-2026-11-06/)):
   - 200 unsupervised trucks and more than $50M annualized run-rate revenue, exiting 2027.
   - 5,000 trucks and more than $1B, exiting 2029.
4. **`binding_fleet`: binding commitments beyond Atlas.** DTL signed a binding agreement for 75 trucks, with service targeted for 2028 ([Trucking Dive, 2026-11-11](https://www.truckingdive.com/news/dtl-transport-commits-to-running-75-driverless-trucks-with-kodiak/873446/)).
5. **`oem_platform`: OEM and platform cost-down.**
   - Western Star 49X: first deliveries to Atlas in Q3.
   - International LT: unsupervised from H2 2027.
   - Bosch: production hardware.
6. **`defense`: defense optionality.** USMC ROGUE-Fires work is episodic. The Q3 10-Q says "we do not currently have an effective contract with the U.S. Army".

## Materiality bases
- **Revenue base B: $11.9M** (front matter). B is below $25M, so the core **small-base rule** applies: a new, repeat or expanded named paying customer, contract or deployment scores ≥70 without a value (`floor:small_base`).
  - Q3 revenue was $2.969M, including about $0.5M of one-time defense revenue. It was down from about $3.5M in Q2. 9M revenue was $8.298M.
- **Dollar lines (core 4.2.1 on total contract value; note the annual run rate separately):**
  - Tiny: $0.119M.
  - p 1-3%: $0.12-0.36M.
  - p 3-10%: $0.36-1.19M.
  - Lead (p ≥10): $1.19M or more.
  - Most disclosed defense awards with a value will clear the lead line on p alone. A first award from a *new* U.S. military service or federal agency takes the core lead override. USMC and Army are not new.
- **Unit lines for DaaS deals.** These deals rarely carry a dollar value. This lift rests on `fleet_ramp` / `binding_fleet`, with an installed base of 37 trucks:
  - Binding commitment of 20 or more trucks (about 54% of the installed base, the unit analogue of p ≥10), or a new OEM platform: Lead, 90-95, `floor:lead_order`.
  - 5-19 trucks binding, or a named new customer lane: 72-85 (`floor:small_base`).
  - Quantified MOU or pilot with units: core 4.2.1 MOU column, judged on the same unit lines.
  - Pilot or MOU without units: core scope rule, 55-65 with a named counterparty and concrete adoption.
- **Mix and concentration (Q3 10-Q):** DaaS 70%, ground autonomy 17%, freight 13%. "Customer B" was 70% of Q3 revenue (56% in Q2). Reading Customer B as Atlas is an inference from the DaaS share; do not publish it as fact.
- **Liquidity:**
  - Cash plus marketable securities: $113.6M at 2026-09-30.
  - Free cash flow: Q3 -$38.0M; 9M -$111.1M; Q4 guide -$42M to -$44M.
  - FY2026 FCF guide: -$153M to -$155M, improved from -$155M to -$162M. The midpoint moved 2.8%, which is a guidance change: `floor:guidance` 80, not Lead.
  - $30M Horizon Technology Finance term loan: interest-only until 2028-07-01, maturity 2030-01-01 ([8-K 2025-12-31](https://www.sec.gov/Archives/edgar/data/1853138/000185313825000022/aur-20251231.htm)).
  - $10M second-lien loans (fair value $12.6M): maturity extended from 2026-10-01 to 2027-06-01.
  - $223.2M Series A preferred: the conversion price was cut from $12.00 to $6.00 with the May 2026 PIPE, a $46.1M deemed dividend. The 2025 PIPE and NRA warrants were reset to their $6.00 floor at the same time.
- **Capital: score by dilution d, never against cash (core 4.2.2).** Shares are 204.1M at about $1.04, about $0.21B of market cap. Worked lines:
  - d 5% ≈ 10.2M shares ≈ $10.6M.
  - d 10% ≈ 20.4M shares ≈ $21.2M: 78-88, `floor:capital_big`.
  - d 20% ≈ 40.8M shares ≈ $42.5M: 85-95.
  - Include full warrant exercise, and convert shares at the conversion price.
  - A further Series A conversion-price cut is graded on the *incremental* shares. At $223.2M, $6.00 is about 37.2M shares, so a cut to $3.00 adds about 37.2M shares (d ≈ 18%). Verify the convertible amount in the filing.
  - New ATM: capacity ÷ last price. Capacity ≥ about $42M (≥20% of market cap) is 75-85; smaller is 60-72.
  - Debt (core "≥25% of B or market cap"): any new principal of $3M or more clears 25% of B, so it is 75-85.
  - Core +5s apply: discount ≥15%, toxic terms (resets, equity lines, warrant repricing), named strategic investor.
  - Put d in `magnitude_pct_of_base` and flag `pct_is_dilution`. A financing that extends the runway past Q2 2027 also hits `resolves:financing_q2_27`, floor 80.

## Event ladder for this name
Core rungs and bands apply. Below: KDK examples and the places where a thesis driver lifts a rung.
- **Lead (90-100):**
  - `driver_out`: the IKEA driver-out highway service starts, or a slip past YE2026 is disclosed (`resolves:driver_out_ye26`). A slip ranks like the launch.
  - `binding_fleet`: a binding fleet deal of 20 or more trucks ([DTL 75 trucks, 2026-10-28](https://investors.kodiak.ai/news-releases/news-release-details/kodiak-ai-and-dtl-transport-reach-historic-agreement-deploy-75)).
  - `fleet_ramp`: a cut, pause or cancellation of the Atlas 100-truck plan. This uses core `key_loss`, mirrored at the size of the win, and Customer B was 70% of Q3 revenue.
  - Equity, convertible, PIPE or ATM raises, or preferred or warrant repricing, at **d ≥20%** (core 4.2.2). Example: [Q1 results plus a $100M PIPE at $6.50 with $6.00 warrants, 2026-05-07](https://www.sec.gov/Archives/edgar/data/1853138/000162828026032092/aur-20260507.htm). Raises with smaller d follow the dilution table, so they are not automatically Lead.
  - Default or acceleration (8-K 2.04, `floor:existence`); a delisting determination; M&A of the company (core `control`).
  - A serious crash involving a driverless Kodiak truck on a public road, or a disclosed NHTSA or FMCSA investigation (`floor:probe`): 80-95. The `driver_out` lift applies.
- **Digest (70-89):**
  - Same-day quarterly results (core `results`, floor 80, figures first): [Q3 2026, 2026-11-05](https://investors.kodiak.ai/news-releases/news-release-details/kodiak-ai-reports-third-quarter-2026-results-secures-landmark).
  - Equity raises at d 5-20%, and new debt (Materiality bases).
  - Nasdaq Item 3.01 deficiency notice: core 70-78, plus the +5 `liquidity` lift, so **75-83** (`floor:deficiency`; `resolves:nasdaq_bid`). Compliance regained: 55-65.
  - Reverse split (5.03): core 55-70, plus the +5 `liquidity` lift, so 60-75.
  - A change in going-concern language. The first appearance takes core `existence` (85). Removal, or a runway cut by a quarter or more, is 75-85. Unchanged language repeated in a later filing is a duplicate of that filing.
  - Launch-lane news: [Dallas-Houston named as the launch lane, 2026-09-25](https://investors.kodiak.ai/news-releases/news-release-details/kodiak-ai-names-dallas-houston-long-haul-driverless-launch-lane), with IKEA as the launch shipper.
  - A new named customer lane (small-base rule): [Charger Dallas-Laredo, 2026-10-08](https://investors.kodiak.ai/news-releases/news-release-details/kodiak-ai-and-charger-usa-launch-autonomous-trucking-between).
  - Atlas delivery tranches: 70-80, `group:deployment_wave_KDK` ([Western Star 49X, 2026-11-03](https://investors.kodiak.ai/news-releases/news-release-details/kodiak-ai-delivers-western-star-49x-trucks-atlas-energy)).
  - Final state regulator permits (core `regulator`, 75; the stage label stays literal): [California DMV drivered test permit, 2026-08-14](https://investors.kodiak.ai/news-releases/news-release-details/kodiak-ai-receives-dmv-permit-test-autonomous-trucks-california). This is drivered testing, not a deployment permit.
  - Defense awards: [USMC ROGUE-Fires, 2026-02-11](https://breakingdefense.com/2026/02/kodiak-ai-lands-marine-corps-deal-to-add-driverless-tech-to-rogue-fires-platform/). No value was disclosed, so it takes the core no-value default plus the small-base rule.
  - A new OEM platform: International LT, in the Q3 release of 2026-11-05. A binding OEM supply agreement lifts it to Lead.
  - CEO (Don Burnette), CFO (Surajit Datta) or COO (Michael Wiesinger) in or out: core `neo_ceo_cfo` / `neo`.
  - Earnings-date notice: fixed **75**, `group:earnings_calendar` ([Q3 date notice, 2026-10-15](https://investors.kodiak.ai/news-releases/news-release-details/kodiak-report-third-quarter-2026-financial-results-november-5)).
  - Investor or analyst day: core floor 85, because Kodiak has been listed ≤24 months (until 2027-09-24).
- **Borderline (40-69):**
  - ARM progress releases at a new percentage (93% on 2026-09-08, 96% on 2026-10-06, 99% on 2026-10-30): 60-68, `group:kdk_arm_progress`. ARM reaching 100% with a driver-out date is `driver_out` and takes the Lead row.
  - Named-counterparty collaborations with concrete integration but no volume (core scope rule): 55-65.
    - The GDLS strategic collaboration (2026-05-07): 58-62.
    - The Leonidas AGV unveil with Epirus and GDLS (2026-03-24, `product` with named partners): 60-65.
  - Supervised pilots with a named fleet: 55-65; a paid pilot +5 ([DTL California deliveries, 2026-09-24](https://investors.kodiak.ai/news-releases/news-release-details/kodiak-ai-and-dtl-transport-complete-first-autonomous-trucking): 60).
  - Supplier tie-ups that name a concrete integration in the Kodiak Driver production stack or in operations: 55-60. With units or a supply commitment, they go to `money` / `commitment` by the unit lines. Examples:
    - Stoneridge (2026-10-28).
    - [MicroVision lidar (2026-11-16)](https://investors.kodiak.ai/news-releases/news-release-details/microvision-lidar-powers-commercial-driverless-trucking-scale).
    - PrePass weigh-station bypass (2026-09-21).
  - Uptime record, 64 consecutive days (2026-10-20): 45-50.
  - Director changes: core 25-45.
- **Reject (<40):**
  - Generic cloud, compute or marketing collaborations: 25-39.
    - AWS (2026-10-01).
    - AMD (2026-08-26), unless the text shows a design win in Kodiak Driver hardware, which scores 55-60.
  - The Chief People Officer hire, Lorie Boyd (2026-11-02): 30.
  - The statement on the BUILD America 250 Act (2026-05-18): 30-35, `commentary`. Enactment of the bill would go through core §9.3 only if the law names Kodiak or covers its trucks.
  - Executive pay changes (5.02, compensation only), such as the [2026-07-02 raises and RSUs](https://www.sec.gov/Archives/edgar/data/1853138/000162828026046850/kdk-20260701.htm): core pay plans, <25.
  - Form 4 sell-to-cover, for example the [CFO, 89,440 shares at $1.043 on 2026-11-13, filed 2026-11-17](https://www.sec.gov/Archives/edgar/data/1853138/000162828026074596/). Read the code:
    - F, A, M, G or J: 0-10, not an item.
    - S marked as automatic sell-to-cover or 10b5-1: 15-35.
    - A discretionary (non-10b5-1) S by the CEO, CFO or COO of 10% or more of holdings: core 55-75.
  - The Industry Advisory Council (2026-04-23), Inc. Best Workplaces (2026-06-02) and conference attendance: `reason:promotional`, 0-20.
  - IR bio or analyst pages, and 424B3 resale re-wraps: see Noise patterns.

## Always surface (floors)
**Core floors that commonly fire for KDK** (values in core §6; not restated):
- `results` (8-K 2.02 and first-record 10-Q/10-K figures).
- `guidance`.
- `calendar` (75 fixed).
- `neo_ceo_cfo`, `neo`.
- `deficiency` (3.01, NT 10-Q/10-K).
- `existence` (1.03, 4.02, 2.04, first going concern, delisting determination).
- `capital_big` (d ≥10% or discount ≥15%).
- `small_base`.
- `lead_order`.
- `regulator`.
- `key_loss`.
- `investor_day`.
- `open_item`.

**8-K Items 1.01, 2.03 and 3.02 are not floored as a class.** Grade them on content:
- A financing 1.01, 2.03 or 3.02 (equity, PIPE, convert, ATM, preferred or warrant repricing, debt) takes the computed d or principal under core 4.2.2: 85-95 only at d ≥20%, 78-88 at d 10-20%.
- A customer, OEM or supplier 1.01 takes core 4.2.1, the unit lines, or the core scope rule.
- A small 3.02 for consultant or settlement shares is <25.

**KDK-specific floors** (each rests on a thesis driver):
| Floor | Identifier | Basis |
|---|---|---|
| 90 | IKEA Supply driver-out launch, or a disclosed slip past 2026 | `driver_out`; `resolves:driver_out_ye26` |
| 90 | Binding commitment of 20 or more trucks, or a new OEM platform | `binding_fleet` / `oem_platform`; unit analogue of p ≥10 |
| 80 | Financing that extends the runway past Q2 2027 | `liquidity`; `resolves:financing_q2_27` |
| 75 | Change to DTL schedule or scope | `binding_fleet` |
| 75 | ROGUE-Fires follow-on, or any Army or USMC award naming "Kodiak Robotics" or Kodiak AI | `defense` |
| 70 | Atlas or Fountainhead truck counts or plan changes. Atlas's own release or filing is an official customer record (core §9.2). An Atlas call statement is `mgmt_claim` (-15, cap 75) | `fleet_ramp` |

## Noise patterns
These come from the news-monitor feed (source keys `kodiak` and `edgar_kdk`).
- **IR RSS scrapes non-news pages:** score them 0-5, `reason:source_quality`, `source_repair`.
  - Analyst roster pages: "Christopher Pierce" and "Ravi Shanker" (2026-09-15), "Colin Rusch" (2026-08-25), "Ryan Sigdahl".
  - Bio pages: "Lorie Boyd" (2026-11-03).
- **edgar_kdk resale 424B3s:** a pair (files 333-290832 and 333-296358) re-wraps each 10-Q or 8-K, for example on 2026-11-06, 2026-08-07, 2026-07-02 and 2026-06-15. They carry no new terms, so score them 5-10, `reason:already_covered`, citing the 10-Q or 8-K item.
- **Archive bursts (core §8):** gate each item on its event date. Items older than 21 days score 0-9, `reason:stale`, `archive_burst`, `source_repair`.
  - About 40 edgar_kdk items dated 2025-08-29 to 2026-08-07 were all first seen 2026-08-31.
  - About 10 kodiak items dated April-June 2026 were first seen 2026-07-09.
- **Bare form titles:** "Kodiak AI, Inc.: 8-K filed 2026-11-05" is the same event as the same-day IR results release. The release is canonical; the 8-K is `dup_of` it unless it adds figures.
- **Vendor-originated releases** hosted on Kodiak IR (MicroVision, Stoneridge, PrePass, AWS, AMD): grade them on the core scope rule as in the ladder (55-60 for concrete integration, 25-39 for generic). Units or a supply commitment move them to the unit lines.
- **ARM drumbeat:** about one release a month. Each is an update only if it gives a new percentage. A restatement with no new figure is <40, `reason:already_covered`.
- **Recaps:** results recaps and guidance retellings follow core §7 `late_repost` timing (24h for results, 72h for guidance).

## Catalyst calendar
Context for freshness and `open_items`. A date here is not an item.
| Date | Event |
|---|---|
| By 2026-12-31 | Driver-out IKEA service on I-45 (`driver_out_ye26`); Atlas fleet to the mid-40s (`atlas_mid40s`) |
| 2026-12-16 | Northland Growth Conference (virtual; promotional, 0-20) |
| Any time | Financing (`financing_q2_27`). The CFO said it is not the right time to tap equity markets; equipment or customer-financed hardware and strategic investment are under review |
| Possible | Nasdaq $1 bid-price notice after 30 consecutive business days below $1 (`nasdaq_bid`). No Item 3.01 8-K was on EDGAR as of 2026-11-18 |
| About Feb 2027 | Q4 date notice (75, `earnings_calendar`) |
| About Mar 2027 | FY2026 results and 10-K; watch the going-concern language |
| Early 2027 | Atlas fleet on public roads ([FreightWaves, 2026-09-29](https://www.freightwaves.com/news/kodiak-ikea-driverless-freight-i-45)) |
| By 2027-06-01 | $10M second-lien maturity (`second_lien_jun27`) |
| End of H1 2027 | Atlas 100-truck commitment complete (`atlas_100_h1_27`) |
| Q2 2027 | Stated runway end |
| H2 2027 | First unsupervised International LT deployments |
| Exit 2027 | 200 trucks and more than $50M ARR |
| 2027-09-24 | End of the "listed ≤24 months" window for the investor-day floor |
| 2028 | DTL service start |
| Pending | FY2027 appropriation for ROGUE-Fires autonomy kits. FY2026 was $59M for the program, not Kodiak-specific. Context only: grade it under core §9.3 only if the line names Kodiak or its kits |

## Customers, programs, agencies & counterparties
| Counterparty | Role | Disclosure | `big` |
|---|---|---|---|
| Atlas Energy Solutions / Fountainhead (AESI) | Largest customer; Permian sand hauling; 100-truck commitment | release; AESI filings and calls | yes (Customer B 70% of Q3 revenue, inferred) |
| IKEA Supply | Launch shipper; Baytown to Frisco route, with the driver-out leg on I-45 | release | unknown |
| DTL Transport | 75-truck binding agreement. Initial lanes are I-10 Dallas-El Paso and I-20 Dallas-Atlanta. The Fresno-Los Angeles pilot ran in September 2026 | release | no (service 2028) |
| Charger USA | Freight customer, Dallas-Laredo | release | unknown |
| Roehl Transport | Freight customer since 2026-05-07 | release | unknown |
| West Fraser | Alberta logging trial completed in Q3 2026. A paid fleet would be Digest (small-base) | release | no |
| USMC ROGUE-Fires | NMESIS on the Oshkosh JLTV; episodic defense revenue | press, filings | no (~$0.5M one-time in Q3) |
| GDLS, Epirus | Defense collaboration; Leonidas AGV | release, blog | no |
| Roush | Upfitting plus remote monitoring and assistance | filing_only (10-Q) | n/a supplier |
| Bosch; Daimler Truck NA / Western Star; International | Production hardware and OEM platforms | release | n/a supplier |
| FMCSA, NHTSA (Standing General Order crash reports), Texas DMV, California DMV | Regulators | official records | n/a |

- **Boilerplate only:** Werner, Bridgestone and C.R. England appear in the standard boilerplate. They are not news.

## Competitors & read-through
Core §9 governs. A competitor item counts for KDK only when one of these holds:
- The source names Kodiak, Kodiak Robotics or a Kodiak product.
- A sheet customer acts on autonomous trucking: Atlas, IKEA Supply, DTL, Charger, Roehl or West Fraser buying, pausing, cancelling or replacing.
- A regulator decision names Kodiak or covers its trucks.
- A rival wins in a sheet program.

Everything else is `out_of_scope` for KDK (0-15). Published `why` and `note_hook` state the sourced facts only and name Kodiak only if the source does. The names to watch:
- **Aurora (AUR, also covered):** runs driverless on Dallas-Houston. Aurora crashes, permits or pace milestones are AUR items. They are not KDK items unless Kodiak is named.
- **Forterra:** the Marines funded its AutoDrive for ROGUE-Fires (about $30M, per Breaking Defense). A Forterra award in ROGUE-Fires autonomy is §9.4: 50-69 for KDK as a possible loss. If replacement of Kodiak is confirmed, it is `money` bad news, 70 or higher.
- **Torc/Daimler, Waabi/Volvo, Bot Auto:** compete in Texas. A rival announcing a lane with a sheet customer is §9.4. Daimler acting on Western Star supply to Kodiak is §9.2.
- **Peer terms in news-monitor `coverage.js`** (waabi, einride, gatik, torc robotics, bot auto, "virtual driver"): these matches are not KDK items. "Bot Auto" is also never BOT.

## Source coverage gaps
Collector and polling notes are in `sources/KDK.md` (worker doc). For grading:
- **Forms that never arrive:** `edgar_kdk` does not carry Forms 3, 4 or 144 or SCHEDULE 13G/A. Missing insider or holder forms, or a missing expected 8-K, are never `insufficient_evidence`.
  - The 2026-11-16 Form 144, the 2026-11-17 CFO Form 4, and the 13G/As of 2026-11-13 and 2026-11-16 were confirmed on EDGAR but not in the feed.
  - If such forms arrive late through a worker backfill, gate them on the filing date (core §8).
- **Atlas truck counts:** these may arrive first from AESI releases or filings. Those count as the first record of the event (floor 70 above), and a later Kodiak release is an update only if it adds a number.
- **kodiak.ai/news blog items** (for example [Leonidas AGV](https://kodiak.ai/news/kodiak-epirus-gdls-autonomous-counter-uas-vehicle), the ROGUE-Fires demo at Fort Hunter Liggett) are company releases for canonical choice, ranked equal to IR.

## Grader notes
- **GAAP swings from warrants:** Q3 GAAP net income of $27.4M comes from a $78.2M non-cash gain on warrant fair value. The operating loss was $50.4M. Never headline "profit".
- **Revenue quality:** underlying DaaS revenue was roughly flat quarter on quarter, and total revenue fell from about $3.5M to $3.0M. Q3 included about $0.5M of one-time defense revenue; label it that way.
- **Duplicates:** the IR release, the 8-K EX-99.1 and syndicated copies are one event. The IR release is canonical. The 8-K is a duplicate unless it adds figures.
- **10-Q a day after the release:** the 10-Q is a duplicate unless it adds backlog, a 10% customer share (Customer B), going-concern language, subsequent events or a share count. If it does, it is graded as an update on the increment (core §5).
- **Status words:**
  - "Binding definitive agreement" (DTL) is a commitment, not revenue.
  - "Selected", "collaboration" and "targeted" are not orders.
  - "Unsupervised" does not mean "launched".
  - Industrial (off-road Permian) driverless operation is not long-haul highway operation.
  - The California permit is drivered testing only.
- **Insider Form 4s:** read the transaction code and footnote. Automatic sell-to-cover for RSU tax is not a signal (see the ladder).
- **Stale in old profiles:**
  - Q2 figures: 35 trucks, ARM 91%, Customer B at 56% of revenue.
  - "West Fraser not started": the trial is complete.
  - "Army contract still effective": the Q2 10-Q said so, but the Q3 10-Q says there is no effective Army contract.
  - Share count of 196.4M: it is now 204.1M.
  - The old "almost any equity raise is Lead" rule and blanket 85 floors on 8-K 1.01, 2.03, 3.01 and 3.02 are replaced by the d-based lines above.
- **Stale sheet:** after the FY2026 10-K (about March 2027), or if a primary item contradicts the front matter, grade on the item, flag `sheet_stale` and `needs_owner`, and keep B = $11.9M until the owner approves a new base (core §12).
- **Verification gap:** the web search budget ran out while this sheet was being revised. Only the EDGAR submissions feed was re-checked on 2026-11-18 (no 8-K after 2026-11-05; Forms 4, 144 and 13G/A as listed). All other facts are carried from the 2026-11-18 research pass.
