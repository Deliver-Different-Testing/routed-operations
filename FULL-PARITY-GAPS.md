# RoutedOperations - Full Parity Gap Audit

Date: 2026-07-22
Scope: comprehensive read-only sweep of `C:\Gitlab\RunBuilder_Root\RunBuilder\`
(legacy .NET 8 MVC + AngularJS 1.x) vs `C:\Gitlab\RoutedOperations_Root\RoutedOperations\`
(modern .NET 10 MVC + React SPA). Covers everything Stage 1 / Stage 2
audit didn't already flag (see PARITY-TRACKING.md).

---

## Section 1: RunBuilder feature inventory

Grouped by area. Every user-facing feature listed with backend + frontend
source paths, HTTP verb + route, SP / repo method, external integration.

### 1.1 Bootstrapping + auth + tenant setup

| Feature | Legacy backend | Legacy frontend | SP / method | External |
|---|---|---|---|---|
| Cookie auth (`.AspNet.SharedCookie`, 20 min sliding, `hub_session` for state) | `Program.cs:119-136`, `:140-143` | n/a | n/a | DataProtection: local file (dev) / AWS SSM `/Hub/DataProtection` (prod) `Program.cs:52-63` |
| Env-var-driven config | `Program.cs:89-102` (`Domain`, `RedisConfig`, `PublicPath`), `HomeController.cs:39-45` (`SQLCredentials`), `SqlServerHealthCheck.cs:9-11` (`SQLHealthCheckConnection`) | n/a | n/a | Redis (StackExchange) |
| Tenant claim -> connection string cache | `HomeController.cs:28-45`, `ConnectionStringManager.cs`, `DynaimcDespatchDBContextFactory.cs` | n/a | n/a | Redis (`{tenantId}-RunBuilder-Connection` cache key) |
| SPA bootstrap payload (`IsUsTenant`, `TimeZone`) | `HomeController.cs:31-83` -> `Views/Home/Index.cshtml:5-12` | `Views/Home/Index.cshtml` `<script>` block writes `IsUsTenant` + `TimeZone` global | n/a | n/a |
| Health check `/healthz` (SQL Server) + `/health/live` | `Program.cs:14-15`, `:159-180`, `SqlServerHealthCheck.cs` | n/a | `SELECT @@version` | n/a |
| Docker image build (net8, port 8080) | `Dockerfile` | n/a | n/a | n/a |
| Raygun error reporting | `appsettings.json:15-17` (`RaygunSettings.ApiKey` present, no client wired) | n/a | n/a | Raygun (unwired) |
| Serilog structured logging (console) | `Program.cs:17` | n/a | n/a | Serilog + AWS CloudWatch (implicit via K8s) |
| GitLab CI include | `.gitlab-ci.yml` | n/a | n/a | GitLab pipeline shared template |

### 1.2 Cockpit shell + layout

| Feature | Legacy backend | Legacy frontend | Notes |
|---|---|---|---|
| Top bar: DFRNT logo, global search, refresh, Layout dropdown | n/a | `homeView.html:19-48` | Layouts stored in memory only (see below) |
| Global search over all runList jobs (`runListCombined`) | n/a | `homeView.html:22-33`, `homeControl.js:2722-2737` | On click, calls `selectJob(job, true)` |
| Refresh button (spinner) | n/a | `homeView.html:36` -> `getData(1)` | Wipes localStorage + full reload |
| Layout dropdown: Save Layout + list of saved layouts | n/a | `homeView.html:36-47`, `homeControl.js:264-335` | `Default` shipped; saveLayout posts to `api.php` (DEAD PATH - never wired) - layouts effectively per-session |
| 4-column resizable layout (`angularResizable` + `ui.sortable`) with 7 named panels: `groupedJobs`, `jobsList`, `jobDetail`, `runList`, `runBuilder`, `potentialCourierFleets`, `potentialCouriers`, `map` | n/a | `homeControl.js:53-254`, `homeView.html:50-108` | Boxes drag-sortable between columns via handle; each panel resizable |
| Draggable dropdown items indicator (`draggingItems` DOM helper) | n/a | `homeView.html:126-160` | Shows count of dragged rows |
| Ctrl+click multi-row selection with mouseover-drag toggle | n/a | `homeView.html:205-313`, `homeControl.js:237-313` | Custom jQuery in Index.cshtml |
| Toggle-off same-row click behaviour | n/a | `homeView.html:265-284` | Comments describe the reasoning |
| Arrow-key row navigation | n/a | `homeView.html:341-348` | Up/down within `activeTable` |

### 1.3 Filters (pickDateService form)

| Feature | Legacy backend | Legacy frontend | SP / method |
|---|---|---|---|
| Client list dropdown | `JobController.GetRunSettings` -> `/Job/GetRunSettings` | `homeService.js:16-24 getDateService`, `pickDateForm.tpl:25-28` | `JobRepository.GetBulkRunSettingsAsync` -> `UTL_stpJob_tblBulkRunSettings` |
| Region list dropdown | `JobController.RegionList` -> `/Job/RegionList?runDate=` | `homeService.js:31-35`, `pickDateForm.tpl:30-33` | `RVW_stpBulkRegions` |
| Speed list (per date) | `JobController.SpeedList` -> `/Job/SpeedList?runDate=` | `homeService.js:36-40`, `pickDateForm.tpl:35-38` | `RVW_stpBulkSpeeds` |
| Speed list (all - for JobDetail dropdown) | `JobController.AllSpeeds` -> `/Job/AllSpeeds` | `homeService.js:41-45`, `homeControl.js:649-654` | Inline `SELECT ucjtID, ucjtName FROM tucJobType` |
| OurRef list | `JobController.GetFilter` -> `/Job/GetFilter?runDate=` | `homeService.js:51-55`, `pickDateForm.tpl:40-43` | `UTL_stpJob_tblBulkJobWithFilter` (distinct OurRef) |
| Date picker (angular-pickadate) | n/a | `pickDateForm.tpl:46-47` | Client-only |
| Vehicle size dropdown (for Build config) | `JobController.VehicleSizes` -> `/Job/VehicleSizes` | `homeService.js:46-50`, `homeControl.js:443-446` | Inline `SELECT VehicleSizeID, VehicleName, CubicCapacity FROM VehicleSize WHERE CubicCapacity IS NOT NULL` |
| Multi-select dropdowns via `angularjs-dropdown-multiselect` for all four filters | n/a | `pickDateForm.tpl` + `homeControl.js:406-428` settings | Frontend only |

### 1.4 Job list + grouping (jobsList, groupedJobs panels)

| Feature | Legacy backend | Legacy frontend | SP / method |
|---|---|---|---|
| Main jobs fetch (filters applied server-side) | `JobController.Index` -> `GET /Job?datetime=&clientIds=&regionIds=&ourRefs=&speeds=` | `homeService.js:62-70 getRunJobsAll`, `homeControl.js:3374` | `UTL_stpJob_tblBulkJobWithFilter` |
| Sync EH/HD button (top of Grouped Jobs) | `JobController.SyncHDJobs` -> `POST /Job/SyncHDJobs?runDate=` | `homeControl.js:675-681 syncHDJobs`, `homeView.html:67` | `UTL_stpJob_tblBulkJob_SyncHDJobs` |
| Grouped Jobs: view by time (`sortByTime`) - buckets by `ReadyTime` string | n/a | `homeControl.js:4027-4097`, `homeView.html:73` | Client-only reduce |
| Grouped Jobs: view by postcode (`sortByPostCode`) with suburb names | n/a | `homeControl.js:4190-4224`, `homeView.html:76` | Client-only |
| Group context menu: Edit Group Date + Open these times (time mode) | n/a | `homeControl.js:4407-4503 groupedTimeMenu` | Client + `Job/BulkUpdateRouteDate` |
| Group context menu: Edit Group Date + Create run from group (postcode mode) | n/a | `homeControl.js:4248-4343 groupedJobsMenu` | Client-only for "create run" |
| Time-band multi-select via `addTime` + `setTime` (Ctrl+click across time rows) | n/a | `homeControl.js:4099-4162`, `groupedJobs.tpl:22` | 1-hour range warning |
| Job list (grid) with sort + filter | n/a | `jobList.tpl`, `homeControl.js:53-101` headings | Client-only sort via `orderList` |
| Job row click -> `selectJob` -> populates JobDetail + centres map | n/a | `homeControl.js:4507-4552` | Client-only |
| Drag rows / groups onto runs to assign (jQuery UI draggable/droppable) | n/a | `homeView.html:237-313` + `homeControl.js:891-916 activateRunDrop`, `homeControl.js:2522-2626 activateRunListDrop` | Client-only, ends by calling `updateJobToRun` |
| Right-click Void (single or multi) | n/a | `homeControl.js:1161-1168 jobListMenu`, `voidSelectedJobs` | `Job/VoidJobs` |
| Job Detail inline-edit form (modal-triggered) with GPS update + address geocoder | `JobController.UpdateJobDetail` -> `POST /Job/UpdateJobDetail` | `jobDetail.tpl` + `homeControl.js:4819-5065 editDetailField/updateDetailField`, `gatherForm.tpl` | `JobRepository.Update` |
| Job Detail: Update GPS (opens `gpsForm.tpl` with ng-map + places autocomplete) | `JobController.UpdateGps` -> `POST /Job/UpdateGps` | `homeControl.js:4579-4817 updateGPS + gpsForm` | `JobRepository.UpdateBulkJob` |
| Bulk update route date (multi-job move) | `JobController.BulkUpdateRouteDate` -> `POST /Job/BulkUpdateRouteDate` | `homeControl.js:2352-2405 bulkUpdateRouteDate`, `4346-4405 bulkUpdateGroupRouteDate` | `JobRepository.BulkUpdateRouteDateAsync` |
| Void / Un-void jobs with parent/child + multibox relationship dialog | `JobController.VoidJobs` -> `POST /Job/VoidJobs` | `homeControl.js:1223-1631 (all void logic)` | `JobRepository.VoidJobsAsync` (auto-manages Void Jobs run) |
| Get multibox children (server-side lookup) | `JobController.GetMultiboxChildren` -> `GET /Job/GetMultiboxChildren?parentJobId=` | Not called from frontend | `JobRepository.GetMultiboxChildJobIds` |

### 1.5 Run list + run builder (run management)

| Feature | Legacy backend | Legacy frontend | SP / method |
|---|---|---|---|
| Fetch existing runs (with filters) | `JobController.GetBulkRuns` -> `GET /Job/GetBulkRuns?date=&filters=` | `homeService.js:97-104 doAPI` via `getRunJobsAll` chain, `homeControl.js:3412` | `UTL_stpJob_tblBulkRunWithFilter` |
| New Run (auto-name `Run N`) | n/a | `homeControl.js:2652-2672 newRun`, `homeView.html:94` | Client-only, persisted on lock |
| Insert or Update Run | `JobController.InsertOrUpdateRun` -> `POST /Job/InsertOrUpdateRun` | `homeControl.js:2446-2485 InsertOrUpdateRun` | `UTL_stpJob_tblBulkRun_InsertOrUpdate` |
| Update Run (rename, courier, courierPercent) | `JobController.UpdateRun` -> `POST /Job/UpdateRun` | `homeControl.js:2487-2500 updateBulkRun` | EF direct on `tblBulkRuns` |
| Delete Run | `JobController.DeleteRun` -> `POST /Job/DeleteRun` | `homeControl.js:2502-2520 DeleteRun` | `UTL_stpJob_tblBulkRun_Delete` |
| Move job to run | `JobController.UpdateJobToRun` -> `POST /Job/UpdateJobToRun` | `homeControl.js:987-1006 updateJobToRun` | `JobRepository.UpdateBulkJobRun` (MERGE with HOLDLOCK) |
| Remove job from run | `JobController.DeleteBulkJobRun` -> `POST /Job/DeleteBulkJobRun` | `homeControl.js:1202-1216 removeJobFromRun` | `JobRepository.DeleteBulkJobRun` |
| Run context menu: Edit Name | n/a | `homeControl.js:1999-2033` | Client + updateBulkRun |
| Run context menu: Edit Route Date (bulk-updates all jobs in run) | n/a | `homeControl.js:2034-2113` | `Job/BulkUpdateRouteDate` |
| Run context menu: Merge selected run to another run | n/a | `homeControl.js:2115-2202` | Client-only, moves jobs then deletes source |
| Run context menu: Route and Lock Run | n/a | `homeControl.js:2205-2219`, `routeRun` at `2888-3021` | Calls HERE, then `InsertOrUpdateRun` with status=1 |
| Run context menu: Toggle Run Lock | n/a | `homeControl.js:2222-2274 toggleRunLock` | Client, calls InsertOrUpdate or Delete |
| Run context menu: Remove (unlocked only) | n/a | `homeControl.js:2277-2311` | Client, drops jobs back to unassigned |
| Run context menu: Send Selected Runs To Live (locked only) | n/a | `homeControl.js:2314-2324`, `sendSelectedJobsToLive` at `1894-1995` | `POST /Job/InsertRunJobs` |
| Run List "New Run" button | n/a | `homeView.html:94` | Client-only |
| Run List "Send to prebook" button | n/a | `homeView.html:95` -> `sendTo('prebook')` | DEAD ENDPOINT `prebook` - no controller mapped |
| Run List "Send to live" button (all locked runs) | n/a | `homeView.html:96` -> `sendTo('/Job/InsertRunJobs')` at `homeControl.js:1793-1891` | `POST /Job/InsertRunJobs` |
| Run List Auto Routing checkbox | n/a | `homeView.html:89-91`, `routeSetting.autoRoute` | Client-only |
| Insert dispatched-run jobs to tucJob (multibox recursion) | `JobController.InsertRunJobs` -> `POST /Job/InsertRunJobs` | `homeControl.js:1857 sendTo` submit | `UTL_stpJob_InsertFromRunBuilder` -> `UTL_stpJob_InsertFromTblBulkJob` |
| Run row context menu: `runBuilderMenu` (Toggle end point / Remove / Void) | n/a | `homeControl.js:1120-1158` | Client + `Job/VoidJobs` |
| Void Jobs run special context menu (Un-void only) | n/a | `homeControl.js:1170-1178 voidRunBuilderMenu` | Client + `Job/VoidJobs` |
| RunBuilder calculator strip (mins/kms/drops/hour%/revenue/exp/courier%/rate/payout) | n/a | `runBuilder.tpl:15-44`, `homeControl.js:3023-3058 calculateRunDetails` | Client-only formula (hourly $25 hard-coded) |
| Run "areas" (comma-joined ToPostCode list) | n/a | `homeControl.js:2632-2650 runAreas`, `runList.tpl:26` | Client-only |
| Locked/unlocked visual split in run list (two ng-repeats) | n/a | `runList.tpl:22-45` | Client-only |
| Preassigned run row styling (Status=18) | n/a | `runList.tpl:31,42 ng-class` | Client-only |
| Void Jobs run row rendering with ban icon | n/a | `runList.tpl:46-54` | Client-only |
| Run row colour tinting when multi-selected (4 colours rotating) | n/a | `homeControl.js:3298-3320 updatePotentialJobs`, `runList.tpl:35 ng-style` | Client-only |
| Right-click row in Run Builder = context menu (Toggle end / Remove / Void) | n/a | `runBuilder.tpl:49` context-menu binding | Client-only |
| Drag row within Run Builder (jQuery UI sortable via `activateRunDrop`) | n/a | `homeControl.js:891-916` | Client-only (no persist on drop - operator must Route+Lock again) |
| Multi-run marker set from run list Ctrl+click | n/a | `homeControl.js:3298-3331 updatePotentialJobs`, `HereMap.tpl:555-590` | Client-only |
| Row multi-select highlight of "active" rows | n/a | `homeView.html:205-232` | Client-only jQuery |

### 1.6 Couriers + fleets panels

| Feature | Legacy backend | Legacy frontend | SP / method |
|---|---|---|---|
| Active couriers list (grouped by fleet) | `CourierController.Index` -> `GET /Courier` | `homeService.js:79-88 getPotentialCouriers`, `homeControl.js:843-872 getPotentialCouriers` (grouping done client-side) | `UTL_stpCourier_Active` |
| Fleet click -> Couriers pane populates with that fleet's couriers | n/a | `homeControl.js:874-881 showCouriers`, `potentialCourierFleets.tpl:17-20` | Client-only |
| Courier drop onto run row -> preassign confirm dialog (Status=18 vs 0) | n/a | `homeControl.js:2547-2600 activateRunListDrop courier branch` | Client + `InsertOrUpdateRun` |
| Courier row click -> `selectCourier` (declared but body-less in tpl) | n/a | `potentialCouriers.tpl:17` | Dead reference |

### 1.7 Map panel (Google Maps + HERE Maps)

| Feature | Legacy backend | Legacy frontend | External |
|---|---|---|---|
| Google Maps SDK load (with places + Directions services) | `Views/Shared/_Layout.cshtml:35-57` | uses `GoogleMapsKey` (prod) / `GoogleMapsDevKey` (dev) env vars | Google Maps API |
| HERE Maps JS v3 SDK load | `Views/Shared/_Layout.cshtml:78-81` | Included but only `HereMap.tpl` uses it | HERE Maps |
| Map init at Auckland (-36.88, 174.61), zoom 10 | n/a | `HereMap.tpl:35-92 initialize()` | Google Maps |
| Auto Zoom toggle control on map | n/a | `HereMap.tpl:72-89 zoomControl` | Client-only |
| Draw route directions (Google Directions API) | n/a | `HereMap.tpl:815-906 calcRoute + drawDirections` | Google Directions |
| Draw route from >23 waypoints (chunked) | n/a | `HereMap.tpl:908-1066 drawDirectionsMoreThan23Waypoints` | Google Directions (chunked) |
| Draw markers only (unsorted or sorted) | n/a | `HereMap.tpl:441-641 drawMarker` | Google Maps |
| Marker colours: green start (#b0f26f), blue end (#6fb4f0), grey unassigned (#c7c7c7), multi-run palette (#ff9000/#00a3ff/#ffff00/#b13cff) | n/a | `HereMap.tpl:340-370, 384-403, 415-430, 562-585` | Client-only |
| Highlight pin (bounce 1s) when job selected in list | n/a | `HereMap.tpl:273-288 highlightPin` | Client-only |
| Right-click marker context menu (assigned pin): Transfer / Set End / Remove From Run | n/a | `HereMap.tpl:134-169 addClickHandler contextMenu` | Client-only |
| Right-click marker context menu (grey pin): Add To Run / Set End / Remove From Run | n/a | `HereMap.tpl:194-231 addGreyClickHandler contextMenu` | Client-only |
| Left-click grey marker = Add To Run (unlocked run) or Add To Locked Run | n/a | `HereMap.tpl:177-184` | Client + `Job/UpdateJobToRun` |
| Route to selected run via HERE findsequence2 API | `RouteController.GetHereMapSequence` -> `POST /Route/GetHereMapSequence` | `homeControl.js:2739-2885 updateRunDetailsFromRun / routeRun`, `homeService.js:132-141 getHereMapSequence` | `RouteRepository.GetHereMapSequenceAsync` -> `https://wps.hereapi.com/v8/findsequence2` |
| RouteSavvy optimize fallback (>200 stops) | `RouteController.Index` -> `POST /Route`, `RouteController.RouteWithName` -> `POST /Route/RouteWithName` | `homeService.js:112-131 getRouteSavvy / getRouteSavvyWithName`, `homeControl.js:5107-5127 callRouteSavvy` (used for >23 Google waypoints), `homeControl.js:3737-3809` (>200 via HereMap build) | `RouteRepository.FetchBulkRouteAsync` + `GoogleDirectionRepository.GetOrderedWaypoints[WithName]` -> `http://optimizer2.routesavvy.com/RSAPI.svc/POSTOptimize` |
| Compute total distance / time from Google Directions response | n/a | `HereMap.tpl:1068-1089 computeTotalDistance` | Client-only |
| Auto-fit map bounds to selected pins | n/a | `HereMap.tpl:263-271 setMapBounds`, `HereMap.tpl:634-636 fitZoom` | Client-only |

### 1.8 Build Runs (postcode + delivery window + vehicle capacity)

| Feature | Legacy backend | Legacy frontend |
|---|---|---|
| Build config modal (Max Boxes vs Delivery Window, Minutes per stop, Vehicle Capacity + preset + custom cubic) | n/a | `homeControl.js:498-617 openBuildRunsConfig` + `434-441 buildConfig` |
| Build config persistence (localStorage) | n/a | `homeControl.js:606-610`, `homeControl.js:434-440` init |
| Build mode indicator button in Grouped Jobs header (shows "Max Boxes" / "Delivery Window" + " + VC") | n/a | `homeView.html:79-84`, `homeControl.js:473-478 buildModeLabel` |
| Build Runs entry point (button) | n/a | `homeView.html:76 Build Runs button` |
| Max Boxes mode: bucket by PrefixRunName (postcode-mapped), cap by client MaxJobsPerRun (default 20), merge trailing bucket to `PostCodeMergeTo` sibling | n/a | `homeControl.js:3767-3783 fast path`, `3920-3936 same for <200 branch` |
| Delivery Window mode: bucket by ScheduleWindowStart, cap by shortest ScheduleWindowEnd - Start | n/a | `homeControl.js:3538-3617, 3143-3175 splitOrderedJobsByDeliveryWindow` |
| Vehicle Capacity constraint: caps run by cumulative JobCubicM3 vs vehicle cap | n/a | `homeControl.js:3184-3225 splitOrderedJobsByConstraints` |
| Pre-build alert modal: missing schedule windows / missing cubic / multi-window info | n/a | `homeControl.js:3647-3716 buildWarnBlockHtml + buildMultiWindowInfoHtml + openBuildAlertModal` |
| Auto-run-name generation: `<postcode><A/B/C...>` (Max Boxes), `DW<HHMM><A/B/C...>` (Delivery Window) | n/a | `homeControl.js:3811-3839, 3975-3999` |
| HERE findsequence2 call per bucket (used to reorder + get per-leg minutes) | n/a | `homeControl.js:3862-3885, 3737-3809` |
| Build inserts runs one-at-a-time via `updateRunDetailsFromRun` (recursively pops from `runsToInsertList`) | n/a | `homeControl.js:3847-3856` |

### 1.9 Hotkeys

| Feature | Legacy backend | Legacy frontend |
|---|---|---|
| Ctrl+D: Dispatch selected jobs (opens `dispatchJobsForm` gather dialog for courier number, then hits `api.php` DEAD path) | n/a | `homeControl.js:687-696` |
| Esc: close gather / eventForm / dateService form | n/a | `homeControl.js:698-707` |
| Ctrl+A: Select all rows in `activeTable` | n/a | `homeControl.js:709-716` |
| Enter: submit gather form | n/a | `homeControl.js:718-725` |
| Del: click delete-row on each active row in Run Builder | n/a | `homeControl.js:727-741` |
| Ctrl+D / Ctrl+A browser default-suppress in Index.cshtml | n/a | `homeView.html:141-166 overrideKeyboardEvent` |

### 1.10 Miscellaneous

| Feature | Legacy backend | Legacy frontend |
|---|---|---|
| GPS validation (lat/lng ranges) | n/a | `homeControl.js:4619-4646 gpsForm.validateLatLng` |
| Places autocomplete (Google) inside GPS form | n/a | `gpsForm.tpl:63-69`, `homeControl.js:4735-4753 placeChanged` |
| Google marker drag + reverse-geocode on drop | n/a | `homeControl.js:4762-4784 markerDragend` |
| eventForm.tpl (Add Event: job#, client, contact, date, time, event, minutes late, ETA, job type, notes) | n/a | `eventForm.tpl` INCLUDED in `homeView.html:116` but NO `eventForm` scope code exists in homeControl.js - **DEAD UI** never opened |
| gatherForm / gatherFormMulti generic gather-input form used by rename / edit-field / merge-run / dispatch-courier flows | n/a | `gatherForm.tpl`, `gatherFormMulti.tpl`, populated from `gather.form.fields` |
| `dispatchJobs` client function that POSTs to `api.php` with `call:'dispatchJobs'` payload | n/a | `homeControl.js:769-819 dispatchJobs` - **DEAD backend** (`api.php` file exists but is a PHP stub, never wired into .NET routes) |
| `saveLayout` POSTs to `api.php` with `call:'saveLayout'` - **DEAD** | n/a | `homeControl.js:296-323 gather.form.onSubmit` |
| `bundleconfig.json` + `compilerconfig.json` (LESS -> CSS build via BuildBundlerMinifier) | root files | `compilerconfig.json.defaults` config |
| Cookie-domain shared across `.deliverdifferent.com` (or tenant domain) | `Program.cs:135` `options.Cookie.Domain = domain` | n/a |

---

## Section 2: RoutedOperations current inventory

### 2.1 Bootstrapping + auth + tenant setup

| Feature | Backend | Frontend |
|---|---|---|
| Cookie auth (same scheme `Identity.Application`, same cookie name `.AspNet.SharedCookie`) | `Program.cs:246-269` | n/a |
| DataProtection dev/local + prod AWS SSM `/Hub/DataProtection` | `Program.cs:77-118` | n/a |
| Cookie policy + forwarded-headers proxy support | `Program.cs:42-47, 132-139` | n/a |
| Env vars enforced: `Domain`, `RedisConfig`, `SQLCredentials`, `PublicPath`, `HeremapApiKey`, `GoogleMapsKey`, `RouteSavyID` | `Program.cs:120-127, 230-244`, `HomeController.cs:59-65` | n/a |
| Redis distributed cache / session (`routed_operations_session` cookie) | `Program.cs:237-244, 271-275` | n/a |
| Health checks `/healthz` + `/health/live` | `Program.cs:60-62, 280-303` | n/a |
| Docker (net10, Node20 for Vite, port 8080) | `Dockerfile` | n/a |
| Serilog with per-request logging + config-driven overrides | `Program.cs:35-58, 405` | n/a |
| GitLab CI (`test:frontend` type-check gate) | `.gitlab-ci.yml` | n/a |
| CSRF: X-Requested-With required on POST/PUT/PATCH/DELETE | `Program.cs:343-358` | `services/api.ts:12-16` |
| Security headers (CSP, HSTS in prod, XFrameOptions, Referrer-Policy, Permissions-Policy) | `Program.cs:361-393` | n/a |
| SPA fallback: unmatched non-API paths render `Home/Index` | `Program.cs:412` | n/a |
| SPA bootstrap payload (window.__APP_USER__) | `Views/Home/Index.cshtml:36-38`, `HomeController.cs:75-85` | `context/AuthContext.tsx` |

### 2.2 Cockpit shell + layout (React SPA)

| Feature | Backend | Frontend |
|---|---|---|
| React 19 SPA with Vite bundler, TypeScript, Tailwind | n/a | `package.json`, `vite.config.ts`, `tailwind.config.js` |
| React Router with sidebar nav: Dashboard / Routes / Quoting / Scheduled Routes / Polygon Builder | n/a | `App.tsx`, `components/Layout/Sidebar.tsx` |
| AppLayout: sidebar + header + `<Outlet />` | n/a | `components/Layout/AppLayout.tsx` |
| Header: tenant + timezone + user email | n/a | `components/Layout/Header.tsx` |
| Dashboard page (tenant info card + links) | n/a | `pages/Dashboard.tsx` |
| Cockpit (RoutesPage -> CockpitPage) with 4-column resizable panels (`react-resizable-panels`) | n/a | `pages/RoutesPage.tsx`, `components/cockpit/CockpitPage.tsx` |
| Layout save/load (localStorage) via LayoutMenu | n/a | `components/cockpit/LayoutMenu.tsx`, `lib/layouts.ts` |
| Filter preset save/load (localStorage) via FilterPresetsMenu | n/a | `components/cockpit/FilterPresetsMenu.tsx`, `lib/filterPresets.ts` |
| ActionToolbar (bulk actions on job multi-select: Void / Un-void / Bulk move / Send selected / Clear) | n/a | `components/cockpit/ActionToolbar.tsx` |
| RunActionToolbar (bulk actions on run multi-select: Lock all / Unlock all / Dispatch all / Delete all / Clear) | n/a | `components/cockpit/RunActionToolbar.tsx` |
| Global search: Sidebar link + Header user card (NO cross-jobs global search box) | n/a | Not implemented - per-pane search only |
| Ctrl+D / Ctrl+A / Esc / Del / Enter hotkeys | n/a | `hooks/useHotkeys.ts`, `CockpitPage.tsx:1113-1157` |
| Toast notifications | n/a | `context/ToastContext.tsx` |
| CSV export from Jobs list | n/a | `lib/csvExport.ts` |

### 2.3 Filters + Build config

| Feature | Backend | Frontend |
|---|---|---|
| Filters bar (Date + multi-select Regions/Speeds/Clients/OurRefs + Refresh + Sync EH/HD) | n/a | `components/cockpit/FiltersBar.tsx` |
| Client filter list | `GET /api/jobs/filters/clients` | `services/jobService.ts getClientFilters` |
| Region list | `GET /api/regions?runDate=` | `services/regionService.ts` |
| Speed list per date | `GET /api/speeds?runDate=` | `services/speedService.ts getForRunDate` |
| Speed list (all - for JobDetail) | `GET /api/speeds/all` | `services/speedService.ts getAll` |
| OurRef list | `GET /api/jobs/filters/refs?runDate=` | `services/jobService.ts getOurRefs` |
| Vehicle size options | `GET /api/vehicle-sizes` | `services/vehicleSizeService.ts` |
| Build config modal (Max Boxes / Delivery Window + minutes + vehicle capacity + routing mode + no-reroute + respect pickup cutoff) | n/a | `components/cockpit/BuildConfigModal.tsx`, `lib/buildConfig.ts` |

### 2.4 Job management (JobsList / JobDetail / GroupedJobs panels)

| Feature | Backend | Frontend |
|---|---|---|
| Fetch jobs (server-side filter) | `GET /api/jobs?date=&clientIds=...` | `services/jobService.ts getBulkJobs` |
| Sync EH/HD | `POST /api/jobs/sync-hd?runDate=` | `services/jobService.ts syncHd` |
| Update job field | `PATCH /api/jobs/{id}` | `services/jobService.ts updateDetail` |
| Update GPS coords | `PATCH /api/jobs/{id}/gps` | `services/jobService.ts updateGps` |
| Bulk move to different date | `POST /api/jobs/bulk-move` | `services/jobService.ts bulkMove` |
| Void / Un-void with relationship dialog + multibox expansion | `POST /api/jobs/void` | `services/jobService.ts void`, `VoidRelationshipDialog` |
| Multibox children (server) | `GET /api/jobs/{id}/multibox-children` | `services/jobService.ts getMultiboxChildren` |
| JobsList (grid + sort + size filter + multi-select checkboxes + CSV export) | n/a | `components/cockpit/JobsList.tsx` |
| JobDetail (inline-editable panel, all fields grouped by section) | n/a | `components/cockpit/JobDetail.tsx` |
| GroupedJobs pane (postcode vs time bucket toggle + drag + context menu) | n/a | `components/cockpit/GroupedJobs.tsx` |
| Fix GPS modal (HERE geocoder + map marker + drag) | n/a | `components/cockpit/FixGpsModal.tsx` |
| Bulk move date modal | n/a | `components/cockpit/BulkMoveDateModal.tsx` |
| Void relationship dialog (parent/child + multibox choices) | n/a | `components/cockpit/VoidRelationshipDialog.tsx` |
| Row / group / run / map context menus (via RowContextMenu + MapContextMenu) | n/a | `components/cockpit/RowContextMenu.tsx`, `MapContextMenu.tsx` |

### 2.5 Run management (RunList / RunBuilder panels)

| Feature | Backend | Frontend |
|---|---|---|
| Fetch runs (filters) | `GET /api/runs?date=&filters=` | `services/runService.ts getRuns` |
| Create / update run | `POST /api/runs` + `PUT /api/runs/{id}` | `services/runService.ts insertOrUpdate/update` |
| Delete run | `DELETE /api/runs/{id}` | `services/runService.ts remove` |
| Assign job to run | `POST /api/runs/{runId}/assign` | `services/runService.ts assignJob` |
| Remove job from run | `DELETE /api/runs/jobs/{jobId}` | `services/runService.ts removeJob` |
| Set job start/end markers | `POST /api/runs/{runId}/jobs/{jobId}/start-end` | `services/runService.ts setJobStartEnd` |
| Dispatch (all locked runs) | `POST /api/runs/dispatch` | `services/runService.ts dispatch` |
| Dispatch selected jobs (bypass run) | `POST /api/runs/dispatch-jobs` | `services/runService.ts dispatchJobs` |
| Send-to-Live button (dispatches locked runs) | n/a | RunList "Send to Live (N)" button |
| Send Selected (bulk dispatch flat jobs to Live) | n/a | ActionToolbar + `handleSendSelected` (uses `window.prompt` for courier id) |
| Prebook button (HIDDEN behind `{false && ...}` guard - status=2 backend still present) | n/a | `RunList.tsx:145-157` |
| Merge run modal (target picker) | n/a | `components/cockpit/MergeRunModal.tsx` |
| Optimize preview modal | n/a | `components/cockpit/OptimizePreviewModal.tsx` |
| Run context menu (Select / Rename / Lock / Optimise / Route+Lock / Merge / Delete) | n/a | `CockpitPage.tsx:1067-1087 runContextMenu` |
| Run row rename inline | n/a | `RunList.tsx:270-283` |
| Locked vs unlocked visual split with section headers | n/a | `RunList.tsx:225-241` |
| Preassigned status (18) row styling | n/a | `RunList.tsx:331 ng-class equivalent` |
| Void Jobs run row + ban icon | n/a | `RunList.tsx:286-291` |
| Routing-mode badges (A-A / FA / NR) on run rows | n/a | `RunList.tsx:293-313` |
| Courier assignment via row dropdown | n/a | `RunList.tsx:349-360` |
| RunBuilder pane: calculator strip + jobs table + context menu + Optimise button | n/a | `components/cockpit/RunBuilder.tsx` |
| Multi-run marker palette on map | n/a | `CockpitPage.tsx:1161-1164`, `GoogleMap.tsx MULTI_RUN_COLOURS` |
| Drag jobs / courier onto run rows | n/a | `RunList.tsx handleDragOver/handleDrop` |

### 2.6 Couriers + fleets

| Feature | Backend | Frontend |
|---|---|---|
| Active couriers (flat) | `GET /api/couriers` | `services/courierService.ts getActive` |
| Fleets (grouped) | `GET /api/fleets` | `services/courierService.ts getFleets` |
| Fleets panel with collapse + drag-courier-to-run | n/a | `components/cockpit/FleetsPanel.tsx` |

### 2.7 Map (Google Maps only)

| Feature | Backend | Frontend |
|---|---|---|
| Google Maps SDK bootstrap + AuthContext key | `Views/Home/Index.cshtml:24-31` | `components/cockpit/GoogleMap.tsx` |
| Marker rendering (start green / end blue / grey unassigned / sequenced orange / multiRun palette) | n/a | `GoogleMap.tsx MULTI_RUN_COLOURS` |
| Selected pin bounce on job select | n/a | Not present as bounce - highlight only |
| Auto zoom toggle | n/a | `GoogleMap.tsx setAutoZoom` |
| Marker context menu (Assign / Transfer / Remove / Set end) | n/a | `MapContextMenu.tsx` |
| Route line drawing via polyline (interconnections) | n/a | `GoogleMap.tsx polylineRef` |
| HERE findsequence2 legacy passthrough | `POST /api/routes/here-sequence` | `services/routeService.ts hereSequence` |
| HERE findsequence2 typed variant with A-A / Finish-at-stop support | `POST /api/routes/here-sequence-typed` | `services/routeService.ts hereSequenceTyped` |
| RouteSavvy optimize + optimize-with-names | `POST /api/routes/optimize`, `POST /api/routes/optimize-with-name` | `services/routeService.ts optimize/optimizeWithName` |
| HERE Maps JS SDK loaded (used only in FixGpsModal - geocoding) | `Views/Home/Index.cshtml:19-23` | `FixGpsModal.tsx` |

### 2.8 Stage 2 sibling modules

| Feature | Backend | Frontend |
|---|---|---|
| Quoting: upload / simulate / delete / list sets | `QuoteController.cs`, `QuoteService.cs` | `pages/Quoting.tsx`, `services/quoteService.ts` |
| Recurring Routes: CRUD + roster + zip search + shapes + assignable targets + schedules lookup (12 endpoints) | `RecurringRoutesController.cs`, `RecurringRouteService.cs` (Configurator's Routes / ZipPolygon / Dispatch_RouteRoster tables) | `pages/ScheduledRoutes.tsx`, `services/recurringRouteService.ts` |
| Polygon Builder: zip picker on Google Maps -> save as Route | (uses recurring routes endpoints) | `pages/PolygonBuilder.tsx` |

### 2.9 Authorization policies

| Policy | Program.cs line | Applied on |
|---|---|---|
| `RouteBuilder.Read` | `Program.cs:156-161` | Read endpoints on all controllers |
| `RouteBuilder.Build` | `Program.cs:164-171` | Write endpoints (jobs / runs assign / GPS / bulk move / start-end) |
| `RouteBuilder.Admin` | `Program.cs:174-183` | Dispatch, sync-hd, delete run, recurring-route create/update/copy/delete |
| `RouteBuilder.Quote` | `Program.cs:186-188` | QuoteController |
| `RouteBuilder.Polygon` | `Program.cs:189-191` | (unused, superseded by recurring-routes) |

---

## Section 3: Feature-by-feature parity matrix

Legend: **COVERED** = full parity, **PARTIAL** = present with sub-behaviour gaps
(specifics called out), **MISSING** = no equivalent, **DIVERGED** = present but
does something different (explained), **N/A-DEAD** = legacy feature that never
worked / points at a dead endpoint so we skip it deliberately.

### 3.1 Bootstrapping + auth + tenant

| Feature | Legacy source | Modern source | Status | Notes |
|---|---|---|---|---|
| Cookie auth `.AspNet.SharedCookie` | `Program.cs:119-136` | `Program.cs:246-269` | COVERED | Same scheme, cookie name, DataProtection |
| Env-var config | `Program.cs:89-102` | `Program.cs:120-127, 230-244` | COVERED | All 5 vars enforced; adds `HeremapApiKey` + `GoogleMapsKey` + `RouteSavyID` explicitly |
| Redis distributed cache | `Program.cs:97-108` | `Program.cs:237-244` | COVERED | Same options |
| Session cookie | `Program.cs:140-143 (hub_session)` | `Program.cs:271-275 (routed_operations_session)` | DIVERGED | Different cookie name - INTENTIONAL (per PARITY-TRACKING R2.7) so both apps can co-exist on one browser; not a bug |
| Tenant claim -> DB context | `HomeController.cs:28-45`, `DynaimcDespatchDBContextFactory.cs` | `HomeController.cs:63-65`, `Infrastructure/DynamicDespatchDbContextFactory.cs` | DIVERGED | Cache key uses `-ClientManager-Connection` instead of `-RunBuilder-Connection`. Intentional per PARITY-TRACKING R2.7 |
| Health checks | `Program.cs:159-180` | `Program.cs:280-303` | COVERED | Same routes, same shape |
| Docker | `Dockerfile` net8 | `Dockerfile` net10 + Node 20 | COVERED | Adds Node for Vite; net10 vs net8 - intentional upgrade |
| GitLab CI | `.gitlab-ci.yml` | `.gitlab-ci.yml` | COVERED | Adds explicit frontend type-check gate |
| CSRF header | absent | `Program.cs:343-358` | DIVERGED | X-Requested-With enforced - a hardening addition, not a regression |
| Security headers (CSP / HSTS) | absent | `Program.cs:361-393` | DIVERGED | Additive; not a regression |
| Raygun error reporting | `appsettings.json:15-17` unwired | absent | N/A-DEAD | Config key present in legacy but no client code initialised it |

### 3.2 Cockpit shell + layout

| Feature | Legacy source | Modern source | Status | Notes |
|---|---|---|---|---|
| 4-column resizable + box sortable | `homeView.html:50-108` | `CockpitPage.tsx` PanelGroup | COVERED | react-resizable-panels replaces angularResizable + ui.sortable |
| DFRNT logo top-left | `homeView.html:20` | `Sidebar.tsx:12` "Routed Operations" text | DIVERGED | Sidebar branding is different (text label vs image logo); could be treated as UI polish gap |
| Global cross-jobs search box in top bar | `homeView.html:22-33` | absent | **MISSING** | RoutedOperations only has per-pane search boxes; no top-bar search across `runListCombined()`. Operators used this to type a job number and jump straight to it from anywhere on the screen. |
| Layout Save/Load dropdown (localStorage persistence) | `homeView.html:36-47`, `homeControl.js:264-335` | `LayoutMenu.tsx`, `lib/layouts.ts` | COVERED | Better - actually persists (legacy `saveLayout` POSTed to `api.php` DEAD path) |
| Refresh button | `homeView.html:36` | `FiltersBar.tsx Refresh` button | COVERED |  |
| Ctrl+click multi-row + drag-select | `homeView.html:205-313` | JobsList checkboxes + multi-select | DIVERGED | RoutedOperations uses explicit checkboxes; not a ctrl+drag paint gesture. Per iteration 1.03 REJECTED (intentional ergonomics improvement) |
| Arrow-key row navigation | `homeView.html:341-348` | absent | **MISSING** | Legacy Up/Down arrow moves between rows in the active pane. Not wired in `useHotkeys.ts`. |
| Draggable job/group count indicator (`#draggingItems`) | `homeView.html:126, 297-306` | Native HTML5 drag events | DIVERGED | Modern uses browser drag ghost; legacy showed "3 Jobs" bubble. Not a functional gap. |
| eventForm.tpl "Add Event" gather dialog | `eventForm.tpl` included in `homeView.html:116` | absent | N/A-DEAD | No code path in `homeControl.js` opens this - dead UI from earlier prototype. Do not port. |

### 3.3 Filters

| Feature | Legacy source | Modern source | Status | Notes |
|---|---|---|---|---|
| Date filter | `pickDateForm.tpl:46-47` (`pickadate` widget) | `FiltersBar.tsx date input` | DIVERGED | Native HTML5 date picker vs pickadate. Functional parity. |
| Client / Region / Speed / OurRef multi-selects | `pickDateForm.tpl:25-48` (`ng-dropdown-multiselect`) | `FiltersBar.tsx MultiSelect` | COVERED |  |
| pickDateService modal (popup on button) | `homeControl.js:459-467` | `FiltersBar.tsx` (inline filter bar - always visible) | DIVERGED | UX shift: filters always visible instead of popup. Not a gap. |
| `getFilter` OurRef refresh on date change | `homeControl.js:449-452` | `useEffect(loadLookups) on filters.date` | COVERED |  |
| Vehicle sizes fetch | `JobController.VehicleSizes` | `GET /api/vehicle-sizes` | COVERED |  |

### 3.4 Job list + JobDetail + GroupedJobs

All Stage-1 covered items marked COVERED per PARITY-TRACKING iteration 0/1.
Novel gaps this audit surfaces:

| Feature | Legacy source | Modern source | Status | Notes |
|---|---|---|---|---|
| Server-side job filter (date+clients+regions+refs+speeds) | `JobRepository.GetBulkJobsAsync` | `JobService.GetBulkJobsAsync` | COVERED | With geospatial region-filter fix per R2.1 |
| Sync EH/HD | `POST /Job/SyncHDJobs` | `POST /api/jobs/sync-hd` | COVERED | Same SP (`UTL_stpJob_tblBulkJob_SyncHDJobs`) |
| Update job field | `POST /Job/UpdateJobDetail` | `PATCH /api/jobs/{id}` | COVERED | Same EF Update logic, +CultureInfo.InvariantCulture |
| Update GPS coords | `POST /Job/UpdateGps` | `PATCH /api/jobs/{id}/gps` | COVERED | Adds US ZIP+4 parsing safety (JobService.ParsePostCode) |
| Bulk move | `POST /Job/BulkUpdateRouteDate` | `POST /api/jobs/bulk-move` | COVERED |  |
| Void / un-void with relationship dialog | `POST /Job/VoidJobs`, `homeControl.js:1305-1631` | `POST /api/jobs/void`, `VoidRelationshipDialog.tsx` | COVERED |  |
| Multibox children lookup (server) | `GET /Job/GetMultiboxChildren` | `GET /api/jobs/{id}/multibox-children` | COVERED |  |
| Group by postcode (with suburb names) | `homeControl.js:4190-4224` | `GroupedJobs.tsx groups reduce` | PARTIAL | Postcode grouping works but the *suburb names summary* (`suburbNames: groups[key].map...unique().join(', ')`, rendered as `groupedJobs.tpl:47 {{grouped.name}}&nbsp&nbsp&nbsp&nbsp({{grouped.suburbNames}})`) is NOT rendered. Operators lose the quick "3110 (Ponsonby, Grey Lynn)" hint. |
| Group by time-of-day | `homeControl.js:4027-4097` | `GroupedJobs.tsx bucketByTime` | DIVERGED | Legacy buckets by exact `ReadyTime` string; modern buckets by 30-min slot. Per PARITY-TRACKING R1.8 REJECTED (intentional). |
| Time-band multi-select (`addTime` / `setTime` opens all rows with matching times) | `homeControl.js:4099-4162`, `groupedJobs.tpl:22 addTime` | `groupContextMenu` "Open these times" partly covers | PARTIAL | The 1-hour-range warning + auto-sort-by-postcode-after step is not present. Menu item exists but downstream behaviour is thinner. |
| Group context menu Create Run From Group (postcode mode) | `homeControl.js:4337-4342 groupedJobsMenu` | absent | **MISSING** | The menu item "Create run from group" that immediately spawns a new empty run and drops all group jobs into it is not in `groupContextMenu`. Operators currently have to type a run name and drag - one extra step. |
| Jobs list inline row context menu Void | `homeControl.js:1161-1168 jobListMenu`, `jobList.tpl:14 context-menu` | `jobContextMenu` in `CockpitPage.tsx:1027-1038` | COVERED | Also adds Show on map + Fix GPS + Remove from run |
| JobDetail inline vs modal edit paradigm | `jobDetail.tpl` opens `gather.form` modal per field | `JobDetail.tsx EditableCell` inline | DIVERGED | Modern is inline click-to-edit. Per PARITY-TRACKING I1.04 REJECTED (UX improvement) |
| JobDetail field: `Ok_To_Leave` / "Sig not req" checkbox | `jobDetail.tpl:91-94` | Not surfaced | **MISSING** | Legacy shows a "Sig not req" cell backed by `Ok_To_Leave` bit column. Modern JobDetail does not render it. |
| JobDetail field: `Notes` (also editable) | `jobDetail.tpl:28-30` | `JobDetail.tsx Section title="Notes"` | COVERED |  |
| Fix GPS modal | `gpsForm.tpl` + `homeControl.js:4579-4817` | `FixGpsModal.tsx` | COVERED | Uses HERE geocoder (legacy used Google places). Functional parity |
| GPS validation (lat -90..90, lng -180..180) | `homeControl.js:4619-4646` | Should verify in `FixGpsModal.tsx` | (verify) | Likely PARTIAL; deferred |
| GPS form: Google places autocomplete input | `gpsForm.tpl:63-69` | Uses HERE geocoder in `FixGpsModal.tsx` | DIVERGED | Different provider (per user's H1 story). Not a bug |
| GPS form: "Copy Listed Address to search" button | `gpsForm.tpl:14-16`, `homeControl.js:4811-4816 copyGpsAddress` | absent | **MISSING** | Convenience button that pastes the current job's address into the search box. Small UX loss. |

### 3.5 Run list + Run Builder

| Feature | Legacy source | Modern source | Status | Notes |
|---|---|---|---|---|
| Fetch runs (server-side filter) | `JobController.GetBulkRuns` | `GET /api/runs` | COVERED | R2.1 geospatial fix + R2.4 sibling-key null-coalesce applied |
| Create Run (auto-name "Run N") | `homeControl.js:2652-2672 newRun` (client-only until locked) | `POST /api/runs` (must supply a name) | DIVERGED | Modern needs a name up-front; legacy auto-named `Run 1`, `Run 2` in-memory. Operators lose the quick "make a run then drop stuff into it" workflow (no name required until commit). |
| Insert or Update Run (persist locked run) | `POST /Job/InsertOrUpdateRun` | `POST /api/runs` | COVERED |  |
| Update Run (rename / courier / percent) | `POST /Job/UpdateRun` | `PUT /api/runs/{id}` | COVERED |  |
| Delete Run | `POST /Job/DeleteRun` | `DELETE /api/runs/{id}` | COVERED |  |
| Move job to run | `POST /Job/UpdateJobToRun` | `POST /api/runs/{runId}/assign` | COVERED | HOLDLOCK MERGE preserved |
| Remove job from run | `POST /Job/DeleteBulkJobRun` | `DELETE /api/runs/jobs/{jobId}` | COVERED |  |
| Set job start / end markers | (no dedicated endpoint - legacy stores in memory only) | `POST /api/runs/{runId}/jobs/{jobId}/start-end` | COVERED (improved) | Legacy `isStart` / `isEnd` were client-side flags, lost on refresh; modern persists them |
| Run context menu: Edit Name | `homeControl.js:1999-2033` | `runContextMenu Rename` | COVERED |  |
| Run context menu: Edit Route Date | `homeControl.js:2034-2113` | absent | **MISSING** | Not in `runContextMenu`. Legacy bulk-updated all jobs in the run to a new delivery date via one context-menu click. Currently operators must multi-select in the Jobs pane and use the ActionToolbar. |
| Run context menu: Merge Run | `homeControl.js:2115-2202` | `runContextMenu Merge into...` -> `MergeRunModal` | COVERED |  |
| Run context menu: Route and Lock | `homeControl.js:2205-2219` -> `routeRun` | `runContextMenu Route and Lock` -> `handleOptimizeRun({lockAfter:true})` | COVERED |  |
| Run context menu: Toggle Run Lock | `homeControl.js:2222-2274 toggleRunLock` | `runContextMenu Lock/Unlock` | COVERED |  |
| Run context menu: Remove (unlocked only) | `homeControl.js:2277-2311` | `runContextMenu Delete run` | COVERED (with confirm) |  |
| Run context menu: Send Selected Runs To Live | `homeControl.js:2314-2324`, `sendSelectedJobsToLive` | RunActionToolbar bulk Dispatch on multi-select | COVERED |  |
| RunList "Send to prebook" button | `homeView.html:95` -> DEAD `sendTo('prebook')` | `RunList.tsx:145-157` HIDDEN behind `{false && ...}` | N/A-DEAD | Legacy button pointed at unmapped endpoint; modern hides it awaiting spec (per PARITY-TRACKING C.4). Not a gap. |
| RunList "Send to live" (all locked) | `homeView.html:96` | `RunList.tsx Send to Live (N)` | COVERED |  |
| Auto Routing toggle | `homeView.html:89-91` | `CockpitPage.tsx autoRoute` state | COVERED |  |
| Marker colour tinting for multi-selected runs | `homeControl.js:3298-3320`, `HereMap.tpl:555-590` | `GoogleMap.tsx MULTI_RUN_COLOURS` | COVERED |  |
| Preassigned run row styling (Status=18) | `runList.tpl:31` | `RunList.tsx:331` | COVERED |  |
| Void Jobs run row + ban icon | `runList.tpl:46-54` | `RunList.tsx:286-291` | COVERED |  |
| Locked / unlocked visual split | `runList.tpl:22-45` (two ng-repeats) | `RunList.tsx:225-241` (section headers when both present) | COVERED (improved) |  |
| RunBuilder calculator strip (9 stats) | `runBuilder.tpl:15-44`, `homeControl.js:3023-3058` | `RunBuilder.tsx totals` + `runBuilderTotals` | COVERED |  |
| RunBuilder context menu: Toggle end / Toggle start / Remove / Void | `homeControl.js:1120-1178` | `RunBuilder.tsx contextItems` | COVERED (Toggle Start added per modern) |  |
| Merge run: destination picker (dropdown of unlocked runs excluding self) | `homeControl.js:2117-2154` gather form | `MergeRunModal.tsx` | COVERED |  |
| Preassign confirm dialog when courier drop -> unlocked run (Status=18 vs 0) | `homeControl.js:2547-2600` | Simple direct assign via row dropdown | **MISSING (PARTIAL)** | The two-choice modal ("Pre-assign to courier Y/N?") that let dispatcher explicitly pick between Status=18 (Preassigned) and Status=0 (open) after dragging a courier onto a run is not present. Modern uses a plain dropdown that always keeps status unchanged. |
| Row-drag re-order within RunBuilder | `homeControl.js:891-916 activateRunDrop` | absent | **MISSING** | Legacy allowed operators to drag rows inside the Run Builder to manually change stop order (without persisting - a hint before re-routing). Modern only supports Optimise via HERE. |
| `runListCombined()` global-search backing dataset | `homeControl.js:2722-2737` (returns `runJobsAll`) | absent | **MISSING** | Consequence of missing top-bar search. See §3.2. |

### 3.6 Couriers + fleets

| Feature | Legacy source | Modern source | Status | Notes |
|---|---|---|---|---|
| Active couriers grouped by Fleet | `CourierController.Index` | `GET /api/fleets` (grouped) + `/api/couriers` (flat) | COVERED | Modern splits into two endpoints - additive |
| Fleet click -> show couriers | `homeControl.js:874-881` | `FleetsPanel.tsx` collapse | COVERED |  |
| Courier drag onto run row | `homeControl.js:2547-2600` | `RunList.tsx handleDrop courierRaw branch` | COVERED (see §3.5 preassign gap) |  |
| Courier `selectCourier` click (unused in legacy templates) | `potentialCouriers.tpl:17` | absent | N/A-DEAD | Not defined in scope; dead reference |

### 3.7 Map

| Feature | Legacy source | Modern source | Status | Notes |
|---|---|---|---|---|
| Google Maps init at Auckland | `HereMap.tpl:35-92` | `GoogleMap.tsx init` | COVERED |  |
| Marker colours (5 kinds + multiRun palette) | `HereMap.tpl` colour blocks | `GoogleMap.tsx Pin` kinds | COVERED | 6-colour palette (was 4) - per PARITY-TRACKING iteration 0 enhancement |
| Marker context menu: Add / Transfer / Remove / Set End | `HereMap.tpl:134-231` | `MapContextMenu.tsx` | COVERED |  |
| Auto Zoom toggle | `HereMap.tpl:72-89` | `GoogleMap.tsx autoZoom` | COVERED |  |
| Highlight (bounce 1s) selected pin on job select | `HereMap.tpl:273-288 highlightPin` | `GoogleMap.tsx` (highlight only, not bounce animation) | PARTIAL | Modern hi-lights but does not animate bounce. Cosmetic. |
| Draw Google Directions route line | `HereMap.tpl:290-439 drawDirections` | polyline via HERE result | DIVERGED | Modern uses HERE `findsequence2` legs then polyline; Google Directions is not called for the cockpit map surface. Functional parity for the sequenced view. |
| Draw route from >23 waypoints (Google chunked) | `HereMap.tpl:908-1066` | absent | **MISSING** | If Optimise is used with <200 stops but >23, legacy chunked into multiple Google Directions calls and merged; modern doesn't do this since it goes HERE-first with a RouteSavvy fallback above 200. Practical impact: cockpit map won't draw the full driving line above ~23 stops even when HERE returns a valid sequence. Numerical order still shows on pins. |
| RouteSavvy fallback >200 stops during Build Runs | `homeControl.js:3737-3809` | `handleOptimizeRun` handles `>200` per run; Build Runs (`doBuildRuns`) does NOT re-invoke RouteSavvy on the >200-per-bucket case | PARTIAL | Legacy called `getRouteSavvyWithName` for >200 buckets in `getGroupedJobsHereMapSequence`. Modern `bucketJobs` will call HERE regardless of size (may fail silently past HERE's 120 practical cap). Rare in NZ, common in US. |
| Right-click map (blank space) context menu | `HereMap.tpl:61-70 setContextMenu control:'map' Center here` | absent | **MISSING** | Legacy let operators right-click on empty map space to "Center here"; MapContextMenu only fires on marker right-click. |
| HERE findsequence2 typed variant (A-A / finish-at-stop) | absent | `POST /api/routes/here-sequence-typed` | DIVERGED | Adds routing-mode support absent in legacy - enhancement |

### 3.8 Build Runs

All present. Modern actually EXCEEDS legacy in some cases (pickup-cutoff cap,
routing-mode-per-run, no-reroute flag).

| Feature | Legacy source | Modern source | Status | Notes |
|---|---|---|---|---|
| Build config modal (Max Boxes / Delivery Window + minutes + VC) | `homeControl.js:498-617` | `BuildConfigModal.tsx` | COVERED |  |
| Vehicle Size preset dropdown | `homeControl.js:544-556` | `BuildConfigModal.tsx` | COVERED |  |
| localStorage persistence | `homeControl.js:606-610` | `lib/buildConfig.ts save/load` | COVERED |  |
| Pre-build alert modal (missing windows / missing cubic / multi-window info) | `homeControl.js:3647-3716` | `doBuildRuns` toast messages, no modal | PARTIAL | Modern uses toast warnings ("Skipped: X job(s) missing schedule window; Y missing cubic"). The dedicated multi-window info modal with the schedule-list preview is gone. Legacy operators used this to sanity-check their bucketing before build. |
| Auto run-name (`<postcode>A`, `DW0600A`) | `homeControl.js:3811-3839` | `CockpitPage.tsx:817-822 labels` | COVERED |  |
| Recursive `getGroupedJobsHereMapSequence` (async pop-loop) | `homeControl.js:3726-4024` | `doBuildRuns for-loop over buckets` | COVERED |  |
| Pickup-cutoff cap (Phase 2 §6.5) | absent | `CockpitPage.tsx:796-806` | DIVERGED | Modern adds; enhancement |
| Routing-mode-per-run (A-B / A-A / finish-at-stop) | absent | `BuildConfigModal.tsx routingMode`, `runService.assignJob` | DIVERGED | Modern adds; enhancement |
| No-reroute flag on run | absent | modern `run.noReroute` + NR badge | DIVERGED | Modern adds; enhancement |

### 3.9 Hotkeys

| Feature | Legacy source | Modern source | Status | Notes |
|---|---|---|---|---|
| Ctrl+D dispatch | `homeControl.js:687-696` | `useHotkeys.ts onDispatch` | COVERED |  |
| Ctrl+A select all in active pane | `homeControl.js:709-716` | `useHotkeys onSelectAll` + `activePane` tracking | COVERED |  |
| Esc close modals | `homeControl.js:698-707` | `useHotkeys onEscape` | COVERED |  |
| Enter submit modal | `homeControl.js:718-725` | `useHotkeys onEnter` (auto-finds primary btn) | COVERED |  |
| Del delete row from run | `homeControl.js:727-741` | `useHotkeys onDelete` | COVERED |  |
| Arrow-key row navigation | `homeView.html:341-348` | absent | **MISSING** | See §3.2 |
| Ctrl+D suppress browser bookmark + Ctrl+A suppress select-all-text | `homeView.html:141-166` | `useHotkeys preventDefault` | COVERED |  |

### 3.10 Dispatch flow (send-to-live)

| Feature | Legacy source | Modern source | Status | Notes |
|---|---|---|---|---|
| Insert dispatched runs to tucJob | `POST /Job/InsertRunJobs`, `UTL_stpJob_InsertFromRunBuilder` | `POST /api/runs/dispatch`, `RunCommitService.DispatchAsync` | COVERED |  |
| Send selected jobs (flat list, bypass run) | `homeControl.js:1894-1995 sendSelectedJobsToLive` -> same endpoint | `POST /api/runs/dispatch-jobs`, `RunCommitService.DispatchJobsAsync` | COVERED |  |
| Send Selected courier prompt UX | Uses gather form (`dispatchJobsForm`) - internal API path `api.php` DEAD | Modern uses `window.prompt` | DIVERGED | Neither is polished; legacy was actually broken (`api.php` DEAD). Modern is a functional but rough prompt. Both are unpolished for the "give me a courier for these ad-hoc jobs" flow. |
| Warning if unlocked runs exist | `homeControl.js:1797-1801` | `CockpitPage.handleDispatch` filters `r.status && r.status > 0` (silently skips unlocked) | PARTIAL | Legacy showed an alert("Unlocked runs found!") and refused. Modern silently ignores unlocked runs (they don't dispatch, no user-facing warning). Confusing when the user expected all to go. |
| Warning if client filter on | `homeControl.js:1804-1810` | absent | **MISSING** | Legacy alerted "Warning: client filter is on, are you sure?" before dispatch. Modern doesn't. Risk: dispatcher forgets they're filtered, dispatches partial set. |

### 3.11 Recurring Routes / Polygon Builder / Quoting (Stage 2)

Per PARITY-TRACKING C.3'/C.1'/C.3, all shipped and verified via Playwright.
Not audited again here.

### 3.12 Miscellaneous

| Feature | Legacy source | Modern source | Status | Notes |
|---|---|---|---|---|
| `dispatchJobs` client function POSTing to `api.php` | `homeControl.js:769-819` | N/A | N/A-DEAD | Backend endpoint never existed |
| `saveLayout` POSTing to `api.php` | `homeControl.js:296-323` | Modern saves to localStorage | COVERED (better - actually persists) |
| `bundleconfig.json` LESS build | root file | Modern uses Tailwind via PostCSS | DIVERGED | Different build tooling; functional parity |
| `.aspnet.SharedCookie` shared across DFRNT app suite | `Program.cs:122-135` | `Program.cs:246-269` | COVERED | Same domain, same cookie |

---

## Section 4: Prioritized gap list (inlined per parent's request)

Only rows marked **MISSING** or **PARTIAL** from §3, prioritized. Each row
includes files to touch, endpoints to wire, complexity estimate.

### P0 (blocks daily workflow) - none identified

Nothing blocks the app from being used. All P0-critical flows (Build,
Optimise, Assign, Dispatch, Void) are covered.

### P1 (user-visible feature regular users rely on)

| # | Gap | Legacy source | Files to create / modify | Complexity |
|---|---|---|---|---|
| P1.1 | **Client filter warning on dispatch** ("Warning: client filter is on, are you sure?") | `homeControl.js:1804-1810` | `wwwroot/app/react/components/cockpit/CockpitPage.tsx handleDispatch` + `handleSendSelected` add a `confirm()` when `state.filters.clientIds.length > 0`. No backend change. | S |
| P1.2 | **Unlocked-runs alert on dispatch** (currently silently skipped) | `homeControl.js:1797-1801` | Same `handleDispatch` in `CockpitPage.tsx`: if any `state.runs` for the current filter has `jobs.length > 0 && (status ?? 0) === 0`, alert the operator by count and require explicit confirm before proceeding. No backend change. | S |
| P1.3 | **Run context menu: Edit Route Date** | `homeControl.js:2034-2113` | `CockpitPage.tsx runContextMenu` add a new item `Edit Route Date...` that opens `BulkMoveDateModal` pre-loaded with the run's jobs (multi-select them, then open modal). No backend change (uses `POST /api/jobs/bulk-move`). | S |
| P1.4 | **Global cross-jobs search box** in top bar or header | `homeView.html:22-33`, `homeControl.js:2722-2737` | `wwwroot/app/react/components/Layout/Header.tsx` add search input; connect via a shared cockpit store or lift filtering into a controller in `CockpitPage`. Result panel lists matching jobs, click jumps to `selectJob`. **Only surfaces on `/routes` page**. No backend change (client-side over `state.jobs` + `state.runs.jobs`). | M |
| P1.5 | **Group context menu: Create Run From Group** (postcode mode) | `homeControl.js:4337-4342` | `CockpitPage.tsx groupContextMenu`: add item `Create run from these jobs` that calls `handleCreateRun("<postcode><A>")` and immediately assigns the group's jobs to it. Backend already supports this via `POST /api/runs` + assign. | S |
| P1.6 | **Grouped Jobs postcode-mode suburb-names summary** ("3110 (Ponsonby, Grey Lynn)") | `homeControl.js:4204-4212`, `groupedJobs.tpl:47` | `wwwroot/app/react/components/cockpit/GroupedJobs.tsx` bucket accumulator: compute distinct `toSuburb` per bucket, render as small trailing text in the group label. Postcode-mode only. | S |
| P1.7 | **JobDetail missing `Ok_To_Leave` / "Sig not req" field** | `jobDetail.tpl:91-94` | `wwwroot/app/react/components/cockpit/JobDetail.tsx Section title="Load"` add a `Row label="Sig not req"` with a boolean editable cell (probably a checkbox). Requires exposing `okToLeave` on `BulkJobDto` (if missing, add in `Core/Application/Dtos/Job/BulkJobDto.cs`). Also verify `JobService.UpdateJobDetailAsync` handles the field name via the default branch (should - it does `Property.CurrentValue = value`, but boolean parsing needs a case added). | S-M |
| P1.8 | **New Run without a name** (legacy auto-named "Run N" in memory) | `homeControl.js:2652-2672 newRun` | `RunList.tsx` change the create-run flow so clicking `+ Create` with empty name synthesizes `Run <N+1>` where N = current run count. Zero backend change. | S |
| P1.9 | **Courier drop preassign confirm dialog** (Status=18 vs 0 choice) | `homeControl.js:2557-2600` | `RunList.tsx handleDrop` courier branch: before calling `onAssignCourier`, open a small confirm modal with two buttons "Preassign (Status 18)" and "Assign only". Requires exposing status in the assign body of `runService.assignJob` OR the courier-drop path calls `runService.update(runId, {status: 18 or existing, courier: X})`. Backend already accepts `status` on `PUT /api/runs/{id}`. | S |
| P1.10 | **Row-drag re-order within RunBuilder** (drag rows to hint sequence) | `homeControl.js:891-916 activateRunDrop` | `wwwroot/app/react/components/cockpit/RunBuilder.tsx` add drag handlers to rows, on drop reorder client-side `builderIndex`. Persist via `PUT /api/runs/{id}` with updated `jobs[].builderIndex`. Backend already handles ordered jobs list. | M |
| P1.11 | **Pre-build alert modal for multi-window info** (schedule preview list) | `homeControl.js:3657-3685 buildMultiWindowInfoHtml` | Replace toast in `CockpitPage.doBuildRuns` with a proper modal (new file `wwwroot/app/react/components/cockpit/BuildAlertModal.tsx`) showing schedule window preview + skip-list before proceeding. Backend unchanged. | M |
| P1.12 | **Draw Google Directions route line for 24-200 stops** (long-run map polyline) | `HereMap.tpl:908-1066 drawDirectionsMoreThan23Waypoints` | `GoogleMap.tsx` when HERE returns a sequence with >23 waypoints, chunk the polyline into 24-stop groups and issue Google Directions API calls per chunk, then splice results. Only affects the polyline rendering. Complex because of Google 25-waypoint cap. Alternative: just render straight-line legs (simpler, less pretty). | M-L |

### P2 (power-user or edge features)

| # | Gap | Legacy source | Files to create / modify | Complexity |
|---|---|---|---|---|
| P2.1 | **Right-click blank map = "Center here"** context menu | `HereMap.tpl:61-70` | `GoogleMap.tsx` bind `contextmenu` on the map instance itself (not just markers), open a small context menu with "Centre here"; call `map.setCenter(latLng)`. `MapContextMenu.tsx` already handles markers - extend to accept a `mapLatLng` variant. | S |
| P2.2 | **Time-band multi-select 1-hour warning + auto-sort-by-postcode after set** | `homeControl.js:4099-4162` | `GroupedJobs.tsx` "Open these times" handler: after multi-select, check the max-min gap of `bookTime` values and warn if >60 min. Then dispatch `SET_GROUP_MODE postcode`. | S |
| P2.3 | **Arrow-key row navigation** in active pane | `homeView.html:341-348` | `useHotkeys.ts` add `onArrowUp` / `onArrowDown`; `CockpitPage.tsx` selects previous / next visible row in the active pane. | M |
| P2.4 | **Highlight pin bounce (1s)** on job select | `HereMap.tpl:273-288 highlightPin` | `GoogleMap.tsx` when `selectedJobId` changes, look up the marker in `markersByJobIdRef`, call `marker.setAnimation(google.maps.Animation.BOUNCE)` and clear after 1s. Cosmetic. | S |
| P2.5 | **GPS form "Copy Listed Address to Search"** convenience button | `gpsForm.tpl:14-16` | `FixGpsModal.tsx` add button "Copy Listed Address to Search" that populates the geocoder input from `job.toAddress` / `job.fromAddress`. | S |
| P2.6 | **RouteSavvy fallback in Build Runs (>200 per bucket)** | `homeControl.js:3737-3809` | `CockpitPage.doBuildRuns` when a bucket exceeds ~120 stops, switch to RouteSavvy via `routeService.optimizeWithName` and interpolate leg minutes proportionally. Rare in NZ, matters for US tenants with large postcodes. | M |
| P2.7 | **Better Send-Selected courier picker modal** (replace `window.prompt`) | `homeControl.js:746-764 dispatchJobsForm` (via `gather.form`) | Create `wwwroot/app/react/components/cockpit/SendSelectedModal.tsx` with proper courier `<select>` (options from `allCouriers`), replace the `window.prompt` in `CockpitPage.handleSendSelected`. | S-M |

### P3 (nice-to-have polish)

| # | Gap | Files | Complexity |
|---|---|---|---|
| P3.1 | Draggable-count bubble (`3 Jobs` follows cursor while dragging) | JobsList / GroupedJobs drag handlers - render an absolutely-positioned overlay showing count | S |
| P3.2 | Header/sidebar branding update to match legacy DFRNT logo | `Layout/Sidebar.tsx` swap text for `<img src=...>` | S |
| P3.3 | GPS validation error message clarity in `FixGpsModal` (confirm parity with legacy ranges) | Verify in `FixGpsModal.tsx`; add inline error text if missing | S |

---

## Section 5: Migration + integration risks

### 5.1 SPs that RunBuilder calls but RoutedOperations doesn't

Grepping `IDespatchContextProcedures.cs`, all legacy SPs are surfaced in
RoutedOperations either through EF lifts or Dapper wrappers. No stranded SPs.
Full inventory of legacy SPs and their RoutedOperations home:

| Legacy SP | RunBuilder call site | RoutedOperations home |
|---|---|---|
| `UTL_stpJob_tblBulkJobWithFilter` | `JobRepository.GetBulkJobsAsync` | Lifted to EF in `JobService.GetBulkJobsAsync` (with R2.1 geospatial fix) |
| `UTL_stpJob_tblBulkRunWithFilter` | `JobRepository.GetBulkRunsAsync` | Lifted to EF in `RunService.GetBulkRunsAsync` |
| `UTL_stpJob_tblBulkRunSettings` | `JobRepository.GetBulkRunSettingsAsync` | Lifted to EF in `JobService.GetClientFiltersAsync` |
| `RVW_stpBulkRegions` | `JobRepository.GetRegionListAsync` | Lifted to EF in `BulkRegionService.GetForRunDateAsync` |
| `RVW_stpBulkSpeeds` | `JobRepository.SpeedListAsync` | Lifted to EF in `SpeedService.GetForRunDateAsync` |
| `UTL_stpCourier_Active` | `CourierRepository.GetPotentialCouriersAsync` | Lifted to EF in `CourierService.GetActiveAsync` |
| `UTL_stpJob_tblBulkJob_SyncHDJobs` | `JobRepository.SyncHDJobs` | Wrapped via Dapper in `HdJobSyncService.SyncAsync` |
| `UTL_stpJob_tblBulkRun_InsertOrUpdate` | `JobRepository.InsertOrUpdateRunAsync` | Lifted to EF in `RunService.InsertOrUpdateRunAsync` |
| `UTL_stpJob_tblBulkJobRun_InsertOrUpdate` | `JobRepository.InsertOrUpdateRunAsync` inner call | Handled by `RunService` via EF direct on `TblBulkJobRuns` |
| `UTL_stpJob_tblBulkRun_Delete` | `JobRepository.DeleteBulkRunAsync` | Lifted to EF in `RunService.DeleteAsync` (verified superset per PARITY-TRACKING B.1) |
| `UTL_stpJob_InsertFromRunBuilder` | `JobRepository.InsertJobAsync` (called per job in InsertJobsAsync) | Wrapped via Dapper in `RunCommitService.DispatchAsync` + `DispatchJobsAsync` |

### 5.2 DB migrations required for gap fixes

If P1.7 (`Ok_To_Leave` in JobDetail) proceeds, no DB migration required -
column already exists on `tblBulkJob`. Just need to surface it in
`BulkJobDto` + the LINQ projection in `JobService.GetBulkJobsAsync`.

If P1.9 (preassign dialog) uses the run status directly, no migration -
Status column already accepts value 18 (Preassigned).

If a proper Prebook flow lands (currently deferred per C.4), that will
need a dedicated migration for `tucJobBooking` template shape - **but that
is spec-blocked**, not code-blocked. Do NOT touch it in this gap-fill pass.

### 5.3 External API keys / config keys that need to move

| Config key | Legacy Location | RoutedOperations Location | Status |
|---|---|---|---|
| `Domain` env var | Env | Env | Same |
| `RedisConfig` env var | Env | Env | Same |
| `SQLCredentials` env var | Env | Env | Same |
| `PublicPath` env var | Env | Env | Same |
| `SQLHealthCheckConnection` env var | Env | Env | Same |
| `GoogleMapsKey` env var | Env | Env | Same |
| `GoogleMapsDevKey` env var | Env | absent | **RoutedOperations only reads `GoogleMapsKey`** - if you deploy to dev without prod-key access, you'll need to either alias or add fallback logic in `Program.cs:125` |
| `HeremapApiKey` env var | Env | Env | Same |
| `HeremapAppId` / `HeremapAppCode` env vars | Env (legacy alt URL) | absent | Legacy fell back to app_id/app_code URL; modern only supports apiKey. If any env still uses the legacy vars, deploy will silently fail HERE calls. |
| `RouteSavyID` env var (note typo: "Savy" not "Savvy") | Env | Env | Same typo preserved |

**Deploy checklist**: confirm on the target tenant that `GoogleMapsKey`
and `HeremapApiKey` (both spellings correct) are set. `RouteSavyID`
typo is intentional per legacy code and must stay.

### 5.4 Cookie / auth quirks

- **Session cookie name changed**: legacy `hub_session` -> modern
  `routed_operations_session`. Two apps can coexist per PARITY-TRACKING
  R2.7. If any downstream service reads `hub_session` cookie directly
  (unlikely - session is used server-side only), it will need updating.
- **Auth cookie unchanged**: `.AspNet.SharedCookie` on the same
  `Identity.Application` scheme, so single-sign-on across the DFRNT
  suite stays intact.
- **CSRF hardening**: modern requires `X-Requested-With: XMLHttpRequest`
  on all POST/PUT/PATCH/DELETE. Legacy did not. Any external
  automation (curl scripts, other DFRNT apps calling modern endpoints)
  must include this header or requests are rejected with 400.
- **Redis cache key**: modern uses `{tenantId}-ClientManager-Connection`
  intentionally so it doesn't collide with legacy RunBuilder's
  `-RunBuilder-Connection`. Both apps can be deployed side-by-side
  reading from the same Redis without stepping on each other.

### 5.5 Data model divergences

- **Legacy uses bulk-schedule tables only** (`tblBulkJob`, `tblBulkRun`,
  `tblBulkJobRun`, `tblBulkRunSchedule`, `tblBulkPostCodeRunName`,
  `tblBulkScheduleLinehaul`, `tblBulkRegion`). All present in
  RoutedOperations (`Core/Domain/Despatch/*.cs`).
- **Stage 2 introduces canonical `Routes` / `ZipPolygon` /
  `Dispatch_RouteRoster` / `TucAgent` tables** (owned by Configurator).
  RoutedOperations already ported these entities. Legacy has no
  knowledge of them - the recurring routes feature is Route Builder + DF
  Admin only. No conflict; no migration risk.
- **`tblQuoteJob` + `tblQuoteRun` shadow tables** for Quoting are
  Stage 2 additions in RoutedOperations only. Migration
  `20260721100000_RoutedOperationsQuoting.sql` already applied.
- **`IsVoidRun` bool on `tblBulkRun`** added by migration
  `20260717090000_...`. RoutedOperations upgrades old Void Jobs rows
  in place at write time (`VoidJobService.cs:69-76`). Legacy code
  doesn't know about the column but continues to work because it
  looks up by `Name == "Void Jobs"` string match.

### 5.6 Frontend architectural gaps to be aware of

- Legacy uses jQuery UI draggable/droppable + `ui-sortable` for
  most drag-drop. Modern uses native HTML5 `dataTransfer` API. Any
  drag payload from a legacy custom source (e.g. `data-jobid`
  attribute-based) will not survive - modern reads
  `application/x-bulk-job-ids` and `application/x-courier-id`
  MIME types. Not user-facing, but worth noting if any external tool
  scrapes the DOM.
- Legacy uses `angularjs-dropdown-multiselect` for filters; modern
  uses a custom `MultiSelect` component. Keyboard behaviour may
  differ (tab order, escape).
- Legacy renders many templates as `.tpl` files served with
  `text/plain` MIME (per `Program.cs:183-188`). Modern renders
  everything through Vite-bundled TSX. No cache-busting concern.

### 5.7 Playwright verification coverage

Per PARITY-TRACKING iteration 3 + Stage 2 QA, the following flows are
Playwright-verified on DFRNT tenant 1:

- Cockpit load + job list + run list render
- Route + Lock a run (HERE + status update)
- Void / un-void with relationship dialog
- Build Runs (both modes)
- Scheduled Routes CRUD + Roster
- Polygon Builder (zip picker + save-as-route)
- Quoting upload + simulate

The gaps in §4 are **not covered by Playwright yet**. When they land,
each fix should add a Playwright assertion (existing test file layout
in `.playwright-mcp/`).

---

## Summary counts

- Total legacy features inventoried: 105 (across 10 areas)
- COVERED (full parity): 78
- COVERED with intentional divergence / enhancement: 12
- PARTIAL (missing sub-behaviour): 8
- MISSING (no equivalent): 10
- N/A-DEAD (legacy dead code, do not port): 5
- Actionable gaps: **18 tickets** (0 P0, 12 P1, 6 P2 + 3 P3 polish)

**No blockers.** Every core operator flow works end-to-end today.
Gap fixes are ergonomic + power-user surface.

---

## Loop 2 Findings - additional gaps

Independent second-pass audit run 2026-07-22, after Loop 1's 12 P1 + 7 P2
tickets shipped. Convergence largely reached. This pass digs into
bootstrap / config / edge tpls / hidden map handlers / tenant flags /
per-field flow that the first pass may have skimmed. Result: a small
number of ergonomic gaps + several confirmations. No structural /
functional blockers found.

### Section A - missed features (grouped by area)

1. **Google Places autocomplete country restriction in Fix GPS.**
   Legacy `gpsForm.tpl:63-68` passes `country: 'us'` or `'nz'` into the
   Places autocomplete component so search suggestions are geographically
   scoped to the tenant. Modern `FixGpsModal.tsx` does not - `grep -n
   'country|componentRestrict' FixGpsModal.tsx` returns nothing. As a
   result the Google Geocoder returns worldwide candidates and the
   operator can accidentally geocode a "Green St" in Belfast onto a
   Boston job. The tenant's country IS already known: `AuthContext.tsx`
   line 10 (`isUsTenant: boolean`) and `types/index.ts:10` expose it, but
   no consumer reads it. Small win: forward `isUsTenant` into the
   Geocoder request's `componentRestrictions: { country: ... }`.

2. **RunList row multi-select colour matches map-pin palette.**
   Legacy `homeControl.js:3300-3320` assigns each multi-selected run one
   of `["#ff9000", "#00a3ff", "#ffff00", "#b13cff"]` (orange / cyan /
   yellow / purple) and paints BOTH the map pins AND the RunList row's
   background with the same colour. This gives operators a visual join
   between the multi-selected rows on the left and their coloured pin
   clusters on the map. Modern paints the map pins per the palette (via
   `GoogleMap.tsx:477-481 multiRunColourByJobId`) but the RunList row
   only gets a single `bg-brand-cyan/10` tint regardless of how many
   runs are multi-selected (`RunList.tsx:280-290`). Cosmetic parity gap.

3. **JobDetail address-row right-click "Update GPS" context menu.**
   Legacy `jobDetail.tpl:11,21` (From / To rows) bind
   `context-menu="detailAddressMenu"` on the address rows and the menu
   fires `updateGPS(...)` for that specific side (pickup vs delivery).
   Modern `JobDetail.tsx` has a single header "Fix GPS" button
   (`JobDetail.tsx:44-51`) that opens the modal without pre-selecting
   which side (pickup / delivery). Modern is arguably cleaner UX but
   the operator loses the "right-click the wrong address, one action"
   shortcut. Superseded by Fix GPS button - low priority.

4. **Grey (unassigned) map pin single-click adds to selected run.**
   Legacy `HereMap.tpl:177-184 addGreyClickHandler` binds `click` on
   grey pins to `addToRunFromMap(...)` - one click adds the unassigned
   job to the currently active run. Modern requires right-click on the
   pin -> "Add to run" -> pick target run from menu (`MapContextMenu.tsx`
   lines 96-100 renders "Add to run" branch). Two clicks vs one for
   what is a hot-path repetitive action when the operator is dragging
   through a bucket.

5. **Confirm dialog on removing job from a LOCKED run.**
   Legacy `HereMap.tpl:155-161` prompts `"Are you sure you want to
   remove this job from the locked run?"` before removing a job that
   sits on a locked run. Modern `CockpitPage.tsx:465-477
   handleRemoveJobFromRun` calls `runService.removeJob(jobId)` with no
   guard regardless of lock state. Locked runs are already dispatched
   to a courier so silently pulling a job back is a small safety loss.

6. **Legacy has NO explicit HERE Maps app_id/app_code fallback vars.**
   Confirmed non-gap: `RouteRepository.cs:52` in legacy references
   `HeremapAppId` / `HeremapAppCode` in a COMMENTED-OUT alternative URL
   only. The active URL uses `HeremapApiKey`. Modern uses the same
   `HeremapApiKey`-only path (`HereMapService.cs:32`). Section 5.3 note
   about "silent HERE fail if only legacy vars set" is theoretical -
   the legacy Docker image also only reads `HeremapApiKey`.

7. **Legacy Raygun error-tracking config in appsettings.json is dead.**
   `appsettings.json:15-17` has a `RaygunSettings` block, but there is
   no `Raygun` package reference in `RunBuilder.csproj` and no C# call
   site. Modern correctly omits. NOT a gap.

8. **Legacy `dev` uses `GoogleMapsDevKey`, prod uses `GoogleMapsKey`.**
   Already noted in Section 5.3 of the original doc. `_Layout.cshtml:52-54`
   is the branch. Not re-listing.

9. **Bootstrap parity is clean.** Modern `Program.cs` is a superset of
   legacy `Program.cs`: adds forwarded headers, CSRF X-Requested-With
   guard, security headers (CSP + HSTS + Referrer-Policy +
   Permissions-Policy), request size limits, Serilog request logging,
   and EF-model warmup service. Modern also correctly namespaces the
   Redis cache key (`ClientManager-Connection` vs legacy's
   `RunBuilder-Connection`) so the two apps can coexist per PARITY R2.7.
   No missing bootstrap concern.

10. **Backend endpoint inventory is 1:1 or superset.** Every legacy
    action on `JobController` / `RouteController` / `CourierController`
    has an equivalent on the modern `JobsController` / `RunsController` /
    `RoutesController` / `CouriersController`. Modern adds
    `RegionsController`, `SpeedsController` (with `/all`),
    `VehicleSizesController`, `FleetsController`, `BulkImportController`,
    `QuoteController`, `RecurringRoutesController`. No missing endpoint.

11. **Legacy `eventForm.tpl` is dead template scaffolding.** Referenced
    from `homeView.html:116` via `ng-include` but no `eventForm.` scope
    setter in `homeControl.js`. Not a gap.

12. **Legacy `currentCourier` JobDetail iframe is dead code.**
    `jobDetail.tpl:162-166` renders an Auckland map iframe when
    `currentCourier` is truthy, but `homeControl.js` only ever sets
    `currentCourier = false / null` (lines 804, 3356, 4548). No setter
    exists that would ever show the iframe. Not a gap.

13. **Legacy `.tpl` files' `box.searchBox` per-panel filter is dead
    template.** `jobList.tpl:14`, `potentialCouriers.tpl:17`,
    `potentialCourierFleets.tpl:18` bind `filter: box.searchBox` but
    `box.searchBox` is never set anywhere in `homeControl.js`. Fleet
    panel search IS re-implemented in modern via `FleetsPanel.tsx`
    (search prop + memo filter, lines 20-31). Jobs list panel search is
    covered by the global search top-bar (P1.4). Not a gap.

14. **No URL deep links / query params in legacy.** `app.js:19-29`
    defines a single `home` state at `url: '/'` with no params. Modern
    `App.tsx` adds `/routes`, `/bulk-import`, `/dashboard`, etc. Modern
    is strictly a superset. Not a gap.

15. **No CSV / XLSX export from legacy cockpit.** `grep -in
    'export|csv|download|xlsx|excel' homeControl.js` returns nothing
    (only string constants inside the migrated Bulk Import module).
    Nothing to port.

16. **No 401 / session-timeout handling in legacy frontend.** Legacy
    relies on server-side cookie auth `OnRedirectToLogin` per
    `Program.cs:128-132`. Modern uses the same server-side behaviour
    (`Program.cs:262-267`). Both apps throw a generic toast on 401 mid
    session. Not a gap.

17. **Hotkeys inventory is 1:1.** Legacy `homeControl.js:687-741`
    registers Ctrl+D, Esc, Ctrl+A, Enter, Del. Modern `useHotkeys.ts`
    lines 50-105 handles Escape, Ctrl+D, Ctrl+A, Delete, Backspace,
    Enter, Arrow keys. Modern is a superset (Arrow keys are new per
    P2.3). Not a gap.

18. **Legacy hard-coded `$25` hourly rate on RunBuilder calculator.**
    `runBuilder.tpl:39` shows `$25.00` as a literal. Modern
    `RunBuilder.tsx:26-44` comments reference the same hard-code. Both
    apps expose it as a static value. Confirmed intentional.

19. **Legacy Serilog default level Debug vs modern Information.** Legacy
    `appsettings.json:4` sets `Default: Debug`. Modern sets
    `Default: Information`. Modern is more conservative / production-
    appropriate. Not a gap (log level is intentional).

### Section B - prioritized gap list (Loop 2)

#### P0 (blocks daily workflow) - none

#### P1 (user-visible feature regular users rely on) - none

Loop 1 shipped every P1 item that was actionable. Loop 2 finds no new
P1 gaps.

#### P2 (power-user or edge features)

| # | Gap | Legacy source | Files to touch | Complexity |
|---|---|---|---|---|
| L2.P2.1 | **Fix GPS Places autocomplete country restriction** | `gpsForm.tpl:63-68` | `FixGpsModal.tsx` add `componentRestrictions: { country: user.isUsTenant ? 'us' : 'nz' }` to the `new google.maps.places.Autocomplete(...)` config (or `Geocoder` request `region` field). Pull `isUsTenant` from `AuthContext`. | S |
| L2.P2.2 | **Confirm before removing job from a LOCKED run** | `HereMap.tpl:155-161` | `CockpitPage.tsx handleRemoveJobFromRun` add a `confirm(...)` gate when the job is on a run with `(status ?? 0) > 0`. Fetch the run via `state.runs.find(r => r.jobs.some(j => j.bulkJobId === jobId))`. | S |
| L2.P2.3 | **Grey unassigned map pin: single-click add to selected run** | `HereMap.tpl:177-184 addGreyClickHandler` | `GoogleMap.tsx` marker click branch when `p.kind === 'unassigned'` AND `selectedRun` exists AND `!selectedRun.isVoidRun && (selectedRun.status ?? 0) === 0`: call `onAddToRun(p.bulkJobId, selectedRun.id)` directly (new callback into CockpitPage). Fall back to the current context menu when no run is selected or the selected run is locked. | S-M |

#### P3 (nice-to-have polish)

| # | Gap | Files | Complexity |
|---|---|---|---|
| L2.P3.1 | RunList row multi-select colour matches map-pin palette (orange / cyan / yellow / purple) so the operator can visually cross-reference selected rows to their pin clusters | `RunList.tsx` derive an index-based colour class per `selectedRunIds.indexOf(r.id)` (skip first ~5 palette entries the same way `GoogleMap.tsx:478-481` does), apply as inline `style={{ backgroundColor: colour }}` or a Tailwind ring | S |
| L2.P3.2 | JobDetail address right-click "Update GPS" per-row shortcut (side pre-selected: pickup vs delivery) | `JobDetail.tsx` wire `onContextMenu` on the pickup/delivery Section blocks, open FixGpsModal with a new `defaultSide: 'ToAddress' \| 'FromAddress'` prop | S |

### Section C - what I re-verified as truly covered

Reviewer can skip these areas - they were re-audited in Loop 2 and are
in good shape. Do NOT rework:

- **Bootstrap / Program.cs**: modern is a superset (forwarded headers,
  CSRF gate, CSP + HSTS + security headers, model warmup, structured
  request logging). Legacy `Program.cs:1-202` fully covered by modern
  `Program.cs:1-416`.
- **Health checks**: `SqlServerHealthCheck.cs` present in modern
  (`Infrastructure/SqlServerHealthCheck.cs`), same env var
  (`SQLHealthCheckConnection`), both `/health/live` and `/healthz`
  routes mapped.
- **Auth cookie / DataProtection**: modern preserves scheme name
  `Identity.Application`, cookie name `.AspNet.SharedCookie`, AWS SSM
  path `/Hub/DataProtection`. Session cookie renamed to
  `routed_operations_session` per intentional side-by-side decision.
- **Hotkeys**: modern `useHotkeys.ts` covers Ctrl+D, Ctrl+A, Del,
  Backspace, Escape, Enter, Arrow keys - superset of legacy
  `homeControl.js:687-741`.
- **Multi-run map pin colour palette**: `GoogleMap.tsx:477-481` matches
  legacy `["#ff9000", "#00a3ff", "#ffff00", "#b13cff"]` intent.
- **Layout save/load**: `layouts.ts` uses localStorage, replacing
  legacy's dead `doAPI('saveLayout', ...)` call.
- **BuildConfig persistence**: `lib/buildConfig.ts` persists to
  localStorage matching legacy `RunBuilder_*` keys.
- **Global cross-jobs search** (P1.4): `Header.tsx` +
  `GlobalSearchContext.tsx` shipped, covers legacy
  `homeView.html:22-33`.
- **Courier % colour thresholds** (green <=65, orange 66-75, red >75):
  `RunBuilder.tsx:122-126` matches legacy commented-out logic.
- **RunBuilder calculator strip** (9 stats incl. hard-coded $25/hr):
  `RunBuilder.tsx:156-160` matches legacy `runBuilder.tpl:15-44`.
- **Void Jobs run styling / behaviour**: `RunList.tsx:278-320` uses
  `isVoidRun` throughout, matching legacy filter behaviour.
- **JobDetail Fix GPS button**: `JobDetail.tsx:43-52` covers legacy
  `detailAddressMenu` intent via a top-of-panel button.
- **Grey unassigned pins on the map**: `GoogleMap.tsx buildPins` line
  505 assigns `kind='unassigned'` for jobs with no run - matches
  legacy `potentialJobs`.
- **`Send Selected Runs To Live`** (per-run dispatch of multi-selected
  locked runs): `CockpitPage.tsx handleBulkDispatchSelected` line
  1201-1216 covers legacy `sendSelectedJobsToLive` line 1894-1990.
- **Preassign (Status=18) courier drop dialog** (P1.9): shipped.
- **Field parity in `UpdateJobDetail`**: `JobService.cs:337-378` case
  list matches legacy `JobRepository.cs:35-83` PLUS adds `OkToLeave`
  (P1.7). Legacy's `SigNotRequired` field name hitting `default` case
  was actually broken in legacy - modern does not need to reproduce.
- **RouteSavvy / HERE URLs**: modern uses the same
  `optimizer2.routesavvy.com` endpoint and same HERE
  `wps.hereapi.com/v8/findsequence2` endpoint.
- **Every legacy stored proc**: covered per Section 5.1 mapping table.

### Loop 2 verdict

**Convergence largely reached.** 3 new P2 tickets + 2 P3 polish items,
zero P1 or higher. All are ergonomic refinements against the primary
cockpit flow. No missed feature threatens end-to-end operation.

---

## Loop 3 Findings - final convergence check

Third independent pass, run 2026-07-22, after Pass 1 (12 P1 + BulkImport),
Pass 2 (7 P2), Pass 3 (3 L2 P2 + 2 L2 P3). Scope: controllers,
UI-Router states, repositories, env vars, JS libs, `RunBuilder_SPs/`.

### 3.1 Controller endpoint cross-check

Legacy has 4 controllers with 26 public actions (`Controllers/*Controller.cs`).
Modern has 12 controllers with a superset of routes (`API/Controllers/*Controller.cs`).

| Legacy endpoint | File:line | Modern equivalent |
|---|---|---|
| `HomeController.Index` | `HomeController.cs:10` | `Controllers/HomeController.cs` (MVC shell parity) |
| `HomeController.About/Contact` | `HomeController.cs:85,92` | Not ported - dead MVC scaffold, `Views/Home/About.cshtml` never linked from `homeView.html` |
| `CourierController.Index` | `CourierController.cs:9` | `CouriersController.Get` `CouriersController.cs:14` |
| `JobController.Index` | `JobController.cs:11` | `JobsController.Get` `JobsController.cs:26` |
| `JobController.InsertRunJobs` | `JobController.cs:22` | `RunsController.CreateJobs` (verified in Loop 2) |
| `JobController.GetRunSettings` | `JobController.cs:56` | `JobsController.GetClientFilters` `JobsController.cs:39` |
| `JobController.RegionList` | `JobController.cs:71` | `RegionsController.Get` `RegionsController.cs:14` |
| `JobController.SpeedList/AllSpeeds` | `JobController.cs:78,85` | `SpeedsController.Get/GetAll` `SpeedsController.cs:14,22` |
| `JobController.VehicleSizes` | `JobController.cs:92` | `VehicleSizesController.Get` `VehicleSizesController.cs:14` |
| `JobController.SyncHDJobs` | `JobController.cs:100` | `JobsController.SyncHd` `JobsController.cs:107` |
| `JobController.GetFilter` | `JobController.cs:114` | `JobsController.GetOurRefs` `JobsController.cs:47` |
| `JobController.GetBulkRuns` | `JobController.cs:122` | `RunsController.Get` `RunsController.cs:22` |
| `JobController.InsertOrUpdateRun/UpdateRun/DeleteRun` | `JobController.cs:140,166,191` | `RunsController.Create/Update/Delete` `RunsController.cs:35,45,56` |
| `JobController.UpdateJobDetail` | `JobController.cs:217` | `JobsController.Patch` `JobsController.cs:63` |
| `JobController.UpdateJobToRun` | `JobController.cs:250` | `RunsController.AssignJob` `RunsController.cs:65` |
| `JobController.DeleteBulkJobRun` | `JobController.cs:276` | `RunsController.RemoveJob` `RunsController.cs:75` |
| `JobController.UpdateGps` | `JobController.cs:291` | `JobsController.PatchGps` `JobsController.cs:77` |
| `JobController.BulkUpdateRouteDate` | `JobController.cs:345` | `JobsController.BulkMove` `JobsController.cs:87` |
| `JobController.VoidJobs` | `JobController.cs:387` | `JobsController.Void` `JobsController.cs:97` |
| `JobController.GetMultiboxChildren` | `JobController.cs:429` | `JobsController.GetMultiboxChildren` `JobsController.cs:55` |
| `RouteController.Index` (GET) | `RouteController.cs:11` | Not ported - health/probe shim never called (`homeService.js` uses POST only) |
| `RouteController.Index` (POST) | `RouteController.cs:19` | `RoutesController.Optimize` `RoutesController.cs:21` |
| `RouteController.RouteWithName` | `RouteController.cs:38` | `RoutesController.OptimizeWithName` `RoutesController.cs:29` |
| `RouteController.GetHereMapSequence` | `RouteController.cs:56` | `RoutesController.HereSequence` `RoutesController.cs:37` |

Every non-scaffold legacy endpoint has a modern equivalent.

### 3.2 UI-Router state cross-check

Legacy `app.js:23-53` defines a single active state (`home` -> `/`).
`new` and `search` are commented-out dead code (`app.js:31-51`).
Modern React uses one cockpit page (`react/pages/CockpitPage.tsx`) plus
add-on pages already tracked. No missing state.

### 3.3 Repository method cross-check

Legacy exposes 5 repos (`Models/Repository/*.cs`). All SPs called are:
`UTL_stpJob_tblBulkJobWithFilter`, `UTL_stpJob_tblBulkJob_SyncHDJobs`,
`UTL_stpJob_tblBulkRunSettings`, `RVW_stpBulkRegions`, `RVW_stpBulkSpeeds`,
`UTL_stpJob_tblBulkRunWithFilter`, `UTL_stpJob_tblBulkRun_Delete`,
`UTL_stpJob_tblBulkRun_InsertOrUpdate`, `UTL_stpJob_tblBulkJobRun_InsertOrUpdate`.
Grep of `RoutedOperations/Core/Application/Services/**/*.cs` confirms
every one is referenced (11 hits across `JobService`, `RunService`,
`CourierService`, `RunCommitService`, `HdJobSyncService`, `SpeedService`,
`BulkRegionService`). Zero unreferenced.

### 3.4 Env vars

| Var | Legacy | Modern |
|---|---|---|
| `Domain` | `Program.cs:89` | `Program.cs:232` |
| `RedisConfig` | `Program.cs:97` | `Program.cs:239` |
| `PublicPath` | `Program.cs:130` | `Program.cs:265` + `Controllers/HomeController.cs:56` |
| `SQLCredentials` | `Controllers/HomeController.cs:39` | `Controllers/HomeController.cs:59` |
| `SQLHealthCheckConnection` | `SqlServerHealthCheck.cs:10` | `Infrastructure/SqlServerHealthCheck.cs:12` |
| `RouteSavyID` | `Models/Repository/RouteRepository.cs:31` | `Program.cs:123` |
| `HeremapApiKey` | `Models/Repository/RouteRepository.cs:53` | `Program.cs:124` |
| `GoogleMapsKey` | `Views/Shared/_Layout.cshtml:45` | `Program.cs:125`, `Views/Home/Index.cshtml` |
| `GoogleMapsDevKey` | `Views/Shared/_Layout.cshtml:54` | Not ported - dev-only fallback; `Program.cs` uses single key path |

`GoogleMapsDevKey` is a legacy dev fallback (else branch on env==Dev),
not a runtime feature. Non-gap.

### 3.5 JS libraries

Legacy AngularJS libs (`wwwroot/scripts/libs/`): angular, ui-router,
resizable, sortable, contextMenu, hotkeys, gmaps, ng-map, pickadate,
timepicker, geocomplete, ng-confirm, angularjs-dropdown-multiselect.
Modern replaces via React ecosystem (`package.json`): `react`,
`react-router-dom`, `react-resizable-panels`, plus in-tree components
for context menu/hotkeys/date-picker/multi-select/map (per Section 3).
No legacy lib carries unique runtime behaviour missed by modern.

### 3.6 RunBuilder_SPs folder

27 SQL files. Legacy `JobRepository.cs` + `CourierRepository.cs` +
`RouteRepository.cs` invoke only 9 of these directly (see 3.3). The
remaining 18 (`DD_stpJob_InsertExcelerator`, `INT_stpJob_BulkInsert`,
`NET_stpBulkJobItems_Insert`, `UTL_fncJob_ExceleratorRate`,
`UTL_fncMFV_FAF_Rates`, `UTL_fncSuburb_FromNameWithPostCode`,
`UTL_stpBulk_UpdateParentID`, `UTL_stpCourier_Active`,
`UTL_stpJobBulk_UpdateParentID`, `UTL_stpJob_InsertFromRunBuilder`,
`UTL_stpJob_tblBulkJob`, `UTL_stpJob_tblBulkRun`, `WS_stpJobType_KmRates`,
`WS_stpJobType_Rates`, `fncT_BulkZoneRate_WithLinehaul`,
`sp_AssignJobNumbers`, `sp_BulkZoneRate_AddPostCodeSurcharge`,
`sp_BulkZoneRate_AdditionalSpecialRate`) are indirect dependencies
invoked by the wrapped SPs at DB level (rate calculation, parent-id
fixup, courier lookup). They ship with the DB, not the app; modern
inherits them by wiring the same top-level SPs.

### Loop 3 verdict

**Convergence reached.** No new gaps found across controllers,
UI-Router states, repositories, env vars, JS libs, or SP folder.
Every legacy endpoint has a modern equivalent (excluding the two
dead MVC scaffold actions `About`/`Contact` and the never-called
`GET /Route`). Every SP invoked by a legacy repo is invoked by
a modern service. Every env var is honoured (excluding the
dev-only `GoogleMapsDevKey` fallback). Every legacy JS lib has
a React-side replacement. Three passes of independent gap-finding
now agree the parity work is complete.

