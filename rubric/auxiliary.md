# Auxiliary rubric: outside-company news grader

Version 1.0, 2026-11-23. Read once per run, in the auxiliary pass (grader/GRADER.md). It applies only to items claimed with `aux-claim`; core.md and the company sheets do not apply to them except where this file cites them. The analyst reads these grades on the Auxiliary Names page: a short, quick view of the outside news that matters.

**The test:** would someone who follows this outside company (or program) want to know about this event today? Score how much the event matters **to that company or program itself**, not to a covered ticker. Read-through to covered tickers is a side note (section 6) and never moves the score. **Bad news ranks like good news of the same size**: a lost contract, failed test, recall, layoff, down round or shutdown ranks like the matching win.

## 1. Entity and scope

Auxiliary items come from news-monitor sources outside the covered lane: public and private companies, subsidiaries of larger groups, government programs and contract feeds (DIU, NGA, war.gov contracts), and industry media. Each claimed item shows the entity its source routes to (`entity=`) and a status (`public`, `private`, `program`, `media`, `unknown`). The routed entity is a hint, never the answer.

- **entity:** the outside company or program the item is mainly about, by its canonical short name: "Anduril", "AeroVironment", "Waymo", "Shield AI". No legal suffix, ticker or "(private)". Where peers.md has a heading for the company, use that name without the parenthesis. Keep one spelling per company across the run.
- **Program and media sources:** the entity is the company the item is about (a war.gov contract paragraph awarding Anduril → "Anduril"). If several companies are named, take the one the item is mainly about (the largest award, else the first named). If no company is named, the entity is the program or agency ("DIU", "NGA", "Army SRR"). If no company or program is named (a media piece on policy), use the routed `entity=` name from the claim, e.g. "Industry media": the entity is never empty.
- **Subsidiaries are their own entity** (Waymo, Zoox, Wing, Torc Robotics, Boston Dynamics): size the event against the subsidiary, not the parent.
- **Covered names belong on the Coverage page.** If the item is mainly about a covered company, its subsidiary, brand or product, grade it `score: null`, `band: "covered"`, `reason:covered_name`, `covered_ticker: "<TICKER>"`, and `entity` the covered company's name. The covered universe (core.md section 1): RCAT Red Cat (Teal Drones, Blue Ops, FlightWave) · UMAC Unusual Machines (Fat Shark, Rotor Riot) · DPRO Draganfly · SPAI Safe Pro · ONDS Ondas (American Robotics, Airobotics, Sentrycs, DZYNE, Roboteam) · AXON Axon Enterprise (TASER, Dedrone, Fusus, Prepared) · KDK Kodiak AI · AUR Aurora · SERV Serve Robotics (Diligent Robotics, Vayu Robotics) · AGLT Agility Robotics · PL Planet Labs · SATL Satellogic · EVLV Evolv · XTRAF Xtract One · SYM Symbotic · PDYN Palladyne AI (Sarcos) · MRLN Merlin (Merlin Labs) · SRFM Surf Air Mobility · GRRR Gorilla Technology · MBAI MBody AI · PUSA Powerus · BOT RoboStrategy · MSTR Strategy (MicroStrategy) · ASST Strive.
- A covered company named only as one of several partners, customers or rivals does not make the item covered: grade the outside entity and record the link in `reads_through`. Watch collisions (core.md section 1): Axon Vision, Agility Global, the SpaceX Merlin engine, "strategy" the word, and Strive the word are not covered companies.
- **Off topic:** no company or program event at all: sector commentary, policy explainers, market sizing, listicles, a page that is not news, or a namesake of the routed entity. 0-15, `reason:off_topic`.

## 2. Score scale and bands

Integer 0-100, the same scale and bands as core.md section 2.

| Score | Band | Meaning on the Auxiliary Names page |
|---|---|---|
| 90-100 | **Lead** | A defining event for the company or program |
| 70-89 | **Digest** | Material: worth knowing this week |
| 40-69 | **Borderline** | True, on-entity, small |
| 0-39 | **Reject** | Not news for this company; hidden |

0-9 = data problem (wrong entity, not an item, undated backfill). 10-39 = correct but immaterial. Duplicates and covered names get `score: null`. Grade absolutely: the number of items in a run never changes a score. When a fresh, on-entity item sits between two bands, take the higher and lower the confidence.

## 3. Materiality ladder

Pick the highest rung the facts support, then apply section 4. Dollar lines test the total value of the round, contract or award in USD.

| Score | Events |
|---|---|
| **90-100** | IPO: public S-1/F-1 filing, announced confidential submission, pricing, listing, or a SPAC merger agreement or close. Acquisition of or by the company, signed or closed. Financing ≥ $100M (equity, debt or a SPAC PIPE). Contract or program award ≥ $100M. Bankruptcy, shutdown or wind-down. CEO change. A regulatory approval that opens a market (FAA type certificate, Part 135 or 121 certificate, a driverless or commercial AV permit, a BVLOS approval for commercial service). A major safety incident or recall (a fatality, a fleet grounding, a recall of a fleet or a flagship product) |
| **70-89** | Financing $20-100M. A valued contract ($10-100M) or a named major customer at any value (a national government or military service, a Fortune 500 company, a major carrier, retailer or OEM). Results with a guidance change. Flagship product launch or commercial deployment (a driverless launch, a new city or market, production start, first deliveries). A strategic partnership with a major that has substance (units, term, value or a concrete integration). Large layoffs (≥ 10% of staff, or a site closure). A notable executive change (CFO, COO, president, CTO, a founder leaving). A material regulatory milestone (a certification stage, a permit expansion, a Blue UAS or FedRAMP listing, an NHTSA investigation) |
| **40-69** | Small contracts (under $10M, or no named customer), pilots, product updates, partnerships without scale, demos or tests with news (a first flight, a test result), quarterly results with no guidance change (50-69), financing under $20M |
| **0-39** | Hiring posts, events and webinars, conference appearances, awards and recognition, marketing and customer stories, opinion, blogs and podcasts, recaps of earlier news, stock-move and price-target pieces, routine filings with no event (13G, S-8, resale prospectus, a 6-K or 8-K that adds nothing new) |

- **peers.md overrides this ladder for its company.** Look the entity up in `.zenith/rubric/peers.md` (by grep, never by reading the whole file). An event its **Matters** line names scores at least 70 (Lead when this ladder gives 90+). An event its **Usually noise** line names scores 0-39, even when this ladder would place it higher. Read both lines literally: "executive hires" is not a CEO change and "small task orders" is not a $100M award. Events in neither line follow the ladder. A company without an entry follows the ladder.
- **Big companies.** For a company many times larger than these dollar lines (Tesla, Uber, Walmart, Amazon, Alphabet, Daimler Truck, Volvo, PACCAR, Motorola Solutions, Larsen & Toubro, Equinix), grade on the ladder only the business its peers.md **Matters** line tracks. Its other news is 0-39 unless it is a company-level Lead event (CEO change, a transformative acquisition) or a guidance change (70-89).
- **Programs** (the entity is a program or agency, no company named): a new program, production decision, cancellation or restructuring ≥ $100M: 90-100. A solicitation, downselect or budget decision of $20-100M, or a rule that changes who can sell (a Blue UAS list change, a final FAA or NHTSA rule): 70-89. RFIs, industry days, small solicitations, exercises with named results: 40-69. Event notices, recruiting and recaps: 0-39. Awards go to the winning company as entity; a step that names many companies equally (a multi-vendor pool) is graded under the program.
- **Ceilings:** a single-award ceiling counts at its value (flag `ceiling_only`). A multi-award vehicle shared by many companies counts one rung lower for each awardee (Lead → Digest → Borderline), flag `multi_award`.
- **Results:** score the surprise and the change, not the print. A guidance raise, cut or withdrawal is 70-89; going-concern doubt is 90+.

## 4. Stage and certainty

State the literal stage in `why`. Never call an MOU an order, a ceiling the obligated value, a selection an award, a valuation the amount raised, or supervised operation driverless.

| Stage | Effect |
|---|---|
| Confirmed: signed, awarded, closed, launched, filed | none |
| Company-reported figure with no official record | none |
| Signed but not closed; planned deployment with a date | 0 to -5 |
| MOU, LOI, framework, unpaid pilot | one rung lower than the binding event |
| Credible outlet citing sources ("in talks", "preparing an IPO") | -10, cap 85; flag `reported` |
| Unsourced or weak outlet | cap 35 |
| Plans, pipeline, TAM, "exploring" | cap 39 |

Official records (filings, award notices, regulator orders) outrank company releases, which outrank press. Syndication adds no certainty.

## 5. Freshness and duplicates

- **The clock is first sighting**, as in core.md section 4.5: the event's age at `first_seen` (`seen_after_days`), never at grading time. Age 0-3 days: no change. 4-21 days: -5 to -10, with the original date in `why`. More than 21 days at first sighting, or an undated backfill of old posts: 0-29, `reason:stale`.
- **One event, one item.** Before marking a duplicate, run `node grader/zenith.mjs aux-recent "<entity>" 14` and use only item_ids it shows, or ids in the current auxiliary claim. The canonical copy is the company's own release, then an official record, then a wire, then media. Copies: `score: null`, `band: "duplicate"`, `reason:duplicate`, `dup_of: <item_id>` (never the item itself, never a coverage item id).
- A copy that adds a figure, customer, stage, site or date is an update: grade it on the new fact, not as a duplicate. Generic word overlap (drone, autonomy, defense, AI) is never the same event.

## 6. Read-through (side note)

`reads_through` lists the covered tickers on the entity's peers.md **Reads through to** line whose link this item touches: the product, program, customer or rivalry that the line names. Use the line's direction for each ticker, written `"+"`, `"-"` or `"±"` (peers.md prints minus as "−"; write an ASCII hyphen). Otherwise `[]`: always for an entity with no entry or with "none direct", and never from memory. Read-through never raises or lowers the score, and `why` never mentions it.

## 7. Sources

Grade from the title and the excerpt the claim shows. `EXCERPT (feed)` is the text the source's feed carried: the release itself for a company source, the article for a media source. Set `read_source: true` when the facts you graded on are in it. `EXCERPT: none` means the feed carried no text; auxiliary pages are never fetched for you. Open the URL only when the item would be a Lead and the title and excerpt lack the fact that makes it one (the amount, the stage, the role); if it cannot be opened, grade what you have, flag `no_figures` and keep confidence ≤ 0.5. A title that cannot place the event on the ladder even after that: 0-39, `reason:insufficient_evidence`, confidence ≤ 0.4.

## 8. Output contract

One JSON object per claimed item, in a JSON array, nothing else:

```json
[{"item_id":4812,"entity":"AeroVironment","score":91,"band":"lead","event_type":"contract",
  "why":"Army awarded AeroVironment a single-award Switchblade IDIQ, $990M ceiling, five years.",
  "reads_through":[{"ticker":"PDYN","direction":"-"}],"flags":["reason:material","ceiling_only"],
  "confidence":0.85,"read_source":true,"dup_of":null,"covered_ticker":null},
 {"item_id":4813,"entity":"AeroVironment","score":null,"band":"duplicate","event_type":"duplicate",
  "why":"Trade-press copy of the Army Switchblade IDIQ release; no new facts.",
  "reads_through":[],"flags":["reason:duplicate"],"confidence":0.9,"read_source":true,"dup_of":4812,"covered_ticker":null},
 {"item_id":4814,"entity":"Red Cat","score":null,"band":"covered","event_type":"covered",
  "why":"Contract notice for Teal Drones Black Widow systems.",
  "reads_through":[],"flags":["reason:covered_name"],"confidence":0.9,"read_source":true,"dup_of":null,"covered_ticker":"RCAT"}]
```

- **item_id:** the id the claim printed. Every claimed item gets exactly one object.
- **entity:** section 1, 1-80 characters, never empty.
- **score:** integer 0-100; null only for `duplicate` and `covered`.
- **band:** `lead` 90-100, `digest` 70-89, `borderline` 40-69, `reject` 0-39, matching the score exactly; `duplicate` or `covered` with a null score.
- **event_type** (≤ 40 characters): `ipo`, `acquisition`, `financing`, `contract`, `program_award`, `program`, `bankruptcy`, `exec_change`, `regulatory`, `safety_incident`, `recall`, `results`, `guidance`, `product`, `deployment`, `partnership`, `pilot`, `layoffs`, `legal`, `filing_other`, `hiring`, `event`, `recognition`, `marketing`, `commentary`, `duplicate`, `covered`.
- **why:** ≤ 25 words (the API stops at 400 characters): what happened, the literal stage, figures with their labels. Facts from the source only; no implications and no covered tickers.
- **reads_through:** section 6, `[]` when none.
- **flags:** exactly one `reason:` flag, chosen by the table below. Optional extras: `ceiling_only`, `multi_award`, `reported`, `no_figures`.
- **confidence:** 0-1, the joint certainty of entity, stage and figures. ≤ 0.5 when `read_source` is false; ≤ 0.6 when the entity or the date is uncertain.
- **read_source:** true only when the facts you graded on are in the excerpt shown or a page you opened.
- **dup_of:** the canonical auxiliary item id for a duplicate, else null.
- **covered_ticker:** the covered ticker for `reason:covered_name`, else null.

| `reason:` | Use for | Score |
|---|---|---|
| `material` | An event at 70+ | 70-100 |
| `minor` | True, on-entity, small (the 40-69 rung) | 40-69 |
| `noise` | Hiring, recaps, opinion, stock-move pieces, routine filings | 10-39 |
| `promotional` | Awards, recognition, events, webinars, conference appearances, sponsorships, marketing, customer stories | 10-25 |
| `stale` | First seen more than 21 days after the event; undated backfill | 0-29 |
| `off_topic` | No company or program event; wrong entity | 0-15 |
| `insufficient_evidence` | The event cannot be placed on the ladder (section 7) | 0-39 |
| `duplicate` | Section 5 | null, band `duplicate`, `dup_of` |
| `covered_name` | Mainly about a covered company (section 1) | null, band `covered`, `covered_ticker` |

## 9. Examples (illustrative)

| Item | Grade | Reason |
|---|---|---|
| Anduril closes a $2.5B round | 95 `material` | Financing ≥ $100M |
| Skydio wins a $40M Army order for X10D | 84 `material` | Valued contract; peers.md Matters (Army SRR/X10D orders) |
| Shield AI CEO steps down | 92 `material` | CEO change |
| May Mobility SPAC merger closes, lists on Nasdaq | 94 `material` | Listing |
| Waymo starts paid driverless rides in a new city | 85 `material` | Commercial deployment; peers.md Matters (new driverless cities) |
| Waymo adds a rider app feature | 20 `noise` | peers.md Usually noise (rider and app features) |
| AeroVironment quarterly results, guidance raised | 82 `material` | Results with a guidance change |
| Einride 6-K with no new facts | 20 `noise` | Routine filing |
| DIU opens a $5M solicitation, no company named | 48 `minor` | Program entity "DIU", small solicitation |
| Zipline named to an innovation list | 12 `promotional` | Recognition |
| Media piece on drone policy naming no company | 10 `off_topic` | No company or program event; entity is the routed name ("Industry media") |
| war.gov paragraph awarding Red Cat's Teal Drones | null `covered_name` | `covered_ticker: "RCAT"` |
