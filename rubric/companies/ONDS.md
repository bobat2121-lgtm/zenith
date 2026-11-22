# ONDS — Ondas Inc. (formerly Ondas Holdings Inc.)

```yaml
ticker: ONDS
as_of: 2026-11-18            # last print: Q3 2026, 2026-11-12
asset_class: operating
filer: domestic (10-K / 10-Q / 8-K); CIK 0001646188; exchange Nasdaq
fiscal_year_end: 12-31
base_usd: 550000000          # B
base_basis: "FY2026 revenue guidance floor ('at least $550M'), raised 2026-11-12 from $525-550M; no midpoint, so floor used"
alt_base:                    # proposed, NOT active until owner approves (core §12.3)
  value_usd: 1100000000
  basis: "FY2027 initial target 'at least $1.1B', excludes further M&A"
  apply_from: 2027-01-01
  needs_owner: true
tiny_usd: 2750000            # 0.5% of B (B > $100M)
lead_usd: 55000000           # 10% of B
fx_as_of: 2026-11-10         # EUR/USD ~1.126 implied by 10-Q (EUR 22.3M ~ $25.1M); NIS/GBP at event-date rate
shares_basic: 591442459      # 2026-11-10, 10-Q cover
shares_1pct: 5914425
backlog_usd: 835000000       # 2026-09-30
liquidity_usd: 820300000     # 2026-09-30, cash + restricted + ST investments
terms: ["Ondas", "Ondas Inc.", "Ondas Holdings", "Ondas Sentinel", "Ondas Autonomous Systems", "OAS", "Ondas Capital", "ONBERG", "Regna AI", "Mistral Inc.", "DZYNE", "High Point UAS", "IonStrike", "Dronebuster", "Cyberhawk", "iHawk", "Rotron Aerospace", "Sentrycs", "American Robotics", "Roboteam", "Airobotics", "Iron Drone Raider", "Omnisys", "BIRD Aerosystems", "Bron Technologies", "Insignito", "Ottopia Defense", "Caribou Labs"]
aliases_guarded:             # need an Ondas or unit co-token
  - {term: "ULTRA", case: sensitive}
  - {term: "LEAP", case: sensitive}
  - {term: "Sawtooth", case: insensitive}
  - {term: "Grasshopper", case: insensitive}
  - {term: "Ranger", case: insensitive}
  - {term: "World View", case: insensitive}
  - {term: "BIRD", case: sensitive}
  - {term: "DUMBO", case: sensitive}
  - {term: "INDO", case: sensitive}
  - {term: "4M", case: sensitive}
  - {term: "GATE", case: sensitive}
  - {term: "Caribou", case: insensitive}
  - {term: "Ottopia", case: insensitive}
  - {term: "Stemme", case: insensitive}
  - {term: "Digital Bat", case: insensitive}
  - {term: "Optimus", case: sensitive}
match_traps:
  - {term: "ondas", case: lowercase, note: "Spanish 'waves'"}
  - {term: "Mistral", note: "Mistral AI; MBDA Mistral missile"}
  - {term: "Optimus", note: "Tesla Optimus"}
  - {term: "Sentinel", note: "anything but Ondas Sentinel, e.g. Sentinel ICBM"}
  - {term: "Iron Dome|Iron Beam|Arrow", note: "Israeli air defence, not Iron Drone"}
  - {term: "Rotron", note: "AMETEK Rotron"}
  - {term: "Omnisys", note: "Omnisys Engenharia"}
  - {term: "Aran", note: "non-defence units of Aran Ltd. (TASE:ARAN)"}
  - {term: "Caribou", note: "Caribou Coffee, Caribou Biosciences"}
  - {term: "Ottopia", note: "Ottopia Technologies civil teleoperation"}
  - {term: "Stemme", note: "civil motorglider news before close"}
  - {term: "Ondas Networks", note: "~47.5% affiliate, deconsolidated 2026-01-16"}
  - {term: "Dedrone", note: "AXON unit (covered); ONDS only if Ondas named"}
thesis_drivers: [bookings_backlog, margin_ebitda, lus_hero120, ultra_por, ionstrike, mna_capital, israel_europe_volume]
open_items:
  - {id: aran_close, text: "ARAN Defense close (~$33M), guided Q4 2026", expires_at: 2026-12-31}
  - {id: indo_deliveries, text: "INDO engineering-vehicle volume deliveries begin Q4 2026", expires_at: 2026-12-31}
  - {id: dzyne_lockup, text: "DZYNE seller lock-up, 45M shares (7.6% of basic), ~six months from July 2026", expires_at: 2027-01-31}
  - {id: stemme_close, text: "Stemme GmbH close (~EUR 22.3M / ~$25.1M), expected Q1 2027", expires_at: 2027-03-31}
  - {id: q4_rev_250, text: "Q4 2026 revenue > $250M, gross margin similar to Q3", expires_at: 2027-04-15}
  - {id: opplatform_ebitda_q4, text: "Operating-platform adj. EBITDA profitable Q4 2026", expires_at: 2027-04-15}
  - {id: regna_first_customer, text: "First Regna AI customer deployment ('coming months')", expires_at: 2027-04-30}
  - {id: company_ebitda_q3_27, text: "Company-wide adj. EBITDA profitable Q3 2027", expires_at: 2027-11-30}
group_keys: [earnings_calendar, onds_resale_registrations]   # second uses proposed custom pattern <ticker>_<slug>, pending core §8
owner_marks: none            # every value below sits inside core ranges; no sheet line overrides a hard rule
```

_Researched 2026-11-18. Nasdaq: ONDS. A Nevada corporation based in West Palm Beach, FL. The Q4/FY2026 report date has not been announced. Past dates point to late March 2027: FY2025 was reported 2026-03-23, Q1 on May 14, Q2 on Aug 13 and Q3 on Nov 12, and each date notice went out about two weeks before. Shares outstanding were 591,442,459 at 2026-11-10 ([10-Q](https://www.sec.gov/Archives/edgar/data/1646188/000119312526458517/onds-20260930.htm))._

## Identity & matching
- **Legal names:**
  - "Ondas Inc." has been the EDGAR filer name since 2026-01-12 ([EDGAR submissions](https://data.sec.gov/submissions/CIK0001646188.json)).
  - "Ondas Holdings Inc." appears in older releases and filings.
  - CEO and Chairman: Eric A. Brock.
- **Units: news that names only one of these is ONDS news.**
  - DZYNE Technologies and High Point UAS, inside the Ondas Sentinel division. DZYNE closed 2026-07-02. Products: ULTRA, LEAP, IonStrike, Dronebuster (DB4/DB5, REACH, DTIM kits), Sawtooth and Grasshopper.
  - Mistral Inc.: the merger completed 2026-04-24. Mistral is prime on the Army Lethal Unmanned Systems (LUS) / HERO-120 IDIQ.
  - World View (Stratollite, SkyWeaver), closed 2026-04-01.
  - Cyberhawk (iHawk), closed 2026-08-10.
  - Rotron Aerospace, Sentrycs, American Robotics and Roboteam.
  - Airobotics (Optimus drone-in-a-box, Iron Drone Raider).
  - 4M Defense, Indo Earth Moving (INDO), BIRD Aerosystems (AMPS/DIRCM) and Omnisys. Omnisys closed 2026-05-21.
  - GATE Technologies and Bron Technologies (ESAD fuzes), acquired 2026-09-14.
  - Insignito (DUMBO), Ottopia Defense and Caribou Labs, acquired 2026-09-23 ([IR](https://ir.ondas.com/news/detail/329/ondas-acquires-three-defense-technology-businesses-to-expand-its-integrated-autonomous-defense-systems-platform)).
  - The ONBERG joint venture with Heidelberg (2026-04-15) and Ondas Capital.
  - Regna AI: a standalone company built on Palantir AIP and initially wholly owned by Ondas, announced 2026-10-12 ([IR](https://ir.ondas.com/news/detail/334/ondas-announces-regna-ai-powered-by-palantir-to-advance-sovereign-ai)).
- **Pending deals.** Before close, only deal steps (signing, amendment, close, termination) are ONDS news, not the target's own news.
  - ARAN Defense: about $33M in cash or stock, signed 2026-08-18. Close was first guided for Q3. The 2026-11-10 release says "completion of the acquisition in Q4" (`open_item: aran_close`).
  - Stemme GmbH (S12 airframe): all cash, about €22.3M (about $25.1M), close expected Q1 2027 (`open_item: stemme_close`).
- **Guarded aliases and traps:** see the front matter. Ondas Networks (FullMAX/dot16) is about 47.5% owned and was deconsolidated effective 2026-01-16. It is ONDS news only on a stake sale, impairment or fair-value change.
- **Cross-sheet collisions.** Check these against the other sheets before scoring:
  - Dedrone and Axon: AXON is covered. An item about Axon counter-UAS is AXON news unless it names Ondas.
  - 4M Defense and Safe Pro demining: SPAI is covered. Each company counts only when the item names it, and an item naming both is a covered pair.
  - "Sentinel" and "Merlin"-style program names: generic words. They need an Ondas co-token.

## What the stock trades on
These are the `thesis_drivers` ids from the front matter.
1. **`bookings_backlog`:** Q3 bookings were $214M and backlog $835M (+36% q/q). The test is conversion: Q4 revenue above $250M and 2027 revenue of at least $1.1B ([8-K Ex.99.1, 2026-11-12](https://www.sec.gov/Archives/edgar/data/0001646188/000119312526457088/onds-ex99_1.htm)).
2. **`margin_ebitda`:**
   - Q3 GAAP gross margin was 21.8%, against 43.1% in Q2 2026 and 25.8% in Q3 2025.
   - Adjusted gross margin was 34.8%, against 50.4% in Q2.
   - The Q3 adjusted EBITDA loss was $59.7M, against $46.2M in Q2. The company blames ramp inefficiency in large programs, especially precision strike.
   - Targets: operating-platform (OAS + Ondas Sentinel) adjusted EBITDA profitability in Q4 2026, and company-wide in Q3 2027 (pulled in one quarter).
3. **`lus_hero120`:** the Army LUS/HERO-120 IDIQ has a $982M ceiling. Mistral awards to date are above $240M.
4. **`ultra_por`:** ULTRA is a "program of record candidate". Q3 follow-on orders were $53.7M.
5. **`ionstrike`:** Q3 orders were $21.7M. The production ramp and volume or sole-source awards are pending.
6. **`mna_capital`:** the M&A machine and its cost of capital.
   - Cash and investments were $820.3M at 9/30, down from $1.4B at 6/30.
   - Dilution risk comes from stock-paid deals, the $28 warrants from January 2026 and seller resales.
7. **`israel_europe_volume`:**
   - Israeli MoD: Digital Bat, INDO ($140M program) and 4M demining ($50M award).
   - Bron ESAD fuzes for a European loitering munition ($56M).

## Materiality bases
- **Revenue base B = $550M**, the FY2026 guidance floor, raised 2026-11-12. Nine-month revenue is already $301.4M.
- **Proposed roll to $1.1B:** the FY2027 target. It applies only after owner approval, per core §12.3. If approved, tiny becomes $5.5M and lead $110M. Until then, keep $550M and note in `why` when the $1.1B base would change the band.
- **Backlog:** $835M at 2026-09-30. The Q2 figures ($613M, or about $757M including DZYNE and Cyberhawk) are stale.
- **Liquidity:** $820.3M at 9/30:
  - $262.8M cash.
  - $31.5M restricted cash.
  - $526.1M short-term investments.
  - Convertible notes total about $5.0M ($0.9M current, $4.2M non-current).
  - Never judge a raise or a deal against cash (core §4.2.2).
- **Orders and contracts (core §4.2.1, tested on total or obligated value; p = V ÷ $550M):**

  | Size | Share of B | Binding score | Selected or pre-award |
  |---|---|---|---|
  | Below $2.75M (tiny) | <0.5% | 25-39 | 25-39 |
  | $2.75M-$5.5M | tiny-1% | 70-74 | 70-74 |
  | $5.5M-$16.5M | 1-3% | 72-80 | 72-80 |
  | $16.5M-$55M | 3-10% | 80-89 | 80-88 |
  | $55M or more (lead) | ≥10% | 90-97, `floor:lead_order` | 88-94 |

  - Company-reported aggregate order updates use the same lines and take the lower half of the range.
  - **Lead override, floor 90:** applies when V ≥ tiny and the order is either a first production-scale order of a product, or a first order from a new U.S. military service, a new federal agency or a new foreign government. A new state or local agency (for example FEMA-grant SLTT buyers) gets +5 novelty only.
  - **No value disclosed:** a binding order with a named counterparty or named program is 70-78. Never invent a value.
- **Capital events (core §4.2.2, d = new shares ÷ basic shares before the event):**
  - Today: 1% ≈ 5.9M shares; 5% ≈ 29.6M; 10% ≈ 59.1M; 20% ≈ 118.3M.
  - d ≥20%: 85-95. 10-20%: 78-88 (`floor:capital_big`). 5-10%: 70-80. Under 5%: 55-70.
  - Add +5 each for:
    - a discount of 15% or more to the last close;
    - toxic terms (resetting converts, equity lines, warrant repricing);
    - a named strategic investor.
  - New ATM: 75-85 if capacity is ≥20% of market cap, otherwise 60-72.
  - Count full warrant exercise in d.
  - Example: the January 2026 $1B registered direct ([IR](https://ir.ondas.com/press-releases/detail/272/ondas-holdings-inc-announces-closing-of-1-billion-offering)).
    - Terms: 19.0M shares plus 41.8M pre-funded warrants at $16.45, each with two seven-year $28 warrants. That is 60.8M shares plus 121.6M warrant shares.
    - It was priced at a 17.5% premium, so no discount lift.
    - Grade d against the pre-deal share count, which this sheet does not record. If the count is unavailable, use proceeds ÷ market cap with confidence ≤0.6.
- **Acquisitions (core `deal` rung: signed 75-88, closed 75-85; target news counts only after close):**
  - **Under $55M with strategic fit:** 75-84. Strategic fit means in-house production, a new segment or a new country. The ARAN signing ($33M) is 84, the core anchor.
  - **$55M or more (≥10% of B):** 84-88 signed, 82-85 closed. Example: Insignito, Ottopia Defense and Caribou Labs, $56M upfront plus up to $32M earnout, about 86.
  - **Transformational:** consideration of 50% of B or more ($275M or more), or stock consideration with d ≥10%. This may take the `mna_capital` thesis lift (+5-15, core §4.4) into Lead, up to a maximum of 95. Example: DZYNE, $875.8M, announced 2026-07-06, about 93.
  - **Stock-paid deals:** also compute d and record it in `why`. Use the higher of the deal score and the capital score; never add the two.

## Event ladder for this name
**Lead (90-100)**
- **Same-day results with a guidance raise, cut or withdrawal of ≥10% at the midpoint, or a ≥20% miss** (`floor:results`; core §3). Example: "Ondas Posts Record Q3 2026 Revenue of $167.5 Million… Raises Full-Year Outlook", 2026-11-12, about 92 ([IR](https://ir.ondas.com/news/detail/341/ondas-posts-record-q3-2026-revenue-of-167-5-million-on-strong-bookings-and-backlog-growth-raises-full-year-outlook)).
  - The raise went from $525-550M to at least $550M, a small change at the midpoint. The figures and the first FY2027 target carry it, not the size of the raise.
  - A smaller guidance change: 80-89 (`floor:guidance`).
- **An order, task order or aggregate-order update of $55M or more** (`floor:lead_order`). Examples:
  - "Ondas Secures Over $165 Million in New Orders Since Last Order Update", 2026-10-07: company-reported aggregate, 30.0% of B, about 93 (core anchor) ([IR](https://ir.ondas.com/news/detail/333/ondas-secures-over-165-million-in-new-orders-since-last-order-update)).
  - "Ondas Receives $56 Million Order… Electronic Safe & Arm Devices…", 2026-10-05: European neo-prime, 10.2% of B, about 90 ([IR](https://ir.ondas.com/news/detail/332/ondas-receives-56-million-order-in-precision-strike-business-for-electronic-safe-arm-devices-supporting-european-loitering-munition-program)).
- **Lead override:** a first production-scale order of a product (for example IonStrike) or a first order from a new U.S. service, federal agency or foreign government, with V ≥ tiny. Floor 90.
- **Transformational acquisitions** via the `mna_capital` lift (see Materiality bases). Example: DZYNE, about 93.
- **Equity raises** with d ≥20% (85-95), or d 10-20% with a +5 lift.
- **ULTRA program-of-record decision.** Rank high via `ultra_por`: permission rung plus thesis lift, 85-95. A negative decision ranks the same.
- **Existence events:** first going-concern doubt, non-reliance (4.02), delisting determination (`floor:existence`, 85+).

**Digest (70-89)**
- **Orders of $2.75M-$55M from a named program or service.** Examples:
  - "Ondas Secures U.S. Army Order for Lethal Unmanned Systems for Over $50 Million", 2026-08-05: 9.1% of B, about 86 ([IR](https://ir.ondas.com/news/detail/321)).
  - AFRL Grasshopper, more than $6M, 2026-08-06: 1.1% of B, about 74 ([IR](https://ir.ondas.com/news/detail/322)).
- **CEO or CFO change:** 75-88 (`floor:neo_ceo_cfo`); an abrupt exit +5-10. Other named executive officers: 70-85 (`floor:neo`).
- **Equity raises with d of 5-20%:** 70-88 by the d table. **Debt** with principal ≥25% of B or market cap: 75-85.
- **Acquisitions below transformational size:**
  - Insignito group, about 86.
  - ARAN signing, about $33M, 2026-08-18, 84 ([IR](https://ir.ondas.com/news/detail/327/ondas-to-acquire-aran-defense-strengthening-israels-sovereign-defense-industrial-base)).
  - Stemme (about $25.1M) together with the target of 10 ULTRA aircraft a month by 2028, 2026-11-05, about 80 ([IR](https://ir.ondas.com/news/detail/339/ondas-plans-significant-u-s-manufacturing-expansion-to-scale-low-cost-ultra-isr-aircraft-production-targeting-10-aircraft-per-month-by-2028)).
- **Closings of announced deals:** 75-85. Example: Cyberhawk, 2026-08-10 ([IR](https://ir.ondas.com/news/detail/324)).
  - The ARAN or Stemme close resolves its open item (`floor:open_item`, 80).
  - A termination ranks like the signing (bad news).
- **Purchase orders under a named program with no value.**
  - Example: Digital Bat tactical attack drones, 2026-11-10, about 72 ([IR](https://ir.ondas.com/news/detail/340/ondas-receives-purchase-order-for-next-generation-tactical-attack-drones-aims-to-leverage-planned-aran-defense-acquisition-to-manufacture-thousands-of-systems)).
  - The release names neither the buyer nor the value. It says only "previously awarded Digital Bat program".
- **"Multi-million" contracts with unnamed customers.**
  - Example: a European police organisation (Ranger) and an Asian government (Iron Drone Raider), 2026-11-04, about 72 ([IR](https://ir.ondas.com/news/detail/338/ondas-secures-multi-million-dollar-counter-uas-contracts-in-europe-and-asia-accelerating-global-expansion-in-aerial-defense)).
  - Apply the foreign-government lead override only if the release says it is a first order from that government.
- **Selections with a named customer:**
  - Example: "Ondas Selected to Build Israel's Next Generation of Military Tactical Attack Drones", a multi-million IMOD tender, 2026-08-11. `selected`, about 78 ([IR](https://ir.ondas.com/news/detail/325)).
  - Never call a selection an award.
- **Named-counterparty agreements with a stated term or scope (core scope rule, 60-85):**
  - Example: Cyberhawk and SSE plc, a three-year term plus a two-year option and an offshore-wind lot, 2026-09-28, about 70 ([IR](https://ir.ondas.com/news/detail/330)).
  - Without a term or scope, the same kind of item is Borderline.
- **Flagship product tied to a named contract:**
  - Example: "Ondas Launches Dronebuster REACH", 2026-09-30. The first system is under contract to the Office of Naval Research after acceptance testing. Product +5-10 for a named contract, about 70 ([IR](https://ir.ondas.com/news/detail/331)).
  - Core §7: never bury this under a lane-pack "no order" rule.
- **Final regulator decisions naming a unit** (`floor:regulator`, 75):
  - Example: EASA certification of BIRD's AMPS/DIRCM missile-protection system on a Bombardier Global 7500, 2026-10-13, about 75 ([IR](https://ir.ondas.com/news/detail/335)).
- **Delivery and production milestones and their slips:** proof rung, 60-85. Examples: INDO volume deliveries starting (resolves `indo_deliveries`, floor 80); a slip in the ULTRA production target.
- **Earnings-date notices: fixed 75**, `group:earnings_calendar`, `floor:calendar`, `reason:calendar_card`. Example: "Ondas to Report Third Quarter 2026 Financial Results on November 12, 2026", 2026-10-29 ([IR](https://ir.ondas.com/news/detail/336)).

**Borderline (40-69)**
- **Named-partner integration with no volume, term or money** (core scope rule, 55-65). Example: Regna AI with Palantir, 2026-10-12, about 58. If Regna reports its first customer deployment, that resolves `regna_first_customer` (floor 80).
- **Shelf registrations with no takedown:** 40-55.
- **Resale registrations ≥20% of outstanding:** 60-70. Smaller resales are under Reject.
- **Non-executive or advisory hires:** core 25-50. Example: former Mossad director David Barnea, 2026-08-03, about 45 ([IR](https://ir.ondas.com/news/detail/320)).
- **Ondas Networks stake sale, impairment or fair-value change:** 45-65, by size against B.

**Reject (<40)**
- **Positioning releases** (`prospective`, cap 39). Example: "Ondas Positions… Portfolio to Support $250 Million FEMA Counter-Drone Grant Program", 2026-10-30, about 30 ([IR](https://ir.ondas.com/news/detail/337)).
- **Sponsorships:** 0-20, `reason:promotional`. Example: "Ondas and Aston Martin Aramco Formula One Team Launch Multi-Year Partnership…" (through 2029), 2026-11-18, about 10 ([IR](https://ir.ondas.com/news/detail/342)).
- **Small resale-prospectus 8-Ks** (`group:onds_resale_registrations`). Example: 8-K Items 3.02/8.01 plus a 424B7 covering 6,292 shares for World View sellers, 2026-11-18, about 10.
- **Proxy and "vote now" releases:** 10-20.
- **Late recaps:** results recaps more than 24h after the print, and guidance retellings more than 72h after (core §7, `reason:late_repost`).

## Always surface (floors)
Floors are core §6 ids; the sheet adds no new floor values.
- **Results.** The 8-K 2.02 with Ex.99.1, or the IR release, is canonical (`floor:results`, 80). Put the figures first: revenue against guidance and the prior quarter, the guide change, backlog, gross margin, adjusted EBITDA and liquidity.
- **10-Q or 10-K** that follows the release: a duplicate unless it adds something. Updates score 60-85; going concern scores 85+. Things it can add:
  - backlog or RPO detail;
  - a change in the Customers A-E concentration table;
  - subsequent events (closings, new acquisitions);
  - segment figures or the share count.
- **Concentration baseline** (Q3 2026): Customer D 21%, Customer A 15%, Customer E 13%. Over nine months: A 25%, D 13%. A new 10% customer is a `results`-rung event, 80-98.
- **8-K items:**
  - 1.01: grade the agreement.
  - 2.01: as acquirer, 75-85.
  - 3.02: dilution math. Large raises follow the d table; small seller or consultant resales score below 25.
  - 5.02: confirm the role from the text.
- **Rank-high program lines** (thesis drivers, +5-15):
  - Mistral or Army LUS/HERO-120 task orders or deliveries (`lus_hero120`).
  - IonStrike volume orders or sole-source decisions (`ionstrike`).
  - ULTRA program-of-record decisions or Air Force/AFRL actions (`ultra_por`).
  - Israeli MoD orders under Digital Bat, INDO or 4M (`israel_europe_volume`).
- **Open items:** closings or terminations of ARAN or Stemme (`floor:open_item`, 80, `resolves:aran_close` or `resolves:stemme_close`).
- **Key-program losses:** loss, cancellation or protest at LUS, ULTRA, IonStrike or the IMOD programs (`floor:key_loss`, 70).

## Noise patterns
- **Bare EDGAR titles.** Every `edgar_onds` row reads "Ondas Inc.: 8-K filed <date>", or "8-K (Items …) filed".
  - Open the filing before scoring above 39 (`read_source: true`).
  - When the filing duplicates the release, set `score: null` with `dup_of` pointing to the release.
- **Archive bursts (core §8):**
  - 2026-08-31 21:21: 40 `edgar_onds` rows dated 2026-04-10 to 2026-08-28.
  - 2026-07-09 18:30: 20 `ondas` IR rows dated 2026-03-23 to 2026-07-06.
  - Gate each row on its own event date. Rows more than 21 days old score 0-9 with `reason:stale`, `archive_burst` and `source_repair`. Rows inside the window (for example the 08-28 8-K) are graded normally.
- **Proxy season.** These score 10-20:
  - DEFA14A rows (2026-05-04, 05-14, 05-18, 05-22).
  - "Ondas Inc. Stockholders: Vote Now to Ensure Quorum for Annual Meeting" (2026-05-18).
- **Promotional and positioning releases:**
  - The F1 partnership: 0-20.
  - The FEMA "positions" release: cap 39.
  - Trade-show system launches with no order and no named customer: 35-55 as minor product. Example: "Ondas Launches New Autonomous Defense Systems of Systems at Eurosatory 2026 Under Its 'Autonomy at First Contact' Vision" (2026-06-16).
  - A trade-show launch with a named contract goes to Digest as product.
- **"Multi-million" or "strategically significant orders" with no dollar figure.**
  - With a named program or customer, or as a binding order: 70-78.
  - With neither: 55-65 (first customer or new country) or below.
  - Never invent a value.
- **Syndicated copies:** Accessnewswire (the release wire), Benzinga, Nasdaq, Finviz, Zacks and Webull. They are duplicates (`score: null`).
- **Recaps:** 24h limit for results, 72h for guidance (core §7).

## Catalyst calendar
- **Q4 2026:**
  - ARAN Defense close (`aran_close`).
  - INDO volume deliveries start (`indo_deliveries`).
  - Operating-platform adjusted EBITDA profitability (`opplatform_ebitda_q4`).
  - Q4 revenue guided above $250M, with at least 75% pro forma organic growth and gross margin similar to Q3 (`q4_rev_250`).
- **About January 2027:**
  - DZYNE seller lock-up expiry, 45M shares (`dzyne_lockup`).
  - Proposed base roll to $1.1B, pending owner approval.
- **Q1 2027:** Stemme close, subject to regulators (`stemme_close`).
- **About late March 2027:** Q4/FY2026 results, which test FY2026 revenue of at least $550M and the FY2027 target of at least $1.1B. The FY2025 print came 2026-03-23 and the 10-K 2026-03-30. Expect a date notice about two weeks before; it scores 75 on the earnings card.
- **Rolling, no dates set:**
  - LUS follow-on task orders.
  - IonStrike production ramp and volume awards.
  - ULTRA program-of-record decision.
  - Digital Bat scale-up.
  - Regna AI first customer (`regna_first_customer`).
- **Context only, not graded unless an item names Ondas or a unit:** FEMA C-UAS grant awards to SLTT agencies.
- **Q3 2027:** company-wide adjusted EBITDA profitability (`company_ebitda_q3_27`).
- **Overhang:**
  - The $28 warrants from January 2026 (seven-year term, 121.6M shares, 20.6% of today's basic count).
  - Resale registrations from acquisition sellers (424B7 plus 8-K Item 3.02).

## Customers, programs, agencies & counterparties
- **U.S. Army:** the LUS IDIQ for the HERO-120. UVision is design authority and Mistral is prime. The ceiling is $982M; awards to date are above $240M, including the initial $190.8M. Disclosure: release and 8-K; DoD daily contracts list only awards of $7.5M or more.
- **U.S. Air Force / AFRL:**
  - ULTRA, operationally deployed by the USAF.
  - IonStrike.
  - Long-Range Grasshopper: an AFRL contract of $6M or more, 2026-08-06.
- **ONR:** Dronebuster REACH.
- **U.S. Navy / SOUTHCOM:** World View stratospheric balloons, a $4.8M award (2026-06-02).
- **Israeli MoD (IMOD):**
  - Digital Bat tactical attack drones, selected 2026-08-11.
  - INDO's $140M engineering program, with an initial order of about $68M on 2026-04-13.
  - 4M eastern-border demining: a $50M award with a $10M initial order, 2026-04-20.
- **Europe:**
  - An unnamed European neo-prime: $56M of ESAD fuzes.
  - A European police organisation (Ranger).
  - ONBERG (Heidelberg).
- **Others:**
  - Australian Department of Defence: $6.9M of DTIM kits through HIFraser (2026-07-20).
  - An Asian government (Iron Drone Raider).
  - Lockheed Martin: Sentrycs inside the Sanctum C-UAS platform (2026-06-23).
  - SSE plc (Cyberhawk).
  - The 2026 FIFA World Cup and Jacksonville Jaguars games (counter-drone).
  - Palantir (Regna AI, SkyWeaver).
- **Concentration:** the 10-Q tags Customers A-E (`filing_only`). See Always surface for the baseline.
- **Big customers:** D, A and E each exceed 5% of revenue and count as `big`.

## Competitors & read-through
Core §9 governs; everything not listed here is `out_of_scope` (0-15).
- **Counts for ONDS without naming Ondas:**
  - Army LUS/HERO-120 task orders, quantities, budget lines or production problems. This is a sheet program, so rule 9.3 applies. UVision's non-U.S. HERO orders do not count.
  - Board, budget or award actions by IMOD under Digital Bat, INDO or 4M, and USAF/AFRL actions on ULTRA or IonStrike (rule 9.2).
  - A rival winning at a sheet key program (LUS, ULTRA, IonStrike, Digital Bat): 50-69 as a possible loss, or `money` bad news (70+) once a replacement is confirmed (rule 9.4).
- **Out of scope** unless the item names Ondas or a unit:
  - Peer wins or financings at AeroVironment (Switchblade), DroneShield, D-Fend, Anduril, Elbit, IAI or other ISR-aircraft makers.
  - Axon/Dedrone news.
  - Sector C-UAS budgets and FEMA grant totals.
- **Covered-to-covered:**
  - An item naming Ondas (or a unit) together with SPAI or AXON is direct involvement for both. Output one object per ticker with `also:<TICKER>`; a transaction between them takes `floor:covered_pair`.
  - The 4M/Safe Pro demining overlap counts for ONDS only when the item names Ondas or 4M with an Ondas co-token.
- **Published text** (`why`, `note_hook`) states sourced facts only. Name Ondas only when the source does. Example: "Army issues HERO-120 task order", not "Ondas wins".

## Source coverage gaps
Collector and ops notes (EDGAR submissions-JSON pulls, USAspending queries, IMOD and Israeli press, unit newsrooms, FEMA notices, call transcripts) have moved to the worker doc `sources/ONDS.md`. The grader needs only these facts:
- **IR feed:** release IDs 320-342 (2026-08-03 to 2026-11-18) are contiguous, and each appears in the `ondas` feed. The IR item is canonical over the wire and syndicated copies.
- **EDGAR rows** carry no form detail. Open the filing. A missing expected 8-K is never `insufficient_evidence` (core §5).
- **DoD daily contracts** list only awards of $7.5M or more. A missing DoD notice is not evidence that no award was made.
- **Call-only disclosures** are `mgmt_claim` (-15, cap 75), never orders. Examples: IonStrike pricing and RFP status, acquisition pace.

## Grader notes
- **One event, many copies.** The IR release is canonical when it arrives in the same run as the 8-K. An earlier 8-K is canonical until the release appears. All other copies get `score: null` and `dup_of`.
- **Order roll-ups.** ONDS restates cumulative orders. Example: "over $270M since June 30" = $165M+ plus the $105M disclosed on the Aug 13 call.
  - Never add a roll-up to orders already counted. Grade a new roll-up on the increment.
  - Keep booked orders separate from IDIQ ceilings ($982M LUS) and from "program potential". A ceiling alone takes `ceiling_only` and is capped at 85.
- **Headlines that hide the news.** The Stemme acquisition was titled as a "manufacturing expansion", and the ARAN timing was carried inside a Digital Bat order release. Score on content, not the title.
- **Stage words.** Use the release's own words: "selected", "purchase order", "planned acquisition", "program of record candidate". Never upgrade a selection to an award or a planned acquisition to a close.
- **Units and currency.** Figures may be in USD, EUR (Stemme), NIS or GBP (Cyberhawk, Rotron). Convert at the event-date rate (`fx_as_of` for sheet figures). Report backlog as backlog, never as revenue.
- **Warrant marks.** GAAP net loss includes large non-cash warrant revaluation gains ($125.1M in Q3, $529.9M over nine months). Never report GAAP net-income moves as operating news.
- **Capital and deals.** Grade raises on dilution (d), never against cash. For stock-paid deals, record both the deal score and d, and keep the higher one.
- **Stale facts.** ARAN has not closed (the Q3 target slipped to Q4). The $537.5M base and the $613M backlog are out of date.
  - The core ONDS ">$165M" anchor (93) was set on the $537.5M base. It is 30.0% on the current base, so the band is unchanged.
  - If a primary item contradicts this sheet (for example ARAN closed), trust the item and flag `sheet_stale` and `needs_owner`.
