---
ticker: GRRR
name: Gorilla Technology Group Inc.
as_of: 2026-11-18
asset_class: operating
filer: foreign private issuer (20-F / 6-K, never 8-K); Cayman Islands, HQ London; CIK 0001903145; FY ends Dec 31
base_usd: 200000000           # B: FY2026 guidance floor, "at least US$200M" (core 4.2.1: an "at least" guide uses its floor); Q2 2026 $50.1M x4 = $200.5M agrees
base_basis: "FY2026 revenue guidance 'at least US$200M', raised 2026-08-24 from $160-200M (H1 2026 6-K ex.99)"
base_date: 2026-08-24         # re-base after the Q3 print (release before the 2026-11-19 call); no alt base: Q x4 and the guidance floor coincide
tiny_usd: 1000000             # 0.5% of B (B > $100M)
lead_usd: 20000000            # 10% of B
small_base: false             # B >= $25M
shares_outstanding: 27578506  # 424B7 filed 2026-10-15, as of 2026-09-22; plus 1,000,000 pre-delivery shares issued at the 2026-10-29/30 note closing = ~28.58M pro forma
cash_usd: 179400000           # 2026-06-30 ($179,361,146, H1 6-K ex.99); before the $125M Series B (closed 2026-07-17) and the ~$24.2M net October draw; borrowings ~$73.2M, derivative liability $48.2M
market_cap_usd: null          # compute as shares_outstanding x the last close on the event date; never assume a price
# no fx fields: reports in USD under IFRS; Egypt exposure is EGP and Taiwan awards may be TWD, so convert those at the event-date rate
terms: ["Gorilla Technology Group", "Gorilla Technology", "Gorilla Technology Inc.", "Gorilla Tech Capital", "Shackleton Finance", "NeutraDC Nxera Batam", "Yotta 1", "Yotta 2", "Korat"]
aliases: ["$GRRR", "GRRRW", "Gorilla"]
traps:
  - {term: "GRRR", case: sensitive, rule: "ticker, cashtag or GRRRW warrants only; reject 'grrr' as an interjection"}
  - {term: "Gorilla", case: insensitive, rule: "needs Gorilla Technology/GRRR context or a Yotta, Batam, Egypt, Taiwan CIB or AI-infrastructure link; reject Gorilla Glass, Gorilla Glue, Gorilla Tag, Gorilla Mind and the animal"}
  - {term: "Yotta", case: insensitive, rule: "counterparty, not a GRRR entity: match only when Gorilla is named; 'Yotta 1'/'Yotta 2' only with Yotta Data Services; reject YottaDB, the yotta- prefix, and Yotta's own IPO or fundraise unless it names Gorilla"}
  - {term: "Korat", case: insensitive, rule: "only with the 200MW AI campus or Gorilla named"}
  - {term: "NeutraDC|Nxera|Batam", case: insensitive, rule: "only the NeutraDC Nxera Batam project with Gorilla; reject other Batam data centres and Nxera Pharma"}
  - {term: "Egypt|GoE", case: insensitive, rule: "only the Government of Egypt air-gapped network with Gorilla named"}
  - {term: "CIB", case: sensitive, rule: "only Taiwan's Criminal Investigation Bureau with Gorilla named; reject Commercial International Bank (Egypt)"}
  - {term: "largest criminal investigation bureau of its kind in the Asia-Pacific region", case: insensitive, rule: "unnamed Taiwan CIB descriptor in Gorilla releases; match only with Gorilla"}
  - {term: "Shackleton", case: insensitive, rule: "only Shackleton Finance (now Gorilla Tech Capital); reject the explorer"}
  - {term: "Freyr", case: insensitive, rule: "only Freyr Technology AI Pte. Ltd. (20-F key client); reject FREYR Battery / T1 Energy"}
  - {term: "Supermicro|NVIDIA|DGX Cloud", case: insensitive, rule: "not GRRR entities; reject unless Gorilla is named or the item ties to the Yotta India or Batam deployments; Supermicro's ~$2B Yotta arrangement is not GRRR revenue, never add the two"}
  - {term: "CoreWeave|Nebius|Bitdeer|Benchmark|StoneX|Fitch", case: insensitive, rule: "not GRRR entities; match only when Gorilla is named in the same item"}
thesis_drivers: [gpu_delivery, dilution_financing, guidance_margin, contracts_project_debt, legacy_cash]   # the sheet's 'What the stock trades on' items 1-5, in order
open_items:
  - {id: q3_print, what: "Q3 2026 results (release before the 2026-11-19 4:30 p.m. ET call): Q3 against the ~$48-50M planning range, and the FY2026 'at least $200M' floor held, raised or cut", expires_at: 2026-11-20, note: "re-base B on the print; as_of is stale after it (core 12.4)"}
  - {id: us_dc_definitive, what: "U.S. data-centre LOI (2026-10-09; ~6MW live, 36MW potential) signed as definitive agreements, closed, or lapsed", expires_at: 2026-12-31, note: "LOI targets completion by end-November 2026; one-month grace set by sheet author, needs_owner"}
  - {id: yotta2_tranches, what: "Yotta 2 B300 tranches (~5,000 GPUs each, October to year-end; originally due 2026-09-30) delivered and accepted, or slipped", expires_at: 2026-12-31}
  - {id: batam_tranche2, what: "NeutraDC Nxera Batam phase-1 tranche 2 (due December 2026) delivered, or slipped", expires_at: 2026-12-31}
  - {id: special_meeting, what: "Special-meeting proxy 6-K to raise authorized shares from 73.5M to 200M (must be called within 75 days of the 2026-10-30 closing), and the vote result", expires_at: 2027-01-13, note: "the deadline is for calling the meeting; move expires_at to the meeting date once the proxy sets it"}
  - {id: notes_registration, what: "Resale registration of the October notes' conversion shares: filing (due ~2026-11-29) and effectiveness (60 days, 90 with SEC review); the notes accelerate if the shares are not registered within 90 days", expires_at: 2027-01-28, note: "~90 days after the 2026-10-29/30 closing; alternative-price conversions (capped at $6M a month) start ~2026-12-29 or on effectiveness"}
  - {id: fy27_target, what: "FY2026 revenue against the 'at least $200M' floor, and the 2027 $450-500M target reaffirmed, changed or withdrawn (FY2026 results / 20-F)", expires_at: 2027-04-30, note: "20-F due four months after FY end; last one filed 2026-04-15"}
  - {id: batam_debt, what: "Batam project debt closing or first drawdown (debt offers cover ~70% of project cost; none closed)", expires_at: 2027-06-30, note: "no official date; tied to the remaining Batam deployment in H1 2027; set by sheet author, needs_owner"}
groups: [earnings_calendar, grrr_oct_notes, grrr_gpu_tranches]   # grrr_* keys use the proposed core custom pattern <ticker>_<slug>; sheet-author proposal, needs_owner
owner_marks: []               # no line in this sheet carries an owner:<date> mark
---

# GRRR — Gorilla Technology Group Inc.
_Researched 2026-11-18. Nasdaq: GRRR (warrants GRRRW). CIK 0001903145. Cayman Islands foreign private issuer: it files 20-F and 6-K, never 8-K, and its headquarters are in London. Fiscal year ends Dec 31. **Next earnings: Q3 2026 results come out by press release before the call on Thu 2026-11-19 at 4:30 p.m. ET** (notice dated 2026-11-16, [IR](https://investors.gorilla-technology.com/gorilla-technology-to-host-third-quarter-financial-results-conference-call-on-november-19-at-430-p-m-et/)). The FY2025 20-F reported 26,188,972 shares at 2025-12-31 ([20-F, 2026-04-15](https://www.sec.gov/Archives/edgar/data/1903145/000143774926012385/grrr20241231_20f.htm)). Third-party sites put the current count at about 27.6M and the market cap at about $190M; neither is verified._

## Identity & matching
- **Legal entities:**
  - Gorilla Technology Group Inc. (parent).
  - Gorilla Technology Inc., the Taiwan operating company.
  - Gorilla Tech Capital, the new name of **Shackleton Finance**, an FCA-regulated UK fund manager. The deal completed in June 2026 and was announced 2026-07-01 ([IR](https://investors.gorilla-technology.com/gorilla-technology-completes-acquisition-of-shackleton-finance-and-launches-gorilla-tech-capital/)).
  - Project SPVs for Yotta and Batam.
- **Match terms:** "Gorilla Technology", "Gorilla Tech Capital", "Shackleton Finance", "GRRR". Also "Yotta" when it appears with Gorilla, and "NeutraDC Nxera Batam".
- **Context-guarded aliases:**
  - "Yotta 1" and "Yotta 2" match only with Yotta Data Services.
  - "Korat" matches only with a 200MW AI campus or Gorilla.
  - "Egypt" or "GoE" air-gapped network matches only with Gorilla.
  - Taiwan releases describe the customer as "the largest criminal investigation bureau of its kind in the Asia-Pacific region" and do not name it. Match that phrase only with Gorilla.
- **Reject these name collisions:**
  - Bare "Gorilla": Gorilla Glass, Gorilla Glue, Gorilla Tag, Gorilla Mind, the animal.
  - Other Yotta uses: YottaDB, the "yotta-" prefix, and Yotta's own IPO or fundraise unless it names Gorilla.
  - "Freyr" as FREYR Battery / T1 Energy. "Nxera" as Nxera Pharma. "Shackleton" as the explorer. "CIB" as Commercial International Bank Egypt.
  - Other Batam data centres. Supermicro, NVIDIA or DGX Cloud news with no India, Batam or Gorilla link.

## What the stock trades on
1. **GPU deliveries turning into recognized revenue on time.** Yotta 2 (20,736 B300) was due 2026-09-30 and now ships in tranches of about 5,000 GPUs from October to year-end ([Communications Today, 2026-10-05](https://www.communicationstoday.co.in/yottas-nvidia-gpu-push-enters-execution-phase-as-gorilla-deliveries-begin/)). Batam phase-1 tranches were due 2026-09 and 2026-12.
2. **Dilution and financing structure.**
   - 2026-10-29/30: a variable-price senior convertible facility of $111.1M principal for $100M funding, with a $3.858 floor; the first closing was $27.775M principal for $25M ([6-K](https://www.sec.gov/Archives/edgar/data/1903145/000121390026114094/ea0310294-6k_gorilla.htm)).
   - Authorized shares must rise from 73.5M to 200M.
   - Two 7.5% convertible series due 2031-06-15, both convertible at about $25.48: $107M with a $6.00 reset floor ([424B5](https://www.sec.gov/Archives/edgar/data/1903145/000121390026065533/ea0293741-424b5_gorilla.htm)) and $125M Series B with an $8.00 floor.
   - The 2026-07-14 close was $16.77.
3. **FY2026 guidance of at least $200M and the 2027 target of $450-500M** "with substantial gross margin improvement". H1 2026 gross margin was about 4.9% (computed from the H1 statements), against about 34% in H1 2025.
4. **New binding GPUaaS or data-centre contracts, and project debt actually closing.** Batam has only debt offers covering about 70% of project cost. Fitch rated the company B- (Positive).
5. **Legacy cash flows:** Egypt government contract collections and pound FX, and Taiwan CIB/government awards.

## Materiality bases
- **Revenue base: $200M.** This is the FY2026 floor, "at least US$200 million", raised from $160-200M on 2026-08-24 ([6-K ex. 99](https://www.sec.gov/Archives/edgar/data/0001903145/000143774926028827/ex_974012.htm)).
  - H1 2026 revenue was $78.4M, of which Q2 was $50.1M.
  - The Q3 planning range is about $48-50M.
  - Replace the base after the Q3 print on 2026-11-19.
- **Backlog:** not disclosed in 2026 filings. Contract headlines are "expected revenue" or "project value" over about 5 years, not booked backlog: Batam about $2.5B, Yotta 2 about $2.5B, Yotta 1 about $500M.
- **Liquidity:**
  - At 2026-06-30: cash $179.4M, borrowings about $73.2M, and a $48.2M derivative liability.
  - Both are before the $125M Series B (closed 2026-07-17) and the $25M October draw (about $24.2M net).
  - Fitch B- (2026-08-27).
- **Revenue and contract thresholds:**
  - Tiny: below $1.0M.
  - Meaningful: $1-20M.
  - Lead: $20M or more of total contract value (10% of base), or a new customer, country or site.
  - Almost every GPU headline clears the lead line, so the stage label decides the score (see Grader notes).
- **Capital events:** dilution of 10% or more of shares, or a raise of $20M or more, is lead. Under 3% is borderline.

## Event ladder for this name
**Lead (90-100)**
- Results with a guidance change, for example "H1 Revenue Surges 99% to US$78.4 Million; Raises FY2026 Revenue Outlook to at Least US$200 Million" (2026-08-24, [IR](https://investors.gorilla-technology.com/gorilla-technology-h1-revenue-surges-99-to-us78-4-million-raises-fy2026-revenue-outlook-to-at-least-us200-million/)).
- A new binding multi-year GPUaaS contract, for example the "US$2.5 Billion Five-Year AI GPUaaS Compute Contract" at Batam (2026-06-23, [IR](https://investors.gorilla-technology.com/gorilla-technology-secures-transformational-us2-5-billion-five-year-ai-gpuaas-compute-contract-converting-ai-data-centre-capacity-into-long-term-contracted-revenue/)).
- Convertible, equity or variable-price financings:
  - The $125M Series B priced 2026-07-15 ([IR](https://investors.gorilla-technology.com/gorilla-technology-group-inc-announces-pricing-of-125-million-senior-unsecured-convertible-bond-offering-to-commence-neutradc-batam-project-in-indonesia/)).
  - The $107M notes priced 2026-06-03.
  - The 2026-10-30 6-K: a $17.53 fixed conversion price, an alternative price of 90% of the average of the three lowest daily VWAPs over 20 days, the $3.858 floor, 850,612 Series D warrants at $12.90, and 1,000,000 pre-delivery shares.
- Loss, cancellation or material delay of Yotta, Batam or Egypt. A guidance cut.
- A definitive agreement or closing of an acquisition.

**Digest (70-89)**
- Delivery and go-live milestones, for example "Moves Yotta AI Infrastructure Programme into Physical Execution" (2026-09-08, [IR](https://investors.gorilla-technology.com/gorilla-technology-moves-yotta-ai-infrastructure-programme-into-physical-execution/)).
- Government awards worth tens of millions, for example "Wins Major National AI Intelligence Infrastructure Expansion in Taiwan" (2026-09-22: B300 systems, "tens of millions", deployed Q4 2026 to Q4 2027, [IR](https://investors.gorilla-technology.com/gorilla-technology-wins-major-national-ai-intelligence-infrastructure-expansion-in-taiwan/)).
- A scoped non-binding LOI, for example "Proposed 36 MW Data Centre Acquisition and 100+ MW AI Infrastructure Expansion Plan" (2026-10-09, [IR](https://investors.gorilla-technology.com/gorilla-advances-u-s-market-entry-with-proposed-36-mw-data-centre-acquisition-and-100-mw-ai-infrastructure-expansion-plan/)). The site has about 6MW today and 36MW potential, with about 18 months for the utility upgrade; location, seller and price are undisclosed. Score about 70.
- Project debt closing or drawdown. A Nasdaq or SEC deficiency notice. A CEO change (Chairman/CEO Jayesh "Jay" Chandan) or CFO change.
- Earnings-date and call notices go in the calendar card at 70-75, for example the 2026-11-16 Q3 call notice.

**Borderline (40-69)**
- A credit rating action, for example Fitch's first-time "B-" with a Positive outlook (2026-08-27, [IR](https://investors.gorilla-technology.com/fitch-assigns-gorilla-technology-first-time-b-rating-with-positive-outlook/)): about 60.
- A CVR Payment Notice, for example 560,000 earnout shares (2026-07-17, [IR](https://investors.gorilla-technology.com/gorilla-announces-delivery-of-cvr-payment-notice-2/)): about 45.
- A resale prospectus (424B7, F-3) with no new terms.
- Korat steps with no customer or financing, and "illustrative" potential such as Korat's $16-18B.
- A Schedule 13G showing a holder at 5% or more.

**Reject (<40)**
- Noteholder registration-rights notice 6-Ks (2026-07-31, 2026-08-17, 2026-10-08): about 20.
- F-3/A, EFFECT or 305B2 filings with nothing new.
- Conferences, webinars, fireside chats.
- Secondary recaps.
- Archive EDGAR items: below 10.

## Always surface (floors)
- **Any 6-K whose EX-99.x is a securities purchase agreement, note, warrant or indenture:** at least 85, even with no press release. The 2026-10-30 facility had no release.
- **Any 6-K results exhibit:** at least 80, figures first.
- **The 20-F** (FY results, concentration, going-concern or material-weakness language): at least 75 on new figures.
- **The special-meeting proxy 6-K to raise authorized shares to 200M:** at least 75. The meeting must be called within 75 days of 2026-10-30, about 2027-01-13.
- **Named programs:** at least 70.
  - Yotta 1, Yotta 2 and NeutraDC Nxera Batam tranche news.
  - Taiwan CIB awards.
  - Egypt payment, default or FX shock.
  - The US data-centre LOI turning definitive or lapsing.
- **Bad news at the same rank as good news:** slipped tranches, cut contract values, financing pulled.

## Noise patterns
Feed: gorilla and edgar_grrr, first seen 2026-08-20 to 2026-11-18. Every row had notified=1 except one, which was notified=2.
- **Archive burst:** 40 edgar_grrr rows first seen at 2026-08-31T21:21:30, with event dates from 2024-04-25 to 2026-08-24. All were notified. Score below 10 as stale; this is the archive-burst rule.
- **Bare EDGAR titles** ("Gorilla Technology Group Inc.: 6-K filed 2026-10-30"). Grade the exhibit, not the title. The same title shape covered a lead financing (2026-10-30) and a noise noteholder notice (2026-10-08).
- **Call-notice pairs:** "...Conference Call on August 31" then "CORRECTION FROM SOURCE... August 24" (2026-08-20, notified=2). Keep only the corrected date.
- **Syndicated copies** on Newsfile, Media OutReach, Malay Mail, The Sun (Malaysia) and others. Keep one canonical item per release; the IR URL is preferred.
- **Promotional "ecosystem" releases** with no counterparty, value or date: below 40.

## Catalyst calendar
- **2026-11-19:** Q3 results and call. Watch Q3 against $48-50M, the FY floor of at least $200M, gross margin and cash.
- **End-November 2026:** target to complete the US data-centre acquisition (from the LOI; definitive agreements not yet signed).
- **About 2026-11-29:** the resale registration for the October notes is due (30 days after closing). Effectiveness is due in 60 days, or 90 with SEC review. The notes accelerate if shares are not registered within 90 days.
- **About 2026-12-29:** alternative-price conversions start (60 days), or earlier on effectiveness. Capped at $6M a month.
- **Q4 2026:** Yotta 2 B300 tranches through year-end, Batam phase-1 tranche 2 in December, and the start of the Taiwan CIB deployment.
- **By about 2027-01-13:** the special meeting must be called. Later closings under the $75M balance of the facility.
- **About April 2027:** FY2026 20-F. **H1 2027:** remaining Batam deployment.
- **About 2027-07-17:** the CVR qualification window closes (one year after the notice).
- **2027-10-29:** October notes mature. **2031-06-15:** both 7.5% series mature.

## Customers, programs, agencies & counterparties
- **Government of Egypt:** firm-fixed-price contract for a secure air-gapped government network. The 20-F names it a key client.
- **Yotta Data Services:**
  - Yotta 1: 640 servers / about 5,120 B200 GPUs, about $500M expected revenue over 5 years. The first of four phases was complete in late September; the rest were due by mid-October.
  - Yotta 2: 20,736 B300 GPUs in New Delhi, about $2.5B project value (2026-07-21, [IR](https://investors.gorilla-technology.com/gorilla-technology-accelerates-execution-across-its-asian-ai-infrastructure-platform/)). NVIDIA is expected to take about half for DGX Cloud.
- **Batam:** an unnamed "high investment-grade global technology customer". Phase 1 is about 1,000 B300 servers and about $1.3B. Naming the tenant scores digest.
- **Taiwan Criminal Investigation Bureau** and **Taoyuan Airport:** named key clients in the 20-F.
- **Freyr Technology AI Pte. Ltd.:** named a key client in the 20-F.
- **Financing counterparties:**
  - The unnamed institutional investor in the October notes.
  - Benchmark (a StoneX company) and StoneX Financial, placement agents on the $107M notes.
  - Fitch.

## Competitors & read-through
- **Supermicro:** its roughly $2B arrangement (2026-06-02) supplies the GPUs and networking for the two Yotta deployments. It is not additional GRRR revenue; never add the two.
- **NVIDIA:** B300 allocation, export rules, DGX Cloud India.
- **Yotta:** its funding or IPO affects counterparty risk.
- **Neocloud peers** (CoreWeave, Nebius, Bitdeer, other Johor/Batam builds): context only, unless Gorilla is named.

## Source coverage gaps
- **Missing forms:** edgar_grrr never surfaced Form 4 (2026-07-15, 2026-08-03), Form D (2026-07-29), 305B2/424B7/EFFECT (2026-08-19/21), 424B7 (2026-10-15) or SCHEDULE 13G (2026-11-02).
  - Poll `https://data.sec.gov/submissions/CIK0001903145.json` for all forms.
  - Fetch each 6-K's EX-99 exhibits; financing terms arrive only there.
- **Counterparty programs:** the yotta.com newsroom, NeutraDC / Telkom Indonesia releases, and Taiwan procurement (web.pcc.gov.tw) for CIB awards.
- **Trade press:** DCD (datacenterdynamics.com/en/news) and Communications Today carry delivery detail the company omits.

## Grader notes
- **Stage literalism matters most for this name:**
  - "Expected revenue", "project value", "illustrative potential" and "pipeline" are not orders.
  - The LOI is non-binding.
  - The 36MW figure is potential; about 6MW is live.
  - Batam debt is "offers", not closed.
  - Never sum Yotta 1, Yotta 2, Supermicro and pipeline figures.
- **Contract size vs base:** values span about 5 years. Show a straight-line annual figure as well, for example Batam at $2.5B/5 ≈ $500M a year (our calculation).
- **Capital events:** compute dilution.
  - Example: the first $27.775M of principal at the $3.858 floor is about 7.2M shares, plus 1.0M pre-delivery shares, about 30% of roughly 27.6M.
  - Flag variable-price structures literally.
- **Filing duplicates:** a results 6-K duplicates the release; the release is canonical. Noteholder-notice 6-Ks are noise.
- **Wording:** score the stated scope, value and dates, not "transformational" or "major national".
- **Currency:** results are in USD under IFRS, unaudited at the interim. Egypt exposure is in EGP.
- **Scope:** never mark GRRR's own items out_of_scope.
- **Old profiles:** Korat has no confirmed customer. Batam capacity was about 5.5MW initially, targeted at about 18MW by 2026-12 (2026-05-26).
