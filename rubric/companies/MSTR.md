---
ticker: MSTR
as_of: 2026-11-18
fx_as_of: 2026-11-17   # BTC ~ $68,887 (fees-incl. average purchase price, 8-K 2026-11-16); MSTR close $96.50; convert EUR (STRE) at the event-date rate
asset_class: treasury
filer: domestic_10k   # 10-K, 10-Q, 8-K, DEF 14A, DEFA14A, 424B5, Forms 3/4/144; CIK 0001050446
base: 850849          # BTC held
base_unit: BTC
base_basis: "8-K 2026-11-16, holdings at 2026-11-15; aggregate cost $64.20B, average $75,452"
alt_base: true        # treasury name: revenue-base lines of core 4.2.1 do not apply except to software deals
alt_bases:
  market_cap_usd: 40.8e9        # 422.3M basic shares x $96.50
  btc_value_usd: 58.6e9         # 850,849 x ~$68,887
  preferred_liq_pref_usd: 14.11e9   # 2026-09-30
  convert_principal_usd: 6.71e9
  software_revenue_usd: 495e6   # LTM: 9M 2026 $372.1M + Q4 2025 $123.0M
lines_usd:
  btc_buy_h1pct: 586e6          # 8,508 BTC = 1% of holdings
  btc_buy_h5pct: 2.93e9         # 42,542 BTC = 5% of holdings
  dilution_d5pct: 2.04e9        # ~21.1M Class A shares
  dilution_d10pct: 4.08e9       # ~42.2M shares
  dilution_d20pct: 8.15e9       # ~84.5M shares
  buyback_5pct_mcap: 2.04e9
  software_tiny: 2.5e6          # 0.5% of $495M
  software_lead: 49.5e6         # 10% of $495M
shares:
  class_a: 402.7e6              # 10-Q cover, 2026-10-25
  class_b: 19.6e6
  basic: 422.3e6
  note: "ATM issuance adds shares weekly (2,087,040 Class A sold Nov 9-15); use the 10-Q cover count until the next 10-Q/10-K"
terms: ["Strategy Inc", "Strategy (MSTR)", "MSTR", "MicroStrategy", "MacroStrategy LLC", "STRC", "STRF", "STRK", "STRD", "STRE", "Stretch", "Strife", "Strike", "Stride", "Stream", "Strategy One", "Strategy Mosaic", "Mosaic Sentinel", "HyperIntelligence", "Saylor"]
aliases_need_context:
  - {term: "Strategy", case_sensitive: true, rule: "only as 'Strategy Inc', 'Strategy (MSTR)', \"Strategy's bitcoin\", or with Saylor, Le or a preferred ticker in the same item"}
  - {term: "Saylor", case_sensitive: true, rule: "only alongside Strategy, MSTR or bitcoin"}
  - {term: "MicroStrategy", case_sensitive: false, rule: "matches; gate on event date, most is archive"}
  - {term: "Strike|Stride|Stream|Stretch|Strife", case_sensitive: true, rule: "only with ticker (STRK/STRD/STRE/STRC/STRF) or Strategy context"}
match_traps:
  - {term: "strategy", case_sensitive: false, note: "common word"}
  - {term: "RoboStrategy", note: "BOT, covered separately"}
  - {term: "MacroStrategy Partnership", note: "UK research firm"}
  - {term: "Strategy&|Strategy Analytics", note: "PwC unit; research firm"}
  - {term: "Strike", note: "bitcoin payments app"}
  - {term: "Stride Inc|LRN", note: "education company"}
  - {term: "Saylor Academy", note: "nonprofit"}
  - {term: "Metaplanet|Twenty One|XXI|Bitmine", note: "treasury peers; only if MSTR is a named counterparty"}
  - {term: "Strive|ASST", note: "own covered name; a Strive item involving MSTR securities counts for both"}
cross_sheet_collisions:
  - {term: "Andrew Kang", other_sheet: BOT, rule: "assign to MSTR only with Strategy/MSTR context in the item"}
  - {term: "Shirish Jajodia", other_sheet: ASST, rule: "assign to MSTR only with Strategy/MSTR context in the item"}
  - {term: "Strategy / RoboStrategy", other_sheet: BOT}
thesis_drivers:
  - {id: capital_access_mnav, desc: "ability to sell common or preferred above BTC NAV; company-stated mNAV and ATM triggers"}
  - {id: strc_digital_credit, desc: "STRC rate, price near $100, preferred dividend coverage, STRC repurchases, ratings"}
  - {id: btc_holdings_sales, desc: "BTC bought, BTC sold, BTC Monetization Program, BTC Yield"}
  - {id: index_flows, desc: "MSCI, Nasdaq-100, S&P 500, FTSE Russell membership"}
  - {id: liquidity_debt, desc: "USD Reserve, convert principal, holder puts, redemptions, debt repurchases"}
  - {id: mgmt_insiders, desc: "CFO transition, Saylor/CEO/CFO open-market trades"}
open_items:
  - {id: msci_deletion, desc: "MSCI USA deletion effective at 2026-11-30 close; reversal or change of timing resolves", expires_at: 2026-12-01}
  - {id: sp500_dec_rebalance, desc: "S&P 500 quarterly rebalance announcement naming MSTR (add, or stated ineligibility)", expires_at: 2026-12-08}
  - {id: nasdaq100_recon, desc: "Nasdaq-100 annual reconstitution announcement: MSTR kept or removed", expires_at: 2026-12-21}
  - {id: strc_jan_rate, desc: "STRC rate decision for January 2027 record dates (currently held at 12.00%)", expires_at: 2026-12-31}
  - {id: cfo_transition, desc: "Virasteh becomes EVP & CFO on 2027-01-01; any change to the plan resolves", expires_at: 2027-01-02}
  - {id: daily_dividends_2027, desc: "STRF, STRK, STRD move to daily dividends on 2027-01-01", expires_at: 2027-01-02}
  - {id: put_2028_notes, desc: "Holder put on $1.01B 2028 converts; put results or early redemption resolve", expires_at: 2027-09-16}
group_keys: [treasury_MSTR, nav_MSTR, earnings_calendar]
removed: []
---

# MSTR — Strategy Inc

_Researched 2026-11-18. Weekly 8-K figures re-checked against the SEC filing of 2026-11-16 on 2026-11-18. MSTR Class A common and the preferreds STRF, STRC, STRK and STRD trade on the Nasdaq Global Select Market. The euro preferred STRE is listed on the Luxembourg Stock Exchange (LuxSE), not on Nasdaq. CIK 0001050446. Delaware corporation, HQ Tysons Corner, VA. Fiscal year ends Dec 31. Next earnings: Q4/FY2026 is expected in about the first week of February 2027. Q4 2025 printed 2026-02-05 (8-K Item 2.02), and its date notice came out 2026-01-15, so expect the next notice in mid-January. No earlier rubric profile exists for MSTR (none in digest-aggregator, zenux or the news-monitor coverage.js theses), so this sheet is new. Bands below follow core v3.0; a sheet value that differs from core is marked as a thesis lift (core 4.4) with its driver id, or `owner:<date>`. No sheet value currently carries an owner mark._

## Identity & matching
- **Legal entity:** Strategy Inc, formerly MicroStrategy Incorporated.
  - The brand changed on 2025-02-05 ("MicroStrategy is Now Strategy").
  - The legal-name-change release is dated 2025-08-14. EDGAR's conformed name changed 2025-08-11.
  - Former EDGAR names: "MICROSTRATEGY INC" and "MICROSTRATEGY Inc".
- **Subsidiary:** MacroStrategy LLC, the historical bitcoin-holding subsidiary.
- **Securities (all of them are MSTR news):**
  - MSTR Class A common.
  - STRC "Stretch": variable-rate Series A perpetual. Daily dividends since 2026-11-01.
  - STRF "Strife": 10.00%.
  - STRK "Strike": 8.00%, convertible.
  - STRD "Stride": 10.00%.
  - STRE "Stream": 10.00%, euro, LuxSE.
  - Convertible notes due 2028, 2029, 2030A, 2030B, 2031 and 2032.
- **Software products:** Strategy One, Strategy Mosaic, Mosaic Sentinel, HyperIntelligence.
- **People:**
  - Michael Saylor, Founder and Executive Chairman.
  - Phong Le, President and CEO. He is principal financial officer from 2026-11-06 to 2026-12-31 and co-principal financial officer from 2027-01-01.
  - Andrew Kang, CFO until 2026-11-05, then an adviser until 2026-12-31.
  - Reza Virasteh, EVP Finance & Operations, becomes EVP & CFO on 2027-01-01.
  - Shelley Khanna, CAO from 2026-11-06.
  - Shirish Jajodia, Corporate Treasurer.
  - Chaitanya Jain, Head of IR.
- **Aliases that need context** (case rules in front matter):
  - "Strategy" matches only as "Strategy Inc", "Strategy (MSTR)", "Strategy's bitcoin", or with Saylor, Le or a preferred ticker in the same item.
  - "Saylor" matches only alongside Strategy, MSTR or bitcoin.
  - "MicroStrategy" matches, but check the event date: most of it is archive.
- **Reject these collisions** (`reason:off_entity`, 0-5):
  - The common word "strategy".
  - **RoboStrategy (BOT, covered separately).**
  - MacroStrategy Partnership, a UK research firm.
  - Strategy& (PwC) and Strategy Analytics.
  - Strike, the bitcoin payments app.
  - Stride Inc (LRN), and "stride" as a word.
  - Saylor Academy.
  - Other treasury companies (Metaplanet, Twenty One, Bitmine), unless MSTR is named as a counterparty.
  - Strive (ASST) is its own covered name. A Strive item that involves MSTR securities counts for both.
- **Cross-sheet collisions** (check the other sheet before assigning; core §1 shared table): Andrew Kang (also on BOT), Shirish Jajodia (also on ASST), Strategy vs RoboStrategy (BOT).

## What the stock trades on
1. **Capital-markets access and mNAV** (`capital_access_mnav`). The question is whether MSTR can still sell common or preferred above BTC NAV. Enterprise mNAV slipped below 1 on 2026-06-26 ([The Block](https://www.theblock.co/news/markets/2026-06-26-strategy-loses-bitcoin-premium-enterprise-mnav-dips-below-1-406438)). MSTR closed at $96.50 on 2026-11-17, down 29.1% in a month ([coinotag](https://en.coinotag.com/strategy-mstr-shares-fall-29-1-in-a-month-faster-than-bitcoin)).
2. **STRC health and the cost of digital credit** (`strc_digital_credit`).
   - The STRC regular rate is held at 12.00% for December 2026 record dates; management will recommend keeping it "until STRC Stock has demonstrated sustained, healthy trading near $100" (8-K 2026-11-16).
   - STRC repurchases total about $2.66B in 2026: $2.04B through 2026-10-25, plus about $0.62B since. $332.2M remains under the $3.0B digital-credit repurchase program.
   - Q3 preferred dividends were $419.6M, about $1.7B a year at the Q3 run rate.
3. **BTC holdings, BTC Yield and BTC sales** (`btc_holdings_sales`).
   - Holdings were 850,849 BTC at 2026-11-15.
   - BTC Yield YTD was (3.7)% at 2026-10-25 (company KPI).
   - The 10-Q roll-forward shows 6,947 BTC sold in Q2 and Q3 2026 (1,395 in Q2 and 5,552 in Q3) for $431.8M, to fund dividends and STRC buybacks.
   - A BTC Monetization Program has been authorized since 2026-06-29.
4. **Index status and passive flows** (`index_flows`).
   - MSCI removes MSTR from the MSCI USA Index at the 2026-11-30 close, under its non-operating-company rules (review announced 2026-11-11, [bitcointreasuries.net](https://bitcointreasuries.net/news/msci-to-remove-strategy-and-metaplanet-from-its-indexes)).
   - Nasdaq-100 membership and S&P 500 eligibility are the next flow questions.
5. **Liquidity and debt** (`liquidity_debt`).
   - The USD Reserve is $4.75B and USD Cash is $151.2M (2026-11-15). The company put USD Assets of $5.07B at 3.4 years of dividend and interest coverage (2026-10-25).
   - Converts total $6.71B principal.
   - The first holder put is on the $1.01B 2028 notes on 2027-09-15. Their conversion price is about $183, which is out of the money.
6. **Management and insiders** (`mgmt_insiders`).
   - The CFO transition is under way.
   - Form 4 open-market sales totalled about $30.4M in 2026. The largest sellers were Le (about $12.5M), director Jarrod Patten (about $12M) and Kang (about $5.5M). Saylor made no sales.

The software business is $125.4M a quarter (Q3, down 3% year on year) and barely moves estimates. Treat software as an immaterial segment: -5 (core 4.4).

## Materiality bases
Yardsticks follow core 4.2.3 (treasury) and 4.2.2 (capital). All USD lines are in the front matter.
- **BTC holdings (primary base):** 850,849 BTC, with a $64.20B cost basis and a $75,452 average cost, as of 2026-11-15 ([8-K 2026-11-16](https://www.sec.gov/Archives/edgar/data/1050446/000119312526462151/mstr-20261116.htm)). About $58.6B at about $68,887 per BTC (the week's average purchase price).
- **Market cap:** about $40.8B. That is 402.7M Class A plus 19.6M Class B shares (10-Q cover, 2026-10-25) at $96.50.
- **Digital-credit notional:** about $16B, as the company states it. Preferred liquidation preference was $14.11B at 2026-09-30 ([Q3 release](https://www.sec.gov/Archives/edgar/data/0001050446/000105044626000047/mstr-20261029x8kxex9912.htm)).
- **Converts:** $6.71B principal:
  - 2028: $1.01B
  - 2029: $1.5B
  - 2030A: $0.8B
  - 2030B: $2.0B
  - 2031: about $0.6B
  - 2032: $0.8B
- **Remaining ATM capacity at 2026-11-15:**
  - MSTR $18.09B
  - STRC $17.51B
  - STRD $4.01B
  - STRK $2.10B
  - STRF $1.62B
- **Software revenue base:** $495M LTM (9M 2026 $372.1M plus Q4 2025 $123.0M). Used only for software deals, by core 4.2.1: tiny $2.5M, lead $49.5M.

| Measure | How to compute | Core band |
|---|---|---|
| BTC bought, h = BTC added ÷ prior holdings | 1% = 8,508 BTC (~$586M); 5% = 42,542 BTC (~$2.93B) | <1% 55-65 `group:treasury_MSTR`; 1-5% 68-80; ≥5% 80-90. Flag `pct_is_holdings` |
| Class A ATM proceeds, d = shares sold ÷ 422.3M basic | 5% = ~21.1M shares (~$2.04B) | 4.2.2: <5% 55-70; 5-10% 70-80; 10-20% 78-88; ≥20% 85-95. Flag `pct_is_dilution` |
| Preferred ATM proceeds | No share count against common: proceeds ÷ market cap, confidence ≤0.6 | 4.2.2 d bands; senior claim, say so in `why` |
| STRC or debt repurchase | Amount ÷ market cap; 5% = $2.04B | 4.2.2 buyback: ≥5% 70-80; smaller 50-60 |
| Software contract | V ÷ $495M | 4.2.1, less 5 for the immaterial segment |

- **Any BTC sale:** floor 85 (`floor:treasury_sale`). A sale of 1,000 BTC or more, or any sale stated to fund dividends, interest or buybacks: 90-95 (`btc_holdings_sales` lift).
- **A new security class, new convert or new ATM program:** 75-90 (core 4.2.3).
- **The revenue-base procurement lines of core 4.2.1 do not apply to this name** except for software deals.

## Event ladder for this name
- **Lead (90-100)**
  - **BTC sales.** Example: "Strategy (MSTR) Sells 3,588 Bitcoin to Cover Preferred Dividends" (2026-07-06, [Bitcoin Magazine](https://bitcoinmagazine.com/news/strategy-mstr-sells-3588-bitcoin)) scores 92-95. The canonical copy is the company's own (8-K of 2026-07-06: 1,363 BTC sold on Jun 29-30 and 2,225 BTC on Jul 1-5, about $216M); the media piece is a duplicate.
  - **Index deletion or addition naming MSTR.** Core 4.2.3 index add or drop 75-90, lifted by `index_flows` to 85-90. Example: the MSCI USA deletion, announced 2026-11-11 and effective 2026-11-30.
  - **Same-day quarterly results that carry a CEO or CFO change.** Core results floor 80 plus `neo_ceo_cfo`, lifted by `mgmt_insiders` to 88-92. Example: Q3 results plus CFO Kang's resignation, 8-K Items 2.02 and 5.02 on 2026-10-29 ([release](https://www.sec.gov/Archives/edgar/data/0001050446/000105044626000047/mstr-20261029x8kxex9912.htm)).
  - **A new security IPO of $1B or more.** Core new security class 75-90, upper half: 85-90. Example: "Strategy Announces Closing of $2.521 Billion STRC Stock Initial Public Offering" (2025-07-29).
  - **STRC dividend suspension, non-declaration, deferral, or a cut in the stated rate; any company-stated mNAV or ATM trigger; a covenant or margin event.** Core treasury policy change 85+, lifted by `strc_digital_credit`: 90+.
- **Digest (70-89)**
  - **Weekly 8-K with a BTC buy of 1% of holdings or more** (8,508 BTC or more): 68-80 at 1-5%, 80-90 at 5% or more.
  - **STRC monthly rate change** (up or down). Core preferred dividend change 75-85, lifted by `strc_digital_credit` to 80-88. An unchanged rate carries no lift.
  - **Debt repurchase, redemption or exchange.** Core buyback band (≥5% of market cap 70-80; smaller 50-60), lifted +5-15 by `liquidity_debt` when it retires 15% or more of convert principal or a series with a put inside 12 months. Example: "Strategy Completes $1.5 Billion Debt Repurchase … Now Holds 843,738 BTC" (2026-05-26; the 2029 notes fell from $3.0B to $1.5B): about 75. Flag `needs_owner`.
  - **Other results days.** Same-day quarterly results: floor 80, figures first (see Grader notes).
  - **Earnings-date notices.** Fixed 72, `group:earnings_calendar` (`floor:calendar`). Example: "Strategy Announces Earnings Release Date … Third Quarter 2026" (2026-10-08).
  - **Shareholder votes that change preferred dividend terms.** Core preferred dividend change 75-85. Example: daily-dividend proposal approved at the 2026-10-28 special meeting (8-K filed 2026-10-29). Other 5.07 results follow core §5 (routine 10-25; capital approvals 45-65).
  - **Credit ratings on Strategy or its preferreds.** New rating or upgrade 70-80; downgrade or watch-negative 80-90 (`strc_digital_credit` lift, `needs_owner`). Example: "S&P Global Ratings Assigns a 'B-' Issuer Credit Rating to Strategy" (2025-10-27).
  - **A new ATM program.** Core 75-90. Example: "$4.2 Billion STRC At-The-Market Program" (2025-07-31).
  - **Executive-officer changes.** Core §5 Item 5.02: CEO/CFO 75-88; other NEO 70-85. Example: 8-K Item 5.02 of 2026-07-06, which named Kang principal accounting officer after the CAO retired.
- **Borderline (40-69)**
  - **Weekly 8-K below 1% of holdings.** Score the item on its largest component, each by its core band: BTC buy h <1% 55-65 (`group:treasury_MSTR`); Class A ATM by d; STRC repurchase by the buyback band. Example: 8-K of 2026-11-16 (Nov 9-15): 485 BTC for $33.4M at about $68,887 (h = 0.06%); 2,087,040 Class A shares sold for $244.7M net (d = 0.5%); 2,282,510 STRC shares repurchased for $228.1M (0.56% of market cap); no BTC sold; USD Reserve $4.75B. Score 60-65.
  - **Company-stated NAV, mNAV or BTC Yield update with no other news.** 60-68, `group:nav_MSTR`. A move of 10% or more month on month: 75-90 (core 4.2.3).
  - **Third-party allocations to Strategy preferreds.**
    - Strive (ASST, covered) buying in the market: MSTR is not a counterparty, so no `covered_pair` floor; MSTR side 55-65 with `also:ASST`. Example: "Strive Adds $50 Million of STRC to its Corporate Treasury" (2026-03-11). A primary purchase from Strategy is a covered-to-covered transaction: floor 75 for each name.
    - Non-covered allocators (Anchorage Digital, Prevalon): 40-55 by size.
  - **Form 4 open-market trades.** Core §5: non-10b5-1 sale by the CEO or CFO of 10% or more of holdings 55-75, lifted +5-15 by `mgmt_insiders`; 10b5-1 sales 15-35. A Saylor open-market sale of any size outside a 10b5-1 plan: 80-90 (`mgmt_insiders` lift, `needs_owner`); under a plan, 40-55.
  - **Software platform launches.** Core product GA 35-55, less 5 for the immaterial segment. Example: "General Availability of Strategy Mosaic" (2025-06-24).
  - **Tax treatment of distributions.** Example: "Distributions … in 2025 are Return of Capital" (2026-02-02). Score about 40.
- **Reject (<40)**
  - **Live investor Q&A webinars.** Example: 2026-11-12. `reason:promotional`.
  - **Strategy World releases** (2026-02-23 and 2026-02-25).
  - **Gartner Peer Insights awards** (2025-12-11).
  - **Pledges and consortia.** Examples: Invest America (2026-08-05), Bitcoin Security Consortium (2026-07-23), Open Semantic Interchange (2025-12-02).
  - **Software customer case studies.** Example: Lotte (2025-07-03).
  - **Proxy and prospectus paperwork.** DEFA14A proxy material, and 424B5 supplements that only amend existing programs (four on 2026-11-02): 10-30 (core §5).
  - **Third-party price and mNAV commentary**, including a reported mNAV crossing below 1: <20, `reason:out_of_scope` (core §7: price-only mNAV moves are noise).

## Always surface (floors)
Core §6 floors that apply to this name:
- **`treasury_sale` 85:** any BTC sale, in an 8-K, a release, or first disclosed in a 10-Q/10-K roll-forward; any company-stated mNAV or ATM trigger.
- **`results` 80:** same-day results with figures (8-K 2.02, release).
- **`neo_ceo_cfo` 75 / `neo` 70:** Item 5.02 for CEO, CFO or another named executive officer.
- **`calendar` 72 fixed:** earnings-date notices, `group:earnings_calendar`.
- **`existence` 85, `deficiency` 70, `probe` 80, `open_item` 80:** as in core.

Sheet floors (thesis lifts, core 4.4):
- **Index decision naming MSTR** (MSCI, Nasdaq-100, S&P 500, FTSE Russell): floor 80 (`index_flows`).
- **STRC rate change:** floor 80; dividend non-declaration, suspension or deferral: floor 90 (`strc_digital_credit`).
- **Rating-agency action on Strategy or its preferreds:** floor 70 (`strc_digital_credit`).
- **Put, redemption or conversion notice on any convert:** floor 80 (`liquidity_debt`).
- **New security class, convert or ATM program:** floor 75 (core 4.2.3 range).

10-Q and 10-K: core §5. MSTR files the 10-Q after the results release (Q3: release 2026-10-29, 10-Q 2026-11-02), so it is a duplicate unless it adds facts. BTC sales not previously disclosed in an 8-K are a first record (`floor:treasury_sale`); a new share count or subsequent events update at 60-85.

## Noise patterns
- **Archive burst** (core §8, R-0050). The `strategy` source holds 101 items. 100 of them were seeded silently at first_seen 2026-11-03T17:12, all notified=1, published 2020-09-03 to 2026-10-29. Examples: "MicroStrategy Announces Third Quarter 2020 Financial Results" and "MicroStrategy to Present at Canaccord Genuity Growth Conference" (2022-08-05). Gate each on its own event date; older than 21 days: 0-9, `reason:stale`, `archive_burst`, `source_repair`. Never feed them.
- **Late live items.** Only one item has arrived live: the 2026-11-12 Q&A webinar notice. It is promotional and scores about 15.
- **Late Q3 results.** The Q3 release (event 2026-10-29) was first seen 2026-11-03, 5 days on. Grade it on its event date with core 4.5 timeliness (-5 to -10, original date in `why`); the same-day results floor does not apply.
- **Software and marketing releases.** Gartner, Strategy World, HCLTech partnership (2025-12-04), AWS competencies. Score 15-35 (`reason:promotional` where core §7 applies).
- **Third-party counterparty releases on strategy.com.** Example: "Prevalon Energy and Anchorage Digital Announce STRC Treasury Allocations" (2026-02-25). Score by size, usually 40-55.
- **Media echoes.** Crypto and finance media rewrite every 8-K, for example "Bitcoin Trades $200 Above Strategy's Average Cost of $75,451…" ([24/7 Wall St, 2026-11-08](https://247wallst.com/investing/cryptocurrency/2026/11/08/bitcoin-trades-200-above-strategys-average-cost-of-75451-what-happens-to-mstr-if-btc-closes-below-it/)). A rewrite of a company disclosure is `reason:duplicate`; price and mNAV commentary is <20 `reason:out_of_scope`. Recap timing follows core §7 (results recaps after 24h, guidance retellings after 72h: `late_repost`).

## Catalyst calendar
- **Every Monday:** weekly 8-K (2026-11-23, 2026-11-30, 2026-12-07 and so on). `group:treasury_MSTR` for buys below 1% of holdings.
- **2026-11-30 close:** the MSCI USA deletion takes effect (`open_item: msci_deletion`).
- **About 2026-12-04:** S&P 500 quarterly rebalance announcement. MSTR is not a member. Nine-month 2026 GAAP diluted EPS was $(6.27), so inclusion looks unlikely (`open_item: sp500_dec_rebalance`).
- **About mid-December 2026:** Nasdaq-100 annual reconstitution announcement (`open_item: nasdaq100_recon`).
- **Mid-December 2026:** STRC rate decision for January record dates, in a weekly 8-K (`open_item: strc_jan_rate`).
- **2026-12-31:**
  - Quarterly dividends (record date 2026-12-15): STRF $2.50, STRE €2.50, STRK $2.00, STRD $2.50.
  - Kang's advisory role ends.
- **2027-01-01:**
  - Virasteh becomes CFO (`open_item: cfo_transition`).
  - STRF, STRK and STRD move to daily dividends (`open_item: daily_dividends_2027`).
- **Mid-January 2027:** Q4 earnings-date notice (fixed 72, `group:earnings_calendar`).
- **About early February 2027:** Q4/FY2026 results and the 10-K.
- **About February 2027:** Strategy World 2027 (not yet announced; the 2026 edition ran Feb 23-25). Promotional.
- **Spring 2027:** proxy and annual meeting. The 2026 meeting had its DEF 14A on 2026-04-28 and its 5.07 result on 2026-06-10.
- **2027-09-15:** holder put on the $1.01B 2028 converts (`open_item: put_2028_notes`).
- **Further out:**
  - 2028-03-01: put on the $2.0B 2030B notes.
  - 2028-06-01: put on the $1.5B 2029 notes.
  - 2028-09-15: put on the $0.8B 2030A notes.

## Customers, programs, agencies & counterparties
- **Index providers:** MSCI (non-operating-company rules), Nasdaq (Nasdaq-100), S&P DJI, FTSE Russell. Their decisions naming MSTR are official records (core §9 rule 3).
- **Rating agencies:** S&P (B- issuer rating, 2025-10-27).
- **Disclosure channels:** the SEC (8-K, 424B5, Forms 4 and 144), and the strategy.com dashboard, which the 8-Ks name as a Reg FD channel.
- **ATM sales agents:** context only.
- **Large STRC holders and allocators:** Strive (ASST, covered; 505,000 STRC shares), Anchorage Digital, Prevalon.
- **Policy:** IRS/Treasury (CAMT, and return-of-capital treatment) and FASB fair-value accounting. Count only when the decision names Strategy (core §9).
- **Software customers:** below the $2.5M software tiny line, 25-39 (core 4.2.1, less 5 for the segment).

## Competitors & read-through
- **Treasury peers:** Metaplanet (removed from MSCI Japan Small Cap in the same review), Twenty One (XXI), Strive (ASST), Bitmine.
- **Boundary (core §9):** a peer's index action, forced BTC sale or financing is `out_of_scope` for MSTR (0-15) unless the source names MSTR. The MSCI release naming both Strategy and Metaplanet is direct MSTR news.
- **Spot bitcoin ETFs** compete for the same BTC-exposure demand. Context only, never an item.
- **RoboStrategy (BOT)** is unrelated despite the name.
- Published text never adds read-through commentary (R-0008).

## Source coverage gaps
Collector fixes (an `edgar_mstr` key on the SEC submissions feed; MSCI and Nasdaq index-announcement sources) live in the worker doc `sources/MSTR.md`, not here. What the grader needs:
- There is no EDGAR source key. MSTR's 8-Ks (weekly activity, 5.02, 5.07, 10-Q) reach the grader only through the `strategy` press feed or not at all. A missing 8-K is never `insufficient_evidence`; grade the release on its content.
- Index decisions reach the grader only through press. The 2026-11-11 MSCI deletion never arrived; if it surfaces late it is a material official record: core §8 late-first-sighting rule (event score -15, cap 79, `late_first_sighting`).

## Grader notes
- **Pick the canonical copy (core §8).** When a company release and the 8-K for the same week arrive in one run, the release is canonical; an earlier 8-K is canonical until the release arrives, which then duplicates it unless it adds facts. Saylor's Sunday X teaser and media rewrites are duplicates of the company disclosure. Example: "Strategy Acquires 250 BTC and Repurchases $192 Million of STRC" (2026-10-12).
- **Always cite these figures:** BTC count, USD amount, average price (fees included), h, ATM proceeds and shares by security, d, STRC repurchased, any BTC sold, and the USD Reserve. Never write a bare "8-K filed".
- **GAAP results are a BTC mark-to-market.** Q3 operating income of $20.91B and diluted EPS of $44.75 reflect the BTC price. Do not call them a "record profit" surprise. Score the quarter on:
  - BTC Yield and BTC Gain (company KPIs; label them as such)
  - capital raised
  - dividend coverage
  - BTC sold
  - management changes
- **mNAV definitions differ:** equity mNAV, enterprise mNAV and the dashboard figure. Always state which one and the source. Only company-stated figures are items (`group:nav_MSTR`).
- **All preferred-ticker news is MSTR news.** "Strike" or "Stride" without a ticker or Strategy context is a collision.
- **Proxy and prospectus paperwork.** Proxy-season DEFA14A floods (21 filings in Sep-Oct 2026, 29 in Apr-Jun 2026) and 424B5 amendments score 10-30 (core §5). The DEF 14A proposal and the 5.07 result count by core §5.
- **Insider filings (core §5).** Form 4 codes P and S only. Sell-to-cover (code F), grants (A) and exercises (M): 0-10, not items. Form 144: <20; CEO or founder selling 5% or more of holdings 30-45.
- **Group keys:** `treasury_MSTR`, `nav_MSTR`, `earnings_calendar` only.
- **Units:** BTC versus USD, and € for STRE (convert at the event-date rate). Average purchase prices include fees; sale prices are net of fees.
