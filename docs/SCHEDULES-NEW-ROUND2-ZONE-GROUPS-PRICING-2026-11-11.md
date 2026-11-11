# Schedules NEW round 2: zone group drawer, Pricing and Linehaul tabs

_Steve Bonnici (with EasyEA), 11 Nov 2026. Owner: Kevin (routed-operations), with Kerran on the linehaul rate model (M0 to M2). Starts after the Medical Will Call release is out. Source: Marcus's test of the production release "Routed Operations: zone groups, Pricing and Linehaul tabs, depot limits and map", written up in the Google Doc "New Schedules feedback November 4th 2026 UPDATED 11/11/26" on 11 Nov, plus his 10 Nov email answers. Follows `SCHEDULES-NEW-FEEDBACK-2026-11-04.md` (card `schedules-new-feedback-2026-11-04`) and `PRICING-AND-ZONES-INTO-ROUTED-OPS-2026-10-09.md` (card `zone-groups-pricing-linehaul-tabs`)._

## 1. What Marcus found

Five of his six release-note tests pass: zone postcodes with suburb toggle, bulk paste with the added / already there / in another zone / not recognised result, Duplicate group, Pricing tab bold-own / grey-inherited with override and clear, and depot limits plus the map. The sixth, the Linehaul tab, he "can't make sense of". His verdict: the features work, usability needs work, and "the linehaul pricing piece is not right".

Nothing here reopens the current card. Z1 to Z8 and S1 to S7 stay where they are. This card is what he asked for on top of them.

## 2. Linehaul pricing (the one that matters)

### What he sees

Linehaul tab, Auckland to Hamilton 11 am (run 285): one run row, then 195 per-schedule prices underneath it. The same price still shows inside each schedule's linehaul leg. "+ Speed" adds a speed to the run but he cannot find where it went. Nobody can tell whether the leg or the run controls the price.

### What he expects

The price leaves the schedule. The run carries a price per speed (the default), with per-client overrides shown the way the zone Pricing tab shows them (own price bold, inherited grey). The schedule ties run + speed + add-on % + discount rules and nothing else. This is S7 stage 2, it is the `BulkLinehaulRate` table from the pricing spec (12.2, Kerran's Phase 1B, Kevin's M7c), and it is the rate table Marcus's email says he did not know existed.

### The 3.7% gap (Kevin, 11 Nov, Urgent prod)

On 50 of the 52 schedules where quote and booked price disagree (LIFEH, LIFEC, UCLAS lanes), the leg Amounts sit exactly 3.7% above the `BulkLinehaulRate` rows Kerran seeded on 2 Nov, with no migration or uprate on record. Quotes run 3.7% under what we bill. On #2259 and #2266 the run 8 and run 11 prices are swapped. Steve did not set a 3.7% rise. Kerran has been asked (D1). Until he answers, the leg is treated as what we bill.

### Build (LP)

| # | Build | Owner |
|---|---|---|
| LP1 | **Model agreed on one page before code.** Rate rows: `BulkLinehaulRate (LinehaulRunId, SpeedId, ClientId NULL = default, Amount, Active)`. Read order at quote and booking: client row, then default row, then (transition only) the leg Amount. Seed from the leg Amounts per D1 so the first re-rate diff is zero. The 268 contested run + customer pairs from the 30 Oct trace stay on the leg until ops resolve them. | Kevin + Kerran |
| LP2 | **Linehaul tab = run x speed.** Each run row shows its default price per speed; expand shows per-client overrides, bold own / grey inherited, type to override, clear to inherit, exactly the Pricing tab's grammar. "+ Speed" adds a priced column to the run and it is visible at once. The 195-row per-schedule list goes; in its place "Schedules using this run" lists each schedule with its add-on % and discount only. | Kevin |
| LP3 | **Schedule leg goes read-only on price.** The leg card shows the resolved price (client or default), labelled with where it came from, and a link to the run on the Linehaul tab. No price field on the schedule. S7's UI removal of the duplicated route fields is the same card edit. | Kevin |
| LP4 | **Rating reads the rate rows first.** The three rating functions (Kerran's re-emits) and the quote path take client then default then leg. Zero-diff re-rate gate on Urgent staging before the leg fallback is retired. | Kerran |
| LP5 | **Repair** the swapped run 8 / run 11 prices on #2259 and #2266, and whatever D1 says about the 3.7%. Script with preview mode, Garry or Kerran runs. | Kerran |

## 3. Zone group drawer (ZG)

| # | Build | Marcus's words |
|---|---|---|
| ZG1 | **Four tabs across the top of the drawer:** Zones, Schedules using this group, Map, Polygons. The totals banner (postcodes, schedules, zones) goes; postcode and schedule totals become small text at the foot of their own tab; the zone count disappears as a headline. The expanded postcode list fills the tab instead of scrolling inside a panel. | "it gets pretty tight when you're looking at the postcode zones, trying to work out what's in what group" |
| ZG2 | **Map: click a zone to bring it forward and fade the others.** Then edit from the map: click a postcode shape to move it to the selected zone or remove it from the group, with the same added / moved / removed result as the paste. This is Z9 from the 4 Nov spec, now in scope. | "being able to select a zone to pull it up and fade the others would be helpful. If we could then update postcodes from this visual..." |
| ZG3 | **Export and re-upload.** Z3's CSV (`Zone,Postcode,Suburb`) is the export. Re-upload the same file to set the group: preview shows added, moved, removed and unrecognised before anything is written; nothing is written on a parse error. | "look at the postcodes and associated zone in a spreadsheet and then re-insert them" |
| ZG4 | **Bug: a new group cannot take zones from the drawer.** Create "Test and Staging", open it, and the drawer says to add zones in the Zones tab. Adding to an existing group works. Fix so a new group gets its zones the same way an existing one does. | "editing existing works here for adding but not for setting up a new zone group" |
| ZG5 | **The Zones tab is a postcode list.** It lists every postcode with the group each is in rather than zones with postcodes under them. Rename it Postcodes, or restructure it as zones. D3 for Marcus. | "Is the zone tab really a 'postcodes list'..." |
| ZG6 | **Group list search by client, depot and postcode (wildcard)**, on top of Z1's name search. 69 groups over three pages today. | "search by name, client, depot, and even postcode as a wildcard" |

Removing a postcode from a zone and moving one between zones from the list view is **Z4** on the current card, not repeated here; Marcus's "works for adding but not removing" is Z4 not yet shipped.

## 4. Schedules page and Pricing tab (SP, PR)

| # | Build | Source |
|---|---|---|
| SP1 | Search schedules by schedule ID in the list search box. Marcus could not find #2746 / #2761 by number. | Marcus email 10 Nov |
| SP2 | Viewing as a client: "All Clients" schedules still show when a client is selected. Hide them, or show them greyed with a toggle. | Nisa 2.2, 4 Nov, not on the current card |
| PR1 | Client picker on the Pricing tab is "type in one box, then select in another". One searchable combobox. | Marcus 11 Nov |

## 5. Depot limits (D4)

Marcus does not know what per-client depot limits (M6 on the pricing card, `tblBulkRegionClientLimit`) are for, or how the map relates to them. They were built from the 9 Oct spec so a client can be switched off a depot. Either the Depots sub-view explains itself in one sentence and shows which clients are limited, or it is hidden until someone needs it. Marcus decides (D4); no build until he does.

## 6. Not in this card

- **R1 book time.** Marcus wants a go-live time for the pickup leg (cutoff 1 pm, collections live from 2 pm, delivery next day 8 am), not the existing "pickup minutes before start time". Own card, as decided 10 Nov (D7). Copy-Monday-to-other-days stays on the current card (M12).
- **Collection-only schedules ending at a depot**, mirror of the delivery-only Whakatane case. Roadmap.
- **Flights as linehaul legs** on the flight rating structure (Zimmer; Nelson, Dunedin, Invercargill; Qantas margin). Roadmap.
- **Direct Drive Sameday on the delivery leg** for the new US speeds. Kerran.
- **Nisa's charge-once on the linehaul leg** (#2911). Kerran, sent 11 Nov. Marcus's two-schedules alternative gets its own card later.
- **Collection zone group shows empty.** Not a bug: nothing writes `BulkPickupZoneSchedule` yet (4 Nov spec, B4). Do not mass-set `Active = 1`.
- **Tuesday zones on #2746 / #2761.** Current card: Kevin restores zones 1 to 5 by script and makes adding a weekday copy the zones. Marcus did not know zones live per day row; show him at review.

## 7. Decisions

| # | Decision | Status |
|---|---|---|
| D1 | **Was the 3.7% a deliberate rise on the legs?** Yes: Kerran lifts the rate rows to match and the seed is the leg. No: say when the legs moved; billing on those lanes since then is wrong. | **Open, Kerran.** Asked 11 Nov. |
| D2 | **Read order during transition:** client row, default row, leg Amount. Leg fallback retired after the zero-diff gate. | **Recommended.** Steve to confirm with M0. |
| D3 | **Zones tab:** rename Postcodes, or restructure as zones. | **Open, Marcus.** Recommend rename; the structure he wants is the drawer (ZG1). |
| D4 | **Depot limits:** explain in place, or hide. | **Open, Marcus.** |
| D5 | **Per-client linehaul overrides live on the Linehaul tab** (expand the run), not on the Pricing tab's client sheet. | **Recommended.** One place per price type. |

## 8. Tests (Urgent staging)

1. Linehaul tab, run 285: one row per speed with a default price; expand shows clients with overrides bold and inherited grey; "+ Speed" adds a visible column; no per-schedule price list.
2. Open a schedule on run 285: the leg shows the resolved price, its source, and a link to the run; no editable price field.
3. Quote and book a LIFEH job on a lane with a client override: both equal the override. Clear the override: both equal the default. Re-rate the last 30 days on staging: zero diff against production prices (after D1 is applied).
4. Drawer on Auckland AH Zones: four tabs, no totals banner; Zones tab fills the drawer; Map tab click zone 2 fades the others; click a postcode shape to move it to zone 2; the result lists it as moved.
5. Export Auckland AH Zones to CSV, change one postcode's zone in the sheet, re-upload: preview shows one moved, nothing else; apply; the map and the list agree.
6. Create a new group and add two zones with postcodes from the drawer without visiting the Zones tab.
7. Group list: search "LIFEH" (client), "Hamilton" (depot), "06*" (postcode) each narrow the list.
8. Schedules list: type 2746 and the schedule is the only result. View as client UCLAS: no "All Clients" schedule in the list.
9. Pricing tab: one searchable client box.

## Milestones

| # | Milestone | Done when |
|---|---|---|
| M0 | Linehaul model agreed (LP1) and D1, D2, D5 answered | One-page model posted in Slack, signed by Kevin and Kerran; seed number fixed |
| M1 | LP2 + LP3: Linehaul tab run x speed with client overrides; schedule leg read-only price | Tests 1 and 2 on Urgent staging |
| M2 | LP4 + LP5: rating reads rate rows first; repairs applied; zero-diff gate | Test 3 passes; Kerran posts the diff |
| M3 | ZG1: drawer four tabs, banner gone | Test 4 first half |
| M4 | ZG2: map select, fade and edit | Test 4 second half |
| M5 | ZG3 + ZG4: export and re-upload; new group takes zones | Tests 5 and 6 |
| M6 | ZG6, SP1, SP2, PR1 small items | Tests 7 to 9 |
| M7 | Marcus retests on staging, D3 and D4 applied, release | His sign-off on the Google Doc |
