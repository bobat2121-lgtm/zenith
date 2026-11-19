# PUSA — Powerus Corporation (formerly Aureus Greenway Holdings Inc.)

```yaml
ticker: PUSA
as_of: 2026-11-18            # base re-checked against EX-99.1/99.2 of the 2026-11-16 8-K
asset_class: operating
filer: domestic 10-K/10-Q/8-K; CIK 0002009312; non-accelerated, SRC, EGC; FY ends Dec 31
status_events:
  - {date: 2026-10-01, event: "AGH-Legacy Powerus merger closed; AGH renamed Powerus; reverse acquisition (Legacy Powerus is accounting acquirer)"}
base_usd: 17.79e6            # B
base_basis: "pro forma combined revenue 9M 2026 $13,344,647 x 12/9 (EX-99.2, 2026-11-16). No guidance; no standalone quarter disclosed; FY2025 pro forma $5.49M is pre-ramp"
alt_base: {value_usd: 130e6, basis: "company-reported contracted revenue expected next 12 months (8-K 7.01, 2026-11-05); not GAAP revenue or backlog", use: "context only; not used for p unless owner marks it", flag: needs_owner}
small_base: true             # B < $25M -> core 4.2.1 small-base rule applies
tiny_usd: 0.18e6             # 1% of B
lead_usd: 1.78e6             # 10% of B
fx_as_of: n/a                # base in USD; convert non-USD orders (Pakistan, Middle East, ANZ) at the event-date rate per core 4.2.1
shares_outstanding: 170838681   # 10-Q cover, 2026-11-11
market_cap_usd: 223.8e6      # $1.31 close 2026-11-18 x 170.84M
warrants_outstanding: {common_a: 26.6e6 @ $1.00, common_b: 29.9e6 @ $1.25, total_pct_of_shares: 33.1}
terms: ["Powerus", "Power.us", "Powerus Corporation", "Powerus Defense", "Autonomous Power Corporation", "Tandem Defense", "Kaizen Aerospace", "Guardian-1", "Guardian-2", "Guardian-3", "MatrixFold", "Matrix-T"]
aliases_pre_merger: ["Aureus Greenway Holdings", "AGH"]   # only for items dated before 2026-10-01
match_traps:
  - {term: "PowerUs", case: insensitive, rule: "needs drone, defense or Nasdaq context; recruiting and energy firms share the name"}
  - {term: "Aureus", case: insensitive, rule: "never bare; gold miners"}
  - {term: "Tandem", case: sensitive, rule: "only 'Tandem Defense'; never bare (Tandem Diabetes)"}
  - {term: "Guardian|Matrix|Dragon|Kaizen|Harvest", case: insensitive, rule: "never bare"}
  - {term: "$PUSA token", case: insensitive, rule: "off_entity; Solana depositary-receipt token issued by Trek Nexus Markets Ltd (BVI), not by Powerus"}
  - {term: "Brett Velicovich", case: insensitive, rule: "'drone expert' media hits are not company news"}
collisions:
  - {term: "Leah Lunger", sheets: [PUSA, RCAT], rule: "PUSA CAO from 2026-11-16; RCAT CFO 2024-25. Her PUSA appointment is a PUSA item only, not an RCAT item"}
  - {term: "Unusual Machines / UMAC", sheets: [PUSA, UMAC], rule: "investor (10.24M shares post-merger, related party) and supplier; dealings are covered_pair for both names"}
  - {term: "Teal / Red Cat", sheets: [PUSA, RCAT], rule: "peer only; a co-mention is not news for PUSA"}
thesis_drivers: [contract_conversion, follow_on_orders, dilution_overhang, drone_dominance, af_idiq, governance]
open_items:
  - {id: order_82m_delivery, text: "deliveries on $82M C-UAS order 'over the next several quarters'", expires_at: 2027-09-30}
  - {id: me_system_phasing, text: "phasing/acceptance of $22.3M Middle East system", expires_at: 2027-08-20}
  - {id: gauntlet_3, text: "Drone Dominance Gauntlet 3 result naming or omitting Powerus", expires_at: 2027-04-30}
  - {id: fy26_10k, text: "first 10-K with Legacy Powerus as reporter; BDO audit; going-concern and material-weakness status", expires_at: 2027-04-15}
  - {id: lockup_2027_03, text: "180-day lock-up on certain merger shares ends ~2027-03-30 (early release or waiver resolves)", expires_at: 2027-03-31}
group_keys: [earnings_calendar]
```

_Researched 2026-11-18. Nasdaq Capital Market: PUSA. Nevada. No forward earnings date has been announced. The FY2026 10-K is due by about 2027-03-31; this is inferred from the 90-day non-accelerated deadline, not announced. The Q3 2026 10-Q (AGH, pre-merger) and an 8-K 8.01 with Legacy Powerus financials (EX-99.1 interim, EX-99.2 pro forma) were both filed 2026-11-16, with no press release and no call. The base and share figures below were re-checked against those exhibits on 2026-11-18. No fresh web search was possible today (search budget exhausted), so post-2026-11-16 news is unverified._

## Identity & matching
- **Legal entities:** Powerus Corporation is the listed parent. It was Aureus Greenway Holdings ('AGH', the Orlando golf-club owner) until it was renamed when the merger closed on 2026-10-01 ([8-K 2026-10-01](https://www.sec.gov/Archives/edgar/data/2009312/000149315226045385/form8-k.htm)). Autonomous Power Corporation ('Legacy Powerus', dba Powerus) is now a wholly owned subsidiary and is the accounting acquirer, because the deal is booked as a reverse acquisition ([EX-99.2, 2026-11-16](https://www.sec.gov/Archives/edgar/data/2009312/000149315226051916/ex99-2.htm)). The business lines are Tandem Defense LLC d/b/a Powerus Defense (defense) and Kaizen Aerospace (agriculture). Legacy Powerus acquired both in early 2026.
- **The ticker PUSA came from AGH and did not change at the merger.** A 'PUSA' item dated before 2026-10-01 is about the golf-club shell plus deal news.
- **Products to match:**
  - Guardian-1, Guardian-2 and Guardian-3 interceptors. Guardian-3 was unveiled at AUSA on 2026-10-13.
  - MatrixFold (Matrix Series FPV), the Drone Dominance entry.
  - Tandem Defense Matrix-T target drones.
- **People:**
  - Andrew Fox, CEO and Chair.
  - Edward Jordan, CFO.
  - Brett Velicovich, President and co-founder, the media face.
  - Colin Chisholm, COO. Appointed 2026-10-01 and started 2026-10-12 ([8-K 2026-10-06](https://www.sec.gov/Archives/edgar/data/2009312/000149315226045960/form8-k.htm)).
  - Leah Lunger, Chief Accounting Officer from 2026-11-16 ([8-K filed 2026-10-23](https://www.sec.gov/Archives/edgar/data/2009312/000149315226048151/form8-k.htm)). She is the former Red Cat CFO; see the collision table.
- **Aliases, traps and collisions:** use the front-matter `terms`, `match_traps` and `collisions` lists. Before scoring, check any item matched here against the RCAT and UMAC sheets (core §1).
- **Reject as off-entity (0-5, `reason:off_entity`):**
  - The Solana '$PUSA token'. Powerus did not issue, sponsor or launch it and received no proceeds ([IR 2026-11-16](https://ir.power.us/news-events/press-releases/detail/106/powerus-nasdaq-pusa-ceo-to-keynote-solana-breakpoint-following-backpacks-launch-of-pusa-token)).
  - Media hits that only say 'drone expert Brett Velicovich'.

## What the stock trades on
1. **Turning contract value into revenue** (`contract_conversion`).
   - The company reports $130M of contracted revenue expected in the next 12 months, from executed purchase orders and contracts.
   - It also reports a weighted pipeline of about $334M and an unweighted pipeline of about $4.5B. It says pipeline 'is not a measure of backlog' ([8-K 7.01, 2026-11-05](https://www.sec.gov/Archives/edgar/data/0002009312/000149315226050269/form8-k.htm)).
   - At 9/30 deferred revenue was $7.64M (plus $0.16M related party). Two customers held $5.69M and $1.31M of it.
   - The tests are delivery of the $82M order and phasing of the $22.3M Middle East system (open items `order_82m_delivery`, `me_system_phasing`).
2. **New and follow-on orders** (`follow_on_orders`, `af_idiq`).
   - The $82M order was 'the second order placed under' an unnamed, existing U.S. government IDIQ.
   - Watch for further orders, Guardian-2 task orders under the Air Force IDIQ, new vehicles, and international government buyers such as the Pakistan MoD.
3. **Dilution and overhang** (`dilution_overhang`).
   - 170,838,681 shares outstanding (2026-11-11).
   - About 56.5M July-2025 private-placement warrants outstanding at 9/30: 26.6M Common A at $1.00 and 29.9M Common B at $1.25. That is 33.1% of shares on full exercise, and both strikes are below the $1.31 close.
   - A $250M universal shelf plus a 7.41M-share resale (S-3 333-299508, filed 2026-10-19, effective 2026-10-28). The shelf exceeds the market cap, and the resale is 4.3% of outstanding.
   - The merger issued 138,662,026 shares, including 55.0M earn-out shares that became fully earned at closing (EX-99.1 Note 22; EX-99.2).
   - A 180-day lock-up on certain holders' merger shares ends around 2027-03-30. The locked share count has not been verified.
4. **Program standing** (`drone_dominance`).
   - Powerus was selected for the Drone Dominance Phase II qualifier (2026-05-27).
   - It appeared on neither Gauntlet II leaderboard ([DefenseScoop 2026-09-18](https://defensescoop.com/2026/09/18/drone-dominance-program-gauntlet-2-results/)).
5. **Governance scrutiny** (`governance`).
   - Coverage keeps citing politically prominent investors.
   - Material weaknesses were disclosed (segregation of duties, GAAP/SEC staffing).
   - The auditor is changing from WWC to BDO USA.
   - On 2026-10-03 the board approved a $9.955M transaction-completion bonus. Option acceleration at closing recognized $35.4M of stock-based compensation (EX-99.1 Note 22). Both land in Q4 2026.
   - AUT Holdings/KCGI holds 16.77% (13G).

## Materiality bases
- **Base B = $17.79M:** pro forma combined revenue of $13,344,647 for 9M 2026, annualized ×12/9 ([EX-99.2](https://www.sec.gov/Archives/edgar/data/2009312/000149315226051916/ex99-2.htm)).
  - Why this base: core §4.2.1 ranks guidance midpoint, then latest quarter ×4, then last FY. No guidance exists. No standalone quarter has been disclosed: EX-99.1 shows only nine-month periods, plus $4.82M of Q3 revenue recognized from opening deferred revenue. FY2025 pro forma revenue ($5.49M) predates the ramp. The 9M annualization is the closest compliant run rate.
  - State in every magnitude-based `why` which base was used: "p on $17.8M pro forma run-rate base".
  - **Small-base name (B < $25M).** The core small-base rule applies: a named paying customer, contract or expanded deployment is ≥70 with no value needed (`floor:small_base`).
- **The alternate base is not used for p.** The $130M company-reported 12-month contracted revenue is context only. Label it 'company-reported, not GAAP backlog'. Using it as B would need an `owner:<date>` mark; until then, flag `needs_owner` if a score turns on it. Refresh both bases with the FY2026 10-K.
- **Thresholds (USD, core §4.2.1 math on B):**
  - Tiny: $0.18M (1% of B).
  - Lead: $1.78M (10% of B).
  - Lead override: first order from a new U.S. military service, a federal agency or a foreign government, at V ≥ tiny.
- **Other figures** ([EX-99.1](https://www.sec.gov/Archives/edgar/data/2009312/000149315226051916/ex99-1.htm), [EX-99.2](https://www.sec.gov/Archives/edgar/data/2009312/000149315226051916/ex99-2.htm)):
  - Legacy Powerus revenue was $9.14M for 9M 2026 (successor), against $0.60M for 9M 2025 (predecessor).
  - Legacy Powerus net loss was $(29.6)M for 9M 2026.
  - Pro forma net loss was $(35.35)M for 9M 2026 and $(77.5)M for FY2025.
  - At 9/30 Legacy Powerus held $15.7M of cash and had a $20.0M AGH promissory note (plus $1.05M of interest), to be settled after the merger.
  - Customer A was 36.1% of 9M revenue and Customer B 15.3%.
  - Preliminary merger goodwill is $43.2M.
  - The EX-99.1 notes that were read contain no going-concern language. Check the 10-K.
- **Capital (core §4.2.2):** d is measured on 170.84M basic shares, and ATM capacity is divided by the last price; market cap is about $224M. The sheet adds no thresholds of its own.

## Event ladder for this name
The core ladder and §4.2 math apply unchanged. The examples below are re-scored on B = $17.79M and show the event-day score; apply core freshness to anything older than 3 days.

- **Lead (90-100):**
  - 'Powerus (Nasdaq: PUSA) Awarded $82 Million Order for Counter-Unmanned Aerial Systems', 2026-10-05: about 95, p = 460.9, binding, unnamed U.S. government customer, `floor:lead_order` ([IR](https://ir.power.us/news-events/press-releases/detail/103/powerus-nasdaq-pusa-awarded-82-million-order-for-counter-unmanned-aerial-systems)).
  - 'Powerus Secures $22.3 Million Commercial Contract…Middle East', 2026-08-20: about 93, p = 125.3, unnamed oil and gas producer ([IR](https://ir.power.us/news-events/press-releases/detail/100/powerus-secures-22-3-million-commercial-contract-to-protect-u-s-oil-interests-and-critical-energy-infrastructure-in-the-middle-east)).
  - '$2.51M purchase order for drones in support of Department of War program', 2026-08-12: about 90, p = 14.1.
  - 'Powerus Completes Merger, Rings Opening Bell, Now Trading as PUSA on Nasdaq', 2026-10-02: about 90, `floor:listing`. The bell is not the event ([IR](https://ir.power.us/news-events/press-releases/detail/102/powerus-completes-merger-rings-opening-bell-now-trading-as-pusa-on-nasdaq)).
  - 8-K 7.01 business update, 2026-11-05: about 90, `aggregate_orders`, `company_reported`. Rank it on the increment: $130M of contracted revenue less the already-disclosed $82M + $22.3M leaves ≤$25.7M of new value, still above lead. Never add the pieces together.
- **Digest (70-89):**
  - 'Powerus Awarded U.S. Air Force IDIQ Contract Up to $90 Million for Aerial Denial', 2026-08-03: about 85, `ceiling_only` cap ([power.us](https://www.power.us/media/powerus-awarded-u-s-air-force-idiq-contract-90-million)).
    - It covers Guardian-2, was competitively awarded and runs through mid-2028 ([EX-99.1 2026-08-13](https://www.sec.gov/Archives/edgar/data/2009312/000149315226038731/ex99-1.htm)).
    - The Air Force was already a customer (AFSOC first purchase order, 2026-04-30), so the new-service override does not apply.
  - 'Powerus Receives Pakistan Ministry of Defence Order and Signs Strategic MOU', 2026-09-17: about 82 ([IR](https://ir.power.us/news-events/press-releases/detail/101/powerus-receives-pakistan-ministry-of-defence-order-and-signs-strategic-memorandum-of-understanding)).
    - It is a first foreign-government order under the small-base rule, but the value is undisclosed. The lead override cannot be confirmed (V ≥ tiny unknown), so flag `needs_owner`.
    - The MOU is non-binding and is not separately scored.
  - 'Unusual Machines Makes $30 Million Strategic Equity Investment in Powerus', 2026-06-16: about 82, `floor:covered_pair`, named strategic investor ([IR](https://ir.power.us/news-events/press-releases/detail/97/unusual-machines-makes-30-million-strategic-equity-investment-in-powerus-to-scale-u-s-autonomous-drone-manufacturing-infrastructure)).
  - 'Unusual Machines Receives $16.9 Million Purchase Order from Powerus for American-Made Drone Components', unusual_press, 2026-10-22: PUSA side about 76, `floor:covered_pair`, with `also:UMAC`. Powerus is the buyer here, so this is a supply commitment, not PUSA revenue; never compute p on it.
  - 'Kaizen Aerospace Signs $60 Million Australia-New Zealand Distribution Agreement', 2026-07-23: about 78 under the core scope rule (quantified, p = 337.2), provided the release names the distributor; generic 25-39 otherwise. Write 'distribution targets', never orders or backlog. This is the agriculture segment, not the defense thesis.
  - 'Selected to Compete in Phase II of Pentagon's $1 Billion Drone Dominance Program', 2026-05-27: about 75, `floor:selection`, `thesis_drivers_hit:[drone_dominance]`. Drone Dominance is this sheet's core program.
  - COO appointment (8-K 5.02, 2026-10-06): about 72. Core `people` covers COO.
- **Borderline (40-69):**
  - 'Unveils Fully Autonomous Drone Interceptors at AUSA 2026' (Guardian-3, no orders), 2026-10-13: about 60. This is a flagship covered product (compare the RCAT TRICHON anchor at 62).
  - 'Advances to Phase 3 of the U.S. Army's xTech Adaptive Strike Competition', 2026-07-17: about 58. It is a prize-competition stage step, not a sheet core program.
  - 'Powerus and Swarmer Sign MOU', 2026-06-03: 55-60 if the release gives concrete integration, else 25-39.
  - Chief Accounting Officer appointment (Lunger, 2026-10-23): about 45. She is not an NEO.
  - The resale S-3 at 4.3% of outstanding: 40-55. The $250M shelf at more than market cap: 55-65 per the core S-3 row.
  - PUSA (AGH) go-public steps before 2026-10-01: about 50. This is the owner's grade for 'Set to Complete Merger'.
- **Reject (<40):**
  - Keynotes, conferences, bell ringings and token items.
  - Advisory-board names (Kellogg 2026-03-31, CQ Brown 2026-03-24, Sands 2026-05-06): 25-35. They are not officers.
  - TV appearances by Velicovich.
  - Analyst ratings, price targets and short-interest pieces.
  - Forms 3 and 4 for grants, S-8, EFFECT notices, and passive 13G filings.

## Always surface (floors)
Core §6 floors apply as written; this sheet does not restate them. Results and 8.01 financial exhibits floor at 80, calendar notices are fixed at 72, and the order, small-base, covered-pair, existence and deficiency floors also apply. This sheet adds only these documented thesis lifts:
- **`drone_dominance`:** any Gauntlet result, production order or exclusion that names Powerus or MatrixFold is ≥70. So is a published leaderboard for a round Powerus entered that omits it, as a miss under the core §9.3 program rule. A miss is bad news, not noise (owner). A production award ranks as Lead.
- **`af_idiq`:** any task order under the Air Force Guardian-2 IDIQ, or any order naming Tandem Defense, is ≥70, with the obligated value tested against lead ($1.78M).
- **Open items:** resolving an unexpired `open_items` entry floors at 80 with `resolves:<id>`.
- **`dilution_overhang`:** a 424B supplement under shelf 333-299508, a new ATM, a PIPE or any warrant amendment is graded by core §4.2.2 dilution math on 170.84M shares. A warrant repricing takes the toxic-terms +5.
- **UMAC dealings:** each side gets its own object; state UMAC's investor and supplier relationship in `why`.
- **No EDGAR key yet.** PUSA filings may reach the grader late, by a later key or as first sighting. Grade them under core §8 `late_first_sighting`. The absence of a filing is never `insufficient_evidence`.

## Noise patterns
- **Archive bursts (core §8, R-0050):**
  - All 50 `powerus` rows were first seen 2026-09-01 in one seed, with event dates from 2026-03-04 to 2026-08-24.
  - 10 `powerus_ir` rows arrived in one burst on 2026-10-28, with event dates from 2026-06-03 to 2026-10-13.
  - Gate each item on its own event date. Items older than 21 days score 0-9 with `reason:stale`, `archive_burst` and `source_repair`.
- **The `powerus` media page is mostly third-party press.** It carries Fox News and Fox Business clips of Velicovich, AP, AOL and MSN Iran-drone explainers, Forbes features, and Bloomberg, WSJ and NYT profiles.
  - Score commentary and appearance items below 20.
  - Third-party copies of a company release are duplicates of the IR release: `score: null`, `dup_of`. Examples are Reuters on the $22.3M deal (2026-08-21), the Tectonic Defense and Axios items on the UMAC $30M (2026-06-16/17), and DroneLife on Kaizen (2026-07-23).
- **The only live arrival in 90 days was promotional:** 'CEO to Keynote Solana Breakpoint Following Backpack's Launch of $PUSA Token' (2026-11-16). Score it below 15 with `reason:promotional`. The token itself is `off_entity`.
- **Duplicate releases:**
  - 'Awarded $82 Million Order' (2026-10-05) and 'Receives $82 Million Order' (2026-10-06) are one order. Never count $164M.
  - The IR site also re-issued the Drone Dominance Phase II release ('UPDATE --', 2026-05-27) and the Kellogg release (2026-03-31).
  - Keep one canonical; mark the rest as duplicates with no score.
- **Recaps and retellings:** follow the core §7 `late_repost` timing (24h for results recaps, 72h for guidance retellings). The sheet sets no timing of its own.

## Catalyst calendar
These dates are context. Only an event that itself arrives is scored.
- **Q4 2026:**
  - BDO takes over as auditor, effective after the Q3 10-Q filed 2026-11-16.
  - The $9.955M transaction bonus and $35.4M of accelerated stock-based compensation are booked.
  - Year-end goodwill test on $43.2M of preliminary merger goodwill (inferred).
  - Settlement of the $20M AGH note.
  - Remediation of the material weaknesses.
- **Late 2026 to 2027:**
  - Deliveries on the $82M order ('over the next several quarters').
  - Phased deployment of the Middle East system, for which no schedule has been given.
- **About Feb-Mar 2027:** Drone Dominance Gauntlet 3, about six months after Gauntlet 2. Gauntlet 2.5 (bomber drones) was slated for about October 2026; whether Powerus entered is unconfirmed.
- **About 2027-03-30:** the 180-day lock-up on certain Legacy Powerus holders' merger shares ends.
- **By about 2027-03-31:** the FY2026 10-K, the first annual report with Legacy Powerus as the reporting entity. An NT 10-K would trigger the core deficiency floor.
- **Ongoing:** shelf takedowns, warrant exercises at $1.00 and $1.25, and resales under the S-3.
- **Through mid-2028:** the term of the Air Force IDIQ.

## Customers, programs, agencies & counterparties
| Counterparty | Disclosure | Relationship | `big` |
|---|---|---|---|
| U.S. Air Force | release | Guardian-2 IDIQ, up to $90M ceiling, competitively awarded 2026-08-03, through mid-2028. AFSOC first purchase order 2026-04-30, value undisclosed | yes (ceiling) |
| Unnamed U.S. government customer | release | $82M order, the second under an existing IDIQ. The company has not said which IDIQ | yes |
| Unnamed Middle East oil and gas producer | release | $22.3M networked C-UAS system plus a 24-month maintenance program | yes |
| Pakistan Ministry of Defence | release | 'Limited procurement order' of undisclosed value plus a non-binding MOU | unknown |
| Customer A / Customer B | filing_only | 36.1% / 15.3% of 9M 2026 revenue (EX-99.1); identities not disclosed | yes |
| Customers F / G | filing_only | $5.69M / $1.31M of 9/30 deferred revenue | yes |
| Unusual Machines (UMAC) | release + filing | $30M strategic equity investment (2026-06-16); 10.24M shares post-merger (related party); component supplier with a $16.9M PUSA purchase order (2026-10-22) | covered_pair |
| Worldwide Friends Foundation | filing_only | Related party; $842K of 9M 2026 sales | yes (9.2%) |
| AUT Holdings/KCGI | filing_only | 16.77% holder (13G 2026-10-08) | — |
| American Ventures LLC | filing_only | Warrant exerciser | — |

- **Programs:** the Department of War Drone Dominance Program (MatrixFold entry; sheet core program) and Army xTech Adaptive Strike (not core).
- **Partners:**
  - Digital Force Technologies (C-UAS kill chain).
  - Swarmer (Ukrainian swarming firm, MOU).
  - Sprig Aerospace (agriculture, U.S.).
  - The unnamed or partly named Kaizen ANZ distributor.

## Competitors & read-through
- **Direct peers:** Anduril, AeroVironment, Red Cat/Teal, Ondas, DroneShield, Epirus and Neros. Neros topped the Gauntlet II close-quarters-battle leaderboard. Peer wins, peer financings and sector budgets are `out_of_scope` (0-15) for PUSA.
- **Read-through follows core §9 only.** It counts when the item names Powerus, Tandem Defense, Kaizen Aerospace or a sheet product, or when a decision covers a sheet program Powerus is in: the Drone Dominance leaderboards and production orders, the Air Force interceptor IDIQ, or the Pakistan MoD procurement.
- **A rival win at a sheet key account in Powerus's category scores 50-69 as a possible loss.** Such accounts are an Air Force interceptor award, a Drone Dominance production order, or a Pakistan MoD C-UAS buy. If the item confirms replacement, it is `money` bad news at 70+.
- **Published text** names Powerus only when the source does.

## Source coverage gaps
Collector and ops notes (missing EDGAR key, the stalled `powerus` media adapter, defense award and SAM.gov feeds, DefenseScoop program source) have moved to the worker doc `sources/PUSA.md`. Facts the grader needs for freshness and canonical choice:
- **No `edgar_pusa` key yet.** Post-merger 8-Ks, the 10-Q, the S-3 and the 13D/13G filings reach the grader only through other keys or as late first sightings.
- **The 2026-08-03 Air Force IDIQ release exists only on power.us/media, not on ir.power.us.** Treat the power.us/media copy as canonical for that event.
- **The IR site (`powerus_ir`) is canonical for all other company releases.** Third-party copies on `powerus` are duplicates.

## Grader notes
- **The 10-Q is not the business.** The Q3 10-Q (2026-11-16) is pre-merger AGH: $445K of Q3 revenue, of which golf operations were $293K. The operating figures are in the same-day 8-K 8.01 (EX-99.1 and EX-99.2). Never headline golf revenue as Powerus results. The 8.01 is the canonical first record of results (≥80), and the 10-Q is graded as its duplicate unless it adds facts.
- **Separate the money types.** Keep GAAP and pro forma revenue, contracted revenue, pipeline, IDIQ ceilings and non-binding distribution targets apart. Never call the $4.5B pipeline, the $130M contracted revenue or the $60M Kaizen targets backlog. Never use the $130M as B.
- **Customers are rarely named.** State 'unnamed U.S. government customer' literally. Do not assume the $82M order sits under the Air Force IDIQ: the company has not said so.
- **Stale boilerplate.** Releases from Jun to Sep 2026 still say 'pending merger'. The merger closed 2026-10-01.
- **Related-party disclosure.** State UMAC's investor and supplier relationship on any UMAC–Powerus item. Worldwide Friends Foundation sales are related-party.
- **Q4 one-offs.** The $35.4M accelerated stock-based compensation and the $9.955M transaction bonus are already disclosed. In the 10-K they are not new news unless the figures change.
- **Base disclosure.** Every magnitude score says "p on $17.8M pro forma run-rate base". If the owner later marks the $130M alternate base, scores change sharply, so flag `needs_owner` on any item whose band would differ between the two bases.
- **Prior owner grade.** The owner graded a pre-listing go-public step at 50. Post-listing corporate milestones are graded as covered-company items under the core ladder.
