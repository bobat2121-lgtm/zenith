---
ticker: SRFM
as_of: 2026-11-18
asset_class: operating
filer_type: domestic (10-Q/10-K/8-K)
cik: "0001936224"
exchange: NYSE
fx_as_of: n/a (USD reporter)
base_usd: 133000000
base_basis: "FY2026 revenue guidance midpoint ($128-138M), reaffirmed 2026-11-05"
alt_base: false
tiny_usd: 665000        # 0.5% of base (B > $100M)
lead_usd: 13300000      # 10% of base
shares_basic: 135205998 # 2026-10-30, 10-Q cover
market_cap_usd: ~57000000 # $0.42 close 2026-11-18
terms: ["Surf Air Mobility", "Southern Airways Express", "Mokulele Airlines", "Surf On Demand", "SurfOS", "BrokerOS", "Enterprise BrokerOS", "OperatorOS", "OwnerOS", "Surf Air Technologies"]
aliases:
  - {term: "Surf Air", case: whole_word, guard: aviation_context}
  - {term: "Southern", guard: "only as 'Southern Airways Express', or with Southern's EAS towns and the carrier named"}
  - {term: "Mokulele", guard: airline_only}
match_traps: ["Mokulele Highway", "China Southern", "Southern Air (cargo)", "Southern Company", "Southern Airways (1949-79)", "surf forecasts / surfing", "Lanai news with no air service", "BETA/Joby/Archer eIPP news not naming Surf Air", "Caravan incidents at other operators", "generic OperatorOS or SMART", "OperatorOS customers' unrelated news"]
thesis_drivers: [liquidity, nyse_cure, surfos_revenue, surf_on_demand, eas, electric]
open_items:
  - {id: srfm_nyse_cure, text: "Regain NYSE $1 compliance (802.01C) or reverse split", expires_at: 2027-01-24}
  - {id: srfm_high_trail_2027, text: "Repay, convert or extend the High Trail convertible note (110% at maturity)", expires_at: 2027-07-01}
  - {id: srfm_wheels_up_deploy, text: "Full Wheels Up Enterprise BrokerOS deployment beyond the initial phase (no date given; sheet review date)", expires_at: 2027-03-15}
group_keys: [earnings_calendar, srfm_operatoros_signings, srfm_high_trail_redemptions, srfm_eas_orders]
---

# SRFM — Surf Air Mobility Inc.
_Researched 2026-11-18. NYSE: SRFM. CIK 0001936224. Fiscal year ends Dec 31. Next earnings: Q4/FY2026 results, expected mid-March 2027 (FY2025 results and the 10-K came on 2026-03-12). Not yet announced. EDGAR checked 2026-11-18: no 8-K since 2026-11-05. Latest filings are the EFFECT and two 13G/As (2026-11-16) and a 13G/A (2026-11-10)._
- **Shares outstanding:** 135,205,998 (2026-10-30, 10-Q).
- **Price:** closed at $0.42 on 2026-11-18, for a market cap of about $57M (https://stockanalysis.com/stocks/srfm/). Every close since 2026-10-06 has been below $1.
- **Management:** CEO Deanna White; CFO Jason Secore (announced 2026-09-28).

## Identity & matching
- **Legal names (Ex. 21, FY2025 10-K):**
  - Surf Air Mobility Inc.
  - Southern Airways Corporation
  - Southern Airways Express, LLC
  - Southern Airways Pacific LLC
  - Surf On Demand Inc.
  - Surf Air Technologies Inc., the Palantir JV entity behind SurfOS. Palantir may take equity in it.
  - Surf Air Global Limited
  - Payments OS Inc.
- **Brands to match:**
  - Southern Airways Express (mainland commuter flying, most EAS routes).
  - Mokulele Airlines (Hawaii; 9 airports and 12 routes per the Q3 release).
  - Surf On Demand, also "Powered by Surf On Demand".
  - SurfOS and its modules: BrokerOS / Enterprise BrokerOS, OperatorOS, OwnerOS.
- **Aliases that need context:**
  - "Surf Air" matches only as a whole word in an aviation context.
  - "Southern" matches only as the full "Southern Airways Express", or when the item names Southern's EAS towns together with the carrier.
  - "Mokulele" matches only for the airline.
- **Collisions to reject** (`reason:off_entity`, 0-5):
  - Mokulele Highway (Maui road news).
  - China Southern, Southern Air (cargo), Southern Company, and the 1949-79 Southern Airways.
  - Surfing and surf forecasts.
  - Lanai island news with no air service.
  - BETA, Joby or Archer eIPP news that does not name Surf Air.
  - Caravan incidents at other operators.
  - Generic "OperatorOS" or "SMART".
  - The OperatorOS customers' own unrelated news (Sprintbach, SkyDance, Air Fuga, Clipper, Flying Zebra).
- **Cross-sheet collisions:** none known. "Surf" and "Southern" do not appear as terms on any other covered sheet.

## What the stock trades on
1. **Liquidity and survival (`liquidity`).**
   - At 2026-09-30, cash was $10.7M against a $97.1M working-capital deficit (current assets $30.1M, current liabilities $127.2M).
   - The 10-Q has substantial-doubt going-concern language. It also reports defaults on excise and property taxes and on certain debt, plus an IRS tax lien.
   - The High Trail notes carry a minimum-liquidity covenant: $5M at all times, and $8M for 45 of any 60 days.
2. **NYSE listing cure (`nyse_cure`).**
   - The 802.01C notice for trading under $1 came on 2026-07-24. The six-month cure window runs to about 2027-01-24. A cure needs a $1 close plus a 30-day average of at least $1, at a month-end or at window end.
   - Holders approved a reverse split of 2:1 to 6:1 on 2026-07-24 ([8-K](https://www.sec.gov/Archives/edgar/data/1936224/000119312526316275/srfm-20260724.htm)).
   - The NYSE 802.01B test is also close. It is breached when the 30-day average market cap is below $50M and equity is below $50M. SRFM is at about $57M with a shareholders' deficit.
3. **SurfOS becoming outside software revenue (`surfos_revenue`).**
   - OperatorOS has 5 contracts, all with small or mid-sized Part 135 operators on revenue share.
   - The Wheels Up Enterprise BrokerOS contract is worth up to $12M over 3 years (9.0% of base). Only its initial phase is deployed.
   - The "tens of millions" enterprise pipeline is a management belief. A new enterprise-scale customer would re-rate the stock.
4. **Surf On Demand growth (`surf_on_demand`).** Q3 revenue was $19.0M, up 121% YoY and 52% of total revenue. Departures reached 1,417 (up 86%), and gross margin rose more than 4 points YoY.
5. **Airline economics and EAS (`eas`).** Scheduled airline revenue was $17.5M, down 15% YoY on EAS route exits, with $1.2M of airline adj. EBITDA. EAS was 42% of FY2025 revenue.
6. **Electric-aviation optionality (`electric`, low weight today).**
   - 25 BETA ALIA CX300 are on firm order: more than $90M, deliveries from 2028, and options for up to 75 more through 2030.
   - The Hawaii demonstration is complete (64 flights across four islands).

## Materiality bases
- **Revenue base (B):** $133M, the midpoint of FY2026 revenue guidance of $128-138M, reaffirmed 2026-11-05 ([Q3 release](https://investors.surfair.com/news/news-details/2026/Surf-Air-Mobility-Reports-Third-Quarter-2026-Financial-Results-Meeting-Revenue-and-Adjusted-EBITDA-Guidance/default.aspx)).
  - Q3 revenue was $36.5M.
  - Q4 guidance: revenue $36.4-46.4M; adj. EBITDA loss of $5.4-2.4M.
  - FY adj. EBITDA guidance is now a loss of $35-32M, widened from a loss of $30-25M. At the midpoint the loss widened 21.8%, from -$27.5M to -$33.5M.
  - No 2027 outlook yet.
- **Thresholds (core §4.2.1).** Test the total contract value and note the annual run-rate in `why`.
  - Tiny: $0.665M (0.5% of B).
  - Lead: $13.3M (10% of B).
  - Sheet override (`rank_high`): the first enterprise SurfOS customer is a lead override (floor 90 when V ≥ tiny). It is the first buyer of the product at that tier and moves the `surfos_revenue` driver.
- **Backlog/RPO:** not disclosed. Known contract values:
  - Wheels Up: up to $12M over 3 years (p = 9.0, ceiling, `ceiling_only`).
  - Lanai EAS: $19.4M over 4 years through August 2030, subsidy only and excluding fares. That is about $4.85M a year (p = 14.6 total, 3.6 annual).
  - DuBois EAS (lost): up to $5.3M a year over a two-year term (p = 4.0 annual).
- **Liquidity (2026-09-30, 10-Q):**
  - Cash: $10.7M.
  - Debt: $24.6M current and $34.3M long-term.
  - Convertible notes: $15.2M at fair value, all current.
  - Shareholders' deficit: $45.5M.
  - The $21.6M Senior Secured Debentures (the "asset-backed loan") are fully drawn. The second tranche of about $14M closed 2026-08-10.
  - The High Trail New Convertible Note ($16.9M initial) matures 2027-07-01 and is repayable at 110%. It converts at about $1.116, which on the initial principal is about 15.1M shares, or 11.2%. Monthly partial redemptions in cash or shares began 2026-08-01.
  - The High Trail New Term Note ($30M) is due 2028-01-01.
  - In 9M 2026, the GEM share purchase agreement provided $30.0M (25.2M shares) and direct offerings netted $14.3M.
- **Capital events (core §4.2.2).** Score on dilution against 135.2M shares, not against cash.
  - 5% of the count is about 6.8M shares. At $0.42:
    - $3M ≈ 7.1M shares (5.3%).
    - $5M ≈ 11.9M shares (8.8%).
    - $10M ≈ 23.8M shares (17.6%).
    - About $11.4M or more passes 20%.
  - Lift +5 under the `liquidity` thesis driver when the money lands before the 2027-07-01 maturity, or when it cures or causes a covenant breach. State the cash-versus-covenant position in `why`.

## Event ladder for this name
Core bands apply. The examples below are calibration points; lifts above the core are tied to a thesis driver or open item.
- **Lead (90-100):**
  - Same-day quarterly results with a guidance change of 10% or more at the midpoint, a going-concern conclusion being added or removed, or a miss of 20% or more (core §3).
    - Example: "Surf Air Mobility Reports Third Quarter 2026 Financial Results, Meeting Revenue and Adjusted EBITDA Guidance" (2026-11-05, URL above). Score about 90.
    - Revenue was reaffirmed, but the FY adj. EBITDA loss guidance widened 21.8% at the midpoint, which meets the core Lead line.
    - The core §11 anchor of 82 for "SRFM Q3 results" was set on the headline. Flag `needs_owner` to reconcile.
    - The legacy digest graded the release 30 (out_of_scope), which was wrong.
  - A default acceleration (8-K 2.04), restructuring, forbearance or bankruptcy (core `existence` floor).
  - An NYSE suspension or delisting determination (core 3.01, 85-95).
  - Financing with dilution of 20% or more (core 85-95), or 10-20% with the `liquidity` lift.
  - A new enterprise SurfOS customer: the lead override above, or p ≥ 10.
  - M&A as target (`control`), or the sale of a segment.
  - A new EAS route with total value of $13.3M or more (p ≥ 10).
  - An FAA certificate suspension or revocation, or a fatal accident at Southern or Mokulele. This `rank_high` line moves `eas` and `liquidity` (85-95).
  - No item in the feed window reached Lead other than the Q3 release.
- **Digest (70-89):**
  - **EAS renewal of an incumbent route** (`srfm_eas_orders`). Score 80-84.
    - The revenue is already in the base, so test the annual subsidy as the new increment (core §4.3: rank on the new fact). Show the total as well.
    - Example: "Surf Air Mobility's Mokulele Airlines Awarded $19.4 Million Essential Air Service Contract for Lanaʻi in Hawaiʻi" (2026-09-14, [link](https://investors.surfair.com/news/news-details/2026/Surf-Air-Mobilitys-Mokulele-Airlines-Awarded-19-4-Million-Essential-Air-Service-Contract-for-Lanai-in-Hawaii/default.aspx)). Score about 82.
    - The release says DOT selected Mokulele to "continue" Lanai service, on a four-year term that doubles the prior contract, with 63 weekly round trips.
    - `why`: "EAS renewal, incumbent; $19.4M over 4 yrs (~$4.85M/yr); total 14.6% of $133M, annual 3.6%; term doubled."
    - A new route (not a renewal) is tested on its total: Lead when p ≥ 10.
  - **EAS loss at a Southern or Mokulele town:** core `key_loss` floor 70, mirrored at the annual subsidy.
    - Example: DOT selected Contour Airlines for DuBois, PA, where Southern had served since October 2016 at up to $5.3M a year (p = 4.0). That falls in the 80-89 band.
    - A DOT order is an official record (`confirmed`), about 80.
    - Press-only reporting is `reported` (-10), about 70-74. Source: [CAPA, 2026-10-12](https://centreforaviation.com/news/us-dot-selects-contour-airlines-to-provide-eas-at-dubois-regional-airport-1375160). This loss did not appear in the feed.
  - **CEO or CFO change:** core floor 75, range 75-88.
    - Example: "Surf Air Mobility Appoints Jason Secore as Chief Financial Officer" (2026-09-28, [link](https://investors.surfair.com/news/news-details/2026/Surf-Air-Mobility-Appoints-Jason-Secore-as-Chief-Financial-Officer/default.aspx)), about 78.
  - **Wheels Up Enterprise BrokerOS deployment milestone:** a new phase, scope or value, 72-80. Completing full deployment resolves `srfm_wheels_up_deploy` (floor 80).
  - **Direct offering or GEM draw:** grade by dilution, using the figures above. A $3-10M raise at $0.42 is 5.3-17.6%, which scores 70-88, plus +5 for the `liquidity` lift.
  - **FAA authorization naming SurfOS** (core `regulator` floor 75).
    - Example: "FAA Names OperatorOS as an Authorized System for Electronic Signatures and Recordkeeping" (2026-08-26), about 75.
  - **Earnings-date notice:** fixed at 72, `group:earnings_calendar`, `floor:calendar`.
    - Example: "Surf Air Mobility to Announce Third Quarter 2026 Financial Results on November 5, 2026" (2026-10-23).
  - **First OperatorOS contract in a new segment** (enterprise broker, OEM, a larger Part 121/135 fleet, or outside the U.S.): 70 or more. Score by p if valued.
  - **Reverse-split approval to effectiveness:** 80-88. The core 5.03 range of 55-70 is lifted by `nyse_cure`, and the item resolves `srfm_nyse_cure`, so `floor:open_item` applies.
- **Borderline (40-69):**
  - **A single OperatorOS operator signing on revenue share with no value:** 66-70 each, in `group:srfm_operatoros_signings`. The merged card surfaces at 70 or more.
    - These are binding, named contracts with small operators. They are "clearly minor" only in dollar terms, so they sit at the top of Borderline, not 60-62. The old grader's 62 on Flying Zebra was underscored.
    - Example: "Surf Air Mobility Signs OperatorOS Contract with Flying Zebra" (2026-10-15, [link](https://investors.surfair.com/news/news-details/2026/Surf-Air-Mobility-Signs-OperatorOS-Contract-with-Flying-Zebra/default.aspx)), about 68.
    - A milestone count stated by the company (for example a 10th contract) earns +2-5 on the increment.
  - **Business-update releases with new figures:** 55-69. Score only the new count or figure.
    - "Provides SurfOS Business Update…" (2026-10-29, [link](https://investors.surfair.com/news/news-details/2026/Surf-Air-Mobility-Provides-SurfOS-Business-Update-Highlighting-OperatorOS-Commercial-Launch-and-Enterprise-Growth-Priorities/default.aspx)) gave the 5-contract count and the module roadmap, but no revenue.
    - "Provides Airline Operations Business Update…" (2026-10-07) gave YTD cost-per-block-hour figures and the Kona-Kahului relaunch.
  - **SurfOS President hire:** Barrett Brown, announced 2026-09-23 and effective 2026-09-30, about 60 with the `surfos_revenue` lift.
    - This is a subsidiary officer, not an NEO, unless an 8-K Item 5.02 names him. If it does, use core `neo` (70).
  - **Palantir share-for-license issuances** (scheduled payments under the disclosed nine-year license). Grade by dilution (core §4.2.2). Take the low half of the band because the obligation was already disclosed. No strategic-investor bonus, since these are payments, not investment.
    - Below 5%: 55-62. 5-10%: 70-74.
    - Example (2026-09-30): 4,644,922 registered shares at $0.97 (424B5 plus 8-K Item 8.01), 3.6% of the pre-issue count, and 2,043,226 unregistered shares the same day, for 5.2% in total. Score about 70 as one item, `pct_is_dilution`.
  - **A new route or relaunch:** 55-65. Example: Kona-Kahului (2026-10-07 update).
- **Reject (below 40):**
  - Conference attendance (`reason:promotional`, below 20). Example: "Surf Air Mobility to Participate in the 2026 Maxim Growth Summit" (2026-10-09).
  - Inducement awards (2026-10-02), 0-15.
  - FAA program memberships with no money or authorization: SMART (2026-09-28), the Project Nexus eIPP event (2026-09-15), the CAAT consortium. Below 25.
  - The Palantir resale S-3 for the 2,043,226 shares issued 2026-09-30 (filed 2026-11-05, EFFECT 2026-11-16). It adds no new dilution and repeats a covered issuance: about 30, `reason:already_covered`. The EFFECT scores 0-15.
  - Bare filing receipts, and late results recaps (core §7: 24h for results recaps, 72h for guidance retellings).

## Always surface (floors)
Core floors (core §6) apply as written. Listed here are only the identifiers that reach SRFM, plus the sheet lifts, each tied to a driver or open item.
- **Core floors that occur on this name:**
  - 8-K 2.02 or same-day results: `results` 80, figures first. The 8-K is a duplicate of the release, and the 10-Q is an update only for new facts.
  - Guidance raised, cut or withdrawn, including adj. EBITDA: `guidance` 80.
  - 8-K 3.01 NYSE notices (802.01C or 802.01B): `deficiency` 70, core range 70-78. A delisting determination is `existence` 85.
  - 8-K 2.04 acceleration: `existence` 85. Item 2.06 impairment: core 70-85.
  - 8-K 5.02 CEO or CFO: `neo_ceo_cfo` 75. Another NEO, including the President, if named in a 5.02: `neo` 70.
  - A priced raise with dilution of 10% or more, or a discount of 15% or more: `capital_big` 75. Smaller raises score by core §4.2.2, never below 55 for new primary shares.
  - A final FAA decision naming the company or SurfOS: `regulator` 75.
  - A loss at a sheet key program (EAS town, Wheels Up, Palantir license): `key_loss` 70.
  - The results-date notice: `calendar` 72, fixed.
- **Sheet lifts:**
  - Reverse-split effectiveness (8-K 5.03) or a regained-compliance notice resolves `srfm_nyse_cure`: floor 80 (`open_item`).
  - Repayment, conversion, extension or refinancing of the High Trail convertible resolves `srfm_high_trail_2027`: floor 80 (`open_item`).
  - Under the `liquidity` driver, these score 75 or more:
    - A new debt default, tax lien or covenant breach (minimum liquidity) disclosed in a 10-Q, 10-K or 8-K.
    - A change to the High Trail partial-redemption terms.
  - Repeating going-concern language that was already disclosed is not a new event. Grade only the change.
  - DOT EAS orders that name Southern Airways Express or Mokulele (awards, selection of another carrier, hold-in orders, terminations) are official records under core §9.3. Score by the EAS lines in the ladder, never below 70 for an award or loss of $2M or more a year.
  - A Wheels Up action on BrokerOS (pause, expansion, cancellation, replacement) is a sheet customer acting on the product (core §9.2): floor 70.
  - Changes to the Palantir license, co-sell exclusivity, or equity in Surf Air Technologies, as disclosed by SRFM or Palantir naming Surf Air: floor 70. Palantir's stake changes arrive as SRFM 13D/G filings and are graded by the core form grid.
  - An FAA enforcement action or an accident at Southern or Mokulele: floor 80 (`rank_high`). A fatal accident scores 85 or more.

## Noise patterns
These come from news-monitor rows first seen since 2026-08-20: 17 surfair rows and 46 edgar_srfm rows, all notified=1.
- **EDGAR archive burst (core §8, R-0050).** 40 edgar_srfm rows were first seen 2026-08-31 21:22, with filing dates from 2025-06-26 to 2026-08-11 (old 424B5s, S-3/A, DEF 14A, 10-K/A, old 8-Ks).
  - Gate each row on its own filing date. Rows more than 21 days old score 0-9, `reason:stale`, `archive_burst`, `source_repair`.
  - Exception: a material event first surfaced by the burst takes `late_first_sighting` (event score -15, cap 79, original date in `why`). Two cases:
    - The 2026-07-24 8-K (NYSE notice and reverse-split vote) was 38 days old.
    - The 2026-08-11 8-K (second debenture tranche) was 20 days old, so it is graded with the timeliness rule at -5 to -10.
- **Bare form titles,** e.g. "SURF AIR MOBILITY INC.: 8-K filed 2026-11-05". Open the filing and grade its content, never the receipt (R-0056). If no figures can be extracted, cap at 55 unless an identifier floor applies, and flag `no_figures`.
- **Same-event pairs.** The release is canonical; the filings are duplicates (null score) unless they add facts. Example: the 10-Q added the working-capital deficit, the covenants, the GEM figures and the note maturities, so it is an update at 60-75 on those increments.
  - Q3 release with its 8-K and 10-Q (2026-11-05).
  - CFO release with its 8-K (2026-09-28).
  - Palantir 424B5 with its 8-K (2026-09-30).
  - The Barrett Brown releases of 09-23 and 09-30.
- **Promotional releases** score below 25: conference participation, FAA consortium or program memberships, event attendance, inducement awards.
- **Drip-fed OperatorOS signings.** There were five in a month:
  - Sprintbach (09-17), SkyDance (09-23), Air Fuga (09-30), Clipper (10-06), Flying Zebra (10-15).
  - The Air Fuga title, "Adds New OperatorOS Customer…", does not name the customer.
  - Score each 66-70 in `group:srfm_operatoros_signings`. Do not stack them. Syndicated copies of the same signing (the old hub logged several "fifth OperatorOS deal" copies) are duplicates.
- **Recaps:** core §7 timing applies. There is no sheet override.

## Catalyst calendar
- **Monthly, ongoing:** High Trail partial redemptions, paid in cash or shares. These can bring recurring dilution. Disclosed redemptions go in `group:srfm_high_trail_redemptions`, each graded by dilution.
- **Dec 2026 - Jan 2027:** a reverse-split decision ahead of the NYSE cure deadline (about 2027-01-24, `srfm_nyse_cure`). Failing to cure brings NYSE suspension or delisting procedures. The 802.01B market-cap test also needs watching.
- **Q4 2026 into 2027:**
  - Completion of the Wheels Up Enterprise BrokerOS deployment (no date given, `srfm_wheels_up_deploy`).
  - Onboarding of the 5 OperatorOS operators.
  - AI modules: dynamic pricing, automated crew scheduling, and aircraft-on-ground recovery (2026-10-29 update).
- **About mid-March 2027:** Q4/FY2026 results and the debut of FY2027 guidance. Expect the date notice about two weeks before.
- **2027-07-01:** the High Trail convertible note matures, repayable at 110% (`srfm_high_trail_2027`). It must be repaid, converted or extended. GEM draws and more 424B5s are likely.
- **2027:**
  - EAS rebids as community contracts expire.
  - BETA ALIA CTOL certification timing.
  - The annual meeting (the 2026 meeting was 2026-07-24).
- **2028:** first BETA CX300 deliveries. The High Trail term note is due 2028-01-01.
- **Context only, never scored unless the item names Surf Air:**
  - Wheels Up (NYSE: UP) financial distress.
  - BETA certification news.
  - FAA airworthiness directives for the Cessna Grand Caravan. An AD names the aircraft type, not the company, so it falls under core §9.

## Customers, programs, agencies & counterparties
- **U.S. DOT Essential Air Service:** $44.8M, or 42% of FY2025 revenue (10-K), `big`, disclosure `release` plus official DOT orders.
  - Every award, renewal or loss at a Southern or Mokulele town is SRFM news (core §9.3).
  - Lanai: renewed 2026-09-14, $19.4M over 4 years.
  - DuBois, PA: lost to Contour (reported 2026-10-12). Southern had served it since October 2016 at up to $5.3M a year.
- **Wheels Up:** the Enterprise BrokerOS launch customer. The contract is worth up to $12M over 3 years (ceiling), disclosure `release`.
- **Palantir:**
  - The software platform behind SurfOS, on a nine-year license. Surf Air is Palantir's exclusive partner for selling to Part 135 operators and charter brokers.
  - Palantir is paid largely in SRFM shares and may take equity in Surf Air Technologies.
  - It holds 11,450,053 shares, 8.5% (13G/A, 2026-11-16).
- **OperatorOS customers:** Sprintbach Aviation, SkyDance Air, Air Fuga, Clipper Aviation, Flying Zebra. All are on revenue share with no disclosed values, disclosure `release`.
- **BETA Technologies:** the ALIA order and the Hawaii demonstration. Hawaiian Airlines supported the demonstration.
- **FAA:** the Part 135 certificate; the OperatorOS system-of-record authorization; SMART and CAAT participation (memberships only).
- **Lenders and capital counterparties:** High Trail (notes), GEM Global Yield (share purchase agreement), Clarus Capital, JGB Partners, SkyWest, Tecnam, and the debenture purchasers.
- **Textron Aviation:** Grand Caravan fleet purchases.

## Competitors & read-through
- **EAS rivals:** Contour, Boutique Air, Cape Air and SkyWest compete on EAS rebids.
  - A rival's selection at a Southern or Mokulele town is an SRFM loss only when the DOT order or the source names Southern, Mokulele or the incumbent route (core §9.3 and §9.4).
  - A confirmed replacement is `money` bad news, scored under the EAS loss line.
- **Wheels Up:** only Wheels Up actions on BrokerOS count (core §9.2). General Wheels Up distress that does not name Surf Air is context only (catalyst calendar).
- **BETA:** a certification slip counts only when BETA or Surf Air states a change to Surf's delivery dates. Otherwise it is context only.
- **Caravan airworthiness directives:** context only unless the source names Southern or Mokulele.
- **Out of scope unless Surf Air is named** (`reason:out_of_scope`, 0-15): Blade, Joby or Archer news; airline-software vendors (Sabre, Amadeus); AI operations at Ryanair or Google; Electra or REGENT.
- **Published text** (`why`, `note_hook`) states only sourced facts. It never adds read-through commentary (core §9, R-0008).

## Source coverage gaps
Collector and ops notes (DOT docket searches, NTSB/FAA data, EDGAR ownership feeds, Wheels Up and BETA IR feeds, Hawaii press, the NYSE noncompliance list) have moved to the worker doc `sources/SRFM.md`. Facts the grader needs:
- **edgar_srfm does not carry everything.** Form 4, Schedule 13G/A, S-8 and EFFECT filings may be missing from the feed. Their absence is never `insufficient_evidence`.
- **DOT EAS orders and press reports of EAS changes** may arrive only through non-covered sources. They pass the read-through boundary when they name Southern, Mokulele or the incumbent route.
- **The 2026-08-31 edgar_srfm archive burst** sets the freshness gate described under Noise patterns.

## Grader notes
- **SRFM is never out_of_scope.** The legacy digest run digest-20261105-1700-et-r1 rejected the Q3 release (30) and the 10-Q, 8-K and S-3 (20-25) as out_of_scope under R-0054. Every surfair or edgar_srfm item is about the covered company.
- **Read the filing, not the title.**
  - The 2026-11-05 S-3 is a resale of 2,043,226 Palantir shares already issued, so it adds no new dilution.
  - The 2026-09-30 424B5 issued shares for services, not cash.
- **Company "business update" releases mostly repeat earlier facts.** Score only what is new, such as a new count or figure.
- **The FY adj. EBITDA guidance was cut** from a loss of $30-25M to a loss of $35-32M (midpoint 21.8% wider), citing fuel prices and longer SurfOS implementations. Revenue guidance was reaffirmed. The headline must state the cut, even though the release title says "Meeting Guidance".
- **OperatorOS contracts carry no dollar value.** Never invent one, and never call a small operator an "enterprise" customer.
- **EAS dollar figures are subsidy only,** excluding fares, and multi-year.
  - Say "renewal" or "new route" literally.
  - For a renewal, give the total test and the annual test, for example "total 14.6%, annual 3.6% of $133M".
  - For a new route, the total test sets the band.
- **Pipeline language is a claim, not booked revenue.** "Tens of millions in annual revenue" is management's belief (`prospective`, cap 39 as a standalone item).
- **Micro-cap scale.** Use dilution against 135.2M shares for capital events, never cash or revenue. Check every financing against the $5M/$8M liquidity covenant, and state the result in `why`.
