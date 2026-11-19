---
ticker: BOT
name: RoboStrategy, Inc.
as_of: 2026-11-18
asset_class: treasury            # core 4.2.3 yardsticks; exempt from 4.2.1 revenue-base lines
filer_type: closed_end_fund_n2   # N-2, 424B3, 497AD, N-CSR/N-CSRS, NPORT-P, DEF 14A, Form 4; no 10-Q, 10-K or 8-K
cik: "0002081119"
fiscal_year_end: "08-31"
fx_as_of: n/a                    # all figures USD
base: 288970000                  # net assets at 2026-10-31
base_basis: "Net assets (NAV) at 2026-10-31, 424B3 Supplement No. 9 (dated 2026-11-16, filed 2026-11-17); $11.80/share"
alt_base: true                   # NAV is used, not revenue
tiny_usd: 2890000                # 1% of NAV = lower edge of core h band (h <1% scores 55-65, group:treasury_BOT)
lead_usd: 14450000               # 5% of NAV = core "new position >=5% of NAV" / h >=5% line
shares_outstanding: 24495312     # 2026-10-30 (DEF 14A record date)
market_cap_usd: 482000000        # $19.68 close 2026-11-18 x 24.50M
group_keys: [nav_BOT, treasury_BOT]
terms:
  - {term: "RoboStrategy", case: insensitive}
  - {term: "Nasdaq: BOT", case: insensitive}
  - {term: "NASDAQ:BOT", case: insensitive}
  - {term: "$BOT", case: sensitive, requires: "RoboStrategy in same item"}
aliases: ["RoboStrategy Advisors", "FP Strategies LLC", "RoboStrategy Prometheus LLC", "Android 21 LLC"]
match_traps:
  - {term: "bot / bots", case: insensitive, rule: "never match bare"}
  - {term: "Standard Bots", case: insensitive, rule: "only with RoboStrategy named or in a fund disclosure"}
  - {term: "Bot Auto", case: insensitive, rule: "KDK term; reject for BOT"}
  - {term: "BOTZ / ROBO", case: sensitive, rule: "Global X ETFs; reject"}
  - {term: "Strategy / MicroStrategy", case: insensitive, rule: "MSTR; the MSTR 'strategy' term substring-hits 'RoboStrategy': route by issuer"}
  - {term: "Andrew Kang", case: insensitive, rule: "BOT CEO, and also Strategy (MSTR) EVP & CFO: route by issuer named in the item"}
  - {term: "BOT / rBOT token", case: sensitive, rule: "reject unless the fund issues it"}
  - {term: "Bank of Thailand / board of trustees / build-operate-transfer", case: insensitive, rule: "reject"}
thesis_drivers:
  - {id: premium_nav, text: "Premium (or discount) of price to NAV"}
  - {id: issuance_pace, text: "Size and premium of share issuance (PIPEs, Roth facility)"}
  - {id: nav_marks, text: "Monthly NAV per share and position marks"}
  - {id: funding_need, text: "Cash vs the $33M unfunded commitment"}
  - {id: overhang_governance, text: "Resale overhang, CEO control, fees, RIC status"}
open_items:
  - {id: roth_first_draw, text: "First disclosed draw on the $2B Roth facility (amount, price vs NAV)", expires_at: 2027-05-31}
  - {id: unfunded_commitment, text: "How the $33M unfunded commitment (at 2026-08-31) is funded or called", expires_at: 2027-05-31}
  - {id: ric_fy27, text: "Whether the fund qualifies as a RIC for FY ending 2027-08-31", expires_at: 2027-11-30}
removed: []
---

# BOT — RoboStrategy, Inc.
_Researched 2026-11-18. Nasdaq: BOT, listed 2026-05-11. CIK 0002081119. It is a Maryland corporation with its business address in Puerto Rico. 1940 Act file 811-24118; 1933 Act files 333-291400, 333-295823, 333-297289, 333-298538 and 333-299397. It is a non-diversified closed-end fund (N-2 registrant), so it files no 10-Q, 10-K or 8-K. Fiscal year ends August 31. There is no earnings date and no `earnings_calendar` card. NAV is released monthly; observed lags have been 2-16 days after month-end (7/31 on 8/12, 8/31 on 9/2, 9/30 on 10/5, 10/31 on 11/16). Scores below follow core v3.0 bands (4.2.2, 4.2.3, section 5). Nothing on this sheet carries an `owner:` mark, so no line here overrides a core band._

## Identity & matching
- **Entities:**
  - RoboStrategy, Inc. (the fund).
  - The adviser is FP Strategies LLC d/b/a RoboStrategy Advisors. Kang and Weinstein are its managing members.
  - RoboStrategy Prometheus LLC is an SPV whose Prometheus exposure was fully sold by 2026-11-13.
  - Android 21 LLC is the CEO's vehicle.
- **People** ([DEF 14A 2026-11-10](https://www.sec.gov/Archives/edgar/data/2081119/000207709626000311/ea0311461-01.htm)):
  - Andrew Kang is Chair, President and CEO, with 40.29% beneficial ownership (9.87M shares), including 2.03M through Android 21 LLC.
  - Marc Weinstein is a director and COO, with 4.07%.
  - Independent directors are Nicolas Carter (Castle Island Ventures) and Alex Yeh (founder and CEO of GMI Cloud). GMI Computing is a $2.39M holding.
  - The named proxies are Kang, Weinstein and Bill Hughes.
- **Aliases:**
  - Match 'RoboStrategy' freely.
  - Match the ticker only as 'Nasdaq: BOT', 'NASDAQ:BOT' or '$BOT' next to RoboStrategy.
  - Mechanism Capital (the founders' crypto fund) counts only when RoboStrategy is named.
- **Portfolio names are not aliases.** Standard Bots, Dyna, Figure AI, Maven, Apptronik, Path, Dexmate, Eccentric Machines, REK, GMI, Coco (Cyan Robotics), Nox Metals, Purple Rhombus, Modal Motors, Endiatx and Allonic match only when the item names RoboStrategy or is the fund's own disclosure.
- **Cross-sheet collisions (check against core §1 collision table before scoring):**
  - **Andrew Kang:** BOT's CEO shares a name with Strategy's EVP & CFO (MSTR; Strategy 8-K text of 2026-06-29 and 2026-10-26 names "Andrew Kang, Executive Vice President and Chief Financial Officer"). Route by the issuer the item names; a Strategy filing signed by Kang is MSTR, never BOT.
  - **Strategy / RoboStrategy:** the MSTR `strategy` term hits 'RoboStrategy'. An item whose issuer is RoboStrategy is BOT only.
  - **Bot Auto:** a KDK term (trucking AV company). Reject for BOT.
- **Reject these collisions** (`reason:off_entity`, 0-5):
  - Bare 'bot' or 'bots', including 'Standard Bots' without RoboStrategy named.
  - The Global X BOTZ and ROBO ETFs.
  - Bank of Thailand, board of trustees, build-operate-transfer.
  - Crypto 'BOT' tokens and the tokenized 'rBOT', unless the fund issues them.

## What the stock trades on
1. **Premium to NAV** (`premium_nav`).
   - $19.68 close on 2026-11-18 against a 10/31 NAV of $11.80 is about 1.67x, a 67% premium ([stockanalysis](https://stockanalysis.com/stocks/bot/)).
   - The fund itself reported a 73.2% premium on 2026-11-12, measured against the 9/30 NAV of $11.35, and 159.2% on 2026-10-07.
   - The 52-week range is $16.32-$59.00.
   - Price-only premium or mNAV moves are noise (core 4.2.3). A company-stated premium or discount trigger is not (see floors).
2. **Accretive issuance pace** (`issuance_pace`).
   - The fund sells stock above NAV through PIPEs and the $2B Roth committed equity facility, then puts the cash into private rounds.
   - Roth facility pricing is market less 2%, and never below the higher of NAV and a base price.
3. **Monthly NAV per share and position marks** (`nav_marks`).
   - At 10/31, as a share of net assets: Standard Bots 30.1%, Dyna 14.3%, Figure 13.2%, Apptronik 13.6% (direct plus LP), Dexmate 8.8%, Maven 8.7%, Path 6.4%.
   - All holdings are Level 3, private and illiquid.
4. **Funding need** (`funding_need`). Cash was $2.55M against a $33M unfunded commitment at 2026-08-31 ([N-CSR](https://www.sec.gov/Archives/edgar/data/2081119/000121390026117595/ea0307908-01_ncsr.htm)).
5. **Overhang and governance** (`overhang_governance`).
   - Resale N-2 333-298538 covers 23,927,600 shares, about 98% of the 24.5M outstanding.
   - The CEO controls about 40%.
   - The adviser fee is 2.5% of average gross assets. The expense ratio is 5.64%, or 5.26% excluding deferred tax.
   - The fund did not qualify as a RIC for FY2026, and FY2027 qualification is not guaranteed.

## Materiality bases
- **Base is NAV, not revenue** (`alt_base: true`). Net assets were $288.97M ($11.80/share) at 2026-10-31 ([424B3 Supplement No. 9, dated 2026-11-16, filed 2026-11-17](https://www.sec.gov/Archives/edgar/data/2081119/000121390026120958/ea0312533-01_424b3.htm)).
- **Prior NAVs:**
  - $277.66M ($11.35) at 9/30 ([Supplement No. 3](https://www.sec.gov/Archives/edgar/data/2081119/000121390026107347/ea0307901-02_424b3.htm)).
  - $275.88M ($11.32) at 8/31 (N-CSR).
  - $248.86M ($10.51) at 6/30 ([Supplement No. 5](https://www.sec.gov/Archives/edgar/data/2081119/000121390026076467/ea0297338-01_424b3.htm)).
- **Shares and market cap:** 24,495,312 shares at 2026-10-30 (DEF 14A record date). Market cap is about $482M at $19.68.
- **Exempt from the core 4.2.1 revenue-base procurement lines.** Use the core 4.2.3 treasury yardsticks and 4.2.2 dilution table. All amounts are USD.
- **Yardsticks in USD (NAV $289M, 24.50M shares, $19.68):**

| Event | Core rule | Line in USD / shares | Score |
|---|---|---|---|
| New investment or follow-on, h = $ invested ÷ prior net assets (flag `pct_is_holdings`) | 4.2.3 purchase | <1%: <$2.89M / 1-5%: $2.89-14.45M / ≥5%: ≥$14.45M | 55-65 `group:treasury_BOT` / 68-80 / 80-90 |
| New position ≥5% of NAV | 4.2.3 | ≥$14.45M | 75-90 |
| Monthly NAV, mNAV or premium update | 4.2.3 | any | 60-68 `group:nav_BOT` |
| NAV per share move month on month | 4.2.3 | ≥10% (≥$1.18 on $11.80) | 75-90 |
| Share issuance, d = new shares ÷ shares before (flag `pct_is_dilution`) | 4.2.2 | <5%: <1.22M sh (~$24M) / 5-10% / 10-20%: 2.45-4.90M sh / ≥20%: ≥4.90M sh (~$96M) | 55-70 / 70-80 / 78-88 / 85-95 |
| New ATM-type facility | 4.2.2, 4.2.3 | capacity ≥20% of market cap (≥$96M) | 75-85; new security class 75-90 |
| Buyback or tender | 4.2.2 | ≥5% of market cap (≥$24M) / smaller | 70-80 / 50-60 |

- State whether an issue priced above or below NAV, and the NAV date used. Never test dilution against cash.
- Use the 10/31 base until the owner approves a newer one; note a newer NAV in `why` if it changes the band (core 4.2.4).

## Event ladder for this name
Examples are calibration only. As of 2026-11-18 every item dated before 2026-10-28 is stale (see Noise patterns) and scores 0-9 however material it was.
- **Lead (90-100):**
  - Event types:
    - Merger, conversion or liquidation of the fund (`control`, 85-100; agreement or close 90+).
    - A NAV per share move of 10% or more with a large repricing of a top-3 holding reaching the top of the 75-90 band plus thesis lift (`nav_marks`, +5-15), so Lead only when both apply.
    - An issuance with d ≥20% (85-95), plus +5 for a ≥15% discount to last close or toxic terms.
    - A new financing structure whose capacity is a large multiple of market cap, with first-of-kind novelty (75-90 core, +5-10 novelty).
  - Examples:
    - 'RoboStrategy, Inc. Enters Into Committed Equity Facility of up to $2 Billion from Roth Principal Investments, LLC', 2026-05-15 ([Nasdaq](https://www.nasdaq.com/press-release/robostrategy-inc-enters-committed-equity-facility-2-billion-roth-principal)). That is $2B against about $482M market cap, a new facility and a first. About 88-90 on its date.
    - 'RoboStrategy, Inc. Lists on NASDAQ Under Ticker "BOT"', 2026-05-11. `floor:listing`, 85-95 on its date.
- **Digest (70-89):**
  - Event types:
    - CEO, CFO or COO in or out, 75-88 (`floor:neo_ceo_cfo`). An adviser or advisory-agreement change counts as a treasury policy change, 85+.
    - A new position ≥5% of NAV (75-90), or an investment with h ≥1% (68-80).
    - A NAV per share move ≥10% month on month (75-90).
    - A new security class (preferred series, convert, new ATM-type facility), 75-90.
    - Issuance with d ≥5% (70-80), or d ≥10% (78-88, `floor:capital_big`).
    - A disclosed RIC qualification or failure: grade by its NAV impact, ≥10% of NAV 75-90, else 60-68 in `group:nav_BOT`.
    - A shareholder letter or presentation with new figures, targets or guidance (core §5 7.01 analog), 70-85.
  - Examples:
    - 'RoboStrategy Announces Andrew Kang as Chief Executive Officer', 2026-05-20. 80-88 on its date (`floor:neo_ceo_cfo`).
    - Standard Bots $200M Series C at a $1B valuation, led by RoboStrategy with General Catalyst ([Pulse2, 2026-06-11](https://pulse2.com/standard-bots-raises-200-million-series-c-at-1-billion-valuation-to-scale-ai-native-american-robotics/)). This counts only through the fund's own disclosure of its check. If it is ≥5% of NAV, 75-90.
- **Borderline (40-69):**
  - Event types:
    - A monthly NAV update with figures and a move under 10%, with or without position remarks: 60-68 in `group:nav_BOT`. Take the top of the band (66-68) when a holding of ≥5% of NAV is remarked or exited.
    - PIPE or private-placement raises with d <5%: 55-70. Add +5 for a named strategic investor. Compute d from the release's share count and the shares before; never from dollars against cash.
    - Investments with h <1%: 55-65 in `group:treasury_BOT`.
    - Open-market Form 4 purchases (code P) by Kang, Android 21 LLC or Weinstein of ≥$100K or ≥1% of holdings: 55-70. Non-10b5-1 sales (code S) by the CEO of ≥10% of holdings: 55-75.
    - A first-time resale registration covering ≥20% of outstanding: 60-70, with share count.
    - A new primary N-2 shelf with no takedown: 40-55, or 55-65 if its size is at least market cap.
    - The annual N-CSR or semi-annual N-CSRS: 45-60. Pull its figures into `why`.
    - The first N-2 for a new fund: 55-70.
  - Examples:
    - 'RoboStrategy, Inc. Updates Net Asset Value as of October 31, 2026', 2026-11-16. NAV/share rose 4.0% month on month ($11.35 to $11.80). Path was remarked from $6.0M to $18.6M, and the Prometheus position was exited. About 66, `group:nav_BOT`.
    - 'Raises Approximately $16.0 Million Through Private Share Issuances, Including $10.0 Million Investment by CEO Andrew Kang', 2026-07-15 ([Nasdaq](https://www.nasdaq.com/press-release/robostrategy-inc-raises-approximately-160-million-through-private-share-issuances)). The CEO part is 272,405 shares at $36.71 through Android 21 LLC. The total is about 2% of shares, so 55-70 by d.
    - The raises of about $28.9M (2026-06-18), $36.5M (6/26) and $33.9M (6/29): grade each by its own d.
    - N-2 333-298538 resale, filed 2026-08-24, 23.9M shares (about 98% of outstanding): about 60-70 on its date.
    - N-2 333-299397 primary shelf (common, preferred, rights, debt), filed 2026-10-09: 40-55 (55-65 if sized at or above market cap).
    - N-CSR filed 2026-11-09: 45-60, less 5-10 for a first sighting 9 days after the event.
    - 'Releases First Shareholder Letter', 2026-08-24: 70-85 only if it carries figures or targets not already released; NAV already released makes it 20-35.
- **Reject (<40):**
  - 497AD sponsored videos and ads: 0-10, `reason:promotional` (core 4.2.3).
  - 424B3 supplements with no new terms: 10-30. A 424B3 that is the first record of a new NAV or holdings table is a NAV update (60-68, `group:nav_BOT`); if the release came first it is `dup_of` the release.
  - Bell ringings, forums, webinars, CEO podcasts: 0-20, `reason:promotional`. Example: 'RoboStrategy to Host Robotics Founders Forum and Ring the Nasdaq Closing Bell…', 2026-10-08.
  - N-2/A amendments with no new terms: <30. Examples: 2026-10-20; and 2026-11-16, which only added 505,379 resale shares and an updated premium.
  - A DEF 14A that only elects a director: 10-20. Example: Carter's re-election for the 2026-12-09 meeting.
  - EFFECT notices: 0-15.

## Always surface (floors)
These are core §6 floors as they apply to BOT. No sheet-local floors.
- `floor:listing` 85: listing, uplisting.
- `floor:treasury_sale` 85: a disclosed discount to NAV that triggers a stated policy; a suspension or cap of issuance; termination of the Roth facility; an adviser-agreement change; a full or partial exit realised in cash from a holding of ≥5% of NAV or a top-5 holding. Smaller exits stay inside the NAV update (60-68) with `needs_owner`.
- `floor:neo_ceo_cfo` 75: CEO or CFO in or out (COO and other officers `floor:neo` 70).
- `floor:capital_big` 75: priced issuance with d ≥10% or a ≥15% discount to last close.
- `floor:open_item` 80: an item that resolves `roth_first_draw`, `unfunded_commitment` or `ric_fy27` before its `expires_at`. Record `resolves:<id>`.
- **Event-date gate first:** every floor applies only after the item passes the core §8 freshness gate on its own event date.

## Noise patterns
- **Seeding burst** (`archive_burst`, core §8 R-0050). All 57 BOT rows (17 `bot_press`, event dates 2026-05-11 to 2026-11-16; 40 `edgar_bot`, 2026-08-24 to 2026-11-18) share first_seen 2026-11-18T23:03:18Z and are all notified=1 (verified in news-monitor-db). Grade each row by its own event date. Rows dated before 2026-10-28 (40 rows) are more than 21 days old: 0-9, `reason:stale`, `archive_burst`, `source_repair`. The 17 rows dated 2026-10-28 or later are graded on content, less 5-10 for a first sighting 4-21 days after the event.
- **497AD ads.** These are 24 of the 40 `edgar_bot` rows: 15 on 2026-10-27 (5 ads filed 3 times each), then 3 each on 11-12, 11-17 and 11-18. They are paid creator content. Example: the 2026-11-18 Marcos Milla interview with Kang, which RoboStrategy Advisors paid The ETF Academy Media LLC to produce ([497AD](https://www.sec.gov/Archives/edgar/data/2081119/000121390026121880/ea0312838-01_497ad.htm)). Score the canonical copy 0-10, `reason:promotional`. No group key.
- **Triplicated filings.** The same 424B3 or 497AD is filed once under each of 333-291400, 333-295823 and 333-297289, with document suffixes -01, -02 and -03. Pick one as canonical and treat the others as duplicates (`score: null`, `dup_of:<id>`).
- **Third-party releases on the Nasdaq feed.** Example: 'GiantLeap Capital Announces Strategic Investment in Standard Bots', 2026-06-11. Another issuer under a covered key: 0-9, `reason:source_quality`, `source_repair`.
- **Company-hosted presentations.** Example: 'to Host Virtual Investor Presentation on June 10, 2026', 2026-06-04. A webinar notice is `promotional` 0-20. Only a notice the fund itself calls an investor or analyst day takes `floor:investor_day`.
- **Recaps and retellings:** core §7 timing applies (24h for recaps, 72h for retellings). No sheet-specific window.

## Catalyst calendar
Context for freshness and for matching; nothing here scores by itself.
- **2026-12-09:** first annual meeting (virtual), electing Carter as a Class I director. Record date 10-30. Routine 5.07-type result 10-25.
- **About early to mid-December 2026:** the Nov-30 NAV, then monthly. The fund says it intends to update holdings monthly. Each is a `group:nav_BOT` member.
- **By about late January 2027:** public NPORT-P for the quarter ended 2026-11-30.
- **Pending:** effectiveness of resale N-2 333-298538 (23.9M shares) and of primary shelf N-2 333-299397. Effectiveness notices score 0-15.
- **Pending:** the $33M unfunded commitment (`unfunded_commitment`) and the first Roth facility draw (`roth_first_draw`). The facility runs 36 months from commencement under the 2026-05-11 agreement, so to about mid-2029, with a commitment fee of up to $14M.
- **By about early May 2027:** N-CSRS for the half-year to 2027-02-28.
- **FY ending 2027-08-31:** the RIC qualification test (`ric_fy27`).
- **Portfolio rounds that reprice NAV:** Figure, Apptronik, Dyna, Maven, Path and Dexmate. They count only through the fund's own NAV or holdings disclosure.

## Customers, programs, agencies & counterparties
- **Roth Principal Investments:** the equity facility, plus a separate resale registration of up to 14.1M shares.
- **PIPE investors and selling holders:** for example, Dry Thunder LLC (3.725M shares) and Kang (2.054M) in the resale N-2.
- **Android 21 LLC:** the CEO's vehicle. It bought 272,405 shares at $36.71 on 2026-07-14 in a private placement.
- **Holdings at 10/31** (BOT news only when RoboStrategy marks or names them):
  - Standard Bots $87.0M.
  - Dyna $41.3M.
  - Apptronik $39.4M (direct plus LP).
  - Figure AI $38.2M (via SPV).
  - Dexmate $25.4M.
  - Maven $25.0M.
  - Path $18.6M.
  - GMI Computing $2.39M (director Yeh is GMI Cloud CEO).
- **Regulator:** the SEC Division of Investment Management.

## Competitors & read-through
- **Listed peers:** Destiny Tech100 (DXYZ), SuRo Capital and Fundrise Innovation. Their news is `out_of_scope` (0-15) unless the item names RoboStrategy.
- **MSTR:** never grade MSTR news for BOT unless BOT is named. A Strategy item mentioning Andrew Kang is MSTR.
- **Portfolio rounds:** up rounds and down rounds at Figure, Apptronik, Standard Bots or any holding count for BOT only through BOT's own NAV or holdings disclosure, or an item that names RoboStrategy.
- **Sector humanoid or robotics news** is `out_of_scope` for BOT.

## Source coverage gaps
Collector notes live in the worker file `sources/BOT.md`. Grader-facing facts only:
- The fund's X account (@RoboStrategy, stated as a future Regulation FD channel in Supplement No. 9) is not ingested.
- NPORT-P, N-CEN, Form 4 and Form D filings do not arrive in `edgar_bot`, and round-lead announcements have not arrived on `bot_press`. Missing filings are never `insufficient_evidence`.
- No source computes premium to NAV. The grader uses only premiums the fund states, with the NAV date used.

## Grader notes
- **Read the filing, not the title.** EDGAR titles are bare ('424B3 filed …'). Open the document (`read_source: true`) before scoring above 39. A 424B3 can carry a new NAV and holdings table, or only a wrapper.
- **Per-share vs net assets.** NAV per share and net assets move differently, because issuance adds to both. State both, with the as-of date. Test the 10% NAV line on per-share NAV.
- **Premium dates.** Check which NAV a stated premium uses: the 73% figure of 11-12 used the 9/30 NAV.
- **Ads repeat unverified claims.** In the 11-18 497AD Kang cites a '$600 million contract with HII' for Path. The fund's own portfolio page (2026-07-23) says HII 'intends to award up to $900M over seven years'. Never take facts from 497ADs.
- **Denominator.** Use NAV for investments and NAV moves, shares outstanding for dilution, market cap for facility capacity and buybacks. Never cash. Label marks as Level 3.
- **CEO purchase.** The $10M CEO buy was a private placement at $36.71, not an open-market trade. Grade it as capital (4.2.2), not as a Form 4.
- **No read-through tails.** Do not attach BOT to sector humanoid news. Published `why` and `note_hook` state the fund's own figures only.
- **Pending core reconciliation (`needs_owner`):** the earlier BOT draft used a %-of-NAV yardstick (NAV ≥3% month on month about 75; floor 70 on NAV releases, first NAV-bearing 424B3, N-CSR and Kang Form 4s). Those lines are withdrawn because they conflict with core 4.2.3 and §5. If the owner wants a BOT-specific yardstick, it goes into core 4.2.3 or returns here with an `owner:<date>` mark. Until then use the core bands above and `group:nav_BOT`.
