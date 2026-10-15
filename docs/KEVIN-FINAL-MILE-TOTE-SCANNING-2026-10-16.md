# Final Mile Tote Scanning - Spec

_Author: Steve Bonnici (with EasyEA) - 2026-10-16_
_Owner: Kevin. Status: design agreed with Steve 16 Oct 2026 (decisions D1-D4 in section 3). Baselines are "latest emitter on master at build time"; anything marked **to confirm** was not measured on a tenant DB._
_Extends: `FINAL-MILE-RECURRING-ROUTES-SPEC-2026-09-25.md` (same folder) and the Phase 5 linehaul tote flow (dbmigrationsv2 `2026062910..20261014172000`)._

## 1. Problem

Kenneth (Medical, Tenant 8) cannot scan totes on the final-mile leg. The final-mile route (route 15 "Burbank to Lab", `Direction = 2`, `DepotId = 38`) now claims the `DEL` legs, but at Burbank the driver app only offers the ordinary per-item Pickup Scan on each `DEL` job, and at the lab the ordinary per-item Deliver. One, two or three sealed totes come off the flight, go into the delivery vehicle, and go to one lab. Kenneth has to scan every item in every tote twice instead of scanning the totes.

Expected (Steve, 16 Oct): on the final-mile leg, if the freight is in a tote, scan the tote on at the depot and scan the tote off at the lab. If there is no tote, scan the items as today. The lab decides whether it accepts sealed totes or wants each item scanned out; that choice lives on the final-mile master job.

## 2. Root cause (verified in code, 16 Oct 2026)

1. **Totes are scoped to a linehaul run, not a leg.** `tblLinehaulTote.LinehaulRunId` is an FK to `tblbulkLinehaulRun` (`20260629100000`). `MARSWS_stpLinehaulTotePickup` fans PickedUp over `tucJob WHERE LinehaulRunId = @RunId AND RootParentId IN (tote roots)` (`20261014171000`). `MARSWS_stpLinehaulToteInwards` completes legs with the same predicate (`20261014170000`). A `DEL` leg carries `tucJob.RouteId` and `LinehaulRunId NULL` (25 Sep spec 3b; trunk-leg exclusion `20261009163000`), so no tote proc can reach it.
2. **The driver app only opens the tote screens from a linehaul master.** `JobDetailPage.cs` routes Pickup to `LinehaulTotePickupPage` and Deliver to `LinehaulInwardsPage` only when `SelectedJob.MasterLinehaulRunId` is set (the `<LHM>` node, emitted by `MARS_stpJobMessages` for the `IsLinehaulMaster` booking). A `DEL` leg is an ordinary job: Pickup Scan per item, then `CompleteDeliveryPage`.
3. **The flight tote is dead on arrival.** Linehaul inwards at Burbank sets `IsClosed = 1`, `ClosedAt`, `InwardedAt` on the tote. Tote pickup rejects a closed tote with `TOTE_CLOSED` (`20260708110000`). Even from the More menu, the same physical tote cannot be picked up again.
4. **The 14 Oct assignment guard** (`NOT_ASSIGNED`, `20261014171000`) requires a live linehaul master on the tote's run assigned to the courier. A final-mile courier never has one.

So the `DEL` leg is correct; what is missing is a tote lifecycle that continues past linehaul inwards onto the final-mile leg.

## 3. Decisions (Steve, 16 Oct 2026)

| # | Decision |
|---|---|
| **D1** | The design case is a **sealed tote that travels through**: packed and sealed at origin, off the flight, through the depot, onto the final-mile vehicle, to the lab. Same physical tote, same barcode, same membership. A repack at the depot is allowed but is the exception (section 4.7). |
| **D2** | The **final-mile run has a master job**, like a linehaul run. Steve: it already exists on the recurring route. Code check 16 Oct: master linking exists only for linehaul runs (`tucJobBooking.IsLinehaulMaster` + `LinehaulRunId`, `RecurringLinehaulService.ApplyMasterBookingAsync`); `Routes` has no master binding, and `RecurringRouteService` / `RecurringRoutesController` have no master endpoint. Section 4.1 defines the final-mile master on the same mechanism keyed on `RouteId`. **Resolved 16 Oct (Steve):** the "Burbank to Lab" recurring booking on route 15 is the final-mile master. Promote that booking (`IsLinehaulMaster = 1`, `RouteId = 15`, `LinehaulRunId NULL`); do not create a second one. Its daily realised job is the master Kenneth opens. |
| **D3** | **Delivery mode is per final-mile master**: *Accept sealed totes* (scan the tote, every shipment inside is delivered) or *Scan each item out* (scan the tote, then every item). Stored on the master booking (section 4.4), sent to the handset with the master. |
| **D4** | **Kevin builds all of it**: DB (dbmigrationsv2), marsapi, driver app (JupiterMaui), Routed Operations UI. |

## 4. Design

### 4.1 The final-mile master

Reuse the linehaul master mechanism, keyed on the route instead of the run:

- Master booking = `tucJobBooking WHERE RouteId = @RouteId AND IsLinehaulMaster = 1 AND LinehaulRunId IS NULL`. The flag is reused (not renamed); the key column `tucJobBooking.RouteId` already exists (`20260519104500`). Single-master-per-route invariant is enforced in app code on save, exactly as `ApplyMasterBookingAsync` does for runs (demote the prior master, promote the new one). No filtered index on `tucJobBooking` (legacy-table policy, `20260626140000`); add a plain composite index on `(RouteId, IsLinehaulMaster)`.
- The realised master job each day is the `tucJob` whose `BookingParentID` is that booking. It inherits the route's rostered courier from `Dispatch_RouteRoster` via `uspPrebookSet` as any route booking does. Dispatch sends the master to the final-mile driver; that courier is the **authoritative assignment** for the tote guards (same rule as `20261014171000`).
- `MARS_stpJobMessages` emits a new trailing column `FinalMileRouteId` (NULL except on the master) plus `FinalMileDeliveryMode` (section 4.4). marssenderservice emits them as `<FMM>` and `<FMD>`, next to `<LHM>`. The handset routes on `<FMM>` as it routes on `<LHM>` today.
- `ConfirmAllRemainingItems` rule 6a (`20260928170000`): the final-mile master joins the forced-scan, bulk-off set (it already catches `DEL` by suffix; add "is a final-mile master").

### 4.2 Tote lifecycle: continue past inwards

Today a tote has one binding, `LinehaulRunId`, and `MARSWS_stpLinehaulToteScanItem` rebinds it leg by leg along the depot chain (`20260630140000`). The final-mile leg becomes one more binding, held in a new column so the linehaul predicates are untouched:

| Column on `tblLinehaulTote` | Meaning |
|---|---|
| `FinalMileRouteId INT NULL` FK `Routes(RouteId)` | set at linehaul inwards when the tote continues onto a final-mile route (below); the tote is "bound to the final-mile leg" |
| `FinalMilePickedUpAt DATETIME NULL`, `FinalMilePickedUpByCourierId INT NULL` | set by final-mile tote pickup |
| `DeliveredAt DATETIME NULL`, `DeliveredByCourierId INT NULL` | set by final-mile tote delivery (either mode) |

**Transition at linehaul inwards** (`MARSWS_stpLinehaulToteInwards`, `...ToteInwardsItem` Done path, `...ToteInwardsClose`, `...LocationReceipt` tote path; baseline `20261014170000`): after the existing leg completion and `InwardedAt` stamp, and **before** the close:

```
continues = every active root of the tote has exactly one live DEL leg
            (ucjbJobNumber LIKE '%DEL', ucjbVoid = 0, ucjbJobDone = 0)
            whose RouteId R satisfies Routes.Direction = 2
            AND Routes.DepotId = the run's ToDepotId (the depot just scanned)
            AND R is the same for every root
```

- `continues` -> `FinalMileRouteId = R`, `IsClosed` stays 0, `ClosedAt` stays NULL. `InwardedAt` is still set, so the **linehaul master completion rule is unchanged** (`20260706120000` anchors on `InwardedAt`, not `IsClosed`).
- otherwise -> close as today. A mixed tote (roots going to two final-mile routes, or some with no final-mile leg) is closed and its items are handled individually. This is the only safe answer without a repack; it is reported in the result as today's `LEG_COMPLETE` (shape unchanged) and the app shows "Tote closed - items continue individually".

`MARSWS_stpLinehaulToteMarkInwardedAndDeriveMaster` is unchanged.

**What reads `IsClosed` and why this is safe:** tote pickup (`TOTE_CLOSED` guard), manifest (`Closed` flag), the reconcile and inwards procs. A continuing tote stays open on purpose so that final-mile pickup can accept it; the linehaul pickup guard additionally refuses it with `WRONG_RUN` because the run master is not the driver's (section 4.3 adds an explicit `FINAL_MILE` result instead, so the message is right).

### 4.3 Final-mile pickup at the depot

New proc `MARSWS_stpFinalMileTotePickup (@ToteBarcode, @CourierId, @MasterJobId INT = NULL)`. Body mirrors `MARSWS_stpLinehaulTotePickup` (baseline `20261014171000`: one transaction, `XACT_ABORT ON`, audit outside it) with the leg predicate changed:

| Result | Rule |
|---|---|
| `NO_TOTE` | unknown barcode |
| `NOT_FINAL_MILE` | `FinalMileRouteId IS NULL` (tote never continued, or already closed) |
| `TOTE_CLOSED` | `IsClosed = 1` |
| `WRONG_ROUTE` | master's `RouteId` (via `tucJobBooking`) <> `FinalMileRouteId` |
| `NOT_ASSIGNED` | same rule as `20261014171000`: opened from a master -> that master's `ucjbCourierID = @CourierId`; Menu path (`@MasterJobId NULL`) -> adopt the single live final-mile master for `FinalMileRouteId` assigned to this courier, else refuse. Never guess between several. |
| `PICKED_UP` | fan `ucjbStatus = 5` over `tucJob WHERE RouteId = FinalMileRouteId AND ucjbJobNumber LIKE '%DEL' AND RootParentId IN (tote roots) AND ISNULL(ucjbStatus,0) < 5`; stamp `FinalMilePickedUpAt/By`, `MasterJobId`; device push `<ST>5</ST>` for every advanced leg on a device (same block as today); audit `tblBulkScan` ScanType 27 with payload `TOTE:..|FMR:<routeId>|PU:n` |

Counts returned: `PickedUpToteCount` / `RunToteCount` = totes with `FinalMileRouteId = R`, `InwardedAt` on the master's run date, `DeliveredAt IS NULL` (display aid, "Picking Up (X of Y totes)" as today).

Add the mirror guard to `MARSWS_stpLinehaulTotePickup`: a tote with `FinalMileRouteId IS NOT NULL` returns `FINAL_MILE` (nothing written) so a linehaul driver who scans a continuing tote gets a correct message rather than `WRONG_RUN`.

**Depart.** The linehaul depart gate reconciles items (`20260715120000`). For a sealed tote the items were reconciled at origin pack, so the final-mile gate is **tote-level**: `MARSWS_stpFinalMileMasterDepart (@MasterJobId, @CourierId)` advances the master to PickedUp(5) when every tote in the required set (bound to R, inwarded at the master's depot on the run date, `DeliveredAt NULL`) has `FinalMilePickedUpAt`; otherwise `SHORT` with the missing tote barcodes. `...DepartOverride (@Reason)` as the existing pattern, raising one `tucEvent` 'Linehaul Depart Short' linked to the master (`ucevDueTime = GETDATE()`, the `20261014170000` lesson).

**Loose items** (shipments with a `DEL` leg on R but no open tote membership, e.g. one-to-many work that never went in a tote): the existing per-item Pickup Scan on the `DEL` job is unchanged. Rule for the driver: tote if it is in a tote, items if not. A loose-item scan for a shipment that *is* an open member of a continuing tote is accepted and ignored for status (the tote scan owns the status), audit only. **To confirm:** whether `DEL` legs on route 15 carry `tucJobItems` rows to scan against, or only the root does (multi-leg core notes items live on the root).

### 4.4 Delivery at the lab

Mode is read from the master (`FinalMileDeliveryMode`, section 4.5):

**Mode T, accept sealed totes.** Driver opens the master, taps Deliver, scans each tote. `MARSWS_stpFinalMileToteDeliver (@ToteBarcode, @CourierId, @MasterJobId, @PODName NVARCHAR(100), @Latitude, @Longitude)`: guards `NO_TOTE` / `NOT_FINAL_MILE` / `TOTE_CLOSED` / `WRONG_ROUTE` / `NOT_PICKED_UP` (`FinalMilePickedUpAt IS NULL`); then in one transaction: complete the `DEL` legs (`ucjbStatus = 6`, `ucjbJobDone = 1`, `ucjbPODName = @PODName`, completed time, the same column set `MARSWS_stpLinehaulToteInwards` writes plus POD), close the tote (`IsClosed = 1`, `ClosedAt`, `DeliveredAt/By`), audit. Result `DELIVERED` + `CompletedJobCount`. One signature per stop: the master's `CompleteDeliveryPage` runs once after the tote scans and its POD name is passed to each tote scan (the page collects the name first, then the scans, then photo/signature as today; the signature image stays on the master job as it does for any delivery).

**Mode I, scan each item out.** Scan the tote, then every item: `MARSWS_stpFinalMileToteDeliverItem (@ToteBarcode, @ItemBarcode, ...)` mirrors `MARSWS_stpLinehaulToteInwardsItem`: marks the item received for its root, completes the root's `DEL` leg when all its active members in this tote are scanned. Done/close: `MARSWS_stpFinalMileToteDeliverClose (@ToteBarcode, @CourierId, @Reason)` mirrors `...ToteInwardsClose`: `COMPLETE`, or `SHORT` with the missing list, closing the tote and raising per-item 'Linehaul Missing Item' `tucEvent` follow-ups (so a short tote at the lab is an ops task, not a stalled job). The per-item delivery confirmation rows (`JobItemConfirmation` stage D, `20260928170000`) are written by the same path so the item confirmation reports stay true.

**Master completion** (mirror of `20260706120000`): the master goes to Done (6 + JobDone) when every tote in its required set has `DeliveredAt`. Anchored on `FinalMilePickedUpAt` (totes that actually left the depot on this master), so a never-picked-up tote cannot block it. `ucjbJobDone = 1` reaches the handset through `tucJob_Update_SendToDevices`; no manual push.

### 4.5 Schema (dbmigrationsv2)

| Object | Change |
|---|---|
| `tblLinehaulTote` | `+ FinalMileRouteId INT NULL` FK `Routes(RouteId)`; `+ FinalMilePickedUpAt DATETIME NULL`; `+ FinalMilePickedUpByCourierId INT NULL`; `+ DeliveredAt DATETIME NULL`; `+ DeliveredByCourierId INT NULL`. 2026 table, plain adds, one guarded block per column. Index `(FinalMileRouteId, DeliveredAt)`. |
| `tucJobBooking` | `+ FinalMileDeliveryMode TINYINT NOT NULL DEFAULT 1` (1 = accept sealed totes, 2 = scan each item). Booking-only, like `IsLinehaulMaster`; not on `tucJob`/`tucJobArchive` (keeps the archive proc-sync guard out of it). Plain composite index `(RouteId, IsLinehaulMaster)`. Constant default = metadata-only change. |
| `MARS_stpJobMessages` | two new trailing columns, `FinalMileRouteId`, `FinalMileDeliveryMode` (NULL except on the master). marssenderservice emits `<FMM>` / `<FMD>`. |
| Procs | new: `MARSWS_stpFinalMileTotePickup`, `..MasterDepart`, `..MasterDepartOverride`, `..DepartMissing`, `..ToteDeliver`, `..ToteDeliverItem`, `..ToteDeliverClose`, `..ToteDeliverMissing`. Altered (verbatim latest + the continuation block): the four tote-closing inwards procs from `20261014170000`; `MARSWS_stpLinehaulTotePickup` (`FINAL_MILE` guard). |

All procs `SET QUOTED_IDENTIFIER ON` + `ANSI_NULLS ON`, `CREATE OR ALTER`, `GRANT EXECUTE TO [Web]`, `tblBulkScan` audit `LEFT(,50)`, tenant-neutral (no NZ/US branch; the feature is live on Medical first but nothing in it is tenant-specific).

### 4.6 marsapi and driver app

- marsapi `ScanController`: eight new routes, same anonymous-GET shape as the linehaul ones (`FinalMileTotePickup`, `FinalMileMasterDepart`, `FinalMileMasterDepartOverride`, `FinalMileDepartMissing`, `FinalMileToteDeliver`, `FinalMileToteDeliverItem`, `FinalMileToteDeliverClose`, `FinalMileToteDeliverMissing`). EF result classes scaffolded for the new procs; **no re-scaffold** of the existing ones (shapes unchanged). `AppendXmlElement` for every column; emit `ExpectedLocationName`-style text through the text-safe helper.
- `DataFromHost.cs`: parse `<FMM>` into `Job.FinalMileRouteId` and `<FMD>` into `Job.FinalMileDeliveryMode`, next to the `LHM` case.
- `JobDetailPage.cs`: when `SelectedJob.FinalMileRouteId` is set, Pickup -> `LinehaulTotePickupPage` in final-mile mode (view model calls `FinalMileTotePickupAsync`; Done calls `FinalMileMasterDepartAsync`; result strings above), Deliver -> new `FinalMileDeliveryPage` (mode T: tote scans then `CompleteDeliveryPage`; mode I: tote, items, Done/close with the missing list). The master is excluded from the generic delivery path the same way the linehaul master is.
- More menu: "Final Mile Tote Pickup" (Menu path adopts the single assigned master, section 4.3).
- Offline: queue the scan as today's `LinehaulTotePickup` queue does, new `ScanType` values **to confirm** with the despatchweb `ScanType` table (the app sends the raw int; 29+ are free after `LinehaulToteOverride = 28`).

### 4.7 Routed Operations UI

- Route editor (`ScheduledRoutes`, final-mile routes only): a **Master booking** picker, the same control as the Edit Linehaul Run modal (`STEVE-LINEHAUL-RUN-MODAL-MASTER-JOB`), backed by `GET/PUT /api/recurring-routes/{id}` gaining `MasterBookingId` and the candidate list from the existing `GET /api/recurring-routes/{routeId}/bookings`. Save runs the demote-then-promote invariant.
- Next to it, **Delivery scanning**: "Accept sealed totes" (default) | "Scan each item out" -> `FinalMileDeliveryMode` on the master booking.
- Route Viewer: the final-mile run label shows "Master: Pxxxx" the way `LinehaulRunDto.MasterJobNumber` does for linehaul runs (Steve AC7, 2026-07-01).
- Repack at the depot (D1 exception): Tote Packing against the final-mile master. `MARSWS_stpLinehaulToteScanItem` currently binds a tote to the item's current linehaul leg; add a branch: when `@MasterJobId` is a final-mile master (or the item's shipment has no further linehaul leg and has a live `DEL` leg on a final-mile route from this depot), bind the new tote with `FinalMileRouteId = R`, `LinehaulRunId NULL`. The membership-move invariant (`20260708100000`) empties the old tote by construction. **Scope to confirm with Kevin**: ship in the same change or as a follow-up once the sealed-tote path is proven on Medical.

## 5. Deploy order

1. dbmigrationsv2 schema + procs (one batch; the inwards continuation is dormant until a final-mile master exists on the tenant).
2. marsapi (new routes).
3. marssenderservice `<FMM>` / `<FMD>` emission.
4. Driver app.
5. Routed Operations (master picker + mode). Medical first: set route 15's master and mode, then Kenneth's next Burbank run is the live test.

The DB can land ahead of the app: the extra `MARS_stpJobMessages` columns are ignored by a sender that does not emit them, and the altered inwards procs keep their result shapes.

## 6. Test plan (Medical staging, NEOGE, route 15)

1. **Sealed tote through**: pack 3 shipments into tote A at Sacramento, linehaul to Burbank, inwards (Mode A). Expect: legs done, `InwardedAt` set, linehaul master completes, tote A `IsClosed = 0`, `FinalMileRouteId = 15`.
2. **Final-mile pickup**: open the route 15 master as the rostered courier, scan tote A -> `PICKED_UP`, 3 `DEL` legs at status 5, device shows them. Scan again -> idempotent (0 advanced). Different courier -> `NOT_ASSIGNED`. Linehaul driver scans tote A on the linehaul pickup screen -> `FINAL_MILE`.
3. **Depart**: two totes bound, one picked up -> `SHORT` naming the other; override with reason -> master at 5, `tucEvent` raised.
4. **Mode T delivery**: scan tote A with POD name -> 3 `DEL` legs done with that POD name, tote closed, master done when the last tote is scanned.
5. **Mode I delivery**: scan tote B, scan 2 of 3 items, Done -> `SHORT`, missing item listed, `tucEvent` 'Linehaul Missing Item' raised, tote closed, the two scanned roots' `DEL` legs done.
6. **Mixed tote**: roots on route 15 and on a second final-mile route from depot 38 -> inwards closes the tote as today; items continue individually.
7. **Loose item**: a `DEL` leg on route 15 with no tote -> existing Pickup Scan and Deliver unchanged.
8. **Regression**: a tote whose roots have no final-mile leg closes at inwards exactly as before (`IsClosed = 1`); linehaul master completion timing unchanged; Urgent (no final-mile routes) sees no behaviour change.

## 7. Open questions

- **Q1.** Resolved 16 Oct: the "Burbank to Lab" booking on route 15 is the final-mile master (section 3, D2).
- **Q2.** Does the lab ever need a location barcode check (the `WRONG_LOCATION` equivalent)? Assumed no: the lab is the `DEL` leg's delivery address, GPS on the delivery is the evidence.
- **Q3.** Undo: `LinehaulInwardsUndoReceipt` has no final-mile twin. Assumed a wrongly delivered tote is corrected in DespatchWeb for now.
- **Q4.** Do `DEL` legs carry their own `tucJobItems` rows on Medical, or only the root (section 4.3 loose-item rule)?
