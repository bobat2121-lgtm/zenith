---
ticker: SATL
name: Satellogic Inc.
as_of: 2026-11-18
asset_class: operating
filer: domestic (10-K, 10-Q, 8-K); CIK 0001874315; FY ends Dec 31
listing: Nasdaq SATL (warrants SATLW)
currency: USD
fx_as_of: 2026-11-18   # reports in USD; convert non-USD contracts (e.g. EUR, CEiiA) at the event-date rate
base_usd: 44300000
base_basis: "LTM to 2026-09-30: 9M 2026 $38.07M + Q4 2025 $6.24M (FY2025 $17.7M - 9M 2025 $11.46M); Q3 8-K Ex.99.1, 2026-11-10"
alt_base: true   # departs from the core order (guidance > quarter x4 > FY): no guidance; Q3 x4 ($64.2M) rejected because one CEiiA delivery drove Q3 Space Systems revenue. Needs owner sign-off.
alt_base_value_usd: 64200000   # Q3 x4, for band-sensitivity checks only
tiny_usd: 443000     # 1% of base (base <= $100M)
lead_usd: 4430000    # 10% of base
shares_basic: 154092763   # 143,510,122 Class A + 10,582,641 Class B, 10-Q cover 2026-11-04
one_pct_dilution_shares: 1540000
terms: ["Satellogic", "NewSat", "Aleph-1", "Aleph Observer", "Merlin.01", "Continuum-1", "Albania-1", "Albania-2", "Mark IV", "Mark V", "Mark VI"]
aliases: ["Satellogic Inc.", "Mnuchin's Satellogic", "CF Acquisition Corp. V (predecessor SPAC)"]
match_traps:
  - {term: "Merlin", case: sensitive, rule: "SATL only with satellite, constellation or Satellogic context. Merlin Labs = MRLN (covered); Merlin Entertainments = off_entity; SpaceX Merlin engines in launch coverage = off_entity"}
  - {term: "Aleph", case: sensitive, rule: "needs satellite context; Aleph Alpha and Aleph Farms are off_entity"}
  - {term: "NewSat", case: insensitive, rule: "bare NewSat may be the defunct Australian operator"}
  - {term: "Mark V", case: sensitive, rule: "may be SOCOM Mark V boats"}
  - {term: "HEO", case: sensitive, rule: "HEO the Australian company vs highly elliptical orbit"}
  - {term: "RPO", case: sensitive, rule: "remaining performance obligations in SATL filings; rendezvous and proximity operations in HEO releases"}
  - {term: "Luno / Slingshot Aerospace / Satlink", case: insensitive, rule: "off_entity"}
thesis_drivers: [sovereign_sales, merlin, recurring_da, fcf_dilution, us_defense]
open_items:
  - {id: palantir_agreement, resolves_on: "renewal, replacement or confirmed end of the five-year $4.0M/yr imagery-credit agreement (signed 2021-11, expires 2026-11)", expires_at: 2027-03-31}
  - {id: albania_extension, resolves_on: "renewal, new term or end of the Government of Albania contract (11-month extension of 2026-01-29, ends about 2026-12)", expires_at: 2027-02-28}
  - {id: merlin01_commissioning, resolves_on: "Merlin.01 payload commissioning complete, or a stated slip", expires_at: 2027-06-30}
  - {id: permanent_cfo, resolves_on: "permanent CFO named (Dustin Greer interim since 2026-08)", expires_at: 2027-06-30}
  - {id: warrants_jan2027, resolves_on: "exercise, amendment or extension of the $8.63 warrants (8,253,454) or the PIPE warrant (2.5M at $20)", expires_at: 2027-01-25}
  - {id: liberty_warrants, resolves_on: "exercise, amendment or extension of the Liberty warrants (5M at $10, 15M at $15, 2.5M advisory at $10)", expires_at: 2027-02-10}
  - {id: sovereign_12m_transfer, resolves_on: "in-orbit transfer to the $12M sovereign defense customer completed or slipped", expires_at: 2027-06-30}
  - {id: sovereign_37m_transfers, resolves_on: "completion or slip of the ~$37M three-satellite transfer", expires_at: 2027-09-30}
  - {id: monitoring_18m_renewal, resolves_on: "renewal or end of the one-year $18M persistent-monitoring contract of 2026-05-26", expires_at: 2027-08-31}
industry_links:
  - {id: space_licensing, kind: regulator, area: "US licensing, spectrum and market-access rules for Earth-observation satellites and their ground stations (FCC Space Bureau earth-station and Earth-exploration downlink rules; NOAA commercial remote-sensing licences) and US export controls on spacecraft and remote-sensing items (BIS EAR, State ITAR Category XV)", actors: "FCC, NOAA, BIS, State", core: true}
group_keys: [earnings_calendar]
---

# SATL — Satellogic Inc.

_Researched 2026-11-18. Fact-checked the same day against SEC EDGAR (submissions index, Q3 8-K Ex.99.1, 10-Q for 2026-09-30, 424B5 of 2026-01-26, 8-K 1.01 of 2026-03-30), satellogic.com/news/press-releases and news-monitor-db._
- Nasdaq: SATL (warrants SATLW). Formerly the CF Acquisition Corp. V SPAC; Cantor is a related party.
- Files 10-K, 10-Q and 8-K as a domestic filer.
- No EDGAR filing and no primary release after 2026-11-10; the latest release is HEO, 2026-10-29.
- Next print: Q4/FY2026, expected mid-to-late March 2027 by analogy with FY2025 (8-K 2.02 and 10-K both filed 2026-03-19). Not yet announced.
- The core rubric governs every band, floor and modifier. This sheet supplies entity rules, bases, programs and examples graded under the core. No line here carries an `owner:` mark.

## Identity & matching
- **Entities:** Satellogic Inc. and its U.S. federal-contracting subsidiaries. Confirm the exact subsidiary name in award records before matching on it.
- **Products (an item naming only the product is SATL news):**
  - NewSat satellites: Mark IV, Mark V (50 cm-class), and Mark VI with inter-satellite links.
  - The Aleph-1 constellation.
  - **Aleph Observer**, persistent monitoring, launched 2026-02-23.
  - **Merlin**, a 1 m daily whole-Earth remap, and Merlin.01.
  - **Continuum-1**, formerly NewSat-34, a Mark IV-g sold to HEO.
  - Albania-1 and Albania-2.
- **Aliases with context guards:** see `match_traps` in the front matter. "Mnuchin's Satellogic" headlines are SATL; Mnuchin's Liberty Strategic Capital holds the warrants.
- **Cross-sheet collisions (check before scoring):**
  - "Merlin": MRLN (Merlin Labs, covered), SATL (Merlin constellation), and SpaceX Merlin engines in Transporter launch coverage.
  - Planet Labs (PL, covered) shares the sector. An item naming only PL is PL's item, never SATL's.
  - An item naming both SATL and another covered company is direct involvement for both: one object per ticker with `also:<TICKER>` (core §10).

## What the stock trades on
1. **`sovereign_sales`: in-orbit satellite sales to governments.** These are large and lumpy.
   - On the Q3 call the CEO said sovereign agreements announced in the past year total about $67M: four agreements covering seven satellites over 12 months, including the ~$37M deal signed after Q3.
   - That total is a `mgmt_claim` and cumulative. Never add it to the individual deals.
2. **`merlin`: Merlin execution.**
   - Merlin.01 launched 2026-10-01 on Transporter-18. Payload commissioning has been underway since mid-October.
   - More launches are planned for H1 2027, with operational service and first Merlin revenue in H2 2027.
   - Management says Merlin is "fully funded by customer contracts" (claim).
3. **`recurring_da`: recurring Data & Analytics.**
   - Aleph Observer conversions.
   - Renewal or loss of the five-year Palantir imagery-credit agreement: $4.0M a year, paid in non-cash consideration (a software license), expiring 2026-11. Unused credits were $0.8M at 2026-09-30.
   - D&A revenue fell from $7.1M in Q2 to $6.6M in Q3, mainly on lower non-cash Palantir revenue.
4. **`fcf_dilution`: free-cash-flow path and dilution.**
   - Adjusted EBITDA has been positive for two consecutive quarters (Q3 +$1.2M).
   - Q3 operating cash flow was $(10.4)M and capex $6.2M. 9M operating cash outflow was $18.8M.
   - Overhang: the Tether notes, the January 2027 warrants and the February 2027 Liberty warrants.
5. **`us_defense`: U.S. defense and intelligence channel.**
   - ONR Slingshot III via IDT.
   - SynMax, the exclusive Merlin maritime channel.
   - President Whitworth, the former NGA Director.

## Materiality bases
- **Revenue base B = LTM $44.3M** (front matter). The release gives no guidance.
  - **Band sensitivity:** under the rejected Q3×4 base ($64.2M) the lead line would be $6.42M. An order between $4.43M and $6.42M is Lead on this sheet but Digest on Q3×4. State p on the LTM base and add "Q3x4 p = x" in `why` when it changes the band.
- **RPO:** $66.9M at 2026-09-30, of which $33.4M falls due within 12 months.
  - It was $80.7M at 2026-06-30. The fall reflects recognized deliveries, not a lost contract.
  - It excludes the ~$37M post-quarter deal.
- **Liquidity:** cash $106.5M at 2026-09-30, plus $2.6M restricted.
- **Tether secured convertible notes:**
  - $30.0M issued 2024-04-12. $18.0M principal is left after $6M converted in April 2026 and $6M in May 2026 (10,000,000 shares in total).
  - Conversion price $1.20; maturity 2028-04-12.
  - Full conversion of the remainder would add 15.0M shares, d = 9.7%.
- **ATM:** $50M through Cantor, Craig-Hallum, Northland and Roth (8-K Item 1.01, report date 2026-03-30; 424B5 filed 2026-03-30). No 2026 sales through 2026-09-30.
- **Registered direct:**
  - 7,399,578 Class A shares at $4.73, about $35.0M gross, priced 2026-01-26 and closed about 01-27. Titan Partners and Craig-Hallum were placement agents; no warrants.
  - Last close before pricing was $5.25 (2026-01-23), a 9.9% discount.
  - Pre-offering basic shares were about 135.2M: 96,966,239 Class A at 2025-09-30, plus 27,692,308 from the October 2025 offering, plus 10,582,641 Class B. That gives d = 5.5%.
- **Warrants (10-Q):**
  - $8.63 warrants: 8,253,454, expire 2027-01-25 (d 5.4%).
  - PIPE warrant: 2.5M at $20, expires 2027-01-25.
  - Liberty warrants: 5M at $10 and 15M at $15, plus a 2.5M advisory warrant at $10, all expiring 2027-02-10. Full exercise d = 14.6%.
- **Shares:** 154.09M basic (front matter). Market cap moves with price: compute it at the event date; never assume a price.
- **Order thresholds (core 4.2.1):**
  - Tiny: below $443K.
  - $443K to $4.43M: Digest by p.
  - Lead: $4.43M or more.
  - Core lead overrides (floor 90 when V ≥ tiny): a first order from a foreign government new to SATL; the first production-scale order of a product (the first paid Merlin data contract counts).
  - Test against total contract value and note the annual run rate in `why`.

## Event ladder for this name
Scores below are worked through the core ladder and modifiers. Historical examples are graded on the current sheet base.

- **Lead (90-100)**
  - **In-orbit sale or sovereign order ≥ $4.43M** (`floor:lead_order`).
    - ~$37M transfer of one Mark V and two Mark VI satellites, to complete by mid-2027, disclosed in "Satellogic Reports Third Quarter 2026 Financial Results" on 2026-11-10 ([8-K Ex.99.1](https://www.sec.gov/Archives/edgar/data/1874315/000143774926036168/ex_1042327.htm)): p = 83.5. The results item carries it, about 92.
    - "Satellogic Signs $18MM USD Agreement with Portugal to Deliver Two Mark V High-Resolution Satellites" (CEiiA), 2026-01-12 (8-K 8.01): p = 40.6, about 93.
    - "Satellogic Signs $12 Million Agreement to Deliver In-Orbit NewSat Satellite to Sovereign Defense Customer", 2026-04-30: p = 27.1, about 92.
    - "Satellogic Secures $18 Million Contract for Persistent Earth Observation Monitoring" (one year, international defense customer), 2026-05-26: p = 40.6, binding, about 92. The old sheet's Digest placement is superseded.
  - **First paid Merlin data or anchor contract ≥ tiny:** lead override, floor 90.
  - **Palantir agreement renewed with terms, or a confirmed end:** `resolves:palantir_agreement`, floor 80.
    - $4.0M a year is 9.0% of B, so a multi-year renewal total ≥ $4.43M scores 90-97.
    - A confirmed end is a `key_loss` mirror at original size, 85-95 (non-cash revenue; say so in `why`).
- **Digest (70-89)**
  - **Same-day quarterly results with figures** (`floor:results` 80). Example: Q3 2026 on 2026-11-10:
    - revenue $16.0M (+342%; Space Systems $9.5M, D&A $6.6M);
    - adjusted EBITDA $1.2M;
    - operating loss $(2.3)M, after Q2's operating income of $0.3M;
    - RPO $66.9M.
    - Without the ~$37M deal this release would score about 85.
  - **CEO exit (Emiliano Kargieman, founder):** `floor:neo_ceo_cfo`, 75-88; +5-10 if abrupt.
  - **CFO in or out** (`floor:neo_ceo_cfo` 75):
    - Rick Dunn steps down (8-K 2026-06-08; resignation effective 2026-08-21 per 8-K 2026-07-28): about 78.
    - Dustin Greer named Interim CFO and principal accounting officer (8-K 2026-08-27): about 75.
    - A permanent CFO: `resolves:permanent_cfo`, 80.
  - **President:** "Frank D. 'Trey' Whitworth, Former Director of the NGA, Appointed as President of Satellogic", release 2026-09-08 (board approval 09-04, effective 09-07, 8-K 5.02): other NEO, `floor:neo`, about 78.
  - **Multi-year named-customer agreement:** "Satellogic and HEO Sign Three-Year Non-Earth Imaging Agreement..." (through 2029, seven-figure minimum each year), 2026-10-29 ([release](https://satellogic.com/news/press-releases/satellogic-and-heo-sign-three-year-non-earth-imaging-agreement-extending-a-six-year-working-relationship/)).
    - The minimum is ≥ $3M total, p ≥ 6.8, so about 82.
    - The release gives no exact figure: write "seven-figure annual minimum", `magnitude_usd` null.
  - **Equity raise** (core 4.2.2, judged on dilution). The $35M registered direct at $4.73, 2026-01-26: d = 5.5%, 9.9% discount (no +5), about 75.
    - d ≥ 10% or a discount ≥ 15% triggers `floor:capital_big` 75 and scores 78-88 or more.
  - **Merlin launch milestone:** "Satellogic Announces Successful Launch of First Merlin Satellite" (Transporter-18, 2026-10-01; release dated 2026-10-02): `proof` plus the `merlin` driver, about 78. Stage: launched, not commissioned.
  - **Merlin.01 commissioning complete:** `resolves:merlin01_commissioning`, 80-88. A stated slip of commissioning, launches or service start ranks like the milestone (bad news).
  - **Slingshot III expansion:** "Satellogic Expands Slingshot III Work with IDT and U.S. Office of Naval Research" (six Mark VI over 18 months; on-orbit work in 2027-28), 2026-09-14.
    - Binding named counterparty, no value: 70-74 default, plus the `us_defense` driver, about 74.
  - **Earnings-date notice:** fixed 75, `group:earnings_calendar`, `floor:calendar`.
  - **Warrant or note events** (by 4.2.2 dilution; a warrant open item gives floor 80):
    - A $6M Tether conversion (5M shares, d ≈ 3.2%): about 60.
    - Any Liberty or January 2027 warrant exercise, amendment or extension: `resolves:` the item, ≥ 80.
- **Borderline (40-69)**
  - **ATM.** The $50M ATM (2026-03-30) was below 20% of market cap unless the cap was under $250M: 60-72, about 65. A new ATM is graded the same way at the event-date market cap.
  - **First S-3 after a lapse:** 40-55; 55-65 if the shelf is ≥ market cap. The last S-3 was filed 2026-03-19.
  - **SynMax channel:** "Satellogic Announces that SynMax will be the Exclusive Maritime Intelligence Channel for Data from the New Merlin Constellation", 2026-09-03 ([release](https://satellogic.com/news/press-releases/satellogic-announces-that-synmax-will-be-the-exclusive-maritime-intelligence-channel-for-data-from-the-new-merlin-constellation/)).
    - Named counterparty, concrete channel, no volume: 55-65, plus the `merlin` driver, about 64.
    - Label it a channel agreement with no value.
  - "Satellogic and HEO Release Images of Merlin.01 in Orbit...", 2026-10-13: about 60. Commissioning is still underway.
  - "Satellogic and SpaceKnow Partner to Extend Persistent Global Intelligence...", 2026-06-30: named counterparty with integration, no volume, about 55.
  - "Satellogic to Launch Two ISL-Equipped Satellites and Sovereign Mark V in October", 2026-09-14: planned, about 50.
  - "Satellogic Supports HEO RPO Mission Operations", 2026-09-14: about 45.
  - **Rival at a sheet key account:** a rival winning at Portugal/CEiiA, Albania, Palantir or a MENA buyer is a possible loss, 50-69 (core §9.4); confirmed replacement is `money` bad news, 70+.
- **Reject (<40)**
  - **Other officers and directors:** Kawar named SVP Space Systems (2026-08-13), about 35; Williamson joins the board (8-K, 2026-06-04), about 35.
  - **Compensation-only 8-K/A:** Greer's $150K one-time bonus, 8-K/A Item 5.02, 2026-10-09: about 20.
  - **Media and investor tours:** the World Space Business Week release, 2026-08-25: about 15, `reason:promotional`.
  - **Routine filings:** routine DEF 14A and AGM 10-20; Form 4 under core §5 (codes A, M, F, G, J 0-10); SC 13G/A <20; S-8 0-15.
  - **Stock-move and thematic pieces:** <20, `reason:out_of_scope`.

## Always surface (floors)
Core floor ids apply as written. SATL identifiers that map to them:
- **8-K Item 2.02 with Ex.99.1** → `floor:results` 80. Read Ex.99.1, figures first.
- **Item 1.01:** grade the agreement (contract by 4.2.1; ATM or credit by 4.2.2).
- **Items 2.03 and 3.02** (note conversions, unregistered issuance): graded by 4.2.2 dilution math. There is no blanket 70.
- **Item 5.02:**
  - CEO or CFO (including interim CFO or principal accounting officer appointed as CFO) → `floor:neo_ceo_cfo` 75.
  - President → `floor:neo` 70.
  - Compensation-only amendments are <25.
- **424B5:** a priced takedown or ATM supplement is graded by 4.2.2. The paired 424B5s of 2026-01-26 and 01-27, and the 8-K of 2026-01-27, are one event: the release is canonical and the rest are `dup_of`.
- **10-Q or 10-K:** core §5 grid. A duplicate of the same-day release unless it adds RPO, a new 10% customer, going concern, subsequent events or share count. The 2026-11-10 10-Q added customer concentration and warrant detail.
- **Key accounts** → `floor:key_loss` 70 on loss, cancellation or a sustained rival win; renewals by 4.2.1:
  - CEiiA (Portugal);
  - HEO (Continuum-1, three-year agreement);
  - the Government of Albania;
  - Palantir;
  - ONR Slingshot III via IDT;
  - SynMax (Theia);
  - Tata (India dedicated capacity);
  - the unnamed ~$37M, $12M and $18M sovereign or defense buyers.
- **Open items:** any item that resolves one in the front matter before its `expires_at` → `floor:open_item` 80.
- **Merlin:** status changes or slips (commissioning complete, next launch, service start, delays) rank on the `proof` rung plus the `merlin` driver.

## Noise patterns
Observed in news-monitor since 2026-07.
- **Press-room reposts under satellogic.com/news/press-room/** are third-party media copies. Judge freshness by the original publication date, not `first_seen`. Examples:
  - "World's Hottest Space Stock Posts Rally That Dwarfs All Rivals": published 2026-06-09, first seen 2026-07-09 and again 2026-09-11 under two URLs. Stale stock-move piece, <15.
  - "Satellogic trepa 400% en Wall Street...": published 2026-07-10, seen 2026-09-11. Stale, <15.
  - "What to know about Europe's push to compete in space": 2026-09-09. Thematic, `out_of_scope` <15.
  - Press-room copies of a company event ("Satellogic taps former US geospatial-intelligence chief as president") are `dup_of` the primary release. They are an update only if they add a figure, party, stage or date.
- **EDGAR archive burst:** 40 `edgar_satl` filings dated 2025-03-26 to 2026-08-27, all first seen 2026-08-31T21:21. Items >21 days old: 0-9, `reason:stale`, `archive_burst`, `source_repair`.
- **Bare EDGAR titles** ("Satellogic Inc.: 8-K filed 2026-11-10"): open the filing and grade the exhibit, never the title (`read_source: true`).
- **Conference notices, award lists and "named to" pieces:** 0-20, `reason:promotional`.
- **Late recaps and retellings:** core §7 timing (results recaps >24h, guidance retellings >72h), `reason:late_repost`.

## Catalyst calendar
Context and timing only. An item scores on its own facts; listed items carry `open_items` ids where one applies.
- **2026-11:** the Palantir imagery-credit agreement (signed 2021-11) expires (`palantir_agreement`).
- **About 2026-12:** the Albania extension ends; a renewal decision is due (`albania_extension`).
- **Q4 2026:**
  - The ~$37M deal enters RPO.
  - Merlin.01 payload commissioning continues (`merlin01_commissioning`).
- **2027-01-25:** the $8.63 warrants (8,253,454) and the PIPE warrant (2.5M at $20) expire (`warrants_jan2027`). Fair-value gains reflect warrant and earnout liabilities that expire in Q1 2027.
- **2027-02-10:** the Liberty warrants expire (`liberty_warrants`). Any exercise is a cash and dilution event.
- **Early 2027:** in-orbit transfer of the $12M satellite to the sovereign defense customer (`sovereign_12m_transfer`).
- **Mid-to-late March 2027:** Q4/FY2026 results and 10-K. The date notice is 75, `group:earnings_calendar`.
- **H1 2027:** more Merlin launches.
- **About 2027-05:** renewal of the one-year $18M monitoring contract of 2026-05-26 (`monitoring_18m_renewal`).
- **By mid-2027:** the ~$37M three-satellite transfers complete (`sovereign_37m_transfers`).
- **H2 2027:** Merlin operational service and first revenue.
- **2027-2028:** Slingshot III on-orbit activities.
- **2028-04-12:** the Tether notes mature.
- **Pending:** a permanent CFO appointment (`permanent_cfo`).

## Customers, programs, agencies & counterparties
- **Concentration (10-Q, 2026-09-30):**
  - Q3: two customers above 10%, together $12.7M (about 79% of Q3 revenue).
  - 9M: one customer above 10%, at $18.0M (about 47%).
  - Two customers made up 82% of receivables.
  - MENA revenue: $3.34M in Q3 (21%) and $7.48M for 9M.
- **Unnamed sovereign buyers:** the ~$37M buyer, the $12M buyer and the $18M monitoring customer. A government statement that unmasks one names the company (core §9.1). Its score depends on whether it adds a new fact (core 4.3); otherwise it is `already_covered`.
- **Named:**
  - CEiiA (Portugal; second Mark V delivered in Q3).
  - HEO (Australia).
  - Government of Albania.
  - Palantir (the 10-Q's "technology company").
  - IDT and ONR Slingshot III.
  - SynMax.
  - SpaceKnow.
  - Tata (India).
- **Funding parties:** Tether Investments (noteholder) and Liberty Strategic Capital (warrants).
- **Launch provider:** SpaceX Transporter rideshares (Transporter-18 on 2026-10-01; NewSat 53 and 54 on 2026-03-30). A launch slip that names a Satellogic payload is a `proof` slip. A generic Transporter delay naming no SATL payload is `out_of_scope`.

## Competitors & read-through
Competitors: Planet Labs (PL, also covered), BlackSky, Vantor (both partner and rival), ICEYE, Pixxel and Airbus.
- Read-through counts only under core §9:
  - the source names Satellogic or a sheet product;
  - a sheet key account acts in SATL's category;
  - a government decision names SATL or a program it is in;
  - a rival wins at a sheet key account (50-69 possible loss).
- Everything else is `out_of_scope` <15: peer wins and financings, sector budgets, market studies.
- Published text states only what the source says. Name Satellogic only when the source does.

## Source coverage gaps
Collector fixes (feed URLs, GlobeNewswire, USAspending, counterparty newsrooms) belong in the worker's `sources/SATL.md`, not here. Grader-facing facts:
- **The `satellogic` key scrapes satellogic.com/news, which mixes primary press releases and third-party press-room reposts.** Treat a press-room URL as secondary press (lowest canonical rank). Freshness runs from the original publication date.
- **Primary releases are missing from the feed.** The Q3 results release of 2026-11-10 (which carried the ~$37M deal) is not on the press-releases page, so the 8-K Ex.99.1 is often the first and canonical record. Other primary releases have also gone missing: SynMax (09-03), all three 09-14 releases, the primary Whitworth release (09-08), the tour (08-25) and Kawar (08-13).
  - A later-arriving primary copy of an event already graded from the 8-K or a press-room copy is a duplicate unless it adds facts.
  - A missing primary item is never `insufficient_evidence`.
- **EDGAR links point to the 8-K cover.** Open Ex.99.1 (`ex_*.htm`) from the filing index before scoring above 39.

## Grader notes
- **Duplicates:** the satellogic.com primary release, the press-room copy, GlobeNewswire syndications (Manila Times, Barchart, Finviz) and the 8-K Ex.99.1 are one event. Canonical order follows core §8 (company release first). Take figures from Ex.99.1 when the two differ.
- **Net income is not profitability.** GAAP net income swings on fair-value marks of the notes, warrants and earnout. Q3 net income of $28.3M includes a $30.0M non-cash gain, while 9M net loss was $110.0M. Lead with revenue, adjusted EBITDA, operating income and cash.
- **Don't add up money:**
  - The ~$67M is cumulative and includes the $37M deal.
  - The $37M sits outside the 2026-09-30 RPO.
  - The RPO fall reflects recognized deliveries, not a lost contract.
- **Revenue mix:** Space Systems is lumpy and recognized on delivery milestones. Data & Analytics (including Constellation-as-a-Service) is the recurring line and includes non-cash Palantir revenue.
- **Stage words:** "launched" ≠ "commissioned" ≠ "in service"; "agreement to transfer" ≠ "delivered"; "channel agreement" ≠ order.
- **No guessing:** never guess the identity of unnamed customers, and never invent a satellite unit price.
- **Units and wording:** GSD is in cm. Releases call satellite sales "in-orbit transfers".
- **Base caveats:** LTM is an `alt_base` pending owner sign-off. Keep it until the owner approves a new base. After the Q4 print, flag `sheet_stale` until it is refreshed (core §12.3).
- **Verification note:** a 2026-11-18 web search for post-2026-11-10 news could not run (shared search budget used up). The checks rested on the EDGAR submissions index and the satellogic.com press-release page, which showed nothing newer than 2026-11-10 and 2026-10-29.
