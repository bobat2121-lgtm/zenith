---
ticker: DPRO
name: Draganfly Inc.
as_of: 2026-11-18
asset_class: operating
filer: foreign private issuer, MJDS (40-F / 6-K / SUPPL); Canadian filings on SEDAR+; CIK 0001786286; FY ends Dec 31; listed Nasdaq DPRO, CSE DPRO, FSE 3U8
base_usd: 5720000             # B: latest quarter x4 (Q3 2026 C$2,048,425 x4 = C$8,193,700) at cad_usd below; core 4.2.1 order (no guidance is given)
base_cad: 8193700             # C$ value of B; re-convert at the event-date rate when a score sits on a band edge
base_basis: "Q3 2026 revenue x4 (C$8.19M) at Bank of Canada USD/CAD 1.4326 (2026-11-18); Q3 release and interim 6-K 2026-11-10"
base_date: 2026-11-10
# no alt_base: LTM C$8,937,214 (Q4'25 C$1,912,199 + 9M'26 C$7,025,015) ~ US$6.24M and FY2025 C$7,731,163 ~ US$5.40M both sit within ~10% of B; lead would move only between ~US$0.54M and ~US$0.62M
tiny_usd: 57200               # 1% of B (B < $100M), ~C$81.9K
lead_usd: 572000              # 10% of B, ~C$819K
small_base: true              # B < $25M in USD: core 4.2.1 small-base rule applies (named paying customer, contract or deployment >= 70 without a value)
shares_outstanding: 39142756  # 2026-09-30, Q3 interim statements (6-K 2026-11-10, Ex.99.1); the MD&A dated 2026-11-10 gives no later count. Also 5,753,983 warrants, 1,686,176 RSUs, 21,944 options. d 5% = 1.96M; 10% = 3.91M; 20% = 7.83M shares
cash_usd: 89770000            # C$128,605,465 at 2026-09-30 x cad_usd; working capital C$144,232,724; capital is judged on d, never on cash (core 4.2.2)
market_cap_usd: null          # compute as shares_outstanding x the last Nasdaq (US$) close on the event date; never assume a price
fx_as_of: 2026-11-18
reporting_currency: CAD       # results in C$ (MD&A: amounts in Canadian dollars unless otherwise noted); financings and Skip Dynamix terms are in US$
cad_usd: 0.6980               # 1 / Bank of Canada daily USD/CAD 1.4326, 2026-11-18
terms: ["Draganfly Inc.", "Draganfly Innovations Inc.", "Draganfly Innovations USA", "Draganfly Defense USA", "Dronelogics", "Dronelogics Systems", "Skip Dynamix", "Flex FPV", "Draganfly Flex", "Commander 3XL", "Draganfly Commander", "Draganfly Heavy Lift", "Draganfly Apex", "Astiia"]
aliases: ["$DPRO", "Draganfly", "3U8"]
removed: ["drone delivery canada", "savve"]   # news-monitor coverage.js DPRO terms; neither is a Draganfly entity
traps:
  - {term: "DPRO", case: sensitive, rule: "ticker or cashtag only (Nasdaq and CSE)"}
  - {term: "3U8", case: sensitive, rule: "Frankfurt ticker only"}
  - {term: "Dragonfly", case: insensitive, rule: "not Draganfly; reject Dragonfly Energy, NASA's Dragonfly mission and other Dragonfly drones"}
  - {term: "Orca", case: insensitive, rule: "only alongside Draganfly or Skip Dynamix; reject Boeing's Orca XLUUV"}
  - {term: "Flex|Commander|Heavy Lift|Apex|Blitz", case: insensitive, rule: "only alongside 'Draganfly' or the full model name (Flex FPV, Commander 3XL)"}
  - {term: "Astiia", case: insensitive, rule: "Draganfly's Low-Cost Tactical ISR UAS system; a CanadaBuys or DND item naming Astiia counts without 'Draganfly'"}
  - {term: "Mountain Horse Solutions|Global Ordnance|F4 Defense International|Prime Strategic Holdings|Razon Group|DoD Solution|ACSL", case: insensitive, rule: "partners, not DPRO entities; match only when Draganfly is named in the same item"}
  - {term: "Volatus|Unusual Machines|Red Cat", case: insensitive, rule: "peers and investor, not DPRO entities; count only when Draganfly is named (a UMAC-DPRO deal is covered-to-covered)"}
thesis_drivers: [ddi_callups, inflection_timing, dow_adoption, cash_burn, gross_margin]
open_items:
  - {id: ye_opportunities, what: "Announcements on at least two more opportunities the CEO said to expect before year-end (Q3 call)", expires_at: 2026-12-31}
  - {id: ddi_callup, what: "First Low-Cost Tactical ISR UAS (DDI) call-up or option exercise beyond the 100 firm systems", expires_at: 2027-12-31, note: "sheet calendar says 'rolling, 2026-12 to 2027'; end-2027 set by sheet author, needs_owner"}
  - {id: canada_rfps, what: "First outcome, either way, of the 19 Canadian military RFPs Draganfly says it is in", expires_at: 2027-12-31, note: "set by sheet author, needs_owner"}
  - {id: heavy_lift_commercial, what: "First commercial Heavy Lift sale enabled by the FAA Section 44807 exemption (2026-09-01)", expires_at: 2027-12-31, note: "set by sheet author, needs_owner"}
  - {id: dow_repeat, what: "Repeat order from a DoW Heavy Lift or Commander 3XL customer (first sales announced 2026-10-27)", expires_at: 2027-12-31, note: "set by sheet author, needs_owner"}
  - {id: philippines_definitive, what: "Definitive Philippine JV agreements with Prime Strategic Holdings (Razon Group) signed, or the framework ended", expires_at: 2027-06-30, note: "no date disclosed; sheet-author default, needs_owner"}
  - {id: skip_earnout, what: "Skip Dynamix earn-out milestones (up to US$2.5M, cash or up to 80% in shares at US$6.46): met or missed", expires_at: 2027-06-11, note: "milestone dates not disclosed; first anniversary of the 2026-06-11 close (founders' payment-share condition) used, needs_owner"}
  - {id: inflection_2027, what: "Revenue inflection guided to 'Q2, particularly Q3 2027' (Q3 call): reaffirmed, delivered or slipped again", expires_at: 2027-11-15, note: "covers the Q3 2027 print (2026 cadence: Q3 on 2026-11-10); a slip is a lead-level negative"}
  - {id: ddp_next_phase, what: "Next Drone Dominance phase result for a Mountain Horse or Global Ordnance entry carrying the Draganfly Flex, either way", expires_at: 2027-12-31, note: "2027, dates TBD; set by sheet author, needs_owner"}
groups: [earnings_calendar]   # the body's 'earnings_dates' key is not a core key (core §8); no custom dpro_<slug> key is declared
owner_marks:
  - {line: "Driver lines", mark: "owner:2026-11-24", overrides: "core 1 out-of-scope rule for policy and budgets, the core 9 read-through boundary, and the core 4.5 timeliness deduction below 70 for Digest items, for US drone rules, presidential drone and airspace actions, Defense appropriations and CRs naming a drone program, and DoW drone industrial policy only"}
---

# DPRO — Draganfly Inc.
_Researched 2026-11-18. Listed on Nasdaq (DPRO), CSE (DPRO) and FSE (3U8). SEC CIK 0001786286. Canadian foreign private issuer: files 6-K, 40-F and SUPPL (MJDS prospectus supplements) with the SEC, and its Canadian filings go to SEDAR+. Fiscal year ends Dec 31. Q4/FY2026 results are expected in late March 2027; the FY2025 results and 40-F were both released 2026-03-24 ([EDGAR](https://www.sec.gov/Archives/edgar/data/1786286/000149315226012377/ex99-2.htm)). The 2026 prints came on 2026-05-11 (Q1), 2026-08-10 (Q2 call) and 2026-11-10 (Q3), so Q1 2027 is expected around 2027-05-10._

## Identity & matching
- **Legal entities:**
  - Draganfly Inc. (parent, Saskatoon).
  - Draganfly Innovations Inc. (operating company, named in Canadian procurement records).
  - Draganfly Innovations USA Inc. (US contracts).
  - **Draganfly Defense USA, Inc.**, a dedicated US defense subsidiary announced 2026-10-12. Its chairman is Thomas Modly, former Under Secretary and Acting Secretary of the Navy, who left the Draganfly Inc. board to take the role. Its president is BGen (ret.) AJ Pasagian, appointed 2026-08-25 ([release](https://draganfly.com/press-release/draganfly-establishes-dedicated-u-s-defense-subsidiary-appoints-former-under-secretary-acting-secretary-of-the-navy-thomas-modly-as-chairman/)).
- **Units:**
  - Dronelogics Systems (Burnaby, BC).
  - Skip Dynamix drone business: an asset purchase signed 2026-05-18 and closed 2026-06-11 for up to US$7.525M (US$2.525M cash, US$2.5M in shares, up to US$2.5M earn-out). It brings the Orca fixed-wing drone ([release](https://draganfly.com/press-release/draganfly-completes-acquisition-of-skip-dynamix/)).
- **Products:** Flex FPV, Apex, Commander 3XL, Heavy Lift, Orca, Blitz optical payloads (launched 2026-05-19) and Astiia, the system Draganfly says it will supply under Canada's Low-Cost Tactical ISR UAS contract.
- **ACSL:** Draganfly is Japanese maker ACSL's exclusive distributor for Canada (2026-05-07).
- **Context guards:** Orca, Flex, Commander, Heavy Lift, Apex and Blitz count only alongside "Draganfly" or the full model name. Orca is also Boeing's XLUUV.
- **Reject these collisions:**
  - "Dragonfly": Dragonfly Energy, NASA's Dragonfly mission and other Dragonfly drones.
  - The terms "drone delivery canada" and "savve" in news-monitor `coverage.js` DPRO terms: neither is a Draganfly entity, so remove both.
- **Partners count only when Draganfly is named:** Mountain Horse Solutions, Global Ordnance, F4 Defense International, Prime Strategic Holdings/Razon Group, DoD Solution, ACSL.

## What the stock trades on
1. **Converting Canadian defence selections into funded call-ups.** The Low-Cost Tactical ISR UAS contract (Defence Drone Initiative, announced 2026-09-11) runs five years with 100 firm systems and options for up to 4,900 more, about C$24-25M if every option is exercised. Other vendors were also awarded, including Volatus. Draganfly says it is in 19 Canadian military RFPs.
2. **The revenue inflection date.** On the Q3 call management moved it to "Q2, particularly Q3 2027", about a year later than before, citing slow US funding and slow Canadian program development ([call summary](https://www.thestockobserver.com/?p=8991238)). Every order or slip is read against this date.
3. **US Department of War adoption.**
   - Flex FPV with DoW units: two more units selected it on 2026-05-08.
   - First Heavy Lift sales and Commander 3XL sales to an existing DoW Flex customer across "multiple Light Infantry Divisions" (2026-10-27).
   - The DEVCOM ARL counter-UAS development contract with F4 Defense (selected 2026-05-20).
   - The Drone Dominance Program, where the Mountain Horse entry carrying the Draganfly Flex did **not** make either Gauntlet II top-5 board ([DefenseScoop 2026-09-18](https://defensescoop.com/2026/09/18/drone-dominance-program-gauntlet-2-results/), [SSD 2026-09-25](https://soldiersystems.net/2026/09/25/drone-dominance-program-announces-gauntlet-ii-results/)).
4. **Cash and burn.** Cash was C$128.6M against a Q3 net loss of C$12.8M (C$30.5M for 9M). M&A, strategic investments and dilution decide what that cash is worth per share.
5. **Gross margin and mix.** Q3 gross margin was 6.3% reported and 24.2% excluding the C$366,609 inventory write-down. The year-on-year revenue decline was mainly in services.

## Materiality bases
- **Revenue base: C$8.19M**, the latest quarter ×4 (Q3 2026 revenue C$2,048,425, down 5.0% YoY). No guidance is given.
  - LTM revenue is about C$8.94M: 9M 2026 of C$7,025,015 plus Q4 2025 of about C$1.91M.
  - FY2025 revenue was C$7,731,163.
  - Source: [Q3 release 2026-11-10](https://capital.com/en-gb/news/draganfly-announces-third-quarter-results).
- **Backlog:** not disclosed. The DDI option ceiling of about C$24M is not backlog.
- **Liquidity (2026-09-30):** cash C$128,605,465, working capital C$144,232,724, 39,142,756 shares outstanding (29,344,775 at 2025-12-31). Raises in 2026:
  - US$50M registered direct, 7.15M shares at US$7.00, priced 2026-02-25 and closed about 2026-02-27.
  - US$10M registered direct, 1,869,159 shares at US$5.35, US$5M each from Unusual Machines and a US fund. Announced 2026-09-28, closed 2026-09-29 per the company's "Closing" release.
- **Order thresholds** (test against total or obligated value; note the annual rate separately):

| Line | Rule | Value |
|---|---|---|
| Tiny | 1% of base (the base is under C$100M) | below about C$80K |
| Meaningful | | about C$250K and up |
| Lead | 10% of base | C$0.82M or more (about US$0.6M) |
| Lead, no value needed | A first production-scale buy, a new agency or country, or a call-up exercising the 4,900-unit option | |

- **Capital events** are scored on dilution against 39.1M shares, the discount to market, structure and counterparty, never against the cash pile.

## Event ladder for this name
- **Lead (90-100)**
  - A funded order of C$0.8M or more.
  - DDI call-ups or option exercises.
  - A named DoW program award.
  - Acquisition of Draganfly, or Draganfly buying a company with revenue.
  - An inflection-timing change or results miss on the print day.
  - Example: "Draganfly Selected by Government of Canada to Supply Low-Cost Tactical ISR UAS to the Canadian Armed Forces", 2026-09-11 ([nasdaq](https://www.nasdaq.com/press-release/draganfly-selected-government-canada-supply-low-cost-tactical-isr-uas-canadian-armed)).
- **Digest (70-89)**
  - Same-day quarterly results (floor 80, figures first).
  - Follow-on US defense orders without values.
  - FAA or Transport Canada approvals that unlock sales.
  - Financings of 5% dilution or more, or with a strategic investor.
  - CEO, CFO or President changes.
  - Qualification on a procurement vehicle.
  - Drone Dominance results either way.
  - Examples:
    - "Draganfly Announces Third Quarter Results", 2026-11-10 ([nasdaq](https://www.nasdaq.com/press-release/draganfly-announces-third-quarter-results-2026-11-10)).
    - "Draganfly Announces U.S. Defense Sales Across Heavy Lift and Commander 3XL Platforms", 2026-10-27: first Heavy Lift sales, no values or units ([release](https://draganfly.com/press-release/draganfly-announces-u-s-defense-sales-across-heavy-lift-and-commander-3xl-platforms/)).
    - "Draganfly Announces Strategic Investment from Unusual Machines and a Leading U.S. Investment Fund", 2026-09-28: 1.87M shares, about 6.4% of pre-deal shares. This is covered-to-covered, so it is also Tier 1 for UMAC.
    - "Draganfly Secures Milestone FAA Section 44807 Exemption for Heavy Lift Drone Platform", 2026-09-01: commercial operations over 55 lb.
    - "Draganfly Selected for All Five Capability Streams of Canada's New Defence Drone Initiative Marketplace", 2026-09-08.
- **Borderline (40-69)**
  - Non-binding frameworks and joint ventures with a named counterparty but no value. Example: "Draganfly Signs Exclusive Agreement to Provide Drone Manufacturing in the Philippines", 2026-11-16, with Prime Strategic Holdings (Razon Group). Definitive agreements are still pending ([DroneXL](https://dronexl.co/2026/11/16/draganfly-philippines-drone-manufacturing-prime-strategic/)). Label it "framework".
  - Minority strategic investments of undisclosed size. Example: DoD Solution (AURA autonomy), 2026-10-13. Its pre-seed round totalled about US$2.1M; Draganfly's share was not disclosed.
  - Subsidiary formation or board-level appointments. Example: Draganfly Defense USA and the Modly appointment, 2026-10-12.
  - Association and readiness programs, which are MOU-like: SRLEEA drone-readiness partnership (2026-07-27) and IACLEA program (2026-06-25).
  - Flagship product launches, 55-65. Example: Blitz payloads, 2026-05-19.
  - Distribution agreements. Example: ACSL Canada, 2026-05-07.
- **Reject (<40)**
  - Sub-officer hires. Example: "Draganfly Appoints Colonel (Ret'd) Kevin Leblond to Lead Canadian Defence and Security Initiatives", 2026-09-09; about 35.
  - Conference presentations.
  - "Positioned to support" releases about government budgets.
  - Bare 6-K receipts.
  - Third-party recaps after more than 72 hours.

## Always surface (floors)
- **6-K exhibits 99.1/99.2** (interim financial statements and MD&A): rank with figures, floor 80 on the print day.
- **Earnings-date or shareholder-call notices:** fixed 75, `floor:calendar`, group_key earnings_dates. Example: "Draganfly to Host Third Quarter 2026 Shareholder Update Call", 2026-11-06.
- **Offering paperwork:** SEC form SUPPL (two were filed 2026-09-28 for the UMAC deal), F-10/F-3 shelf filings and pricing 6-Ks. Floor 70.
- **Canadian defence awards:** any Canadian Armed Forces or DND award, call-up, CanadaBuys notice, or DDI news naming Draganfly or Astiia. Floor 75, even without a company release.
- **Drone Dominance results** for Mountain Horse or Global Ordnance entries that include the Draganfly Flex: floor 70. A miss is bad news.
- **Going-concern, delisting, Nasdaq minimum-bid or cease-trade notices:** floor 85.

## Noise patterns
- **Bare EDGAR titles.** "Draganfly Inc.: 6-K filed YYYY-MM-DD" makes up 55 of the 70 DPRO rows first seen since 2026-08-20 (news-monitor-db).
  - On 2026-08-31, edgar_dpro delivered 40 rows with one crawl timestamp: 39 6-Ks dated back to 2025-10-24, plus the 2026-03-24 40-F. All were notified=1.
  - Rule: apply the event-date gate (stale, below 10). Otherwise treat a 6-K as a duplicate of its same-day release (null score, canonical = release) unless its exhibits add figures.
- **WordPress template junk.** On 2026-07-09 the old `draganfly` source seeded five 2018-19 template posts ("Hello world!", "Take the risk or lose the chance", "We rise by lifting others"). All were notified=1. The source moved to the Nasdaq JSON on 2026-09-01. Treat any of these titles as junk (null score).
- **Late re-surfacing.** The Pasagian appointment was published 2026-08-25 and first seen 2026-09-17. Score on the event date; it is a late repost.
- **Conference and promotion.** Example: "Draganfly to Present at 2026 Raymond James Aerospace, Defense & Government Services Conference", 2026-10-08. Score below 25 as promotional.
- **"Positioned to support" budget PRs.** These are claims with no order behind them; score below 30. Examples: "[uniquely positioned to support Canada's new $2 billion military commitment to Ukraine](https://draganfly.com/press-release/draganfly-uniquely-positioned-to-support-canadas-new-2-billion-military-commitment-to-ukraine-with-advanced-drone-and-tactical-capabilities/)" and the "$80 billion defence modernization package" release.
- **Humanitarian, medical or "milestone" demos with no funded scope:** score below 35.

## Catalyst calendar
- **By 2026-12-31:** the CEO said on the Q3 call that he expects announcements on at least two more opportunities before year-end.
- **Rolling, 2026-12 to 2027:**
  - DDI follow-on call-ups beyond the initial 100 systems.
  - Outcomes of the 19 Canadian RFPs.
  - Commercial heavy-lift sales enabled by the FAA 44807 exemption.
  - Repeat orders from DoW Heavy Lift and Commander 3XL customers.
- **Unknown date:** definitive Philippine JV agreements with the Razon Group.
- **Skip Dynamix earn-out milestones** (up to US$2.5M): dates not disclosed.
- **Late March 2027:** Q4/FY2026 results and 40-F.
- **About 2027-05-10:** Q1 2027 results.
- **Q2-Q3 2027:** the guided revenue inflection. A slip is a lead-level negative.
- **2027, dates TBD:** the next Drone Dominance phase. DDP plans orders for about 60,000 drones from Gauntlet II top performers, which do not include Draganfly.
- **Possible:** the CEO says Draganfly is studying acquisitions.

## Customers, programs, agencies & counterparties
- **Canadian Armed Forces / DND and the Defence Drone Initiative (DDI) Marketplace:** the primary revenue thesis. The Low-Cost Tactical ISR UAS contract (Astiia) is the key line.
- **US Department of War units:**
  - The existing Flex customer across multiple Light Infantry Divisions, now buying Heavy Lift and Commander 3XL.
  - The two DoW units that selected Flex FPV (2026-05-08).
  - DEVCOM Army Research Laboratory counter-UAS development, through F4 Defense International.
- **Drone Dominance Program (DDP; results posted by DIU):** entered through Mountain Horse Solutions. Global Ordnance is a separate defense-prime partner.
- **SRLEEA and IACLEA:** public-safety channels. Count only enrolled agencies that place orders.
- **Channel and licensing partners:** Prime Strategic Holdings (Razon Group, Philippines) and ACSL (Canadian distribution).
- **Unusual Machines (UMAC):** investor (US$5M at US$5.35, closed 2026-09-29).

## Competitors & read-through
- **Volatus Aerospace (TSXV: FLT):** also awarded a five-year Low-Cost Tactical ISR UAS contract with 100 systems in its first tranche. Its call-ups show how Canada splits DDI money. The owner flagged Volatus in old Zenith feedback as "the best proxy competitor to Draganfly in Canada".
- **Red Cat (RCAT):** the main rival for US FPV and small-ISR buys.
- **Gauntlet II leaders** (Neros, Perennial Autonomy, XTEND, ORQA US, Vector, ModalAI, Hyperscale, Skycutter, Swarm Defense): their DDP order flow is share Draganfly did not win.

Peer items are out of scope for this grader. Grade them for DPRO only when Draganfly or its product is named in the source. US government drone actions (drone rules, presidential drone actions, Defense appropriations and CRs naming a drone program, DoW drone industrial policy such as a DoW loan or production deal to a peer) are graded under "Driver lines" below (owner:2026-11-24). UMAC items count for DPRO only when they name DPRO.

## Driver lines (owner:2026-11-24)
On 2026-11-24 the owner approved these lines (Round 7 Phase 1a, the drone group). They let four kinds of US government drone news count for DPRO when the item does not name Draganfly. Draganfly is a Canadian issuer that sells Flex FPV, Heavy Lift and Commander 3XL drones to US Department of War units, has a new US defense subsidiary (Draganfly Defense USA, 2026-10-12), holds an FAA Section 44807 exemption for Heavy Lift, and moved its revenue inflection to Q2-Q3 2027 citing slow US funding. So US drone rules, presidential orders, Defense budgets and DoW production policy move its US sales. Its main thesis is Canadian (DDI), so these US items sit at the low end of each band. The pattern is GRRR.md "Policy read-through" (owner:2026-11-24), cited as the precedent and not repeated here.

Shared rules for the four blocks:
- **Overrides:** for items a block covers, and only those (core 12.1): the core 1 out-of-scope rule for policy and budgets, the core 9 read-through boundary, and the core 4.5 deduction below 70. Everything else in core applies: entity checks and traps, core 8 freshness and dedupe, and the output contract.
- **Timeliness (core 4.5):** apply 4.5 as usual, but it never takes an item scored in a Digest band of these lines (70-89) below 70: score 70, not 65. This is sheet text, not a core floor: flag no `floor:` id. Over 21 days at first sighting, core 8 applies unchanged (`stale`, or `late_first_sighting` for an official record). Bands below 70 take the full deduction. Worked-example scores are final scores, after 4.5 or core 8.
- **Copies:** the official record (Federal Register, White House, enacted text, committee release, DoW release) is canonical over news of the same action (core 8). Explainers, op-eds, law-firm alerts and re-reports are `duplicate` of the first graded copy, or under 40 when nothing was graded before. A copy that adds a fact (an effective date, a named program, a dollar figure) is an update on that fact.
- **Published text:** facts only (core 9). Never write Draganfly, DPRO, Flex, Heavy Lift, Commander 3XL or Astiia unless the item names them. Tag an official record `Program notice` and a media article `News`.
- **Other tickers:** these items come from program sources that affect several drone names. Grade DPRO by the bands here; other tickers follow their own Driver lines (GRADER.md, Counterparty items).
- **Not covered:** these lines are US only. Canadian budgets and DND items (for example the Budget 2026 Defence Drone Initiative line, 2026-11-05) keep the rules above, as do peer items such as Volatus call-ups and results.

### US drone rules
- **id:** `us_drone_rules` (new id).
- **category:** regulator.
- **what counts:** a US rule, order or formal proposal on drones or drone parts: FAA drone rules (Part 108 and similar, and rules on heavy drones over 55 lb, which reach the Heavy Lift exemption and `heavy_lift_commercial`), and the FCC Covered List and equipment-authorization rules for drones and their components (they decide which drones can be sold in the US). BIS drone export rules **do not apply to DPRO**: it is a Canadian maker, not a US exporter, and the sheet records no US export line, so add no `#DPRO` grade for them. FCC Covered List rules that reach only routers, surveillance cameras or other gear, not drones or drone parts, are `out_of_scope` 0-15 (recorded negative). If the title and excerpt do not show whether the rule reaches drones or drone parts, open the document once before scoring above 39.
- **actors:** FAA, FCC.
- **band:** final rule or order in force: Digest 75-79 (up to 85 for an FAA rule that opens commercial Heavy Lift operations). NPRM or other formal proposal, or a statement of intent by the President or a cabinet member: 70-74. Credible report of pending action (a draft rule, OIRA review), named outlet and named agency: 70.
- **overrides:** core 1, core 9 and core 4.5 below 70, as in the shared rules.
- **sources:** `drv_fedreg_drone_rules` (Federal Register, FCC, FAA and BIS), but the line applies to any source.
- **worked example:** FCC rule "Protecting Against National Security Threats to the Communications Supply Chain Through the Equipment Authorization Program" (Federal Register 2026-09-11, 91 FR 57798; in force 2026-10-13): no new equipment authorizations for drones and radios with logic-bearing components from Covered List firms. Seen within 3 days of 2026-09-11: about 75, final 75, tag `Program notice`. First seen now, the record is over 21 days old: `late_first_sighting` when no earlier copy was graded, 75 - 15 = final 60; a news copy is `stale` (under 30).

### Presidential drone and airspace actions
- **id:** `presidential_drone_actions` (new id).
- **category:** policy.
- **what counts:** an executive order, proclamation or memorandum on drones: drone production and sourcing (including US-made preferences, which may or may not cover Canadian drones), US airspace for drones, and Section 232 actions on drones and drone parts (tariffs or quotas on imported drones reach Draganfly's US sales). An order only on counter-UAS authority or airspace security **does not apply to DPRO** (its counter-UAS work is one development contract through F4 Defense, not a sales line): add no `#DPRO` grade.
- **actors:** the President; a White House fact sheet is a copy of the same action.
- **band:** signed order or proclamation: Digest 75-85 (80+ for a Section 232 action that covers drones from Canada). Statement of intent by the President or a cabinet member: 70-79. Credible report of a draft order, named outlet: 70.
- **overrides:** core 1, core 9 and core 4.5 below 70, as in the shared rules.
- **sources:** `drv_whitehouse_actions` (whitehouse.gov presidential actions), but the line applies to any source.
- **worked example:** no audit row. Precedent: the executive order "Unleashing American Drone Dominance", signed 2025-06-06, a signed order on US drone policy. Seen within 3 days it would score about 75; it is now `stale`. The Federal Register copy of a presidential document is the same event as the White House item (core 8).

### Defense appropriations and continuing resolutions naming a drone program
- **id:** `inflection_timing` (existing thesis driver: management tied the inflection slip partly to slow US funding).
- **category:** budget/program.
- **what counts:** a US Defense appropriations bill, enacted act or continuing resolution that names, funds, cuts or blocks a drone program (small-UAS, FPV or Drone Dominance procurement): enacted lines, CR anomalies, new-start blocks, a lapse. Deadline or shutdown news that names no drone program does not count (`out_of_scope`).
- **actors:** Congress (the House and Senate Appropriations Committees and their Defense subcommittees, floor votes), the President's signature, and DoW requests for CR anomalies.
- **band:** enacted line, anomaly or new-start block naming a drone program: Digest 75-79. Committee-passed bill or statement of intent by the President, a cabinet member or the Secretary of War: 70-74. Credible report of pending action (a CR or anomaly expected), named outlet: 70.
- **overrides:** core 1, core 9 and core 4.5 below 70, as in the shared rules.
- **sources:** `drv_senate_approps_def` (Senate Appropriations releases) and `drv_defense_cr_drones` (news search), but the line applies to any source.
- **worked example:** Breaking Defense, October 2026 (day not verified): the FY2027 continuing resolution blocks over 150 new-start programs, including drone lines, until Congress acts (deadline Dec 11). Seen within 3 days: about 75. It is now over 21 days old: `stale` (under 30). The next step (a new CR, a drone anomaly, a full-year bill, a lapse on Dec 11) is a new event, graded fresh.

### DoW drone industrial policy
- **id:** `dow_adoption` (existing thesis driver: US Department of War adoption of Draganfly drones).
- **category:** policy.
- **what counts:** a Department of War action or plan to build up US drone production: production talks or deals with manufacturers (for example automakers), production loans (Office of Strategic Capital), DoW equity stakes, and production-order pools. It counts even when the counterparty is a rival, because DoW capital or orders for a rival change Draganfly's share of DoW small-drone buys. A peer's private financing stays `out_of_scope`.
- **actors:** the Department of War: the Secretary of War, the Pentagon, the Army, DIU, the Drone Dominance office and the Office of Strategic Capital.
- **band:** signed deal, loan or conditional loan commitment, or equity stake: Digest 75-79. Statement of intent by the Secretary of War or another cabinet member: 70-74. Credible report of pending action (talks, a draft plan, a budget pool not yet awarded), named outlet and named agency: 70.
- **overrides:** core 1, core 9 and core 4.5 below 70, as in the shared rules.
- **sources:** `drv_drone_industrial_policy` (news search), but the line applies to any source.
- **worked example:** 2026-11-24 report (WSJ, found through Bing) that the Pentagon is in talks with GM and Ford to mass-produce military drones: credible report of talks with a named agency, 70, final 70 (4.5 stops at 70). Example headline: "Pentagon in talks with GM and Ford to mass-produce military drones".

## Source coverage gaps
- **Nasdaq press feed `draganfly`:** it runs with `config.maxItems:1` per poll (covered lane, 8-minute cadence under `priority.js`), so two releases between polls can drop one.
  - Backstop: the company newsroom (https://draganfly.com/news/, paginated /news/page/N/).
  - Before 2026-09-01 the source returned only template posts, so releases from 2026-07-09 to 2026-08-31 never reached the feed. These include the SRLEEA release of 2026-07-27, the call notice of 2026-08-07 and the Q2 results.
- **edgar_dpro form coverage:** it stores 6-K titles only. The two SUPPL filings of 2026-09-28 do not appear in items. Ingest SUPPL, F-10 and 40-F from `https://data.sec.gov/submissions/CIK0001786286.json`, and open 6-K exhibit 99.x to pull figures instead of storing the form title.
- **Canadian government awards:** CanadaBuys award and contract-history notices (https://canadabuys.canada.ca, search "Draganfly") and DND releases on canada.ca. These may name Astiia without Draganfly.
- **SEDAR+ and SEDI:** SEDAR+ carries material change reports and the MD&A. Insider trades are on SEDI (https://www.sedi.ca), not Form 4. None of these are in edgar_dpro.
- **Drone Dominance results:** the program leaderboard at dronedominance.mil (per SSD). The Gauntlet II miss (2026-09-18/25) never reached the feed.
- **US awards:** SAM.gov and USAspending entries for "Draganfly Innovations USA" and "Draganfly Defense USA".

## Grader notes
- **Currency:** results are in C$ (the release omits the symbol), while financings are in US$. Aggregators diverge: EarningsWhispers showed Q3 revenue as $1.46M against the company's C$2.05M. Always label the currency.
- **Release/6-K duplication:** every release has a same-day 6-K mirror. Make the release canonical. The 6-K counts only when it is the financials (99.1/99.2) or offering paperwork.
- **Wording inflation:** the company says "selected", "exclusive", "strategic" and "milestone" for frameworks and MOUs. Write the stage literally ("framework", "selected", "qualified").
  - "Up to 5,000" is an option ceiling with 100 firm units, in a program where Volatus also won.
  - The "defense sales" release of 2026-10-27 gave no values or units.
- **Promotional and related-party framing:** "positioned to support" releases are claims, not news. The UMAC deal is a covered-to-covered strategic deal; score it for both covered names.
- **Small base:** a single six-figure order is meaningful and C$0.8M or more is lead. Do not discount for missing values when units or a new agency are named.
- **Stale facts to correct in old profiles:**
  - Draganfly Defense USA is now a subsidiary, not a division.
  - The Gauntlet II outcome is a miss.
  - Q2's C$2.66M was the best quarter; Q3 was C$2.05M.
  - The DDI contract is not exclusive to Draganfly.
