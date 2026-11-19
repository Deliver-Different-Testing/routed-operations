# Schedules NEW: Marcus's feedback on the 16 Nov release

- **For:** Kevin (Routed Operations)
- **From:** Steve, 19 Nov 2026
- **Status:** Not started
- **Repo:** routed-operations (GitLab is the source of truth; this doc is on the GitHub mirror)
- **Source:** Marcus's Google Doc "16/11/26 Release", section "Schedules NEW: November feedback (rounds 1 and 2)", tested on Urgent production
- **Related:** `docs/SCHEDULES-NEW-ROUND2-ZONE-GROUPS-PRICING-2026-11-11.md` (branch `docs/schedules-new-round2-2026-11-11`), `docs/KEVIN-FINAL-MILE-ROUTE-SETUP-MASTER-OPTIONAL-SCHEDULE-FILTER-2026-11-18.md`

## 1. What Marcus found

Eight test steps. Three pass, one is a production error, four need work or an answer.

| # | Test step | Marcus's result | What happens to it |
|---|-----------|-----------------|--------------------|
| 1 | Untick a weekday and save | **Error.** "HTTP 500 at /api/v2/schedules/71" | F1, urgent |
| 2 | Copy a schedule | Works | Nothing |
| 3 | Different zones on different days | "I don't know what this means" | No build. Section 4 |
| 4 | Copy Monday to other days | Works on an existing schedule, missing on New Schedule | F2 |
| 5 | Hide default schedules | Works | Nothing |
| 6 | Recurring route schedule picker | Works, "but we still see all schedules nationwide for every route" | Already built, section 4 |
| 7 | Zone groups: CSV export, move a postcode | Both work. No way to re-import the CSV. The move panel "is workable but not beautiful" | F4 (re-import). Panel stays in round 2 |
| 8 | Bundles: client on an empty bundle | No Save button, no warning seen, client not added | F3 |

## 2. F1 (urgent): removing a weekday fails on Urgent production

### 2.1 What happened

Marcus opened schedule #71 "Afternoon Delivery (Between 12pm-5pm)", unticked Tuesday and pressed Save. Two attempts, both 500, 18 Nov 20:48 UTC.

From the Urgent production log (`routed-operations-835-urgent-prod`):

```
SqlException: The SELECT permission was denied on the object 'ShopWindow',
database 'Despatch-Urgent-Prod', schema 'dbo'.  (Error 229)
  at ScheduleService.ReferencedDayRowIdsAsync  ScheduleService.cs:line 2213
  at ScheduleService.SyncDayRowsAsync          ScheduleService.cs:line 1886
  at SchedulesV2Controller.Update              SchedulesV2Controller.cs:line 430
```

### 2.2 Cause

`ReferencedDayRowIdsAsync` (added 11 Nov for the 2920 / 2921 Bulk Import fix) runs raw SQL over `dbo.ShopWindow`, `dbo.tblRouteSchedule`, `dbo.tblBulkJob`, `dbo.tucJob`, `dbo.tucJobArchive` and `dbo.tucJobBooking`. The Routed Operations database user on Urgent production has no SELECT on `dbo.ShopWindow`. dbmigrationsv2 master grants `ShopWindow` to `IntegrationManager` only (`20261102140000`).

So this is not about schedule #71. **Every save that removes a weekday fails on Urgent production**, and on any other tenant with the same grants. Nothing is written, because the query throws before the save.

### 2.3 Fix

1. Name the database principal Routed Operations connects as on each tenant.
2. One dbmigrationsv2 migration granting that principal SELECT on every object `ReferencedDayRowIdsAsync` reads. Check all six, not just `ShopWindow`: the first failure hides the rest. Guard each grant on the object and the principal existing. Garry runs it.
3. Run the `dfrnt-db-grants-check` style check for the rest of the raw SQL in Routed Operations (for example `RecurringRouteService.cs` line 637 on `dbo.tblRouteSchedule`), and list anything else not granted.
4. The save must not show a bare "HTTP 500". If the reference check cannot run, refuse with: "This day could not be removed because the system could not check what still uses it. Nothing was saved." Log the real error with the MessageId.
5. Do not make the check fall through to "not referenced" on error. That would delete a day row a shop window or route still points at.

### 2.4 Why staging did not catch it

Answer at M0: does the staging user have the grant that production lacks? If yes, say how the two drifted and whether the release checklist needs a grants step.

## 3. Changes to build

### 3.1 F2: Copy Monday to other days on New Schedule

- Today the button is only in `ScheduleDetailModal.tsx` (Operating days tab, line 2718). `NewScheduleModal.tsx` (Operating days + cut-off, line 596) does not have it. Marcus: creating a schedule is when it is needed most.
- Add the same button to the New Schedule day grid, using the existing `copyMondayToOtherDays` in `lib/copyMondayToDays.ts`. The New Schedule day state already has `enabled`, `startTime`, `endTime`, `cutoffDay`, `cutoffTime`, so no new logic.
- Same label, same tooltip, same rule: other ticked days only, cut-off weekday shifted per day, disabled when Monday is not ticked.
- Add **Tick Mon to Fri** beside it, in both modals. On a new schedule only Monday is ticked, so without it the copy has nothing to copy to. It ticks the five days and nothing else.

### 3.2 F3: Bundle modal says what it is doing

Code today (`BundleModal.tsx` lines 337-394): the bundle saves on every action, with no Save button. On an empty bundle the Add button is disabled and one grey line says "This bundle has no schedules yet. Add a schedule before adding clients." The client picker still opens and lets you choose a client, which is what Marcus did. The refusal is there but he could not see it.

1. Empty bundle: disable the client picker itself, not just Add.
2. Replace the grey line with an amber notice above the picker: "Add a schedule to this bundle first. Clients can only be added once it has one." with the **+ Schedule** button beside it.
3. Under the title: "Changes save as you make them." No Save button is added.
4. Every add, remove and rename shows the standard success toast ("Client added to bundle" and so on). Check each mutation has one.
5. The server refusal in `ScheduleService.cs` line 3905 stays as the backstop.

### 3.3 F4: Zone group CSV re-upload, pulled forward

This is ZG3 in the round 2 spec, unchanged: re-upload the exported `Zone,Postcode,Suburb` file, preview added / moved / removed / unrecognised, nothing written on a parse error, apply on confirm. Marcus has now asked for it twice. It does not depend on the linehaul pricing work (round 2 M0 to M2), so it moves into this card. Mark ZG3 in round 2 as "done under the 19 Nov card" when it ships.

Not pulled forward: the move panel layout. Marcus calls it workable. It is replaced by the drawer and map edit in round 2 (ZG1, ZG2), so restyling it now is wasted work.

## 4. No build needed

- **Step 3, zones per day.** Marcus is right that the screen has no way to set different zones on different days. The message only appears on old schedules whose days ended up with different zones from the merge (for example #2746 and #2761, repaired on 10 Nov). It stops a save from silently overwriting them. At M0: count the schedules on Urgent production where it would still fire. If the count is zero, drop the step from test notes. If not, post the list so Marcus can pick the right set for each.
- **Step 6, schedules nationwide.** Built and merged to develop on 18 Nov (`3af55fa`, "Only schedules covering this route's postcodes"). It was not in the 16 Nov release. It reaches Marcus with the next release; add it to that release's test steps.

## 5. Decisions

| # | Question | Answer | Status |
|---|----------|--------|--------|
| D1 | Pull the CSV re-upload forward from round 2? | Yes | Steve's default, confirm |
| D2 | Add "Tick Mon to Fri" with the copy button? | Yes | Steve's default, confirm |
| D3 | F1 goes out as a hotfix, ahead of the rest? | Yes | Steve's default, confirm |

## 6. Tests and done-when

1. Urgent production: schedule #71, untick Tuesday, save. Saves, Tuesday is gone, Bulk Import for a linked client still uploads.
2. Same save on a tenant where the grant is deliberately missing (local or staging): the plain-words message, not "HTTP 500". Nothing is written.
3. Untick a weekday a shop window or route still uses: the day row is kept, as today.
4. New Schedule: tick Mon to Fri, set Monday, Copy Monday to other days. Tue to Fri take Monday's window and cut-off time, with the cut-off weekday shifted. Create. The saved schedule matches.
5. New Schedule with Monday unticked: the copy button is disabled.
6. Empty bundle: the client picker is disabled and the amber notice shows. Add a schedule: the picker enables and a client adds with a toast.
7. Export a zone group, change one postcode's zone in the sheet, re-upload: preview shows one moved and nothing else. Apply. List and map agree.
8. Re-upload a file with a bad row: nothing is written and the row is named.

Unit tests for the copy helper on the New Schedule state and for the CSV diff. One Playwright flow each for F2 and F3, per the repo testing rule.

## 7. Milestones

| # | Milestone | Done when |
|---|-----------|-----------|
| M0 | Checks, read-only, posted before building | Routed Ops database principal named per tenant; every object in `ReferencedDayRowIdsAsync` checked for SELECT on Urgent production and staging; other ungranted raw SQL listed; 2.4 answered; count of schedules with differing zones per day posted |
| M1 | F1 hotfix | Grant migration merged and run by Garry on Urgent production; plain-words refusal in place; tests 1 to 3 pass; Marcus retests #71 |
| M2 | F2 Copy Monday on New Schedule | Tests 4 and 5 pass |
| M3 | F3 Bundle modal | Test 6 passes |
| M4 | F4 CSV re-upload | Tests 7 and 8 pass |
| M5 | On staging | Marcus retests steps 1, 4, 7 and 8 from his doc, plus step 6 with the coverage filter |
| M6 | Released | Production, release notes |
