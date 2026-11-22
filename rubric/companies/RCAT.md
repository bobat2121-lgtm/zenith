---
ticker: RCAT
name: Red Cat Holdings, Inc.
as_of: 2026-11-18
asset_class: operating
filer: domestic (10-K / 10-Q / 8-K); CIK 0000748268; FY ends Dec 31
base_usd: 47100000            # B: latest quarter x4 (Q3 2026 $11.769M x4), the core 4.2.1 order (no guidance midpoint since 2026-11-16)
base_basis: "Q3 2026 revenue x4; Q3 release 2026-11-16"
base_date: 2026-11-16
alt_base_usd: 73600000        # LTM: Q4'25 $26.2M + 9M'26 $47.4M
alt_base_flag: needs_owner    # LTM fits lumpy government revenue better. The core basis order picks Q x4. The owner decides; until then use base_usd.
tiny_usd: 471000              # 1% of B (B < $100M)
lead_usd: 4710000             # 10% of B
small_base: false             # B >= $25M
shares_outstanding: 152960000 # 10-Q cover, 2026-11-12
cash_usd: 242700000           # 2026-09-30
market_cap_usd: null          # compute as shares_outstanding x the last close on the event date; never assume a price
fx_as_of: 2026-11-18
eur_usd: 1.0968               # ECB reference rate 2026-11-18
terms: ["Red Cat Holdings", "Red Cat Aerial", "Teal Drones", "Teal 2", "Black Widow", "Hellcat", "TRICHON", "FANG FPV", "Edge 130", "FlightWave", "Blue Ops", "B-Series", "B-18", "B-26", "B-39", "Variant 7", "Variant 5", "Apium Swarm Robotics", "Quaze Technologies", "SMOT Acquisition GmbH"]
aliases: ["$RCAT", "Red Cat"]
traps:
  - {term: "RCAT", case: sensitive, rule: "ticker or cashtag only"}
  - {term: "Red Cat", case: insensitive, rule: "reject Redcat Racing and pet/animal stories"}
  - {term: "Black Widow", case: insensitive, rule: "needs drone/sUAS/Teal/Red Cat context; reject the spider, Marvel, P-61, Dodge and the pistol"}
  - {term: "Hellcat", case: insensitive, rule: "needs drone/Red Cat context; reject F6F, Dodge and the pistol"}
  - {term: "Teal", case: insensitive, rule: "never alone; only 'Teal Drones' or 'Teal 2'"}
  - {term: "FANG", case: sensitive, rule: "only with FPV/Red Cat context; FANG is also a stock ticker and market acronym"}
  - {term: "Apium", case: insensitive, rule: "needs swarm context"}
  - {term: "Variant 7|B-18|B-26|B-39", case: insensitive, rule: "needs Blue Ops/USV context"}
  - {term: "Steyr", case: insensitive, rule: "only Steyr Motors AG in a Red Cat/offer context; reject Steyr Arms, Steyr Mannlicher, CNH Steyr tractors and the town"}
  - {term: "Skycutter|Rotor Riot|Fat Shark|C3A|OBERON|Skydio|HavocAI|Unusual Machines", case: insensitive, rule: "not RCAT entities; match only when Red Cat or one of its products is named in the same item"}
thesis_drivers: [order_conversion, srr, margin_cash, steyr, intl, blue_ops, drone_dominance]
open_items:
  - {id: steyr_acceptance, what: "Steyr acceptance-period result, extension, or waiver/lowering of the 50%+1 minimum", expires_at: 2026-12-18, note: "move expires_at if the bidder extends (up to 16 weeks per the BCA 8-K)"}
  - {id: steyr_financing, what: "Disclosed financing source for the ~EUR 204.8M offer", expires_at: 2027-06-30}
  - {id: steyr_fdi, what: "FDI clearances in Austria, Australia, Italy and the UK (offer condition)", expires_at: 2027-06-30}
  - {id: fy27_guidance, what: "Guidance reinstated after the 2026-11-16 withdrawal (expected at the Q4/FY2026 print)", expires_at: 2027-03-31}
  - {id: ukraine_first_order, what: "First Ukraine MoD/STE order naming Red Cat, Teal, Black Widow or Hellcat", expires_at: 2027-03-30, note: "MOU anniversary; date set by sheet author, needs_owner"}
  - {id: platoon_srr, what: "Army platoon-level SRR decision naming Teal/Black Widow, either way", expires_at: 2027-06-30, note: "no official date; set by sheet author, needs_owner"}
groups: [earnings_calendar, rcat_steyr]   # rcat_steyr uses the proposed core custom pattern <ticker>_<slug>
owner_marks: []               # no line in this sheet carries an owner:<date> mark
---

# RCAT — Red Cat Holdings, Inc.
_Researched 2026-11-18. Nasdaq: RCAT. CIK 0000748268. Nevada corporation, head office 2800 S West Temple, South Salt Lake, UT. Fiscal year ends Dec 31. Q3 2026 was reported 2026-11-16 ([release](https://ir.redcatholdings.com/news-events/press-releases/detail/249/red-cat-reports-q3-2026-revenue-growth-of-22-yy-ytd-q3-2026-revenue-growth-of-227-yy-announced-public-purchase-to-acquire-steyr-motors-ag-and-advancement-to-dow-swarm-forge-crucible-4); [10-Q](https://www.sec.gov/Archives/edgar/data/748268/000162828026074175/rcat-20260930.htm)). Next print: Q4/FY2026, around mid-March 2027 (last FY release 2026-03-18, 10-K 2026-03-19). A preliminary-revenue 8-K Item 2.02 is possible in mid-January (precedent 2026-01-13). Bands, floors and modifiers come from core v3.0. This sheet adds only RCAT facts, thesis lifts and examples._

## Identity & matching
- **Legal entities:**
  - Red Cat Holdings, Inc.
  - Teal Drones, Inc.
  - FW Acquisition, Inc. (FlightWave Aerospace Systems)
  - Blue Ops, Inc.
  - Apium Swarm Robotics (closed 2026-03-30)
  - Quaze Technologies (closed 2026-05-20)
  - **SMOT Acquisition GmbH** (Vienna), the wholly owned bidder for Steyr Motors AG.
- **Brands and products:**
  - **Red Cat Aerial**, the unified UAS brand since 2026-10-12.
  - Black Widow (Army SRR drone); Hellcat (export configuration, launched 2026-06-15); Teal 2 (legacy).
  - Edge 130 / Edge 130 Blue; **TRICHON** VTOL ISR; FANG FPV (Blue UAS Cleared List 2025-10-30).
  - Blue Ops Variant 7 / Variant 5 and the **B-Series USVs**: B-18 and B-39 (introduced 2026-10-22) and B-26.
- **Context guards and collisions:** see `traps` in the front matter. They are applied before scoring. A wrong entity scores 0-5 with `reason:off_entity`.
- **Third-party names are not RCAT products.** C3A (tactical fires integrator) and OBERON (the fires network Black Widow was integrated into, 2026-07-23) match only when Red Cat or Black Widow is named.
- **Matching terms in coverage.js.** The thesis terms "unusual machines", "skydio" and "havocai" are co-mention hints, not RCAT entities.
- **Cross-sheet collisions** (check against the core §1 shared table):
  - Rotor Riot and Fat Shark belong to UMAC (sold by Red Cat in 2024).
  - A UMAC item that names Red Cat as a counterparty is direct involvement for both names (`also:RCAT`, covered-to-covered `floor:covered_pair`).
  - A UMAC item that only mentions Jeff Thompson as a UMAC director is not an RCAT item.

## What the stock trades on
1. **`order_conversion`: orders turning into revenue after the guidance withdrawal.**
   - On 2026-11-16 Red Cat withdrew its FY2026 $150-180M revenue target. It cited slower funding and contract awards, and the Drone Dominance Gauntlet II outcome.
   - Q3 revenue was $11.8M, down about 42% from Q2's $20.2M.
   - Any new order, award, funding release or guidance reinstatement resets estimates.
2. **`srr`:** the next Army SRR or platoon-level SRR decision, and Black Widow production lots.
3. **`margin_cash`: gross margin and cash burn.**
   - Q3 gross profit was $65K (0.6%) and the Q3 operating loss was $43.4M.
   - Cash was $242.7M at 9/30, down $82.9M from $325.6M at 6/30.
   - Net inventory was $117.2M (release highlights), or $127.3M including prepaid inventory (balance sheet). It was $23.5M at 2025 year-end.
4. **`steyr`: the Steyr Motors tender.**
   - Terms: EUR 39.00/share in cash for all 5,251,261 shares, about EUR 204.8M, or ≈ $224.6M at ECB 1.0968 (2026-11-18).
   - That is about 93% of 9/30 cash and about 4.8x B.
   - The BCA 8-K discloses no financing source, which creates financing and dilution risk.
   - Steyr's management and supervisory boards recommended acceptance on 2026-11-02 (Steyr IR).
5. **`intl`: international channels.**
   - Japan ATLA/JGSDF (via HAMA K.K.).
   - The NATO ally via NSPA.
   - The Asia-Pacific ally.
   - Ukraine (Spetstechnoexport MOU). No Ukraine order has been disclosed as of 2026-11-18.
6. **`blue_ops`: Blue Ops paid orders.** The first U.S. Government purchase order for B-26 boats was disclosed in the Q3 release, with no value or quantity.
7. **`drone_dominance`: DoW Drone Dominance rounds.** Teal missed the Gauntlet I top 11 and the Gauntlet II leaderboard, and the company tied the guidance withdrawal partly to Gauntlet II.

## Materiality bases
- **B = $47.1M**: Q3 2026 revenue $11.769M x4, per the core 4.2.1 basis order. No guidance midpoint has existed since 2026-11-16.
  - **Tiny:** below $0.47M (1%, because B < $100M).
  - **Lead:** $4.7M or more (10%).
  - Lead overrides follow core 4.2.1: a first production-scale order of a product; a first order from a new U.S. military service, federal agency or foreign government.
- **Alternative base, `needs_owner`:** LTM $73.6M = Q4'25 $26.2M ([FY2025 release](https://ir.redcatholdings.com/sec-filings/all-sec-filings/content/0001628280-26-019403/ex-991xrcatx20260318.htm)) + 9M'26 $47.4M. That gives tiny $0.74M and lead $7.4M.
  - Use it only after the owner approves it.
  - Note it in `why` when it would change the band (orders of $4.7-7.4M).
  - The old $165M guidance-midpoint base is retired.
- **Test value:** total contract value, or obligated value when stated. Note the annual run rate separately.
- **Backlog:** not disclosed. Contract liabilities and deposits were $399K at 9/30/2026.
- **Capital:** d = new shares ÷ 152.96M basic shares outstanding (core 4.2.2), never judged against the $242.7M cash.
  - Thresholds: 5% = 7.65M shares; 10% = 15.3M; 20% = 30.6M.
  - Red Cat has an automatic shelf (S-3ASR filed 2026-05-12), so a takedown can arrive with no prior S-3.
  - Precedent: the [2026-05-12 offering](https://ir.redcatholdings.com/news-events/press-releases/detail/224) of 23.9M shares at $9.40, about $225M gross, d ≈ 18%.
- **Currency:** give Steyr figures in EUR with USD at the event-date ECB rate.

## Event ladder for this name
Bands and rung ranges are core §2-§4. Scores below are for these RCAT examples. Thesis lifts are core 4.4, using the ids in front matter.

**Lead (90-100)**
- **Q3 2026 results with the FY2026 target withdrawn** (2026-11-16): ≈95. `results`, `floor:results` and `floor:guidance`. The card leads with the withdrawal.
- **Any binding order, award or production lot of $4.7M or more** (p ≥ 10): `floor:lead_order`.
  - This includes an Army SRR or platoon-SRR lot naming Teal or Black Widow (`srr`).
  - Historical example: [Army picks Teal for SRR Tranche 2](https://breakingdefense.com/2024/11/army-picks-red-cats-small-quadcopter-for-2nd-short-range-reconnaissance-tranche/), 2024-11.
- **First order from a new foreign government with V ≥ $0.47M**, such as a first Ukraine MoD/STE order (lead override; `intl`). It also resolves `ukraine_first_order`.
- **Raise or convertible with d ≥ 20%:** 85-95 by 4.2.2, +5 for a ≥15% discount. A raise disclosed as funding Steyr resolves `steyr_financing` (floor 80) and takes the `steyr` thesis lift. A raise sized at the full ~$225M price at a single-digit share price would exceed d 20%.
- **Abrupt CEO or CFO exit:** `people` 70-88, +5-10 for abrupt (core). It can reach 90+.

**Digest (70-89)**
- **Steyr tender steps: 80-88.** `deal` rung (Red Cat is the acquirer), `steyr` thesis lift, `group:rcat_steyr`.
  - Core caps signed or closed `deal` at 88. Flag `needs_owner` with the proposal that steps of ≈4.8x B and ≈93% of cash rank 90+ once core adds a deal-magnitude lift.
  - Bad news ranks the same as good: tender failure, lapse, minimum not met, or an FDI block.
  - 80-88 steps:
    - [Offer announced, 2026-10-19](https://ir.redcatholdings.com/news-events/press-releases/detail/244/red-cat-announces-proposed-voluntary-public-purchase-offer-for-steyr-motors).
    - BCA signed 2026-10-21.
    - Acceptance result, extension, or waiver of the minimum (each resolves `steyr_acceptance`, floor 80).
    - Closing, or failure.
  - 70-80 steps: target-board reasoned statement (2026-11-02), and a single-jurisdiction FDI clearance (`steyr_fdi`; the last clearance resolves it).
  - The [BCA 8-K Items 1.01/8.01](https://www.sec.gov/Archives/edgar/data/748268/000149315226048228/form8-k.htm) was filed 2026-10-23, after the release. It is an update on the increment only (45-70): acceptance period to 2026-12-18, up to 16 weeks' extension, waivable conditions, and no Steyr capital issuance during the offer.
- **[Air Force Security Forces Center $2.49M Black Widow order](https://ir.redcatholdings.com/news-events/press-releases/detail/235/red-cat-receives-2-49-million-u-s-air-force-order-for-black-widow-systems)** (2026-07-30): p = 5.3 → 80-84. It is an assessment buy as a possible successor to the Teal 2 fleet; say "assessment order".
- **Named sovereign orders with no value**, scored 78-85: binding with a named counterparty 70-78, plus first-country novelty +5-10, plus the `intl` lift.
  - Examples:
    - [NATO ally via NSPA](https://ir.redcatholdings.com/news-events/press-releases/detail/217/red-cat-secures-new-orders-for-black-widow-drones-from-nato-ally) (2026-04-02).
    - Asia-Pacific ally (2026-02-02, detail/210).
    - [Japan ATLA/JGSDF via HAMA K.K., corrected 2026-05-21](https://ir.redcatholdings.com/news-events/press-releases/detail/227).
  - A missing value is never a discount.
  - The lead override needs a disclosed V ≥ $0.47M.
- **Program results either way: 75-85.** `permission` rung, `drone_dominance` lift. Owner on Drone Dominance: "a miss is bad news, not noise."
  - Example: [Teal misses the Gauntlet II leaderboard](https://defensescoop.com/2026/09/18/drone-dominance-program-gauntlet-2-results/) (2026-09-18).
  - An SRR downselect or readiness selection naming Teal is `floor:selection` 75 (core anchor: Teal SRR readiness selection 84).
- **Apium advances to Swarm Forge Crucible 4** on Anduril's team (2026-11-16): 72-78. It is a selection (one of four teams; work begins January 2027), never a contract. Standalone it is a separate item; inside the Q3 release it is part of the results card.
- **First U.S. Government B-26 purchase order** (in the Q3 release): standalone it scores 75-80 (binding, no value, first order for the product, `blue_ops`). Inside the Q3 release it is part of the results card.
- **Named-officer change:** CRO Geoffrey Hitchcock terminated for cause, plus his lawsuit ([8-K Items 5.02/8.01](https://www.sec.gov/Archives/edgar/data/748268/000149315226034190/form8-k.htm), filed 2026-07-22): 70-78 (other NEO, `floor:neo`). If first seen 40 days late in the 2026-08-31 burst: -15, cap 79, `late_first_sighting`.
- **Earnings-date notices:** fixed 75, `group:earnings_calendar`. Example: [Q3 date, 2026-10-26](https://ir.redcatholdings.com/news-events/press-releases/detail/247/red-cat-announces-third-quarter-2026-earnings-release-date-and-participation-in-upcoming-investor-conferences). Bundled conference participation adds nothing.
- **Capital:** a priced raise with d 5-10% scores 70-80; d 10-20% scores 78-88 (`floor:capital_big`).
- **Quantified MOU or partnership** (named major counterparty plus units, value, term or territory): 60-85 by the core scope rule.

**Borderline (40-69)**
- **Flagship product launches:**
  - [Red Cat Aerial / TRICHON at AUSA](https://ir.redcatholdings.com/news-events/press-releases/detail/243/red-cat-launches-red-cat-aerial-unifying-its-uas-portfolio-under-one-brand-and-unveils-trichon-long-endurance-vtol-isr-system-at-ausa-2026) (2026-10-12): 62 (core anchor).
  - [B-Series B-18/B-39, production-ready](https://ir.redcatholdings.com/news-events/press-releases/detail/245/blue-ops-introduces-b-series-maritime-portfolio-with-production-ready-b-18-and-b-39-uncrewed-surface-vessels) (2026-10-22): ≈60.
  - +5-10 when a named customer or contract is attached.
- **Partnerships with a named defense counterparty and concrete integration or co-development but no volume:** 55-65 by the core scope rule; the old 45-55 is retired.
  - [Havoc co-development of autonomous maritime systems](https://ir.redcatholdings.com/news-events/press-releases/detail/240/blue-ops-a-red-cat-company-and-havoc-partner-to-develop-open-architecture-autonomous-maritime-defense-systems) (2026-08-17): ≈60.
  - C3A / OBERON Black Widow integration (2026-07-23, detail/232): ≈58.
  - [Sine Engineering comms/navigation integration](https://ir.redcatholdings.com/news-events/press-releases/detail/248/red-cat-announces-strategic-partnership-with-sine-engineering-to-strengthen-resilient-communications-and-navigation-across-air-and-maritime-systems) (2026-11-02): ≈55.
- **Divisional leadership:** [Mitch McDonald named divisional CEO of UAS](https://ir.redcatholdings.com/news-events/press-releases/detail/239/red-cat-promotes-mitch-mcdonald-to-divisional-ceo-of-its-uas-operations) (2026-08-12): ≈45. He is not a holding-company executive officer.
- **Litigation steps with incremental change:** 30-55. Example: removal of Hitchcock's suit to federal court (Q3 10-Q).
- **Shelves and rivals:** an S-3/S-3ASR with no takedown scores 40-55. A rival award at the Army SRR key account scores 50-69 (core §9.4).

**Reject (below 40)**
- **Ceremonies and sponsorships:**
  - [Blue Ops Day](https://ir.redcatholdings.com/news-events/press-releases/detail/241/red-cat-celebrates-inaugural-blue-ops-day-in-georgia-marking-a-year-of-growth-in-u-s-maritime-manufacturing) (2026-09-24): ≈15.
  - Washington Commanders partnership (2026-08-10, detail/238): ≈10.
  - Conference participation: 0-20.
- **University or test-range partnerships:** [FAU Harbor Branch](https://ir.redcatholdings.com/news-events/press-releases/detail/242/red-cats-blue-ops-expands-maritime-defense-operations-through-strategic-partnership-with-florida-atlantic-university) (2026-10-01): ≈32. This is generic, not adoption.
- **"Futures Initiative" sign-ups:** 25-39 unless they carry volume or value. Examples: Allen Control Systems 2026-03-02, Arastelle 2026-04-07, Kymeta 2026-05-14.
- **Insider filings:** Form 4 codes A/M/F/G/J score 0-10; Form 144 below 20 (core §5).
- **Late recaps and receipts:**
  - Results recaps more than 24h after the print, and guidance retellings more than 72h after (core §7, `late_repost`).
  - Bare filing receipts that add nothing.

## Always surface (floors)
These map RCAT identifiers to core §6 floor ids. Values are core values, not sheet overrides.
- **8-K Item 2.02 plus the same-day release, or a preliminary-revenue 8-K:** `floor:results` 80. The guidance withdrawal or a reinstatement is `floor:guidance` 80, and a reinstatement resolves `fy27_guidance`.
- **Steyr 8-K 1.01/2.01/8.01, Red Cat Steyr releases, and Steyr Motors Art. 17 MAR ad-hoc notices on the offer:** `floor:deal_signed` 75. The `steyr` lift puts them at 80-88. An item that resolves `steyr_acceptance`, `steyr_financing` or `steyr_fdi` gets `floor:open_item` 80.
- **8-K 5.02:**
  - CEO or CFO: `floor:neo_ceo_cfo` 75.
  - COO, President or another NEO: `floor:neo` 70.
- **424B5 or prospectus supplement starting or upsizing a raise:** scored by core 4.2.2, with `floor:capital_big` 75 at d ≥ 10% (≥ 15.3M shares) or a ≥15% discount. The 2025-09-17/18 and 2026-05-12/14 424B5s were raises. A bare S-3ASR is a shelf (40-55).
- **Army SRR, PEO Aviation or PM UAS documents naming Teal or Black Widow:**
  - Selection or downselect: `floor:selection` 75.
  - Solicitation or J&A naming Red Cat or Teal: `floor:order` 70.
  - Award: scored by 4.2.1.
  - Platoon-SRR decisions resolve `platoon_srr`.
- **Drone Dominance or Gauntlet results that list Teal, or a results list for a round Teal entered that omits it:** 75-85 (`drone_dominance` lift, owner-cited in core 4.4).
- **Japan ATLA/JGSDF, NSPA, Ukraine MoD/STE or Air Force Security Forces buys naming Black Widow or Hellcat:** `floor:order` 70 when V ≥ $0.47M or is not stated. The `intl` lift puts them at 78-85. The lead override applies per core.
- **Loss, cancellation or sustained protest on Army SRR or AFSFC:** `floor:key_loss` 70.

## Noise patterns
These were seen in `redcat` and `edgar_rcat` in news-monitor-db, and every row was notified=1. Core §8 gates apply.
- **EDGAR archive burst, 2026-08-31.**
  - 40 `edgar_rcat` rows were first seen together at 21:21, with filing dates from 2025-04-11 to 2026-08-06 (S-3/A, PRE 14A, DEF 14A, 424B5, old 10-Qs).
  - Gate each row on its own date: more than 21 days old scores 0-9, with `reason:stale`, `archive_burst` and `source_repair`.
  - The 2026-07-22 CRO 8-K arrived in the burst 40 days late. Grade it only if no prior coverage exists, as `late_first_sighting`, with the original date in `why`.
- **Press-release burst, 2026-07-09.** 10 `redcat` rows were first seen at 18:30, with dates from 2026-04-16 to 2026-07-02. This meets the core archive-burst test (≥5 rows, span >30 days). Gate each row on its own date.
- **Bare EDGAR titles** (for example "Red Cat Holdings, Inc.: 8-K filed 2026-11-16" or "10-Q filed 2026-11-16"): `dup_of` the same-day release.
  - A 10-Q is an update (60-85) only when it adds facts the release lacks. Examples: Customer A at 38% of 9M 2026 revenue, inventory reserves, the share count.
- **Promotional or ceremonial releases:** Blue Ops Day, FAU, Washington Commanders, and conference participation bundled into earnings-date releases score below 25. The date part of a bundled release goes to `earnings_calendar` at 75.
- **Partnership flow:** releases such as Sine, FAU, Havoc and Futures Initiative arrive about every two to four weeks. Grade each by the core scope rule: generic 25-39; named counterparty with concrete integration 55-65; quantified 60-85.

## Catalyst calendar
- **2026-12-18, 17:00 CET:** the Steyr acceptance period ends (`steyr_acceptance`).
  - Per the BCA 8-K, the bidder may extend it by up to 16 weeks.
  - The bidder may also waive any offer condition, including the 50%+1 minimum.
  - Other conditions: no Steyr capital issuance during the offer, and no insolvency ad-hoc.
- **By 2027-06-30:** FDI approvals are due in Austria, Australia, Italy and the UK (`steyr_fdi`). Closing is expected in H1 2027.
- **January 2027:**
  - Apium Swarm Forge Crucible 4 work begins.
  - A preliminary FY2026 revenue 8-K is possible (precedent 2026-01-13).
- **About mid-March 2027:** Q4/FY2026 results and the 10-K. Watch for FY2027 guidance (`fy27_guidance`), inventory reserves and backlog.
- **Timing unknown:**
  - Army platoon-level SRR decision (`platoon_srr`) and the next SRR production lot.
  - Further Drone Dominance rounds (Gauntlet III about March 2027).
  - FY2027 appropriations and NDAA small-UAS lines. A budget line counts only when it names Red Cat, Teal, Black Widow or the SRR program; otherwise it is out of scope.
- **Ongoing:**
  - Hitchcock suit: filed 2026-07-21 in New York state court; Red Cat moved to remove it to federal court.
  - Ukraine/STE order (`ukraine_first_order`): none disclosed.
  - Proxy around late April (DEF 14A filed 2026-04-30) and annual meeting around June (8-K 5.07 filed 2026-06-25). A routine AGM scores 10-25.

## Customers, programs, agencies & counterparties
- **U.S. Army SRR (PM UAS):** key account, `big`, disclosure `filing_only` for concentration.
  - The Q3 10-Q shows "Customer A" at 38% of 9M 2026 revenue (45% of 9M 2025).
  - Red Cat attributed Q3 growth to Air Force and other deliveries.
- **DoW Drone Dominance:** a sheet program Teal entered.
  - Missed the [Gauntlet I top 11](https://defensescoop.com/2026/03/09/dod-drone-dominance-program-gauntlet-i-results/) (2026-03-09).
  - Advanced through the Phase 2 qualifier to Gauntlet II (2026-07-02, one of 19 invitees).
  - Missed the Gauntlet II leaderboard (2026-09-18).
- **DIU / Swarm Forge:** release disclosure; Anduril is Apium's team lead.
- **Japan MoD/ATLA (JGSDF):** release disclosure, with partner HAMA K.K. Delivery falls in JFY26.
- **NSPA NATO ally** (2026-04-02) and **Asia-Pacific ally** (2026-02-02): release disclosure. Both are unnamed; a named country is new information.
- **Ukraine MoD / Spetstechnoexport (STE):** a strategic partnership MOU announced 2026-03-30, with no order or value.
- **U.S. Air Force Security Forces Center:** release disclosure, key account. It is assessing Black Widow as the successor to its Teal 2 fleet.
- **U.S. Government (agency unnamed):** the first B-26 purchase order.
- **Steyr Motors AG:** the target. **B&C Holding Österreich** holds about 780,000 shares (about 15%) under an irrevocable undertaking. Steyr's CEO Julian Cassutti has said he intends to tender. Steyr revised its own FY2026 guidance and withdrew its 2027 outlook on 2026-08-17; that is Steyr news, not RCAT news, unless it changes the offer.

## Competitors & read-through
Core §9 applies. These are the only RCAT read-through paths:
- **A rival award at a sheet key account in the category** (Army SRR or platoon-level SRR, AFSFC Teal 2 successor): 50-69 as a possible loss.
  - Examples: Skydio X10D orders by the Army under SRR; Parrot or Skycutter platoon-SRR awards.
  - A confirmed replacement of Teal or Black Widow is `money` bad news at 70+.
- **A government results list or award list for a program Teal entered** (Drone Dominance rounds, SRR) is graded when it names Teal, or when it is the results list for a round Teal competed in.
- **Out of scope (0-15):** rival-only follow-on orders, peer financings, and Gauntlet leaders' wins that do not name Teal or allocate an SRR or Drone Dominance round Teal entered. The leaders were Skycutter, Neros, ORQA, XTEND, Vector, ModalAI and Perennial Autonomy.
- **Unusual Machines (UMAC)** is a covered related-party supplier; Red Cat's CEO Jeff Thompson sits on UMAC's board. A transaction between the two is covered-to-covered (`floor:covered_pair`, `also:` each ticker). A UMAC item that does not name Red Cat as a party is not RCAT news.

Published text (`why`, `note_hook`) names Red Cat only when the source does, and states facts without implications.

## Source coverage gaps
Collector and ops notes (feeds to add, API filters) moved to `sources/RCAT.md` for the worker. Grader-relevant facts only:
- **Steyr ad-hoc notices (EQS, ir.steyr-motors.com)** can arrive before or alongside Red Cat's release. They are the same event: the Red Cat release is canonical when both are in the window, otherwise the first official record. Score them on their Art. 17 date.
- **Army and DoW program outcomes** (SRR, Drone Dominance) do not arrive through `redcat` or `edgar_rcat`; the Gauntlet II miss never appeared. A first sighting in press is dated to the DoW or Army announcement. More than 21 days late follows the core late-first-sighting exception.
- **Form 4/144 filings are not ingested.** Silence is never `insufficient_evidence`. A Form 4 that does arrive is graded on codes P/S only.
- **`edgar_rcat` rows are bare form titles:** open the filing and exhibits before scoring above 39.

## Grader notes
- **The Q3 headline is spin.** "Revenue Growth of 22% Y/Y" sits on top of four facts:
  - the withdrawn FY target
  - a 42% q/q revenue drop
  - 0.6% gross margin
  - an $82.9M cash decline

  The card leads with the guidance withdrawal. classify.js tagged this release ACQUISITION; ignore that tag.
- **Steyr is live.** The 2026-07-28 preliminary non-binding proposal was withdrawn; a new, board-supported offer launched 2026-10-19 and the BCA was signed 2026-10-21. Write "tender offer", "acceptance period" and "pending FDI clearance" literally. Do not call it closed or "acquired" before closing.
- **Steyr score ceiling.** Steyr steps are capped at 88 by the core `deal` range. Flag `needs_owner` on any step you would place higher. A financing scores separately under 4.2.2.
- **No-value orders.** Many orders come with no value or quantity (NSPA ally, Asia-Pacific ally, Japan, B-26 PO). Never discount for a missing value and never estimate one. Score on counterparty novelty.
- **Currency:** give EUR and USD at the event-date ECB rate. On 2026-11-18, 1.0968 gives EUR 204.8M ≈ $224.6M.
- **Unit counting:** an SRR or Black Widow "system" means two aircraft plus a ground control station.
- **Selection is not award.** Write "advanced to Gauntlet II", "selected for assessment" and "advanced to Crucible 4" literally, never as "contract".
- **Recycled boilerplate.** Releases carry forward-looking boilerplate; Quaze appears in the Q3 release only there. A subsidiary named only in boilerplate is not news.
- **Japan correction.** The 2026-05-21 correction replaced the headline, the first six paragraphs and the forward-looking statements of the 2026-04-30 Japan release. The original "173 systems" is not in the corrected text. Use the corrected facts and give no unit count.
- **Inventory is ambiguous:** $117.2M net (highlights) vs $127.3M including prepaid (balance sheet). Cite which one you use.
- **Base choice.** Use B $47.1M (Q x4). When an order falls between $4.7M and $7.4M, note in `why` that the LTM alternative would put it in Digest, and flag `needs_owner`.
- **Do not carry forward from the old profile:**
  - the $165M guidance-midpoint base
  - "Ukraine news promised early September"
  - Steyr "withdrawn"
  - "173 Japan systems"
  - "C3A/OBERON is Blue Ops C2"
  - the old sheet-local Lead/floor restatements (Steyr Lead, S-3ASR 75+, earnings dates 70-75, partnerships 45-55)
- **Verification:** facts were checked on 2026-11-18 against the Q3 release, the BCA 8-K, the Steyr IR ad-hoc page and the ECB daily reference rate. The web-search budget was exhausted, so the 2026-11-02 Steyr board recommendation is from the Steyr IR "Latest news" headline only (its body was not read), and no item after 2026-11-16 could be searched for.
