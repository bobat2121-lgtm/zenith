---
as_of: 2026-11-18
asset_class: operating
filer: domestic (10-K, 10-Q, 8-K); CIK 0001697851; fiscal year ends Dec 31
currency: USD
fx_as_of: n/a (USD reporter)
base_usd: 43600000
base_basis: "Q3 2026 revenue $10.9M x 4 (no guidance); Q3 release 2026-11-12"
alt_base: false        # LTM ~$46.5M and FY2025 $48.45M are reference only; the old $50.6M (Q2 x 4) is stale
tiny_usd: 436000       # 1% of base (base <= $100M)
lead_usd: 4360000      # 10% of base
small_base: false      # base >= $25M
shares_outstanding: 137715291   # 10-Q cover, as of 2026-11-10
market_cap_usd: 30300000        # $0.22 close 2026-11-18 x shares
terms:
  - {term: "Rekor Systems", case_sensitive: false}
  - {term: "Rekor", case_sensitive: true, require: "company context or a Rekor product name; reject the lowercase word meaning 'record' in Turkish, Indonesian or Malay text"}
  - {term: "REKR", case_sensitive: true}
  - {term: "Novume Solutions", case_sensitive: false, note: predecessor}
  - {term: "All Traffic Data Services", case_sensitive: false, note: subsidiary (ATD)}
  - {term: "Rekor Labs", case_sensitive: false, note: subsidiary}
  - {term: "Born Authentic", case_sensitive: false, require: "Rekor or Rekor Labs in the same item"}
  - {term: "BornAuthentic", case_sensitive: false, require: "Rekor or Rekor Labs in the same item"}
  - {term: "Go-Secure.Video", case_sensitive: false, note: "former name of Born Authentic"}
  - {term: "PlateRanger powered by Rekor", case_sensitive: false, note: "SSTI partner channel"}
aliases: ["Rekor Discover", "Rekor Command", "Rekor Scout", "Rekor AutoNotice", "Scout Axis Agent", "OpenALPR by Rekor", "Driver Connect (with Rekor)", "UVED (Oklahoma uninsured-vehicle program)"]
match_traps:
  - {term: "Command | Discover | Scout | Edge | Driver Connect | AutoNotice", case_sensitive: true, rule: "count only with the Rekor prefix or company context; 'Discover' alone is often Discover Financial"}
  - {term: "GoSecure", case_sensitive: false, rule: "the cybersecurity firm GoSecure is off_entity; only 'Go-Secure.Video' or GoSecure with Rekor context counts"}
  - {term: "All Traffic Solutions", case_sensitive: false, rule: "speed-sign maker, not ATD; off_entity"}
  - {term: "OpenALPR", case_sensitive: false, rule: "open-source forks are off_entity; only 'OpenALPR by Rekor' counts"}
  - {term: "Born Authentic", case_sensitive: false, rule: "marketing copy without Rekor is off_entity"}
cross_sheet_collisions:
  - {term: "PlateRanger", other: SSTI, rule: "a PlateRanger item counts for REKR only if it says 'powered by Rekor' or names Rekor; if both are named, grade as covered-to-covered with also:SSTI"}
thesis_drivers: [notes_maturity, listing, statewide_dot, cost_base, nonrecurring_alpr, born_authentic]
open_items:
  - {id: notes_2026_12_15, what: "$15.0M Series A Prime Revenue Sharing Notes (13.25%) refinanced, extended, restructured, converted, prepaid (103%) or defaulted", expires_at: 2027-01-15}
  - {id: nasdaq_bid_2027_04_26, what: "Bid-price compliance regained, reverse split effected, or delisting determination", expires_at: 2027-05-15}
  - {id: going_concern_fy2026, what: "Going-concern language removed or kept in the FY2026 10-K", expires_at: 2027-04-30}
  - {id: scdot_final_contract, what: "Final signed SCDOT statewide contract (7 years, >$22M selection of 2026-08-11)", expires_at: 2027-06-30}
  - {id: uved_final_contract, what: "Final Oklahoma DAC / UVED contract ($16.8M agreement in principle, 2026-05-04)", expires_at: 2027-06-30}
  - {id: odot_final_contract, what: "Final ODOT Connected In-Vehicle Alerts contract (~$1.4M intent to award, 2026-09-30)", expires_at: 2027-06-30}
  - {id: born_authentic_partner, what: "Born Authentic launch-partner terms or retail e-commerce launch (slipped from Q3 2026 to Q1 2027)", expires_at: 2027-04-30}
  - {id: customer_a_identity, what: "Customer A (13% of 9M revenue) named, or falls below 10%", expires_at: 2027-04-30}
  - {id: rekor_v_mehta, what: "Ruling, settlement or dismissal in Rekor v. Viraj Mehta (Delaware Chancery, filed 2026-10-16)", expires_at: 2027-12-31}
group_keys: [earnings_calendar]
---

# REKR — Rekor Systems, Inc.
_Researched 2026-11-18. Trades on the Nasdaq Capital Market as REKR. CIK 0001697851. Fiscal year ends Dec 31. No date is announced for Q4/FY2026 results; expect late March 2027 (FY2025 results came 2026-03-31). 137,715,291 shares were outstanding as of 2026-11-10 (10-Q). The stock closed at $0.22 on 2026-11-18, for a market cap of about $30M ([stockanalysis](https://stockanalysis.com/stocks/rekr/)). As of 2026-11-18, EDGAR shows no 8-K after the 2026-11-12 results 8-K. The only later filings are a Schedule 13G/A (11-13) and a Schedule 13G (11-16), so the notes are unresolved ([EDGAR submissions](https://data.sec.gov/submissions/CIK0001697851.json))._

## Identity & matching
- **Legal entities:** Rekor Systems, Inc. (formerly Novume Solutions). Subsidiaries:
  - All Traffic Data Services (ATD), still sold under its own name.
  - Rekor Labs, which develops Born Authentic.
- **Products, matched only with the "Rekor" prefix or company context:**
  - Rekor Discover (Edge Series)
  - Rekor Command (Driver Connect, Event Live Share)
  - Rekor Scout (Scout Axis Agent; "OpenALPR by Rekor")
  - Rekor AutoNotice
  - UVED (Oklahoma uninsured-vehicle program)
- **Born Authentic** is the new name for **GoSecure / Go-Secure.Video** (BornAuthentic in the 10-Q). It was renamed by the Q3 release (2026-11-12). Match both names.
- **Partner channel:** "PlateRanger powered by Rekor" (SoundThinking, SSTI). See `cross_sheet_collisions` in the front matter.
- **Reject these collisions** (`reason:off_entity`, 0-5; case rules are in the front matter):
  - "rekor" meaning "record" in Turkish, Indonesian or Malay.
  - Bare "Command", "Discover" (Discover Financial), "Scout", "Edge", "Driver Connect" or "AutoNotice".
  - GoSecure the cybersecurity firm.
  - All Traffic Solutions (speed signs), which is not ATD.
  - Open-source OpenALPR forks.
  - "Born Authentic" used as marketing copy without Rekor.

## What the stock trades on
Each driver is listed with its `thesis_drivers` id.
1. **Survival and refinancing (`notes_maturity`).**
   - $15.0M of Series A Prime Revenue Sharing Notes (13.25%) mature **2026-12-15**.
   - Cash was $5.1M at 9/30. The 10-Q states substantial doubt about going concern and a $10.2M working-capital deficit.
   - Management is in "active, productive discussions with multiple lenders". No term sheet has been disclosed, and no 8-K has been filed as of 2026-11-18.
2. **Listing and dilution (`listing`).** The Nasdaq $1 bid deadline is **2027-04-26**, so a reverse split or a raise is likely. 8,571,428 warrants at $2.40 come from the Dec 2025 offering; they are far out of the money at $0.22.
3. **Statewide DOT conversion and recurring revenue (`statewide_dot`).** Q3 recurring revenue was $7.5M (+16%), 69% of revenue. Key programs: Georgia DOT, FDOT, SCDOT (selected), Oklahoma UVED, ODOT (intent to award) and RTC Southern Nevada.
4. **Cost base (`cost_base`).**
   - Rightsizing is complete: two leases (US and Israel) were terminated on 2026-09-03.
   - The stated objective is a cost structure that supports profitability at about $50M of revenue, "not a revenue forecast".
   - The Q2 release expected adjusted EBITDA profitability in H2 2026. The Q3 release does not repeat it.
5. **Weak non-recurring sales under ALPR privacy pressure (`nonrecurring_alpr`).** Product and service revenue fell to $3.36M from $7.67M, and Public Safety revenue fell to $3.71M from $6.83M.
6. **Born Authentic optionality (`born_authentic`).** A retail e-commerce launch is planned for Q1 2027. It is small for estimates, so it is not a magnitude driver.

## Materiality bases
- **Revenue base B: $43.6M**, which is Q3 2026 revenue of $10.9M × 4. There is no guidance. Source: [Q3 release 2026-11-12](https://www.rekor.ai/post/rekor-systems-reports-third-quarter-2026-financial-results-recurring-revenue-grew-16-to-7-5-million-nine-month-operating-cash-use-cut-49-as-rekor-completes-major-rightsizing-and-builds-foundation-for-2027-growth).
  - LTM revenue is about $46.5M (my calculation). FY2025 was $48.45M.
  - The old $50.6M base (Q2 × 4) is **stale**. Re-score any precedent computed on it.
- **Q3 2026 revenue by category:** Urban Mobility $6.78M, Public Safety $3.71M, Transportation Management $0.42M ([10-Q](https://www.sec.gov/Archives/edgar/data/1697851/000143774926036581/rekr20260930_10q.htm)).
- **RPO:** $23.4M at 9/30/26, about 88% due within 12 months (company-reported).
- **Customer A:** unnamed, 13% of 9M revenue.
- **Liquidity:**
  - Cash $5.1M plus $0.3M restricted.
  - Nine-month operating cash use was $10.6M (-49%).
  - Debt is the $15M of notes, of which $5M is held by related party Arctis Global, LLC. The principal is about 34% of B and about 50% of market cap.
  - A new five-year headquarters lease in Fulton, MD was signed in Oct 2026 (about $1.5M fixed).
- **Thresholds for orders and contracts (core 4.2.1).** Test the total contract value, or the encumbered value when it is shown. State the annual run-rate separately in `why`.
  - Tiny: below $0.44M (1% of B).
  - Lead: $4.36M or more (10% of B).
  - A **new state DOT or state agency** gets +5 novelty only. It is not a lead override, which is reserved for federal, military or foreign-government buyers (core 4.2.1).
  - Worked examples on B = $43.6M:
    - ODOT $1.4M is p = 3.2.
    - SCDOT >$22M is p = 50.5.
    - Oklahoma UVED $16.8M is p = 38.5.
    - RTC Southern Nevada $1.54M (with options) is p = 3.5.
- **Capital events:** use the core 4.2.2 dilution table against 137.7M basic shares, not cash on hand.
  - If the share count is missing, use proceeds ÷ market cap (about $30M) as the proxy, at confidence ≤0.6. At $0.22, a $2M raise is about 6.7% of market cap.
  - New debt sits in the core "principal ≥25% of B or market cap" row (75-85).
  - Any outcome of the notes is ranked by the `notes_2026_12_15` rank-high line below, whatever its size.

## Event ladder for this name
Scores follow the core ladder and modifiers. The lines below are the REKR examples and the sheet-specific lifts only.

**Lead (90-100)**
- Event types:
  - **Rank-high (thesis lift on `notes_maturity`, resolves `notes_2026_12_15`):** any outcome of the notes, such as refinancing, extension, restructuring, conversion, prepayment, default or forbearance: 90+. An Arctis refinancing must be labelled related-party.
  - The core `control` and `existence` events: bankruptcy, a sale of the company, a delisting determination, or non-reliance.
  - A sale of Rekor Labs: `deal` as seller, lifted by `born_authentic`, about 85-90.
  - A signed contract with p ≥10 (V ≥ $4.36M), such as the final SCDOT contract: 90-97, `floor:lead_order`.
  - A selection or intent to award with p ≥10: 88-94 (core 4.2.1 `selected` column, never discounted), plus +5 for a new state agency.
  - Same-day quarterly results that move the notes, going-concern or liquidity picture, or change a target.
- Examples:
  - ["Rekor Systems Secures Largest Statewide Contract" (Georgia DOT, at least $50M, up to 7 years)](https://finance.yahoo.com/news/rekor-systems-secures-largest-statewide-110000222.html), 2025-10-07: about 95. Binding, p ≥100 on any base.
  - "Rekor Selected For 7-Year South Carolina DOT Statewide Contract Valued In Excess Of $22 Million", 2026-08-11 (feed title; the page now returns 404): about 92. `status:selected`, p = 50.5, +5 for a new state agency. Write "selected", not "awarded".
  - Q3 2026 results, 2026-11-12: about 90. Revenue $10.9M (-23% from $14.2M), going-concern doubt, notes unresolved.

**Digest (70-89)**
- Event types:
  - Contract ceiling increases (`ceiling_only`, cap 85 unless the encumbered value reaches lead).
  - Selections and intents to award with p between 1 and 10: 72-88 by core 4.2.1, plus +5 for a new state agency.
  - Binding awards of $0.44M-$4.36M: 70-89.
  - Renewals and continuations at sheet programs (floor 70, below).
  - Executive-officer changes (CEO Robert A. Berman; CFO Joseph Nalepa since 2025-11-17): core `neo_ceo_cfo`.
  - Nasdaq notices (core 8-K 3.01 row).
  - New material litigation filed by or against the company.
  - Liability or lease actions that move cash against $5.1M on hand.
  - A first paid Born Authentic partner.
  - Results-date notices: fixed at 72, `group:earnings_calendar`.
- Examples:
  - [Oklahoma District Attorneys Council, $16.8M multi-year agreement in principle](https://www.rekor.ai/post/rekor-systems-secures-16-8-million-contract-with-oklahoma-district-attorneys-council-as-technology-partner-for-statewide-uninsured-vehicle-enforcement-program), 2026-05-04: about 88. Grade it as `selected` at p = 38.5, at the low end because it continues an existing customer (since 2020) and carries no novelty. Write "agreement in principle", not "contract signed".
  - [ODOT intent to award, about $1.4M over 5 years](https://www.rekor.ai/post/oregon-department-of-transportation-selects-rekor-command-r-to-deliver-safety-alerts-directly-to-drivers-statewide), 2026-09-30: about 84. `status:selected`, p = 3.2 (80-88 band), +5 for a new state agency, no pre-award discount. The release says the value is "subject to final contract negotiations", with annual renewals after year two (run-rate about $280K a year). Write "intent to award".
  - [FDOT raises contract ceiling 94% to $9.5M, plus RTC Southern Nevada selects Rekor Command for up to $1.54M](https://www.rekor.ai/post/fdot-increases-rekor-contract-ceiling-by-94-to-9-5-million), 2026-10-28: about 82.
    - Flag `ceiling_only`. Only $4.9M is encumbered.
    - The RTC figure (p = 3.5) includes two one-year options.
    - Grade on the larger fact and list both.
  - [Suit against a former director over the Dec 2025 financing](https://www.rekor.ai/post/rekor-systems-takes-legal-action-against-former-director-following-extensive-investigation-into-alleged-breaches-of-fiduciary-duty-in-connection-with-a-december-2025-financing-with-a-hedge-fund), 2026-10-19 (Rekor v. Viraj Mehta, Delaware Chancery, filed 2026-10-16): about 72.
  - [Leases terminated: about $10M of obligations removed for about $2.8M cash](https://www.rekor.ai/post/rekor-eliminates-approximately-10-million-in-liabilities-and-generates-more-than-2-million-in-annual-savings), 2026-09-03: about 72.
  - [Q3 date notice](https://www.rekor.ai/post/rekor-systems-to-announce-third-quarter-fiscal-2026-results-company-will-host-earnings-call-on-thursday-november-12-2026), 2026-11-09: calendar card, 72, `group:earnings_calendar`.
  - [Nasdaq grants a 180-day extension](https://www.rekor.ai/post/nasdaq-grants-rekor-systems-six-month-extension-to-regain-compliance-with-minimum-bid-price-requirement), 2026-10-27 (8-K Items 3.01 and 7.01): about 70. This is the top of the core 3.01 extension range (60-70), because `listing` is a thesis driver.

**Borderline (40-69)**
- **Annual-meeting adjournments and bylaw changes that enable a split vote.** Example: the [8-K of 2026-10-06](https://www.sec.gov/Archives/edgar/data/1697851/000143774926032180/rekr20261006_8k.htm) (Item 5.03) cut the quorum to 40%: about 45. That is the core "else <20" plus a `listing` lift, because the lower quorum eases a reverse-split vote.
- **Product launches with no customer named.** Examples: Scout Axis Agent (2026-07-01) and GoSecure voice verification (2026-08-12): about 55.
- **Policy that changes contract terms.** Example: [mandatory ALPR privacy standard](https://www.rekor.ai/post/rekor-commits-to-mandatory-privacy-protections-offering-communities-a-new-path-to-adopt-or-restore-alpr), 2026-11-16. Rekor "will not renew an arrangement that excludes the mandatory requirements": about 50.
- **Pilots with no contract:** use the core scope rule.
- **A rival wins at a sheet key account** before replacement is confirmed: 50-69 (core section 9, rule 4).

**Reject (<40)**
- **Routine 8-K 5.07 vote results** with no split, share or financing proposal: 10-25 (core). Example: the [8-K of 2026-10-16](https://www.sec.gov/Archives/edgar/data/1697851/000143774926032811/rekr20261016_8k.htm) (directors, auditor CBIZ, say-on-pay): about 20.
- **ALPR advocacy.** Example: ["Calls For A National Industry Standard"](https://www.rekor.ai/post/rekor-systems-calls-for-a-national-industry-standard-to-preserve-the-public-safety-value-of-alpr), 2026-08-31: about 30.
- **DEFA14A proxy solicitations:** about 15.
- **Third-party recaps of results:** <30, `reason:late_repost`, on the core section 7 timing (24h for results recaps, 72h for guidance retellings).
- **Stock-move pieces:** <20, `reason:out_of_scope`.
- **Awards and conference appearances:** 0-20, `reason:promotional`.
- **Archive filings:** below 10.

## Always surface (floors)
Core section 6 floors apply unchanged and are not restated here: `results`, `calendar`, `neo_ceo_cfo`, `deficiency`, `existence`, `listing`, `lead_order`, `order`. The lines below are REKR thesis lifts that go beyond core. Record each as `floor:<id>`.
- **`floor:rekr_notes` 90** (lift on `notes_maturity`; core `open_item` is 80). It applies to:
  - 8-K Items 1.01, 1.02, 2.03, 2.04 or 3.02;
  - any filing or release that mentions the Series A Prime Revenue Sharing Notes, a new lender, forbearance or a missed payment.
  It holds until `notes_2026_12_15` is resolved or expires.
- **`floor:rekr_split_vote` 80** (lift on `listing`; core 5.07 is 45-65) for:
  - an 8-K 5.07 or proxy result on a reverse-split or authorized-share proposal;
  - a reverse split taking effect.
- **`floor:open_item` 80** (core) when the FY2026 10-K removes or keeps the going-concern language (`resolves:going_concern_fy2026`). A going-concern statement that only repeats the Q3 10-Q is not a "first going concern" and is graded with the results.
- **`floor:rekr_key_program` 70, any size** (lift on `statewide_dot`; core `order` needs V ≥ tiny). It applies to any signed contract, task order, ceiling change or renewal that names Georgia DOT, FDOT, SCDOT, ODOT, RTC Southern Nevada or the Oklahoma District Attorneys Council (UVED). The final SCDOT, ODOT and UVED contracts also resolve their open items (floor 80).
- **`floor:rekr_customer_a` 70** when Customer A is named or its share falls below 10% (`resolves:customer_a_identity`).

## Noise patterns
- **EDGAR archive burst, first_seen 2026-08-31T21:22:24Z** (core section 8, R-0050):
  - 40 edgar_rekr rows, all notified=1. They are filings from 2024-10-22 to 2026-08-28: 2024-25 10-Ks and 10-Qs, the 424B5s and the DEF 14As, plus the DEFA14A of 2026-08-28.
  - Score 0-9 with `reason:stale`, `archive_burst` and `source_repair`.
  - The only exception is a filing that is the first record of an event never covered (`late_first_sighting`).
- **Press backfill, first_seen 2026-07-29T15:37:38Z:**
  - 6 `rekor` rows with an empty published field. They include the Q1 results, the Oklahoma $16.8M deal (dated 2026-05-04), Scout Axis Agent and the Q2 preannouncement.
  - Date each one from its page dateline and gate it on core freshness. Anything more than 21 days old is `reason:stale`.
- **Bare EDGAR titles** ("Rekor Systems, Inc.: 8-K filed 2026-11-12"):
  - Open the filing and grade the content.
  - They usually pair with a same-day release: 11-12 with Q3 (Item 2.02), 10-27 with Nasdaq (3.01/7.01), 10-19 with the lawsuit (7.01).
  - Make the release canonical. Mark the 8-K `score: null`, `dup_of:<release id>`, unless it adds terms.
- **Proxy noise:** the DEFA14As of 2026-08-28 and 2026-10-06, and repeated adjournments (meeting convened 2026-05-15, adjourned to 09-11, then 10-16). Score below 25, unless a floor above applies.
- **ALPR advocacy and policy releases** (2026-07-29 "Beyond The Flock Backlash", 2026-08-31, 2026-11-16): score 30-50. A release goes higher only when it changes contract or renewal terms.

## Catalyst calendar
- **By 2026-12-15:** the $15M notes are refinanced, restructured or defaulted (`notes_2026_12_15`). Prepayment is allowed at 103%.
- **Q4 2026-Q1 2027:** the final contracts for SCDOT (7 years, more than $22M), ODOT (about $1.4M) and UVED ($16.8M agreement in principle).
- **Q1 2027:** the Born Authentic retail e-commerce launch and launch-partner terms. The Aug 2026 release had targeted partner terms in Q3 2026, so this has slipped.
- **About late March 2027:** FY2026 results and the 10-K, including the going-concern language (`going_concern_fy2026`).
- **By 2027-04-26:** the Nasdaq bid-price deadline (`nasdaq_bid_2027_04_26`). A reverse-split proxy can use the new 40% quorum.
- **Open:** Rekor v. Mehta (Delaware Chancery, `rekor_v_mehta`).

## Customers, programs, agencies & counterparties
- **Georgia DOT** (`big`, release):
  - At least $50M over up to 7 years (possibly more than $100M).
  - Cities and counties can buy under it cooperatively.
- **FDOT** (release):
  - Statewide intelligent transportation infrastructure contract.
  - The ceiling is $9.5M, of which $4.9M is encumbered.
  - Usage depends on task work orders.
- **SCDOT** (release; the page was later removed):
  - Selected 2026-08-11 for 7 years and more than $22M.
  - Rekor also supplies SC virtual weigh stations (OIT, State Transport Police and SCDOT). The initial order was about $1M, per a [2025-10-16 release](https://www.rekor.ai/post/rekor-technology-powers-south-carolina-virtual-weigh-stations-wins-state-technology-innovation-award-establishing-a-near-100-percent-perfect-overweight-truck-targeting-model-that-other-states-can-follow).
- **Oklahoma District Attorneys Council / UVED** (release):
  - Customer since 2020, with the $16.8M multi-year agreement in principle (2026-05-04).
  - It may be Customer A (my inference; never state it in published text).
- **ODOT** (release):
  - Connected In-Vehicle Alerts (Rekor Command with Driver Connect).
  - Intent to award of 2026-09-30: $1.4M anticipated over 5 years, "subject to final contract negotiations", with annual renewals after year two.
  - It builds on the Las Vegas Driver Connect deployment.
- **RTC Southern Nevada** (release):
  - Rekor Command, up to $1.54M including options.
  - It integrates with NDOT's Arcadis traffic management system.
- **SoundThinking (SSTI, covered; PlateRanger):**
  - Transom Capital closed its acquisition on 2026-11-18. SSTI stays covered until the owner removes it.
  - A channel change that names Rekor is REKR news and covered-to-covered (`also:SSTI`).
- **Axis Communications:** host platform for Scout Axis Agent.
- **Financing counterparties:**
  - Arctis Global, LLC: related-party noteholder ($5M).
  - Anson Advisors: sole buyer of the Dec 2025 units (8,571,428 at $1.75). Its warrants bar variable-rate deals while held, so an equity line or a resetting convert would also be a waiver event.
  - William Blair: representative underwriter of the Dec 2025 offering.

## Competitors & read-through
Follow the core section 9 boundary. Everything else is `out_of_scope` (0-15).
- **Flock Safety:** city cancellations or ALPR law changes count only when the source names Rekor, for example a city switching to Rekor.
- **Motorola/Vigilant, Verra Mobility, Miovision, Iteris:** a rival win at a named sheet account scores 50-69 as a possible loss. It becomes `money` bad news (70+) once replacement is confirmed. Otherwise these names are out of scope.
- **SSTI (covered):** only explicit PlateRanger-with-Rekor or Rekor terms count.
- **State ALPR privacy statutes and regulator actions** count only when they name Rekor or a sheet program, such as Oklahoma UVED (core section 9, rule 3). Published text states what the statute does and never says how it affects Rekor.

## Source coverage gaps
Collector and polling notes (transcript sources, procurement portals, EDGAR owner=include polling, the Chancery docket, the Nasdaq Listing Center) have moved to the worker file `sources/REKR.md`. These are the facts the grader needs:
- **edgar_rekr carries only 8-K, 10-Q and DEFA14A filings.** The Schedule 13G/A (2026-11-13), Schedule 13G (2026-11-16) and Form 4 (2026-09-09) never arrived. Do not treat a missing 13G, Form 4 or expected 8-K as `insufficient_evidence`.
- **No transcript source is wired.** Refinancing color and contract-stage detail from calls reach the feed only through press, so grade them as `mgmt_claim` (-15, cap 75).
- **The `rekor` source can drop pages.** See the SCDOT note below. The feed record stays the canonical evidence of the original release.

## Grader notes
- **Titles from the rekor source are URL slugs, and the numbers get mangled.** "9 5 Million" means $9.5M, and "Grew 16 To 7 5 Million" means "grew 16% to $7.5M". Restore the figures from the page (`read_source: true`).
- **The rekor source has an empty `published` field.** Take the event date from the dateline. Category tags are unreliable: the lawsuit and the privacy release are tagged FINANCIAL.
- **Releases can vanish.** The SCDOT selection page (2026-08-11) now returns 404 and is gone from the sitemap. Keep the feed record, and do not treat the disappearance as a cancellation without a filing.
- **Use stage words literally.** "Ceiling" is not committed revenue, "intent to award" is not a contract, and "selected" or "agreement in principle" is not signed. Selection and intent-to-award stages are never discounted (core 4.1). Say "company-reported" for RPO.
- **Watch for bundles.** One release can carry two contracts (FDOT and RTC). Grade it on the larger fact and list both.
- **Year-over-year comparisons mislead.** Q3 2025 had $7.67M of non-recurring product and service revenue. Lead results cards with recurring revenue, cash, RPO and notes status.
- **The "about $50M revenue profitability" line is an operating objective, not guidance.** Never treat it as a guidance change.
- **Arctis refinancing** must be labelled related-party.
- **Re-score precedents on the new base.** Precedents scored on the stale $50.6M base, including the core section 11 REKR/ODOT anchor (76, p = 2.8), need updating. On $43.6M, ODOT is p = 3.2 and about 84.
- **Stale facts in old profiles:**
  - GoSecure is now Born Authentic.
  - Cash of $10.0M (Q2) is now $5.1M.
  - The 2026-10-26 Nasdaq deadline is now 2027-04-26.
  - The annual meeting was held on 2026-10-16.
  - SSTI was "pending buyout" and is now closed.
  - The $50.6M revenue base is now $43.6M.
  - The market cap of about $35-45M is now about $30M.
  - "A first award from a new state DOT = Lead" is removed. A new state agency is +5 novelty only.
  - The `earnings_dates` group key is now `earnings_calendar`.

_Verification, 2026-11-18:_
- _I checked the ODOT stage, value and term on the [ODOT release](https://www.rekor.ai/post/oregon-department-of-transportation-selects-rekor-command-r-to-deliver-safety-alerts-directly-to-drivers-statewide)._
- _I confirmed on [EDGAR submissions](https://data.sec.gov/submissions/CIK0001697851.json) that no 8-K was filed after 2026-11-12._
- _The web-search budget for this run ran out, so I could not search for news after 2026-11-16 beyond the EDGAR check._
- _The SCDOT figures rest on the feed title, because the page returns 404._
