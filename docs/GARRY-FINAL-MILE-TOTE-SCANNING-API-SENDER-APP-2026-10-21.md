# Final Mile Tote Scanning - marsapi, marssenderservice and driver app work

_Author: Steve Bonnici (with EasyEA) - 2026-10-21. Owner: **Garry** (M1-M4). Companion to `KEVIN-FINAL-MILE-TOTE-SCANNING-2026-10-16.md` (same folder), whose M0 (dbmigrationsv2) and M5 (Routed Operations) stay with Kevin._
_Status: ownership decided by Steve 21 Oct 2026 after Kevin's `FINAL-MILE-TOTE-SCANNING-OWNERSHIP-2026-10-21.md`: the three codebases Kevin does not hold (marsapi, marssenderservice, JupiterMaui) are Garry's. Every file and line below was read on gitlab.com `deliver-different/marsapi` master `507655a` (20 Oct), `deliver-different/marssenderservice` master `0a2ad9d` (14 Oct) and Azure DevOps `JupiterMaui` master `b4c100a` (25 Sep). Nothing is built yet on any side._

## 0. The split

| Milestone | Repo | Owner | Depends on |
|---|---|---|---|
| M0 schema + `MARSWS_stpFinalMile*` procs + inwards continuation | dbmigrationsv2 | Kevin | - |
| **M1** eight `FinalMile*` scan routes + result classes + wrappers | marsapi | **Garry** | M0 on Medical staging (to run them); can be coded from section 1 before that |
| **M2** `<FMM>` / `<FMD>` on the job message | marssenderservice | **Garry** | M0's two `MARS_stpJobMessages` columns |
| **M3** final-mile tote pickup + tote-level depart from the master | JupiterMaui | **Garry** | M1, M2 |
| **M4** `FinalMileDeliveryPage`, mode T and mode I | JupiterMaui | **Garry** | M1, M2 |
| M5 route editor master picker + delivery mode + Route Viewer label | routed-operations | Kevin | - |
| M6 / M7 staging run-through, Medical prod | all | Kevin + Garry + Kenneth | M0-M5 |

The DB can land first and sit dormant (the continuation block only fires once a final-mile master exists on the tenant). marsapi and the sender can deploy before the app: the sender emits `<FMM>`/`<FMD>` only when non-null, and an app without the parser ignores unknown job nodes (`DataFromHost.cs` has no `default:` branch in the job-node switch), so an old handset just sees the master as an ordinary job.

## 1. The contract both halves build to

Kevin's procs return these columns; Garry's routes emit them as XML elements; the app parses them into the models named. Column names are the contract - the EF wrappers map by name (`_context.SqlQueryAsync<T>`), so an unlisted extra column is ignored and a missing one throws.

### 1.1 Scan routes (marsapi `api/Scan/...`, anonymous GET, `Produces("application/xml")`, `<Root>` envelope)

| Route | Proc | Query params (after `deviceId`, `deviceTime`) | Result columns -> XML elements | App model |
|---|---|---|---|---|
| `FinalMileTotePickup` | `MARSWS_stpFinalMileTotePickup` | `toteBarcode`, `courierId`, `masterJobId?` | `Result` (PICKED_UP, NO_TOTE, NOT_FINAL_MILE, TOTE_CLOSED, WRONG_ROUTE, NOT_ASSIGNED), `FinalMileRouteId` -> `FMR`, `PickedUpJobCount`, `PickedUpToteCount`, `RunToteCount` | `TotePickupResult` reused (+ `FinalMileRouteId`) |
| `FinalMileMasterDepart` | `MARSWS_stpFinalMileMasterDepart` | `masterJobId`, `courierId` | `Result` (DEPARTED, SHORT, NO_PICKUP, NO_MASTER), `MissingCount`, `FinalMileRouteId` -> `FMR`, `MasterJobId` | `LinehaulMasterDepartResult` reused |
| `FinalMileDepartMissing` | `MARSWS_stpFinalMileDepartMissing` | `masterJobId` | rows: `ToteBarcode`, `InwardedAt` -> `<Items><I>` | new `FinalMileDepartMissingItem` (**totes, not items** - see 5.4) |
| `FinalMileMasterDepartOverride` | `MARSWS_stpFinalMileMasterDepartOverride` | `masterJobId`, `courierId`, `reason` | `Result` (DEPARTED_SHORT, ALREADY_GONE, REASON_REQUIRED, NO_PICKUP, NO_MASTER), `MissingCount`, `MasterJobId` | `LinehaulMasterDepartResult` reused |
| `FinalMileToteDeliver` | `MARSWS_stpFinalMileToteDeliver` | `toteBarcode`, `courierId`, `masterJobId`, `podName`, `latitude?`, `longitude?` | `Result` (DELIVERED, NO_TOTE, NOT_FINAL_MILE, TOTE_CLOSED, WRONG_ROUTE, NOT_PICKED_UP), `CompletedJobCount`, `DeliveredToteCount`, `RunToteCount`, `MasterComplete` (bit) | new `FinalMileToteDeliverResult` |
| `FinalMileToteDeliverItem` | `MARSWS_stpFinalMileToteDeliverItem` | `toteBarcode`, `itemBarcode`, `courierId`, `masterJobId`, `podName` | `Result` (ITEM_DELIVERED, NOT_IN_TOTE, ALREADY_DELIVERED, NO_TOTE, NOT_PICKED_UP), `RootParentId`, `ShipmentComplete` (bit) | new `FinalMileToteDeliverItemResult` |
| `FinalMileToteDeliverClose` | `MARSWS_stpFinalMileToteDeliverClose` | `toteBarcode`, `courierId`, `masterJobId`, `reason?` | `Result` (COMPLETE, SHORT, NO_TOTE, NOT_PICKED_UP), `CompletedJobCount`, `MissingCount`, `MasterComplete` (bit) | new `FinalMileToteDeliverCloseResult` |
| `FinalMileToteDeliverMissing` | `MARSWS_stpFinalMileToteDeliverMissing` | `toteBarcode` | rows: `ItemBarcode`, `RootParentId`, `JobNumber` -> `<Items><I>` | `ToteInwardsMissingItem` reused |

`podName` goes through the text-safe helper (`AppendXmlTextElement`) on the way out and must be URL-encoded by the app on the way in (`Uri.EscapeDataString`), the same as `reason` today. `MasterComplete` is new: the proc already knows whether this scan completed the master (section 4.4 of the spec, "every tote in its required set has DeliveredAt"), and returning it saves the app a round trip - the master still flips to Done on the handset through `tucJob_Update_SendToDevices` as the spec says; the flag just lets the page say "Run complete" immediately. **Kevin: please add it to the two delivery procs.**

### 1.2 Inwards continuation (existing routes, one new column)

`MARSWS_stpLinehaulToteInwards`, `...ToteInwardsItem` (Done path), `...ToteInwardsClose` and `...LinehaulLocationReceipt` (tote path) keep their result shapes **plus one trailing column `FinalMileRouteId INT NULL`** (non-null when the tote stayed open and continued). marsapi appends it as `FMR`; the inwards page shows "Tote continues to final mile (route R)" instead of nothing. Without this column the spec's own line "the app shows 'Tote closed - items continue individually'" cannot be built: `LEG_COMPLETE` looks identical in both cases. One `AppendXmlElement` per route; one property on `ToteInwardsResult` / `ToteInwardsCloseResult` / `LocationReceiptResult`. **Kevin: please add the column to the four altered procs** (it is the same `@FinalMileRouteId` the continuation block already computes).

### 1.3 Job message (`MARS_stpJobMessages` -> marssenderservice -> handset)

| Column (trailing, NULL except on the final-mile master) | Sender tag | App field |
|---|---|---|
| `FinalMileRouteId INT NULL` | `<FMM>` | `Job.FinalMileRouteId` |
| `FinalMileDeliveryMode TINYINT NULL` (1 = accept sealed totes, 2 = scan each item out) | `<FMD>` | `Job.FinalMileDeliveryMode` |

Both tags are unused today (`DataFromHost.cs` has no `FM*` case; checked all 131 cases). Lesson from `<CUP>` (`SenderService.cs:237-240`): never reuse a tag, the `<CU>` clash broke job parsing on the device.

### 1.4 ScanType (offline audit rows)

| Value | Name | Where it must match |
|---|---|---|
| 29 | `FinalMileTotePickup` | `JupterEnums.cs` ScanType, despatchweb ScanType enum, `tblBulkScan` audit in the pickup proc |
| 30 | `FinalMileToteDeliver` | same three places |

29 and 30 are free (`LinehaulToteOverride = 28` is the last, `JupterEnums.cs:40-46`). The despatchweb enum is a one-line change in a fourth codebase (Jacob's); it only matters for the Scan Manager display of the audit row, not for the flow.

## 2. marssenderservice (M2) - two files

| File | Change |
|---|---|
| `Models/Despatch/MARS_stpJobMessagesResult.cs` (after `MasterLinehaulRunId`, line 165) | `public int? FinalMileRouteId { get; set; }` and `public byte? FinalMileDeliveryMode { get; set; }` with the same comment style as `MasterLinehaulRunId` |
| `Services/SenderService.cs` `BuildUpJobInformationAsync`, directly after the `<LHM>` block (lines 266-272) | `if (dr.FinalMileRouteId.HasValue) { XmlAddElement(doc, job, "FMM", dr.FinalMileRouteId.Value.ToString()); XmlAddElement(doc, job, "FMD", (dr.FinalMileDeliveryMode ?? 1).ToString()); }` |

No scaffold, no DbContext change: the result class is a plain unmapped type read by `SqlQueryAsync<MARS_stpJobMessagesResult>` (`DespatchContextProcedures.cs:72-91`), mapped by column name. If M2 deploys before M0 the proc has no such columns and the read throws on the missing property, so **M0 goes first on each environment** (the spec's deploy order already says so; this is why).

Done when: a job message for a promoted final-mile master on Medical staging carries `<FMM>15</FMM><FMD>1</FMD>` and every other job carries neither (check the sender's `RETURN:` debug log).

## 3. marsapi (M1) - three kinds of file, all copied from the linehaul set

The 25 linehaul routes were hand-written in the EF Core Power Tools shape, not scaffolded (`efpt.*.config.json` list three tables and no procedures), so this is copy-and-rename work.

| File | Change |
|---|---|
| `Controllers/ScanController.cs` | Eight new actions. Templates: `LinehaulTotePickup` (lines 147-177) for `FinalMileTotePickup`; `LinehaulMasterDepart` (717-745), `LinehaulDepartMissing` (747-779, the `<Items><I>` list shape) and `LinehaulMasterDepartOverride` (781-807) for the three depart routes; `LinehaulToteInwards` / `...InwardsItem` / `...InwardsClose` / `...InwardsMissing` (429-545) for the four delivery routes. Each is: `Log.Debug` start + params, `<Root>`, `try { var response = await despatchContext.Procedures.X_Async(...); var result = response.FirstOrDefault(); AppendXmlElement(...) per column } catch { Log.Error }`, `Log.Debug RETURN`. Bits are emitted `"1"/"0"` (`ScanController.cs:129`); free text through `AppendXmlTextElement` (`ScanController.cs:446`). |
| `Controllers/ScanController.cs` inwards routes (lines 429-545) + `LinehaulLocationReceipt` (285-311) | one extra `AppendXmlElement(xmlDoc, ref detailsElem, "FMR", result?.FinalMileRouteId?.ToString())` each (section 1.2) |
| `Models/Despatch/MARSWS_stpFinalMile*Result.cs` (eight new) | Copy `MARSWS_stpLinehaulTotePickupResult.cs` / `MARSWS_stpLinehaulMasterDepartResult.cs` / `MARSWS_stpLinehaulDepartMissingResult.cs` / the four `...ToteInwards*Result.cs`. Properties = the columns in 1.1, nullable, `[StringLength]` on `Result` sized to the longest verdict (`NOT_FINAL_MILE` = 14, `DEPARTED_SHORT` = 14, `ALREADY_DELIVERED` = 17). |
| `Models/Despatch/MARSWS_stpLinehaulToteInwardsResult.cs`, `...InwardsCloseResult.cs`, `...InwardsItemResult.cs`, `MARSWS_stpLinehaulLocationReceiptResult.cs` | `+ public int? FinalMileRouteId { get; set; }` |
| `Models/Despatch/IDespatchContextProcedures.cs` (lines 27-51 are the linehaul block) + `DespatchContextProcedures.cs` | Eight `Task<List<...Result>> MARSWS_stpFinalMile...Async(...)` pairs. Template: `MARSWS_stpLinehaulTotePickupAsync` (`DespatchContextProcedures.cs:1123-1166`): one `SqlParameter` per proc argument (`NVarChar` `Size = 200` for barcodes, `Size = 100` for `PodName`, `Size = 200` for `Reason`, `Decimal` for lat/long with `Precision`/`Scale` as `MARSWS_stpLinehaulPickupSubstituteAsync` does), the `returnValue` output parameter, then `_context.SqlQueryAsync<T>("EXEC @returnValue = [dbo].[MARSWS_stpFinalMileX] @A = @A, ...", sqlParameters, cancellationToken)`. Parameter names must equal the proc's. |

Nothing else: no DbContext registration (the result types are unmapped), no auth (the linehaul routes are anonymous GET, same as these), no new service. Existing linehaul routes keep their shapes; `LinehaulTotePickup` simply starts returning `FINAL_MILE` as a `Result` value from Kevin's guard, which needs no API change.

Done when: on Medical staging, `GET /api/Scan/FinalMileTotePickup?...&toteBarcode=<a continued tote>&courierId=<rostered>&masterJobId=<master ucjbID>` returns `<Result>PICKED_UP</Result>` with counts, and the four inwards routes return `<FMR>` for a continuing tote. Until M0 is applied the routes compile and return an empty `<Root/>` (the catch logs "Could not find stored procedure"), which is the normal state for a route ahead of its proc.

## 4. Driver app, JupiterMaui (M3 + M4)

### 4.1 Plumbing (both milestones need it)

| File | Change |
|---|---|
| `Models/Job.cs` (after `MasterLinehaulRunId`, line 536) | `public int? FinalMileRouteId { get; set; }` and `public int? FinalMileDeliveryMode { get; set; }`. Non-null `FinalMileRouteId` = this job IS the final-mile master. |
| `Data/JupiterDatabase.cs` | (a) schema step: `if (currentVersion < 80690) { ALTER table tblJob ADD column FinalMileRouteId int NULL; ALTER table tblJob ADD column FinalMileDeliveryMode int NULL }` and bump the `tblSetting` version write (line 350) to `80690`; (b) **every hand-built column list** that names `MasterLinehaulRunId` (line 89 select list and its siblings) gets both new columns. The `<CUP>` lesson (`JupiterDatabase.cs:344-348`): a missing column makes `StoreJob` throw and jobs silently stop arriving. |
| `Data/DataFromHost.cs` | declare `int? finalMileRouteId = null; int? finalMileDeliveryMode = null;` beside `masterLinehaulRunId` (line 413); add `case "FMM":` / `case "FMD":` beside `case "LHM":` (925-929) with the same `int.TryParse` + `if (isUpdate) updatedJob.X = ...` pattern; add both to the new-job initialiser beside `MasterLinehaulRunId = masterLinehaulRunId` (1155). |
| `Enums/JupterEnums.cs` ScanType (line 40-46) | `FinalMileTotePickup = 29, FinalMileToteDeliver = 30` |
| `Data/IAuthRestService.cs` + `Data/AuthRestService.cs` | eight methods mirroring `LinehaulTotePickupAsync` (448-478: build the GET URI with `deviceId`, `deviceTime`, params; `GetAsync`; `XmlDocument.LoadXml`; read `root?["X"]?.InnerText`; `return null` on exception = unreachable) and `LinehaulMasterDepartAsync` (999-1025). List routes mirror `LinehaulDepartMissingAsync` (1027+). Add `FinalMileRouteId` parsing (`root?["FMR"]`) to the four existing inwards/receipt parsers. |
| `Models/` | new `FinalMileToteDeliverResult`, `FinalMileToteDeliverItemResult`, `FinalMileToteDeliverCloseResult`, `FinalMileDepartMissingItem`; `TotePickupResult` + `FinalMileRouteId`; `ToteInwardsResult`, `ToteInwardsCloseResult`, `LocationReceiptResult` + `FinalMileRouteId`. |
| `MauiProgram.cs` | `AddSingleton<FinalMileDeliveryViewModel>()` beside line 69, `AddSingleton<FinalMileDeliveryPage>()` beside line 93. (`LinehaulTotePickupPage` is reused, not duplicated.) |

### 4.2 M3 - pickup and depart from the master

The linehaul pickup page already does everything the final-mile pickup needs except call a different endpoint and read different verdicts, so it gets a **mode** rather than a copy.

| File | Change |
|---|---|
| `ViewModels/LinehaulTotePickupViewModel.cs` | `public int? FinalMileRouteId { get; set; }` (null = linehaul mode); `Reset()` clears it. `ScanToteAsync`: when set, call `FinalMileTotePickupAsync(tote, courier, url, MasterJobId)` and queue offline with ScanType 29; switch gains `NOT_FINAL_MILE` ("not a final-mile tote"), `WRONG_ROUTE` ("belongs to another route"), `NOT_ASSIGNED` ("this run is not assigned to you"); existing `NO_TOTE_OR_RUN` case also accepts `NO_TOTE`. In linehaul mode add `case "FINAL_MILE"` -> new `FinalMileAlert` ("this tote continues on the final-mile route, use Final Mile Tote Pickup"). `DepartAsync` / `GetDepartMissingAsync` / `DepartOverrideAsync` branch on the mode to the `FinalMile*` endpoints. |
| `Views/LinehaulTotePickupPage.cs` | `SetFinalMile(int routeId, string? masterUcjbId)` beside `SetMasterJob` (line 96): sets the mode and the master, and sets `Title` to "Final Mile Tote Pickup". `PickedUpAlert` text: "Picking Up (X of Y totes)" already works from the counts; show "Route R" instead of "Run R" when in final-mile mode. `HandleDepartShortAsync` (231-258): in final-mile mode the missing list is totes (`m.ToteBarcode`) and the wording is "tote(s) not picked up". Wire the three new alerts to `DisplayAlert`s like `WrongRunAlert` (122-129). |
| `Views/JobDetailPage.cs` pickup path, `case "Accepted"` (line 1286) | **Before** the `MasterLinehaulRunId` gate: `if (SelectedJob?.FinalMileRouteId is int fmr) { totePage.ClearData(); totePage.SetFinalMile(fmr, SelectedJob.JobID); NavigateToAsync<LinehaulTotePickupPage>(); return; }` - same push-not-modal rule and the same early `return` (the normal pickup state change must not run for a master). |
| `Views/MoreTabPage.cs` menu list (line 337-347) + a `NavigateToFinalMileTotePickup` beside line 450 | "Final Mile Tote Pickup" entry: `ClearData()`, `SetFinalMile(0, null)` (route unknown, master null -> the proc's Menu path adopts the single assigned master or refuses `NOT_ASSIGNED`). `OnDoneAsync` with no master just goes back, as today (line 171-175). |

Done when: spec test plan 2 and 3 pass on a staging handset (PICKED_UP with counts; second courier NOT_ASSIGNED; linehaul screen says FINAL_MILE; Done departs or blocks SHORT with the tote list; supervisor override).

### 4.3 M4 - delivery at the lab

One new page, modelled on `LinehaulInwardsPage.cs` / `LinehaulInwardsViewModel.cs` (tote scan -> item scans -> Close with missing list is exactly the mode I shape), with a mode T branch.

| File | Change |
|---|---|
| `ViewModels/FinalMileDeliveryViewModel.cs` (new) | State: `MasterJobId`, `FinalMileRouteId`, `Mode` (1/2), `PodName`, `ToteBarcode`, delivered-tote list. Mode T: `DeliverToteAsync(tote)` -> `FinalMileToteDeliverAsync(tote, courier, master, PodName, lat, long)`; verdicts DELIVERED / NO_TOTE / NOT_FINAL_MILE / TOTE_CLOSED / WRONG_ROUTE / NOT_PICKED_UP. Mode I: `OpenToteAsync(tote)` (manifest via `LinehaulToteManifestAsync`, as the inwards page lists items), `DeliverItemAsync(item)` -> `FinalMileToteDeliverItemAsync`, `CloseAsync(reason?)` -> `FinalMileToteDeliverCloseAsync` with SHORT -> `FinalMileToteDeliverMissingAsync` list, mirroring `LinehaulInwardsViewModel.CompleteLegAsync` / `ReceiveItemAsync` / `CloseAsync` (lines 74-160). `MasterComplete == 1` on any verdict raises `RunCompleteAlert`. Offline: **block, do not queue** (see 5.3). |
| `Views/FinalMileDeliveryPage.cs` (new) | Layout = `LinehaulInwardsPage` (status label, detail label, tote entry, Scan Tote, results editor, Close/Done) plus a **POD name entry at the top** that must be filled before the first tote scan (mode T passes it on every tote; mode I passes it on every item). Mode I adds the Scan Item button and the SHORT dialog with the missing list (copy `HandleDepartShortAsync` wording). `Done`: if `MasterComplete` was seen, push `CompleteDeliveryPage` modal for the master with `job.PODName` pre-set so the signature / photo are captured on the master through the normal delivery event (section 5.5); otherwise `GoBackAsync`. |
| `Views/JobDetailPage.cs` `OnDeliverButtonClicked` (line 1339) | **Before** the `MasterLinehaulRunId` gate: `if (SelectedJob?.FinalMileRouteId is int) { page.ClearData(); page.Configure(SelectedJob.JobID, routeId, SelectedJob.FinalMileDeliveryMode ?? 1); NavigateToAsync<FinalMileDeliveryPage>(); return; }`. Pushed, not modal, same as inwards. Set `_awaitingMasterInwards`-style flag so the auto-completion check on return (the `#3` comment at 1347) also runs for the final-mile master. |
| `Views/LinehaulInwardsPage.cs` `LegCompleteAlert` (around line 133) | when the result carries `FinalMileRouteId`, status text "Leg complete - tote continues to final mile (route R)" and leave the "closed" wording for the null case. |

Done when: spec test plan 4 and 5 pass (mode T: tote scan with POD name completes the three `DEL` legs and closes the tote, master Done after the last tote; mode I: 2 of 3 items then Done -> SHORT with the missing item, `tucEvent` raised, tote closed).

### 4.4 Release

The app ships through the existing scripts (`build-android-firebase.sh` / `build-ios-firebase.sh` for staging testers, `build-android-playstore.sh` / `build-ios-appstore.sh` for prod). Kenneth's handset needs the Firebase build for M6 and the store build for M7; iOS review lead time (days) sits inside M7, so cut the store build as soon as M6 passes.

## 5. Things found in the code that change the spec

1. **`ucjbJobNumber` -> `ucjbNumber`** (Kevin, 21 Oct). Three occurrences in the spec (sections 4.2, 4.3, 7); corrected in the spec in the same commit as this document. `tucJobBooking`'s key is `ucbkID`.
2. **Inwards results need `FinalMileRouteId`** (section 1.2). The spec said "shape unchanged" and in the same breath asked the app to show a different message for a continued tote; the column is the only way to do both.
3. **Offline is audit-only, not "fan out on sync".** A queued tote scan (`App.Database.StoreScanAsync`, `LinehaulTotePickupViewModel.cs:74-83`) leaves the handset in the next data sync (`Util.cs:193-203`) and lands in `MARS_stpScan_Insert` via marsreceiverservice `ReceiveScansFromMobileAsync` (`ReceiverService.cs:483-515`), which writes `tblScan` only. No migration replays ScanType 27 as a pickup (checked: no emitter of `MARS_stpScan_Insert` in dbmigrationsv2 and no proc reads `tblScan` for 27). So "queue as today" means the scan is recorded for Scan Manager and the driver's screen says "queued", but the `DEL` legs are **not** advanced until something is re-scanned online. For final-mile pickup keep the same degrade (ScanType 29) and the same honest "queued offline" label. For **delivery do not queue**: a queued delivery with no POD would complete nothing and look done; block with "no connection" like `LinehaulMasterDepart` does (`LinehaulTotePickupPage.cs:182-188`). If a lab has no signal the driver falls back to the master's ordinary `CompleteDeliveryPage`, which works offline through events and completes the master only (the `DEL` legs are then tidied in DespatchWeb, the same as Q3's undo answer).
4. **`FinalMileDepartMissing` returns totes, not items.** The linehaul depart gate is item-level (`LinehaulDepartMissingItem` = `RootParentId`, `JobNumber`, `ItemBarcode`); the final-mile gate is tote-level by design (spec 4.3 "SHORT with the missing tote barcodes"), so the rows are `ToteBarcode`, `InwardedAt` and the app needs its own model and dialog wording.
5. **Mode T signature stays on the normal delivery path.** `CompleteDeliveryPage` (3,000 lines, modal) sets `job.JobStatus = "Delivered"`, `job.PODName`, stores the event (`CompleteDeliveryPage.cs:2272-2351`) and the receiver completes the job and stores the signature/photo as for any delivery. Running it once for the master **after** the tote scans (POD name pre-filled from the page) keeps the photo/signature handling untouched and costs no new proc. The proc side has already completed the master when the last tote was delivered, so the master's own delivery event is a no-op on status - Kevin: confirm the receiver's delivery path tolerates an already-Done master (it should, status 6 twice), otherwise gate the modal on `MasterComplete`.
6. **`MasterComplete` on the delivery results** (section 1.1) so the page can say "Run complete" without waiting for the `<ST>`/`JobDone` push.

## 6. Order on staging

1. Kevin: M0 applied to Medical staging; create the final-mile master booking on route 15 (Kevin's note: it does not exist yet, so it is created and promoted, not picked) and a second `Direction = 2` route from depot 38 for test 6.
2. Garry: M1 + M2 deployed to staging (`backstage`/`develop` as per the repo's branch flow) and the section-3 / section-2 done-when checks run with curl and the sender log.
3. Garry: M3 Firebase build to Kenneth's and Kevin's handsets; test plan 1-3 (test 1 is Kevin's DB-only check).
4. Garry: M4 build; test plan 4-8.
5. Kevin: M5 so route 15's master and mode are set from Routed Ops rather than by script; M6 sign-off; M7 store build + prod migration + prod master/mode.

## 7. Size (Garry)

| Piece | Estimate |
|---|---|
| M2 sender | under half a day including deploy |
| M1 marsapi | about one day: eight routes, eight result classes, eight wrappers, four one-line column adds |
| M3 app pickup mode | about one day |
| M4 app delivery page | two to three days (mode I is the bulk; mode T is a subset) |
| Plumbing (4.1) + builds + staging passes | about one day |

Roughly a week of Garry's time end to end, most of it in the app. The DB side (M0) is larger and is Kevin's; neither blocks the other from starting because section 1 is the contract.

## Milestones (Garry's part of the parent card, same numbering)

| # | Milestone | Done when |
|---|---|---|
| M1 | marsapi: eight `FinalMile*` routes + result classes + wrappers; `FMR` on the four inwards routes | section 3 done-when passes against Medical staging |
| M2 | marssenderservice: `<FMM>` / `<FMD>` | section 2 done-when passes |
| M3 | app: final-mile pickup mode on `LinehaulTotePickupPage`, master routing, More-menu entry, ScanType 29 | test plan 2 and 3 on a staging handset |
| M4 | app: `FinalMileDeliveryPage` mode T + mode I, master delivery routing, inwards "continues" message | test plan 4 and 5 on a staging handset; store build cut |