# Schedules release: go-live gate and the changes decided 19 Oct

**For:** Kevin Chen, George Hampton · **From:** Steve Bonnici · **Date:** 19 Oct 2026 · **Status:** go-live deferred; this is the gate

## 1. Decision

No production click this week. Too much is untested. The Urgent production migration job (and Medical's)
stays unclicked until every row in section 3 is green on staging. When it runs, it runs mid-morning NZ time
with Kevin and George on hand, never overnight: the US tenants are in their working day on the same SQL
Server instance, and nobody is here if the gate or the probe says something.

## 2. What changed today

| # | Change | Why | Owner |
|---|---|---|---|
| 1 | **6.4 joins the migration set**: collection zone ticks gate the From postcode, same mechanics as 6.3 (pricing spec section 6.4). An unedited schedule stays open to its whole pickup group; a schedule with ticks is limited to them. | The function reads only `PickupPostcodeGroupId` today and never `BulkPickupZoneSchedule`, so the ticks on the Collection card are display-only. Marcus (19 Oct): a tick that does nothing is worse than no tick. Deferral gives the time to make it real rather than hide it. | Kevin |
| 2 | **#2900 Value Tyres Direct flip** is a script in the same set, not SSMS. | Journalled and repeatable; the app that could do it waits on F24. | Kevin |
| 3 | **No Urgent staging refresh this week.** #950 Fresh Connection (PickupDepotId 21 Whangarei) and #1591 Napier Hastings (PickupDepotId 8 Auckland) are restored by hand on staging across their five day rows. | A refresh was the clean way to undo the F24 wipe, but it is not happening this week and the two schedules are the F24 test cases. | Kevin |
| 4 | **The real V1 gate run is the production click.** Every staging copy already has the collapse, so `tblMigrationCheckLog` on staging will show SKIPPED for the gate. Evidence beforehand: Kevin's local run (21 of 21 recomputed, two true-14 rows untouched) and the clean run on the production-shaped Staging-3 copy. | Accepted trade for not refreshing. | Steve |
| 5 | **Staging migration jobs run now.** The app is on staging without the migrations, so Schedules NEW returns 500 until `urgent-staging` and `medical-staging` run from the current master pipeline. | Kevin, 16:59. | George |
| 6 | **One F23 schedule joins the retest list**: #2539 Wellington Afternoons or one of the six Standard Baggage Run 7pm schedules. | The cutoff half of F23 changes 57 day rows on 11 schedules, none of them in Anisah's ten. | Anisah |
| 7 | Decisions already in Kevin's merge: stray `tblSchedulePostcode` row deleted; F25 is read-only effective value and source with an edit link into the existing override editor and Remove override beside it, no second input; 6.2 in all six prebook sites; 6.3 out of prebook. | Kevin, 16:59. | done |

What is on staging after row 5: Routed Ops develop (!87: F23, F24, F25, Direct, collapse UI) and dbmigrationsv2 master through !246 (6.2 default suppression, 6.3 zones on every speed, identity rows 1 and 2, `tblJobBooking.ScheduleHeaderId`). Admin Manager's F25 half (!178) is its own manual deploy.

## 3. Gate: all green on staging before the production click

| # | Test | Who | Green when |
|---|---|---|---|
| G1 | Staging migrations in; Schedules NEW list and detail load; `tblMigrationCheckLog` has rows for the gate (SKIPPED) and the probe (timings). | George, Kevin | Rows present; probe under 2,000 ms on the warmed plan for the five pairs. |
| G2 | #950 and #1591 restored; rename-and-save each; add a Depot leg to a delivery-only schedule and save. | Kevin restores, Anisah tests | Client Manager still shows Whangarei and Auckland; both still offered on the booking page with the same dates; the Depot leg persists. |
| G3 | Anisah's ten collapse schedules retested with F23 and F25 in, plus one F23 cutoff schedule (row 6). | Anisah | Preview and booking page agree at any time of day; HARBT's override is visible on the Clients tab and removing it gives five dates. |
| G4 | 6.2 on staging: Value Tyres Whakatane to Tauranga offers #2900 only; a client with no linked schedule still sees the default. | Anisah | As stated. |
| G5 | 6.3 and 6.4 on staging: a schedule with delivery zones ticked on a P2P speed refuses a postcode outside them; a schedule with collection zones ticked refuses a From postcode outside them; schedules with no ticks book as before. | Anisah | As stated. |
| G6 | The 13-client review finished (two runs done 17 Oct: four redundant custom schedules to delete; nine schedules remain) and ops told about the 6.2 redirect (about 27 bookings a day move onto client schedules). | Anisah, Steve | Reply per schedule, widened or deliberate; ops email sent. |
| G7 | Faro booking payload replayed against staging (George's Postman call, or Liz from Faro's staging) books onto the right schedule and day. | George, Marcus | Job lands on the schedule id Faro sent, same start time. |
| G8 | Shopify checkout on the test store returns Urgent rates, after the shop's access token is reinstalled. | George, Dane | Carrier callback reaches the staging app and returns windows. |
| G9 | One 18:00 stats cycle on staging with the full set in, no rate timeouts, availability probe timings steady. | Garry, Kevin | Booking log clean through 21:00. |

## 4. Production click, when the gate is green

1. Mid-morning NZ, Kevin and George on hand, Garry's alarm live.
2. George clicks `urgent-production`. It is one transaction of every pending script (about 35, including Kerran's, Garry's and Jacob's); the V1 gate can roll all of it back, which is what we want.
3. Read `tblMigrationCheckLog`: gate PASS with the row counts, probe timings for the five pairs.
4. Deploy the Routed Ops app (manual job) only after the migration job succeeded.
5. Anisah books a Value Tyres return on production and confirms #2900 Direct is offered.
6. The 18:00 stats job that evening is the acceptance for the rating-proc fix: no Rates timeouts in the booking log.
7. Medical production follows on a later day, same shape, 25 scripts, after Kevin's after-numbers.

## 5. Standing rules this surfaced

- No production changes overnight. Tenant jobs are deliberate clicks by the person who owns the pending scripts, mid-morning NZ.
- No renames of schedules used by API clients until identity rows 3 and 4 land.
- Ops do not retire the "PU Regional Tauranga" pickup groups until 6.4 is live.

## Milestones

| # | Milestone | Done when |
|---|---|---|
| M1 | Staging carries the full set | Row 5 done; G1 green. |
| M2 | 6.4 and the #2900 script merged | Both on dbmigrationsv2 master and applied on staging. |
| M3 | F24 test cases restored | #950 and #1591 carry their pickup depots on staging. |
| M4 | Anisah's retest green | G2 to G5. |
| M5 | Ops review and notice done | G6. |
| M6 | Integrations green | G7 and G8. |
| M7 | Stats cycle green | G9. |
| M8 | Urgent production live | Section 4 steps 1 to 6 done. |
| M9 | Medical production live | Section 4 step 7 done. |
