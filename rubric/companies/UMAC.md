---
ticker: UMAC
name: Unusual Machines, Inc.
as_of: 2026-11-18
revision: "2026-11-18 rev2: brought in line with core v3.0. Sheet-local band restatements removed, front matter added, collector notes moved to sources/UMAC.md. No new facts were added. A web re-check was not possible in this pass because the search budget was used up, so the facts stand as researched on 2026-11-18."
asset_class: operating
filer_type: domestic (10-K / 10-Q / 8-K); CIK 0001956955; FY ends Dec 31
listing: NYSE American (UMAC)
fx_as_of: 2026-11-18   # all sheet figures are USD; no conversion needed
base_usd: 63_700_000
base_basis: "FY2026 implied: 9M 2026 actual $38.72M (10-Q) + $25M Q4 target (2026-11-05 call). Sheet base wins under core §12.2."
alt_base: {flag: true, usd: 55_600_000, basis: "Q3 2026 $13.9M x 4 (the core default, because the Q4 target is not formal guidance)"}
tiny_usd: 637_000      # 1% of base (base < $100M)
lead_usd: 6_370_000    # 10% of base
shares_basic: 51_910_000   # 10-Q cover, 2026-11-05 (49.98M at 2026-09-30)
market_cap_usd: 550_000_000  # ~$10.59 on 2026-11-17 (MarketBeat)
cash_usd: 162_000_000        # 2026-09-30, no borrowings
terms: ["Unusual Machines", "Fat Shark", "Rotor Riot", "Rotor Lab", "Upgrade Energy", "DroneNX"]
aliases:
  - {term: "UMAC", case: exact, needs: "company name, exchange-qualified ticker, or drone context"}
  - {term: "Upgrade Energy", case: insensitive, needs: "battery, drone or UMAC context"}
  - {term: "Rotor Lab", case: insensitive, needs: "motor, drone or UMAC context"}
  - {term: "Brave", case: exact, needs: "Rotor Riot flight-controller or ESC context"}
match_traps:
  - {term: "UMAC", case: exact, trap: "cryptographic message authentication code"}
  - {term: "Brave / BRAVE1", case: insensitive, trap: "Ukraine BRAVE1 defense cluster; Brave browser"}
  - {term: "Aura", case: insensitive, trap: "unrelated brands"}
  - {term: "fat shark", case: lower, trap: "the animal"}
  - {term: "Owl", case: insensitive, trap: "the word; the counterparty is Owl Autonomous Imaging"}
  - {term: "Drone Nerds", case: insensitive, trap: "XTI Aerospace unit, not UMAC"}
  - {term: "Fat Shark / Rotor Riot as 'Red Cat brands'", case: insensitive, trap: "pre-2024-02 stories; ownership has since moved"}
  - {term: "Black Widow / FANG", case: insensitive, trap: "Red Cat (RCAT) products; UMAC only if UMAC parts are named"}
  - {term: "PUSA", case: exact, trap: "items before Powerus took the ticker (Aureus Greenway)"}
cross_sheet_checks: [RCAT, PUSA, DPRO]   # check against the core §1 collision table before scoring
removed: []
thesis_drivers:
  - q4_target            # $25M Q4 2026 revenue target
  - ddp_flow             # Drone Dominance Program demand via OEM customers
  - oem_orders           # named OEM purchase orders
  - investee_portfolio   # strategic stakes and marks (Powerus, XTEND, Draganfly, Owl)
  - capacity_margin      # motor line, battery ops, 40% GM target, adj. EBITDA+ 2027
  - domestic_cameras     # domestic camera production, early 2027
  - dilution_overhang    # CEO warrant, resale S-3, earnouts, ATM
  - policy_tailwinds     # own-item use only (FCC Covered List, NDAA, Part 108)
open_items:
  - {id: q4_target_25m, text: "Q4 2026 revenue vs $25M target (call, 2026-11-05)", expires_at: 2027-03-31}
  - {id: fy2027_outlook, text: "First 2027 revenue target or guidance", expires_at: 2027-03-31}
  - {id: upgrade_earnout_p1, text: "Upgrade Energy earnout, first 12-month period from 2026-05-07 (up to $26M cash total)", expires_at: 2027-06-30}
group_keys: [earnings_calendar]
---

# UMAC — Unusual Machines, Inc.
_Researched 2026-11-18. NYSE American: UMAC (8-K and S-3 cover pages). CIK 0001956955. Fiscal year ends Dec 31. Nevada corporation; HQ 5728 Major Blvd, Suite 250, Orlando, FL. CEO Dr. Allan Evans (services via 8 Consulting LLC), CFO Brian Hoff, President Andrew Camden, CRO Stacy Wright. The Q4/FY2026 date has not been announced. Last year's Q4 letter came out 2026-03-09 (8-K 2.02) and the 10-K on 2026-03-12, so expect early to mid March 2027. Bands, floors and dilution tables come from core v3.0. This sheet gives UMAC's inputs (base, thresholds, drivers, open items) and the worked examples. Sheet-local values are marked "thesis lift" with their driver id._

## Identity & matching
- Legal entity: **Unusual Machines, Inc.** Subsidiaries and brands that count as UMAC news on their own:
  - **Fat Shark**: FPV headsets, cameras and VTX.
  - **Rotor Riot**: FPV store, plus the Brave-branded flight controllers and ESCs.
  - **Rotor Lab Pty Ltd**: Australian motor designer, acquisition closed 2025-09-03.
  - **Upgrade Energy LLC**: the acquired business was DroneNX LLC d/b/a Upgrade Energy, a battery maker. The acquisition **closed 2026-10-19** ([8-K](https://www.sec.gov/Archives/edgar/data/1956955/000168316826008046/umac_8k.htm), filed 2026-10-23). Its CEO is Matthew Barnard.
- Aliases need context (front matter `aliases`):
  - "UMAC" alone also means the cryptographic MAC. Require the company name, the ticker with an exchange, or drone context.
  - "Upgrade Energy" and "Rotor Lab" need battery, motor or drone context.
- Reject these collisions as `reason:off_entity`, scored 0-5 (front matter `match_traps`):
  - Bare "Brave": the BRAVE1 Ukraine cluster or the browser.
  - Bare "Aura", or "fat shark" the animal.
  - "Owl" the word. UMAC's counterparty is Owl Autonomous Imaging.
  - "Drone Nerds": a unit of XTI Aerospace, not of UMAC.
  - Red Cat's Black Widow or FANG news, unless it names UMAC parts.
  - Pre-2024-02 stories that call Fat Shark or Rotor Riot "Red Cat brands".
  - PUSA items dated before Powerus took the ticker, when it belonged to Aureus Greenway.
- **Cross-sheet collisions:** RCAT, PUSA and DPRO are covered and appear in UMAC items. An item naming both companies is direct involvement for both: one object per ticker with `also:<TICKER>` and `floor:covered_pair` where it applies. Before scoring, check the item against the core §1 collision table.
- Donald Trump Jr. or Dominari pieces with no new UMAC fact are commentary: `reason:out_of_scope`, below 20.

## What the stock trades on
1. **Hitting quarterly revenue targets** (`q4_target`, open item `q4_target_25m`). Q3 was $13.9M (+551% y/y), at the top of the $12–14M internal target. The **$25M Q4 target** was reiterated on the 2026-11-05 call ([Q3 letter](https://www.sec.gov/Archives/edgar/data/1956955/000168316826008346/umac_ex9901.htm); [finviz](https://finviz.com/news/418087/unusual-machines-misses-on-gaap-investment-markdowns-but-revenue-beat-and-reaffirmed-25m-q4-target-shift-the-debate-to-execution)). The $25M figure is not in the letter itself.
2. **Drone Dominance (DDP) flow-through and named OEM orders** (`ddp_flow`, `oem_orders`). Examples are Powerus $16.9M and PDW $3.75M. DDP Phase III / Gauntlet III ($450M, about 60k one-way attack drones; testing about March 2027) feeds 2027 demand ([DroneLife](https://dronelife.com/2026/10/14/drone-dominance-phase-iii-gauntlet-2-5/)).
3. **Working capital and the investee portfolio** (`investee_portfolio`). UMAC holds $162.0M cash and $98.4M of short-term investments ($53.4M at fair value plus $45.0M at cost), including Powerus and XTEND. The investments drove an **$18.4M unrealized loss in Q3**, and the inventory build ($42.4M to $65.9M) is the bears' main point.
4. **Capacity and margin** (`capacity_margin`, `domestic_cameras`). Gross margin was 35.4% against a 40% target. A new automated motor line will add 100k motors a month once fully operational, 100k sq ft of space is being added in Q4, and domestic camera production starts early 2027. Management targets positive adjusted EBITDA in 2027 (Q3 adjusted EBITDA was -$0.7M).
5. **Policy tailwinds** (`policy_tailwinds`). The FCC Covered List now covers foreign drones and components, the NDAA sourcing rules apply, and the FAA Part 108 final rule is pending at OIRA. This driver counts only on UMAC's own items. Policy news that does not name UMAC is out of scope (core §9).
6. **Dilution and overhang** (`dilution_overhang`). The CEO warrant (5M at $25, about 9.6% of 51.91M shares, approved 2026-10-05), the S-3 resale of 1.93M shares (filed 2026-11-13), and earnouts.

## Materiality bases
- **Revenue base B: $63.7M.** This is FY2026 as implied by actual 9M revenue of $38.72M ([10-Q](https://www.sec.gov/Archives/edgar/data/1956955/000168316826008349/umac_i10q-093026.htm)) plus the $25M Q4 target. The core default would be Q3 × 4 = $55.6M (`alt_base`), but the sheet base governs. Roll it to the FY2027 target or guidance once one is given, with owner approval (core §12.3). For reference, the Q4 target annualizes to $100M.
- **Thresholds** (core §4.2.1; p = V ÷ $63.7M on total order value):
  - **Tiny: below $0.637M** (p < 1). Scores 25-39, or 55-65 for a first customer, new country or first production-scale buy.
  - **p 1-3 ($0.64–1.9M):** binding 72-80.
  - **p 3-10 ($1.9–6.37M):** binding 80-89.
  - **Lead: $6.37M or more** (p ≥ 10). Binding 90-97, `floor:lead_order`.
  - Selected or pre-award rows and quantified MOU rows follow the core table. The small-base rule does not apply, because B is above $25M.
- **Backlog:** none disclosed. Treat company-announced POs as booked orders (`company_reported`).
- **Liquidity:** $162.0M cash at 2026-09-30, no borrowings, working capital $342.1M. Shares outstanding were 49.98M at 9/30 and 51.91M at 2026-11-05 (10-Q cover).
- **Market cap:** about $550M at $10.59 on 2026-11-17 ([MarketBeat](https://www.marketbeat.com/instant-alerts/consensus-unusual-machines-inc-umac-what-are-researchers-saying-about-this-stock-2026-11-17/)).
- **Capital events (core §4.2.2, d ÷ 51.91M basic shares):**
  - d of 5% is about 2.6M shares, 10% about 5.2M and 20% about 10.4M. Grade by the core dilution table.
  - A $60M ATM program is in place (10-Q). That is about 5.7M shares at $10.59, or 10.9% of shares and of market cap. Grade takedowns by d.
- **Outbound strategic investments (thesis lift, `investee_portfolio`).** Core has no rung for minority stakes UMAC makes. Grade them on the `deal` rung:
  - A stake of 10% of B ($6.37M) or more: 75-85.
  - $1M up to $6.37M: 55-70.
  - Covered-to-covered stakes take `floor:covered_pair` (75).
- **Investment marks (thesis lift, `investee_portfolio`):** a disclosed mark or write-down of $10M or more (about 10% of the $98.4M portfolio) scores 70-80 as a standalone disclosure. Inside a results item it is a fact for `why`.

## Event ladder for this name
Score ranges below apply core v3.0 to UMAC's base. Historical examples are older than 21 days and now grade `stale`. They are kept only to show the band.
- **Lead (90-100)**
  - An order or PO of $6.37M or more (p ≥ 10), `floor:lead_order`. Examples:
    - "Unusual Machines Receives $16.9 Million Purchase Order from Powerus for American-Made Drone Components", 2026-10-22 ([EX-99.1](https://www.sec.gov/Archives/edgar/data/1956955/000168316826008013/umac_ex9901.htm)). p = 26.5; it covers motors, batteries, cameras and VTX. Score about 93 with `also:PUSA` and `floor:covered_pair`.
    - Historical: Strategic Logix $12.8M order, 2025-09-30 ([EX-99.1](https://www.sec.gov/Archives/edgar/data/1956955/000168316825007320/umac_ex9901.htm)). p = 20.1.
  - Equity raises graded by the core dilution table: d ≥ 20% scores 85-95. Missing share counts: use proceeds ÷ market cap, confidence ≤ 0.6. Example: the $150M public offering, 424B5s dated 2026-03-19 and 2026-03-20.
  - The Q4 print against the $25M target (`floor:results` 80; `resolves:q4_target_25m` gives `floor:open_item` 80).
    - A ≥20% miss (revenue of $20M or less) is Lead by core.
    - Thesis lift (`q4_target`): a miss or beat of 10% or more (≤ $22.5M or ≥ $27.5M) adds +5-15.
    - Withdrawal of the target, or a first 2027 target or guidance (`resolves:fy2027_outlook`), follows the core guidance rule.
  - The largest customer named as a new 10% customer (`results` rung, 80-98). A loss at a key customer takes `floor:key_loss` 70 and is mirrored at the size of the original win.
- **Digest (70-89)**
  - Same-day quarterly results with figures (`floor:results` 80). Example: Q3 2026 letter, 2026-11-05: $13.9M revenue, 35.4% gross margin, $162.0M cash, Q4 target reiterated on the call. Revenue landed at the top of the target, so score about 84.
  - Orders of $1.9–6.37M (p 3-10): 80-89. Examples:
    - PDW $3.75M, 2025-12-22 ([EX-99.1](https://www.sec.gov/Archives/edgar/data/1956955/000168316825009300/umac_ex9901.htm)). p = 5.9.
    - The Powerus order of more than $5M, 2026-04. p ≥ 7.8, with `also:PUSA`.
    - $2.1M PO from an unnamed customer, 2026-01-15 ([EX-99.1](https://www.sec.gov/Archives/edgar/data/1956955/000168316826000348/umac_ex9901.htm)). p = 3.3, so 80-89, about 80. `floor:order` does not apply because the counterparty is not named. Write "unnamed customer" in `why`.
  - Orders of $0.64–1.9M (p 1-3): 72-80. A binding order with a named counterparty and no value: 70-78 (`floor:order`) unless it is clearly minor.
  - Acquisition as acquirer (`deal`): signed 75-88, closed 75-85. Example: Upgrade Energy closing, 2026-10-19: 1,792,012 shares (about $25.0M; d = 3.6% of 49.98M) plus $1M cash, with a cash earnout of up to $26M. Score about 82, with a thesis lift from `capacity_margin` (batteries).
  - Strategic stakes (outbound rule in Materiality bases). Examples:
    - "Invests an Additional $20 Million in XTEND AI Robotics", 2026-09-09 (total $27.5M). 75-85.
    - The $5M Draganfly stake at $5.35/share, 2026-09-28 ([BNN](https://www.bnnbloomberg.ca/business/technology/2026/09/28/trump-jr-backed-unusual-machines-us-asset-manager-invest-us10m-in-canadas-draganfly-reuters-exclusive/)). Core anchor: 76 for UMAC and 80 for DPRO, `floor:covered_pair`.
  - ATM takedowns, graded by d.
  - CEO or CFO in or out: `floor:neo_ceo_cfo` 75. COO, President or CTO: `people` 70-88. Other named executive officers: `floor:neo` 70.
  - Blue UAS listings of new parts (`permission`): 70-90.
  - New production lines with stated capacity (`proof`): 60-85, plus a `capacity_margin` lift.
  - Earnings-date notices: fixed 75, `floor:calendar`, `group:earnings_calendar`.
- **Borderline (40-69)**
  - Auditor change: Salberg & Company to Ernst & Young with no disagreements, 8-K 4.01, 2026-08-12 ([8-K](https://www.sec.gov/Archives/edgar/data/1956955/000168316826006280/umac_8k.htm)). Routine change, 40-55, about 50.
  - CEO warrant:
    - Adoption, "Adopts Performance-Based Executive Compensation" (8-K 5.02, 2026-07-28). A pay plan scores below 25 by core, plus a `dilution_overhang` lift for 5M warrants (9.6%). About 40.
    - Approval on 2026-10-05 by 9.21M votes for and 7.63M against ([5.07](https://www.sec.gov/Archives/edgar/data/1956955/000168316826007699/umac_8k.htm)): 45-65, about 50. Evans waives cash pay after 2026-12-31.
  - S-3 resale shelf, 2026-11-13, with no primary offering: 1,929,272 shares, 3.7% of outstanding. 40-55, about 45.
  - Facility leases: "Expands Orlando Manufacturing Footprint to Support Battery Operations", 2026-06-25 (8-K 1.01). 50-60; with stated capacity it grades as `proof`.
  - Named-counterparty partnerships with concrete integration but no volume (core scope rule): 55-65. Example: Altana supply-chain partnership, 2026-09-03, about 58. A generic partnership scores 25-39.
  - Outbound investments under $6.37M. Example: Owl Autonomous Imaging $5M secured convertible note (7%, due 2027-07-31), dated 2026-07-31. About 60.
  - Orders below tiny ($0.637M): 25-39, or 55-65 for a first customer, new country or first production-scale buy.
- **Reject (<40)**
  - VP promotions: Trish Ellis 2026-06-01, Tyler Crane 2026-07-13. Below 25.
  - "Added to Russell 2000", 2026-06-29. Index inclusion, 30-39.
  - Conference participation: 2026-07-31 and 2026-09-08. 0-20, `reason:promotional`.
  - Annual-meeting record date, 2026-07-28. 10-20.
  - Investor-deck 8-K 7.01 with no new figures, 2026-11-10. Repeat deck, 20-35.
  - Officer pay changes (8-K 5.02(e), 2026-04-07). Below 25.
  - Rotor Riot hobby content (`reason:promotional`). Stock-move and price-target pieces: below 20, `reason:out_of_scope`.

## Always surface (floors)
Core floors apply as written: `results` 80, `guidance` 80, `open_item` 80, `lead_order` 90, `order` 70, `covered_pair` 75, `deal_signed` 75, `neo_ceo_cfo` 75, `neo` 70, `capital_big` 75, `calendar` 75, `deficiency` 70, `key_loss` 70, `existence` 85. Grade 8-K Items 1.01, 2.01 and 3.02, 424B5s, S-3s, 4.01s, Form 4s and Form 144s by the core §5 grid. UMAC adds no per-form floors.

UMAC thresholds behind the core floors:
- `lead_order`: V ≥ $6.37M.
- `order`: V ≥ $0.637M with a named counterparty.
- `capital_big`: d ≥ 10%, about 5.2M shares, or a discount of 15% or more.

UMAC-specific surfacing (thesis lifts, not new floors):
- Any PO naming Powerus, Red Cat/Teal, PDW, XTEND, Draganfly or a DDP vendor is a `floor:order` candidate even without a value (core no-value rule, 70-78). Add `ddp_flow` or `oem_orders` to `thesis_drivers_hit`.
- Upgrade Energy earnout or battery-revenue disclosures: `capacity_margin`. The first-period result takes `resolves:upgrade_earnout_p1`.
- Investment marks or write-downs of $10M or more: `investee_portfolio`, 70-80 standalone.
- Any disclosure of largest-customer share: `results` rung when it reveals a new 10% customer.

## Noise patterns
- **Archive bursts (core §8, R-0050)**, all notified=1 in news-monitor-db:
  - On 2026-10-28 at 14:50, `unusual_press` delivered 15 items in one crawl, dated 2026-06-01 to 2026-10-22.
  - On 2026-07-29 at 15:33, the `unusual` key delivered 40 8-Ks dated 2025-06-30 to 2026-07-28.
  - Gate each item on its own event date. Anything more than 21 days old scores 0-9 with `reason:stale`, `archive_burst` and `source_repair`.
- **Late press copies.** The 10-28 burst delivered the Powerus PO 6 days late and the Upgrade close 9 days late. `unusual` had already carried the same-day 8-Ks (2026-10-22 and 2026-10-23). When the 8-K was graded first, the release is the same event: `score: null`, `reason:duplicate`, `dup_of:<8-K item id>`. Grade it as an update only if it adds facts.
- **Bare EDGAR titles.** Every `unusual` item is titled "Unusual Machines, Inc.: 8-K filed <date>". Open the filing (`read_source: true`) and grade by the Item numbers and the exhibit text (core §5). A 7.01 deck or conference copy scores below 40.
- **Promotional and HR items.** Conferences and record dates score 0-20 with `reason:promotional`. VP promotions score below 25. Russell inclusion scores 30-39 with `reason:below_materiality`.
- **Same-day duplicates.** The 8-K exhibit and the press release are the same release (for example the Q3 letter on 2026-11-05 in both keys). If both arrive in one run, the release is canonical. An earlier 8-K stays canonical until the release arrives (core §5). The other copy is a duplicate with no independent score.
- **Recaps.** Secondary earnings recaps more than 24h after the print, and target retellings more than 72h after, score below 30 with `reason:late_repost` (core §7).

## Catalyst calendar
- **Q4 2026:** 100k sq ft expansion and the ramp of the automated motor line (`capacity_margin`).
- **S-3 effectiveness (filed 2026-11-13, timing open):** frees 1,929,272 shares for resale. That is Barnard's 1,792,012 Upgrade shares plus 137,260 Rotor Lab shares. The EFFECT notice itself scores 0-15.
- **Late 2026 to early 2027:** the FAA Part 108 final rule. It went to OIRA on 2026-07-10, and the FAA said in September it hopes to publish before year-end ([UAV Coach](https://uavcoach.com/part-108-stuck/), 2026-09-16). Context only: rule news that does not name UMAC is `out_of_scope`.
- **2026-12-31:** the CEO services agreement with 8 Consulting runs to this date. Evans's cash compensation ends after it under the warrant deal.
- **Early 2027:** domestic camera production begins (`domestic_cameras`; a start or a slip is `proof`).
- **About March 2027:** DDP Gauntlet III testing, followed by orders. Context only unless an item names UMAC or a UMAC order.
- **About March 2027 (open items `q4_target_25m`, `fy2027_outlook`, expire 2027-03-31):** Q4/FY2026 results. This tests the $25M Q4 target and should bring the first 2027 outlook.
- **About May 2027 (open item `upgrade_earnout_p1`, expires 2027-06-30):** the first 12-month calculation period of the Upgrade earnout ends. The S-3 says the earnout covers two 12-month periods measured from the 2026-05-07 merger agreement, with up to $26M in cash.
- **About September 2027:** the final Rotor Lab earnout tranche (the second anniversary of the 2025-09-03 closing). The first tranche, for the 12 months to 2026-09-02, was settled after Q3 with 137,260 shares.
- **2027:** the adjusted-EBITDA-positive target. The CEO warrant tranches (1M each) vest at $25, $40, $60, $80 and $100 on a 20-trading-day average; the warrants expire 2031-07-24.

## Customers, programs, agencies & counterparties
| Counterparty | Disclosure | Relationship | big (≥5% rev) |
|---|---|---|---|
| **Powerus (PUSA, covered)** | `release` | A PO of more than $5M (2026-04) and the $16.9M PO (2026-10-22). UMAC also made a $30M equity investment, disclosed in June 2026. Customer and investee; covered pair | yes |
| **Red Cat / Teal Drones (RCAT, covered)** | `filing_only` | Related party: Red Cat's CEO Jeffrey Thompson sits on UMAC's board (re-elected 2026-10-05). Related-party revenue was $2.0M in Q3 and $4.2M over 9M 2026 (about 11%), with $1.9M of related-party receivables | yes |
| **Performance Drone Works** | `release` | A $3.75M initial order (2025-12-22) under a strategic supplier relationship | unknown |
| **XTEND** | `release` | Customer and investee ($27.5M total), and a DDP Gauntlet II close-quarters leader | unknown |
| **Strategic Logix** | `release` | A $12.8M order for RRSL drone systems (2025-09-30) | unknown (2025) |
| **Draganfly (DPRO, covered)** | `release` (counterparty, Reuters) | A $5M stake at $5.35/share (2026-09-28); covered pair | n/a (investee) |
| **Owl Autonomous Imaging** | `release` | A $5M secured convertible note (2026-07-31) | n/a (investee) |
| **XTI Aerospace / Drone Nerds** | counterparty releases | Grade only when the release names UMAC | n/a |
| **Drone Dominance Program** (Department of War / DIU) | official records | UMAC supplies components to DDP vendors; it is not a DDP vendor itself | program |

## Competitors & read-through
Core §9 applies. Peer news is `out_of_scope` (0-15) unless it passes one of these tests:
- **Rival at a key account (§9.4).** ModalAI, ARK Electronics (flight controllers and ESCs) or Orqa (FPV) named as a supplier to Powerus, Red Cat/Teal, PDW or XTEND for a category UMAC sells: 50-69 as a possible loss. If replacement of UMAC is confirmed, it is `money` bad news (70+). A rival's Blue UAS listing or general contract win alone is out of scope.
- **DDP awards to UMAC customers** (Powerus, XTEND, PDW, Teal) are not UMAC items unless the item names UMAC parts or a UMAC order.
- **Investee share-price moves** change UMAC's GAAP result but are not UMAC items unless UMAC discloses a mark.
- **Published text** names UMAC only when the source does. Internal mappings move scores, never `why` or `note_hook`.

## Source coverage gaps
Collector and polling notes moved to `sources/UMAC.md` (worker doc). Only the facts that affect freshness and the canonical choice stay here:
- `unusual` carries 8-Ks only. A 10-Q, S-3, proxy, Form 4, Form D or 13G may first reach the grader through press or another source. Grade it on its own event date. A missing expected filing is never `insufficient_evidence`.
- `unusual_press` arrives in late bursts from a page rendered by JavaScript, often without body text. Use the same-day 8-K exhibit as canonical when it exists. Gate press copies on event date (see Noise patterns).
- Counterparty releases (Draganfly, Powerus, XTI, XTEND) can be the first record of a UMAC event. They are on-entity when they name "Unusual Machines", "Fat Shark" or "Rotor Riot".

## Grader notes
- **GAAP net loss.** The Q3 GAAP net loss of $25.0M (-$0.50/share) was mostly an $18.4M unrealized loss on short-term investments plus $5.5M of stock compensation. The headline should lead with revenue, gross margin and the target, and label the unrealized loss literally. Never call it an operating miss.
- **"Targets" are not formal guidance.** Write "target", not "guidance". The $25M Q4 figure came from the call, not the letter, so it is a `mgmt_claim` until printed. A change to the target is graded by the core guidance rule only when the company states it.
- **Investee customers.** Powerus and XTEND are customers and investees, and Red Cat is a related party. State both facts in the item and draw no inference.
- **Unnamed-customer POs** (for example 2026-01-15, $2.1M) are graded on p by the core table. Write "unnamed customer" in `why`, apply no `floor:order`, and never attribute the order to a customer the release does not name.
- **Covered pairs.** A Powerus PO or Draganfly stake produces one object per ticker (`#UMAC`, `#PUSA` / `#DPRO`) with `also:` flags.
- **Old sheet facts that are stale:**
  - The Upgrade acquisition is closed, no longer pending.
  - Camera production moved from late 2026 to early 2027.
- **Removed in rev2** (sheet-local restatements of core bands with no owner mark):
  - The "Borderline $0.64–3.2M" order band.
  - Acquisition closings as Lead.
  - The 5%/15% dilution thresholds.
  - Per-form floors for 1.01, 2.01, 3.02, 424B5, 4.01 and Form 4.
  - The 70 calendar score (now fixed 75).
  - The auditor-change 60 (now 50).
- **Currency.** All amounts are USD (`fx_as_of` 2026-11-18). Draganfly stake amounts are in US$; Draganfly's own revenue base is in C$ on the DPRO sheet. Rotor Lab is Australian, but its consideration is in UMAC shares valued in US$.
