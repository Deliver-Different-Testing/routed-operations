# RoutedOperations NZ Tenant Audit

Discovery agent output. All findings are read-only observations against the
current tree. Every finding cites `file:line`. Prioritised fix list at the
foot of the doc.

Tenant claims are already surfaced end-to-end:
- `HomeController.cs:80-83` stamps `CountryCode`, `IsUsTenant`, `GoogleMapsKey`
  onto `AppUserBootstrap`.
- `types/index.ts:4-13` mirrors that shape as `AppUser`.
- `AuthContext.tsx:22-24` exposes it via `useAuth()`.
- `IsUsTenant` is `true` iff CountryCode == "US" (case-insensitive), so the
  NZ branch is anything else. There is NO explicit `isNzTenant` helper on the
  frontend, which invites the "everything not-US is NZ" assumption. That's
  fine for a 2-country business but flag if a third country ships.

---

## Part 1 - Map centre defaults are hard-coded to the US

Three map surfaces use San Francisco `{ lat: 37.7749, lng: -122.4194 }` as the
initial centre / bounds. On NZ tenants the operator sees an empty US map for
a beat before the first `fitBounds()` fires. If a tenant has zero jobs (fresh
login, empty day, empty run), the fallback SF view is what they land on.

Every hit:

| # | File:line                                                                                                                                                    | Zoom | Purpose                                                                                                                                 |
| - | ------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---- | --------------------------------------------------------------------------------------------------------------------------------------- |
| 1 | `wwwroot/app/react/components/cockpit/GoogleMap.tsx:117`                                                                                                     | 4    | Main cockpit map. `fitBounds()` at line 240-242 kicks in once pins exist, but the pre-fit frame is US.                                  |
| 2 | `wwwroot/app/react/pages/PolygonBuilder.tsx:63`                                                                                                              | 5    | Recurring-route zip polygon picker. This surface is US-only conceptually (polygons = US ZIPs), but on NZ tenants it will still open on SF. |
| 3 | `wwwroot/app/react/components/cockpit/FixGpsModal.tsx:100`                                                                                                   | 3    | Fix GPS preview map. Rebuilt each time the modal opens.                                                                                 |

One outlier goes the OTHER way:
- `wwwroot/app/react/components/bulk-import/FixAddressesModal.tsx:328` uses
  `-36.848, 174.763` (Auckland) as its `defaultCenter`. On US tenants this
  will drop the fallback pin into the Auckland CBD. Same tenant-aware fix
  wanted, opposite direction.

The map wrapper header (`GoogleMap.tsx:116` comment) already claims "matches
the legacy Auckland fallback pattern" but the coordinate is San Francisco -
comment drifted from code.

**Recommended fix:** derive a centre from `useAuth().isUsTenant`:
- US: `{ lat: 39.8283, lng: -98.5795 }` (geographic centre of contiguous US)
  OR `{ lat: 37.7749, lng: -122.4194 }` (SF) - keep existing US choice.
- NZ: `{ lat: -41.2, lng: 174.9 }` (roughly Wellington, splits the two main
  islands nicely) OR `{ lat: -36.848, lng: 174.763 }` (Auckland) - Auckland
  works because that's where the bulk of the run volume lives; the existing
  Auckland default in FixAddressesModal supports this.

Zoom on NZ can stay at 4-5 since the country fits comfortably.

Suggested helper (single source of truth):

```ts
// lib/mapDefaults.ts
export function getMapDefault(isUs: boolean): { center: { lat: number; lng: number }; zoom: number } {
  return isUs
    ? { center: { lat: 37.7749, lng: -122.4194 }, zoom: 4 }
    : { center: { lat: -36.848, lng: 174.763 },  zoom: 5 };
}
```

Then callers do `const { center, zoom } = getMapDefault(useAuth().isUsTenant);`.

---

## Part 2 - NZ label divergences (US-centric copy)

The wizard is largely tenant-aware via `wizardState.ts urgentFieldsFor()`
(line 159-278) which switches labels between `From Zip Code` / `From Post Code`
etc. But there are several bare "Zip" / "Zip Code" surfaces outside the
wizard that will read wrong on NZ.

### Cockpit JobDetail pane

- `components/cockpit/JobDetail.tsx:125` `<Row label="Zip">` on the pickup
  section. Field is `job.fromPostCode` regardless of tenant. NZ label should
  be "Postcode".
- `components/cockpit/JobDetail.tsx:155` `<Row label="Zip">` on the delivery
  section. Same fix.
- Suggested pattern: `<Row label={isUs ? 'Zip' : 'Postcode'}>` after
  destructuring `const { isUsTenant } = useAuth();` at the top.

### Run Builder table header

- `components/cockpit/RunBuilder.tsx:180` `<th className="px-1 py-1">Zip</th>`
  in the run-side table. Tenant-swap to `Postcode` for NZ.

### Grouped Jobs sidebar toggle

- `components/cockpit/GroupedJobs.tsx:86` `<button ... >Zip</button>` is the
  toggle between "Zip" and "Time" grouping. NZ label should be "Postcode"
  (or "Suburb" if grouping actually uses suburb; verify against grouping
  key).
- `GroupedJobs.tsx:101` `placeholder={mode === 'time' ? 'Filter time...' : 'Filter zip...'}`
  - NZ should read "Filter postcode...".

### CSV export headers

- `lib/csvExport.ts:17` `header: 'To Zip'` - NZ column heading should read
  `To Postcode`. Same fix (branch on `isUsTenant`). Reasonable to move the
  columns definition into a function that takes `isUs`.

### Scheduled Routes page

- `pages/ScheduledRoutes.tsx:106` `<th ...>Zip Codes</th>` in the table.
- `pages/ScheduledRoutes.tsx:354` `<Field label="Zip codes (${zips.length})">`
  form field.
- `pages/ScheduledRoutes.tsx:368-374` placeholders "Type to search zip codes...".
- All the `Zip` prose here is arguably US-only feature - `ScheduledRoutes` is
  built on top of the ZipPolygon table which is US-centric. If NZ operators
  will never use this page, leave a note; if they will, all the labels need
  the swap plus the underlying model needs an NZ equivalent.

### PolygonBuilder page

- `pages/PolygonBuilder.tsx:210, 217, 228, 254, 347, 392, 396` - Zip/zip
  copy everywhere. Same "US-only feature?" question as ScheduledRoutes. This
  is inherently a US concept (ZIP polygon picker); recommend an `isUs` gate
  in the sidebar navigation so NZ users don't see it at all.

### Bulk Import wizard leftovers

Already tenant-aware in `FixZipCodesModal.tsx:71` (title switches to "Fix
Suburbs" for NZ) and `wizardState.ts urgentFieldsFor()`. See Part 3 for the
NZ-specific issues that DO remain.

### FixZipCodesModal calls wrong service on NZ

- `components/bulk-import/FixZipCodesModal.tsx:36` calls
  `addressService.getZipCodes()` (`/api/address/zipcodes`, US ZoneZip list)
  regardless of tenant. On NZ this returns an empty list, which the modal
  interprets (line 66 `if (knownSet.size > 0 && !knownSet.has(v))`) as "no
  reference data, treat every value as fine" - so the NZ suburb check is
  effectively bypassed. On NZ the code should call `addressService.getSuburbs()`
  (`/api/address/suburbs`) instead and reshape the response.
- `addressService.ts:105` `getSuburbs` and `addressService.ts:108` `getZipCodes`
  are already both defined; the frontend just needs to pick the right one.
- This is a P1 (silent - wrong reference list means bad-suburb rows fall
  straight through the wizard onto import where they fail deep in the SP
  chain).

### Date, time, currency

- Currency: `lib/formatters.ts:23` hard-codes `currency: 'USD'`; NZ tenant
  should use `'NZD'`. Same fix at `pages/BulkImport.tsx:320`. Suggested
  helper: `currency: isUs ? 'USD' : 'NZD'` off `AppUser.countryCode`.
- Date: `lib/formatters.ts:1-9 formatDate()` already outputs `dd/mm/yyyy` -
  correct for NZ, ambiguous but acceptable for US. Leave.
- `lib/csvExport.ts:13`, `components/cockpit/JobDetail.tsx:94`,
  `pages/BulkImport.tsx:312`, `pages/ScheduledRoutes.tsx:537` use
  `toLocaleDateString('en-GB')` - dd/mm/yyyy. Fine for NZ. US operators
  will read as dd/mm which is confusing but not tenant-blocking; consider
  branching to `en-US` for US.
- Time: 24hr everywhere (`components/cockpit/JobDetail.tsx:340-347 formatTime`
  is 24hr, `csvExport.ts:26-29` window formatting is 24hr UTC). Uniform.

### Header / Sidebar

- `components/Layout/Header.tsx:22` shows `Tenant ${currentTenantId}`. No
  country tag - fine for now. Could add `(NZ)` / `(US)` badge to reduce
  operator confusion when they have both tenants in different tabs.

---

## Part 3 - BulkImport wizard NZ paths

Cross-referenced BulkImportHyper's homeControl (US variant: 5345 LOC,
`BulkImport/wwwroot/app/components/home/homeControl.js`; NZ variant: 1995 LOC,
`BulkImport_NZ/BulkImport/wwwroot/app/components/home/homeControl.js`) against
the current RoutedOperations wizard.

### Required-field parity

RoutedOperations `wizardState.ts urgentFieldsFor()` covers:
- US routed: JobNumber (opt), FromContact, FromCompany, FromAddress*, FromCity*,
  FromState, FromZipCode, ToCompany, ToUnit, ToAddress*, ToCity*, ToState*,
  ToZipCode*, ToContact*, ToContactPhone*, StopType (opt), Quantity. (* = required)
- NZ routed: JobNumber (opt), FromContact, FromCompany, FromAddress*,
  ToCompany, ToUnit, ToAddress*, ToSuburb*, ToPostCode, ToContact*,
  ToContactPhone*, Quantity.
- NZ on-demand adds: FromSuburb*, FromPostCode, BookDate, BookTime.

Compare BulkImportHyper US `homeControl.js:1213-1689` and NZ
`homeControl.js:227-441`:

Fields in legacy that are MISSING from RoutedOperations `urgentFieldsFor()`:
- `length` / `width` / `height` / `weight` - legacy makes these **required
  UNLESS `stockSize` is set** on `$scope.import`
  (US: `homeControl.js:1539-1574`; NZ: `homeControl.js:350-381`). The wizard
  in RoutedOperations OMITS these fields entirely from `urgentFieldsFor`
  (see `wizardState.ts:270-276` where only `quantity` is added after
  contact fields). The wizard just hard-codes them to zero in
  `NewImportWizard.tsx:180-183` (`length: 0, width: 0, height: 0, weight: 0`).
  For NZ this is arguably fine (many clients use a fixed stock size).
  For US routed batching + rating this WILL under-price / mis-route the load.
  **NZ impact: zero. US impact: potential mis-rating.** Flag as P3 (does not
  block NZ, does distort US rating).
- `clientRefA` / `clientRefB` / `ourRef` / `notes` / `trackingEmail` /
  `trackingMobile` - all missing from `urgentFieldsFor` but wired through
  `buildJobs()` in `NewImportWizard.tsx:184-189`. That means the fields
  are POSTed as null on every row because there's no mapping UI to fill
  them. Legacy always exposes them as optional map columns. **NZ + US
  impact: no `clientRef` / no `ourRef` / no `notes` on any imported row.**
  Ref A can be mandatory per client (US: `homeControl.js:1582-1588`) - if a
  tenant has `referenceAMandatory = true` the current wizard has no way to
  satisfy it. P2.
- `bookDate` / `bookTime` on the on-demand path are US-legacy required-
  optional (both `required: () => false` but included when jobType is
  ondemand). RoutedOperations mirrors this correctly (`wizardState.ts:174-177`).
- `courierPercentageOverride`, `amount`, `country`, `courierCode` - legacy
  US extras hidden (show: false) but still bind-able. Not needed for MVP.

### Step-visibility parity

BulkImportHyper flow:
1. Step 1 - New Import (client + file + type)
2. Step 2 - Map Columns
3. Step 3 - Fix Zips (US) / Fix Suburbs (NZ)
4. Step 4 - Fix Addresses (geocode + drag pins)
5. Step 5 - Select Regions (bucket into location groups)
6. Step 6 - Rate By Distance (US routed only; NZ or on-demand skips)

RoutedOperations `NewImportWizard.tsx:82-138` renders exactly these 6 modals
and the skip logic at line 119-125 skips Step 6 for `!isUs || onDemand` -
correct.

### Service call differences (US vs NZ)

- **Suburbs vs ZIPs reference list**: NZ uses `/api/address/suburbs` (backed
  by `TucSuburbs`), US uses `/api/address/zipcodes` (backed by `ZoneZip`).
  Both endpoints exist in `AddressController.cs:61,81`. **The wizard always
  calls `getZipCodes()`** (`FixZipCodesModal.tsx:36`) even on NZ. See Part 2
  finding. **Fix**: call `getSuburbs()` when `!isUs`.
- **NZ routed `fromSuburb` requirement**: `BulkImportJobFactory.cs:856` throws
  `Invalid suburb(s).` when any NZ row is missing `FromSuburb` or `ToSuburb`.
  `urgentFieldsFor()` in the wizard ONLY includes `fromSuburb` for
  `!isUsTenant && jobType === 'onDemand'` (`wizardState.ts:205-208`). So NZ
  **routed** imports have no `fromSuburb` field in the mapping UI at all,
  meaning the payload arrives with `fromSuburb=null` and the server rejects
  every row. **This blocks NZ routed imports outright.** P0.
- **NZ routed also needs ScheduleId**: `BulkImportJobFactory.cs:625-629`
  errors out if a matching `TblBulkRunSchedules` row exists and `ScheduleId`
  is null. The wizard hard-codes `scheduleId: null` in
  `NewImportWizard.tsx:53`. Whether this fires depends on the tenant's
  schedule config - if any schedule exists for the requested speed + day
  combo, NZ import is blocked. P1 (data-dependent).

### "Fix Zip Codes" vs "Fix Suburbs" label logic

- Determined by `const isUs = auth.isUsTenant || state.client?.isUsTenant`
  (`FixZipCodesModal.tsx:25`).
- Title switches at line 71: `isUs ? 'Fix Zip Codes' : 'Fix Suburbs'`.
- Reference dropdown option at line 122: `Choose ${isUs ? 'Zip Code' : 'Suburb'}...`.
- OK badge at line 100: `isUs ? 'Zip Codes seems OK.' : 'Suburbs seems OK.'`.

The label logic is correct. The **data** the modal loads is wrong (see above).

### Client-code / job-number prefix

- `formatJobNumber` (`BulkImport/wwwroot/app/components/home/homeControl.js:4212-4223`)
  passes the value through unchanged unless it's blank or literally
  "AUTOGENERATE", in which case it stamps "AUTOGENERATE" and lets the
  backend build `{prefix}{seq}` from `client.JobPrefix`.
- RoutedOperations backend replicates this: `BulkImportJobFactory.cs:151-162`
  finds rows with `JobNumber == "AUTOGENERATE"` and calls
  `sp_AssignJobNumbers` + prefix. **BUT** the wizard has no way to enter
  "AUTOGENERATE" or tick "Autogenerate Job Number" (checkbox is disabled at
  `MapColumnsModal.tsx:341-343`). So the backend feature is dark. See Part 5.
- Formatting differences (`formatZipCode` on US padding to 5 digits;
  `formatPostCode` on NZ padding to 4 digits) exist in the legacy JS but the
  new wizard does NOT normalise these on the frontend. Row values go
  through as raw strings. Backend appears to parse them via
  `int.Parse(j.ToPostCode.Trim())` (`BulkImportJobFactory.cs:807`) so a
  "0632" from Excel that got mangled to "632" will pass parse but hit the
  wrong postcode. Same US concern for stripped leading-zero ZIPs. P2/P3.

### NZ paths that block a first-time completion

Summary of NZ wizard blockers (P0 unless flagged):
1. Routed NZ import fails at server because `fromSuburb` is never mapped.
   Fix: `wizardState.ts:205-208` add fromSuburb + fromPostCode for NZ routed
   too, not just NZ on-demand.
2. `FixZipCodesModal` loads US ZIP reference on NZ tenants. Suburb check
   is silently bypassed. Fix: branch to `getSuburbs()`.
3. Routed NZ ScheduleId null-check (P1, tenant-config-dependent). Fix:
   wizard needs a schedule picker for NZ routed OR backend needs a fallback.

---

## Part 4 - Staff Import (NZ internal only)

### Backend contract from BulkImportHyper

`BulkController.cs:117-160`:
- Endpoint: `POST /api/Bulk/StaffImport`, body `StaffImportRequest`
- Guard 1: reads `Internal` claim; must be `true`. Non-internal -> 401.
- Guard 2: reads `CountryCode` claim; must equal `NZ`. Non-NZ -> 401.
- Delegates to `_bulkService.StaffImport(GetCurrentUserId(), request)`.

`BulkService.cs:4104-4700` (StaffImport body, several hundred lines):
- Resolves `opId` from `TucClientContacts.StaffId`.
- For each job dictionary:
  - Resolves the client via `ClientID` / `Client_ID` / `ClientCode` +
    `UcclActive`.
  - Auto-assigns `jobNumber` via `AssignJobNumbersAsync` when input is
    empty or "AUTOGENERATE".
  - Pulls `BookDate` / `BookTime` (with fallback to `DeliveryDate` /
    `DeliveryTime` for Despatch_Root legacy).
  - Pulls a huge From* + To* + POD* + tracking + geocode + status field
    set (`BulkService.cs:4194-4290`).
  - Calls `INT_stpJob_BulkInsertAsync` (NZ) directly - **bypasses** the
    normal `WS_stpJob_Insert` path used by regular Import.
  - After insert, `InsertJobDeliveryNote` + `NET_stpBulkJobItems_InsertAsync`
    for each qty.
- Returns `StaffImportResponse` with per-row success/error count.

**Key semantic difference from regular Import**:
- Reads client-by-client from the spreadsheet (regular Import binds one
  client per whole batch). One spreadsheet can insert jobs across many
  clients in a single call.
- Field mapping is by column NAME with legacy aliases (Despatch_Root
  compat), not the user-mapped urgentFields dictionary.
- Skips the FixZipCodes / FixAddresses / Rate-by-distance wizard steps
  entirely.
- Writes directly into `tucJob` / `tblJobItem` (live tables), not
  `tblBulkJob` shadow.
- Auto-status defaults to `1` (active) so jobs go live immediately.
- Supports `status` / `jobDone` / `complTime` / `podName` for
  "import as already completed" - the ONLY way this flag reaches the
  live table in the whole system.

### Frontend contract from BulkImportHyper

`homeView.html`:
- Button visible only for internal staff on NZ (`homeView.html:22-24`):
  `<button ... ng-click="startStaffImport()" ng-show="isInternal() && isNzTenant()">
   <i class="fa fa-user-shield"></i> Staff Import</button>`.
- Modal at `homeView.html:1222-1290` (StaffStep1 upload, StaffStep2 preview,
  StaffStep3 fix flagged suburbs).

`homeControl.js`:
- `startStaffImport()` at line 4708-4725: requires `isInternal()` AND
  `isNzTenant()`.
- `uploadStaffFile()` at line 4743: POSTs the file to `/api/Bulk/Upload`
  (same endpoint as regular import), parses the response.
- Validates that the parsed data has a `ClientID` or `ClientCode` column
  (line 4779-4785) - no wizard column mapping needed.
- StaffStep2 previews first 50 rows (`homeView.html:1273-1278`).
- StaffStep3 flags any suburbs not in the tenant `suburbs` list, offers
  a per-suburb replacement dropdown (`homeControl.js:4823-4900`).
- Optional geocode-and-fix pass on rows with missing GPS.
- Final call: `staffImport(request)` -> `POST /api/Bulk/StaffImport`.

### Current RoutedOperations state

- `BulkImportController.cs:150-160` - `POST /api/bulk-import/staff-import`
  is a 501 stub. Log line only, no service call.
- `BulkImportServiceV2.cs` - **NO `StaffImport` method exists**. Only
  `ImportFromGoogleDrive` (line 496, Obsolete-tagged) was ported from
  legacy in preview form.
- No frontend surface at all - no button, no modal, no route.

### What's needed to wire

1. **Port `BulkImportServiceV2.StaffImport(int contactId, StaffImportRequest request)`**
   - Copy the ~600 lines from `BulkImportHyper/BulkService.cs:4104-4700+`.
   - Adjust to RoutedOperations DTOs (`RoutedOperations.Core.Application.Dtos.BulkImport`).
   - `INT_stpJob_BulkInsertAsync` and `NET_stpBulkJobItems_InsertAsync` need
     to be exposed on `DespatchContext.Procedures` if not already there -
     confirm with `Glob **/DespatchContextBulkImportExtensions.cs`.
2. **Add DTO**: `StaffImportRequest` (list of `Dictionary<string, object>`
   rows) and `StaffImportResponse` (per-row success/error). Neither exists
   yet.
3. **Replace the 501 stub** in `BulkImportController.cs:150-160` with the
   real call, keeping the `[Authorize(Policy = "RouteBuilder.Admin")]` gate
   AND adding the Internal + CountryCode == NZ checks like the legacy
   controller (lines 128-151).
4. **Frontend UI**:
   - Add a "Staff Import" button on `BulkImport.tsx` visible only when
     `useAuth().isUsTenant === false && Internal claim === true`. The
     Internal claim currently is NOT exposed on `AppUser` (see
     `AuthContext.tsx`); need to plumb it through `HomeController.cs:75-83`
     as a new `isInternal` bool.
   - Add a wizard modal set (StaffStep1 upload, StaffStep2 preview,
     StaffStep3 flagged suburbs). Simpler than the main wizard - no
     column mapping.
   - `staffImportService.ts`: upload + suburb-check + staff-import calls.
5. **Test path**: only reachable by an internal-flagged NZ staff account,
   so Playwright coverage needs a specific test tenant. Flag for QA.

Rough LOC estimate: ~400 backend + ~500 frontend + 60 DTO. This is a
2-3 day port, not a 1-day one.

---

## Part 5 - Deferred features inventory

### Google Drive import
- **Backend state**: fully ported into `BulkImportServiceV2.cs:496`
  (Obsolete-tagged, body preserved from BulkImportHyper). No `[NotMapped]`
  or #if disabling - the method compiles and would execute.
- **Controller state**: `BulkImportController.cs:165-175` returns 501. Just
  needs to swap the stub for `await bulkService.ImportFromGoogleDrive(...)`
  and remove the `[Obsolete]` from the service.
- **Frontend state**: no UI. Legacy had it at `homeView.html:190` -
  `<button ng-click="openGoogleDrivePicker()">`, which loaded
  `$scope.googleDriveConfig` from `/api/Bulk/GoogleDriveConfig` (returns
  clientId + apiKey), triggered `google.picker.PickerBuilder`, got a
  fileId + accessToken, POSTed to `/api/Bulk/ImportFromGoogleDrive`.
- **What's needed to wire**:
  1. Add a `GET /api/bulk-import/google-drive-config` endpoint that returns
     `{ clientId, apiKey }` from AWS SSM.
  2. Add a "Import from Google Drive" button beside the upload zone in
     `NewImportModal.tsx`.
  3. Wire Google Identity Services (`gis`) + Google Picker JS APIs
     (currently not loaded). Two extra `<script>` tags in the Razor host.
  4. Wire the OAuth token flow (`google.accounts.oauth2.initTokenClient`,
     scope `drive.file`, `drive.readonly`).
  5. Pass `{ fileId, accessToken }` to the un-stubbed
     `POST /api/bulk-import/import-google-drive`. Response is the same
     parsed-grid JSON as `/upload`, so the rest of the wizard flow
     continues unchanged.

### Templates save/load
- **Backend state**: full CRUD service + DTOs exist
  (`Core/Application/Services/BulkImport/TemplateService.cs`,
  `Core/Application/Dtos/BulkImport/Templates/*`,
  `TemplateCreateRequestValidator.cs`). Entity models in
  `Core/Domain/Despatch/BulkImportTemplate*.cs`. **No controller** wires them.
- **Frontend state**: `services/templatesService.ts` is a "coming soon"
  stub (`templatesService.ts:16-31`) that rejects every call.
  `MapColumnsModal.tsx:329-335` renders a disabled `Select Template...
  (Coming soon)` dropdown. `MapColumnsModal.tsx:347-348` renders a
  disabled `Save as template (Coming soon)` checkbox.
- **What's needed to wire**:
  1. Add `TemplatesController.cs` with GET (list per client), POST
     (create), DELETE, calling `TemplateService`. Mirror the shape of
     BulkImportHyper's controller.
  2. Un-stub `templatesService.ts` to actually call the endpoints.
  3. Enable the Step 2 dropdown so selecting a template patches
     `state.mapping` in one go.
  4. Enable the checkbox; on Import success, POST a create-template call
     with the current mapping.

### Autogenerate Job Number
- **Backend state**: fully wired. `BulkImportJobFactory.cs:151-162` and
  `BulkImportJobFactory.cs:859-868` find rows with `JobNumber = "AUTOGENERATE"`
  and stamp `{prefix}{seq}` via `sp_AssignJobNumbers`.
- **Frontend state**: `state.options.autogenerateJobNumber` boolean exists
  (`wizardState.ts:29,66`), and `urgentFieldsFor()` at line 165-173
  correctly HIDES the JobNumber required badge when true. But the UI
  checkbox is disabled at `MapColumnsModal.tsx:337-340`. The reducer never
  gets a `SET_OPTIONS` for it.
- **What's needed to wire**: literally remove `disabled` and add an
  `onChange` that dispatches `SET_OPTIONS { autogenerateJobNumber: e.target.checked }`.
  Then in `NewImportWizard.buildJobs()` (line 156-207): if
  `state.options.autogenerateJobNumber`, set `j.jobNumber = 'AUTOGENERATE'`
  on every row before submit. **This is a ~15-minute change.**

### Import as Completed Jobs
- **Backend state**: `BulkImportRequest.ImportAsCompleted` exists
  (`BulkImportRequest.cs:16`) and is used by `BulkImportJobFactory.cs:141-149`
  to stamp `podName` for the audit trail. Whether the SP call chain actually
  respects the flag is a separate question - the flag is passed but neither
  `WS_stpJob_Insert` nor `DD_stpJob_InsertExcelerator` has an obvious
  "insert as complete" parameter. Confirm the SP contract before shipping.
- **Frontend state**: `state.options.importAsCompleted` boolean exists
  (`wizardState.ts:30,67`), and `NewImportWizard.tsx:56` already
  submits it. Checkbox at `MapColumnsModal.tsx:341-343` is disabled with
  "Coming soon" copy.
- **What's needed to wire**: same as Autogenerate - enable the checkbox
  + wire onChange. Backend already reads the flag.

### Override From Contact
- **Frontend state**: dropdown at `MapColumnsModal.tsx:237-255` bound to
  `state.options.overrideFromContact`. Options come from
  `settings.contacts` (client's saved contact list).
- **Backend state**: **NOT threaded through**. `BulkImportRequest.cs` has
  no `OverrideFromContactId` property. `NewImportWizard.tsx:47-61` doesn't
  add it to the payload. Silently ignored on submit.
- **What's needed to wire**: (a) add `OverrideFromContactId : int?` to
  `BulkImportRequest.cs`; (b) `NewImportWizard.tsx:47-61` include it in
  the payload; (c) `BulkImportJobFactory.cs` per-row: if `OverrideFromContactId`
  set, look up the contact and stamp its name onto every row's `FromContact`
  before the SP call.

### Override Dimensions
- Same story: dropdown at `MapColumnsModal.tsx:257-274` bound to
  `state.options.overrideDimensions`, options from `settings.stockSizes`.
- **NOT threaded to backend**. `BulkImportRequest.cs` has no
  `StockSizeId`.  `NewImportWizard.tsx buildJobs()` at line 180-183 hard-
  codes `length: 0, width: 0, height: 0, weight: 0` and never applies the
  override.
- **What's needed to wire**: add `StockSizeId : int?` to
  `BulkImportRequest.cs`; in `buildJobs()` OR `BulkImportJobFactory.cs` load
  the stock size once and stamp length/width/height/weight from it before
  the SP call.

### Route from client site
- **Frontend state**: checkbox at `MapColumnsModal.tsx:292-303` bound to
  `state.options.routeStartsFromClientSite`. Shows only for US routed
  (line 290).
- **Backend state**: `BulkImportRequest.RouteFromClientSite : bool` exists
  (`BulkImportRequest.cs:30`).
- **JobFactory behaviour**: `BulkImportJobFactory.cs:690-712` when true AND
  the row has `FromAddress`, uses the row's uploaded `From*` fields (NOT
  the client's saved site address). The comment at
  `MapColumnsModal.tsx:88-94` claims the opposite - "sourced from the
  client's saved site address on the server side and therefore does NOT
  need to be mapped". These two disagree.
- **What actually happens**: `state.options.routeStartsFromClientSite` is
  a US-only tick. When ticked, `MapColumnsModal.tsx:95-100` OMITS every
  `from*` row from the required-mapping list on the UI. So the operator
  doesn't map From-fields. The row therefore has no `FromAddress`. The
  JobFactory then falls through the `if (request.RouteFromClientSite && !string.IsNullOrWhiteSpace(j.FromAddress))`
  guard on line 692 (false because `j.FromAddress` is null), skips the
  `originRegion` branch (also null - no Origin Location picked), and
  returns `ResolutionError` "No origin could be resolved" (line 739).
- **Net result**: currently the "Route starts from client site" tick is
  BROKEN. Every routed US row imported with it ticked will fail with
  `No origin could be resolved`. **P1 - it looks like it works, and
  silently fails.** Suggested fix: the JobFactory should read the client's
  saved site address (already loaded at `BulkImportJobFactory.cs:52-64`
  into `client.UcclAddress` + `client.Latitude` + `client.Longitude`) as
  the 4th precedence branch when `RouteFromClientSite == true`. Or, less
  intrusive, the frontend should not hide the From* required fields when
  ticked and should let the operator map them - but the whole point of
  the toggle is to avoid mapping them.

---

# Prioritised fix list

## P0 - NZ tenant cannot use the app at all

1. **NZ routed import always fails with "Invalid suburb(s)."**  
   `wizardState.ts:205-208` gates `fromSuburb` behind `jobType === 'onDemand'`.
   The backend (`BulkImportJobFactory.cs:856`) requires `FromSuburb` on
   NZ routed too. **Fix**: change the NZ branch in `urgentFieldsFor()` so
   `fromSuburb` (required) and `fromPostCode` (optional) are included for
   BOTH NZ routed and NZ on-demand.

## P1 - NZ tenant sees wrong labels / wrong data / silent breaks

2. **Cockpit map opens on San Francisco** on NZ tenants for the pre-fit
   frame (or entirely when zero jobs).  
   `GoogleMap.tsx:117`, `FixGpsModal.tsx:100`, `PolygonBuilder.tsx:63`.
   Introduce `lib/mapDefaults.ts` helper. Auckland `-36.848, 174.763` for
   NZ, keep SF for US.

3. **FixZipCodesModal loads US ZIPs on NZ tenants**, silently bypassing
   the suburb reference check.  
   `FixZipCodesModal.tsx:36` calls `getZipCodes()` unconditionally. Branch
   to `getSuburbs()` when `!isUs` and reshape the response to the same
   `ZipCodeDto` shape (id, zip=suburb name, zoneName).

4. **"Route starts from client site" is a silent no-op** for US tenants.
   Every routed row fails downstream with `No origin could be resolved`.  
   `BulkImportJobFactory.cs:690-712` guard is false when the operator
   doesn't map From* fields (which is the whole point of the toggle).
   Read `client.UcclAddress` + `client.Latitude/Longitude` as the origin
   when `RouteFromClientSite` is true and no `j.FromAddress`.

5. **"Zip" labels in cockpit UI on NZ**: JobDetail (`JobDetail.tsx:125,155`),
   RunBuilder (`RunBuilder.tsx:180`), GroupedJobs toggle + placeholder
   (`GroupedJobs.tsx:86,101`), CSV export header (`csvExport.ts:17`).
   Branch on `useAuth().isUsTenant`.

6. **NZ routed ScheduleId null-check** (data-dependent): if the tenant has
   any `tblBulkRunSchedules` row matching the requested speed + day, the
   backend at `BulkImportJobFactory.cs:625-629` throws "Schedule is required.".
   Wizard hard-codes `scheduleId: null` in `NewImportWizard.tsx:53`.
   Needs a schedule picker at Step 1 for NZ routed OR a lenient default
   in the JobFactory.

7. **Currency hard-coded to USD** on NZ.  
   `formatters.ts:23` and `BulkImport.tsx:320`. Branch on `isUsTenant`.

## P2 - Deferred features (feature-flag stubs) to wire

8. **Autogenerate Job Number checkbox** currently disabled -
   `MapColumnsModal.tsx:337-340`. Backend is fully ready. ~15-minute wire-up.

9. **Import as Completed checkbox** currently disabled -
   `MapColumnsModal.tsx:341-343`. Backend already reads the flag; SP-side
   support for the flag needs a quick confirmation.

10. **Templates save/load** - service + DTOs exist server-side, no controller,
    stub client (`templatesService.ts`). Un-stub the client, add a
    `TemplatesController`, wire the two disabled controls in Step 2.

11. **Google Drive import** - 501 stub at
    `BulkImportController.cs:165-175`. Service body preserved
    (`BulkImportServiceV2.cs:496`, `[Obsolete]`). Frontend needs OAuth +
    picker wiring.

12. **Staff Import** - 501 stub, no service method, no frontend UI. NZ +
    internal-staff only. ~2-3 day port.

13. **Override From Contact / Override Dimensions** - dropdowns render + save
    to local state but never reach the backend. Add `OverrideFromContactId`
    + `StockSizeId` to `BulkImportRequest.cs`, thread through
    `NewImportWizard.buildJobs` and `BulkImportJobFactory`.

14. **Missing map columns**: `clientRefA`, `clientRefB`, `ourRef`, `notes`,
    `trackingEmail`, `trackingMobile`. All are POSTed as null on every
    row because they have no `urgentFields` entry. Add them as optional
    fields. Tenants with `referenceAMandatory = true` cannot use the wizard
    right now.

15. **Missing map columns for dimensions**: `length`, `width`, `height`,
    `weight`. Currently hard-coded to 0 in
    `NewImportWizard.buildJobs`. Distorts US rating.

## P3 - Polish

16. **Auckland `-36.848, 174.763` default in FixAddressesModal** shows on
    US tenants for the fallback pin. Same tenant-aware helper (Part 1)
    fixes it.

17. **Date format** - all frontend date rendering uses `en-GB` (dd/mm/yyyy).
    Correct for NZ, ambiguous for US. Consider branching to `en-US` for US.

18. **ZIP / postcode leading-zero preservation** - US ZIPs and NZ postcodes
    both lose leading zeros when Excel exports numbers. Legacy JS had
    `formatZipCode` / `formatPostCode` normalisers (`homeControl.js:4225-4256`).
    Not ported. Frontend now sends raw values.

19. **PolygonBuilder + ScheduledRoutes pages** are inherently US-centric
    (ZipPolygon model). If NZ operators will never use them, gate the
    sidebar links behind `isUsTenant`. If they will, both need a large
    NZ-suburb equivalent piece of work.

20. **`Tenant ${id}` header badge** could show `(NZ)` / `(US)` country
    tag to avoid confusion across tabs.

---

# Sanity notes

- `AuthContext.tsx` does NOT expose `isInternal`, `contactId`, or the
  raw `CountryCode`. Only `isUsTenant`. Anything requiring the Internal
  claim (Staff Import) will need `HomeController.cs:75-83` to add an
  `IsInternal` bool.
- The RoutedOperations tree has zero em-dashes; NZ-TENANT-AUDIT.md
  follows the same rule.
- No SPs, tables, or migrations were touched. Only read paths were
  followed. `mssql` and `mssql-dfrnt` MCP not queried.
