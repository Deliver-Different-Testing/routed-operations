# Route Viewer: region filtering and where linehaul lives

**For:** Kevin  **From:** Steve (via EasyEA)  **Date:** 8 October 2026
**Repos:** routed-operations (Route Viewer pages, RouteViewerRunService), dbmigrationsv2 (RVW_* procs)
**Status:** decided 8 Oct 2026 (Steve). All three decisions in section 8 are closed; ready to build. Suggested order: section 5 first (operating region), then section 7 option B as its own small piece.

---

## 0. TL;DR

| | |
|---|---|
| **Symptom** | Route Viewer filtered to Region = Burbank (Medical, 8 Oct) lists Central Valley Pick up Route, Hayward Pick up Route 1, RNO200, RNO300 and SMF2-SMF5. None of them operates in Burbank. The Overview counts 50 Burbank jobs, most of which are pickup legs 600 km away. |
| **Cause** | A run is admitted to a region by its jobs' `tblBulkJob.RegionID`. That column is the **schedule's Region**, stamped on every leg of the family, and on Medical every schedule's Region is 38 (the chain terminus, "Burbank"). So a Hayward pickup is a "Burbank" job because its parcel ends up there. |
| **Why it is confusing** | Route Viewer uses three different ideas of region on one screen: family region (real runs, overview, missing list), leg depot (synthetic LHP legs, the Linehaul page) and direction (Inbound / Outbound). Only the second matches what an operator means by "show me Burbank". |
| **Fix** | One definition of a leg's **operating region**: the depot the leg physically departs from or arrives at. Stamp it once on `tucJob.DepotId` for every leg at insert (LHP and LH already carry it; DEL legs get the chain terminus the Feature 5.3 code already computes), then make every Route Viewer proc filter on it. Section 5. |
| **Linehaul placement** | LH legs are excluded from Route Viewer entirely and live only on the Linehaul page. Steve does not think that is good design. Decided: option B in section 7, read-only linehaul in/out rows per region in Route Viewer, actions stay on the Linehaul page, Overview gets its own Linehaul column. |
| **Not changed** | Auto-assign, booking SPs' RegionID stamp (other systems read it), the Linehaul page's own From/To filters. |
| **Added 9 Oct** | Dane's four rules as the acceptance bar; proof from Medical production that child legs cannot be admitted to any region today (9a, with an interim one-liner); linehaul legs found carrying the final-mile RouteId (9b, booking-SP fix); run list must clear on date/region change (9c). |

---

## 1. What the operator sees

Medical production, Route Viewer, date 7 Oct 2026 (US), Region = Burbank, view Combined:

- Overview: Reno 6, MCI Sac 33, Hayward 25, **Burbank 50**.
- Run list (8 runs): Central Valley Pick up Route (Chico to MCI Sac), Hayward Pick up Route 1 (Burlingame to Hayward), RNO200 (Reno), RNO300 (Carson City), SMF2 to SMF5 (Sacramento area to MCI Sac).

Every one of those is a first-mile pickup run in another city. The one run that does operate in Burbank, the new final-mile route "Burbank to Lab" (RouteId 15, Direction 2, DepotId 38), is not there yet because its DEL legs are only assigned from tonight's prebook run onward.

Kevin's chain check (8 Oct) shows why the filter behaves this way: all six Medical schedules (Hayward / Reno / Sacramento to Aliso Viejo, Schedule and Will Call variants, 30 day rows) have `Region = 38`, every chain terminates at depot 38, and all legs carry a LegOrder.

---

## 2. How a job gets a "region" today

| Column | Written by | Meaning | Present on |
|---|---|---|---|
| `tblBulkJob.RegionID` | booking SPs, from `tblBulkRunSchedule.Region` | the schedule's dispatch region. By convention the chain terminus, i.e. where the DEL leg departs. | every leg of the family: parent, LHP, LH1..n, DEL |
| `tucJob.DepotId` | booking SPs | the depot a leg delivers into | LHP legs (pickup depot); LH legs (`tblBulkScheduleLinehaul.ToDepotId`, which `RVW_stpLineHaulRuns` joins on). **Not** stamped on DEL legs today (to confirm on both tenants; the 5.3 migration computes the value but passes it only to the resolver). |
| `tblBulkScheduleLinehaul.FromDepotId / ToDepotId` | Schedules NEW chain editor | the two ends of a linehaul leg | schedule level, per leg |
| `Routes.DepotId`, `Routes.Direction` | Recurring Routes modal (Feature 5.1) | origin depot and first/final mile of a route | route level |

So for a Hayward to Aliso Viejo booking: the LHP leg (shop to Hayward depot) has `RegionID = 38` and `DepotId = Hayward`; the LH legs have `RegionID = 38` and `DepotId` = each leg's arrival depot; the DEL leg has `RegionID = 38` and no `DepotId`.

---

## 3. Current admission rules, surface by surface

All in dbmigrationsv2 unless noted. Line references are to the latest emitter of each proc.

| Surface | Proc / file | Region rule | Direction rule | LH legs |
|---|---|---|---|---|
| Run list, **real** bulk runs (`TblBulkRun`) | `RVW_stpBulkRuns_2` (20260930170700), real-run branch | `tblBulkRegion` joined on **`tblBulkJob.RegionID`**; `@Regions` filters on it | none (`@Group` deliberately not applied, see 170700 header) | excluded (`LIKE '%LH%' AND NOT LIKE '%LHP'`); also excludes any job whose `tucJob.RouteId` is set |
| Run list, **synthetic** route runs | same proc, routed branch | LHP legs: `tucJob.DepotId` (coords fallback). Non-LHP: `tblBulkJob.RegionID` **or** region pickup coords = job pickup coords | `@Group` = Combined / Inbound (`Routes.Direction = 1`) / Outbound (`= 2`) | excluded |
| Missing-jobs rows (unassigned) | `RVW_stpGetMissingJobRuns` (20260930170800) | **`tblBulkJob.RegionID`** | none | n/a |
| Overview table | `RVW_stpRunOverview` (20260617140000) | real-run branch: **`tblBulkJob.RegionID`**; routed branch: LHP by `tucJob.DepotId`, non-LHP by `RegionID` | none | excluded |
| Job rows inside a run (front end) | `wwwroot/app/react/lib/runViewerViewMode.ts` | n/a | Inbound = job number ends `LHP`; Outbound = non-LHP with a delivery point; Combined = all | n/a |
| Linehaul page | `RVW_stpLineHaulRuns` (20260701120300) via `RouteViewerRunService.GetLinehaulRunListAsync` | **From region = `FromDepotId`, To region = `ToDepotId`** of the leg | n/a | **only** LH legs |

Three observations:

1. Four of the six surfaces use the family region. Two use the leg's depot. The Linehaul page is the only one that does what an operator expects, and it is the one page they are not looking at when they filter Route Viewer.
2. The real-run branch has **no** direction handling at all, so the Inbound / Outbound toggle cannot hide a pickup run from the Burbank view either. Kevin excluded real runs on purpose ("dropping real runs from Inbound / Outbound would hide work the operator can still act on"); the reasoning is sound for a tenant whose regions are genuinely separate, and wrong for one where every family carries the same RegionID.
3. The synthetic branch already contains the right rule for LHP legs (depot, then coordinates). This spec extends that rule to everything else rather than inventing a new one.

---

## 4. Why "fix the data" is not the answer

The tempting shortcut is to give each Medical schedule the Region of its pickup city so the families spread across regions. That breaks three things that read `RegionID` as the dispatch region: the DEL leg's departure depot (Bulk Import origin precedence, `BulkImportJobFactory.ResolveRoutedOriginLocal`), the availability functions' region branches, and the Route Builder region filter. RegionID means "where the run is dispatched from" and should stay that way. The display problem is that Route Viewer treats it as "where every leg happens".

---

## 5. Proposed rule: operating region per leg

**Definition.** A leg's operating region is the depot it physically touches:

| Leg | Operating region | Source |
|---|---|---|
| LHP (first-mile pickup) | the depot it delivers into | `tucJob.DepotId` (already stamped) |
| LH (trunk) | both its departure and arrival depots | `tblBulkScheduleLinehaul.FromDepotId` and `.ToDepotId`; `tucJob.DepotId` holds the arrival |
| DEL (final mile), and single-leg jobs | the depot it departs from | chain terminus = `ToDepotId` of the leg with the highest `LegOrder` (exactly the 5.3 lookup); fallback `tblBulkJob.RegionID` when the schedule has no chain |

A run's regions are the union of its jobs' operating regions. A run therefore appears under Burbank only if one of its jobs touches Burbank.

**Implementation, in order of preference.**

1. **Stamp it once, read it everywhere.** Extend the two child-job procs (`DD_` and `WS_stpBulkScheduleJob_InsertChildJobs`, 20260930170300 / 170400) to write `@ICJ_DeliveryOriginDepotId` to `tucJob.DepotId` on the DEL leg, falling back to the schedule Region when the chain lookup returns NULL. Every leg then carries its depot in one column, and the four family-region surfaces change their join from `tblBulkJob.RegionID` to `tucJob.DepotId` with `RegionID` as the fallback for legacy rows. The LH leg gets a second region via `FromDepotId` only where section 7 decides LH legs should appear.
2. Backfill: one migration setting `tucJob.DepotId` on existing DEL legs from the chain terminus of their schedule, same guarded lookup as 170300 (all legs ordered, else leave NULL and let the fallback apply). Idempotent, `WHERE DepotId IS NULL`.
3. Procs to change: `RVW_stpBulkRuns_2` real-run branch (the `breg` join and `@RIDS` predicate), the non-LHP half of its routed branch (prefer `DepotId`, keep `RegionID` and the coordinate test as fallbacks), `RVW_stpGetMissingJobRuns`, `RVW_stpRunOverview` both branches. Same `COL_LENGTH` guards the procs already use.
4. Direction on real runs: with operating-region admission in place, a Hayward pickup run no longer appears under Burbank at all, so the Inbound / Outbound gap on real runs stops mattering for this case. Leave `@Group` as it is. If it is still wanted later, the cheap version is `Inbound` = runs whose admitted jobs are all LHP, `Outbound` = runs whose admitted jobs are all non-LHP.

**Not changed.** `tblBulkJob.RegionID` keeps its meaning and its writers. The resolver (Feature 5.2 / 5.3) is untouched; it already uses the same terminus value, which is the point: one number, computed in one place, now also persisted.

---

## 6. What the Overview numbers will do

This is the one visible side effect and Steve should expect the question from ops. Today Burbank shows 50 because every leg of every Medical family counts there. After the change Burbank counts only the legs that touch depot 38: DEL legs plus LH arrivals if section 7 admits them. Hayward, Reno and Sacramento each gain their pickup legs. The tenant total is unchanged; the split moves to where the work is. Worth one line in the What's New doc.

---

## 7. Where linehaul legs should live (Steve's design concern)

Today LH legs are excluded from the Route Viewer run list and Overview and appear only on the Linehaul page, which filters by From and To depot and carries the trunk actions (manifest CSV, Mode 6 labels, linehaul report, assign courier / NP). Steve's view: a region operator should be able to see the whole day for their depot from one screen, and a separate page for the trunk legs is not great design.

| Option | What changes | Pros | Cons |
|---|---|---|---|
| **A. Leave as is** | nothing | zero work | the Burbank operator never sees what is arriving tonight without changing page |
| **B. Linehaul rows in Route Viewer, actions stay on Linehaul page** (recommended) | each region's run list gets read-only rows "Linehaul in: Hayward to Burbank (n)" and "Linehaul out: ..." built from LH legs whose `FromDepotId` or `ToDepotId` is the selected region; clicking one opens the Linehaul page pre-filtered | one screen per depot; small change (a third branch in `RVW_stpBulkRuns_2` or a second call from `RouteViewerRunService`); Linehaul page keeps its specialist tooling | two places show the same legs; counts in Overview need a separate "Linehaul" column or they double up |
| **C. Merge the Linehaul page into Route Viewer** | the Linehaul tab becomes a view mode of Route Viewer with its actions moved across | one page | large front-end change; the trunk actions (manifests, labels by ToDepot) do not fit the per-run context menu; not before the collapse and F18 |

**Decided 8 Oct (Steve): B.** Build it as its own small piece after section 5, with the Overview gaining a Linehaul column rather than folding LH legs into the region totals. C stays open as a later decision once Route Viewer has settled.

---

## 8. Decisions

All closed by Steve on 8 Oct 2026.

| # | Question | Decision |
|---|---|---|
| D1 | Adopt operating-region admission (section 5) across run list, missing list and Overview? | **Yes.** It is the rule the synthetic LHP branch and the Linehaul page already use. |
| D2 | Linehaul placement: A, B or C (section 7)? | **B.** Read-only linehaul in/out rows per region in Route Viewer; actions stay on the Linehaul page; Overview gets a Linehaul column. |
| D3 | Persist the DEL departure depot on `tucJob.DepotId` or compute it in each proc? | **Persist.** Four procs would otherwise each carry the chain lookup, and the resolver already computes the value at insert. Backfill existing DEL legs per section 5 item 2. |

Nothing open. If the build turns up something the spec did not anticipate, raise it in Slack rather than picking a default.

---

## 9. Acceptance (Medical staging, then production)

**Dane's rules (9 Oct), which are the plain-English statement of this spec and the acceptance bar:**

1. Jobs are assigned to the delivery run day correctly; the problem is filtering, not run assignment.
2. Outbound filtered by depot shows one run that expands into its jobs.
3. Linehauls are not depot inbound. Inbound means pickups in the depot area coming to that depot.
4. Combined shows only routed runs into and out of the filtered depot. Depot staff work from Combined, so it must not drop anything that touches the depot.

**Observed 9 Oct on Medical production, date 16 Oct, Region = Burbank, view Outbound** (screenshots with Steve): Overview counts 45 Burbank jobs; run list is empty after Refresh; before Refresh it still shows the previous date's pickup runs with a "0 runs" counter. Kevin's diagnostic query over `tucJob` rows with `RouteId = 15` on that date returned 72 rows, all **linehaul legs** (LH1 to LH5), every one with `RegionID` NULL (no `tblBulkJob` row of its own) and pickup coordinates that do not equal region 38's stored pair. No DEL legs and no parents carried the RouteId on that date. Two defects fall out, both now in scope:

- **9a. Corrected later on 9 Oct: the primary cause is RouteId stamping, not region admission.** Kevin's full-family query showed DEL legs **do** have `tblBulkJob` rows with region 38, but carry the **parent's pickup route** (5 to 13), never 15, while LH legs carry the parent's route too (15 on the nine families with no pickup match). The audit log has 67 `BookingCreate` delivery rows and **zero** `ChildLegRestamp` rows, so `DD_stpBulkScheduleJob_InsertChildJobs`'s resolver call is not running on Medical production: `@ICJ_DeliveryRouteId` stays NULL, the per-leg cascade's ELSE gives every child the template's route, and LH legs are caught because the Bug 2.2 exclusion (`c.LinehaulRunID IS NULL`) is true on them. That is why the pickup runs appear under Burbank: the Burbank DEL legs are members of those synthetic runs. **Fix the stamping first** (live body vs `20261007120000`, then the guard inputs); it is a booking-SP defect, not a viewer one. The parent-lookup one-liner `bjr.JobID IN (j.ucjbID, j.ParentID)` remains a sensible fallback under section 5 for child legs without their own bulk-job row, but it is not what was hiding Burbank to Lab.
- **9b. Linehaul legs carry a RouteId.** Same root cause as 9a. Bug 2.1 inserts LH legs with `RouteId NULL`; the cascade re-stamps them because they have no `LinehaulRunID`. Once ChildLegRestamp runs, DEL gets the delivery route; LH legs still need the exclusion widened to job number (`NOT LIKE '%LH%' OR LIKE '%LHP'`) or they keep inheriting the pickup route.
- **9c. Front end:** the run list must clear when the date or region changes, not only on Refresh. The stale pickup runs in the first screenshot are the previous date's result set.

```sql
-- 9c: every leg of the 16 Oct families, with what each carries
SELECT j.ucjbNumber, CONVERT(date, j.ucjbDate) AS JobDate, j.RouteId, j.DepotId, j.ParentID,
       bj.RegionID
FROM dbo.tucJob j
LEFT JOIN dbo.tblBulkJob bj ON bj.JobID = j.ucjbID AND ISNULL(bj.Void,0) = 0
WHERE (j.ucjbNumber LIKE 'P48%' OR j.ucjbNumber LIKE 'P49%')
  AND j.ucjbDate >= '2026-10-15' AND j.ucjbDate < '2026-10-18'
ORDER BY j.ucjbNumber;
```

**Acceptance steps:**

1. Region = Burbank, Combined: the run list shows "Burbank to Lab" (once its DEL legs exist) and any real run whose jobs touch depot 38. None of Central Valley, Hayward Pick up Route 1, RNO200/300, SMF2-5 appear.
2. Region = Hayward: Hayward Pick up Route 1 appears; "Burbank to Lab" does not.
3. Overview: Burbank total equals the count of DEL legs departing depot 38 for the date (plus LH arrivals only if D2 = B with its own column). The sum across regions equals the tenant total before the change.
4. Missing-jobs rows obey the same rule: an unassigned DEL leg from depot 38 shows under Burbank; an unassigned LHP into Hayward shows under Hayward.
5. NZ regression: on a tenant where every schedule's Region equals the depot its legs touch (Urgent), the run list and Overview are unchanged for a sample of three dates. Diff the two proc outputs before and after.

Read-only checks for Kevin while building:

```sql
-- DEL legs with no DepotId today, by schedule (expect: all of them before the backfill)
SELECT s.ScheduleId, h.Name, COUNT(*) AS DelLegsNoDepot
FROM dbo.tucJob j
JOIN dbo.tblBulkJob bj ON bj.JobID = j.ucjbID AND ISNULL(bj.Void,0) = 0
JOIN dbo.tblBulkRunSchedule s ON s.BulkRunScheduleId = bj.ScheduleID
JOIN dbo.tblBulkRunScheduleHeader h ON h.ScheduleId = s.ScheduleId
WHERE UPPER(RTRIM(j.ucjbNumber)) NOT LIKE '%LH%'
  AND j.DepotId IS NULL
  AND j.ucjbDate >= DATEADD(day, -7, GETDATE())
GROUP BY s.ScheduleId, h.Name
ORDER BY DelLegsNoDepot DESC;

-- After the change: what Burbank admits for a date
SELECT j.ucjbNumber, j.DepotId, bj.RegionID
FROM dbo.tucJob j
JOIN dbo.tblBulkJob bj ON bj.JobID = j.ucjbID
WHERE CONVERT(date, j.ucjbDate) = '2026-10-09'
  AND (j.DepotId = 38 OR (j.DepotId IS NULL AND bj.RegionID = 38))
ORDER BY j.ucjbNumber;
```

---

## 10. Out of scope

- Changing what `tblBulkJob.RegionID` means or who writes it.
- The Inbound / Outbound toggle on real runs (section 5, item 4), unless D2 = C.
- Route Builder's region filter, which is being changed separately under the schedule-origin spec (it admits by `OriginRegionId` for client-origin schedules).
- Any change to the resolver.
