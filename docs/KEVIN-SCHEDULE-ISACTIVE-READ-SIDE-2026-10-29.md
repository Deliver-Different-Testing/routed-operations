# Schedule "Active" switch: wire the read side (Kevin)

_Steve Bonnici (with EasyEA), 29 Oct 2026. Owner: Kevin. Size: half a day including the staging run. Coded; Kevin reviews, runs the pre-apply counts and merges._

## 1. Report

Anisah, 29 Oct, "Routed ops schedules: Turning off a schedule not working?": Farro schedule 899 and her own UCLAL schedule 770 switched off in Routed Ops, both still offered on the booking page. Her screenshots show the list toggle off for 899 and the editor's "Next runs offered" still listing three dates with Active unticked. Her interim fix (899 reassigned to the unused Sparkle speed) is safe and stays until this is live.

## 2. Cause

F21 (`20260922122000`) added `tblBulkRunScheduleHeader.IsActive` because the old toggle wrote AutoBook. The write side shipped in Routed Ops (`ScheduleService.ToggleIsActiveAsync`, editor save, override editor to `tblBulkRunScheduleOverride.IsActive`) and the list reads it. No read path was ever wired:

| Path | Latest emitter | Header test today |
|---|---|---|
| `UTL_fncJob_GetClientAvailableBulkRunSchedule` (NZ booking page) | 20261016170000 | `RetiredUtc IS NULL` only |
| `DD_fncJob_GetClientAvailableBulkRunSchedule` (US booking page) | 20261027170000 | `RetiredUtc IS NULL` only |
| `uspPrebookSet` (nightly recurring), six header joins | 20261028170000 | `RetiredUtc IS NULL` only |
| `ScheduleService.PreviewOccurrencesAsync` ("Next runs offered") | Routed Ops master | none |

Every availability emitter since the header FK join (20260908) was checked. The `IsActive` strings in them are all `UTL_fncBulkZonePostcode_IsActive`, the zone function. Bulk import (`BookableSchedules.cs`) is the one consumer that already applies `COALESCE(override, header)`.

## 3. Rule

```
bookable = h.IsActive = 1 AND COALESCE(client override IsActive, 1) = 1
```

Header off wins for everyone ("Active: schedule is bookable at all"). A client's own override can switch a shared schedule off for that client only; an override of 1 cannot resurrect a header of 0. `fnScheduleForClient` already resolves `COALESCE(ov.IsActive, h.IsActive)`, so with the header at 1 a 0 reading can only be that client's override.

## 4. The code

### dbmigrationsv2 `20261029150000_ScheduleIsActive_ReadSide.sql`

Branch `fix/schedule-isactive-read-side` on GitHub `Deliver-Different-Testing/dbmigrationsv2` (from gitlab.com master e391ef7). Three full-body re-emits, every change marked `20261029150000`:

- Both availability functions: `AND h.IsActive = 1` on the two candidate branches (cross-region, standard), then one `DELETE` on the candidate table for rows whose `fnScheduleForClient(t.ScheduleId, @ClientID)` reading has `IsActive = 0`, placed next to the existing CROSS APPLY so both reads share a step.
- `uspPrebookSet`: the same two predicates on all six header joins (`@CurClientID` is the booking's client in every one). Four of the six are the next-date search; with the schedule off it finds no date, which the proc already handles as "no matching day row".
- Plan flush (`sp_recompile` on the three objects) and `procRefreshAllViews` at the end.

Diffed against the baselines: only the marked lines differ. Kevin's checks before apply, per tenant:

```sql
SELECT COUNT(*) AS HeadersOff FROM dbo.tblBulkRunScheduleHeader WHERE IsActive = 0 AND RetiredUtc IS NULL;
SELECT COUNT(*) AS OverridesOff FROM dbo.tblBulkRunScheduleOverride WHERE IsActive = 0;
```

These are the schedules whose behaviour changes on apply. Expect a handful on Urgent prod (899, 770 among them) and zero or near it elsewhere.

### routed-operations, same branch name, two files

- `Core/Application/Services/Schedule/ScheduleService.cs`: `PreviewOccurrencesAsync` returns an empty list when the header is inactive.
- `wwwroot/app/react/components/schedules-new/ScheduleDetailModal.tsx`: the preview reads the Active box (or the override's) and shows "Switched off. The booking page will not offer this schedule until Active is ticked again." in place of the date list, before Save, the same way the rest of the preview tracks unsaved edits. New test id `schedule-occurrences-inactive`.

Pushed to GitHub only (no GitLab push from here). The e2e test `schedule-collapse.spec.ts` line 362 expects "Next runs offered" on an active schedule, unaffected.

## 5. Test plan (Urgent staging)

1. Schedule off in Routed Ops, client books on the booking page: not offered. On again: offered. The editor's preview shows the switched-off line while off.
2. Shared schedule with two linked clients, one client's override Active off: gone for that client, still offered to the other.
3. Recurring booking on a schedule switched off: no job that night; on again: prebooks. Use a create-ahead booking so the result is visible the next morning.
4. Untouched schedule: no change on booking page, preview or prebook.
5. US tenant (Medical staging): step 1 on a US schedule proves the DD function.

## 6. Open with Steve

None. Anisah's Sparkle reassignment on 899 should be reversed once this is on Urgent prod, otherwise the schedule stays hidden by the speed filter after it is switched back on.

## Milestones

| # | Milestone | Done when |
|---|---|---|
| M0 | Kevin reviews both branches, runs the pre-apply counts | counts posted in Slack; migration and app change merged to gitlab.com master |
| M1 | Urgent staging apply + test plan 1-4 | switched-off schedule gone from booking page, preview and nightly run |
| M2 | Medical staging, test 5 | DD function honours the flag |
| M3 | Urgent prod apply; reply to Anisah; 899 moved back off Sparkle | Anisah confirms 899 and 770 stay hidden |
