---
ticker: SERV
name: Serve Robotics Inc.
as_of: 2026-11-18
asset_class: operating
filer: domestic (10-K, 10-Q, 8-K); legal name "Serve Robotics Inc. /DE/"; CIK 0001832483; FY ends Dec 31; EGC and smaller reporting company
listing: Nasdaq Capital Market (SERV)
source_keys: [serve, edgar_serv]
base_usd: 12000000
base_basis: "FY2026 revenue guidance $12M, raised 2026-11-05 from $9-10M (8-K 2.02 Ex.99.1)"
alt_base: false   # 9M 2026 revenue $9.06M; Q3 $2.84M x 4 = $11.4M. Both are below the guidance base, so the guidance base stands
small_base: true  # B < $25M, so the core 4.2.1 small-base rule applies
tiny_usd: 120000      # 1% of B, because B <= $100M
lead_usd: 1200000     # 10% of B
fx_as_of: n/a         # base is in USD. Gold Coast figures may be in AUD: convert at the event-date rate
shares_outstanding: 87880000   # 10-Q cover, 2026-11-03 (87.56M at 2026-09-30)
shares_basis_date: 2026-11-03
dilution_5pct_shares: 4390000
market_cap_usd_approx: 214000000   # $2.44 close on 2026-11-17 x 87.88M; Nov 2026 closes $2.32-3.39
liquidity_usd: 198000000           # $50.8M cash + $147.2M short-term securities, 2026-09-30; no debt
atm_remaining_usd: 72400000        # 2026 Sales Agreement ($150M, 2026-05-11), at 2026-09-30
terms: ["Serve Robotics", "$SERV", "Serve Robotics Inc. /DE/", "Patricia Acquisition Corp.", "Diligent Robotics", "Moxi", "Moxi 2.0", "Vebu", "Serve Kitchen Robotics", "Voysys", "Vayu Robotics", "Serve Physical AI Services", "Serve Link", "ServLink", "Serve Data Curator", "AV Delivery Developer Portal", "developer.serverobotics.com", "Gen3", "Serve Advertising"]
aliases: {"Serve": "only with 'Robotics', '$SERV', or a sidewalk/delivery-robot context", "Diligent": "only as 'Diligent Robotics' or with Moxi/hospital robot context"}
match_traps:
  - {term: "serve", case: insensitive, rule: "a common verb; reject unless robot context"}
  - {term: "SERV", case: sensitive, rule: "reject inside procurement abbreviations, e.g. 'ELECTRICAL SERV'"}
  - {term: "Diligent", case: insensitive, rule: "Diligent Corp (board software) is off_entity"}
  - {term: "Moxi", case: insensitive, rule: "Moxy Hotels and the skate brand are off_entity"}
  - {term: "Vayu", case: insensitive, rule: "a common Hindi word; needs Vayu Robotics"}
  - {term: "Servi", case: insensitive, rule: "Bear Robotics rival product; off_entity"}
  - {term: "Wonder|Characters|Chomp|Beacon", case: sensitive, rule: "needs a Serve robot context"}
  - {term: "Phantom Auto", case: insensitive, rule: "only its IP was bought; shutdown stories are off_entity"}
removed: ["Phantom Auto (not an alias)"]
thesis_drivers: [uber_replacement, platform_ramp, cash_runway, unit_economics, new_lines, international]
open_items:
  - {id: uber_end, text: "Uber Eats agreement runs 'through part of Q1' 2027 (Q3 call): official extension, non-renewal or wind-down terms", expires_at: 2027-03-31}
  - {id: fy27_guidance, text: "First 2027 revenue, opex and capex guidance (none given 2026-11-05)", expires_at: 2027-03-31}
  - {id: vayu_prsu, text: "Vayu PRSU operational milestone due 2026-12-31 (880,001 employee + 560,000 non-employee units): met or missed", expires_at: 2027-03-31}
  - {id: vancouver, text: "British Columbia approval of the Vancouver pilot (city council approved; provincial pending)", expires_at: 2027-06-30}   # sheet default expiry; needs_owner to confirm
group_keys: [earnings_calendar, deployment_wave_SERV, serv_moxi_hospitals]
---

# SERV — Serve Robotics Inc.
_Researched 2026-11-18. Q3 2026 was reported 2026-11-05: 8-K 2.02 and the 10-Q came out the same day. The next print is Q4/FY2026, with no date set yet. FY2025 was reported 2026-03-11 (8-K) and the 10-K followed on 2026-03-12, so expect the next print around mid-March 2027. The date notice usually comes about 2 weeks before the print (2026-04-21, 07-23 and 10-22 for the 2026 prints). The stock closed at $2.44 on 2026-11-17, which puts market cap at about $214M, close to the $198M of cash and securities. RSU sell-to-cover Form 4s on 2026-11-16 were at $2.38. The front matter above holds the machine-readable fields. Core rubric v3.0 governs everything this sheet does not restate. Unless a line here is marked `owner:<date>` or `thesis lift`, the core band applies._

## Identity & matching
- **Legal and filer name:** "Serve Robotics Inc. /DE/" (formerly Patricia Acquisition Corp.). Spun off from Uber (Postmates X) in 2021.
- **Subsidiaries and brands that count as SERV:**
  - **Diligent Robotics** ("a Serve Robotics company"; merger agreement 2026-01-19, closed 2026-01-27, $25.7M fair value) and its **Moxi / Moxi 2.0** hospital robots.
  - **Vebu, Inc.** (kitchen automation; closed 2026-02-17 through merger sub Serve Kitchen Robotics Inc.).
  - **Voysys AB** (Sweden; bought 2025-04-01 together with Phantom Auto's patents).
  - **Vayu Robotics** (closed 2025-08-15).
  - Product and program names: **Serve Advertising / Characters / "Chomp"**, **Beacon** (a countertop alert device for merchants), the **Gen3** robot, micro-depots (Miami), and **Serve Physical AI Services**, launched 2026-11-05. Physical AI Services covers **Serve Link** ("ServLink" on the call), Serve Data Curator and a data catalog. The **AV Delivery Developer Portal** (developer.serverobotics.com) launched 2026-11-11.
- **Context guards:** see `match_traps` in the front matter. Bare "Serve" is a verb, so require "Serve Robotics", "$SERV", or a sidewalk/delivery-robot context.
- **Reject as `off_entity` (0-5):**
  - Bear Robotics "Servi".
  - "SERV" inside procurement abbreviations.
  - Phantom Auto shutdown stories.
  - Generic "serve" headlines.
  - Uber, DoorDash or Grubhub news that never mentions Serve robots. Section "Competitors & read-through" covers the exception.
- **Cross-sheet collisions:** none with other covered names are known. "Beacon", "Characters" and "Chomp" are generic words. Check the core §1 collision table before scoring.

## What the stock trades on
1. **`uber_replacement`: replacing Uber Eats volume.**
   - On the Q3 call (2026-11-05) the CEO said the Uber contract runs "through part of Q1 next year".
   - Lower Uber Eats volume drove the 2026-08-06 guidance cut. The 10-Q expects reduced demand through the rest of 2026.
   - Press (Axios 2026-08-17; Benzinga) reports that Uber exited its remaining stake in Q2 2026 and that Serve does not plan to renew. Treat these as `reported`, not confirmed terms.
2. **`platform_ramp`: the DoorDash and Grubhub ramp.**
   - In Q3, daily delivery volume on the new platforms tripled and their merchant count grew 2.5x (call).
   - Their combined share of all deliveries more than doubled from Q2 (call).
   - New metros: DC and San Jose launched 2026-08-17.
3. **`cash_runway`: cash burn against a cash pile close to market cap.**
   - Liquidity is $198.0M. Operating cash burn for the first nine months was $123.5M.
   - Q3 adjusted EBITDA was −$42.2M. FY26 non-GAAP opex guidance is $150M.
   - The ATM has $72.4M left. At $2.44 that is about 29.7M shares, or d ≈ 33.8% if fully drawn.
4. **`unit_economics`: revenue mix and unit economics.**
   - Recurring revenue was 69% of Q3 revenue.
   - Branding revenue grew nearly 80% from Q2.
   - Fleet margin improved by more than 100 points from Q2.
   - FY26 cost of revenue is guided at $44-48M and capex at $15-17M.
5. **`new_lines`: new revenue lines.**
   - Moxi is in 27 hospitals, with 12 multi-year extensions and 4 new hospitals YTD.
   - Physical AI Services has a launch customer, Bedrock Robotics, and no published pricing.
6. **`international`: international launches.**
   - The Gold Coast (Australia) is live.
   - Vancouver's city council approved a pilot; provincial approval is pending.

## Materiality bases
- **Revenue base B = $12M:** FY2026 guidance, raised 2026-11-05 from $9-10M ([8-K Ex.99.1](https://www.sec.gov/Archives/edgar/data/1832483/000183248326000048/serv-20260930_ex991earning.htm)).
  - 9M 2026 revenue was $9.06M.
  - Q3 revenue was $2.84M: fleet services $2.58M and software $0.25M.
  - Implied Q4 is about $2.9M.
- **Small-base name (B < $25M):** core 4.2.1 applies. A new, repeat or expanded **named paying customer**, contract or deployment scores ≥70 without a value (`floor:small_base`). Who counts as a paying customer comes from the 10-Q revenue note ([10-Q](https://www.sec.gov/Archives/edgar/data/1832483/000183248326000051/serv-20260930.htm)): outdoor delivery runs "through partnerships with platforms to fulfill orders"; indoor delivery is paid by healthcare organizations; branding fees are paid by the brands shown on robots; software fees are paid by platform users.
  - **Paying customers (small_base applies, ≥70):**
    - Delivery platforms (Uber Eats, DoorDash, Grubhub/Wonder, or any new platform).
    - Hospitals and health systems (Moxi).
    - Branding or advertising customers named with a campaign.
    - Physical AI Services and software customers (Bedrock).
    - Paid pilots.
  - **Not paying customers (55-65, `reason:below_materiality`, no small_base floor):**
    - Restaurant or retail merchants added on a platform (White Castle, Talkin' Tacos), because the platform pays Serve, not the merchant.
    - Unpaid pilots and new verticals with no volume or fee stated (NoScrubs).
    - A merchant that becomes a named branding customer is paying; score it as branding.
- **RPO:** $6.08M ($3.79M current) at 2026-09-30, against none at 2025-12-31.
- **Customer concentration:** Customer A was 10% of Q3 revenue (43% in Q3 2025) and 11% of 9M revenue. Customer B was 12% of 9M revenue. Neither is named; do not guess. A newly named 10% customer is the `results` rung.
- **Liquidity:** $50.8M cash and $147.2M short-term securities. No debt. 87.56M shares at 2026-09-30; 87.88M on the 10-Q cover (2026-11-03).
- **ATM:** the 2026 Sales Agreement ($150M; Evercore, Guggenheim, Oppenheimer, Northland, Wedbush; 2026-05-11).
  - By 2026-09-30 it had sold 8.54M shares at $9.08, leaving **$72.4M remaining**.
  - The 2025 Cantor ATM was terminated 2026-05-07 (8-K 1.02).
- **Dollar lines** (test total contract value, per core 4.2.1):
  - Tiny: below **$120K**.
  - Lead: **$1.2M or more** (p ≥10).
  - Most SERV deals carry no dollar value. A binding named-counterparty order with no value scores 70-78, or ≥70 under small_base. A missing figure is never a discount.
- **Capital yardstick (core 4.2.2):**
  - Measure dilution d against 87.88M shares: 5% ≈ 4.39M shares, 10% ≈ 8.79M, 20% ≈ 17.6M.
  - ATM capacity counts as capacity ÷ last price.
  - Never judge a raise against cash on hand.

## Event ladder for this name
Core rungs and bands apply. The lines below are SERV examples. Anything above the core default is marked `thesis lift`.
- **Lead (90-100):**
  - Results with a guidance change of ≥10% at the midpoint (core 3), e.g. "Serve Robotics Announces Third Quarter 2026 Results", 2026-11-05: revenue guidance raised from $9-10M to $12M, +26% at the midpoint ([IR](https://investors.serverobotics.com/news-releases/news-release-details/serve-robotics-announces-third-quarter-2026-results)). Opex set at $150M is the top of August's $140-150M range, not a change.
  - A guidance cut, e.g. "Serve Robotics Announces Second Quarter 2026 Results", 2026-08-06: about $26M cut to $9-10M, opex to $140-150M ([IR](https://investors.serverobotics.com/news-releases/news-release-details/serve-robotics-announces-second-quarter-2026-results)).
  - Official Uber Eats terms (non-renewal, extension or wind-down date): resolves `uber_end`, floor 85 (`thesis lift`, uber_replacement).
  - A new delivery platform signed: `money`, 90+ (`thesis lift`, platform_ramp; first deal with a new platform is a first-production-scale channel).
  - Buying a company of size, or being bought (core `control` / `deal`).
  - Offerings sized by core 4.2.2: d ≥20% scores 85-95. A full ATM draw at current prices would be about 34%.
  - First going-concern language (`floor:existence` 85+).
- **Digest (70-89):**
  - A new country launch, e.g. "Serve Robotics and DoorDash launch Australia's First Footpath Delivery Robots on the Gold Coast", 2026-10-29 ([Medianet](https://newshub.medianet.com.au/2026/10/serve-robotics-and-doordash-launch-australias-first-footpath-delivery-robots-on-the-gold-coast/179064/)). Floor 80 (`thesis lift`, international).
  - A new U.S. metro launch with a named platform (DC and San Jose, 2026-08-17): `proof`, 70-85, `group:deployment_wave_SERV` when several cities launch together.
  - A new platform channel, e.g. "Serve Launches Robot Delivery with Wonder, Adding Grubhub to Its Growing Delivery Network", 2026-08-17 ([IR](https://investors.serverobotics.com/news-releases/news-release-details/serve-launches-robot-delivery-wonder-adding-grubhub-its-growing)).
  - A named paying customer on a platform business, e.g. "Serve Robotics Launches Physical AI Services, Opening Technology Behind Its Robot Fleets…", 2026-11-05, with Bedrock named (`floor:small_base`).
  - New hospital systems or Moxi renewals and expansions with names or counts: `floor:small_base`, `group:serv_moxi_hospitals`.
  - Off-cycle 8-K 2.02 with new figures, e.g. the 2026-10-05 deck adding FY26 cost-of-revenue guidance of $44-48M: `floor:results` 80 and `floor:guidance` 80.
  - CEO (Kashani) or CFO (Read) in or out: `floor:neo_ceo_cfo` 75. President/COO (Parang): `floor:neo` 70.
  - A new ATM or S-3 with takedown capacity: core 4.2.2. The 2026-05-11 $150M ATM was ≥20% of market cap, so 75-85.
  - Bolt-on acquisitions signed or closed (Diligent 2026-01-20/27; Vebu 2026-02-17): `floor:deal_signed` 75.
  - 8.01 volume or demand updates on a platform (e.g. the 2026-08-17 Uber volume 8.01): 70+ (`thesis lift`, uber_replacement / platform_ramp).
  - Earnings-date notice: fixed 75, `floor:calendar`, `group:earnings_calendar`.
- **Borderline (40-69):**
  - Single merchant adds on a platform, e.g. "Serve Robotics and White Castle Launch Autonomous Delivery via Uber Eats", 2026-03-11: 55-65. Merchants are not paying customers (see Materiality bases).
  - New verticals with no volume or fee, e.g. the NoScrubs laundry pilot in LA, 2026-06-02: 55-65, plus 5 if stated as paid (then small_base applies).
  - The developer portal: "Serve Robotics Opens Its Robot Delivery Network for Anyone to Build On", 2026-11-11. Access is approval-gated, with no customers or pricing: `product`, 50-60.
  - City pilot approvals before launch where a further approval is pending (Vancouver council): 55-65. A final provincial or city permit naming Serve is `permission`, 70+, and resolves `vancouver`.
  - Other officer changes (Armenta, Chief Software & Data Officer; Abraham, Chief Hardware & Manufacturing Officer):
    - 70-85 if the latest proxy lists them as named executive officers.
    - Otherwise 25-50.
    - Confirm the role from the filing text.
- **Reject (<40):**
  - Board changes, e.g. Andreas Lieber appointed 2026-06-22 to replace Sarfraz Maredia (8-K 5.02, 2026-06-24): director-only, 25-45 per core 5.02.
  - Conference attendance, e.g. "Serve Robotics to Present at Evercore ISI's 5th Annual Automation Tech & Physical AI Conference", 2026-10-05: `reason:promotional`.
  - Art and marketing stunts, e.g. Moving Canvas public art, 2026-06-22.
  - Trade-show demos, e.g. the NVIDIA GTC conversational robot, 2026-04-07.
  - IR bio pages.
  - Form 4 and 144 sell-to-cover filings.
  - Late recaps and retellings, per the core §7 `late_repost` timing.
  - Proxy and AGM routine.
  - A 10-Q filed alongside a same-day results release is a duplicate. It ranks only as an update when it adds facts: the customer-concentration table, RPO, ATM remaining, going concern or subsequent events (core §5).

## Always surface (floors)
Core §6 floors apply as written. Sheet-specific lifts, each a documented `thesis lift`:
- 8-K **1.01/1.02** naming Uber, DoorDash, Grubhub/Wonder or Magna: floor 85 (uber_replacement, platform_ramp; Magna is the Gen3 contract manufacturer). A 1.02 that terminates an ATM is a capital item under core 4.2.2, not a contract loss. When a replacement ATM is filed, the termination is canonical with the new ATM.
- Any official statement on **Uber Eats** contract status before or at its Q1 2027 end: floor 85, `resolves:uber_end`.
- New **country** launches: floor 80 (international).
- **8.01** platform volume or demand updates: floor 70 (uber_replacement, platform_ramp).
- **10-Q/10-K figures** that add a new customer-concentration line, an RPO change, an ATM-remaining change, or going concern: rank as an update (60-85), or by core floors (going concern `floor:existence`).
- Core floors restated for clarity:
  - 8-K **2.02**, including off-cycle preliminary figures: `floor:results` 80.
  - New or changed guidance lines: `floor:guidance` 80.
  - Earnings-date notices: fixed 75, `group:earnings_calendar`.

## Noise patterns
From news-monitor keys `serve` and `edgar_serv` (all rows notified=1):
- **EDGAR archive burst (core §8, R-0050).** On 2026-08-31T21:21, 40 `edgar_serv` rows arrived at once, with event dates from 2025-01-07 to 2026-08-17: DEF 14A, 424B3, S-3, old 8-Ks and 10-Qs.
  - Gate each row on its own event date.
  - Rows more than 21 days old score 0-9 with `reason:stale`, `archive_burst` and `source_repair`.
  - Rows within 21 days take core 4.5 timeliness.
- **IR backfill burst.** On 2026-07-09T18:30, 10 `serve` rows arrived at once.
  - Six were real releases dated 2026-03-11 to 2026-07-01 (Q1 results, White Castle, NoScrubs, Lieber, Moving Canvas, GTC), plus the 04-21 date notice.
  - Gate each on its own event date the same way: >21 days old is stale and archived; 4-21 days takes −5 to −10, with the original date in `why`.
- **Bare form titles.** E.g. "Serve Robotics Inc. /DE/: 8-K filed 2026-11-05" and "…10-Q filed 2026-11-05", each arriving 1-30 minutes after the IR results release.
  - The IR release is canonical. The filing gets `score: null` with `dup_of:<release id>`, unless it adds facts.
  - Never print a bare "filed" line.
- **IR crawl junk.** Analyst, board and management bio pages ("Taylor Manley", "Steve Webb", "Andreas Lieber" twice as /andreas-lieber and /andreas-lieber-0, "Jeffrey Cohen") on 2026-07-09 and 2026-07-17. Score 0-5 with `reason:source_quality` and `source_repair`.
- **Promotional items.** Conference notices, Moving Canvas, the GTC demo: 0-20, `reason:promotional` (core §7).
- **Dual-tracked conference and 8-K days.** On 2026-10-05 the Evercore conference PR (noise, 13:31) and an 8-K 2.02 with new cost-of-revenue guidance (signal, 20:13) landed the same day. Open the 8-K and grade it separately; the PR's score must not carry over to it.

## Catalyst calendar
- **Q1 2027 (`uber_end`, expires 2027-03-31):** the Uber Eats agreement ends. Watch for an extension, a wind-down, or chains moving to DoorDash or Grubhub.
- **About mid-March 2027 (`fy27_guidance`):** Q4/FY2026 results and the 10-K. The date notice comes about 2 weeks earlier. Expect the first 2027 revenue, opex and capex guidance.
- **2026-12-31 (`vayu_prsu`):** milestone date for the Vayu PRSUs. Whether the target was met will likely first appear in the 10-K.
- **Q4 2026 to 2027:**
  - Gold Coast: more restaurants "in the coming weeks". Reuters reported about $500,000 to be invested in the region over the next year ([Reuters via KFGO](https://kfgo.com/?p=1369086)). Label the currency as the source does.
  - A possible first Canadian city: Vancouver, pending provincial approval (`vancouver`).
  - The deck lists "2027+" potential markets: Canada, UK, Spain, Japan, Germany, Netherlands. This is `prospective`, capped at 39 until a launch.
- **Ongoing:**
  - ATM draws ($72.4M left), visible in the 10-Q equity rollforwards.
  - Diligent earnout (up to 366,332 shares).
  - Vebu earnout.
  - RSU sell-to-cover Form 4s.
- **About June 2027:** annual meeting (8-K 5.07; the 2026 meeting was reported 2026-06-18). Routine unless a share-authorization or reverse-split proposal appears, which scores 45-65 under core 5.07. A reverse split itself (5.03) scores 55-70.

## Customers, programs, agencies & counterparties
| Counterparty | Role | Disclosure | big (≥5% of revenue) |
|---|---|---|---|
| Uber / Uber Eats | Delivery platform; contract ends Q1 2027. Uber's last 13D/A (2025-09-23) showed 3.36% | release; end date `call_only` | unknown (Customers A and B are unnamed; do not map) |
| DoorDash | Delivery platform since 2025-10 and the main growth channel. Exclusive partner on the Gold Coast (call) and launch partner in DC and San Jose | release | unknown |
| Wonder / Grubhub | Delivery platform since 2026-08-17 (Chicago, LA, Alexandria VA). Grubhub daily deliveries grew "something like 60-70%" in the month before the Q3 call ([transcript](https://www.earningswhispers.com/transcript/SERV/Q32026)) | release; growth `call_only` | unknown |
| Hospitals (Moxi): Children's Hospital Los Angeles, Endeavor Health Edward Hospital, Providence Saint John's Health Center; 27 in total | Paying healthcare customers | release / health-system press | no |
| Bedrock Robotics | Physical AI Services launch customer (Serve Link); paying status not stated | release | no |
| Merchants: White Castle (Uber Eats), Talkin' Tacos (DC), NoScrubs (LA laundry) | Platform merchants, not paying customers (see Materiality bases) | release | no |
| Griffith University | Hosts the Gold Coast depot | press | no |
| Vancouver city council, British Columbia, Gold Coast councils | Permitting authorities | `call_only` / council records | n/a |
| Magna International | Gen3 contract manufacturer | release / filing | n/a (supplier) |
| NVIDIA | Supplier: Jetson Orin; RTX A2000 on Moxi | release | n/a (supplier) |
| Khosla Ventures | Holds 4.0M warrants at $10.36 from the Vayu deal | filing | n/a |

## Competitors & read-through
Core §9 governs. Only these patterns count for SERV:
- **A rival wins at a sheet key account in Serve's category.** Starship Technologies, Coco Robotics or Avride added by Uber Eats, DoorDash or Grubhub in a Serve metro (LA, Miami, Dallas, Atlanta, Chicago, DC, San Jose, Gold Coast) scores 50-69 as a possible loss. If the source confirms the rival replaces Serve, score it as `money` bad news, 70+.
- **DoorDash rolls out its own robot (Dot) at scale.** DoorDash is a sheet customer acting on a product in Serve's category (core §9.2), so grade it 50-69. If the source ties it to replacing Serve, score it as a loss, 70+.
- **Everything else is `out_of_scope` (0-15).** That includes rival financings, rival launches outside Serve metros, Uber or DoorDash corporate news with no robot-delivery action, and sector pieces.
- **Published text** names Serve only when the source does ("DoorDash expands Dot robot to Miami", not "Serve loses Miami").

## Source coverage gaps
Collector and ops notes (feeds to add, crawler fixes) live in the worker's `sources/SERV.md`, not here. Grader-facing facts for freshness and canonical choice:
- **Off-feed primary events.** The Gold Coast launch (2026-10-29) came via Medianet, Reuters and DoorDash AU, never `serve` or `edgar_serv`. A press or partner copy can be canonical when no company release is in the window. If it first surfaces more than 21 days after the event, use the core §8 `late_first_sighting` exception (−15, cap 79).
- **Insider and registration filings.** Form 4, Form 144 and S-8 filings (S-8 2026-10-01; Form 144s 2026-11-16) are not in `edgar_serv`. Their absence is never `insufficient_evidence`.
- **Uber-side disclosures.** Uber's stake exit was disclosed only in Uber's Q2 filing (2026-08-07). Uber filings naming Serve count under core §9.1.
- **Call-only facts.** The Uber end date, Bedrock's use case, Vancouver and the platform share all came from the Q3 call. Grade them as `mgmt_claim` (−15, cap 75) unless a release or filing confirms them.
- **IR feed hygiene.** Only `/news-releases/` paths under `serve` are events. Bio and profile pages are `source_quality`.

## Grader notes
- **Results day.** The IR release, 8-K Ex.99.1, deck (Ex.99.2) and 10-Q all land within about 30 minutes. Make the release canonical. Reopen the filings only for new facts: the customer table, RPO, ATM remaining.
- **Footprint figures conflict.**
  - The Q3 deck says "44 U.S. cities", "14 states", "150+ neighborhoods", "2,000" sidewalk robots plus "100 Moxi", and "2,100+ deployed".
  - The FY25 release said "20 cities across 6 major metropolitan areas".
  - Daily active robots averaged 917 in Q3.
  - Quote each figure with the source's label. Never call deployed robots the active fleet.
- **Revenue labels.** "Fleet services" includes delivery, branding and healthcare. Compare against the prior quarter, which already includes Diligent: Q3 fell 12% from Q2 ($3.24M to $2.84M), while the release leads with +313% year over year.
- **Guidance labels.**
  - Revenue guidance is GAAP.
  - Opex guidance is **non-GAAP**: $150M, against about $208M GAAP, which includes about $50M SBC and $8M amortization.
  - The Q3 release compares $150M with January's $160-170M. Against August's $140-150M it is the top of the range, not a cut.
- **Units and currency.** Gold Coast figures may be in AUD. Label the currency and convert at the event-date rate before any magnitude test.
- **Insider sales.** The Form 4 "S" rows on 2026-11-16 (Kashani, Parang, Read; e.g. 7,744 shares at $2.38) are RSU tax-withholding sales per footnote F1. Treat them like code F: 0-10, not items. A code S without the withholding footnote follows core §5.
- **Wording.** Serve describes launches as a "network", a "platform" or "opens". Score the developer portal and Physical AI Services on named paying customers or pricing, not adjectives.
- **Stale facts in older profiles.** Do not reuse the "~$26M" guidance, "$160-170M opex", "6 metros", "Uber Eats only", or the Phantom Auto alias.
- **Verification note (2026-11-18).** The paying-customer split above comes from the 10-Q revenue note (platforms, healthcare organizations, branding customers, software users). The web-search budget ran out during the revision. No other new facts were added, and the rest of the sheet is carried over from the 2026-11-18 research.
