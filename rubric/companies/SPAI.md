---
ticker: SPAI
name: Safe Pro Group Inc.
as_of: 2026-11-18
asset_class: operating
exchange: Nasdaq
filer: domestic (10-K, 10-Q, 8-K); CIK 0002011208
fiscal_year_end: 12-31
currency: USD
fx_as_of: n/a (all amounts USD)
base_usd: 10706720
base_basis: "Q3 2026 revenue $2,676,680 x 4; no company guidance (10-Q and Ex. 99.1, 2026-11-16)"
base_as_of: 2026-09-30
alt_base: true
alt_base_usd: 5328296
alt_base_basis: "Q2 2026 revenue $1,332,074 x 4; the base used in core 4.2.1 and the 2026-10-01 anchors. Use base_usd unless the owner rejects it; flag needs_owner when the two bases put an item in different bands"
small_base: true
tiny_usd: 107067
lead_usd: 1070672
shares_outstanding: 20342862
shares_as_of: 2026-11-13
dilution_share_lines: {d5: 1017143, d10: 2034286, d20: 4068572}
market_cap: "not stored; compute from the last close at grading time"
terms: ["Safe Pro Group", "Safe Pro", "Safe Pro AI", "Safe-Pro USA", "Airborne Response", "SPAI Ground Truth", "Ground Truth", "GT Cloud", "GT Air", "GT Road", "GT Field", "GT NODE", "GT Scout", "SPOTD", "SpotlightAI", "NODE", "InFlight", "OnSight", "Threat Analysis Kit"]
aliases: ["Safe Pro Group Inc.", "SPAI"]
subsidiaries: ["Safe Pro AI", "Airborne Response", "Safe-Pro USA"]
match_traps:
  - {term: "Safe Pro", rule: "regex \\bsafe[- ]?pro\\b(?!-), case-insensitive; reject other Safe Pro safety-equipment brands"}
  - {term: "Ground Truth|GT Air|NODE|InFlight|OnSight|Scout", rule: "generic words; count only with Safe Pro, landmine, explosive-threat or drone-imagery context in the same item", case: insensitive}
  - {term: "ground truth", rule: "reject ML, geospatial and journalism uses (e.g. Vantor 2026-09-29; Breaking Defense AUSA 2026)"}
  - {term: "Airborne Response", rule: "common phrase; needs Safe Pro context"}
  - {term: "demining", rule: "never matches alone; also an ONDS term (core 1 collision table)"}
  - {term: "Mriya", rule: "reject the An-225 aircraft"}
  - {term: "SPAI", rule: "ticker only when uppercase with Safe Pro or Nasdaq context; reject other acronyms", case: sensitive}
removed: []
thesis_drivers: [army_conversion, run_rate_margin, platform_attach, ukraine_paid, liquidity_holders]
open_items:
  - {id: army_cso_followon, text: "Follow-on, option or production order under the $2.5M Army CSO (Ground Threat Detection through Aerial Reconnaissance), or Ghost-X/MRR fielding naming Safe Pro", expires_at: 2027-06-30}
  - {id: black_widow_fielding, text: "Army order or fielding of Ground Truth/InFlight/NODE on Red Cat Black Widow beyond the 2026-06 kit orders", expires_at: 2027-06-30}
  - {id: ondas_paid, text: "Ondas MOU (Aug-Sep 2025) converts to a paid order", expires_at: 2027-06-30}
group_keys: [earnings_calendar]
---

# SPAI — Safe Pro Group Inc.
_Researched 2026-11-18; EDGAR filing list re-checked 2026-11-18 (latest: 8-K Items 2.02/9.01 and 10-Q on 2026-11-16; 8-K Items 7.01/9.01 on 2026-11-10; DEFA14A 2026-11-06; DEF 14A 2026-11-04). Nasdaq: SPAI. Fiscal year ends Dec 31. The FY2026 10-K is likely due late March 2027 (FY2025 10-K filed 2026-03-31, 10-K/A 2026-04-30). Results arrive as an 8-K Item 2.02, either a preliminary revenue release 1-4 weeks after quarter end (Q3: 2026-10-07) or with the 10-Q (Q2: 2026-08-14; Q3: 2026-11-16). Annual meeting 2026-12-21, virtual; it covers only the election of five directors and ratification of RBSM LLP ([DEF 14A](https://www.sec.gov/Archives/edgar/data/2011208/000149315226049950/formdef14a.htm)). Core rubric v3.0 governs; this sheet gives SPAI facts, bases, thesis lifts and examples only._

## Identity & matching
- **Legal entity and units.** Safe Pro Group Inc. (Aventura, FL), with three subsidiaries:
  - **Safe Pro AI**: AI segment, $2,106,929 or 79% of Q3 revenue.
  - **Airborne Response**: drone inspection and public-safety services; Florida Power & Light supplies a substantial share of its revenue (FY2025 10-K).
  - **Safe-Pro USA**: ballistic protection and demining gear.
- **Product names, old and new.** On 2026-10-08 the company launched the **"SPAI Ground Truth"** ecosystem: GT Cloud (AWS-hosted), GT Air (in-flight on drones), GT Road (UGVs and vehicles), GT Field (laptop and tablet) and GT NODE (offline edge server) ([release](https://safeprogroup.com/safe-pro-awarded-new-ai-subcontract-and-launches-spai-ground-truth-for-next-gen-ground-intelligence/)).
  - **GT Scout**, an AI stack for Army ATAK devices on Samsung Galaxy phones, launches "later this quarter" (Q4 2026, per the CEO letter of 2026-11-17).
  - Legacy names remain in use: SPOTD and SpotlightAI. The 2026-11-11 and 2026-11-18 releases say SpotlightAI is "part of the Ground Truth ecosystem". Match old and new names, plus NODE, InFlight and Threat Analysis Kit.
- **Context guards and collisions:** see `match_traps` in the front matter. Cross-sheet collisions (core 1 table): "demining" (ONDS); "Black Widow" (RCAT product; an RCAT item naming Safe Pro is direct involvement for both).

## What the stock trades on
1. **`army_conversion`: Army and DoW awards turning into recurring AI revenue.** The $2.5M Army CSO of 2026-11-10 is its first prime contract. Follow-ons, Ghost-X/MRR fielding and further orders are the main estimate driver.
2. **`run_rate_margin`: run-rate growth and AI gross margin.** Q3 revenue was $2.68M, up 101% QoQ. AI gross margin was 79% and consolidated gross margin 71.2%. Adjusted net loss was $0.40M.
3. **`platform_attach`: Ground Truth on partner platforms.** Red Cat Black Widow, Anduril Ghost-X/Lattice, and UGVs (the $1.3M defense-prime subcontract).
4. **`ukraine_paid`: funded Ukraine and humanitarian demining work.** State Dept subcontract about $180K; UNMAS/UDA initial project, value undisclosed. This moves Ukraine from MOUs to paid work.
5. **`liquidity_holders`: liquidity, dilution and holder base.**
   - Cash $7.8M against 9-month operating burn of $6.1M.
   - 2.14M warrants at a $5.88 weighted-average strike; 5.83M options at $4.50.
   - Frost Gamma holds 9.82% including a $6 call; Erdberg holds 25.1% beneficially (DEF 14A).

Moving a driver adds +5-15 per core 4.4; record the ids in `thesis_drivers_hit`.

## Materiality bases
- **Revenue base B: $10,706,720** (Q3 2026 revenue $2,676,680 × 4; no guidance). Sources: [Q3 release 2026-11-16](https://www.sec.gov/Archives/edgar/data/0002011208/000149315226052559/ex99-1.htm), [10-Q](https://www.sec.gov/Archives/edgar/data/2011208/000149315226052406/form10-q.htm).
  - **Alt base $5,328,296** (Q2 × 4), the base the core anchors use. Both are below $25M, so the small-base rule applies under either. Flag `needs_owner` when the two bases give different bands; the main case is a value between $533K and $1.07M, which is Lead on the alt base and Digest on B.
- **Lines on B:** tiny $107,067 (1%); lead $1,070,672 (10%).
- **Other figures:**
  - Nine-month 2026 revenue $5,228,883; FY2025 revenue $606,681.
  - Q3 segment revenue: AI $2,106,929; Airborne Response $342,362; Safe-Pro USA $227,389.
- **Backlog.** None disclosed. Contract liabilities $515,893 (AI $501,492); receivables $2,938,338. The company claimed more than $5M of cumulative AI orders on 2026-08-10, before the $2.5M Army prime. That claim is company-reported and must not be added to later order totals (core 8, never multiply money).
- **Liquidity (2026-09-30).** Cash $7,781,051, working capital $9,716,967, notes payable $145,156. The 10-Q says cash covers at least 12 months, so a first going-concern doubt would be new (`floor:existence`).
- **Shares.** 20,342,862 outstanding at 2026-09-30 and 2026-11-13 (20,979,946 issued; 637,084 in treasury after the $3.0M buyback authorized 2025-12-18 and completed in Q2 2026).
  - Dilution lines for core 4.2.2: 5% = 1.02M new shares; 10% = 2.03M; 20% = 4.07M. Existing warrants and options count only when newly issued, repriced or exercised.

## Event ladder for this name
Bands, floors and rung ranges are in core 3, 4 and 6. Below: SPAI items placed on them, using B = $10.71M.

- **Lead (90-100):**
  - "Safe Pro Group Awarded U.S. Army Prime Contract, Teams with Anduril…", a $2.5M CSO, 2026-11-10 ([link](https://safeprogroup.com/safe-pro-group-awarded-u-s-army-prime-contract-teams-with-anduril-for-super-intelligence-on-ghost-x-drone-for-tank-protection/)). p = 23.3, binding, first prime: about 93, `floor:lead_order`, `army_conversion`.
  - "Safe Pro Group Reports Record Q3 2026 Revenue of $2.68 Million…", 2026-11-16 ([link](https://safeprogroup.com/safe-pro-group-reports-record-q3-2026-revenue-of-2-68-million-up-2539-year-over-year-101-sequentially-with-record-79-ai-gross-margin/)). Run rate doubled QoQ and AI gross margin hit a record (`run_rate_margin`): about 90. Lead the `why` with dollars and the QoQ change.
  - $1.3M UGV subcontract from an unnamed defense prime (2026-06-23). p = 12.1: about 90.
  - `rank_high` (thesis lift, `army_conversion`): funded Army program-of-record adoption naming Safe Pro, Ground Truth, SPOTD, SpotlightAI or NODE (for example SRR/MRR integration via Black Widow or Ghost-X). Lead whatever the value. A miss, such as the Army dropping the integration, ranks the same.
- **Digest (70-89):**
  - "$780,000 Purchase Order for Department of War Package…", 2026-08-06. p = 7.3: 80-89. Lead (p = 14.6) on the alt base, so flag `needs_owner`.
  - $742K NODE + Black Widow Army award (2026-06-08). p = 6.9: about 84. If the source names Red Cat, it is direct involvement for RCAT too (`also:RCAT`).
  - UNMAS / Ukrainian Deminers Association "initial project", 2026-11-11 ([link](https://safeprogroup.com/safe-pro-awarded-artificial-intelligence-powered-demining-contract-by-ukrainian-deminers-association-under-united-nations-mine-action-service-unmas-program/)). Value undisclosed: `floor:small_base` 70, +5 new customer, +`ukraine_paid` = **78** (core anchor). Write "initial project, value undisclosed".
  - State Dept Ukraine demining subcontract, about $180K including three years of licensing (2026-08-18). p = 1.7 (72-80), +`ukraine_paid`: about 80. It is a subcontract under a State program, not a direct agency order, so the new-agency lead override does not apply; novelty is +5.
  - **Unnamed-prime and undisclosed-value contracts (fixes the old 52-65).** Any confirmed order, subcontract, modification or expansion from a paying customer, prime named or not, takes `floor:small_base` 70 with no discount for the missing name or value. A new customer adds +5. Examples:
    - "Safe Pro Awarded New AI Subcontract and Launches 'SPAI Ground Truth'…", 2026-10-08. The release calls it "an initial order from a new U.S. government prime contractor customer": about 74. Write "initial order (subcontract), prime unnamed, value undisclosed".
    - New government subcontract (2026-08-03): 70-74.
    - Subcontract modification (2026-05-18): 70-72.
  - US Air Force AI airfield dataset contract award (2026-07-13), value undisclosed: `floor:small_base` 70, +5 first Air Force work: about 75. The lead override needs V ≥ tiny and cannot be tested.
  - Preliminary revenue pre-announcement (8-K 2.02, 2026-10-07, "Expects Record 2,300% Revenue Growth in Q3 2026"): `floor:results` 80 with figures.
  - Covered-to-covered deals with RCAT, ONDS or UMAC: `floor:covered_pair` 75 for each name.
  - CEO Daniyel Erdberg's private sale of 1,000,000 restricted shares at $4.00, plus a $6.00 call on another 1M shares expiring 2028-09-09. Trade 2026-09-09; [Form 4](https://www.sec.gov/Archives/edgar/data/2011208/000149315226042449/xslF345X06/ownership.xml) filed 2026-09-11. A non-10b5-1 CEO sale of ≥10% of holdings is 55-75, plus `liquidity_holders`: about 70. State the terms literally ("private sale at $4.00, not open market").
    - The buyer is Frost Gamma ([13G](https://www.sec.gov/Archives/edgar/data/2011208/000149315226042458/xslSCHEDULE_13G_X02/primary_doc.xml), event 2026-09-09, filed 2026-09-14, 2.0M shares including the option, 9.82%). If the 13G arrives after the Form 4, grade it as an update adding the buyer and the call (45-55). If it is the first record of the trade, grade the trade (about 70).
  - Earnings or call date notice, if issued: fixed 72, `group:earnings_calendar`.
- **Borderline (40-69):**
  - Air Force dataset contract completion (2026-10-29), no follow-on or value: about 60.
  - Army exercises and demos with a named program. Example: Project Convergence Capstone 6 completion (2026-07-30): 55-65.
  - Army CRADA (2026-08-12): named counterparty with concrete integration, non-binding, 55-62. Never call it an order.
  - Flagship product launch (GT Scout, Q4 2026): 60-68; +5-10 with a named customer or contract. A slip past Q4 is the same size.
  - Airborne Response or Safe-Pro USA contracts: small-base rule applies, but they never outrank AI contract news of the same size. Usually 60-70.
  - Partner collaborations with concrete integration and no volume. Example: Lantronix (2026-05-20): 55-60.
  - Innovation Day (notice 2026-07-28). Read the notice. If management presents to investors or analysts, it takes `floor:investor_day` 80. If it is a customer or product showcase, it is `product`, 50-60.
- **Reject (<40):**
  - Awards and prizes, for example the Mine Action Innovation Award ("Scalable Innovation", EU-funded, GICHD-organized, presented 2026-11-17, released 2026-11-18). No money or contract: 10-20, `reason:promotional`.
  - Bell ringing (notice 2026-08-17): 10.
  - Detection-count milestones ("50,000th AI-Powered Landmine Detection", 2026-05-26).
  - CEO letter of 2026-11-17: restates Q3 and the $2.5M prime, about 30, `reason:already_covered`. GT Scout timing is its only new fact.
  - DEF 14A/DEFA14A for the routine 2026-12-21 meeting: 10-20. 8-K 7.01 copies of releases: duplicates.
  - Form 4 by Christopher Todd Michael, President of Airborne Response (filed 2026-09-25): 25,000 shares disposed at $4 on 2026-09-24. A subsidiary officer's small sale: below 25.

## Always surface (floors)
Core 6 floors apply unchanged. SPAI mappings:
- **`small_base`** covers any confirmed paying order, subcontract, modification, expansion or deployment, in any segment, **including unnamed primes and undisclosed values**. Never score these below 70.
- **Sheet-named core programs** (for `selection`, `order` on pre-awards, and `key_loss`):
  - Army CSO "Ground Threat Detection through Aerial Reconnaissance".
  - Army SRR/MRR integrations via Red Cat Black Widow or Anduril Ghost-X.
  - State Dept Ukraine demining program.
  - UNMAS Ukraine / UDA.
- **Key accounts** for `key_loss` (loss, cancellation, sustained protest: floor 70): US Army; the three unnamed concentration customers in the 10-Q; State Dept program; UNMAS/UDA; Florida Power & Light (Airborne Response).
- **Thesis lifts above floors:**
  - An Army award naming Safe Pro or its products, including through Black Widow or Ghost-X: `army_conversion` +5-15. Usually ≥75.
  - A funded Ukraine demining order: `ukraine_paid` +5-10. Usually ≥75.
- **Open items** (front matter) take `floor:open_item` 80 with `resolves:<id>` until `expires_at`.
- Bad news ranks at the same level: a lost or cancelled order, a going-concern note, a run-rate drop, a delisting notice.

## Noise patterns
Core 7 and 8 govern (late reposts, archive bursts, duplicates). SPAI instances:
- **EDGAR archive burst.** On 2026-08-31, edgar_spai delivered 40 back-dated filings (filed 2024-09-26 to 2026-08-25), all notified=1. Gate each item on its own date: >21 days old is 0-9, `reason:stale`, flags `archive_burst`, `source_repair`.
- **Newsroom backfill.** On 2026-07-09 the `safepro` feed seeded about a dozen May-June 2026 releases in one crawl. Same gate.
- **Bare EDGAR titles** ("Safe Pro Group Inc.: 8-K filed 2026-11-10"). Open the filing and grade the content.
  - Most SPAI 8-Ks are Items 7.01/9.01, furnished copies of releases (2026-06-02, 06-23, 08-03, 08-06, 08-18, 08-25, 11-10). They are duplicates, `dup_of` the release.
  - 2.02 8-Ks (2026-08-14, 10-07, 11-16) are results.
  - The 10-Q duplicates the same-day release unless it adds facts (concentration customers, subsequent events, share count).
- **Syndicated and translated copies.** French, German and Italian rewrites, plus "projects Q3 revenue above $2.5 million" retitles of the 2026-10-07/08 releases: duplicates of the canonical release.
- **Category mislabels.** The EU award (2026-11-18) was tagged CONTRACT and the CEO letter LEGAL. Ignore the category field.
- **Re-issued releases.** The 2026-06-23 $1.3M subcontract went out twice ("U.S. Government" and "U.S. Army"). Keep one canonical item; the second is a duplicate.
- **Promotional** (below 25, `reason:promotional`): bell, award, image or detection milestones; the "At Fort Bragg, a jam session for a 'new era of warfare'" media repost (2026-08-27); conference presentations.

## Catalyst calendar
- **Q4 2026:** GT Scout launch; deliveries under the $2.5M Army CSO; InFlight on Black Widow with the Army (unveiled 2026-05-19; fielding not confirmed).
- **2026-12-21:** annual meeting (routine, 10-20).
- **Early to late January 2027:** preliminary Q4/FY2026 revenue 8-K, by pattern.
- **Late March 2027:** 10-K. **Mid-May 2027:** Q1 10-Q (Q1 2026 was filed 2026-05-15).
- **Context only (not open items):**
  - An Air Force follow-on after the completed dataset contract.
  - Exercise of Frost Gamma's $6 call (window to 2028-09-09; these are existing shares, not dilution).
  - A possible 2027 equity raise given burn against $7.8M cash, graded by core 4.2.2 on the share lines above.

## Customers, programs, agencies & counterparties
| Counterparty | Program / role | Disclosure | Revenue share | big |
|---|---|---|---|---|
| US Army | CSO "Ground Threat Detection through Aerial Reconnaissance" (first prime, Abrams protection; Anduril Ghost-X, an MRR selection, as the drone); Black Widow kits (Threat Analysis Kit 2026-06-02; $742K NODE + Black Widow 2026-06-08); CRADA 2026-08-12; Project Convergence Capstone 6; airfield exercise 2026-06-11 | release | not disclosed | likely |
| Unnamed DoW / defense primes | Subcontract mod 2026-05-18; $1.3M UGV 2026-06-23; subcontract 2026-08-03; $780K order 2026-08-06; initial order from a new prime 2026-10-08 | release; 10-Q names three concentration customers without identities or percentages | not disclosed | yes (concentration) |
| US Air Force | AI airfield dataset contract, 2026-07-13 to 2026-10-29 | release | not disclosed | unknown |
| US State Department | Ukraine demining subcontract, about $180K | release | not disclosed | no |
| UNMAS / Ukrainian Deminers Association | Initial project, 2026-11-11 | release | not disclosed | unknown |
| Florida Power & Light | Airborne Response services | filing_only (FY2025 10-K) | substantial share of Airborne Response (segment 12.8% of Q3) | unknown |

- **Holders:** Frost Gamma Investments Trust 9.82%; Erdberg 25.1% beneficial. Citadel's 13G/A (2026-08-14) shows 3.6%, below 5%.
- **Partners:** Red Cat and Ondas (covered; Ondas MOU Aug-Sep 2025 per 10-K); Anduril (Ghost-X, Lattice); Lantronix (2026-05-20); AWS (GT Cloud hosting).

## Competitors & read-through
Core 9 governs. Items count for SPAI only when:
- the source names Safe Pro or a product (Ground Truth, SPOTD, SpotlightAI, NODE), for example a Red Cat Black Widow order naming onboard threat detection by Safe Pro, Ghost-X/MRR fielding naming Safe Pro, or an Ondas demining award naming SPOTD; or
- a table account above acts on explosive-threat detection (buy, renewal, cancellation, replacement); or
- a rival wins at a table account in this category: 50-69 as a possible loss; 70+ `money` bad news if replacement is confirmed.

Peer funding rounds, OEM onboard-perception launches that name neither SPAI nor its accounts, and sector demining news are `out_of_scope` (0-15). Published text names Safe Pro only when the source does.

## Source coverage gaps
Grader-facing facts only; collector fixes live in the worker's `sources/SPAI.md`.
- edgar_spai carries no Form 4 or SCHEDULE 13G/13D rows. Insider and holder events (Erdberg Form 4 2026-09-11, Frost Gamma 13G 2026-09-14, Michael Form 4 2026-09-25, Citadel 13G/A 2026-08-14) reach the grader only through press, if at all. A missing filing is never `insufficient_evidence`. When a press item is the first record, grade the event.
- Army-side records (SAM.gov, DoD contract announcements, which list only awards of $7.5M or more) and partner newsrooms (Red Cat, Anduril, Ondas) are not collected. When one arrives first, it is the official record and canonical over a later release.
- Furnished 7.01 8-Ks usually arrive the same day as the release. The release is canonical (core 5, 8-K plus release).

## Grader notes
- **Unnamed primes and missing values are never a discount.** Label them literally ("subcontract, prime unnamed, value undisclosed") and apply `floor:small_base`. Never call an MOU, CRADA, dataset contract or demo an order.
- **Tiny-base percentages.** "Up 2,539%" comes off Q3 2025 revenue of $101,422. Lead with dollars and the QoQ change, not the YoY percentage.
- **Restated contracts.** The CEO letter and the results release both restate the $2.5M prime, the $1.3M, the $780K and the State Dept work. Check each award against prior items. A restatement with no new figure is `already_covered`.
- **Base choice.** Use B = $10.71M; note the alt-base band in `why` when it differs, and flag `needs_owner`.
- **Segments.** Keep them apart. Airborne Response and Safe-Pro USA news never outranks AI contract news of the same size.
- **Timing.** Recap and retelling windows follow core 7 (24h for results recaps, 72h for guidance retellings).
- **Currency.** All amounts USD.

Sources verified 2026-11-18: [SEC submissions JSON](https://data.sec.gov/submissions/CIK0002011208.json) (filing list through 2026-11-16) and [2026-10-08 release](https://safeprogroup.com/safe-pro-awarded-new-ai-subcontract-and-launches-spai-ground-truth-for-next-gen-ground-intelligence/) ("initial order from a new U.S. government prime contractor customer"; terms not provided). Web search budget was exhausted, so no other facts were re-verified.
