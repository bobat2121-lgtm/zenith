---
ticker: MRLN
name: Merlin, Inc.
as_of: 2026-11-18
asset_class: operating
filer: domestic (10-K / 10-Q / 8-K); CIK 0002028707; FY ends Dec 31; ex-SPAC (Inflection Point Acquisition Corp. IV, earlier Bleichroeder Acquisition Corp. I), de-SPAC closed 2026-03-16
base_usd: 13800000            # B: latest quarter x4 (Q3 2026 $3.461M x4 = $13.844M), the core 4.2.1 order; no FY guidance exists
base_basis: "Q3 2026 revenue x4; Q3 release (8-K 2.02 Ex.99.1) and 10-Q, both 2026-11-12"
base_date: 2026-11-12
tiny_usd: 138000              # 1% of B (B < $100M)
lead_usd: 1380000             # 10% of B
small_base: true              # B < $25M, so the core 4.2.1 small-base rule applies
shares_outstanding: 102418930 # 10-Q cover, 2026-11-10 (101,693,656 at 2026-09-30); d 5% = 5.12M, 10% = 10.24M, 20% = 20.48M. Excludes 18,655,078 Series A preferred, convertible at $5.00 since the 2026-10-15 reset (10-Q)
cash_usd: 161626000           # 2026-09-30: cash and equivalents $161.444M + short-term investments $0.182M (10-Q balance sheet); excludes $2.6M restricted cash; no debt
market_cap_usd: null          # compute as shares_outstanding x the last close on the event date; never assume a price
terms: ["Merlin Labs", "Merlin Labs, Inc.", "Merlin, Inc.", "Merlin Labs NZ Limited", "Merlin Labs Securities Corporation", "Merlin Pilot", "Merlin Condor", "SkyCourier UX", "Inflection Point Acquisition Corp. IV", "Bleichroeder Acquisition Corp. I", "Apollo Flight Research", "Automated Crew and Workload", "C-130J autonomy", "KC-135 Center Console Refresh", "Autonomous Casualty Evacuation Industry Technology Challenge"]
aliases: ["$MRLN", "Merlin"]
traps:
  - {term: "MRLN", case: sensitive, rule: "ticker or cashtag only"}
  - {term: "Merlin", case: insensitive, rule: "bare name only next to Merlin Labs, MRLN, Merlin Pilot, C-130J/USSOCOM/AFSOC autonomy or Kerikeri; reject SpaceX Merlin engines (Falcon 9 launches carrying PL/SATL satellites), the Rolls-Royce Merlin engine, the AW101 Merlin helicopter, the Fairchild/Swearingen Merlin aircraft, Merlin Entertainments, Merlin Properties and the Cornell Merlin bird-ID app"}
  - {term: "merlin launch", case: insensitive, rule: "Satellogic's Merlin roadmap (SATL coverage.js term); off_entity for MRLN"}
  - {term: "Merlin Chain|$MERL", case: insensitive, rule: "Bitcoin layer-2 token; off_entity; collides with the BTC-treasury names"}
  - {term: "Condor", case: insensitive, rule: "never alone; only 'Merlin Condor' or next to Merlin Pilot; reject Condor Airlines"}
  - {term: "SkyCourier", case: insensitive, rule: "only 'SkyCourier UX' with Merlin; plain SkyCourier is Textron's crewed aircraft"}
  - {term: "Inflection Point|Bleichroeder", case: insensitive, rule: "only Inflection Point Acquisition Corp. IV or Bleichroeder Acquisition Corp. I; other Inflection Point SPACs are off_entity"}
  - {term: "Reliable Robotics|Shield AI|Anduril|AeroVironment|Xwing|Skyryse|Sikorsky MATRIX|Textron|GE Aerospace|Northrop Grumman|Sierra Nevada|Lockheed Martin|Israel Aerospace Industries", case: insensitive, rule: "not MRLN entities; match only when Merlin or one of its sheet programs is named in the same item"}
thesis_drivers: [cash_runway, c130j, new_programs, capital_overhang, civil_cert]
open_items:
  - {id: nasdaq_bid, what: "Nasdaq Rule 5450(a)(1) bid-price deficiency notice (8-K 3.01) after 30 consecutive business days below $1", expires_at: 2027-01-31, note: "earliest about 2026-12-30 if every close from 2026-11-16 is below $1; any close at or above $1 resets the count, so move expires_at when it does"}
  - {id: africom_casevac_demo, what: "AFRICOM CASEVAC Grand Caravan demo flight in Morocco flown, or the King Air phase awarded", expires_at: 2027-03-31, note: "'in the coming months' (AIN 2026-11-16); no official date; set by front-matter author, needs_owner"}
  - {id: opex_2027, what: "Detail of the 2027 opex cut ('meaningfully below' 2026): amount, headcount or layoffs, or an 8-K 2.05", expires_at: 2027-03-31, note: "expected with Q4/FY2026 results in March 2027; no date announced"}
  - {id: ussocom_next_contract, what: "Next USSOCOM C-130J contract or task order after task order 3, either way", expires_at: 2027-06-30, note: "negotiation around April 2027; task order 3 runs to about May 2027 (AIN); set by front-matter author, needs_owner"}
  - {id: c130j_test, what: "First C-130J ground or flight test of Merlin Pilot (IDIQ Stage 3 or 4), or a stated slip of the 'within the next year' guide", expires_at: 2027-11-12, note: "10-Q filed 2026-11-12; depends on integration testing and aircraft availability"}
  - {id: large_aircraft_cert, what: "Named regulator, aircraft or timeline for the large-aircraft civil certification strategy (none named 2026-09-09)", expires_at: 2027-03-31, note: "open timing in the sheet; set by front-matter author, needs_owner"}
  - {id: kc135_ccr, what: "KC-135 Center Console Refresh award decision, GE-Merlin team or a rival", expires_at: 2028-12-31, note: "open timing; GE exclusive teaming agreement's 36-month term ends in 2028 (prospectus); needs_owner"}
groups: [earnings_calendar]   # core key; the body's `group_key=earnings_dates` is not a core key
owner_marks: []               # no line in this sheet carries an owner:<date> mark
---

# MRLN — Merlin, Inc.
_Researched 2026-11-18. Nasdaq Global Market: MRLN. Closed at $0.87 on 2026-11-18, market cap about $88M (https://stockanalysis.com/stocks/mrln/). CIK 0002028707. Fiscal year ends Dec 31. Q4/FY2026 results are expected in March 2027, but no date has been announced. This will be Merlin's first Q4 report as an operating public company; the 10-K filed 2026-03-12 was the SPAC shell's._

## Identity & matching
- **Legal names.** The listed parent is **Merlin, Inc.** Its former names were **Inflection Point Acquisition Corp. IV** (2025-10 to 2026-03) and, before that, **Bleichroeder Acquisition Corp. I** (EDGAR former names). The de-SPAC closed 2026-03-16 (10-Q). The operating company is **Merlin Labs, Inc.** ("Legacy Merlin"), incorporated in 2018 as Apollo Flight Research, Inc. and renamed in 2020. It has two subsidiaries: **Merlin Labs NZ Limited** (the Kerikeri, Bay of Islands test base) and **Merlin Labs Securities Corporation**.
- **Products to match:** **Merlin Pilot**; **Condor**, the large-aircraft autonomy line introduced in May 2026 (match only as "Merlin Condor" or when it appears next to Merlin Pilot); **SkyCourier UX**, a concept with Textron Aviation unveiled in September 2026.
- **Programs to match:**
  - USSOCOM **C-130J autonomy**, formally the "Automated Crew and Workload" program (prospectus).
  - The USAFRICOM **Autonomous Casualty Evacuation (CASEVAC) Industry Technology Challenge**.
  - The **KC-135 Center Console Refresh**.
- **Aliases that need a context guard.** Bare "Merlin" matches only next to Merlin Labs, MRLN, Merlin Pilot, C-130J/USSOCOM/AFSOC autonomy, or Kerikeri.
- **Collisions to reject (off_entity, 0-5):**
  - SpaceX **Merlin** engines. Falcon 9 launches carry PL and SATL satellites.
  - **Satellogic's Merlin** roadmap. The SATL term "merlin launch" in news-monitor `coverage.js` can cross-match.
  - **Merlin Chain** / $MERL, a Bitcoin layer-2 token, which collides with the BTC-treasury names.
  - Merlin Entertainments, Merlin Properties, the AW101 Merlin helicopter, the Rolls-Royce Merlin engine, the Fairchild/Swearingen Merlin aircraft, and the Cornell Merlin bird-ID app.
  - "Condor" alone (usually Condor Airlines), and plain "SkyCourier" (Textron's crewed aircraft).
  - Other Inflection Point SPACs.

## What the stock trades on
1. **Cash runway versus burn, with the stock trading below cash.**
   - At 2026-09-30: $161.6M of cash and short-term investments, no debt, against a market cap of about $88M.
   - Q3 adjusted EBITDA loss: $24.1M.
   - Management targets 2027 opex "meaningfully below" 2026 and says the plan is funded "into 2029" without raises (Q3 release). In August it had said "into fiscal 2028" (AIN).
2. **C-130J program execution.**
   - The $8.9M third task order (2026-11-10) moves the program from design into integration.
   - The 10-Q guides ground and flight testing "within the next year".
   - The next contract is expected to be negotiated around April 2027 (AIN).
3. **New funded defense programs.** AFRICOM CASEVAC ($500K) is one. A KC-135 CCR award or another service award would convert the pipeline.
4. **Capital-structure overhang.**
   - On 2026-10-15 the Series A preferred conversion price (18,655,078 preferred shares outstanding) and the strikes of the PIPE warrants and May 2026 PIPE warrants reset to $5.00 (10-Q). No 8-K was filed for the reset.
   - The stock has closed below $1 on most days since 2026-10-21, so Nasdaq bid-price compliance is a live issue.
5. **Civil certification reset.** On 2026-09-09 Merlin withdrew its New Zealand small-aircraft certification application and moved to a large-aircraft strategy. No regulator, aircraft or timeline was named. Condor, KC-135 and IAI were absent from the Q3 call and 10-Q (AIN).

## Materiality bases
- **Revenue base: $13.8M,** calculated as Q3 2026 revenue of $3.461M x4. There is no formal FY guidance.
  - 10-Q: https://www.sec.gov/Archives/edgar/data/2028707/000162828026073397/mrln-20260930.htm
  - 9M 2026 revenue was $6.657M.
  - In Q3, U.S. government agencies provided $3.437M (99%); New Zealand and commercial revenue was $24K.
- **Remaining performance obligations:** $421K at 2026-09-30, all due within 12 months. This is before the $8.9M task order.
- **Contract-loss provisions recur on USSOCOM components:** $381K in Q3 and $883K over 9M.
- **Liquidity:**
  - Cash and short-term investments were $161.6M, down $22.3M in the quarter from $183.9M.
  - 9M operating cash outflow was $70.8M.
  - Shares: 102,418,930 common at 2026-11-10, plus the Series A preferred convertible at $5.00.
- **Order and contract lines.** Test against total contract value and note the annual run-rate separately.
  - **Tiny:** below $138K (1% of base).
  - **Meaningful:** $138K-$1.38M.
  - **Lead:** $1.38M or more (10% of base). Also lead: any new agency or service, a new aircraft type under a funded contract, or a first production or low-rate order.
- **Capital-event lines:**
  - Digest: new issuance of 5% or more of shares (about 5.1M or more shares).
  - Lead: 15% or more, a discount of more than 15%, or any new convertible or preferred instrument.
  - Digest at least: a reverse split, or a Nasdaq notice under 8-K Item 3.01.

## Event ladder for this name
- **Lead (90-100)**
  - A funded C-130J task order or follow-on contract.
  - First ground or flight test of Merlin Pilot on a C-130J (IDIQ Stage 3 or 4).
  - Extension to production, or to other fixed-wing aircraft under IDIQ Stage 7.
  - A KC-135 CCR award won by the GE-Merlin team.
  - A definitive Condor launch customer.
  - A going-concern doubt, a large dilutive raise, delisting, or a buyout.
  - Example: "Merlin Awarded $8.9 Million Task Order To Advance USSOCOM C-130J Autonomy Program from Design Into Integration", 2026-11-10 (64% of base), https://investors.merlinlabs.com/news-releases/news-release-details/merlin-awarded-89-million-task-order-advance-ussocom-c-130j
- **Digest (70-89)**
  - Same-day quarterly results (floor 80), figures first: revenue, cash, burn, opex plan. Example: "Merlin, Inc. Reports Third Quarter 2026 Results", 2026-11-12, about 85, https://investors.merlinlabs.com/news-releases/news-release-details/merlin-inc-reports-third-quarter-2026-results
  - A new funded demo or prototype contract from a new command. Example: "Merlin Awarded Contract for U.S. Africa Command Autonomous Casualty Evacuation Technology Challenge", 2026-11-11. It is $500K for the initial phase, a Grand Caravan demo in Morocco; about 78.
  - CEO, CFO or President changes. Example: Mark Brunner (CRO) named President, 8-K Item 5.02, 2026-10-27; about 72.
  - Changes to certification strategy, and regulator designations. Examples:
    - "Merlin Announces Plans to Pursue a Civil Certification Strategy for Large Aircraft", 2026-09-09, about 75 and bad news.
    - "Merlin Designated a New Zealand Part 146 Aircraft Design Organization", 2026-08-24, about 70.
  - The earnings-date notice. Example: "Merlin to Report Third Quarter 2026 Results on November 12, 2026", 2026-10-22, fixed 75 (`floor:calendar`), `group_key=earnings_dates`.
  - Quantified MOUs with a named major partner (unit count, aircraft type, term), labelled "non-binding MOU".
- **Borderline (40-69)**
  - Named-OEM concepts with no contract. Example: Cessna SkyCourier UX with Textron Aviation, September 2026, about 60.
  - Hosted demos. Example: "Merlin Demonstrates Autonomous Flight Capabilities at Texas Department of Transportation Project NEXUS eIPP Kickoff Event", 2026-09-10. Merlin was an "invited guest"; about 50.
  - Facility moves. Example: "Merlin Expands Flight Operations with Move to North Central State Airport", 2026-10-20, about 45.
  - Non-executive hires, and MOU talk with no new scope.
- **Reject (<40)**
  - Investor-conference notices. Example: "Merlin, Inc. To Participate in Upcoming Investor Conferences", 2026-10-05, about 15.
  - "Quick Takes" blogs and website essays.
  - 424B3 resale supplements.
  - Backfilled SPAC-era filings.
  - Retellings of the $105M ceiling as revenue.
  - Late secondary recaps of results.

## Always surface (floors)
- **From CIK 0002028707:**
  - 8-K Item 2.02 results: 80+.
  - Item 1.01 or 1.02 contracts or terminations: 70+.
  - Item 2.05 cost-cutting or restructuring: 70+. This is possible with the 2027 opex plan.
  - Item 3.01 Nasdaq deficiency or delisting: 75+.
  - Item 3.02 or 3.03 unregistered sales, or changes to security holders' rights (preferred or warrant terms): 70+.
  - Item 5.02 CEO, CFO or President changes: 70+.
  - Item 5.03 reverse split: 70+.
- **The same floors apply when a 10-Q first discloses such an event.** The 2026-10-15 $5.00 reset appeared only in the 10-Q.
- **USSOCOM, AFSOC or "Automated Crew and Workload" C-130J autonomy news,** including news that does not name Merlin: 70+.
- **KC-135 Center Console Refresh RFP or award:** 70+. A rival team's win is bad news at the same level.
- **Runway:** a going-concern statement, or a change in the stated runway (now "into 2029"): 80+.
- **Earnings-date notices:** fixed 75 (`floor:calendar`), as calendar-card members. Investor-day notices take `floor:investor_day` 80.

## Noise patterns
These come from news-monitor rows for `merlin` and `edgar_mrln` first seen since 2026-08-20: 63 rows, all notified=1.
- **Archive burst on `edgar_mrln`.**
  - 40 filings were all first seen 2026-08-31T21:22:25, with filing dates from 2024-10-07 to 2026-08-20.
  - They include the Bleichroeder S-1/A of 2024-10-07, the SPAC 8-Ks, the PRE 14A, the 25-NSE of 2026-03-16, the Q2 8-K and 10-Q, and the 2026-08-20 424B3 pair.
  - Score below 10 as stale or already covered.
- **Paired 424B3 PIPE resale supplements.** Pairs arrived on 2026-08-20, 2026-10-27 and 2026-11-13, filename `merlinpipeprospectussupple.htm`. Each wraps an already-filed 10-Q or 8-K. Score below 15 as duplicates.
- **Bare form titles.** "Merlin, Inc.: 10-Q filed 2026-11-12" and "8-K filed 2026-11-12" duplicate the results release. Make the release canonical and the filings duplicates (null score). Exception: the 10-Q carries facts the release lacks (RPO, the $5.00 reset, the flight-test wording), so grade those as additive.
- **Same-second page dumps from the `merlin` source.** "FAA SMART Program", "Mark Brunner", "One Brain, Any Aircraft" and "One Seat At A Time" all share first_seen 2026-10-30T18:44:19 and look like website or blog pages.
  - The Brunner page duplicates the 8-K of 2026-10-27.
  - Cap the others below 40 unless they disclose a new FAA contract or approval. Their content could not be verified: the IR site returns 403 to fetchers.
- **Blog and promotional items.**
  - "Moving our civil certification strategy to large aircraft" (2026-09-16) duplicates the 2026-09-09 release.
  - "Quick Takes on the Cessna SkyCourier UX Concept" (2026-09-18) and "Quick Takes on the Texas eIPP Demonstration" (2026-09-21) go below 25.
- **Mis-categorised items.** The 2026-09-09 certification-strategy release is tagged LEGAL. Do not trust `category`.

## Catalyst calendar
- **Nasdaq $1 bid rule (Rule 5450(a)(1)).**
  - The first close below $1 was 2026-10-21. Later closes at or above $1 (10-27, 10-28, 11-11, 11-13 at $1.13) reset the count.
  - If every close is below $1 from 2026-11-16, 30 business days run out around 2026-12-30. A deficiency notice is possible from about 2026-12-30 to January 2027, followed by a 180-day cure period.
- **AFRICOM CASEVAC demo.** Grand Caravan flight in Morocco "in the coming months"; a King Air phase may follow (AIN, 2026-11-16: https://www.ainonline.com/aviation-news/futureflight/2026-11-16/autonomy-developer-merlin-plans-cuts-stretch-cash).
- **Q4/FY2026 results, March 2027.** Expected to detail the 2027 opex cuts (AIN). The company would not say whether cuts include layoffs.
- **USSOCOM next contract.** Negotiation around April 2027. Task order 3 runs about six months, to about May 2027, and brings Merlin to the last milestone before ground and flight test. Six of about eight milestones are cleared (AIN).
- **First C-130J ground and flight testing** is guided "within the next year" and depends on integration testing and aircraft availability (10-Q).
- **2027:**
  - The Bedford, MA hangar and office lease at Hanscom Field is expected to start, with $34.2M of payments through September 2035 (10-Q).
  - The Northrop Grumman MOA term ends July 2027.
- **Open timing:** the large-aircraft certification regulator and the KC-135 CCR decision. The GE teaming agreement has a 36-month term ending in 2028 (prospectus).

## Customers, programs, agencies & counterparties
- **USSOCOM / U.S. Air Force: C-130J "Automated Crew and Workload" IDIQ** (prospectus, 2026-05-13).
  - Merlin is sole prime. The ceiling is $105M, with a five-year ordering period ending in 2029.
  - Seven stages: (1) PDR, (2) CDR, (3) ground test, (4) flight test, (5) takeoff and landing, (6) high-value mission autonomy, (7) additional platforms.
  - CDR was completed 2026-06-04.
  - Task order 1 funded travel only. Task order 2 is $22.3M, of which Merlin bears a $6.35M cost share. Task order 3 is $8.9M (2026-11-10).
  - This program is essentially all revenue.
- **USAFRICOM:** CASEVAC Industry Technology Challenge, initial phase ($500K).
- **U.S. Air Force KC-135 Center Console Refresh:** a pursuit with **GE Aerospace** under an exclusive teaming agreement (36-month term, ending in 2028). It was absent from the Q3 materials.
- **Northrop Grumman:** a memorandum of agreement to integrate combat-air-patrol mission autonomy into Northrop's Mission Autonomy SDK. It ends July 2027 (prospectus).
- **Integration partners:** **Sierra Nevada Corp.** and **Lockheed Martin** (maker of the C-130J), named in the prospectus.
- **Commercial counterparties:**
  - **Textron Aviation:** the SkyCourier UX concept.
  - **Israel Aerospace Industries:** a non-binding MOU signed July 2026 on Part 25 cargo-aircraft autonomy (Q2 release).
- **Regulators:**
  - **CAA New Zealand:** Part 146 designation (2026-08-24) and the SOI 3 milestone. The small-aircraft application was withdrawn 2026-09-09.
  - **FAA:** via the bilateral agreement; also the FAA SMART page in the feed.

## Competitors & read-through
- **Reliable Robotics** (a news-monitor sector-peer source): its FAA certification steps, or Air Force cargo or tanker wins, are negative for Merlin.
- **Shield AI, Anduril, AeroVironment, Xwing and Skyryse,** the competitors named in the prospectus, plus Sikorsky MATRIX (Lockheed). Their wins of C-130 or tanker autonomy work are negative.
- **Lockheed C-130J fleet decisions:** a positive read-through only when the decision explicitly concerns autonomy or reduced crew.
- Grade a read-through item for MRLN only when the source names Merlin or one of its programs listed above. Otherwise it is out_of_scope for this grader.

## Source coverage gaps
- **Small task orders and obligations.** Orders under the $7.5M war.gov announcement floor, and USAspending obligations, are not in the feed. Poll USAspending for recipient "Merlin Labs" (https://api.usaspending.gov/api/v2/search/spending_by_award/) and SAM.gov for "Automated Crew and Workload".
- **Earnings-call-only facts.** Milestone counts, negotiation timing and the runway change surfaced only through the call and AIN; transcripts are not ingested. Add trade press: ainonline.com/futureflight and aviationweek.com.
- **Partner-side releases.** Textron (https://txtav.com/en/newsroom), IAI (https://www.iai.co.il/news-media), GE Aerospace and AFRICOM (https://www.africom.mil/news) can announce Merlin news first.
- **EDGAR items arrive as bare titles.** Pull 8-K item numbers from the EDGAR submissions JSON (https://data.sec.gov/submissions/CIK0002028707.json, `items` field) so the grader can apply Item-level floors. Scan 10-Q text for capital-structure changes that had no 8-K.
- **IR fetching.** investors.merlinlabs.com returns 403 to fetchers, though the RSS source still delivers titles. Use the 8-K Exhibit 99.1 or the wire copy for release bodies.

## Grader notes
- **Duplicates.** The release and its 8-K form one event: make the release canonical. The 424B3 supplements re-wrap prior filings. Syndicated copies (Finviz, Airframer, AvWeb) are duplicates.
- **GAAP net income is not a profit signal.** Q3 net income of $73.8M came from a $103.6M non-cash gain on warrant fair value as the share price fell. Lead with the adjusted EBITDA loss ($24.1M), the operating loss ($31.5M) and cash.
- **Ceiling versus funded value.** Never present the "$100M+"/$105M IDIQ ceiling as revenue or backlog. State each task order's funded value, and say "task order", not "contract award".
- **Stage words stay literal.** "Selected for the initial phase", "invited guest" and "concept" (SkyCourier UX) keep their wording. Label MOUs non-binding.
- **Bad news ranks.** These rank as high as good news of the same size: withdrawn certification applications; contract-loss provisions; slipping flight-test wording (from "initial customer deliveries" in the Q1/Q2 reports to "commencing ground and flight testing" in Q3); opex cuts and layoffs.
- **Stale facts in older profiles,** including news-monitor `coverage.js`, whose MRLN thesis still centres on the NZ/civil path:
  - Cessna Caravan civil certification is no longer a catalyst.
  - The NZ small-aircraft path ended 2026-09-09.
  - Older "remaining contracted revenue" figures are superseded by RPO of $421K plus task order 3.
  - Matt George is CEO and Chairman, no longer President.
