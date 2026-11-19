---
ticker: EVLV
name: Evolv Technologies Holdings, Inc.
as_of: 2026-11-18
asset_class: operating
filer: us_domestic            # 10-K / 10-Q / 8-K; CIK 0001805385; FY ends Dec 31
currency: USD
fx_as_of: n/a                 # USD reporter, no conversion
base_usd: 183500000
base_basis: "FY2026 revenue guidance midpoint ($182-185M), Q3 release 2026-11-10"
alt_base: false               # ARR $140.5M and RPO $325.8M are context only, never the denominator
tiny_usd: 917500              # 0.5% of base (base > $100M)
lead_usd: 18350000            # 10% of base
shares_outstanding: 181385455 # 2026-11-05, Q3 10-Q cover
terms:
  - {term: "Evolv Technologies", case: insensitive}
  - {term: "Evolv Technology", case: insensitive}
  - {term: "Evolv Express", case: insensitive}
  - {term: "eXpedite", case: sensitive}
  - {term: "Evolv Insights", case: insensitive}
  - {term: "Screened by Evolv", case: insensitive}
aliases:
  - {term: "Evolv", case: insensitive, requires_context: [weapons screening, security, venue, stadium, arena, school, district, hospital, health system]}
  - {term: "Express 11.0", case: insensitive, requires_context: [Evolv]}
  - {term: "NewHold Investment Corp", case: insensitive, note: "SPAC predecessor; 'nhic-' prefix on some 8-K documents"}
match_traps:
  - {term: "Evolv AI / evolv.ai", case: insensitive, verdict: off_entity}
  - {term: "Evolv Health", case: insensitive, verdict: off_entity}
  - {term: "EVOLV (climbing gear)", case: insensitive, verdict: off_entity}
  - {term: "Evolver / Evolver DFR (XTI Aerospace)", case: insensitive, verdict: off_entity}
  - {term: "evolve / evolving", case: insensitive, verdict: off_entity}
  - {term: "revolving (credit facility)", case: insensitive, verdict: off_entity, note: "substring hit on naive %evolv% queries"}
  - {term: "Express (bare): Express Inc., Express Scripts", case: insensitive, verdict: off_entity}
  - {term: "expedite (verb, lowercase)", case: sensitive, verdict: off_entity}
thesis_drivers: [arr, rev_mix, new_logos, profitability, legal_overhang, expedite_attach]
open_items:
  - {id: sec_settlement, text: "Commission approval or rejection of the $3.5M SEC settlement in principle", expires_at: 2027-06-30}
  - {id: fy26_guide, text: "FY26 ending ARR $148-150M and revenue $182-185M, tested at the Q4 print", expires_at: 2027-03-31}
  - {id: fy27_guide, text: "First 2027 revenue guidance vs '20% or more' growth incl. 3-4 pt pricing headwind", expires_at: 2027-03-31}
  - {id: customer_b, text: "Identity of or change at Customer B (reseller, 15.3% of FY2025 revenue)", expires_at: 2027-03-31}
group_keys: [earnings_calendar, wd_roundup, evlv_awards]
---

# EVLV — Evolv Technologies

_Researched 2026-11-18; press-release list re-checked on the IR site the same day (latest release: Q3 results, 2026-11-10; nothing newer). Nasdaq: EVLV. CIK 0001805385. Fiscal year ends Dec 31. On the 2026-11-10 Q3 call, management said Q4/FY2026 results and the 2027 outlook would come in "February" (Q4 2025 printed 2026-03-10). The 2026 date notices came 34-36 days before each print. The public warrants (14.3M at $11.50) expired 2026-07-16. The 25-NSE filed that day delists the warrants, not the equity._

## Identity & matching
- **Legal names.** The SEC filer is Evolv Technologies Holdings, Inc. Its former name is NewHold Investment Corp., the SPAC. Releases are issued as "Evolv Technology". Some 8-K primary documents still carry the "nhic-" prefix (nhic-20261106.htm, nhic-20260806.htm, nhic-20260618.htm). The results 8-Ks use "evlv-".
- **Products to match:**
  - Evolv Express (Gen2)
  - Evolv eXpedite, the AI bag screener (eXpedite 3.0 announced 2026-11-09)
  - Express 11.0 software (in beta with customers, per the Q3 call)
  - The "Screened by Evolv" seal
- **Aliases that need a guard.** The front matter has the case flags and context rules.
  - "Evolv" counts only with weapons-screening, security, venue, school or hospital context.
  - "eXpedite" counts only with the exact casing or with "Evolv" nearby.
- **Reject these collisions (0-5, `reason:off_entity`):**
  - Evolv AI (evolv.ai), Evolv Health and EVOLV climbing gear
  - "Evolve" and "evolving" (e.g. "Systems Must Evolve Ahead Of The Next Mission" on the pdw key)
  - XTI Aerospace's "Evolver DFR" (xti key, 2026-10-22)
  - Substring hits on "revolving": XTI's "Revolving Credit Facility with JPMorgan" (2026-11-12) and the Digital Realty "Revolving Credit Facilities" items
  - Bare "Express" (Express Inc., Express Scripts) and the lowercase verb "expedite"
  - Bank of America the bank; Motorola radios and 911 software
- **Retold 2024 stories are stale** (`reason:stale`). These include the NYC subway pilot, the FTC order, the restatement and the BBC/IPVM accuracy reports.

## What the stock trades on
1. **ARR growth and net new ARR (`arr`).** Q3 2026 ending ARR was $140.5M, up 20% y/y from $117.2M. Net new ARR was about $7.8M (Q2 ending ARR was $132.7M). FY26 ending-ARR guidance of $148-150M was reaffirmed 2026-11-10.
2. **Revenue guidance and the purchase vs. subscription mix (`rev_mix`).** Management says earlier pricing changes are a 3-4 point headwind to 2027 revenue growth. It expects 2027 growth of "20% or more" including that headwind. Detail comes with the Q4 print in February.
3. **New-customer momentum and NRR (`new_logos`).**
   - New customers in Q3: 51, against 70 in Q2 and 62 a year earlier. NRR was 108%.
   - Healthcare was 23% of Q3 units booked (18% over the last 12 months).
   - K-12: deployments reach 28 of the 100 largest US districts and 1,900+ school buildings.
   - The company screens for 40+ Fortune 500 companies.
4. **Profitability and cash (`profitability`).** FY26 adjusted EBITDA guidance was raised to $15.5-16.5M (from $15-16M). Q3 adjusted EBITDA was $4.7M and Q3 free cash flow +$3.2M.
5. **Legal and regulatory wind-down (`legal_overhang`).**
   - **SEC:** there is a settlement in principle with the SEC staff, including a $3.5M civil penalty for reporting, books-and-records and internal-controls violations. No marketing-practice violation is alleged. It still needs Commission approval, and its timing is "not predictable" (Q3 10-Q). The 10-Q also refers to "related SEC and DOJ matters".
   - **Class action:** $15.0M, of which $14.3M is insurance-funded. Final approval was granted after the 2026-09-24 hearing.
   - **Derivative actions:** the settlement brings governance reforms and a $1.3M plaintiffs' fee paid by D&O insurers. Final approval came 2026-10-21. The Delaware dismissal stipulations (filed 2026-10-28) await court approval.
   - Q3 "other non-recurring legal and regulatory costs" were $4.8M.
6. **eXpedite attach and Gen2 upgrade renewals (`expedite_attach`).** eXpedite has 115+ customers, about 9% of the base (3% a year earlier). About 88% of new eXpedite customers also bought Express.

## Materiality bases
- **Revenue base: $183.5M.** This is the midpoint of the FY2026 guidance of $182-185M given 2026-11-10 ([Q3 release](https://ir.evolvtechnology.com/news/press-releases/detail/299/evolv-technology-reports-third-quarter-financial-results)). Nine-month 2026 revenue was $137.4M. FY2025 revenue was $145.9M.
- **Backlog.** RPO is $325.8M, of which $131.8M falls due in the next 12 months. ARR is $140.5M ([Q3 10-Q](https://www.sec.gov/Archives/edgar/data/1805385/000180538526000058/evlv-20260930.htm)). These are context, never the denominator.
- **Liquidity.** Cash, marketable securities and restricted cash total $66.9M.
  - MidCap facility (2025-07-29, $75M): a $30.0M term loan is drawn ($28.8M net of issuance costs). The $30M delayed-draw term loan (DDTL) and the $15M revolver are undrawn. All mature 2030-07-01.
  - Covenants: a minimum-ARR covenant ($110.0M at 2026-09-30, stepping up quarterly) and a minimum-liquidity covenant of 50% of borrowings. The liquidity covenant falls away once the litigation and regulatory matters are resolved. An EBITDA covenant starts 2027-06-30.
  - Shares outstanding: 181,385,455 on 2026-11-05.
- **Dollar lines** (test the total contract value and note the annual run rate separately):
  - **Tiny:** $0.92M.
  - **Lead:** $18.4M.
  - Use the core section 4.2.1 table between these lines.
  - Single-venue releases almost never carry values. Without a value, score by the venue tiers below and never estimate a value.
- **Capital.** 1% dilution is about 1.8M shares. Score dilution with core section 4.2.2.
  - A draw on the DDTL or the revolver is 16-24% of base, below the core 25% debt line. It scores 70, a documented lift because a draw tests the `profitability` and liquidity-covenant thesis.

## Event ladder for this name
Core bands apply unless a line below is a documented thesis lift or carries an `owner:` mark.

**Lead (90-100):**
- **Guidance.** A company guidance change starts at the core `guidance` floor of 80. Any change to ending-ARR guidance, or a revenue-guidance change of 3% or more of the midpoint, also moves `arr` or `rev_mix` and lifts the item to 90+. This is a documented thesis lift; changes of 10% or more are Lead under core rules anyway.
  - Example: "Evolv Technology Reports Fourth Quarter Financial Results" (2026-03-10) raised FY26 revenue guidance to $172-178M from $160-165M (+7.7% at midpoint) ([8-K Ex. 99.1](https://www.sec.gov/Archives/edgar/data/1805385/000180538526000011/evlv-20260310exx991.htm)).
- **Control.** A takeover approach or agreement: core `control`, `floor:buyout`.
- **SEC and DOJ.** An SEC order or DOJ action whose terms differ materially from the disclosed $3.5M settlement in principle, or any charges against individuals. Score 90+ and flag `resolves:sec_settlement`.
- **SAFETY Act.** Loss of the SAFETY Act designation for Express or eXpedite.
- **Existence events.** A going-concern note, a covenant breach or default, or 8-K 4.02 non-reliance (the 2024 restatement is history here): core `floor:existence` 85, Lead when it breaches a MidCap covenant.

**CEO or CFO in or out:** core `people`, 75-88 (`floor:neo_ceo_cfo`), +5-10 for an abrupt exit. The CEO is John Kedzierski; the CFO is George C. "Chris" Kutsor.

**Digest (70-89):**
- **Results.** Same-day quarterly results: `floor:results` 80, figures first.
- **SEC approval on the disclosed terms:** 80, `floor:open_item`, `resolves:sec_settlement`. It removes an overhang and the liquidity covenant.
- **Earnings-date notices:** fixed 72, `group:earnings_calendar`, `floor:calendar`.
- **Investor or analyst day notices:** `floor:investor_day` 80. Score 85+ when the notice or the event sets new long-term targets. The 2026-06-09 investor day set the ~25% revenue CAGR target through 2031.
- **Named major customers:**
  - Major pro venues (NFL, NBA, NHL, MLB, MLS stadiums and arenas), new or subscription: 70-78, scored individually.
  - A named health system, a whole district or a multi-site rollout of 25+ units: 70-78.
  - A named Fortune 500 company: 70-78.
- **Renewals.** A renewal at a major pro venue with a Gen2 upgrade or an eXpedite add: 65-72. A renewal the owner upvoted ranks at the top of that range.
- **Customer B** named, or a major reseller added or lost: 75+, `resolves:customer_b`.
- **SAFETY Act.** A new designation or a change: `floor:regulator` 75. A designation for a new product is ~72 (a renewal of an existing one is lower).
- **Legal.** Final legal approvals that remove an overhang: core `legal`, 65-85.
- **Capital.** An equity raise follows core section 4.2.2. A DDTL or revolver draw scores 70.
- **Other named executive officers in or out:** `floor:neo` 70.

Examples:
- "Evolv Technology Reports Third Quarter Financial Results" (2026-11-10), ~85. Revenue guidance was tightened to $182-185M, ARR guidance reaffirmed, adjusted EBITDA guidance raised, and new-customer adds slowed.
- "Evolv Technology to Release Third Quarter Financial Results on November 10, 2026" (2026-10-05), 72. The owner graded it 75; core fixes date notices at 72.
- "Evolv Technology to Host Investor Day on June 9, 2026" (2026-06-01), 80, `floor:investor_day`.
- "Evolv Technology Enters Subscription Agreement With Utah Jazz, Utah Mammoth, and the Delta Center" (2026-10-23), ~75. A new NBA/NHL arena on a subscription.
- "Evolv Express Selected to Support Security Operations at Climate Pledge Arena" (2026-09-28), ~72. A new NHL arena.
- "Evolv Technology Strengthens Position in Houston Market with Continued System Deployment…" (2026-08-18), a Houston Texans renewal, ~72. The owner upvoted it.
- "Evolv Technology Extends Presence in Boston Market with Multi-Year Renewal at TD Garden and Addition of Evolv eXpedite" (2026-07-01), ~70. A renewal with an eXpedite add.
- "Evolv eXpedite Achieves SAFETY Act Designation, Joining Evolv Express as Qualified Anti-Terrorism Technology" (2026-06-10), ~72 on its event date ([IR](https://ir.evolvtechnology.com/news/press-releases/detail/282/evolv-expedite-achieves-safety-act-designation-joining-evolv-express-as-qualified-anti-terrorism-technology)). It arrived 29 days late; see Noise patterns.
- "Evolv Technology Selected as American Hospital Association's Preferred Physical Security Provider" (2026-02-26), ~70. This is a channel, not an order (status `mou`, named counterparty).

**Borderline (40-69):**
- **Plain renewals.** A major pro venue renewal with no upgrade: 60-68.
- **College and single-school wins.** A college stadium, a single campus or a single-district school win: 55-68, `group:wd_roundup`.
- **Software releases.** A major release (eXpedite 3.0, or Express 11.0 at general availability): 45-55.
- **Directors.** A routine independent-director appointment: 40.

Examples:
- St. Louis CITY SC renewal (2026-10-06), ~64. An MLS renewal with no upgrade stated.
- "New Ryan Field Selects Evolv Express® as Official Fan Screening Provider" (2026-08-05), ~62, `wd_roundup`. A college stadium.
- "University of Memphis Selects Evolv Express® to Enhance Fan Screening Experience at Simmons Bank Liberty Stadium" (2026-09-23), ~58, `wd_roundup`.
- "Boston College Extends Relationship with Evolv" (2026-10-29), ~56, `wd_roundup`.
- "Evolv eXpedite 3.0: Now See What Alerted" (2026-11-09), ~48.
- "Evolv Technology Announces the Appointment of Jason Blessing as a New Independent Director" (2026-11-09), ~40. 8-K 5.02, effective 2026-11-06.

**Reject (<40):**
- Investor-conference attendance.
- Seals, "people screened" milestones and awards.
- Alliance memberships.
- Customer testimonials.
- Bare filing receipts.
- Late recaps: results recaps more than 24h after the print, guidance retellings more than 72h after (core section 7).
- Retold 2024 controversies.
- Colliding entities: 0-5.

Examples:
- "Evolv Technology to Participate in Upcoming Investor Conferences" (2026-10-07).
- "Screening 4+ Million People Daily, Evolv Technology Introduces 'Screened by Evolv' Seal" (2026-05-07).
- "Evolv Technology Joins Partner Alliance for Safer Schools" (2026-09-09).

## Always surface (floors)
- **Results:** 8-K Item 2.02 or the same-day results release, `floor:results` 80.
- **CEO or CFO:** 8-K Item 5.02 for the CEO (Kedzierski) or CFO (Kutsor), `floor:neo_ceo_cfo` 75. Board-only 5.02s (2026-02-12 Zuberi/Kühl, 2026-11-09 Blessing) score 25-45 under core rules.
- **Other 8-K items** follow core section 5:
  - 1.01: grade the agreement.
  - 2.01: by role.
  - 2.03: core section 4.2.2.
  - 3.01: deficiency, `floor:deficiency` 70.
  - 4.02: `floor:existence` 85.
- **Item 8.01 with a settlement or regulatory outcome:** 70. Example: the 2026-08-10 8-K on the derivative settlement stipulation and notice.
- **SEC litigation or administrative release, or Commission approval, naming Evolv:** 80 on the disclosed terms (`resolves:sec_settlement`). 90 if the terms differ or the release includes a DOJ action.
- **SAFETY Act status:** any change for Express or eXpedite, `floor:regulator` 75.
- **Calendar:** earnings-date notices fixed 72 (`group:earnings_calendar`). Investor-day notices `floor:investor_day` 80.
- **Customer B:** identified, or a change to it, 75 (`resolves:customer_b`). Customer B is a reseller that was 15.3% of FY2025 revenue (12.6% in FY2024) per the FY2025 10-K.
- **Capital:** a draw on the MidCap DDTL or revolver, 70 (thesis lift). An equity raise follows core section 4.2.2.

## Noise patterns
These come from the evolv and edgar_evlv keys; the evolv source was activated 2026-07-09.

- **Conference attendance.** "Participate in Upcoming Investor Conferences" (2026-10-07) and TD Cowen (2026-05-07): 15.
- **Brand marketing**, such as the seal and alliance releases: 15-20, `reason:promotional`.
- **Customer testimonials.** "Bank of America Stadium Reports Efficient Game-Day Operations Using Evolv Technology" (2026-05-13): 20.
- **Bare EDGAR titles.** These read "Evolv Technologies Holdings, Inc.: 8-K filed 2026-11-10" or "...: 10-Q filed 2026-11-10" and carry no item numbers.
  - An 8-K that duplicates a release is a duplicate (`score: null`).
  - A 10-Q ranks only on new facts it adds: legal or SEC outcomes, the RPO schedule, customer concentration, covenants.
- **EDGAR archive burst, 2026-08-31.** 40 filings dated 2024-11-13 to 2026-08-11 were first seen together, including NT 10-K/10-Q filings and the 25-NSE.
  - Reject the stale ones at 0-9 (`reason:stale`, `archive_burst`, `source_repair`).
  - The 2026-08-10 Item 8.01 derivative-settlement 8-K arrived 21 days after its event and had no press release. It is a first sighting within the window: grade it on content with a -5 to -10 timeliness cut.
  - The Q2 8-K and 10-Q (2026-08-11) arrived 20 days late and duplicate the on-time Q2 release.
- **Press-release batch, 2026-07-09.** Ten releases dated 2026-05-07 to 2026-07-06 arrived together, so gate each one on its own event date.
  - The SAFETY Act item came 29 days late. If no earlier copy surfaced, it is a `late_first_sighting`: event score -15, capped at 79 (~57).
- **Duplicate investor-day notices.** The feed has copies on 2026-05-13 and 2026-06-01, and IR also issued them on 2026-03-10 and 2026-04-21. Treat them as one calendar item. Later copies are duplicates unless they add a date or agenda.

## Catalyst calendar
- **Q4/FY2026 results and 2027 guidance:** February 2027 per management. Expect a date notice about 5 weeks before. Resolves `fy26_guide` and `fy27_guide`.
- **Q4 2026 implied by guidance:**
  - Revenue of $44.6-47.6M ($182-185M less $137.4M for nine months).
  - Net new ARR of $7.5-9.5M.
  - A miss on ending ARR ($148-150M) is bad news and ranks like a beat of the same size.
- **SEC settlement approval:** pending, no date (`sec_settlement`). It would remove the liquidity covenant.
- **Delaware derivative dismissals:** court approval pending (stipulations filed 2026-10-28). Low impact; procedural, 30-55.
- **Q1 2027 results:** about mid-May 2027 (Q1 2026 printed 2026-05-12).
- **Annual meeting:** about mid-June 2027 (the 2026 meeting was 2026-06-18, 8-K 5.07).
- **MidCap EBITDA covenant:** first test 2027-06-30.
- **Products:** Express 11.0 moves from beta to general availability. New "product tiers" and "form factors" are planned, timing not given.
- **Long-term target:** revenue growth "ramp toward an approximately 25% CAGR through 2031" (2026-06-09 investor day, restated in the Q3 release).

## Customers, programs, agencies & counterparties
- **Customer B:** an unnamed reseller partner, 15.3% of FY2025 revenue (`filing_only`, `big`).
- **Motorola Solutions:** distribution agreement since 2020-12 (10-K, `filing_only`). Its weapons-screening deals count for EVLV only when the source names Evolv or Express. Never name Evolv in published text when the source does not.
- **Gwinnett County Public Schools (GA):** a large K-12 account. Under core section 9 rule 2, its board votes on expansion, renewal or cancellation of weapons screening count even when the item omits Evolv. Published text names the board vote only.
- **American Hospital Association:** preferred physical security provider since 2026-02-26. This is a channel, not an order.
- **Health systems:**
  - Present in all of the top-10 health networks, 16 of the top 20 and 61 of the top 100, across 800+ hospital buildings.
  - New in Q3 (`call_only`): Bellin Health, TidalHealth, St. John's Riverside Hospital, and Southwest Healthcare System (part of UHS).
- **Venues (major pro):**
  - Bank of America Stadium (model account; renewal and eXpedite add 2026-03-03)
  - Houston Texans (renewed 2026-08-18)
  - Phillies (renewed 2026-06-04)
  - TD Garden (2026-07-01)
  - Climate Pledge Arena (2026-09-28)
  - Utah Jazz/Delta Center (2026-10-23)
  - Crypto.com Arena (2026-04-14)
  - Houston Astros (2026-03-18)
  - Tennessee Titans (2026-03-12)
  - St. Louis CITY SC (renewed 2026-10-06)
  - Renewals and upgrades disclosed on the Q3 call only (`call_only`, `mgmt_claim`): SoFi Stadium/Hollywood Park, Mercedes-Benz Stadium, Acrisure Stadium, Bridgestone Arena
- **Venues (college):** New Ryan Field (2026-08-05), University of Memphis/Simmons Bank Liberty Stadium (2026-09-23), Boston College (2026-10-29).
- **Fortune 500:** 40+ companies, none named.
- **DHS SAFETY Act Office (S&T):** designations for Express and eXpedite.
- **SEC Division of Enforcement:** settlement in principle awaiting Commission approval.
- **MidCap Financial Trust:** the lender; its covenants are tied to ARR.
- **Plexus Corp.:** non-exclusive contract manufacturer since 2025-11-05, "fully brought onboard" per the Q3 10-Q. The Columbia Tech (Coghlin) distributor licence expired 2025-12-31.

## Competitors & read-through
- **Xtract One (XTRAF, covered):** direct rival in the same verticals.
  - An XTRAF win at a venue, district or health system listed above is a possible EVLV loss: 50-69 (core section 9 rule 4).
  - It becomes `money` bad news at 70+ once the replacement is confirmed.
  - The XTRAF item also ranks on its own sheet.
- **SoundThinking SafePointe:** strongest in hospitals. Transom Capital completed its acquisition of SSTI on 2026-11-18 (8-K and 25-NSE that day), so its public disclosure will fall away.
- **Others:** CEIA OpenGate (private; the news-monitor `opengate` key tracks its school deployments), Liberty Defense HEXWAVE, Garrett, Metrasens.
- **ZeroEyes and Omnilert:** visual gun detection, which competes for budget but does not directly replace screening.

All other rival or sector news is `out_of_scope` (0-15). This includes a peer's win at an account not listed here, weapons-screening market studies, and venue-security legislation.

## Source coverage gaps
Grader-facing facts only. Collector and ops notes belong in the worker doc `sources/EVLV.md` (worker handoff list below).
- **Item codes.** edgar_evlv titles drop item codes. Read the filing or https://data.sec.gov/submissions/CIK0001805385.json (`items`, e.g. 2026-11-09 "5.02,7.01,9.01") before scoring an EDGAR item above 39.
- **Business Wire** is the company's wire and blocks fetchers (403). For results, read the SEC Exhibit 99.1 copy. The IR release is canonical over the 8-K.
- **Legal and SEC outcomes** have appeared only in the 10-Q (class-action and derivative final approvals, the $3.5M settlement in principle). A 10-Q carrying a new legal outcome is new information, not a duplicate.
- **Call-only disclosures** (named venues, health systems, NRR, eXpedite counts) are `mgmt_claim`. Missing releases are never `insufficient_evidence`.

Worker handoff (move to `sources/EVLV.md`):
- **Fix `src/coverage.js` EVLV terms.** The current terms are `["evolv technologies", "evolv technology", "evolv express", "\\bexpedite\\b", "evolv insights", "evolv ai"]`. Drop `"evolv ai"` (wrong company) and make the bare `\bexpedite\b` a case-sensitive "eXpedite".
- **Transcript source** for call-only disclosures: the IR events page https://ir.evolvtechnology.com/news-events.
- **Watch SEC litigation and administrative releases** (https://www.sec.gov/litigation/litreleases.htm) for the final settlement order.
- **School-board and county votes** (Gwinnett and others): add a BoardDocs search on "Evolv Technology" or an alert-style feed.
- **Use Business Wire as a redundancy check** for IR RSS delays like the 2026-07-09 batch.

## Grader notes
- **One event, three records.** The results release, the 8-K 2.02 and the 10-Q arrive the same day.
  - The release is canonical and the 8-K is a duplicate.
  - The 10-Q counts only for new facts. The Q3 10-Q's SEC settlement in principle was one such fact (digest, about 80).
- **Director changes.** An 8-K 5.02 for a director is the same event as the director release.
- **Wording.** Evolv uses "Selects", "Enters Subscription Agreement" and "Extends/Renews" for single-venue deals, and releases rarely give dollar values or unit counts.
  - Label the stage literally ("subscription agreement", "renewal").
  - Score by the venue tiers (major pro 70-78; renewal with upgrade 65-72; plain pro renewal 60-68; college or single school 55-68 in `wd_roundup`). Never estimate a value.
- **"Revenue" vs "ARR" vs "RPO."** Never conflate them.
  - Q3 subscription revenue grew only about 8% ($24.5M vs $22.7M) while ARR grew 20%.
  - Adjusted EBITDA is non-GAAP; the Q3 GAAP net loss was $(15.6)M.
- **"People screened" and daily-visitor counts** are marketing figures, not KPIs.
- **Syndicated copies** (StreetInsider, Seeking Alpha PR, Finviz, Quantisnow, Tiger, Barchart) duplicate the release. Late analyses such as TheStreet's "mixed Q3" piece are `late_repost` (<30) once they arrive more than 24h after the print.
- **Insiders.** Form 4 filings by directors and officers are items only for open-market codes P and S (core section 5). Grants and tax withholding are not items. Form 144 scores below 20.
- **Wrong company.** Anything about "Evolv AI" or "Evolver" scores 0-5, `reason:off_entity`.
