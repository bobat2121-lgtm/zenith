# Core rubric: covered-company news grader

Version 3.1, 2026-11-18. Read on every run. Replaces Zenith `firm-core.md` v2 and the legacy `ranking_policy.md`/`ranking_brief.md`. Company sheets (`companies/<TICKER>.md`, section 12) add detail. The more specific rule wins, within the hard rules in section 12. Where old grader behaviour and the owner's grades conflict, follow the owner.

**The test:** within 24 hours, would the covering analyst change a model line (revenue, backlog, share count, runway, guidance) or a thesis bullet, or write a sentence in a note? Score how strongly the answer is yes for this event in this window, not for the company. **Bad news ranks like good news of the same size**: a lost contract, guidance cut, slip, recall, failed test or miss on a core program ranks like the matching win.

## 1. Scope

**Covered universe (24):** RCAT Red Cat · UMAC Unusual Machines · DPRO Draganfly · SPAI Safe Pro · ONDS Ondas · AXON Axon Enterprise · KDK Kodiak AI · AUR Aurora · SERV Serve Robotics · AGLT Agility Robotics · PL Planet Labs · SATL Satellogic · EVLV Evolv · XTRAF Xtract One · SYM Symbotic · PDYN Palladyne AI · MRLN Merlin · SRFM Surf Air Mobility · GRRR Gorilla Technology · MBAI MBody AI · PUSA Powerus · BOT RoboStrategy · MSTR Strategy · ASST Strive.

**In scope:** the subject is one of these companies, or a subsidiary, brand, product, predecessor or shell listed in its sheet (Teal Drones, Blue Ops → RCAT; Sarcos → PDYN; CCXI → AGLT), or the item passes section 9.

Hard rules, applied before scoring:
- **Entity first.** Match on sheet terms, aliases and traps, then check the match against the collision table below and every other sheet. Wrong entity: 0-5, `reason:off_entity`.
- **Collisions.** Attribute a person's trade or role only when the employer or ticker appears in the same item.

| Term | Possible entities |
|---|---|
| Andrew Kang | MSTR CFO through 2026-11-05 (Form 4 seller); BOT CEO (Mechanism Capital) |
| Shirish Jajodia | MSTR Corporate Treasurer; ASST director |
| Merlin | MRLN; Satellogic's "Merlin" program; SpaceX Merlin engine |
| Strategy | MSTR; RoboStrategy (BOT); the common word |
| Bot Auto | Autonomous-trucking term on the KDK sheet, not BOT |
| Always off-entity | Axon Vision; Agility Global; a PL crypto token; "ELECTRICAL SERV"; a third-party "$PUSA token" |

- **Own items are never out of scope.** An item from a covered source key about the company itself (results, 10-Q, 8-K, S-3, date notices, releases) is graded on its content. It is never `out_of_scope`, and never `insufficient_evidence` on scope grounds. Old graders did this to the Q3 results of SRFM (30), MRLN (35) and ASST (5).
- **Contamination.** Another issuer under a covered key (ChemoCentryx/Amgen 2022 in `aglt_press`): 0-9, `reason:source_quality`. Old archive material (MicroStrategy 2020-23 in `strategy`): 0-9, `reason:stale`. Both get `source_repair` and never reach the feed.
- **Out of scope:** peers, competitors, the sector, policy, macro, general news, budgets that name no covered program, market sizing, other companies' earnings, and thematic pieces with a forced tag. 0-15, `reason:out_of_scope`, whatever the dollars; never above 39.
- **Status changes.** A bought company stays covered until the owner removes it (SSTI closed 2026-11-18; the owner removed SSTI and REKR from coverage on 2026-11-20, and calibration examples that cite them still illustrate the rules). After the close, only final filings and sheet drivers (CVR, earnout) rank. If a primary item contradicts the sheet, trust the item and flag `sheet_stale`.

## 2. Score scale and bands

Integer 0-100, owner scale R-scale-v1.

| Score | Band | Meaning | Feed |
|---|---|---|---|
| 90-100 | **Lead** | Changes estimates, thesis or note today | Top, highlighted |
| 70-89 | **Digest** | Next note or model check | Main feed, by score and time |
| 40-69 | **Borderline** | True, on-entity context: a stage step, small win, modest filing | Collapsed; shown on thin days |
| 0-39 | **Reject** | No action | Hidden, audited |

0-9 = data problem (wrong entity, stale, contaminated). 10-39 = correct but immaterial. Duplicates get `score: null`. Grade absolutely: feed capacity never changes a score ("only on a thin day" means Borderline). Old graders ran 31-41 points *below* the owner on flagged items, so when a fresh, on-entity primary item sits between two bands, take the higher.

## 3. Event ladder

Pick the highest rung the facts support; section 4 places the score inside its range. A sheet `rank_high` line or thesis driver can lift an item one rung.

| `rung` | Covers | Default |
|---|---|---|
| `control` | Covered company bought (agreement, tender, rival bid, vote, clearance, close, 25-NSE); de-SPAC close, listing, uplisting; delisting determination; bankruptcy; default; non-reliance; first going-concern doubt | 85-100. Agreement, rival bid, tender result, close 90+; procedural steps 75-89 |
| `results` | Same-day primary results, preliminary results and pre-announcements; guidance raise, cut or withdrawal; backlog or bookings disclosure; new 10% customer | 80-98 |
| `money` | Orders, contracts, awards, task orders, options, renewals, expansions, aggregate-order updates; losses and cancellations | 70-97 by 4.2; below tiny 25-39 unless 4.2 lifts it |
| `permission` | Final regulator decisions (FAA type cert, Part 135/121, BVLOS, FMCSA exemption, AV permit); qualified lists (Blue UAS, FedRAMP, ATO); downselect, intent to award, readiness selection; pre-award naming the company or product | 70-90; sheet-named core program ≥75 |
| `capital` | Offerings, PIPEs, converts, ATMs, warrants, preferreds, debt, buybacks, strategic investments, reverse splits; treasury activity | 55-95 by 4.2.2-4.2.3 |
| `deal` | Covered company as acquirer or seller | Signed 75-88; closed 75-85. Consideration ≥ B or ≥25% of market cap: 90-95; ≥10% of B: up to 88. Target news counts only after close |
| `proof` | Named-customer deployment; new market, lane or city; fleet or production figures and targets; driverless commercial launch; own satellite launch or commissioning; delivery milestones; risk-retiring tests; slips of any of these | 60-85. For AUR, KDK, SERV, AGLT, MRLN, SYM and PDYN, a stated lane, date, fleet or production target, or its slip, is 70-85 |
| `commitment` | MOU, LOI, teaming, framework, pilot, partnership, integration | 55-85 by the 4.1 scope rule; generic 25-39 |
| `people` | CEO, CFO, COO, President, CTO in or out | 70-88; abrupt exit +5-10. Directors and other officers 25-50; VP/HR <25 |
| `product` | Flagship product or platform launch, production-ready status, new category | 55-75; +5-10 with a named customer or contract. Minor features, GA 35-55 |
| `legal` | Probes, suits, rulings, settlements, short reports, recalls, cyber incidents | Score only the incremental change. Disclosed SEC/DOJ probe 80+; specific short report 70-85 (call it an "allegation"); final ruling with dollars 65-85; procedural steps 30-55; law-firm solicitations <15 |
| `insider` | Form 4 open-market trades, 13D/G | 10-80 (section 5) |
| `calendar` | Results or call date; investor or analyst day | Date notice fixed at 75, `group:earnings_calendar`; investor day 80-92 |
| `noise` | Section 7 | 0-30 |
| `out_of_scope` | Section 1 | 0-15 |

- **Results:** score the surprise and the delta, never the print itself. Extract revenue against guidance and the prior period, any guidance change, backlog, gross margin, cash and runway, 10% customers, and going-concern or restatement language.
- **Guidance:** any raise, cut or withdrawal floors at 80. It is Lead when the midpoint moves ≥10%, guidance is withdrawn, or a cut comes with a miss. Going concern or a ≥20% miss is Lead. A sheet may lower the Lead threshold only with an `owner:<date>` mark.
- **Go-public:** pre-listing steps ("set to complete", S-4 filed) 50-69; listing or close 85-95; paperwork with no new terms <40.
- **Stage labels are facts:** supervised ≠ driverless; launched ≠ commissioned; planned ≠ in service.

## 4. Modifiers

Apply in this order: status → magnitude → novelty → thesis → timeliness → caps and floors (section 6). Floors apply at `confirmed`, `company_reported`, `selected` or `pre_award` unless the row names a stage.

### 4.1 Status and certainty

`status` is the literal stage, and `why` states it. Never call an MOU an order or a selection an award.

| `status` | Meaning | Effect |
|---|---|---|
| `confirmed` | Executed, awarded, delivered, deployed, closed, booked | 0 |
| `company_reported` | Company's own figure with no official record (order totals) | 0; flag `company_reported` |
| `selected` | Downselect, intent to award, readiness assessment, preferred bidder | 0; **never discount pre-award** |
| `pre_award` | Solicitation, sources sought, J&A, sole-source notice, budget request or line naming the company or product | 0; write "requests"/"solicits" |
| `pending` | Signed but not closed; planned deployment | 0 to -5 |
| `mou` / `pilot` | Non-binding MOU, LOI, framework, teaming; trial | Scope rule; unpaid pilot -5 |
| `mgmt_claim` | Statement on a call or in an interview | -15, cap 75; never an order |
| `reported` | Credible outlet citing sources | -10; cap 85 for `control`, 79 otherwise |
| `rumor` | Unsourced or weak outlet | Cap 35 |
| `prospective` | Pipeline, "in talks", TAM | Cap 39 |

Official records (filings, votes, award notices, regulator orders) outrank company releases, which outrank press. Syndication adds no certainty.

**Scope rule.** The owner, on Aurora/Hirschbach 500 trucks: "quintessential to know about... do not ignore partnerships and MOUs that are at least somewhat material".
- Named major counterparty plus units, volume, value, term, territory or channel: 60-85 (use the MOU column in 4.2.1 if valued).
- Named defense prime, military unit or Fortune-500 operator with concrete integration or adoption of a named covered product, but no volume: 60-70 (RCAT/Havoc, PDYN/Orkid).
- Other named counterparty with concrete integration, but small or private: 55-60.
- Paid pilot: +5. Generic: 25-39.

**Never conflate:** backlog and revenue, bookings and recognized revenue, ceiling and obligated value, pilot and order, guidance and consensus, planned and in service, launched and commissioned, supervised and driverless, proposed and enacted funding. An announcement proves the author's claim, not the outcome. Treat parsed tags as hints to verify.

### 4.2 Magnitude

#### 4.2.1 Orders against the revenue base

**B** = the sheet's annual revenue base in USD, with `base_basis` stated. Default order: guidance midpoint (an "at least" guide uses its floor) > latest quarter × 4 > last fiscal year. Only these alternate bases are allowed: LTM revenue; next-quarter guide × 4; YTD actuals plus a stated full-year target; contracted revenue; order book; forward-year revenue target; NAV (funds). An alternate needs `alt_base` plus an `owner:<date>` mark. Without the mark, it applies only when no default basis exists (pre-revenue, treasury, fund); then flag `alt_base` and keep confidence ≤0.7.

**tiny** = 0.5% of B if B > $100M, else 1%. **lead** = 10% of B. Both are in USD at the sheet's `fx_as_of` rate, and so are the $100M and $25M tests (DPRO and XTRAF report in C$).

**V** = total contract value, or obligated value when stated. For a ceiling alone, flag `ceiling_only` and cap at 85 unless the obligated value reaches lead. Convert at the event-date rate. Note the annual run rate in `why`, but always test the total. **p = V ÷ B × 100** (one decimal), reported as `magnitude_pct_of_base`.

| p | Binding | `selected` / `pre_award` | Quantified `mou` / `pilot` |
|---|---|---|---|
| ≥10 (lead) | 90-97 | 88-94 | 78-85 |
| 3-10 | 80-89 | 80-88 | 70-78 |
| 1-3 | 72-80 | 72-80 | 64-72 |
| tiny-1 | 70-74 | 70-74 | 60-64 |
| < tiny | 25-39 | 25-39 | 25-39 |

- **No intermediate bands:** sheets may not add a "meaningful" line or any band between tiny and lead. A binding order ≥ tiny is ≥70 unless an `owner:<date>` line says otherwise.
- **All orders count:** the lead line covers any order, booking, backlog or aggregate-order disclosure, company-reported ones included (ONDS ">$165M new orders" = 30.7% of $537.5M → Lead). Aggregates take the lower half of the range.
- **Lead override (floor 90 when V ≥ tiny):** a product's first production-scale order; a first order from a new U.S. military service, federal agency or foreign national government. When V is undisclosed: 85, confidence ≤0.7, rising to 90 once V ≥ tiny is shown (RCAT ATLA and NSPA ally orders, PUSA Pakistan MoD, DPRO first Heavy Lift sales). A new state or city agency adds +5 novelty only.
- **Units:** when an order is sized only in trucks, robots or systems, p = units ÷ the sheet's `unit_base` (installed fleet or stated target, named in the sheet), scored on the same table. Flag `pct_is_units`. Units become dollars only when a primary source gives a unit price.
- **No value:** a binding order with a named counterparty defaults to 70-78 unless it is clearly minor (a few units, spares, repair). A missing figure is never a discount. Compute `magnitude_usd` only when quantity and unit price both appear in a primary source (flag `estimate`); otherwise null. Never invent a unit price.
- **Anonymous counterparties:** an unnamed prime or a small operator is never a discount. Grade a binding subcontract or operator signing by this table or the small-base rule (SRFM OperatorOS, SPAI subcontracts).
- **Small-base rule (B < $25M in USD: SPAI, MBAI, AGLT, DPRO, XTRAF):** a new, repeat or expanded named paying customer, contract or deployment scores ≥70 without a value. Old graders put MBody at 42-50 and Safe Pro at 52-55; the owner wanted them at the top.
- **Large-cap grouping (B > $1B, e.g. AXON, SYM):** named public-agency awards below tiny score 60-68 with `group:<ticker>_awards`; the merged card shows at 70+ (owner: "Multiple Axon wins can be grouped into one headline"). *Feed note: merged group cards are not built yet; members show individually at their own scores. Keep emitting `group:` keys — the feed will merge on them.*
- Other orders below tiny: 55-65 for a first customer, a new country or a first production-scale buy.

#### 4.2.2 Capital: dilution, not cash

This table is binding for every operating name. Sheets may add only the +5 lifts below, or a value marked `owner:<date>`.

**d** = new shares ÷ basic shares outstanding before the deal. New shares = offering shares + full warrant exercise + convert shares at the conversion price; ATM shares = capacity ÷ last price. If counts are missing, use proceeds ÷ market cap, with confidence ≤0.6. Never judge against cash on hand (old grader: DPRO $10M strategic investment 58, "modest against C$131.9M of cash").

| d or size | Score |
|---|---|
| d ≥20% / 10-20% / 5-10% / <5% | 85-95 / 78-88 / 70-80 / 55-70 |
| New ATM: capacity ≥20% of market cap / smaller | 75-85 / 60-72 |
| Debt: principal ≥25% of B or market cap / smaller | 75-85 / 55-70 |
| Buyback ≥5% of market cap / smaller | 70-80 / 50-60 |
| Shelf, no takedown | 40-55 |

+5 each for: a ≥15% discount to last close; toxic terms (resetting converts, equity lines, warrant repricing); a named strategic investor. A covered-to-covered deal is ≥75 for each name. Put d in `magnitude_pct_of_base` and flag `pct_is_dilution`.

#### 4.2.3 Treasury names (MSTR, ASST, BOT)

Treasury names are exempt from the revenue-base lines. These bands are binding; a sheet may change them only with an `owner:<date>` mark. Group keys are `treasury_<TICKER>` and `nav_<TICKER>` only.

**MSTR and ASST: h = units added ÷ prior holdings.** Flag `pct_is_holdings`.

| Purchase | Score |
|---|---|
| h <0.25% | 40-55, `group:treasury_<TICKER>` |
| 0.25-1% | 60-68, grouped |
| 1-5% | 72-84 |
| 5-10% | 85-89 |
| ≥10% | 90-95 |

Weekly purchase 8-Ks are members of the `treasury_<TICKER>` card.

Other events, all treasury names:
- Any treasury sale, policy change, or company-stated mNAV or ATM trigger: 85+.
- New security class (preferred series, convert, new ATM): 75-90. Takedowns follow 4.2.2. Preferred dividend change: 75-85.
- NAV, mNAV or BTC-yield update: 60-68 (`group:nav_<TICKER>`). NAV move ≥10% month on month; index add or drop; covenant or margin event: 75-90. mNAV moves driven only by price are noise.

**BOT (closed-end fund), yardstick = % of NAV:**
- New position, follow-on or exit: ≥5% of NAV 75-85; 1-5% 60-70; <1% 40-55 (`group:treasury_BOT`).
- Remark that moves NAV ≥5%: 75-85.
- Monthly NAV: move <3% 55-62 (`group:nav_BOT`); 3-10% 68-78; ≥10% 80-90.
- N-CSR/N-CSRS: 50-65, or the position bands above when it is the first record of a new position or mark.
- 424B3 that is the first record of a NAV figure: NAV bands; otherwise <30 unless it carries new terms.
- First N-2 for a new fund: 55-70. 497AD: 0-10.

#### 4.2.4 Denominators

Never invent one. If the base or share count is unknown, say so in `why`, null the percentage, and judge on the disclosed facts. Use the current sheet base. If a newer primary print would change the band, note the new figure in `why` and flag `sheet_stale`.

### 4.3 Novelty

+5-10 for a first: first customer, production order, international or new-agency sale, revenue, or driverless operation. An update with a new amount, quantity, stage, site, customer or deadline ranks on the new fact (award after pre-award, close after signing, new order total). A restatement with no new figure: <40, `reason:already_covered`.

### 4.4 Thesis proximity

- Moving a sheet `thesis_driver`: +5-15, and it may lift a rung; list the ids in `thesis_drivers_hit`. A miss ranks like a win (owner on Drone Dominance: "a miss is bad news, not noise").
- Resolving an unexpired `open_item`: floor 80, `resolves:<id>`. Expired items give nothing.
- Sheet `rank_high` lines override the ladder (RCAT's 2026-08-10 SRR readiness selection ranks high though it is not an award).
- A segment the sheet marks immaterial: -5.

### 4.5 Timeliness

The **age** of an item is its event date (ET) measured to news-monitor's **first sighting** (`first_seen`), never to the time you grade it. The queue can wait hours or days; that wait never lowers a score (AUR's Q3 letter was seen the day it came out and graded 22 days later: it is a same-day result, floor 80). The claim prints `seen_after_days` (first sighting minus the published date) for each item. The event date is the date of the event or its first announcement, never a secondary article's, crawl or index time; if it is unknown, say so. Age 0-3 days: no change. 4-21 days at first sighting: -5 to -10, with the original date in `why`. Over 21 days at first sighting: section 8.

## 5. SEC filings

EDGAR rows are bare form titles. When `CONTACT_EMAIL` is set, the Worker's excerpt of a filing starts at its first Item heading and adds the release furnished as Ex-99.1 (`EX-99.1:`), keeping the sentences with figures. **Read the filing and its exhibits** (that excerpt, or the documents themselves; `read_source: true`) before scoring above 39, and grade the facts, never the receipt (R-0056; owner on SRFM: "give me numbers, not the sole fact that Surf published its 10-Q"). If the figures cannot be read: cap 55 unless a floor applies by identifier (then the floor itself), write "no figures available" in `why`, flag `no_figures`, confidence ≤0.4. The API applies this cap to every EDGAR grade with `read_source: false` and records `sec_unread_capped_from_<score>`.

**8-K items** (a 6-K follows the item its exhibit matches):

| Item | Grade |
|---|---|
| 1.01 | Grade the agreement: a contract by 4.2.1; credit or a convert by 4.2.2; a merger as target is `control` 90+; as acquirer, `deal` |
| 1.02 | Mirror of the original win at its size: 75-95 |
| 1.03 bankruptcy / 1.05 cyber | 95-100 / 75-90 |
| 2.01 | Covered company acquired 90-98; as acquirer, `deal` with the magnitude lift |
| 2.02 | Floor 80, preliminary results and pre-announcements included; sheets may raise the floor, never lower it. Read Ex. 99.1; canonical together with the release |
| 2.03 | 4.2.2 |
| 2.04 / 2.05, 2.06 | 85-95 / 70-85 |
| 3.01 | Deficiency 70-78, +10 with a going-concern note or a price below 50% of the bid requirement (cap 88); extension 60-70 (REKR 2026-10-27); delisting determination 85-95; compliance regained 55-65 |
| 3.02 | Dilution math; small consultant or settlement issuances <25 |
| 4.01 / 4.02 | Auditor resignation 75-85, routine change 40-55 / non-reliance 88-98 |
| 5.01 | 90+ |
| 5.02 | Confirm the role from the text: CEO/CFO 75-88; other NEO 70-85; director-only 25-45; pay plans <25 |
| 5.03 | Reverse split, share increase, name or ticker change 55-70; else <20 |
| 5.07 | Routine AGM 10-25; approval of a reverse split, share increase or financing 45-65; buyout approval 80+; failed management proposal 70+ |
| 7.01 | New deck with new figures, targets or guidance 70-85; repeat deck 20-35 |
| 8.01 | Grade the content on the ladder |
| 9.01 | Never an item on its own |

**Other forms:**

| Form | Grade |
|---|---|
| 10-Q/10-K/20-F/40-F | With a same-day release: duplicate, unless it adds backlog/RPO, a new 10% customer, going concern (85+), a first material weakness (65-80), subsequent events, segments or share count (update, 60-85). First record of results: ≥80 |
| NT 10-Q/10-K | 75-85 |
| S-1/F-1 | First primary raise 65-85 (4.2.2). Resale: ≥20% of outstanding 60-70, else 40-55, with the share count. Amendments <30 unless terms change |
| S-3 shelf | 40-55; shelf ≥ market cap 55-65 |
| 424B2/B4/B5 | Priced takedown or ATM supplement: 4.2.2 |
| 424B3, 497 | 10-30 unless new terms (BOT: 4.2.3) |
| S-8, Form 3, EFFECT | 0-15; an S-4 EFFECT that sets a vote date 45-60 |
| S-4/F-4 first filing | 55-70 |
| DEF/PRE 14A | Capital or merger proposals 40-65; routine 10-20; DEFM14A for a covered buyout 60-80 |
| SC TO-T, SC 14D9 | 80-90 |
| SC 13D | New strategic, activist or covered holder ≥5%: 70-85. 13D/A with a new Item 4 plan: 60-80. Anchor holder (sheet `anchor_holders`: also a customer, partner or former parent, e.g. Uber at AUR, Walmart and SoftBank at SYM) changing its stake by ≥1% of shares, or crossing below 5%: 60-75. Other 13D/A: <30 |
| SC 13G / 13G/A | 25-40 / <20; anchor holders as in SC 13D |
| Form 4 | Officers and directors, **open-market codes P and S only**; give person, role, date, shares, price, value and holdings after. P ≥$100K at a small-base name, or cluster buying: 65-80. P ≥$100K or ≥1% of holdings elsewhere: 55-70. Small P at a large cap: 40-55. Non-10b5-1 S by the CEO or CFO of ≥10% of holdings: 55-75. 10b5-1 sales: 15-35. Codes A, M, F, G, J: 0-10, not items |
| Form 144 | <20; CEO or founder selling ≥5% of holdings 30-45 |
| 25-NSE | Delisting at a covered buyout close: 90+ as the first record, else a duplicate of the close release; exchange transfer 30-45 |
| 15-12B/12G | <20 after a close; deregistration of an operating covered company 80 |

**Filer map:** GRRR (20-F), DPRO (40-F) and MBAI file 6-Ks, and their executive changes arrive there. XTRAF files only in Canada, so only its releases arrive. AGLT filed as CCXI until its de-SPAC. BOT files N-2, N-CSR, 424B3 and 497AD. Others follow their sheets. Every covered filer has an EDGAR source key (MSTR, PUSA, ASST and UMAC since 2026-11-22). Collection keeps stock-moving forms only: Forms 3/4/5, 144, 13G, S-8, 11-K, SD, 13F, DEFA14A and D never arrive, nor do 8-Ks whose items are only 5.07, 5.08 or 9.01. 8-K titles carry their item codes, as in `8-K [Items 2.02, 9.01]`. A missing expected filing is never `insufficient_evidence`.

**8-K plus release:** the same event on the same day is one item. If both arrive in one run, the release is canonical. An earlier 8-K stays canonical until the release arrives; the release then duplicates it unless it adds facts. A later copy is an update only if it adds terms (pricing, conversion, covenants, termination fees, the exhibit agreement); grade it on the increment, usually 45-70.

## 6. Universal floors

Floors apply once the item is canonical, fresh, on-entity and verified. They never rescue `off_entity`, `stale`, `duplicate`, `already_covered` or `late_repost`, and a `late_first_sighting` takes its section 8 cap instead. Modifiers only lift above a floor. Record `floor:<id>`. Sheets may raise a floor; lowering one needs an `owner:<date>` mark.

The API reads this table and **rejects** a grade that flags a floor and scores below it (`calendar` must be exactly 75; `lead_order` accepts 85 while `magnitude_usd` is null). Flag a floor only when its identifier is met; if it is not, drop the flag rather than the score. A sheet line that scores date notices below 75 carries no `owner:` mark and is void: score a date notice 75 with `floor:calendar`. `floor:investor_day` needs the company's own words: the notice must call the event an investor day or an analyst day, and the API rejects the flag when neither the title nor the captured excerpt names one (an SEC filing's title never does; its Item text or Ex-99.1 release may). Webcasts, live Q&As, shareholder calls, fireside chats and "investor presentations" are not investor days (MSTR's retail "Live Q&A with Investors", BOT's "Investor Webcast"): grade them as section 7 promotion or a calendar card.

| `floor:` id | Identifier | Floor |
|---|---|---|
| `buyout` | Covered target: agreement, rival bid, tender result, close; 8-K 2.01/5.01; 25-NSE as first record | 90 |
| `lead_order` | Binding order, booking or aggregate update with p ≥10, or a lead override (85 while V is undisclosed) | 90 |
| `deal_transformational` | Own acquisition, signed or closed, with consideration ≥ B or ≥25% of market cap | 90 |
| `existence` | 8-K 1.03, 4.02, 2.04; first going concern; delisting determination | 85 |
| `listing` | Listing, uplisting, de-SPAC completion | 85 |
| `treasury_sale` | Treasury sale or stated policy trigger | 85 |
| `results` | Same-day primary results with figures (2.02 including preliminary, 6-K, release, first-record 10-Q/10-K) | 80 |
| `guidance` | Company guidance raised, cut or withdrawn | 80 |
| `investor_day` | Notice of an event the company calls an investor day or analyst day; 85 if it is the first ever or the company listed ≤24 months ago (AGLT: "arguably #1") | 80 |
| `probe` | Company-disclosed government investigation | 80 |
| `open_item` | Resolves an unexpired sheet open item | 80 |
| `calendar` | Results or call date notice, call-only included | 75 fixed |
| `neo_ceo_cfo` | CEO or CFO in or out | 75 |
| `regulator` | Final regulator decision naming the company | 75 |
| `selection` | Downselect, intent to award or readiness selection in a sheet-named core program | 75 |
| `capital_big` | Priced raise with d ≥10% or a discount ≥15% | 75 |
| `covered_pair` | Transaction between two covered companies, each side | 75 |
| `deal_signed` | Own acquisition signed or closed | 75 |
| `order` | Binding order ≥ tiny with a named counterparty; pre-award naming the company in a sheet program | 70 |
| `small_base` | Small-base named paying customer, contract or expanded deployment | 70 |
| `neo` | Other named executive officer in or out | 70 |
| `deficiency` | 3.01 deficiency; NT 10-Q/10-K; auditor resignation | 70 |
| `key_loss` | Loss, cancellation, 1.02 or sustained protest at a sheet key customer or program | 70 |

## 7. Universal noise rules

Noise applies only when the ceremony or promotion is the whole item. An item that also reports a primary event is graded on that event ("Powerus Completes Merger, Rings Opening Bell" is a listing, 85-95).

- **0-20, `reason:promotional`:** bell ringings; awards and "named to" lists; sponsorships (sports, F1); conference, webinar and fireside appearances; keynotes (token or crypto events included); podcasts, blogs, thought leadership; testimonials; philanthropy; booth notices. Owner R-0016: out at any size, even for covered names (SPAI bell, downvoted).
- **15-30:** analyst initiations; SOC 2 and ISO badges; routine AGM notices and votes; VP/HR promotions; tokens the company did not issue.
- **<20, `reason:out_of_scope`:** stock-move pieces, price targets, ratings, options flow, mNAV commentary; thematic pieces with a forced tag.
- **<30, `reason:late_repost`:** secondary earnings recaps more than 24h after the print; guidance retellings more than 72h after (the owner processes prints the same day). Sheets cite this rule and never restate it.
- **30-39:** index inclusion (S&P 500 inclusion 60-70).
- **Weapons detection (EVLV, XTRAF):**
  - Tier accounts are NFL, NBA, NHL, MLB and MLS home venues, named multi-hospital systems, whole school districts and airlines.
  - A tier win scores 70-80 individually; a tier renewal 65-75 (the owner upvoted the Texans renewal).
  - Other single-venue or single-school wins score 55-68 with `group:wd_roundup`.
  - XTRAF also takes the small-base rule and keeps the group key.
- **Borderline 40-69:** minor features; director changes; shelves; resales <20%; court steps with modest change (R-0001).
- **Not noise:**
  - Investor or analyst days.
  - "Business updates" with new figures.
  - Certifications a buyer requires (FedRAMP, Blue UAS, ATO, FAA, CMMC as a contract condition): grade as `permission`.
  - Flagship covered launches: grade as `product`. R-0034 ("a new drone is released every day") exempts covered makers.
  - Never apply a lane pack's "no order, no item" list to covered names. Those lists buried RCAT TRICHON (45), Blue Ops USVs (45) and ONDS Dronebuster REACH with an ONR contract (55).

## 8. Duplicates, syndication, corrections, freshness

- **One event, one item.** Cluster the release, filing, wire, syndicated copies, buyer and seller versions, and press. Canonical order: company release > filing exhibit > official record > wire > secondary press. If none of these is in the window, use the best copy. Never reject both copies.
- **Duplicates:** `score: null`, `band: "duplicate"`, `reason:duplicate`, `dup_of:<item_id>`. Calibration uses canonical items only.
- **Audit duplicates** (owner, R-0039: "If it does, then it can be accepted"): a copy that adds a figure, counterparty, stage, site or date is an update, graded on the increment with `reason:new_information`. A named partner's concrete adoption is its own story (Gecko/NVIDIA: owner 78, grader 20).
- **Already covered** must cite the prior item id and the same event (counterparty, amount, stage). Generic word overlap (ai, drone, defense, platform) is never prior coverage.
- **Never multiply money:** overlapping headlines are one commitment; an order total includes earlier orders; ceiling ≠ obligated; booked ≠ pipeline. A wire copy is still the issuer's claim.
- **Corrections:** a changed figure, party or stage is an update on the change; a typo fix is a duplicate.
- **Groups:** score members individually and consistently; the feed merges them. Core keys: `earnings_calendar`, `<ticker>_awards`, `wd_roundup`, `treasury_<TICKER>`, `nav_<TICKER>`, `deployment_wave_<TICKER>`. The only other keys allowed are `<ticker>_<slug>` keys declared in a sheet. Keys match case-insensitively and are emitted lowercase. A date notice is a card member, never a cross-company duplicate.
- **Freshness:** first seen more than 21 days after the event: <30, `reason:stale`. Exception: a material official record that never surfaced before, seen as the first public record, scores the event score -15, cap 79, `late_first_sighting`, with the original date in `why`. Both are measured at first sighting (4.5), never at grading time. The API rejects `late_first_sighting` when the item was first seen within 21 days of its published date; when the record itself was published long after the event it reports (an award posted a month late), keep the flag, add `event_predates_publication` and give the event date in `why`. Legal echoes are stale (EVLV derivative settlement, "originally from April").
- **Archive bursts (R-0050):** ≥5 items from one source sharing one `first_seen`, with event dates spanning more than 30 days. Examples: `strategy`, 101 MicroStrategy releases first seen 2026-11-03; `edgar_bot`, `bot_press`, `edgar_aglt`, `aglt_press` on 2026-11-18. Gate each item on its own date. Items more than 21 days old: 0-9, `reason:stale`, `archive_burst`, `source_repair`. Undated backfill never ranks. zenith-core parks such rows at ingest (five or more from one source sharing one `first_seen`, undated or published more than 14 days earlier: skip reason `archive_seed`); any that still reach you follow this rule.

## 9. Read-through boundary

A non-company item counts for a covered name only if:
1. the source names the company, a sheet subsidiary, brand or product, or its program role; or
2. a sheet-listed customer or program acts on a product in the company's category: buy, renewal, expansion, pause, cancellation, replacement, or a board, council or budget vote. This holds without a release, and even when the story omits the company, if the sheet ties the customer to it (`call_only`, `filing_only`). Votes, budget lines, tenders and contract notices are official records; call statements stay claims; or
3. a government or regulator decision names the company or a sheet program it is in (Army SRR quantities, an FMCSA exemption covering its trucks), graded by 4.2; or
4. a rival wins at a sheet key account in the company's category: 50-69 as a possible loss, or `money` bad news (70+) if the replacement is confirmed.

**Investees:** news about an equity-method or minority investee (financings, valuations, sites) counts only when it names the covered company or the covered company discloses the mark or terms. A JV's operating milestone counts when it names the covered company's systems.

**Counterparty sources:** an item whose claim shows `COUNTERPARTY: role=… affects=…` comes from a search or feed about a covered company's partners (`relationship`), customers (`customer`), programs (`program`), rivals (`rival`) or index providers (`index_event`). It is never an own item, so the own-item rule in section 1 does not apply: it counts only through rules 1-4 above, otherwise 0-15 `reason:out_of_scope`. Grade it under its `ticker` with the bare item_id. When it also passes a rule for another ticker in `affects`, add a `"<item_id>#<TICKER>"` grade for that ticker. Rival items reach the queue only when the title names the covered company or a sheet key account; still check that the rival actually won, renewed or replaced at that account. Index items count for MSTR when the provider names Strategy or MSTR in an inclusion, exclusion or methodology decision.

Everything else is `out_of_scope`, whatever old read-through precedents said: peer wins and financings, sector budgets, competitor executives, other companies' AV launches, market studies. Sheet lines that surface items not naming the company (regulation, peer distress, RFPs, FX) break this hard rule unless they carry an `owner:<date>` mark. Otherwise they belong in the sheet's catalyst calendar as context and are never graded. A co-mention or tag is not news. A covered company named in another covered company's own item counts as direct involvement for both.

**Published text** (`why`, `note_hook`) states sourced facts only: no "what this means", beneficiary, risk or implication (R-0008 verbatim: "stop appending read-through commentary. State what happened."). Name a covered company only when the source does (owner: "Do not tell me how it relates... unless one of my companies are directly named"). Write "Gwinnett board votes to renew weapons screening", not "Evolv wins Gwinnett". Internal mappings move scores, never published claims.

## 10. Output contract

One JSON object per item, nothing else:

```json
{"item_id":"string","ticker":"RCAT","score":84,"band":"digest","rung":"permission",
 "event_type":"program_selection","status":"selected","magnitude_usd":null,
 "magnitude_pct_of_base":null,"thesis_drivers_hit":["srr"],
 "why":"Army selected Teal Drones for SRR manufacturing-readiness assessment; selection, not award; no value stated.",
 "note_hook":"SRR: Teal advances to manufacturing-readiness assessment.",
 "confidence":0.85,"read_source":true,"flags":["reason:material","floor:selection"]}
```

- **item_id:** the input id. The item's own grade always uses the bare id. A covered-to-covered event also gets one object for each *other* covered ticker, with id `<item_id>#<TICKER>` and the flag `also:<TICKER>`.
- **ticker:** one covered ticker. For off-entity, contaminated or out-of-scope items, the source key's ticker or null.
- **score:** integer 0-100; null only for duplicates. **band:** `lead|digest|borderline|reject|duplicate`, matching the score.
- **rung:** a section 3 id.
- **event_type:** `results`, `guidance`, `order`, `contract`, `aggregate_orders`, `award`, `pre_award`, `program_selection`, `contract_loss`, `regulatory`, `deployment`, `production_target`, `driverless_launch`, `mou_partnership`, `pilot`, `capital_raise`, `atm_program`, `debt`, `buyback`, `treasury`, `nav`, `acquisition`, `divestiture`, `buyout_step`, `listing`, `listing_compliance`, `exec_change`, `insider_trade`, `product`, `earnings_date`, `investor_day`, `legal`, `filing_other`, `promotional`, `commentary`, `off_entity`, `duplicate`.
- **status:** a 4.1 value, or `scheduled`, `filed`, `n/a`.
- **magnitude_usd:** V in USD, or null. **magnitude_pct_of_base:** p, d, h, units or % of NAV, one decimal, or null.
- **why:** ≤25 words: the literal stage, figures with period labels, and the test used ("Intent to award, $1.4M total (~$280K/yr), 2.8% of $50.6M base"). Every number must be traceable to the source. No implications.
- **note_hook:** ≤20 words, the factual line the analyst would write ("ONDS: >$165M new orders since last update, company-reported"). No invented numbers.
- **confidence:** joint certainty of entity, stage and figures. ≤0.5 if `read_source` is false (≤0.4 for an unread EDGAR filing); ≤0.6 if the entity or date is uncertain or figures are estimated.
- **read_source:** true only if you read the source text: the URL or document you opened, or the Worker-captured excerpt of it (`EXCERPT (ok)`) when the facts you graded on are in that excerpt. Required for EDGAR items above 39, cryptic titles, and items scoring 70+ whose captured text lacks figures. The API caps confidence at 0.5 when it is false.
- **thesis_drivers_hit / resolves:** only ids present in the sheet's front matter. If the block is missing, emit `[]` and no `resolves:`, and flag `sheet_incomplete`.
- **flags:** exactly one `reason:` from `material`, `primary_source`, `new_information`, `calendar_card`, `below_materiality`, `stale`, `late_repost`, `already_covered`, `duplicate`, `insufficient_evidence`, `source_quality`, `off_entity`, `out_of_scope`, `promotional`. Plus any of: `group:<key>`, `dup_of:<id>`, `also:<TICKER>`, `floor:<id>`, `resolves:<id>`, `ceiling_only`, `estimate`, `company_reported`, `no_figures`, `pct_is_dilution`, `pct_is_holdings`, `pct_is_units`, `alt_base`, `archive_burst`, `source_repair`, `late_first_sighting`, `event_predates_publication`, `sheet_stale`, `sheet_incomplete`, `no_sheet`, `needs_owner`.

## 11. Calibration anchors

The owner's score wins over old system scores. These anchors are frozen calibration: they test the method on the bases stated (as of 2026-10-01). Score live items on the current sheet base.

| Item | Target | Reason |
|---|---|---|
| EVLV "to Release Q3 Results on Nov 10" (owner 75, grader 10) | 75 | `floor:calendar`, earnings card (R-0060) |
| AGLT "To Host Analyst Investor Day" (grader 10) | 90 | Investor day of a newly public company; owner "arguably #1" |
| ONDS Q2 $83.8M record, guide raised to $525-550M, backlog $757M | 95 | Same-day results with a raise |
| ONDS ">$165M in New Orders" (Zenith 88; owner "more like this") | 93 | p = 30.7 on $537.5M; aggregate, company-reported |
| SSTI "Transom Completes Acquisition" (+25-NSE) | 95 | Buyout close; the 25-NSE is `dup_of` the release |
| ONDS to acquire Aran Defense (owner up) | 84 | `deal`, signed, pending |
| DPRO $10M strategic investment incl. UMAC (grader 58 "vs cash") | 80 DPRO / 76 UMAC | Strategic, covered-to-covered; judged on dilution, not cash |
| RCAT Teal SRR manufacturing-readiness selection | 84 | Core-program selection; "selected", not "award" |
| REKR Oregon DOT intent to award, $1.4M (grader 66) | 76 | p = 2.8 on $50.6M total; no pre-award discount; new state agency +5 |
| AUR-Hirschbach MOU, 500 trucks over two years | 80 | Quantified MOU, named counterparty |
| FMCSA beacon exemption naming Aurora (owner "more like this") | 85 | Final regulator decision |
| MBAI rollout expansion at Mohegan Sun (grader rejected) | 86 | Small-base customer; owner "top feedworthy item" |
| SPAI UNMAS demining contract (grader 55) | 78 | Small-base contract, named counterparty |
| SRFM / MRLN / ASST Q3 results (graders 30 / 35 / 5) | 82 | Own results are never out of scope |
| AXON Santa Fe $2.2M five-year DFR contract (owner up) | 66 | p = 0.06, below the $18.5M tiny line; `group:axon_awards` |
| AXON Riverside sheriff ~$30M body-camera request (owner up) | 72 | `pre_award`, p = 0.8, "requests" |
| RCAT TRICHON VTOL unveiled at AUSA (grader 45) | 62 | Covered flagship product, no order |
| PUSA "Set to Complete Merger, Become Nasdaq-Listed" (owner 50) | 50 | Pre-listing step |
| SATL late operating-profit piece; SERV cut retold 12 days on | 20 | `late_repost` |
| EVLV derivative settlement, April echo | 25 | `stale` legal echo |
| SPAI "to Ring the Nasdaq Opening Bell" | 10 | Ceremony only |
| "Axon Vision receives NIS 6M order"; `strategy` "MicroStrategy Q3 2020 Results" | 3 / 2 | `off_entity`; `stale` + `archive_burst` |

## 12. How to use company sheets

Before scoring, read `companies/<TICKER>.md` for every candidate ticker. Every sheet opens with a required front-matter block:
- **Identity:** `as_of`, `asset_class` (`operating`/`treasury`/`fund`), filer type, `terms`, `aliases`, subsidiaries, predecessors, `match_traps` with case flags, `removed` names.
- **Materiality:** B, `base_basis`, `alt_base` (with `owner:<date>` if set), `fx_as_of`, tiny and lead in USD, `unit_base` where orders come in units, shares outstanding, market cap; treasury and fund sheets add holdings and NAV.
- **Holders and customers:** `anchor_holders`; customers and programs with disclosure type (`release`, `call_only`, `filing_only`), revenue share, and `big` (≥5% of revenue).
- **Thesis:** `thesis_drivers` ids; `open_items` with ids and `expires_at` (e.g. REKR notes 2026-12-15, RCAT Steyr acceptance 2026-12-18, AUR 200 trucks by end-Feb 2027); `rank_high` and `noise` line ids; declared custom group keys.
- **Status events:** buyouts, de-SPACs, pending acquisitions and listing status, with dates. News about a pending target counts only after close.

The body adds ladder examples, rank-high and noise lines, and a catalyst calendar (context only). Source-coverage and collector notes belong in `sources/<TICKER>.md` for the worker, not in the grader sheet. The grader sheet keeps only the facts needed to judge freshness and choose the canonical copy.

**Precedence:**
1. **Hard rules** yield only to a sheet line marked `owner:<date>`. They are: entity verification and collisions, freshness and archive gates, status labels and never-conflate, the read-through and investee boundary, dedupe, and the output contract.
2. **Core bands** (4.2.1 table and no intermediate bands, 4.2.2, 4.2.3, the guidance and results rules, 3.01, floors, recap timing) are binding. A sheet value that differs counts only with an `owner:<date>` mark or a documented `thesis_driver` lift. Sheets cite core rules rather than restate them; a restated band with neither mark is ignored.
3. Otherwise **the more specific rule wins**: sheet base, rank-high and noise lines, raised floors, `unit_base`, anchor holders, group keys.
4. **Stale sheet:** `as_of` is more than 100 days old or before the latest print, or a primary item contradicts a status event (SSTI "pending" after close; AGLT "trades as CCXI" after its 25-NSE). Grade on the item, flag `sheet_stale` and `needs_owner`, and keep the sheet base until the owner approves a new one. Confidence ≤0.7 on scores that depend on magnitude.
5. **No sheet or no base:** score on rung, status and scope without magnitude math, null the percentage, flag `no_sheet`, and never invent a denominator. Missing front-matter fields: flag `sheet_incomplete` and skip the dependent outputs.

## Design notes

- Kept design 1's tiny-to-Digest magnitude table (the owner's procurement rule). Merged in design 2's status columns, dilution table, treasury yardsticks, form-by-form SEC grid, archive-burst definition and `owner:`-marked precedence.
- The owner wins every conflict:
  - Pre-award is never discounted.
  - Date notices are fixed at 75, the owner's EVLV grade.
  - Quantified MOUs score 60-85.
  - Small-base customers floor at 70.
  - The lead line covers company-reported orders.
  - Capital is judged by dilution.
  - Own results are never out of scope.
- v3.1 sets one meaning per identifier across all 26 names:
  - Base basis list and USD tests.
  - Unit yardstick.
  - Deal magnitude lift.
  - No bands between tiny and lead.
  - Guidance and 2.02 floors of 80.
  - One 3.01 lift.
  - Treasury bands decided once, plus a BOT NAV yardstick.
  - Venue tier and the integration tier.
  - Anchor-holder class, investee rule and collision table.
  - Required sheet front matter.
  - Anchors frozen on their stated bases.
- The "new agency" lead override is limited to federal, military and foreign national buyers, so state wins stay Digest (REKR 76).
- Dropped:
  - Tier 2/3 read-through precedents, adjacent comparables, industry playbooks and discovery lanes (Defense Tech Watch, robotaxi, AI-cloud, humanoids).
  - The sovereign-budget override.
  - Edition, Top-10, slot and trial-panel mechanics, and capacity-dependent fill.
  - Ops and collector notes (now in `sources/<TICKER>.md`).
  - Legacy profiles with `[ADD]` placeholders, and duplicate or retired precedents.
  - Edition-only reason codes, lane-pack suppress lists for covered makers, and Zenith's "results-date notice is left out".
