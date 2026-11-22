---
ticker: MBAI
name: MBody AI Ltd.
as_of: 2026-11-18
asset_class: operating
filer: foreign private issuer (20-F / 6-K; no 8-K or 10-Q); Israeli company, formerly Check-Cap Ltd. (renamed 2026-08-27); CIK 0001610590; FY ends Dec 31
base_usd: 2334921             # B: last fiscal year, the core 4.2.1 order (no guidance, no reported 2026 quarter). FY2025 audited revenue of MBody AI Corp., the accounting acquirer in the 2026-08-26 reverse recapitalization
base_basis: "FY2025 revenue of MBody AI Corp. $2,334,921 (audited, BCRG Group); 6-K/A Ex.99.1, 2026-06-24. Re-base when the H1-2026 interim is filed (due 2026-12-31)"
base_date: 2026-06-24         # filing date of the audited statements; period ended 2025-12-31
tiny_usd: 23349               # 1% of B (B < $100M)
lead_usd: 233492              # 10% of B
small_base: true              # B < $25M; core 4.2.1 names MBAI (named paying customer, contract or deployment >= 70 without a value)
shares_outstanding: 15345971  # AGM notice and proxy (6-K 2026-11-18 Ex.99.1/99.2), reference date 2026-11-13; 15,293,584 at 2026-09-21 (F-3). d lines: 5% = 0.77M, 10% = 1.53M, 20% = 3.07M
cash_usd: 9401000             # 2026-07-31 as adjusted (F-3 capitalization table: pro forma for the 2026-08-26 merger close and the 2026-08-27 $10M offering; pre-merger actual $6K). No post-merger balance sheet filed yet
market_cap_usd: null          # compute as shares_outstanding x the last close on the event date; never assume a price
fx_as_of: n/a                 # reports in USD; NIS appears only as par value (NIS 48 per share), so no rate field
terms: ["MBody AI", "MBody AI Ltd.", "MBody AI Corp.", "MBody AI Orchestrator", "MBody SI Ltd.", "Rline AI", "Rline AI Inc.", "Check-Cap Ltd."]
aliases: ["$MBAI", "MBody", "MBody SI", "Check-Cap", "CHEK"]
traps:
  - {term: "MBAI", case: sensitive, rule: "ticker or cashtag only"}
  - {term: "MBody", case: insensitive, rule: "whole word only; 'embody', 'embodied' and 'Embodied AI' contain the string"}
  - {term: "Mbodi", case: insensitive, rule: "Mbodi AI is a separate robotics startup; off_entity"}
  - {term: "Rline", case: insensitive, rule: "never alone; only 'Rline AI'"}
  - {term: "Check-Cap", case: insensitive, rule: "historical issuer name (renamed 2026-08-27); legacy C-Scan capsule items are on-entity but Reject (<40)"}
  - {term: "CHEK", case: sensitive, rule: "historical ticker, replaced by MBAI at the open on 2025-12-02; ticker or cashtag only"}
  - {term: "Orchestrator|AI workforce platform", case: insensitive, rule: "only next to MBody"}
  - {term: "MGM", case: sensitive, rule: "only with robots, cleaning or housekeeping at an MGM Resorts property; reject Amazon MGM Studios and MGM China"}
  - {term: "Caesars", case: insensitive, rule: "only with robots, cleaning or housekeeping at a Caesars property; reject Little Caesars and Caesars Sportsbook"}
  - {term: "Mohegan Sun", case: insensitive, rule: "only Mohegan Sun in Uncasville, CT; reject Mohegan Sun Pocono"}
  - {term: "Caribe Royale", case: insensitive, rule: "needs MBody or robot context"}
  - {term: "Apollo", case: insensitive, rule: "only Apollo Technology Capital Corporation (formerly Nobul AI Corp.), the ~7.5% related-party investee; reject Apollo Global and Apollo Hospitals"}
  - {term: "Humanoid Global", case: insensitive, rule: "relay that reissues MBody news; dup_of the original unless it adds a fact"}
  - {term: "Richtech|Brain Corp|Pudu", case: insensitive, rule: "not MBAI entities; match only when MBody or an MGM, Caesars, Mohegan Sun or Caribe Royale property is named in the same item"}
thesis_drivers: [named_customers, financing_dilution, lockup_overhang, interim_financials, multi_brand, governance]
open_items:
  - {id: h1_interim, what: "H1-2026 interim balance sheet and income statement of the combined company (Nasdaq 5250(c)(2)): first post-merger revenue, recurring mix and cash burn", expires_at: 2026-12-31, note: "a miss draws a Nasdaq deficiency notice, scored on its own floor"}
  - {id: agm_share_increase, what: "AGM 2026-12-22 result on no-par re-designation and authorized shares 18M to 175M (Proposals 1-2), with the 2026 equity plan and MBody SI rename authority", expires_at: 2027-01-15, note: "results 6-K expected within days of 2026-12-22; expiry set by sheet author, needs_owner"}
  - {id: f3_takedown, what: "First primary takedown off the $250M F-3 (File 333-299083), or any other equity raise, after the AGM", expires_at: 2027-06-30, note: "no company date; the 'likely raise' is a sheet estimate; expiry set by sheet author, needs_owner"}
  - {id: lockup_feb27, what: "Lock-up on 11,231,921 merger shares: expiry, or an early release or waiver by Northland", expires_at: 2027-02-22}
  - {id: fy26_20f, what: "FY2026 20-F with the first combined audited statements and the going-concern conclusion", expires_at: 2027-04-30}
  - {id: multi_brand_live, what: "First customer deployment of hardware-agnostic (multi-brand) control, 'in final testing' per 6-K 2026-09-22", expires_at: 2027-03-31, note: "company said 'near term'; expiry set by sheet author, needs_owner"}
  - {id: customer_expansion, what: "Further Mohegan Sun (Uncasville) or Caribe Royale expansion, or a signed multi-year Mohegan Sun term (expansion 'anticipated' 2026-09-09)", expires_at: 2027-06-30, note: "no date; set by sheet author, needs_owner"}
groups: [earnings_calendar]   # the body's group key earnings_dates is not a core key (core 8); use earnings_calendar
owner_marks: []               # no line in this sheet carries an owner:<date> mark; the Mohegan Sun 'top feedworthy' quote is unmarked (core 11 anchor 86 covers it)
---

# MBAI — MBody AI Ltd.
_Researched 2026-11-18. Nasdaq: MBAI. The ticker changed from CHEK on 2025-12-01, while the issuer was still Check-Cap Ltd. CIK 0001610590. Israeli company filing as a foreign private issuer (20-F and 6-K). Fiscal year ends Dec 31._
- **No results date has been announced.** Third-party sites list 2026-11-13 or 11-17, but nothing was filed on either date, so both are unconfirmed.
- **Nasdaq Rule 5250(c)(2)** requires the H1-2026 interim balance sheet and income statement by 2026-12-31.
- **AGM:** 2026-12-22 ([proxy, 6-K 2026-11-18](https://www.sec.gov/Archives/edgar/data/1610590/000121390026121872/ea031258301ex99-2.htm)).

## Identity & matching
- **Legal entities:**
  - MBody AI Ltd. is the listed parent. It was Check-Cap Ltd. until the name change took effect 2026-08-27 ([6-K 2026-09-16](https://www.sec.gov/Archives/edgar/data/1610590/000121390026100372/ea0305662-6k_mbody.htm)).
  - The operating company is MBody AI Corp. (Nevada, Las Vegas), formerly Rline AI Inc. The merger closed 2026-08-26.
- **Planned rename:** AGM Proposal 7 would let the board rename the parent "MBody SI Ltd." within 24 months. Add "MBody SI" as an alias now.
- **Products:** MBody AI Orchestrator. Its modules are AI Optimization and Task Verification & Reporting, both deployed, and hardware-agnostic (multi-brand) control, which is "in final testing" with first customer deployment expected "in the near term" ([6-K 2026-09-22 Ex.99.1](https://www.sec.gov/Archives/edgar/data/1610590/000121390026102251/ea030607601ex99-1.htm)).
- **Aliases and guards:**
  - "MBody", "MBAI", "Rline AI", and "Check-Cap/CHEK" (historical only).
  - "Orchestrator" or "AI workforce platform" count only next to MBody.
  - "MGM" or "Caesars" count only with robots, cleaning or housekeeping at a property.
- **Reject:**
  - Mbodi AI, a separate robotics startup.
  - Amazon MGM Studios, MGM China, Little Caesars, Caesars Sportsbook.
  - Apollo Global or Apollo Hospitals. MBAI holds about 7.5% of Apollo Technology Capital Corporation, formerly Nobul AI Corp.
  - Bare "Rline".
  - Mohegan Sun Pocono. Only Mohegan Sun in Uncasville, CT is a customer.
- **Relays:** Humanoid Global Holdings reissues MBody news. Treat it as a duplicate unless it adds a fact.

## What the stock trades on
1. **Named paying customers and expansions** beyond MGM and Caesars, which provide "substantially all revenue". Each new logo or site doubling changes estimates for a company with about $2.3M of revenue.
2. **Financing and dilution.**
   - Cash: $9.4M as adjusted at 2026-07-31 ([F-3](https://www.sec.gov/Archives/edgar/data/1610590/000121390026102275/ea0306182-f3_mbody.htm)).
   - Shelf: $250M on file, limited by the baby-shelf rule (I.B.5) while public float is under $75M.
   - Authorized-share headroom is about 2.65M (18M authorized, 15.35M outstanding) until the AGM vote on raising it to 175M.
   - The company says it "may need additional capital". Operating cash flow has been negative.
3. **Lock-up and overhang.**
   - The F-3 registers the resale of 12,379,581 merger shares.
   - 11,231,921 of them are locked up until 2027-02-22; Northland can release them early.
   - The offering price was $6.50 on 2026-08-27.
4. **First combined-company interim figures:** H1-2026 revenue, recurring mix and cash burn. Check-Cap's FY2025 statements carried substantial-doubt going-concern language, which will be reassessed in the FY2026 audit.
5. **Multi-brand control in live customer use.** This is the proof of the "hardware-agnostic" claim.
6. **Governance.**
   - Chairman Regan McGee controls about 44.7% (6,860,097 shares).
   - The Apollo stake (cost $6,525,000) is a related-party asset: McGee is Apollo's Chairman and CEO. It is illiquid and was a critical audit matter.
   - Shareholder derivative litigation is tied to the Apollo BCA.
   - A warrant claim was filed 2026-09-18.

## Materiality bases
- **Revenue base: $2.33M.** This is FY2025 revenue of MBody AI Corp. ($2,334,921; FY2025 net income $507,851), from the audited statements in the 6-K/A of 2026-06-24 ([Ex.99.1](https://www.sec.gov/Archives/edgar/data/1610590/000121390026071326/ea029570403ex99-1.htm)). Use it until the H1 interim is filed.
- **Backlog/RPO:** not disclosed.
- **Shares:** 15,345,971 on 2026-11-13 (proxy). The market cap is about $30-32M if the stock is near $2, but the price is unverified.
- **Order lines:**
  - Tiny: below $23K total contract value.
  - Meaningful: $23K-$233K.
  - Lead: above $233K, or any first logo in a new vertical or state, or any MGM/Caesars portfolio-wide change.
  - In practice, nearly every named paying customer is material.
- **Capital lines:**
  - Meaningful: 5% or more of shares (≥0.77M) or $1.5M or more.
  - Lead: 20% or more (≥3.07M) or $5M or more, or any discount above 15%, a warrant-bearing deal or a convertible.
  - An existing equity line has 160,429 shares reserved.

## Event ladder for this name
**Lead (90-100)**
- New, cancelled or materially resized MGM or Caesars agreements.
- A first portfolio-scale enterprise logo.
- Raises at or above the lead line, going-concern language, a Nasdaq deficiency.
- H1 or FY results with revenue and cash.
- Control change, or a CEO (John Fowler) or CFO exit.
- Example: "Check-Cap Completes MBody AI Merger, Closes $10 Million Underwritten Offering" (2026-08-28: 1,538,462 shares at $6.50, [release](https://www.pressviewer.com/profiles/investor/NewsPrint.asp?v=7&b=3101&ID=169675&m=rl&g=3260)). The follow-up "MBody AI Completes Name Change Following Merger and $10 Million Offering" (2026-09-16, [Nasdaq](https://www.nasdaq.com/press-release/mbody-ai-completes-name-change-following-merger-and-10-million-offering-2026-09-16)) is digest, not lead.

**Digest (70-89)**
- A named new customer, deployment expansion, pilot-to-paid conversion, or signed multi-year term.
- Multi-brand control live at a customer.
- AGM results.
- Lock-up release, a takedown off the F-3.
- Apollo stake write-down or sale; a ruling in the derivative or warrant litigation.
- Examples:
  - "MBody AI Doubles Deployment at Major Northeast Casino & Entertainment Destination" (2026-11-05, [Nasdaq](https://www.nasdaq.com/press-release/mbody-ai-doubles-deployment-major-northeast-casino-entertainment-destination-2026-11)). The old grader gave it 50; it should be about 82.
  - "MBody AI Grows Resort Business with Caribe Royale Orlando as New Customer" (2026-10-22: first Florida and first non-casino resort account, multiyear subscription, no value disclosed, [release](https://www.pressviewer.com/profiles/investor/NewsPrint.asp?v=7&b=3101&ID=171820&m=rl&g=3260)). The old grader gave it 42; it should be about 75.
  - "MBody AI Advances AI Robotics Rollout at Mohegan Sun" (2026-09-09: proof of concept complete, pilot robots moved to a paid commercial agreement, multi-year expansion "anticipated"). The owner said "top feedworthy".

**Borderline (40-69)**
- Channel or distribution deals with no named buyer, for example "Brings AI Robotics to Buyers Edge Platform" (2026-07-14) and "Takes Autonomous Services Outdoors" (2026-08-06).
- Patent filings, for example "Adds 2 Patents Pending" (2026-10-08): about 45.
- Board changes. Director Scott Walters died 2026-10-10. Kai Sorensen, Ghaleb El Masri and Anurag Sharma are not standing for re-election.
- Auditor succession from BCRG LLP to SIMON & EDWARD, LLP (its successor by merger): about 40.

**Reject (<40)**
- Conference appearances, award-finalist notices, ticker and listing history, boilerplate, legacy Check-Cap C-Scan items.

## Always surface (floors)
- **Any 6-K exhibit with financial statements, an interim report or "going concern"** (CIK 0001610590): at least 80.
- **Capital filings:** 424B3/424B4/424B5 takedowns off the F-3, ATM or equity-line agreements, warrant issuance: at least 75.
- **Customer events, even without an MBody release:** at least 70.
  - MGM Resorts International Operations or Caesars Enterprise Services adding or removing robots, or terminating.
  - Mohegan Sun (Uncasville) renewal or cancellation.
  - The unnamed Fortune 500 operator being named.
- **Nasdaq notices** (deficiency, delisting, bid price): at least 80.
- **AGM vote results** (6-K after 2026-12-22): at least 70.
- **Earnings or interim-date notice:** fixed 75, `floor:calendar`, group_key `earnings_dates`.

## Noise patterns
From news-monitor-db:
- **Conference appearances:** below 20.
  - "MBody AI to Present at the H.C. Wainwright 28th Annual Global Investment Conference" (2026-09-10).
  - "Presents AI Robot Workforce Platform at Lytham Fall 2026 Conference" (2026-09-28).
  - "Brings Physical AI Robotics Platform to ThinkEquity and Maxim Investors" (2026-10-07).
- **Award finalist:** "MBody AI Orchestrator Named Finalist for AI Deployment of the Year" (2026-09-02): below 20.
- **Archive burst on 2026-09-02:**
  - 40 `edgar_mbai` rows at 15:12:18, dated 2024-09-13 to 2026-08-28.
  - 20 `mbody` rows at 15:14:18, dated 2025-06-04 to 2026-09-02.
  - All notified=1. Examples: "Check-Cap Ltd: 6-K filed 2024-09-13"; "Check-Cap claims BMO's Chris Taves Illegally Attacks…" (2025-06-04); "MBody AI and Check-Cap Enter into Definitive Merger Agreement" (2025-09-12).
  - Reject below 10 as stale.
- **Bare EDGAR titles:** "MBody AI Ltd.: 6-K filed 2026-11-18" is the AGM notice and proxy. Grade the exhibits; about 70 for the share-increase vote.
- **Boilerplate:** "Fortune 500 operators" and "labor savings" claims are not news or metrics.

## Catalyst calendar
- **AGM 2026-12-22** (record date 2026-11-20). Votes on:
  - No-par re-designation and authorized shares from 18M to 175M.
  - The 1,841,517-share 2026 equity plan.
  - The MBody SI rename.
  - Directors: McGee, Fowler and Lontini; external directors Fiona George and Daniel Kokiw.
  - The CEO pay package.
- **By 2026-12-31:** H1-2026 interim figures (Nasdaq 5250(c)(2)).
- **After the AGM:** a likely raise off the $250M F-3, limited by the baby shelf to one-third of public float (our estimate: about $5-6M at about $2).
- **2027-02-22:** lock-up expires on 11,231,921 merger shares.
- **By 2027-04-30:** FY2026 20-F, with the combined going-concern assessment.
- **Open:** first customer use of multi-brand control ("near term"); further Mohegan Sun or Caribe Royale expansion.

## Customers, programs, agencies & counterparties
- **MGM Resorts International Operations, Inc.:**
  - Master equipment lease, 3-year term, fixed monthly fee per robot.
  - Each property may terminate on 60 days' notice, paying the remaining balance less 12% and keeping the equipment.
  - MGM can buy the equipment at the end for a nominal amount.
- **Caesars Enterprise Services, LLC:** master agreement to 2029-01-10, auto-renewing yearly, terminable on 30 days' notice. Title stays with MBody.
- **Mohegan Sun (Uncasville, CT):** proof of concept, then a paid agreement (2026-09-09), then a doubled deployment (2026-11-05).
- **Caribe Royale Orlando:** 2026-10-22. No unit count or value disclosed.
- **Unnamed Fortune 500 operator:** "Expands Fortune 500 Deployment" (2026-03-26). Do not infer its identity.
- **Buyers Edge Platform:** channel only.
- **Apollo Technology Capital Corporation:** related party. The stake was received 2025-11-14 for about $16.3M of Apollo loans.
- **Northland:** bookrunner on the offering; controls lock-up waivers.

## Competitors & read-through
- **Richtech Robotics (RR):** a Las Vegas service-robot rival. A Richtech deal at a named MGM, Caesars or Mohegan property is negative for MBAI.
- **Brain Corp, Pudu and similar:** context only, unless MBody or a customer property is named.

## Source coverage gaps
- **6-K exhibits:** `edgar_mbai` gives bare titles. Fetch the ex99 files from the filing index (e.g. https://www.sec.gov/Archives/edgar/data/1610590/000121390026121872/).
- **Forms the feed did not surface:** Form 3s (8 filed 2026-09-18), SCHEDULE 13D (2026-09-22) and EFFECT (2026-09-28). Poll https://data.sec.gov/submissions/CIK0001610590.json.
- **Press releases:**
  - The feed's `mbody` source returns nasdaq.com copies.
  - The official IR widget at ir.mbody.ai (b2i issuer 3101, group 3260) has the canonical text through pressviewer.com NewsPrint.
  - The merger-close release (2026-08-28) never appeared in the feed.
- **Customer-side news:** MGM, Caesars and Mohegan property or union news.
- **Nasdaq notices:** https://listingcenter.nasdaq.com/.

## Grader notes
- **Duplicates.** Releases go out on GlobeNewswire and are mirrored on nasdaq.com, pressviewer and finviz, often also as a 6-K Ex.99.1. Choose one canonical item. Humanoid Global re-releases are duplicates.
- **Stage wording.** Proof of concept, paid commercial agreement and multi-year subscription are separate stages; state the stage literally. "Anticipated" or "indicated" expansion is not signed.
- **Figures.** Releases almost never give unit counts or dollars. Say "terms not disclosed"; never invent them.
- **Units.** NIS 48 par value; the AGM proposes no par. A 1-for-7 reverse split traded from 2026-08-13, so pre-August share counts and prices are not comparable.
- **Rule.** No item from `mbody` or `edgar_mbai` about MBAI itself is ever out_of_scope.
