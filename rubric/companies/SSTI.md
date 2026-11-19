# SSTI — SoundThinking, Inc.

```yaml
as_of: 2026-11-18
asset_class: operating            # private since 2026-11-18; CVR is the only economic instrument left
status: acquired_closed           # Transom Capital buyout closed 2026-11-18; 25-NSE filed same day
coverage: owner_decision_pending  # stays covered until the owner removes it (core §1)
filer: domestic_10k               # CIK 0001351636; Form 15 to follow once the Form 25 takes effect
fiscal_year_end: 12-31
currency: USD
fx_as_of: n/a                     # all figures already in USD
base_usd: 97_800_000              # LTM to 2026-09-30
base_basis: "9M 2026 $73.08M + Q4 2025 $24.76M (FY2025 $104.1M - 9M 2025 $79.34M); my calculation from the Q3 10-Q"
alt_base: false                   # FY2026 guide $99-100M is no longer updated (2026-11-12), so it is not used
tiny_usd: 978_000                 # 1% of B, because B < $100M (core 4.2.1)
lead_usd: 9_780_000               # 10% of B
small_base: false                 # B >= $25M
shares_basic: 13_240_512          # 10-Q cover, 2026-11-05; pre-close; used only for CVR per-share math
cvr_value_per_0_05: 660_000       # $0.05 x 13.24M CVRs, about $0.66M
terms: [SoundThinking, "SoundThinking, Inc.", SSTI, ShotSpotter, SafePointe, CrimeTracer, TechnoLogic, PlateRanger, CaseBuilder, ResourceRouter, "SafetySmart Field Agent", "Transom Signal"]
aliases: ["ShotSpotter, Inc.", "Forensic Logic", "COPLINK X", "LEEDS (police case management)", "Technologic Solutions", "Transom Signal AcquireCo", "Transom Signal MergerSub", "Transom Signal HoldCo", "Transom Signal TopCo"]
subsidiaries_brands: [ShotSpotter, SafePointe, CrimeTracer, TechnoLogic, PlateRanger]
predecessors: ["ShotSpotter, Inc. (until 2023-04)"]
match_traps:
  - {term: "ShotSpotter", case: insensitive, rule: "Crime-blotter use ('ShotSpotter detected N rounds') is not company news; generic use for any gunshot detection (incl. Flock Raven) needs vendor confirmation"}
  - {term: "Technologic", case: insensitive, rule: "Technologic Systems is a different company; needs police-software context"}
  - {term: "LEEDS", case: sensitive, rule: "Leeds (city/club) and LEED buildings are traps; needs NYPD or case-management context"}
  - {term: "SafePoint", case: insensitive, rule: "Only 'SafePointe' with weapons-screening context counts"}
  - {term: "Transom", case: insensitive, rule: "Bare 'Transom' needs SoundThinking or Transom Signal deal context; other Transom portfolio deals are off_entity"}
  - {term: "COPLINK", case: insensitive, rule: "Bare COPLINK (legacy IBM/Forensic Logic history) needs a current CrimeTracer contract"}
  - {term: "Geolitica|PredPol", case: insensitive, rule: "History unless a current contract is named"}
collisions:                        # check the other sheet before scoring (core §1)
  - {term: "PlateRanger", other: REKR, rule: "Named PlateRanger deal counts for both: one object per ticker, also:<TICKER>"}
  - {term: "SafePointe venue/hospital win", other: [EVLV, XTRAF], rule: "Confirm vendor; a rival win at a named SafePointe site is a possible loss for SSTI (core 9.4)"}
removed: []
thesis_drivers:
  - {id: cvr, text: "FY2027 ShotSpotter + SafePointe revenue vs $73.5M min ($0.50) / $87.0M max ($3.00)"}
  - {id: shotspotter_retention, text: "ShotSpotter renewals, non-renewals, delays"}
  - {id: nyc, text: "NYC/NYPD ShotSpotter and TechnoLogic, 27-29% of revenue"}
  - {id: chicago, text: "Chicago 'Gun Violence Detection Technology' solicitation"}
  - {id: safepointe_healthcare, text: "SafePointe hospital demand incl. California AB 2975"}
open_items:
  - {id: owner_keep_remove, text: "Owner decides whether SSTI stays covered after the close", expires_at: 2026-12-31}
  - {id: form15, text: "Form 25 effective (~2026-11-28) then Form 15 filed; EDGAR goes dark", expires_at: 2026-12-31}
  - {id: detroit_renewal, text: "Detroit council decision on ShotSpotter after the extension ends March 2027", expires_at: 2027-04-30}
  - {id: chicago_award, text: "Chicago gunshot-detection solicitation award or cancellation", expires_at: 2027-12-31}
  - {id: cvr_determination, text: "CVR milestone determination or payment statement", expires_at: 2028-12-31}
groups: [wd_roundup, ssti_city_renewals]   # ssti_<slug> per the core custom pattern
```

_Researched 2026-11-18. Was listed on Nasdaq as SSTI. Went private on 2026-11-18, and the 25-NSE was filed that day. CIK 0001351636. Fiscal year ends Dec 31. There is no next earnings date: the company held no Q3 2026 call and "does not expect to" host calls in future ([Q3 ex99.1](https://www.sec.gov/Archives/edgar/data/1351636/000119312526458411/ssti-ex99_1.htm)). Once the Form 25 takes effect it intends to file a Form 15, which ends 12(g) registration and suspends Section 13 and 15(d) reporting ([8-K 2026-11-18](https://www.sec.gov/Archives/edgar/data/1351636/000114036126044628/ef20085875_8k.htm), verified 2026-11-18). Status event: the Transom Capital buyout closed on 2026-11-18. The owner should decide whether to keep or remove SSTI (`open_item: owner_keep_remove`). Until then it stays covered, and after the close only final filings and the CVR drivers below rank (core §1)._

## Identity & matching
- **Legal entities:** SoundThinking, Inc. (ShotSpotter, Inc. until 2023-04), now a wholly owned subsidiary of Transom Signal AcquireCo, LLC. Merger sub: Transom Signal MergerSub, Inc. Rollover entities: Transom Signal HoldCo, Inc. and Transom Signal TopCo, LP. Equity: Transom Capital Fund IV, L.P.
- **Brands and units that count as SSTI news:**
  - **ShotSpotter** (Respond, Investigate, SiteSecure, SecureCampus)
  - **SafePointe** (weapons screening)
  - **CrimeTracer** (formerly COPLINK X / Forensic Logic)
  - **TechnoLogic** (Technologic Solutions; formerly LEEDS; NYPD case management)
  - **PlateRanger** (LPR, powered by Rekor)
  - CaseBuilder, ResourceRouter, SafetySmart Field Agent
- **Context guards:** see `match_traps` and `collisions` in the front matter. Wrong entity scores 0-5, `reason:off_entity` (core §1).

## What the stock trades on
The common stock no longer trades. The only economic instrument left is the non-transferable CVR, worth up to $3.00 per share. Drivers, ranked (ids match `thesis_drivers`):
1. **`cvr`:** ShotSpotter plus SafePointe revenue for FY2027, measured against a $73.5M minimum ($0.50) and an $87.0M maximum ($3.00) ([8-K 2026-09-29](https://www.sec.gov/Archives/edgar/data/1351636/000119312526406024/d107296d8k.htm)).
2. **`shotspotter_retention`:** non-renewals and delayed renewals cut Q2 2026 revenue by about $2.2M ([Q2 ex99.1](https://www.sec.gov/Archives/edgar/data/1351636/000119312526349212/ssti-ex99_1.htm)).
3. **`nyc`:** the largest customer. It was 27% of Q2 2026 revenue (Q2 10-Q) and 29% of FY2025 revenue (10-K, as quoted). ShotSpotter has a three-year renewal worth about $21.8M (announced 2025-02-18). TechnoLogic has a three-year renewal worth about $43M (announced 2025-03-20). Both expire around early 2028.
4. **`chicago`:** the gunshot-detection solicitation ("Gun Violence Detection Technology") is still open. A win would be pure upside.
5. **`safepointe_healthcare`:** demand from healthcare, including California AB 2975 hospitals. This revenue counts toward the CVR.
6. **CrimeTracer, TechnoLogic and PlateRanger:** they matter to the business but not to the CVR. After the close they take no thesis lift (`segment immaterial to the CVR: -5`, core 4.4).

## Materiality bases
- **Revenue base B: $97.8M LTM** to 2026-09-30 (my calculation). This is 9M 2026 revenue of $73.08M plus Q4 2025 revenue of $24.76M (FY2025 $104.1M minus 9M 2025 $79.34M) ([Q3 10-Q](https://www.sec.gov/Archives/edgar/data/1351636/000119312526458488/ssti-20260930.htm)). FY2026 guidance was $99-100M, cut on 2026-08-13 from $109-111M. On 2026-11-12 the company said it would not update guidance, so the guide is not used as the base.
- **Thresholds** (B < $100M, so tiny = 1% of B; test total contract value, note the yearly run-rate in `why`):
  - Tiny: below **$978K** (1%).
  - Core 4.2.1 rows on this base: 1-3% = $978K-$2.93M; 3-10% = $2.93M-$9.78M; lead ≥ **$9.78M** (10%).
- **CVR yardstick** (drives the `cvr` thesis lift, not the magnitude row):
  - From $73.5M to $75.5M, each $500K of 2027 ShotSpotter plus SafePointe revenue adds $0.05 per CVR.
  - From $75.5M to $87.0M, each $250K adds $0.05.
  - With 13,240,512 shares (10-Q cover, 2026-11-05), $0.05 per CVR is about $0.66M of total CVR value.
  - So a ShotSpotter or SafePointe contract adding $250-500K or more of FY2027 revenue moves the CVR even though it sits below the $978K tiny line. Grade it by core 4.2.1 (below tiny 25-39), then apply the `cvr` thesis lift (+5-15, core 4.4), which places most such contracts at 40-54 (Borderline). A non-renewal or loss of the same size ranks the same.
- **ARR and the CVR starting point:**
  - ARR was $95.4M at the start of 2026.
  - Guidance for ARR entering 2027 was cut to "over $100M" from $110M ([Q2 ex99.1](https://www.sec.gov/Archives/edgar/data/1351636/000119312526349212/ssti-ex99_1.htm)).
  - ShotSpotter was about 64% of Q2 2026 revenue, down from 68% in Q2 2025 (Q2 10-Q). On the LTM base that is roughly $62.6M (my calculation). SafePointe revenue is not broken out.
  - The $73.5M minimum therefore needs real growth.
- **Liquidity at 2026-09-30:** cash $9.5M. The credit line had $4.0M drawn and about $36.0M available. The Columbia Bank (formerly Umpqua Bank) credit agreement dated 2018-09-27 was terminated at the close (8-K 2026-11-18, verified). Transom Fund IV committed up to $120.6M of equity.

## Event ladder for this name
Bands, floors and rung ranges are the core's (§2-§6). This section lists only SSTI examples and the sheet's thesis lifts.

**Lead (90-100)**
- Event types:
  - Buyout steps by core `control` and `floor:buyout` (close, tender result, rival bid or termination).
  - A won or lost contract with total value ≥ $9.78M (`floor:lead_order` / `key_loss`).
  - An NYC cancellation or non-renewal decision (`nyc` driver lifts `key_loss` to Lead).
  - A Chicago award (`chicago` driver; `resolves:chicago_award`).
  - A CVR milestone determination or payment statement (`cvr` driver; `resolves:cvr_determination`).
- Examples:
  - "Transom Capital Completes Acquisition of SoundThinking", 2026-11-18. 9,255,095 shares were tendered (about 69.5%) at $8.00 plus one CVR of up to $3.00 ([8-K](https://www.sec.gov/Archives/edgar/data/1351636/000114036126044628/ef20085875_8k.htm), verified). Score 95 (core anchor).
  - "SoundThinking to be Acquired by Transom Capital Group", 2026-09-29 ([8-K](https://www.sec.gov/Archives/edgar/data/1351636/000119312526406024/d107296d8k.htm)). Score 92.
  - "SoundThinking Highlights Major Multi-Year Customer Renewals in Q2 2026", 2026-07-02: more than $23M of total contract value (p = 23.5, aggregate), retention not net-new ([release](https://www.soundthinking.com/press-releases/soundthinking-highlights-major-multi-year-customer-renewals-in-q2-2026)). Score 90, `floor:lead_order`; `why` states the terms and that these are renewals.
  - Q2 2026 results, 2026-08-13: FY guidance cut to $99-100M from $109-111M (about -10% at midpoint) and adjusted EBITDA margin guidance cut to 8-9% from 16-18% ([ex99.1](https://www.sec.gov/Archives/edgar/data/1351636/000119312526349212/ssti-ex99_1.htm)). Score 92.

**Digest (70-89)**
- Event types:
  - Same-day quarterly results (core `floor:results`; none expected after the close).
  - Tender launch or extension (SC TO-T, SC 14D9: core 80-90).
  - Named city council votes, renewals or cancellations of ShotSpotter at $978K-$9.78M (core 4.2.1 plus 9.2; `group:ssti_city_renewals` when several land together).
  - Statewide or record CrimeTracer deals.
  - Named SafePointe hospital, health-system or casino go-lives (core §7 venue tier: health systems individually 70-80).
  - A new country.
  - Changes to named executive officers (core `floor:neo_ceo_cfo` / `neo`).
- Examples:
  - "SoundThinking, Inc. Reports Third Quarter 2026 Financial Results", 2026-11-12: revenue $25.0M (flat year on year), adjusted EBITDA $2.2M, net loss $8.5M, no guidance, no call ([ex99.1](https://www.sec.gov/Archives/edgar/data/1351636/000119312526458411/ssti-ex99_1.htm)). Score 80.
  - Tender offer launch (SC TO-T and SC 14D9), 2026-10-20. Score 82.
  - Detroit council 5-4 vote for a nine-month extension of about $2.1M through March 2027 (p = 2.1) ([WXYZ](https://www.wxyz.com/news/region/detroit/city-council-approves-extending-shotspotter-contract-in-detroit-through-march-2027); article undated, vote around mid-2026). Score 76.
  - "SoundThinking's CrimeTracer Selected to Support Texas Anti-Gang Program", 2026-10-23: up to 10 TAG Centers, funded by a Texas Office of the Governor grant, "the largest deal in CrimeTracer's history", no dollar value ([release](https://www.soundthinking.com/press-releases/soundthinkings-crimetracer-selected-to-support-texas-anti-gang-program)). Score 72, `status:selected`; no value, never "awarded".

**Borderline (40-69)**
- Event types:
  - Flagship product general availability or a new capability (core `product`).
  - Single-city ShotSpotter go-lives or renewals below the $978K tiny line that add ≥$250K a year of FY2027 revenue (`cvr` lift, 40-54).
  - Single-venue SafePointe wins (`group:wd_roundup`, core §7, 55-68).
  - Court rulings on ShotSpotter evidence (score only the incremental change).
  - Non-executive senior hires.
- Examples:
  - "SafetySmart Field Agent General Availability to All ShotSpotter Customers", 2026-10-23 (first announced 2026-06-23). Score 55.
  - "New PlateRanger Capabilities", 2026-10-23. Score 45.
  - "Appoints David Jochim as SVP of TechnoLogic and Professional Services", 2026-05-14. Score 40.

**Reject (below 40)**
- ESG report (2026-07-01).
- National Police Week post (2026-05-11).
- DEF 14A and DEFA14A proxies.
- S-8 POS and POS AM deregistrations (2026-11-18).
- Archive dumps of old filings.
- Gun-violence opinion pieces and crime blotters.
- ShotSpotter, SafePointe or other contracts below tiny with no CVR effect (25-39).

## Always surface (floors)
Core §6 floors apply as written (`buyout`, `results`, `neo_ceo_cfo`, `neo`, `order`, `key_loss`, `deficiency`). Filing grades follow core §5. Sheet-specific lifts, each tied to a thesis driver:
- **CVR statements** from Transom or the rights agent (Equiniti Trust Company, LLC): floor 85 (`cvr` driver; a determination also `resolves:cvr_determination`, core `floor:open_item` 80 lifted by the driver).
- **NYC actions:** any NYC Council, NYPD, Comptroller or budget action on ShotSpotter or TechnoLogic: floor 75 (`nyc` driver, 27-29% customer; core 9.2 official record). The Comptroller declined to register the ShotSpotter renewal on 2025-02-05, so registration steps matter.
- **City decisions:** any city council vote, RFP or budget line to renew, cut or cancel ShotSpotter at a sheet-listed customer: floor 70 (`shotspotter_retention` driver; core `key_loss` for losses). A loss ranks as high as a win.
- **Chicago:** steps in the "Gun Violence Detection Technology" solicitation: floor 75 (`chicago` driver).
- **25-NSE and Form 15:** fold into the close card. The 2026-11-18 joint release (8-K Ex. 99.1) carries the tender result, so the release is canonical; the 8-K and 25-NSE are `dup_of` it (core anchor). A Form 15 filing is `resolves:form15`, graded 15-25 (core §5 15-12G after a close).

## Noise patterns
- **EDGAR archive burst, first_seen 2026-08-31T21:22:23Z:** 40 edgar_ssti rows covering filings from 2023-11-09 to 2026-08-14, all notified=1. Examples: "10-Q filed 2023-11-14", "NT 10-Q filed 2024-08-15", "DEF 14A filed 2025-04-24". Gate each on its own date: >21 days old scores 0-9, `reason:stale`, `archive_burst`, `source_repair` (core §8).
- **Press-release backfill, first_seen 2026-07-09T18:30:56Z:** 10 `soundthinking` rows published from 2026-01-20 to 2026-07-02, including the Q4 2025 results and Police Week. Grade on the published date; anything >21 days old is stale.
- **Bare EDGAR titles:** e.g. "SOUNDTHINKING, INC.: 8-K filed 2026-11-12". Open the filing (core §5). The canonical is the same-day release, so the filing is a duplicate with no separate score unless it adds facts.
- **Same-day triplet:** the 2026-11-18 release, 8-K and 25-NSE describe one event. The release is canonical (it reports the tender result); the 8-K and 25-NSE are `dup_of` it.
- **Same-minute cluster:** three releases published 2026-10-23 at 12:30-12:32 and ingested together at 12:37. Grade each on its own: one contract and two product items.
- **Corporate filler:** ESG reports, Police Week, conference attendance. 0-20, `reason:promotional` (core §7).
- **Recaps and retellings:** follow core §7 (24h results recaps, 72h guidance retellings).

## Catalyst calendar
- **About 2026-11-28:** the Form 25 takes effect (10 days after filing), then the Form 15 follows (`open_item: form15`). EDGAR coverage goes dark after that.
- **By 2026-12-31:** owner keep-or-remove decision (`open_item: owner_keep_remove`).
- **2027-03 (end of extension):** the Detroit extension expires. Expect a council decision in Q1 2027 (`open_item: detroit_renewal`).
- **2027 (date unverified):** the California AB 2975 hospital weapons-screening requirement drives SafePointe demand.
- **2027-01-01 to 2027-12-31:** the CVR measurement period, plus a 120-day tail for certain limited revenues. A milestone determination is likely in 2028 (estimate; payment timing in the CVR Agreement not verified) (`open_item: cvr_determination`).
- **About early 2028:** both three-year NYC renewals (signed 2025) come up again.
- **Open-ended:** Chicago solicitation (`open_item: chicago_award`). As of 2026-05-13, nine firms had bid, including SoundThinking, and the procurement office gave no timeline ([WTTW](https://news.wttw.com/2026/05/13/critics-ratchet-pressure-johnson-award-new-contract-gunshot-detection-system)).

## Customers, programs, agencies & counterparties
- **NYC / NYPD** (`big`, `release` + `filing_only` share): ShotSpotter and TechnoLogic, 27-29% of revenue.
- **Detroit** (`release`/council record): ShotSpotter since 2022-10. Just over $9M has been spent to date. Extended through March 2027.
- **Q2 2026 renewals** (`release`): Albuquerque (five years, 42 sq mi), Worcester, Richland County SC, Macon-Bibb GA and Peoria (three years each), Fayetteville NC (through 2029), and Massachusetts State Police (two-year CrimeTracer renewal).
- **Texas Anti-Gang Program** (`release`): CrimeTracer, up to 10 TAG Centers.
- **Chicago:** lost in 2024-09. The solicitation is open. The 2026 city budget has $5M for "software maintenance and licensing" that could fund a gunshot-detection contract, against $9M set aside in 2025.
- **California hospitals:** AB 2975 is SafePointe's main healthcare opening.
- **Buyer and holders:**
  - Transom Capital Group, the buyer. Its announcements now replace company IR.
  - Gary M. Lauder and affiliates (about 17.0%) roll equity into Transom Signal TopCo.
  - Veradace (about 15.8%) signed a tender and support agreement.
  - The pre-merger officers, including CEO Ralph Clark, remain officers of the surviving company (8-K 2026-11-18, verified). New board: Russell Roenick, Rob Randolph, Nathan Dastic.

## Competitors & read-through
Core §9 governs. Grade these for SSTI only when the item names a sheet-listed ShotSpotter or SafePointe account or SSTI itself:
- **Flock Safety (Raven):** a sheet-listed city switching away from ShotSpotter is a possible loss, 50-69; confirmed replacement is `money` bad news (70+) (core 9.4).
- **EVLV, XTRAF and CEIA:** a rival win at a named SafePointe site is a possible loss for SSTI (core 9.4). Tenders that do not name SafePointe or a SafePointe account are `out_of_scope`.
- **Rekor (REKR):** the PlateRanger supplier. A named PlateRanger deal counts for both names (one object per ticker, `also:`).
- Published `why` and `note_hook` name SSTI only when the source does (core §9).

## Source coverage gaps
Collector fixes live in `sources/SSTI.md` (worker doc). Grader-facing facts only:
- **The `soundthinking` source stopped at the close.** The last item ingested was the close release (2026-11-18T13:47Z). Later company news arrives via Transom or press; Transom announcements count as SSTI primary sources.
- **`edgar_ssti` carried only the 8-K, 10-Q and 25-NSE for the deal.** SC TO-C, SC 14D9C, SC 13D/13D/A/13G/A, SC TO-T and SC 14D9 amendments, Form 4s, S-8 POS and POS AM never reached the feed. A missing deal filing is never `insufficient_evidence`; a first sighting of one later follows the core §8 freshness rules.
- **Local government decisions** (Detroit, Chicago, NYC) reach the grader only through press or worker-added sources; treat a vote or contract notice as an official record (core 9.2).

## Grader notes
- After the close there is no stock and no future 10-Q or 10-K. Results-date notices will stop. Do not penalize the silence.
- Score CVR-relevant ShotSpotter and SafePointe news above CrimeTracer, TechnoLogic and PlateRanger news (thesis lift vs -5 for CVR-immaterial segments).
- The Q3 2026 release omitted ARR, city counts and guidance. Report what is there and say what is missing.
- Renewal totals are multi-year retention, not new revenue. State the term and keep renewals separate from net-new bookings; they still count on the core 4.2.1 line.
- Texas TAG is a "selected" or "deployed" item with no value given. Never call it "awarded" with a dollar figure.
- The seven director resignations at the close (Clark, Bratton, Goldfield, Grant, Jacobson, Morial, Sharma) are deal mechanics, not executive news, and fold into the close card. Officers stay on.
- Stale facts in old profiles: "pending buyout", "close expected Q4 2026", the $99-100M guidance as current (it is no longer updated), and a $489K tiny line (superseded by $978K).
- Changes this revision: tiny corrected to $978K (1% of B < $100M); CVR sensitivity moved to a `cvr` thesis lift; front-matter block added (drivers, open items, traps, collisions, `fx_as_of`); sheet restatements of core bands removed (guidance-change and 8-K floor lines now point to core); Q2 renewals re-scored 90 and tender launch 82 to match core; close-day canonical set to the release per the core anchor; collector notes moved to `sources/SSTI.md`; group key `ssti_city_renewals` follows the `<ticker>_<slug>` pattern.
