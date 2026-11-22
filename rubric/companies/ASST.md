---
as_of: 2026-11-18            # balance-sheet data as of 2026-11-13 (8-K filed 2026-11-16)
asset_class: treasury         # core 4.2.3 yardsticks; revenue base not used
filer: domestic (8-K, 10-Q, 10-K, 424B5, S-3); CIK 0001920406; FYE Dec 31; emerging growth company
fx_as_of: n/a (all USD)
base: null                    # revenue exempt (core 4.2.3); Q3 revenue $2.70M is not a yardstick
base_basis: "treasury: BTC holdings, market cap, NAV"
alt_base: true
tiny_usd: null                # exempt; use core h and d bands
lead_usd: null
yardsticks:
  btc_holdings: 43404         # 2026-11-13
  btc_ref_price_usd: 69853    # avg purchase price Nov 7-13, 8-K 2026-11-16
  h_1pct_btc: 434
  h_5pct_btc: 2170
  market_cap_usd: 2.18e9      # $17.15 x 127.33M, close 2026-11-18
  atm_big_usd: 4.37e8         # 20% of market cap (core 4.2.2 new-ATM line)
  debt_big_usd: 5.46e8        # 25% of market cap
  buyback_big_usd: 1.09e8     # 5% of market cap
shares:
  common_effective: 127331109 # Class A 118,133,002 + Class B 9,198,107, 2026-11-13
  common_fully_diluted: 130.04e6
  sata: 14030176
  sats: 7141037
terms: ["Strive, Inc.", "Strive Enterprises", "Strive Asset Management", "SATA Stock", "SATS Stock", "Semler Scientific", "QuantaFlo", "True North"]
aliases: ["Asset Entities Inc. (name until 2025-09-10)", "Strive (ASST)"]
traps:
  - {term: "Strive", case: insensitive, require_any: ["bitcoin", "BTC", "ASST", "SATA", "SATS", "Matt Cole", "Strive Asset Management", "Dallas"]}
  - {term: "SATA", case: sensitive, require_any: ["Strive", "perpetual preferred"]}
  - {term: "SATS", case: sensitive, require_any: ["Strive", "15.00% Series A"]}
  - {term: "Strategy", case: sensitive, note: "Avik Roy's 'Chief Strategy Officer' title is not MSTR; STRC/STRK/STRF/STRD are MSTR securities"}
  - {term: "Jajodia", case: insensitive, note: "also on the MSTR sheet; ASST only when the issuer is Strive (Form 4 issuer CIK 0001920406)"}
group_keys: [treasury_ASST, nav_ASST, earnings_calendar]
thesis_drivers: [btc_per_share, capital_access, pref_cost, holdings_rank, optionality]
open_items:                   # proposed; owner to confirm (needs_owner until marked)
  - {id: buyback_first_use, what: "first repurchase under the $500M Class A authorization or the $500M SATA facility", expires_at: 2027-03-31}
  - {id: semler_strategy, what: "company decision to sell, spin, wind down or reinvest in the Medical Device segment", expires_at: 2027-03-31}
  - {id: new_line_launch, what: "first launch of a named new line (banking, brokerage, DeFi, reinsurance, structured ABS, tokenization)", expires_at: 2027-03-31}
removed: []
---

# ASST — Strive, Inc.

_Researched 2026-11-18. Nasdaq: ASST (Class A common). The listed preferreds are SATA (variable-rate Series A perpetual) and SATS (15.00% Series A perpetual, listed on the Nasdaq Global Market on 2026-10-20). CIK 0001920406. Nevada corporation, HQ 200 Crescent Court, Dallas. Fiscal year ends Dec 31. The next earnings date has not been announced. Expect Q4/FY2026 in mid-to-late March 2027, based on past dates: FY2025 printed 2026-03-19, Q1 2026-05-14, Q2 2026-08-10, Q3 2026-11-06. Ignore stockanalysis's estimate of "Dec 1, 2026", because Q3 has already printed. ([EDGAR submissions](https://data.sec.gov/submissions/CIK0001920406.json))_

## Identity & matching
- **Legal entity history:**
  - The company was named Asset Entities Inc. until 2025-09-10.
  - The Strive Enterprises merger closed 2025-09-12; the successor period starts on that date.
- **Subsidiaries and brands to match:**
  - Strive Enterprises, Inc.
  - Strive Asset Management, LLC (SAM), an RIA with more than $2.9B of AUM at 2026-09-30 (10-Q).
  - Semler Scientific, Inc., acquired 2026-01-16 ([8-K Items 2.01/5.02](https://www.sec.gov/Archives/edgar/data/1920406/000095010326000616/dp240082_8k.htm)). It is now the Medical Device segment; QuantaFlo is its product.
  - True North, the media brand behind the "Bitcoin for Business" summits.
- **Securities:** "SATA Stock" and "SATS Stock".
- **People:**
  - Matthew (Matt) Cole, Chairman and CEO.
  - Ben Pham, CFO.
  - Avik Roy, Chief Strategy Officer; he left the board 2026-01-16.
  - Arshia Sarkhani, CMO.
  - Brian Beirne, CLO.
  - Eric Semler and Shirish Jajodia, directors.
  - Vivek Ramaswamy, co-founder.
- **Context guards** (also in the front matter):
  - Match "Strive" only together with one of: bitcoin/BTC, ASST, SATA, SATS, Matt Cole, Strive Asset Management, or Dallas.
  - Match "SATA" only with Strive or "perpetual preferred".
  - Match "SATS" only with Strive or "15.00% Series A".
- **Reject these collisions** (0-5, `reason:off_entity`):
  - Strive Health, Strive Pharmaceuticals, Strive Masiyiwa, USAID "STRIVE" programs, and the verb "strive".
  - Serial ATA, SATA airline (Azores), SATA Group.
  - SATS Ltd (Singapore), "sats" (satoshis), and EchoStar's historical SATS ticker.
- **Cross-sheet collisions** (check against the MSTR sheet before scoring):
  - STRC, STRK, STRF and STRD are Strategy's preferreds. Strive holds 505,000 STRC shares, but a STRC item is ASST news only if it names Strive.
  - "Chief Strategy Officer" (Roy) is not a Strategy Inc. match.
  - Shirish Jajodia also appears on the MSTR sheet. Assign a Jajodia item to ASST only when the issuer is Strive, for example a Strive Form 4 or a Strive board change.
  - Eric Semler or SMLR items count only for Semler Scientific after 2026-01-16.
- **Pre-merger material:** Asset Entities items from before 2025-09-12 and SMLR items from before 2026-01-16 are history, not ASST events.
- **Fund-level items:** Strive ETF items count only if they report a change in SAM AUM or fees.

## What the stock trades on
1. **`btc_per_share`: accretion of bitcoin per share.** This covers the size and cadence of BTC buys and BTC Yield, which is a company KPI.
   - BTC Yield was 18.5% in Q3, 63.2% YTD and 19.3% for Oct 1-30.
   - The company bought 15,124 BTC in Oct 1-30 ([Q3 release](https://www.sec.gov/Archives/edgar/data/1920406/000162828026071331/striveincq32026earningsrel.htm)).
2. **`capital_access`: capital-markets access and the premium to NAV.**
   - Which ATM is being drawn: Class A, SATA or SATS.
   - New preferred deals. The SATS IPO of 2026-10-20 raised about $609.0M net.
   - Warrant exercises. PIPE warrants worth $369.2M gross were exercised 2026-10-12/13.
   - Issuing common below 1.0x mNAV dilutes BTC per share.
3. **`pref_cost`: cost of the preferreds and stress on them.**
   - SATA rate history: 13.00% from 2026-04-15 (up from 12.75%), then 13.25% from 2026-12-01 ([8-K](https://www.sec.gov/Archives/edgar/data/1920406/000162828026073033/asst-20261111.htm)).
   - SATS pays a fixed 15% on the $100 stated amount. An 18-month dividend reserve was funded at the IPO.
   - Annual dividend load is about $293M: SATA 14.03M × $13.25 = $185.9M, plus SATS 7.14M × $15 = $107.1M. Cash was $465.3M on 2026-11-13.
4. **`holdings_rank`:** rank against other public BTC treasuries.
5. **`optionality`:**
   - Unused buybacks: $500M Class A, authorized 2025-09-15; $500M SATA facility.
   - The Semler device business, which took a $14.65M R&D intangible impairment in Q3.
   - New lines the company says it is evaluating: banking, brokerage, DeFi, reinsurance, structured ABS and tokenization.
   - See `open_items`.
- **Immaterial segment:** treat operating updates from the Medical Device segment as immaterial (core 4.4, -5). A decision to sell, spin, wind down or reinvest resolves `semler_strategy` instead.

## Materiality bases
Revenue is not the base (core 4.2.3). Q3 revenue was $2.70M ($1.56M advisory, $1.13M device), and nine-month revenue was $8.40M ([10-Q](https://www.sec.gov/Archives/edgar/data/0001920406/000162828026071332/asst-20260930.htm)).

- **Balance sheet as of 2026-11-13** ([8-K 2026-11-16](https://www.sec.gov/Archives/edgar/data/1920406/000162828026074004/asst-20261116.htm)):
  - **BTC:** 43,404 BTC, up from 43,153 on Nov 6. That is about $3.03B at the filing's average purchase price of $69,853. The dollar value is derived, not a company figure.
  - **Cash and STRC:** cash $465.3M; 505,000 STRC shares at a fair value of $50.5M.
  - **Common shares:** 127,331,109 effective (Class A 118,133,002 plus Class B 9,198,107); about 130.04M fully diluted.
  - **Preferred:** SATA 14,030,176 and SATS 7,141,037 shares, about $2.12B at the $100 stated amount.
  - **Debt:** none.
- **Market cap:** about $2.18B at $17.15 (close 2026-11-18, [stockanalysis](https://stockanalysis.com/stocks/asst/)).
- **mNAV:** about 1.25x on an EV/BTC basis. This is my own calculation, not a company figure. Never publish it, and never score price-only mNAV moves (core 4.2.3).
- **ATM capacity as of 2026-10-30 (10-Q):** Class A about $1.74B, SATA about $1.62B, SATS about $999.7M; $4.4B in total. Treat it as capacity, never as money raised.
- **Yardsticks:** use the core 4.2.3 and 4.2.2 bands. Only the numbers below are sheet-specific.

| Test | Measure | Core band |
|---|---|---|
| BTC purchase | h = BTC added ÷ prior holdings (1% ≈ 434 BTC; 5% ≈ 2,170 BTC) | <1% 55-65 (`group:treasury_ASST`); 1-5% 68-80; ≥5% 80-90 |
| Class A issuance (ATM, warrant exercise, offering) | d = new shares ÷ basic shares before, taken from the filing | Core 4.2.2 d table |
| Preferred takedown (SATA/SATS ATM, follow-on) | Gross proceeds ÷ market cap as a size proxy, because preferred stock does not dilute common; flag `estimate` | Core 4.2.2 d table on the proxy; new class 75-90 |
| New ATM program | Capacity ÷ market cap (20% ≈ $437M) | 75-90 as a new security class (core 4.2.3) |
| Buyback authorization | Size ÷ market cap (5% ≈ $109M) | 70-80 / 50-60 |

- **Value rule:**
  - Test a buy on BTC count.
  - Test a raise on gross proceeds or share count.
  - A weekly 8-K with both a buy and ATM sales is one item. Score it on its larger component, and state both components in `why`.

## Event ladder for this name
Bands follow the core rubric (Lead 90-100, Digest 70-89, Borderline 40-69, Reject 0-39). The examples apply the core rules to past ASST events.

- **Lead (90-100)**
  - Any BTC sale, treasury-policy change, or company-stated mNAV/ATM trigger: 85+, `floor:treasury_sale`.
  - A missed, suspended or deferred SATA or SATS dividend: `control` (default), 85-100.
  - New preferred or common deals at the top of the core size range.
  - Examples:
    - "Strive Announces Pricing of Upsized Initial Public Offering of SATS Stock", 2026-10-15 ([8-K 1.01](https://www.sec.gov/Archives/edgar/data/1920406/000095010326015690/dp255095_8k.htm)). 7.0M shares at $90 raised about $630M gross (about 29% of market cap); Barclays and Cantor underwrote. New security class: about 90.
    - 8-K of 2026-10-13: 3,311 BTC bought Oct 5-9, h ≈ 11%. Score 85-90 ([8-K](https://www.sec.gov/Archives/edgar/data/1920406/000162828026065595/asst-20261013.htm)).
    - 8-K of 2026-10-19: 4,045 BTC bought Oct 12-16, h ≈ 12%. Score 85-90 ([8-K](https://www.sec.gov/Archives/edgar/data/1920406/000162828026066222/asst-20261019.htm)).
- **Digest (70-89)**
  - **Weekly buys:** ≥5% of holdings 80-90; 1-5% 68-80. All are `group:treasury_ASST`.
  - **Warrant exercise plus buy:** 8-K of 2026-10-14 ([8-K](https://www.sec.gov/Archives/edgar/data/1920406/000162828026065816/asst-20261014.htm)), about 86.
    - PIPE warrants for 13.67M shares were exercised for $369.2M gross; take d from the filing's pre-exercise share count.
    - 2,822 BTC were bought in the same filing.
  - **Buy plus buyback facility:** 8-K of 2026-10-05: 2,000 BTC (h ≈ 7%) and a $500M SATA repurchase facility (about 23% of market cap, 70-80). Scored on the buy: about 82 ([8-K](https://www.sec.gov/Archives/edgar/data/1920406/000162828026064753/asst-20261005.htm)).
  - **Same-day results:** `floor:results` 80. Example: Q3 results, 2026-11-06 (8-K 2.02), about 82, figures first.
  - **New ATM:** "$1.0 Billion SATS At-The-Market Program", 2026-10-26 ([8-K 1.01](https://www.sec.gov/Archives/edgar/data/1920406/000095010326016138/dp255514_8k.htm)). Capacity is about 46% of market cap: about 85.
  - **Preferred dividend rate change:** 75-85. Example: SATA raised to 13.25%, 8-K filed 2026-11-12: about 78.
  - **CEO or CFO in or out:** 75-88 (`floor:neo_ceo_cfo`). Other NEOs (CSO, CMO, CLO): 70-85.
  - **Acquisition signed or closed:** `deal`, 75-85. Example: Semler acquisition completed 2026-01-16, about 80.
  - **Results-date or call notice:** fixed 75, `group:earnings_calendar`.
- **Borderline (40-69)**
  - **Weekly buys under 1% of holdings:** 55-65, `group:treasury_ASST`, and never dropped.
    - 8-K of 2026-11-16: 251 BTC (h = 0.58%) plus about $10.0M gross of SATS ATM sales, about 58.
    - 8-K of 2026-11-09: 29 BTC (h ≈ 0.07%), about 55.
  - **NAV, BTC Yield or holdings updates without a buy:** 60-68, `group:nav_ASST`. These go to 75-90 when the core 4.2.3 thresholds are met (NAV move ≥10% month on month, index add or drop).
  - **Charter or certificate amendments (8-K 3.03/5.03) that do not change dividend economics, and reverse splits:** 55-70 (core 5.03).
    - SATA $100 minimum sale price and Business Day amendment, filed 2026-10-13 ([8-K](https://www.sec.gov/Archives/edgar/data/1920406/000162828026065594/asst-20261012.htm)), about 60.
    - 1-for-20 reverse split effective 2026-02-06 ([Nasdaq](https://www.nasdaqtrader.com/TraderNews.aspx?id=ECA2026-70)), about 62.
    - The SATS certificate 8-K of 2026-10-20 (3.03/5.03) belongs to the SATS IPO event: mark it duplicate unless it adds terms.
  - **First SATS dividend declaration:** 40-50; example 2026-10-21, about 45. A declaration at an unchanged rate is not a "dividend change".
  - **Medical Device impairment or segment news:** 40-50 after the immaterial-segment -5. Example: the $14.65M Q3 impairment.
  - **Shelf with no takedown:** 40-55.
- **Reject (0-39)**
  - **Ramaswamy's final 13D/A (Amendment No. 4, 2026-10-28):** took him to 4.6%. Core "other 13D/A" is <30, or 30-45 if it discloses co-founder sales of ≥5% of his holdings (by analogy with the core founder-sale line); about 35.
  - **13G filings:** a new 13G scores 25-40 and a 13G/A <20. Five were filed 2026-11-06 to 11-16.
  - **Routine filings:** unchanged monthly dividend tables (<30); 424B3 resale prospectuses (10-30, e.g. the two filed 2026-11-06); FWP, CERT and 8-A12B (0-15).
  - **Form 4 codes A, M, F, G and J** (RSU vesting, sell-to-cover): 0-10, not items. Examples: Cole, Pham, Sarkhani, Beirne and Jajodia filings of 2026-10-02 and 2026-10-05.
  - **Promotional items:** summits, True North events, Brink stewardship or donations, keynotes and awards score 0-20, `reason:promotional`.

## Always surface (floors)
Core section 6 floors apply as written: `results` 80, `treasury_sale` 85, `neo_ceo_cfo` 75, `neo` 70, `capital_big` 75, `deal_signed` 75, `calendar` 75, `deficiency` 70, `existence` 85, and `open_item` 80 for the ids in the front matter. Sheet-specific lines:
- **`strive_sec_northland` matches** (owner:2026-11-14, owner-requested watch): floor 70.
  - Open the filing (`read_source: true`).
  - The headline must state where Northland appears (document, exhibit and role, for example agent or underwriter).
- **Preferred dividend missed, suspended or deferred:** 85+ (`control`, default). A rate change is 75-85 under core 4.2.3, with no separate sheet floor.
- **Weekly holdings 8-Ks:** always `group:treasury_ASST`, so they are never dropped silently. Each member is scored individually by h.

## Noise patterns
- **Archive burst on 2026-10-28** (core section 8, R-0050): the `strive` source seeded 10 items at 14:50. Gate each item on its own event date. Six were more than 21 days old: Mar 19 FY results; Apr 15 SATA 13.00%; Apr 27 "Bitcoin Buys & True North Summit"; May 14 Q1 and SATA daily dividends; Jul 22 Brink stewardship; Aug 10 Q2. Score them 0-9 and flag `reason:stale`, `archive_burst`, `source_repair`.
- **Wrong source and stale:** the `strategy` key carried "Strive Adds $50 Million of STRC to its Corporate Treasury" (event 2026-03-11, first seen 2026-11-03). Score 0-9 with `reason:stale`, `archive_burst`, `source_repair`.
- **Weekly-buy syndication:** crypto press re-reports each weekly 8-K. Mark those copies `dup_of` the 8-K unless they add a figure.
- **Late recaps and retellings:** core section 7 timing applies (24h for results recaps, 72h for guidance retellings).
- **Price-only items:** mNAV commentary, price targets and stock-move pieces score <20, `reason:out_of_scope`.

## Catalyst calendar
- **Weekly:** BTC and ATM 8-Ks each Monday; the next is about 2026-11-23.
- **Mid-December 2026:** the SATA rate for January 2027, and the January SATA and SATS dividend declarations. Score a rate change at 75-85; an unchanged rate is routine.
- **2026-12-01:** the SATA 13.25% rate takes effect. It was already announced 2026-11-12; no new item unless the terms change.
- **Mid-to-late March 2027:** Q4/FY2026 results and the 10-K. `buyback_first_use`, `semler_strategy` and `new_line_launch` expire 2027-03-31.
- **About mid-May 2027:** Q1 2027 results.
- **No date set:** Semler device strategy; buyback use; ATM draws; new business lines.

## Customers, programs, agencies & counterparties
- **ATM agents and underwriters:**
  - SATS ATM: Cantor, Barclays, Clear Street, StoneX, B. Riley, Maxim and H.C. Wainwright.
  - The Class A and SATA ATMs also include Benchmark.
  - SATS IPO bookrunners: Barclays and Cantor.
  - Northland is the subject of the owner-requested filing watch; no Northland role has been found in any filing so far.
- **SEC:** shelf S-3 333-290252.
- **Nasdaq:** listing of all three securities.
- **Holdings:** Strategy Inc., through 505,000 STRC shares. A STRC dividend change counts for ASST only if the item names Strive.
- **Debt:** none outstanding.
  - The $20M Coinbase Credit loan assumed from Semler was retired 2026-01-27.
  - Semler's 4.25% 2030 converts ($100M assumed) were handled in two steps: $90M was exchanged for about 930k SATA shares in January 2026, and the remaining $10M was retired in May 2026.

## Competitors & read-through
Strategy (MSTR, also covered), Metaplanet, Twenty One (XXI) and MARA compete for holdings rank and for buyers of bitcoin-backed preferred stock. Under core section 9, their items count for ASST only when the source names Strive or one of its securities. An MSTR item that names Strive counts as direct involvement for both names; otherwise it is `out_of_scope` for ASST (0-15). Bitcoin price and general crypto news are `out_of_scope`.

## Source coverage gaps
Grader-facing facts only. Collector and repair notes, including the proposed `edgar_asst` source, live in the worker doc `sources/ASST.md`.
- **Covered keys:** `strive` (press RSS) and `strive_sec_northland` (owner watch). Neither carries the full EDGAR stream.
  - Most 8-Ks never reach the grader: weekly holdings, SATA rate changes, warrant exercises, buybacks and charter amendments.
  - A missing expected 8-K is never `insufficient_evidence`, and absence from the feed is never evidence that an event did not happen.
- **Canonical copy:** when a press or crypto item cites a weekly 8-K, the 8-K is canonical. Open it for h, ATM sales and share counts.
- **`strive_sec_northland` items** arrive as filing titles. Open the full submission before scoring above 39 (core section 5).
- **Freshness:** gate every `strive` item on its event date, because the key has seeded archive bursts (see Noise patterns).

## Grader notes
- **Duplicates:** the press release, 8-K Exhibit 99.1 and the 10-Q often land on the same day. The release or 8-K is canonical.
  - The 10-Q is an update (60-85) only if it adds subsequent-event figures, such as the ATM capacity at 2026-10-30. Otherwise it is a duplicate (core section 5).
- **GAAP income is a mark:** Q3 GAAP net income of $509.0M came from a $533.7M unrealized BTC gain. In `why`, lead with BTC count, BTC Yield (labeled as a company KPI), cash and dividend load.
- **Reverse split:** per-share figures from before 2026-02-06 are 20x smaller. Cole's Form 4 purchase of 500,000 shares at $0.9187 on 2026-01-13 is at a pre-split price.
- **SATS wording:** SATS priced at $90 against a $100 stated amount. Write "15.00% on $100 stated"; never quote the yield at issue as the coupon.
- **ATM size:** never report an ATM program's size as money raised.
- **Weekly 8-K `why` template:** "Bought N BTC (dates), h = x.x% of prior holdings; holdings X BTC; ATM sales $Y by security." Set `magnitude_pct_of_base` to h and flag `pct_is_holdings`.
- **Own results are never out of scope:** the 2026-11-06 Q3 release takes `floor:results` (≥80).
- **Stale sheet:** if a primary item contradicts these share counts, holdings or preferred terms, grade on the item and flag `sheet_stale` and `needs_owner` (core section 12).

<!-- Verification 2026-11-18: EDGAR submissions (CIK 0001920406) and the 8-K of 2026-11-16 confirmed the 251 BTC buy at $69,853 average, 43,404 BTC, $465.3M cash, STRC $50.455M, the Class A/B and SATA/SATS counts, $10.0M of SATS ATM sales, and the filing list (8-K 3.03/5.03 on 2026-10-20; 13G filings 2026-11-06 to 11-16; 424B3 x2 on 2026-11-06). The web-search budget ran out before Jajodia's Strive board seat could be checked independently; it is kept from the prior sheet and guarded by the issuer-CIK rule. The Northland owner date comes from news-monitor src/covered-company-sources.js ("Added Nov 14 2026 at the owner's request"). -->
