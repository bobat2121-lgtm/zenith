---
as_of: 2026-11-18
asset_class: operating
filer_type: domestic (10-K, 10-Q, 8-K); CIK 0001826681; FY ends Dec 31
fx_as_of: n/a (all figures USD)
base_usd: 26000000
base_basis: "FY2026 revenue guide midpoint, $25.0-27.0M (8-K Ex. 99.1, 2026-11-10)"
alt_base: {value_usd: 34200000, basis: "Q3 2026 revenue $8.56M x 4", used: false}
small_base_rule: false   # B = $26.0M, just above the core $25M line
tiny_usd: 260000         # 1% of B (B < $100M)
lead_usd: 2600000        # 10% of B
shares_outstanding: 51381117   # 2026-10-28
market_cap_usd: "145M-170M (2026-11-06 $2.82; 2026-10-30 $3.315)"
terms: [Palladyne AI, Palladyne AI Corp, PDYN, Palladyne Aerospace and Defense, Palladyne Manufacturing, GuideTech LLC, Warnke Precision Machining, MKR Fabrication, MKR Fabricators, SwarmOS, Palladyne Pilot, Palladyne IQ, IntelliSwarm, Gremlin-X, SwarmStrike, Banshee, ALRRM, SwarmShot]
aliases: [Sarcos Technology and Robotics Corp (pre-2024), Sarcos, Rotor Acquisition Corp (SPAC, closed 2021-09-24)]
match_traps:
  - {term: "BRAIN | Pilot | IQ", case: sensitive, rule: "only next to Palladyne or GuideTech"}
  - {term: "IAI", case: sensitive}
  - {term: "Gremlin-X", case: insensitive, rule: "not DARPA Gremlins or the X-61"}
  - {term: "HARPY | HAROP | Mini HARPY", case: insensitive, rule: "only with Palladyne or U.S. production rights"}
  - {term: "GuideTech", case: insensitive, rule: "reject GuideTech of Santa Clara (semiconductor timing test)"}
  - {term: "Pallad*", case: insensitive, rule: "reject palladium and other Pallad* brands"}
  - {term: "Wolff", case: sensitive, rule: "never match alone"}
  - {term: "Sarcos", case: insensitive, rule: "usually history; pre-2024 Guardian XT and teleoperated robots are stale"}
thesis_drivers: [swarmos_procurement, iai_loitering, backlog_rebuild, cash_runway, brain_volume, iq_fanuc]
open_items:
  - {id: prelim_fy26, what: "Preliminary FY2026 revenue and backlog (last year 8-K 2.02 on 2026-01-13)", expires_at: 2027-02-15}
  - {id: q4_backlog, what: "Q4 2026 bookings and year-end backlog vs $18.7M at 2026-09-30", expires_at: 2027-03-31}
  - {id: iai_dia, what: "Signed IAI definitive implementation agreement under the 2026-06-08 MOU", expires_at: 2027-06-08}
  - {id: wolfpack, what: "AFRL Relentless Wolfpack outcome (Palladyne bid SwarmStrike plus SwarmOS)", expires_at: 2027-06-30}
  - {id: fanuc_first_paid, what: "First paid Palladyne IQ deployment through FANUC America", expires_at: 2027-09-08}
  # expires_at dates set 2026-11-18 by the rubric build; owner to confirm (needs_owner)
rank_high:
  - "Signed IAI definitive implementation agreement, or any U.S. HARPY/HAROP/Mini HARPY award or order naming Palladyne or IAI-US (iai_loitering)"
  - "SwarmOS production contract or program of record (swarmos_procurement)"
  - "Relentless Wolfpack selection or award naming Palladyne (sheet-named core program)"
group_keys: [earnings_calendar, pdyn_exercises]
---

# PDYN — Palladyne AI Corp.
_Researched 2026-11-18. Nasdaq: PDYN. The public warrants (PDYNW) expired 2026-09-24 and were struck by a 25-NSE on 2026-09-28. CIK 0001826681. Fiscal year ends Dec 31. Next earnings: Q4/FY2026 is expected in early March 2027; last year's results and 10-K both came on 2026-03-05. PDYN reports pre-market, with an 8:00 a.m. ET call. A preliminary FY revenue and backlog release is likely in mid-January 2027; last year's 8-K Item 2.02 came on 2026-01-13. Management: Ben Wolff (President & CEO), Trevor Thatcher (CFO), Stephen Sonne (legal executive), and Matthew Muta (President, Commercial & Industrial since 2026-03-02; he left the board; [8-K filed 2026-02-18](https://www.sec.gov/Archives/edgar/data/1826681/000119312526056033/pdyn-20260213.htm))._

## Identity & matching
- **Legal entity:** Palladyne AI Corp., formerly **Sarcos Technology and Robotics Corp.** (renamed 2024). It came public through Rotor Acquisition Corp., a de-SPAC that closed 2021-09-24.
- **Units, all of which resolve to PDYN:**
  - **Palladyne Aerospace and Defense.**
  - **GuideTech, LLC**, plus **Warnke Precision Machining, LLC** and **MKR Fabrication, LLC** ("MKR Fabricators"). All three were bought on 2025-11-14 and announced on 2025-11-17. Consideration was $22.6M ($5.4M cash, 2.67M shares, and an earnout fair value of $1.4M), with an earnout of up to $25M over five years (FY25 10-K; [8-K](https://www.sec.gov/Archives/edgar/data/1826681/000119312525283918/pdyn-20251114.htm)). Warnke and MKR run as Palladyne Manufacturing (Oxford and Saginaw, MI).
- **Products:** SwarmOS, Palladyne Pilot, Palladyne IQ (2.0), IntelliSwarm, BRAIN X2, BRAIN FC1, Gremlin-X, SwarmStrike, Banshee, ALRRM, and SwarmShot (counter-UAS with Federal Ammunition and Mossberg, 2026-10-07).
- **HARPY / HAROP / Mini HARPY:** match only when U.S. rights or Palladyne appear.
- **Context guards** (case rules are in the front matter):
  - "BRAIN", "Pilot" and "IQ" count only next to Palladyne or GuideTech.
  - "Gremlin-X" is not DARPA Gremlins or the X-61.
  - "Sarcos" items are usually history; Guardian XT and teleoperated robots before 2024 are stale.
  - "IAI" is case-sensitive.
- **Collisions to reject** (0-5, `reason:off_entity`; quote pages 0-9, `reason:source_quality`):
  - GuideTech of Santa Clara, a semiconductor timing-test maker.
  - HAROP or HARPY combat use and foreign sales by IAI with no U.S. or Palladyne angle.
  - "palladium" and "Pallad*" brands.
  - "Wolff" on its own.
  - Quote and chart pages such as "Palladyne AI (PDYN)", "Cours/Cotations Palladyne AI Corp." and "Acciones Palladyne AI Corp." Zenith's 3-10 scores were correct.
- **Cross-sheet collisions** (check core §1 before scoring): SwarmOS or Palladyne Pilot named in a Red Cat (RCAT) or Draganfly (DPRO) item is direct involvement for both, so emit one object per ticker with `also:`. A RCAT or DPRO item that does not name SwarmOS or Pilot is not PDYN news. "Pilot" on its own is a generic word on every sheet.

## What the stock trades on
1. **`swarmos_procurement`: SwarmOS moving from exercises to funded procurement.** The 10-Q says the company has "no software product revenue to date".
2. **`iai_loitering`: IAI loitering-munition rights.** The 2026-06-08 MOU gives exclusive rights to make and market HARPY, HAROP and Mini HARPY to the U.S. government. They become value only with a definitive implementation agreement and a DoW buy.
3. **`backlog_rebuild`: revenue growth vs backlog rebuild.** FY26 guide is $25-27M. Backlog fell 24% q/q to $18.7M, with Q3 net new contracts of only $2.7M.
4. **`cash_runway`: cash burn vs ATM dilution.** FY26 operating burn will be "close to or slightly above" the $36M top of the guide. YTD burn is $30.0M and cash is $47.0M. About $12.6M of ATM capacity is left.
5. **`brain_volume`: BRAIN flight-computer volume** with defense primes and interceptor programs.
6. **`iq_fanuc`: commercial Palladyne IQ through FANUC America** (from 2026-09-08). It has produced no revenue yet.

## Materiality bases
- **Revenue base B: $26.0M.** This is the FY2026 guide midpoint ($25.0-27.0M; low end raised 2026-11-10; [8-K Ex. 99.1](https://www.sec.gov/Archives/edgar/data/1826681/000119312526454410/pdyn-ex99_1.htm)). FY25 revenue was $5.2M. The core small-base rule does **not** apply: B is above $25M.
  - Q3 2026 revenue was $8.56M (+895% y/y, +48% q/q), about $34M annualized (the alternate base, not used). YTD revenue through 9/30 was $17.9M.
  - Q3 by line: product (BRAIN and precision components) $3.4M, product-development contracts $2.8M, engineering services $2.4M.
  - Q3 gross margin was about 44% (cost of revenue before D&A).
- **Backlog:** $18.7M at 2026-09-30 ($15.3M funded, $3.4M unfunded). It was $24.6M at 2026-06-30 and $13.9M at 2025-12-31. Total estimated contract value, including options, is $21.8M.
- **Cash:** $47.0M in cash, cash equivalents and marketable securities, with no long-term debt. Q3 burn was $8.7M.
  - The 2026-11-10 release guides Q4 burn "lower than the year-to-date quarterly average", with no figure.
  - The 2026-11-18 deck states about $6.0M for Q4, which is the high end of what the FY guide implies.
- **Shares:** 51,381,117 outstanding at 2026-10-28. The price was $3.315 on 2026-10-30 (deck: $170.1M market cap on 51.3M shares) and $2.82 on 2026-11-06 (13D/A purchase), so market cap is about $145-170M.
- **Order thresholds** (core §4.2.1). Test against total contract value, or obligated value when stated, and note the annual run-rate separately.
  - **Tiny:** below $260K.
  - **1-3% of B:** $260K-$780K.
  - **3-10% of B:** $780K-$2.6M.
  - **Lead:** $2.6M or more.
  - **Lead override (core):** the first production-scale order for SwarmOS or for HARPY/HAROP.
  - **Sheet rule, options:** option exercises cap at 85, even at p ≥10. The options are already inside the disclosed $21.8M total estimated contract value, so an exercise converts ceiling to obligated rather than adding new money (core §4.3 novelty).
- **Capital** (core §4.2.2): d = new shares ÷ 51.38M.
  - 5% of shares is about 2.57M shares, roughly $7-8.5M at $2.82-3.315.
  - 10% is about 5.1M shares.
  - The remaining ~$12.6M of ATM capacity is about 4.5M shares at $2.82, or about 8.7%.
  - Bands are the core table, with no sheet overrides.

## Event ladder for this name
Bands and floors are the core's. The lines below are this name's mapping and examples, and the only sheet-specific lifts are marked.

**Lead (90-100):**
- `rank_high`: a U.S. loitering-munition award or order to Palladyne or IAI-US, or a signed IAI definitive implementation agreement. The rank-high line applies, with thesis lift `iai_loitering` and `resolves:iai_dia`.
- `rank_high`: a SwarmOS production contract or program of record. The core lead override applies (first production-scale order) with `swarmos_procurement`.
- A new binding contract of $2.6M or more (p ≥10).
  - Example: "$4.2 Million U.S. Air Force Contract… Cross-Domain Operations" (2026-07-07, AFRL HANGTIME), p = 16.2, about 90. Old sheets had it as Digest.
- Guidance changed by ≥10% at the midpoint, or going concern, or a ≥20% miss (core §3). A smaller guidance change takes `floor:guidance` 80.
- An own acquisition of a size equal to or larger than B. Core `deal` is 75-88; this name's thesis lift (+5-10, growth driver) takes it to 90.
  - Example: "Palladyne AI Establishes Vertically Integrated U.S. Defense Technology Pioneer Through Transformative Acquisitions" (2025-11-17; [8-K](https://www.sec.gov/Archives/edgar/data/1826681/000119312525283918/pdyn-20251114.htm)). Consideration was $22.6M against FY25 revenue of $5.2M.
- Smaller acquisitions and unit sales stay at core 75-88.

**Digest (70-89):**
- Same-day results, at least 80, figures first.
  - Example: "Palladyne AI Reports Record Third Quarter 2026 Results" (2026-11-10), about 85: Q3 $8.6M, low end of the guide raised, backlog down 24% to $18.7M.
- Preliminary revenue and backlog releases (8-K 2.02/8.01), at least 80 (`floor:results`; `resolves:prelim_fy26` for the FY release).
  - Example: 2026-07-08 ([8-K](https://www.sec.gov/Archives/edgar/data/1826681/000119312526297985/pdyn-ex99_1.htm)), Q2 at about $5.8M and backlog about $24.0M; the final figure was $24.6M.
- Named contracts from $260K to $2.6M: 72-89 by p.
  - Example: "GuideTech Wins New $2.3 Million Contract for BRAIN with Defense Prime" (2026-06-29), which supports a low-cost counter-UAS interceptor. p = 8.8, about 84, plus `brain_volume`.
- Binding named contracts with no value: 70-78 (core default).
  - Example: the Army Disruptive Applications contracts for SwarmOS and Gremlin-X (2026-06-17), about 76 with `swarmos_procurement`.
- Option exercises, capped at 85.
  - Example: the "$2.9 Million STRATFI Contract Option… Bringing Total Award to $10.6 Million" (2026-07-22), p = 11.2, 85.
- A strategic MOU or exclusive-rights deal with a named major counterparty and a term or territory (core scope rule, 60-85).
  - Example: "Palladyne AI and IAI Form Partnership…" (2026-06-08; [8-K Item 8.01](https://www.sec.gov/Archives/edgar/data/1826681/000119312526260664/pdyn-20260608.htm)), about 85: exclusive U.S. rights for up to 10 years, `iai_loitering`. Label it "MOU / exclusive license".
- A named major channel partner (core scope rule, channel).
  - Example: FANUC America (2026-09-08), about 72 with `iq_fanuc`.
- Capital events by core §4.2.2: an ATM supplement or raise with d ≥5% is 70+. A priced raise with d ≥10% or a ≥15% discount takes `floor:capital_big` 75. A new ATM smaller than 20% of market cap scores 60-72.
- CEO or CFO in or out: `floor:neo_ceo_cfo` 75, +5-10 if abrupt.
- Other executive officers (a President, the chief legal officer): `floor:neo` 70.
  - Example: Muta (2026-02-18).
- Relentless Wolfpack selection naming Palladyne: `floor:selection` 75, `rank_high`, `resolves:wolfpack`.

**Borderline (40-69):**
- Exercise and evaluation results, `proof` 60-68, `group:pdyn_exercises`.
  - Examples: "SwarmOS Successfully Performs Again at Army's Premier Division-Scale Test" (2026-08-06), and the PCC6 "highest rating on all nine criteria" (Q3 release).
- Prize stages, 55-62, labeled "finalist, not award".
  - Example: "BRAIN Selected as Finalist in U.S. Army FUZE xTech|Apex Intercept" (2026-10-06), about 58. Zenith scored it 45-66 across copies.
- Integrations with a named counterparty and concrete adoption but no volume: 55-65 by the core scope rule (paid pilot +5). Old sheets scored these 45-55, which is under-scored.
  - SwarmShot with Federal Ammunition and Mossberg (2026-10-07), about 62.
  - NORDA Underdog (2026-08-26) and Orkid Tech (2026-08-19), about 57.
  - Anduril Lattice integration, 55-65.
- ATM sales first disclosed in a 10-Q: core d <5%, 55-65 with `cash_runway`, `pct_is_dilution`.
  - Example: Q3, about 2.05M shares for about $12.1M gross (about $5.90 average), d ≈ 4.2%.
- An S-3 shelf with no takedown: 40-55 (core).
- Approval of a share-pool or RSU dilution vote: 45-55 (core 5.07).
  - Example: the 5,360,659 senior-executive RSUs plus the 4.5M-share plan increase approved 2026-06-08, about 11%.

**Reject (<40):**
- Repeat investor decks (core 7.01, 20-35, or `already_covered` 30-39 when a figure is only the arithmetic of current guidance).
  - Example: the [2026-11-18 deck](https://www.sec.gov/Archives/edgar/data/1826681/000119312526466297/pdyn-ex99_1.htm), about 35. Its "~$6.0M" Q4 burn is the high end implied by the 2026-11-10 FY guide, and the 10/30 market cap is not company news.
- The 25-NSE for expired warrants (2026-09-28), 30-45 like an exchange transfer. Label it "warrants expired; about 9% lower fully diluted count" (20.5M warrants for about 3.4M shares, plus 2.3M contingent shares). Never call it a delisting. It is now >21 days old, so it is `stale`.
- Holder filings with no new Item 4 plan, <30 (core).
  - Example: the Kerber 13D/A (2026-11-13), which fell below 5%.
- Conference attendance, defense-advisory-board appointments, routine proxy and annual-meeting filings, Form 8-K FD boilerplate, Sarcos-era history, and quote pages.

## Always surface (floors)
Core §6 floors apply as written. This name's identifiers map to them as follows.
- **Results:** 8-K Item 2.02, a same-day results release, or a preliminary revenue and backlog release (8-K 2.02/8.01) takes `floor:results` 80. The preliminary FY2026 release also takes `resolves:prelim_fy26`.
- **Guidance:** an FY revenue or burn guide raised, cut or withdrawn takes `floor:guidance` 80.
- **Calendar:** an earnings-date or call notice is fixed at 72, `floor:calendar`, `group:earnings_calendar`.
- **Executives:** 8-K 5.02 for the CEO or CFO takes `floor:neo_ceo_cfo` 75. A President or the chief legal officer takes `floor:neo` 70. Confirm the role from the text.
- **Capital and controls:**
  - A going-concern note, Item 4.02 non-reliance or Item 2.04 takes `floor:existence` 85.
  - A Nasdaq deficiency (3.01), an NT 10-Q/10-K or an auditor resignation takes `floor:deficiency` 70.
  - A priced raise with d ≥10% or a ≥15% discount takes `floor:capital_big` 75.
  - An S-3 shelf alone has no floor (40-55).
- **Named programs** (HANGTIME, STRATFI, ALRRM, Relentless Wolfpack, Disruptive Applications):
  - An official contract action, pre-award notice or award naming Palladyne, GuideTech or SwarmOS takes `floor:order` 70.
  - A downselect or selection naming them takes `floor:selection` 75.
  - Exercise reports and media mentions take no floor; they are `proof`.
- **Federal awards:** an FPDS or USAspending action of $260K or more naming PALLADYNE AI CORP or GuideTech takes `floor:order` 70. Score it by p, and use `late_first_sighting` if it first surfaces after 21 days.
- **Open items:** resolving an unexpired item in the front matter takes `floor:open_item` 80.
- **Key loss:** a loss, cancellation, 1.02, or sustained protest at STRATFI/Warner Robins (Customer A) or another sheet program takes `floor:key_loss` 70.

## Noise patterns
These are from the `palladyne` and `edgar_pdyn` feeds, all notified=1.
- **Conference notices:** "To Participate in 15th Annual ROTH Technology Conference" (2026-11-12), "Upcoming Investor Conferences" (08-31), Needham (07-29) and Northland (06-18). Score 0-20, `reason:promotional` (core §7).
- **Advisory-board hires:** Maj. Gen. Clark (08-10) and Lt. Gen. Gainey (06-22). Score 15-25, `reason:promotional`; these are not officers or directors.
- **Scrape junk:** "Max Michaelis" and "Mike Latimore" (investor.palladyneai.com/analyst/…, published 06-09, first seen 07-09). These are covering-analyst pages (Lake Street, Northland). Score 0-5, `reason:source_quality`.
- **EDGAR archive burst:** 40 `edgar_pdyn` filings dated 2024-12-31 to 2026-08-06, all first seen 2026-08-31T21:22. Score 0-9, `reason:stale`, flags `archive_burst` and `source_repair`. Gate each item on its own date.
- **Bare EDGAR titles:** e.g. "8-K filed 2026-11-10" and "10-Q filed 2026-11-10". Open the filing before scoring above 39 (core §5).
  - When they match the same-day release, they are duplicates.
  - A 10-Q scores only on new disclosures: ATM sales, backlog split, customer concentration.
- **Proxy filings** (DEF 14A, DEFA14A) and routine 5.07 votes: 10-25. Dilutive share-pool approvals are 45-55 (see Borderline).
- **Foreign-language syndications** of releases (German, French, Greek, Ukrainian, Hebrew SwarmShot and IAI copies): duplicates, `dup_of:` the English release.

## Catalyst calendar
- **Q4 2026 bookings** (`q4_backlog`): the backlog rebuild after the Q3 drop. FY2027 appropriations and CR timing gate DoW awards.
- **Through March 2027:** five more DoW exercises after Ivy Mass (per the Q2 release), starting with Northern Strike 26-2. Group them as `pdyn_exercises`.
- **About mid-January 2027** (`prelim_fy26`): preliminary FY2026 revenue and backlog.
- **Early March 2027:** Q4/FY26 results, the 10-K (customer concentration; Customer A was 73% of FY25), and possibly FY27 guidance.
- **Open-ended:**
  - `iai_dia`: the IAI definitive implementation agreement and U.S. assembly-line set-up.
  - `wolfpack`: the AFRL Relentless Wolfpack outcome (Palladyne was 1 of 14 at Industry Day, May 2026).
  - The FUZE Apex Intercept final. This is context, not an open item.
  - `fanuc_first_paid`: the first paid FANUC/Palladyne IQ deployment.
  - A new ATM supplement once the remaining ~$12.6M is used. Score it by core §4.2.2.
- **Early May 2027:** Q1. **June 2027:** the annual meeting (last year's was 2026-06-08).

## Customers, programs, agencies & counterparties
- **U.S. Air Force, AFWERX STRATFI (SBIR Phase II) at Warner Robins ALC** (`release`, `big`): Palladyne IQ depot automation, $10.6M total. It is probably FY25's Customer A (73%); that link is an inference and must not be published.
- **AFRL** (`release`): HANGTIME ($4.2M) and Relentless Wolfpack (SwarmStrike plus SwarmOS bid).
- **U.S. Army:**
  - 4th Infantry Division (Ivy Mass, Disruptive Applications BAA) (`release`).
  - Project Convergence Capstone 6 (`release`).
  - FUZE xTech (`release`).
  - Army Contracting Command PIID W911QY26PA045, "Heavy Lift System" (FPDS, 2026-11-09) (`filing_only`). Value unverified, so leave magnitude null until read.
- **U.S. Navy:** ALRRM (SBIR Phase 2; a Mach 4.5 air-launched missile) (`release`).
- **Unnamed defense prime** (`release`, `call_only` for totals): $2.6M of Q2 BRAIN orders.
- **Partners:**
  - IAI (licensor; royalty-based).
  - FANUC America (channel).
  - Anduril (Lattice integration).
  - Federal Ammunition and Mossberg (SwarmShot).
  - Orkid Tech and NORDA Dynamics.
  - Covered names Red Cat and Draganfly count for PDYN only when SwarmOS or Pilot is named; then both tickers get an object.

## Competitors & read-through
Core §9 governs, and published text never states an implication for Palladyne.
- **Anduril, Shield AI, Skydio, Swarmer** (named in the 10-Q), AeroVironment (Switchblade), Auterion, and **Leidos Black Arrow** (named as a SwarmStrike competitor):
  - A rival's award counts for PDYN only under §9 rule 3: a government decision naming a sheet program Palladyne is in, such as a Relentless Wolfpack award.
  - If the decision confirms Palladyne was not selected, grade it as bad news on the matching win (`money`, 70+, `floor:key_loss`). Otherwise score 50-69 as a possible loss.
  - All other rival swarm or loitering-munition news is `out_of_scope`.
- **IAI's own U.S. moves:**
  - An item naming Palladyne or U.S. production rights is direct involvement.
  - A direct IAI-to-U.S. government HARPY/HAROP sale with no Palladyne role is §9 rule 2 read-through, 50-65. Publish it without naming Palladyne; the MOU still lets Israel sell directly.
- **FANUC installs:** count only when they name Palladyne IQ.
- Other industrial or humanoid robotics: out of scope.

## Source coverage gaps
Collector and ops notes moved to `sources/PDYN.md`. Grader-relevant facts:
- **Official channels:** the company IR feed (investor.palladyneai.com), X (@PalladyneAI) and LinkedIn (linkedin.com/company/palladyneaicorp) are disclosure channels named in 8-K Item 7.01. A post there is a company release for canonical choice.
- **EDGAR:** items arrive as bare titles. Read the 8-K item numbers and Ex. 99.1 at `https://www.sec.gov/Archives/edgar/data/1826681/<accession>/`.
  - 424B5, S-3 and SC 13D/13G may arrive late or never; the Kerber 13D/A of 2026-11-13 was not ingested.
  - A missing expected filing is never `insufficient_evidence`.
- **Federal awards** (FPDS/USAspending, war.gov daily contracts above $7.5M, xtech.army.mil, the IAI press room) are not ingested today.
  - When one first surfaces, gate it on the action date.
  - If it is >21 days old and never surfaced, apply `late_first_sighting` (event score -15, cap 79).

## Grader notes
- **Earnings duplicates:** the press release, the same-day 8-K 2.02 and the 10-Q are one event; the release is canonical. A preliminary release is the first record, so the later release is an update only for new figures (margin, burn, ATM).
- **Late recaps:** use the core §7 timing (24h for results recaps, 72h for guidance retellings). There is no sheet override.
- **Backlog wording:** the company's backlog **includes** funded and unfunded committed contracts and excludes unexercised options. Total estimated contract value adds the options.
  - Keep funded ($15.3M) separate from total.
  - "Net new contracts" is not backlog change.
  - Never call a ceiling revenue.
- **Exercises are not orders:** "successfully performs", "deploys… during exercise" and "highest rating" are proof points. Never headline them as "selected" or "awarded".
- **IAI status:** the deal is an MOU with a license subject to a definitive implementation agreement, up to 10 years with milestones, and a U.S. assembly line at Palladyne's cost. Never write "Palladyne to supply HAROP to the Army" without an award.
- **ATM sales** appear only in the 10-Q and on the call. Score them by core d (see Borderline), flag `pct_is_dilution`, and state the shares and gross proceeds in `why`.
- **Q4 burn figure:** "~$6.0M" first appears in the 2026-11-18 deck. The 2026-11-10 release says only "lower than the year-to-date quarterly average". Treat the deck figure as `company_reported` guidance arithmetic, not a guidance change.
- **No-dollar releases:** most partnership releases carry no dollar value, so never infer revenue. Grade them by the core scope rule (named counterparty with concrete integration: 55-65). Advisory-board and conference releases are promotional.
- **Verification:** the 2026-11-10 Ex. 99.1 and the 2026-11-18 deck were read on 2026-11-18. No web search was possible in this pass because the search budget was spent, so the other sheet facts carry over unchanged from the 2026-11-18 research.
