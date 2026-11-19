---
ticker: PL
name: Planet Labs PBC
as_of: 2026-11-18
asset_class: operating
filer: domestic (10-K / 10-Q / 8-K); CIK 0001836833; fiscal year ends Jan 31 (Q3 FY2027 ended 2026-10-31)
source_keys: [planet, edgar_pl]
fx_as_of: 2026-11-17   # ECB reference EUR/USD 1.0989; convert each deal at its event-date rate
base_usd: 435500000
base_basis: "FY27 revenue guidance midpoint ($430-441M), 8-K Ex.99.1 2026-09-03; refresh after 2026-12-10 print on owner approval"
alt_base: false        # FY26 revenue $307.7M for reference only
tiny_usd: 2180000      # 0.5% of B (B > $100M)
one_pct_usd: 4360000
three_pct_usd: 13070000
lead_usd: 43550000     # 10% of B
shares_basic: 363847989   # 340,354,193 Class A + 23,493,796 Class B, 10-Q cover as of 2026-08-27
market_cap_usd: 4380000000 # ~$4.38B at $12.05 close 2026-11-18 (stockanalysis.com, companiesmarketcap.com); refresh before capital math
terms: ["Planet Labs", "Planet Labs PBC", "Planet Labs Federal", "Planet Labs Germany", "Sinergise", "Sentinel Hub", "PlanetScope", "SuperDove", "SkySat", "Pelican", "Tanager", "Global Monitoring Service", "Planetary Variables", "Project Suncatcher"]
aliases: ["Planet", "NYSE: PL", "$PL", "dMY Technology Group IV", "Terra Bella"]
traps:
  - {term: "Planet", case: sensitive, rule: "only with satellite/imagery/orbit context or a product term; reject Planet Fitness, Lonely Planet, Animal Planet, Planet 13, Planet Hollywood"}
  - {term: "PL", case: sensitive, rule: "ticker only as $PL or NYSE: PL; reject Poland, Premier League, PL/SQL, Robinhood 'PL' crypto token (I-0003)"}
  - {term: "Dove", case: sensitive, rule: "satellite context only; reject Unilever Dove"}
  - {term: "Pelican", case: sensitive, rule: "satellite context only; reject Pelican Products"}
  - {term: "Owl", case: sensitive, rule: "satellite context plus 'Planet' only; unconfirmed in 2026 SEC filings"}
  - {term: "Bedrock", case: sensitive, rule: "Planet context only; reject Amazon Bedrock, Bedrock Robotics"}
  - {term: "Sentinel", case: insensitive, rule: "match 'Sentinel Hub' only; reject ESA Sentinel missions, SentinelOne"}
  - {term: "Luno", case: sensitive, rule: "NGA Luno program only; reject Luno crypto exchange"}
  - {term: "Image: Planet Labs", case: insensitive, rule: "photo credit; reject"}
  - {term: "Merlin", case: sensitive, rule: "never PL; MRLN (covered) or Satellogic program; see core §1 collision table"}
thesis_drivers: [sovereign_capacity, backlog_rpo, fy27_guidance, us_defense_intel, constellation_cadence, suncatcher]
open_items:
  - {id: q3_fy27_print, text: "Q3 FY27 revenue vs $101-105M guide; backlog/RPO refill vs $814.9M/$753.1M", expires_at: 2026-12-11}
  - {id: berlin_first_pelican, text: "Company target: first Berlin-built Pelican completed by end of 2026 (completion or slip)", expires_at: 2027-01-31}
group_keys: [earnings_calendar, pl_launches]
status_events:
  - {date: 2021-12, event: "de-SPAC with dMY Technology Group IV closed"}
  - {date: 2023-08, event: "Sinergise acquisition closed"}
  - {date: 2025-11, event: "Bedrock asset purchase closed (10-Q)"}
  - {date: 2026-04-27, event: "public warrants redeemed; warrant 25-NSE (not common stock)"}
  - {pending: none}
---

# PL — Planet Labs PBC

_Researched 2026-11-18. Facts checked against SEC EDGAR (submissions feed, 10-Q filed 2026-09-03), investors.planet.com and news-monitor-db the same day. No new 8-K since the 2026-09-03 Item 2.02. Share count is from the 10-Q cover. Price and market cap are from third-party quotes for the 2026-11-18 close. FX is the ECB reference rate, read via frankfurter.dev. NYSE: PL. Formerly dMY Technology Group, Inc. IV (SPAC). Q3 FY2027 results come **Thursday 2026-12-10 after market close**, with the call at 5:00 p.m. ET, per the company's 2026-11-10 release ([IR](https://investors.planet.com/news/news-details/2026/Planet-to-Announce-Fiscal-Third-Quarter-2027-Results-on-Thursday-December-10-2026/default.aspx)). The company's date beats third-party calendars. Bands, floors and modifiers come from core v3.0. This sheet adds only PL facts, examples and marked thesis lifts._

## Identity & matching
- **Legal entities:**
  - Planet Labs PBC.
  - Planet Labs Federal: the U.S. government contracting subsidiary. It holds the facility clearance and signed the NASA CSDA Tanager order of 2026-10-21.
  - Planet Labs Germany GmbH (Berlin): signs the German deals and opened the Pelican factory on 2026-09-22.
  - Planet Labs GmbH: owns Sinergise Solutions d.o.o. (Sentinel Hub; acquired 2023-08).
  - Bedrock assets: bought in an asset purchase in 2025-11 (10-Q).
  - Terra Bella: bought from Google in 2017, the origin of SkySat.
- **Products to match:**
  - PlanetScope and SuperDove (Flock 4J); SkySat; Pelican; Tanager (Tanager-1, Tanager-2).
  - Global Monitoring Service (GMS); Planetary Variables; the Planet AI app (open beta); Amazon.ia.
  - Google Project Suncatcher (Planet built the demo satellite).
  - Owl is a reported next-generation satellite. No 2026 SEC filing confirms it.
- **Context guards and collisions:** these are the `traps` in the front matter, and the case rules there are binding. Before scoring, check any match against the core §1 collision table.
- **Satellogic (SATL)** has its own sheet. A shared-rideshare item counts for PL only on its Planet content. Transporter-18 on 2026-10-01 carried satellites from both companies.

## What the stock trades on
Thesis drivers (`thesis_drivers_hit` ids):
1. **`sovereign_capacity`:** sovereign "satellite services" wins and handovers (JSAT, Germany, Sweden). The Swedish Armed Forces satellite handover drove Q2 FY27 revenue, and this revenue is lumpy.
2. **`backlog_rpo`:** whether backlog and RPO refill.
   - Backlog: $906.1M at Q1 (2026-04-30), $814.9M at Q2 (2026-07-31), down 10.1%.
   - RPO: $816.0M, then $753.1M, down 7.7%.
   - Refill is the open question for 2026-12-10 (`q3_fy27_print`).
3. **`fy27_guidance`:**
   - FY27 revenue $430–441M; the low end was raised from $425M at Q1, so the midpoint rose 0.6%.
   - Q3 revenue $101–105M, against $116.1M in Q2.
   - Q3 adjusted EBITDA $(6) to $(1)M; FY27 adjusted EBITDA $3–10M.
4. **`us_defense_intel`:** U.S. defense and intelligence awards. NGA (Luno B, GMS), Navy vessel tracking, NRO EOCL, NASA CSDA, and MDA SHIELD, where Planet is one of the IDIQ awardees.
5. **`constellation_cadence`:**
   - The Q2 release counted 10 high-resolution Pelicans on orbit after Pelican-11.
   - Pelican-12, launched 2026-10-20, was the fifth Pelican of 2026.
   - Also tracked: Berlin output (`berlin_first_pelican`) and launch slots with SpaceX, Isar and Stoke.
6. **`suncatcher`:** the first Google Suncatcher demo satellite launched 2026-10-01. A follow-on order moves this driver.

## Materiality bases
- **Revenue base B = $435.5M**, the FY27 guidance midpoint ([8-K Ex.99.1, 2026-09-03](https://www.sec.gov/Archives/edgar/data/1836833/000119312526381874/pl-ex99_1.htm)). Keep it until the owner approves a refresh after the 2026-12-10 print. FY26 revenue was $307.7M.
- **Order thresholds:** use the core 4.2.1 p-table on total contract value (or obligated value), with the annual run rate noted in `why`. p = V ÷ $435.5M × 100.

  | V (USD) | p | Binding | `selected` / `pre_award` | Quantified `mou` / `pilot` |
  |---|---|---|---|---|
  | ≥ $43.55M | ≥10 | 90–97 | 88–94 | 78–85 |
  | $13.07M – $43.55M | 3–10 | 80–89 | 80–88 | 70–78 |
  | $4.36M – $13.07M | 1–3 | 72–80 | 72–80 | 64–72 |
  | $2.18M – $4.36M | tiny–1 | 70–74 | 70–74 | 60–64 |
  | < $2.18M | < tiny | 25–39 (55–65 for a first customer, new country or first production-scale buy) | same | same |

  - **Lead override (floor 90 when V ≥ $2.18M):** the first order from a new foreign government, U.S. military service or U.S. federal agency, or the first production-scale order of a product (for example, a Suncatcher constellation order).
  - A new agency of an existing sovereign customer gets only +5 novelty (for example, German BMI after the €240M German deal).
  - "New service line" is not an override.
- **Unstated deal sizes** (a missing figure is never a discount):
  - "7-figure" ($1–9.9M) cannot be proven above tiny. A binding order with a named counterparty takes the core default of 70–74. An unnamed counterparty scores 62–68. Flag `needs_owner` if a lead override would hinge on it.
  - "8-figure" ($10–99.9M, p 2.3–23) scores at least 72–80, and 80–89 when the text supports ≥$13.07M.
  - "9-figure" (≥$100M, p ≥23) is Lead, 90–97.
  - Never write an invented dollar figure in `why`.
- **Q2 FY27 (quarter ended 2026-07-31):**
  - Revenue $116.1M (+58%).
  - RPO $753.1M (46% due in 12 months); backlog $814.9M (50% due in 12 months).
  - Cash plus short-term investments $865.4M.
  - FY27 capex guidance $100–115M; recurring ACV 98%.
  - Customer concentration (10-Q): three unnamed customers were 17%, 11% and 10% of Q2 revenue.
- **Capital structure:** dilution is judged by core 4.2.2 against **363,847,989 basic shares**, never against the $865.4M of cash.
  - **Convertible:** $460.0M of 0.50% convertible senior notes due 2030-10-15, issued 2025-09-12.
    - Conversion rate 83.6715 shares per $1,000, a price of about $11.95. That is 38.49M shares if fully converted, 10.6% of basic.
    - Capped calls cost $39.6M (10-Q).
    - The stock closed at $12.05 on 2026-11-18, just above the conversion price. Any induced conversion, exchange or settlement election is a `capital` item graded by d.
  - **ATM:** a $1.5B equity distribution agreement dated 2026-06-05, with a forward-sale option. It was filed as 8-K 1.01, S-3ASR and 424B5 the same day.
    - Q2 usage: 3,782,460 shares, $122.4M gross, about $120.9M net ($31.95 per share net). d = 1.0%.
    - Remaining capacity at 2026-07-31 was about $1.378B; Q3 usage is unknown. At $12.05 that is about 114M shares, d of about 31%.
    - Grade a new program by capacity ÷ market cap at the event date (≥20% scores 75–85). Grade a usage disclosure by d of the shares sold.
  - **Warrants:** public warrants were redeemed and suspended from NYSE trading on 2026-04-27. Exercises brought in about $104.5M, per the completion release of 2026-05-04 ([IR](https://investors.planet.com/news/news-details/2026/Planet-Announces-Completion-of-Redemption-of-Public-Warrants/default.aspx)).
- **Euro deals:** convert at the ECB rate on the event date and state the rate in `why`. Reference rates: 2025-07-01 = 1.1810; 2026-09-15 = 1.1539; 2026-11-17 = 1.0989.

## Event ladder for this name
The rung, status, floors and modifiers follow core §3–6. Scores below are worked PL examples.

**Lead (90–100)**
- Sovereign or dedicated-capacity contracts ≥$43.55M:
  - "Planet Signs 9-Figure Deal with Sweden": Swedish Armed Forces, multi-year, low nine figures; also names JSAT. 2026-01-12 ([8-K 7.01 Ex.99.1](https://www.sec.gov/Archives/edgar/data/1836833/000119312526009922/pl-ex99_1.htm)). p ≥23 plus the first order from a new foreign government: about 94.
  - "Planet Awarded €240 Million Satellite Services Deal" (Germany), 2025-07-01 ([8-K Ex.99.1](https://www.sec.gov/Archives/edgar/data/1836833/000183683325000075/exhibit991projectchronospr.htm)). That is $283.4M at 1.1810, p = 65.1: about 95.
- Results with a guidance change of ≥10% at the midpoint, a revenue miss of ≥20% against guidance, going concern or non-reliance.
- A Suncatcher follow-on order (`suncatcher`, first production-scale order): floor 90 when V ≥ tiny.
- An NRO EOCL renewal ≥$43.55M, or a loss of EOCL. A loss mirrors a win at the original size (`key_loss`).
- Planet as a buyout target: `control`, 90+.
- A priced raise or convert with d ≥20%: 85–95.
- A launch failure that destroys two or more Pelicans or a Tanager: 85–92. This is a sheet thesis lift on `constellation_cadence`.

**Digest (70–89)**
- **Same-day results with figures:** floor 80. Lead them with figures: revenue against guide and prior period, backlog, RPO, guide.
  - Example: "Planet Reports Financial Results for Second Quarter of Fiscal Year 2027", 2026-09-03 ([8-K Ex.99.1](https://www.sec.gov/Archives/edgar/data/1836833/000119312526381874/pl-ex99_1.htm)).
  - Revenue was $116.1M (+58%), the FY guide midpoint rose 0.6%, and backlog fell 10.1% (`backlog_rpo`): about 86.
- **Contracts at p 1–10 ($4.36–43.55M):**
  - "Planet Awarded Landmark German Federal Contract for Exclusive Access to Dedicated Satellite Constellation", 2026-09-15 ([IR](https://investors.planet.com/news/news-details/2026/Planet-Awarded-Landmark-German-Federal-Contract-for-Exclusive-Access-to-Dedicated-Satellite-Constellation/default.aspx)). BMI tender, distributed by BKG, up to €25M over 5 years including options. That is about $28.85M at 1.1539, p = 6.6, `ceiling_only`, plus +5 for a new German agency: about 82.
  - "Planet Secures 8-Figure NGA Contract Extension for Maritime Surveillance...", 2026-06-04 ([IR](https://investors.planet.com/news/news-details/2026/Planet-Secures-8-Figure-NGA-Contract-Extension-for-Maritime-Surveillance-and-New-Award-for-Crisis-Response-Monitoring/default.aspx)). Luno B AAMOR option year at $21.9M (p = 5.0), plus an unvalued GMS award with DIU: about 82.
  - NGA GMS OTA of $8M (August 2026, in the Q2 release). p = 1.8: about 75.
  - U.S. Navy six-month renewal of $7.5M (Q1 FY27). p = 1.7: about 74.
- **Contracts at tiny–1% ($2.18–4.36M)**, binding with a named counterparty: 70–74.
- **7-figure named government buyers:** 70–74. Example: the Czech government, 2026-05-13.
- **Capital:**
  - A new ATM with capacity ≥20% of event-date market cap: 75–85.
  - A priced convert or follow-on with d 5–20%: 70–88 by core 4.2.2. The 2025-09-12 $460M convert was d = 10.6%: about 80.
- **People:**
  - CEO Will Marshall (Co-Founder, CEO and Chair), or Ashley Johnson (President and CFO), in or out: 75–88, plus 5–10 if abrupt.
  - Other named executive officers: 70–85.
- **Proof:**
  - Satellites commissioned or declared in service (Pelican, Tanager): 65–75 with `constellation_cadence`.
  - "Planet Opens State-of-the-Art Satellite Manufacturing in Berlin", up to 60 satellites a year, 2026-09-22: about 70.
  - Completion or slip of the first Berlin-built Pelican: floor 80, `resolves:berlin_first_pelican`, until 2027-01-31.
- **Own acquisition,** signed or closed: 75–88.
- **Earnings-date notice:** fixed at 72, `group:earnings_calendar`. Example: the 2026-11-10 release.

**Borderline (40–69)**
- "Planet Signs 7-Figure Agreement with European Defense and Intelligence Customer", one year, unnamed, 2026-09-03 ([IR](https://investors.planet.com/news/news-details/2026/Planet-Signs-7-Figure-Agreement-with-European-Defense-and-Intelligence-Customer/default.aspx)). The counterparty is unnamed and the value is not provably above tiny: about 65.
- Paid evaluation or pilot orders with a named counterparty and no volume (core scope rule, 55–65, +5 if paid):
  - "Planet Awarded NASA Commercial Satellite Data Acquisition (CSDA) Evaluation Task Order for Tanager Hyperspectral Data", 2026-10-21 ([IR](https://investors.planet.com/news/news-details/2026/Planet-Awarded-NASA-Commercial-Satellite-Data-Acquisition-CSDA-Evaluation-Task-Order-for-Tanager-Hyperspectral-Data/default.aspx)): about 62.
  - "Planet Selected by European Space Agency to Build Slovenia's Space Resilience Node" (Sinergise, 12-month pilot), 2026-10-13 ([IR](https://investors.planet.com/news/news-details/2026/Planet-Selected-by-European-Space-Agency-to-Build-Slovenias-Space-Resilience-Node/default.aspx)): about 60.
- "Planet and Stoke Space Sign Multi-Launch Agreement for Nova Launch Capabilities", 2026-11-09 ([IR](https://investors.planet.com/news/news-details/2026/Planet-and-Stoke-Space-Sign-Multi-Launch-Agreement-for-Nova-Launch-Capabilities/default.aspx)). Named supplier, no count or value, Nova demonstrations begin 2027: about 57.
- Launch releases (`proof`, `group:pl_launches`): 60–65. Write "launched", not "in service".
  - "Planet Launches Pelican-12 Satellite" (Bandwagon-5), 2026-10-20: about 62.
  - "Planet Launches Suncatcher, Tanager-2, and 18 SuperDove Satellites" (Transporter-18), 2026-10-01. The `suncatcher` driver adds 5: about 68.
- First light (`group:pl_launches`). Example: "Planet Releases First Light from Pelican-12", 2026-11-04 ([IR](https://investors.planet.com/news/news-details/2026/Planet-Releases-First-Light-from-Pelican-12/default.aspx)): about 50.
- ATM usage disclosures with d <5%: 55–65. Example: Q2 usage, d = 1.0%.
- Non-flagship product launches with no paying customer: 40–50. Examples: "Planet Announces Amazon.ia...", 2026-09-23; the Planet AI app open beta.
- 10-Q items: an update at 60–85 when they add a new 10% customer, an RPO schedule change, subsequent events or a share-count change (core §5). Otherwise they duplicate the results release.
- A shelf with no takedown: 40–55.

**Reject (<40)**
- Ship-to-launch-site and arrival notices: 20–30, `group:pl_launches`.
- Conference talks, blogs and awards (for example, the John Deere award of 2026-05-27): 0–20, `reason:promotional`.
- Routine proxy material and AGM votes: DEF 14A, DEFA14A, routine 8-K 5.07. Score 10–25.
- The warrant 25-NSE: about 10.
- Mechanical SPAC earnout-share 8-Ks (Items 3.02, 3.03 and 8.01; Class B earnout shares under the 2021 merger agreement, no proceeds): 15–25.
- Contract vehicles with no funded task order naming Planet (SHIELD IDIQ awardee lists, Golden Dome vehicles): 25–39.
- Forms 4 and 144 follow core §5:
  - Open-market codes P and S only.
  - 10b5-1 sales: 15–35. Non-10b5-1 sales by the CEO or CFO of ≥10% of holdings: 55–75.
  - Form 144: <20, or 30–45 if the CEO or a founder is selling ≥5% of holdings.
  - Codes A, M, F, G and J are not items.

## Always surface (floors)
Core §6 floors apply as written. Cite them by id: `results` 80, `guidance` 80, `calendar` 72, `neo_ceo_cfo` 75, `neo` 70, `order` 70, `capital_big` 75, `deal_signed` 75, `key_loss` 70, `open_item` 80. Do not restate core bands here. PL-specific lines:
- **Key accounts (core §9.2 and `key_loss`):**
  - The accounts: SKY Perfect JSAT; German BMI, BKG or Bundeswehr; the Swedish Armed Forces or FMV; NRO EOCL; NGA (Luno, GMS); the U.S. Navy; Google Suncatcher.
  - A binding purchase, renewal, expansion, pause, cancellation or budget vote by one of them on Planet's category counts, even when only the customer announces it.
  - A binding order ≥ tiny scores floor 70 (`order`). A loss or cancellation scores floor 70 (`key_loss`).
  - A co-mention without an action is not an item.
- **Launch failure or anomaly** on a vehicle carrying Pelican or Tanager: floor 75. This is a sheet thesis lift on `constellation_cadence`. Loss of two or more Pelicans or a Tanager is in the Lead ladder.
- **Earnings-date notice:** fixed at 72, `group:earnings_calendar`.

## Noise patterns
From 2026-08-20 to 2026-11-18 the news-monitor feed holds 15 `planet` releases and 42 `edgar_pl` rows, all notified=1.
- **EDGAR archive burst:**
  - 40 `edgar_pl` filings dated 2024-06-26 to 2026-07-10, all first seen 2026-08-31T21:21. Examples: "8-K filed 2024-06-26", "10-K filed 2025-03-26".
  - Score 0–9 with `reason:stale` and flags `archive_burst` and `source_repair`. Gate each row on its own event date.
- **Bare receipts:**
  - "Planet Labs PBC: 8-K filed 2026-09-03" (seen 20:10) and "10-Q filed 2026-09-03" (seen 20:54) carry no item numbers. They arrived minutes after the 20:05 results release.
  - Score null, `reason:duplicate`, `dup_of` the release, unless the 10-Q adds facts (see the Borderline ladder).
- **Logistics releases:** 20–30.
  - "Planet's Pelican-12 Satellite Arrives at Launch Site" (2026-09-25).
  - "Planet Ships Tanager-2 and 18 SuperDoves to Launch Site" (2026-08-31).
  - The "CORRECTING and REPLACING PHOTO" copy of the arrival release is a typo-level correction: score null, `reason:duplicate`.
- **Misread 25-NSE:** "25-NSE filed 2026-04-27" delisted the **public warrants**, not the common stock. Score about 10.
- **Proxy filings:** DEF 14A (2026-05-27) and DEFA14A (2026-05-29) score 15–25.
- **Feed gap:** the feed carries no Form 4 or 144. EDGAR shows 144s on 2026-09-17 (two), 10-01, 10-13 and 10-15, and Form 4s on 09-17 (three), 09-18, 10-02, 10-14, 10-16 and 11-06. If they are added, score them by the Form 4 and 144 rules in the Reject ladder.

## Catalyst calendar
- **2026-12-10, after the close:** Q3 FY27 results (quarter ended 2026-10-31), `resolves:q3_fy27_print`. Watch revenue against the $101–105M guide, backlog and RPO against $814.9M and $753.1M, and the FY27 guide. Refresh B after the print, on owner approval.
- **Commissioning:** Pelican-12 (first light 2026-11-04) and Tanager-2 calibration.
- **End of 2026:** first Berlin-built Pelican completed (`berlin_first_pelican`, expires 2027-01-31).
- **Early 2027:** that Pelican launches on Isar Spectrum. Stoke Nova missions follow the Nova demonstrations that start in 2027.
- **About 2027-03:** Q4 and FY27 results with the FY28 guide (last year's came 2026-03-19), and the FY27 10-K (last year's was filed 2026-03-23).
- **About 2027-06:** Q1 FY28 results (last year's came 2026-06-04).
- **About 2027-07:** annual meeting (last year's was 2026-07-09).
- **Ongoing:** further JSAT, Sweden and German Pelican deliveries, which set the timing of handover revenue.
- **Navy six-month renewals:** timing unknown. The last disclosed renewal was in Q1 FY27.
- **Context only, never an item:** the stock trades near the $11.95 convert conversion price ($12.05 on 2026-11-18).

## Customers, programs, agencies & counterparties
Concentration: three unnamed customers were 17%, 11% and 10% of Q2 FY27 revenue (10-Q). The 10-Q does not name them, so do not assign `big` by guess.

| Counterparty | Program / value | Disclosure | Key account |
|---|---|---|---|
| SKY Perfect JSAT | $230M, about 7 years, Pelican constellation. Announced unnamed 2025-01-29; named in the 2026-01-12 Sweden release | release | yes |
| German government | €240M via Planet Labs Germany (2025-07-01); BMI/BKG tender up to €25M (2026-09-15) | release, 8-K | yes |
| Swedish Armed Forces / FMV | Multi-year, low nine figures; Sweden owns the satellites; first sovereign satellite launched Q1 FY27 | release, 8-K 7.01 | yes |
| NRO EOCL | Commercial imagery | filing / call | yes |
| NGA | Luno B AAMOR ($21.9M option year); GMS with DIU; $8M GMS OTA | release | yes |
| U.S. Navy | Pacific vessel detection, $7.5M per six months | results release | yes |
| NASA CSDA | Tanager evaluation task order (2026-10-21) | release | no |
| MDA SHIELD | IDIQ awardee; vehicle only | release | no |
| Google | Suncatcher (`suncatcher`); also Planet's hosting vendor | release | yes (Suncatcher) |

- **Smaller government buyers:**
  - NATO ACT: a seven-figure extension (FY26 release).
  - Rwanda Space Agency.
  - Slovenia: GURS enterprise agreement 2026-01; ESA node 2026-10-13.
  - Czech government: 7-figure, 2026-05-13.
  - Scottish Government: 2026-07-30.
  - New Mexico State Land Office.
  - A hyperscaler data-center monitoring renewal.
- **Partners and suppliers:**
  - Carbon Mapper and JPL: Tanager partners.
  - SES Space & Defense: inter-satellite communications test on Pelican-12.
  - Launch providers: SpaceX (Transporter, Bandwagon), Isar Aerospace, Stoke Space.

## Competitors & read-through
Core §9 governs. Rival news is `out_of_scope` (0–15) unless one of these holds:
- **The source names Planet or a Planet product.**
- **A sheet key account acts** (table above). Examples: an NRO EOCL budget line or award decision; a German, Swedish or JSAT renewal, pause or cancellation. These count by §9.2 or §9.3 and are graded by 4.2.
- **A rival wins at a key account in Planet's category.** Vantor (formerly Maxar Intelligence), BlackSky, Airbus or ICEYE winning a German, Swedish, JSAT, NGA or EOCL capacity award scores 50–69 as a possible loss. It becomes `money` bad news at 70+ only if the source confirms Planet was replaced.
- **Satellogic (SATL)** is covered under its own sheet. A Planet item that names Satellogic counts for both companies.

Published text states the event only. Write "NRO cuts EOCL commercial imagery line", never "negative for PL". Rival financings, launches and sector budgets that name no Planet program are out of scope.

## Source coverage gaps
Collector and ops notes (USAspending, EU TED, JSAT, NGA and FMV feeds, the EDGAR submissions feed, transcripts, launch-provider notices) belong in `sources/PL.md` for the worker. Grader-facing facts only:
- **EDGAR titles in `edgar_pl` carry no item numbers.** Open the filing before scoring above 39 (core §5). Item numbers sit in `data.sec.gov/submissions/CIK0001836833.json`. The only 8-K since 2026-06-05 is 2026-09-03 (Items 2.02 and 9.01).
- **The feed carries no Forms 4 or 144.** Their absence is never `insufficient_evidence`.
- **Customer-side items count** under the key-account rule even when Planet issues no release.
- **Call-only facts** (pipeline, EOCL status, defense growth rates) are `mgmt_claim`: -15, cap 75, never an order.

## Grader notes
- **One event, one canonical item.** The results release is canonical. The 8-K 2.02 and the 10-Q are duplicates unless they add facts.
- **Syndicated copies** of BusinessWire releases (finviz, Morningstar, Webull, greenstocknews) are duplicates.
- **Stage words, in order:** "launched", then "first light", then "commissioned", then "in service". Never skip a stage.
- **Values:** a "tender award ... maximum possible value" or "up to ... including options" is a ceiling: flag `ceiling_only`, cap 85. Evaluation and pilot orders are not production buys.
- **RPO and backlog are different measures:** RPO $753.1M, backlog $814.9M. A sequential revenue drop that was already guided after a handover quarter is not a miss. Q3 guide is $101–105M against $116.1M in Q2.
- **Deal sizes:** map "7-figure", "8-figure" and "9-figure" with the Materiality bases rules. Never invent a dollar figure.
- **Dilution:** use 363,847,989 basic shares and put d in `magnitude_pct_of_base` with `pct_is_dilution`. Use market cap at the event date for ATM capacity tests.
- **Late recaps and analysis** (Zacks, Simply Wall St, others) follow core §7: results recaps >24h after the print and guidance retellings >72h after score <30, `reason:late_repost`.
- **Fiscal labels:** "FY2027" is the year ending 2027-01-31. Never mix it with calendar 2026.
- **Group keys:** use only `earnings_calendar` and `pl_launches`, the core `<ticker>_<slug>` pattern.
