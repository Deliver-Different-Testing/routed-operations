# Routed Wizard - BulkImportHyper Parity Spec

Status: DISCOVERY complete. No code changes made.
Author: discovery agent, 2026-07-23.
Scope: identifies the missing Step 6 (Book Date / Service / Schedule / Time picker)
in the current RoutedOperations React BulkImport wizard against the
BulkImportHyper AngularJS reference implementation.

All line citations use `file:line` format against files under
`C:\Gitlab\BulkImportHyper\` (reference) and
`C:\Gitlab\RoutedOperations_Root\RoutedOperations\` (current).

--------------------------------------------------------------------------------

## Section 1: BulkImportHyper full flow map

The AngularJS wizard is a state machine keyed by `$scope.showImport = 'StepN'`.
Exactly one `.UStep.stepN` block is visible at any time. Transitions are
triggered by `$scope.showImportStep('StepN')` (defined at
`components/home/homeControl.js:3599`) and by the per-step Next handlers
(`mapColumns`, `fixSuburbs`/`fixZipCodes`, `sortByDepot`, `nextDepot`,
`confirmImport`).

The flow for `import.jobType === 'routed'` is 6 visible steps (Step 6 is
the picker that is missing from our React wizard) + a post-flight Step 7
(kmRatedJobs review / success) + optional Step 8 (Book a Pickup).

### Step 1 - New Import

- View: `components/home/homeView.html:143-223`
- Purpose: pick client, upload file, pick Import Type (routed / on-demand).
- Controls:
  - Client picker (`ui-select`, internal-staff typeahead) at `homeView.html:151-172`
  - File input at `homeView.html:179`
  - `import.jobType` radio - `routed` (label "Routed" US, "Scheduled" NZ)
    or `ondemand` at `homeView.html:198-213`
  - "Upload File" button calls `uploadFile()` at `homeView.html:221`
- Endpoints:
  - `POST /api/Bulk/Upload` (multipart) - parses file, returns headers + rows
    (`homeService.js:169`)
- Persisted state: `import.client`, `import.jobType`, `import.file`,
  `import.data`, `import.fields`
- Validation gate: file selected, client selected, jobType selected.
- Next: `showImportStep('Step2')`.

### Step 2 - Map the Columns

- View: `homeView.html:225-343`
- Purpose: map customer columns to internal `urgentFields[]`, set overrides
  and per-import options.
- Controls:
  - Column mapping select per required/optional urgentField
    (`homeView.html:242-260`)
  - Override From Contact dropdown (`homeView.html:267-271`)
  - Override Dimensions (stockSize) dropdown (`homeView.html:272-278`)
  - Stop Type default dropdown (US only) (`homeView.html:279-287`)
  - **Route starts from client site** checkbox (US routed only) (`homeView.html:294-300`)
  - **Origin Location** dropdown (US routed only, hidden when
    routeFromClientSite=true) (`homeView.html:301-308`)
  - Template picker + delete (`homeView.html:310-319`)
  - Autogenerate Job Number, Import as Completed, Save as template
    checkboxes (`homeView.html:320-333`)
- Endpoints:
  - `GET /api/Clients/{id}/Settings` (`homeService.js:50`) fires when
    client changes - returns schedules, speeds, stockSizes, contacts,
    referenceA/B mandatory flags.
  - `GET /api/Address/Regions` (`homeService.js:111`) populates the
    Origin Location dropdown (US only).
- Persisted state: `import.template`, `urgentFields[key].importField`,
  `import.stockSize`, `import.fromContact`, `import.stopTypeDefault`,
  `import.routeFromClientSite`, `import.originLocationId`, `import.autogenerateJobNumber`,
  `import.importAsCompleted`, `import.saveAsTemplate`, `import.templateName`
- Validation gate: all `urgentFields[key].required()` must be mapped and
  `.validate()` on the preview row must pass. `mapColumns()` runs this
  check before advancing (`homeControl.js` around line 2317).
- Next: `mapColumns()` -> geocoding + zip/suburb validation, sets
  `import.flaggedZipCodes` / `import.flaggedSuburbs`, then
  `showImportStep('Step3')`.

### Step 3 - Fix Zip Codes (US) / Fix Suburbs (NZ)

- View: `homeView.html:345-422`
- Purpose: replace bad zip/suburb strings with a reference-list value.
- Controls: per-flagged row, a `<select>` picking a valid zip/suburb
  (`homeView.html:369-372` NZ, `homeView.html:403-406` US).
- Endpoints:
  - `GET /api/Address/ZipCodes` (US) (`homeService.js:69`)
  - `GET /api/Address/Suburbs` (NZ) (`homeService.js:76`)
- Persisted state: `flaggedZipCodes[].replace`, `flaggedSuburbs[].replace`
- Validation gate: none - "No fixes required" is a valid completion.
- Next: `fixZipCodes()` / `fixSuburbs()` -> replace in-place then
  `showImportStep('Step4')`.

### Step 4 - Fix Addresses

- View: `homeView.html:424-458`
- Purpose: hand-place lat/lng for any row that failed geocoding.
- Controls: clickable flagged rows + embedded gpsForm (Google Map with
  autocomplete) at `homeView.html:435-447`. `updateGPS(address)` writes
  back lat/lng.
- Endpoints:
  - `POST /api/Address/Geocode` (`homeService.js:90`) - batch geocode
    (already fired from Step 2/3 transition).
  - `GET /api/Address/Depots/Postcodes` (NZ) or
    `GET /api/Address/Locations/ZipCodes` (US) - used by `sortByDepot()`
    to bucket by depot/region.
  - `GET /api/Address/ZipPolygons` (US) - identifies coverage-only ZIPs
    that will rate-by-distance (`homeService.js:104`).
- Persisted state: `flaggedAddresses[].latitude/longitude/geoType`
- Validation gate: no unfixed address (`homeControl.js:2992-2996`).
- Next: `sortByDepot()` (`homeControl.js:2985-3175`) buckets jobs into
  `import.depots` (NZ) or `import.locations` (US), then
  `showImportStep('Step5')`.

### Step 5 - Select Depots (NZ) / Select Regions (US)

- View: `homeView.html:460-510`
- Purpose: operator ticks which depot / location buckets to process.
- Controls: one checkbox per bucket at `homeView.html:471-486` (US) or
  `homeView.html:490-503` (NZ). Unmatched/Unzoned bucket is warning-styled
  and cannot be processed (id === 0). Coverage-only bucket (id === -1, US)
  is info-styled - rates by distance.
- Endpoints: none new at this step.
- Persisted state: `depot.include` toggled per bucket.
- Validation gate: none (Next iterates via `nextDepot()`).
- Next: `nextDepot()` (`homeControl.js:3178-3235`) picks the next
  `include=true, done=false` bucket, populates
  `import.depot`, calls `resetDepotOptions()`, then
  `showImportStep('Step6')`. If none remain and no pickup: `closeImport()`.
  If none remain but pickup exists: `showImportStep('Step8')`.

### Step 6 - Depot Detail (book date / service / schedule / time) ***MISSING FROM REACT***

- View: `homeView.html:512-631`
- Purpose: for each selected depot, pick the batch's book date, service
  (`speed`), schedule (routed only), and book time.
- Controls:
  - Import Type label (read-only recap of Step 1 pick) at
    `homeView.html:562-564`
  - US-only coverage-only warning/info banners for `id === -1` at
    `homeView.html:566-580`
  - **Book Date picker** (`input.book-date`, jQuery UI datepicker) at
    `homeView.html:582-588`. `beforeShowDay` is filtered for routed jobs
    to only enable dates that have at least one schedule for the depot
    (`homeControl.js:601-636` and `homeControl.js:4340-4373`).
  - **Service dropdown** (`select.select-speeds`) at `homeView.html:589-594`.
    Populated by `onJobTypeChanged()` from `client.speeds` (on-demand) or
    filtered from `client.schedules` (routed) at
    `homeControl.js:535-598`. Auto-selects when only one option
    (`homeControl.js:719-728`).
  - **Schedule dropdown** (`select.select-schedules`) at
    `homeView.html:595-599`. Populated by `loadSchedules()` at
    `homeControl.js:737-772`, filtered client-side from
    `client.schedules` where
    `depotId === depot.id && dayOfWeek matches && speed.id === speedId`.
    Hidden for the US coverage-only bucket (`id === -1`).
    Auto-selects when only one option (`homeControl.js:763-770`).
  - **Book Time input** (`input.input-time date-selected`) at
    `homeView.html:600-605`. Read-only for routed jobs (auto-derived
    from schedule.startTime by `onScheduleChanged()` at
    `homeControl.js:863-892`).
  - NZ On-Demand job options (On Hold, Nationwide Doc) at
    `homeView.html:607-618` (on-demand only).
- Endpoints:
  - `GET /api/Clients/{ClientId}/Schedules/{BookDate}/{SpeedId}/{depotId}`
    (`homeService.js:62`) is exposed by the backend but the wizard
    actually filters `client.schedules` (already loaded at Step 2) in the
    browser and only hits the server for the booking (single-job) modal at
    `homeControl.js:3699-3729`. In the bulk import flow the client-side
    filter in `loadSchedules()` is what drives the dropdown.
- Persisted state: `import.depot.bookDate`, `import.depot.speed`,
  `import.depot.speedId`, `import.depot.schedule`,
  `import.depot.scheduleId`, `import.depot.dayOfWeek`,
  `import.depot.bookTime`, `import.depot.bookTimeVisible`,
  `import.depot.onHold`, `import.depot.nationwideDoc`.
- Validation gate (`confirmImport()` at `homeControl.js:3253-3441`):
  - `bookDate` cannot be in the past - if it is, auto-bump to now+15min
    (`homeControl.js:3273-3289`).
  - `bookDate` must be < today + 30 days (`homeControl.js:3291-3298`).
  - `speed` is required (`homeControl.js:3302-3306`).
  - `schedule` is required for routed (`homeControl.js:3308-3314`).
- Next: `confirmImport()` -> `POST /api/Bulk`. Server returns success or
  a `kmRatedJobs` payload; either way transitions to Step 7.

### Step 7 - Confirm Import (post-flight)

- View: `homeView.html:633-847`
- Purpose: show success alert, unimported jobs table, or the "km-rated
  jobs" second-chance table (`data.jobs` returned from server means "these
  rows would rate-by-distance; confirm each").
- Controls:
  - Checkbox-per-row selector + "Upload selected" fires
    `confirmImport(true)` (`homeView.html:768`)
  - Export list to Excel (`homeView.html:709-711`)
  - "Skip these jobs" returns to Step 5 (`homeView.html:767`)
  - "Next" (post-success) returns to Step 5 to process the next bucket
    (`homeView.html:843`)
- Endpoints:
  - `POST /api/Bulk` again with `isKmRatedJobs=true` if operator
    confirms the km-rated rows.
- Persisted state: `import.depot.kmRatedJobsFound`, `import.depot.data`
  (rewritten to just the kmRated rows on 2nd pass),
  `import.failedImportJobs`.

### Step 8 - Book a Pickup (optional)

- View: `homeView.html:849-931`
- Purpose: single pickup booking that covers all imported deliveries.
- Endpoints:
  - `POST /api/Bulk/GetPickupRate` (`homeService.js:139`)
  - `POST /api/Bulk/BookPickup` (`homeService.js:146`)
- Only reached from `nextDepot()` when there are no more buckets to
  process and any depot has a `pickupJob` payload
  (`homeControl.js:3232-3234`).

--------------------------------------------------------------------------------

## Section 2: Current React wizard gaps

Reference file: `wwwroot/app/react/components/bulk-import/NewImportWizard.tsx`

The current React wizard has 6 steps:

- Step 1 `newImport` (`NewImportModal.tsx`) - matches Step 1 above.
- Step 2 `mapColumns` (`MapColumnsModal.tsx`) - matches Step 2 above.
- Step 3 `fixZips` (`FixZipCodesModal.tsx`) - matches Step 3 above.
- Step 4 `fixAddresses` (`FixAddressesModal.tsx`) - matches Step 4 above.
- Step 5 `selectRegions` (`SelectRegionsModal.tsx`) - matches Step 5,
  but only shows two synthetic buckets ("valid" and "unmatched") - it
  does not iterate per-depot or per-location.
- Step 6 `rateByDistance` (`RateByDistanceModal.tsx`) - US-only book-date
  input then fires import.

The wizard fires `fireImport()` at `NewImportWizard.tsx:58-122` with:

```
scheduleId: null,
speedId: 0,
bookDate: state.rateByDistanceDate ?? nextBusinessDayIsoDate(),
```

That is the entire problem. `speedId: 0` and `scheduleId: null` means the
server-side `ProcessRoutedJobs` (at
`C:\Gitlab\BulkImportHyper\BulkImport\Application\Core\Services\BulkService.cs:1356`)
cannot resolve the batch to a schedule; the payload will either fall
through to on-demand behaviour or fail the speed/schedule validation
inside `client.Schedule` lookup (`BulkService.cs:665-681`).

### Gaps (prioritised)

**P0 - blocker, cannot complete a routed import:**

1. **No schedule / speed picker step**. The wizard skips straight from
   Step 5 (SelectRegions) to Step 6 (RateByDistance, US only, book-date
   only). NZ routed imports never see a picker at all - the current
   `SelectRegionsModal.onNext` calls `fireImport()` directly with
   `speedId: 0` and `scheduleId: null` (`NewImportWizard.tsx:161-168`).
   Result: NZ routed import will 400 on `client.Speed?.UcjtId != request.SpeedId`
   (`BulkService.cs:1414`), and US routed will 400 the same way when no
   schedule is resolvable.
2. **No per-depot iteration**. BulkImportHyper's Step 5 -> Step 6 loop
   (`nextDepot()`, `homeControl.js:3179`) processes each selected depot
   / location bucket individually with its own book-date, service and
   schedule. The React wizard collapses all buckets into one import call.
   For clients that ship to multiple depots on different schedules, this
   is a functional loss even before considering the picker.
3. **`SelectRegionsModal` does not surface real depots/locations**. It
   only shows "Valid ZIP" and "Unmatched Zip" synthetic buckets driven by
   `addressService.geocode` (`SelectRegionsModal.tsx:37-59`). It does not
   call `GET /api/address/depots/postcodes` (NZ) or
   `GET /api/address/locations/zipcodes` (US), so the operator cannot
   see or gate imports per depot / region.

**P1 - degraded but wizard completes on a happy path:**

4. **`RateByDistanceModal` only exposes book-date**. There is no service
   dropdown, no schedule dropdown, no book-time input. The originLabel
   text at line 40 hard-codes `Location #${state.options.originLocation}`
   rather than resolving the region name via
   `regionService.getRegions()`.
5. **Book-date input has no `beforeShowDay` filter**. BulkImportHyper
   greys out dates that have no schedules for the depot / speed pair
   (`homeControl.js:601-636`). The React `<input type="date">` at
   `RateByDistanceModal.tsx:91-100` accepts any date, so the operator
   can pick a date the server will reject.
6. **No 30-day-forward guard**. `homeControl.js:3291-3298` blocks
   `bookDate >= today + 30 days`. Not enforced in React.
7. **No past-date auto-bump**. `homeControl.js:3273-3289` bumps a past
   time to `now + 15min`. Not enforced in React.
8. **No NZ on-demand options** (On Hold, Nationwide Doc). Present in
   BulkImportHyper at `homeView.html:607-618`, wired into the per-row
   payload at `homeControl.js:3360-3362`. Not exposed anywhere in the
   React wizard.
9. **No km-rated-jobs review step** (Step 7). If the server returns
   `data.jobs` (rows that would rate by distance), BulkImportHyper shows
   a checkbox table and re-fires `confirmImport(true)`. The React wizard
   just toasts the row count and closes.
10. **No pickup booking step** (Step 8).

--------------------------------------------------------------------------------

## Section 3: Implementation plan

### Backend endpoints - already available

All endpoints needed for parity are already wired on
`RoutedOperations/API/Controllers/`:

- `GET /api/clients/{id}/settings` -> `ClientsController.cs:104` returns
  ClientSettingsDto with `schedules`, `speeds`, `stockSizes`, `contacts`,
  `referenceA/B` flags. `clientsService.getSettings()` wraps it
  (`clientsService.ts:101`).
- `GET /api/clients/{ClientId}/schedules/{BookDate}/{SpeedId}/{depotId}`
  -> `ClientsController.cs:125` returns SchedulesResponse filtered by
  cutoff time. `clientsService.getSchedules()` wraps it
  (`clientsService.ts:108`).
- `GET /api/address/depots/postcodes` -> `AddressController.cs:118`
  returns NZ depot -> postcode buckets. Wrapper exists in
  `addressService.ts` (verify method name).
- `GET /api/address/locations/zipcodes` -> `AddressController.cs:173`
  returns US region -> zipcode buckets.
- `GET /api/address/regions` -> `AddressController.cs:155` returns the
  Origin Location dropdown source (US routed only).
- `POST /api/bulk-import/import` -> `BulkImportController.cs:128` -
  request DTO already has `scheduleId`, `speedId`, `bookDate`, `jobType`,
  `routeFromClientSite`, `originLocationId`. Nothing to add server-side.

### MVP scope for parity - minimum viable

Deliver **one new picker step** ("Book Date / Service / Schedule") inserted
between Step 5 (SelectRegions) and Step 6 (RateByDistance is renamed
to Step 7 or repurposed). Ship per-depot iteration in a second pass.

#### Task A - add `SchedulePickerModal.tsx` (new file)

Location: `wwwroot/app/react/components/bulk-import/SchedulePickerModal.tsx`

Renders:

- Read-only Import Type recap (from `state.importType`).
- **Book Date picker**. Use `<input type="date">` for MVP (matches
  `RateByDistanceModal` style). Add `min = today` and
  `max = today + 30 days` attrs to encode the two date guards without
  needing a full react-day-picker calendar.
- **Service dropdown** (`<select>`). Options: derived from
  `clientSettings.speeds` (on-demand) OR filtered from
  `clientSettings.schedules` by depotId + dayOfWeek (routed). Auto-select
  when only 1 option.
- **Schedule dropdown** (`<select>`). Options: filtered
  `clientSettings.schedules` where
  `depotId === depot.id && dayOfWeek === bookDateDayOfWeek
   && speed.id === speedId`. Hidden for on-demand and for US coverage-only
  buckets. Auto-select when only 1 option.
- **Book Time input** (`<input type="time">`). Disabled + auto-filled
  from `schedule.startTime` when a routed schedule is selected. Editable
  for on-demand.
- NZ On-Demand options (On Hold, Nationwide Doc) - checkboxes when
  `!isUs && jobType === 'onDemand'`.

Endpoints hit:

- Reuse `clientsService.getSettings()` output that MapColumnsModal
  already fetches. Persist `clientSettings` on `WizardState` so this
  modal doesn't re-fetch (see Task C).

Validation gates (matches `homeControl.js:3253-3314`):

- `bookDate` required and not in past (past -> auto-bump; add a
  `useEffect` on modal open that sets `bookDate` to today if empty
  and rewrites to `now + 15min` if past).
- `speed` required.
- `schedule` required when `jobType === 'routed'`.

Auto-advance: on Next, dispatch `SET_SCHEDULE_SELECTION` then transition
straight to the import call (`fireImport()`). No visible transition
delay.

#### Task B - update `wizardState.ts`

Add fields:

```ts
export interface WizardState {
  // ...existing...
  clientSettings: ClientSettingsDto | null;   // cached from Step 2
  bookDate: string | null;                    // yyyy-MM-dd
  bookTime: string | null;                    // HH:mm
  speedId: number | null;
  scheduleId: number | null;
  onHold: boolean;                            // NZ on-demand only
  nationwideDoc: boolean;                     // NZ on-demand only
}
```

Add step `'schedulePicker'` to the `WizardStep` union.

Add actions:

```ts
| { type: 'SET_CLIENT_SETTINGS'; settings: ClientSettingsDto }
| { type: 'SET_BOOK_DATE'; date: string | null }
| { type: 'SET_BOOK_TIME'; time: string | null }
| { type: 'SET_SPEED'; speedId: number | null }
| { type: 'SET_SCHEDULE'; scheduleId: number | null }
| { type: 'SET_ONHOLD'; value: boolean }
| { type: 'SET_NATIONWIDE_DOC'; value: boolean }
```

#### Task C - wire settings into MapColumnsModal

`MapColumnsModal.tsx:73` already calls `clientsService.getSettings()`.
Change the resolved handler to also
`dispatch({ type: 'SET_CLIENT_SETTINGS', settings })` so the picker step
downstream has schedules/speeds without a re-fetch. This mirrors
BulkImportHyper's `import.client = { ...clientSettings }` write at
`homeControl.js` client-select handler.

#### Task D - insert step in NewImportWizard

`NewImportWizard.tsx`:

- Change `SelectRegionsModal.onNext` to always transition to
  `'schedulePicker'` (drop the direct fireImport call). Even NZ / on-demand
  paths need to pick a date + time.
- Insert `<SchedulePickerModal>` between `<SelectRegionsModal>` and
  `<RateByDistanceModal>`.
- `SchedulePickerModal.onNext`:
  - For US routed with coverage-only buckets: transition to
    `'rateByDistance'` (keep existing origin-location banner). The
    coverage-only bucket needs Origin Location OR routeFromClientSite -
    those are already collected at Step 2.
  - Otherwise: call `fireImport()` directly.
- In `fireImport()`, replace the hard-coded defaults with the picker
  values:
  ```ts
  bookDate: composeBookDateTime(state.bookDate, state.bookTime),
  scheduleId: state.scheduleId,
  speedId: state.speedId ?? 0,
  ```
  and add the NZ on-demand fields per-job in `buildJobs()` when
  applicable.

#### Task E - repurpose or delete RateByDistanceModal

The current RateByDistanceModal only holds a book-date input. With the
schedule picker in place it becomes the confirmation / origin-recap
screen for US coverage-only buckets (Steve's 4-step origin precedence
banner). Options:

- **Option 1 (recommended)**: keep it US coverage-only, remove the
  book-date input (moved to SchedulePicker), leave only the origin recap +
  Import button.
- **Option 2**: fold it into SchedulePickerModal as a conditional block
  and delete the file.

Prefer Option 1 - the "Rate by Distance" wording is a distinct operator
signal ("these rows will not use a fixed-zone schedule") and the modal
still needs to exist to gate that user acknowledgement.

### Post-MVP (parity backlog, non-blocking)

- **Per-depot / per-location loop**: change SelectRegionsModal to render
  real buckets (call `addressService.getPostcodesByDepot` /
  `getZipCodesByLocation`), and change the wizard state machine to loop
  Steps 5 -> 6 -> import once per selected bucket, marking each `done`
  on success (matches `nextDepot()` at `homeControl.js:3179`). Until
  this lands, the wizard treats all included rows as a single depot -
  works for single-region clients, breaks for multi-region clients.
- **km-rated jobs review step (Step 7)**: handle `data.jobs` in the
  import response by re-opening the picker modal with the returned rows
  in a checkbox table + "Upload selected" button that re-fires
  `confirmImport(true)` (map to `isKmRatedJobs: true`).
- **Pickup booking (Step 8)**: separate modal, `POST /api/bulk-import/pickup-rate`
  and `POST /api/bulk-import/book-pickup` endpoints already exist
  (`BulkImportController.cs:218/237`).

--------------------------------------------------------------------------------

## Cross-reference cheatsheet

| Concept | BulkImportHyper | RoutedOperations React |
|---|---|---|
| Wizard root | `homeControl.js:3599` (`showImportStep`) | `NewImportWizard.tsx:42` |
| Book date + time input | `homeView.html:582-605` | MISSING (partial in `RateByDistanceModal.tsx:91`) |
| Service dropdown | `homeView.html:589-594`, `homeControl.js:534-598` | MISSING |
| Schedule dropdown | `homeView.html:595-599`, `homeControl.js:737-772` | MISSING |
| Schedule cutoff filter | server: `ClientService.cs:236-250` (BulkImportHyper) | already ported in RO's `ClientService`, exposed by `getSchedules()` |
| Origin precedence (US routed) | `homeControl.js:3385-3393` | present in `wizardState.ts:26-27` + `fireImport()` |
| Per-depot loop | `homeControl.js:3178-3235` (`nextDepot()`) | MISSING |
| km-rated review | `homeView.html:642-768` | MISSING |
| Import DTO | `BulkImportRequest.cs` | `bulkImportService.ts:170` (schema already matches) |

--------------------------------------------------------------------------------

## Section 4: On-Demand Wizard - Full Flow

The On-Demand flow shares the same 6-step wizard skeleton as Routed
(Step 1 through Step 6), plus Step 7 (post-flight) and optional Step 8
(pickup booking). It is triggered when the operator picks
`import.jobType === 'ondemand'` on Step 1
(`components/home/homeView.html:209-212`). All divergences from Routed
happen inside the same shell, gated on `depot.jobType === 'ondemand'`.

### Sub-section A: BulkImportHyper flow map (on-demand specifics)

#### Step 1 - New Import (shared)

- View: `components/home/homeView.html:143-223`
- Purpose: pick client, upload file, pick Import Type. When the operator
  picks the second radio (`On-demand` at `homeView.html:210-212`),
  `import.jobType = 'ondemand'` is persisted and used to switch the
  Step 6 behaviour later.
- Radio label copy: same label "On-demand" for both tenants (US and NZ),
  no NZ-specific rename (contrast with Routed which is labelled
  "Scheduled" on NZ).
- On-demand has no additional Step 1 controls compared to Routed.
- Endpoint: same `POST /api/Bulk/Upload`.

#### Step 2 - Map the Columns (mostly shared)

- View: `components/home/homeView.html:225-343`
- On-Demand differences vs Routed:
  - Fields **Origin Location** (`homeView.html:301-308`) and
    **Route starts from client site** (`homeView.html:294-300`) are
    hidden - both are gated on `isUsTenant() && import.jobType === 'routed'`.
    On-Demand always resolves the pickup origin from the imported
    `From*` fields per row.
  - Stop Type default dropdown (`homeView.html:279-287`) still shows
    for US on-demand (it is only gated on `isUsTenant()`, not on
    `jobType`).
- The rest of Step 2 (column mapping, override From Contact, override
  Dimensions, Template picker, Autogenerate Job Number, Import as
  Completed, Save as Template) is identical to Routed.
- Endpoints: identical (`GET /api/Clients/{id}/Settings` and
  `GET /api/Address/Regions`). Regions is fetched for both flows even
  though on-demand does not use the origin dropdown - the fetch is
  unconditional at Step 2.

#### Step 3 - Fix Suburbs / Zip Codes (shared, no divergence)

Identical for on-demand. Same view (`homeView.html:345-422`), same
endpoints (`GET /api/Address/ZipCodes`, `GET /api/Address/Suburbs`),
same validation.

#### Step 4 - Fix Addresses (shared, no divergence)

Identical for on-demand. Same geocode + zip-polygon logic
(`homeControl.js:2985-3175`). The `sortByDepot()` output bucketing
still runs.

#### Step 5 - Select Depots / Regions (mostly shared)

- View: `homeView.html:460-510`
- Same one-checkbox-per-bucket UI as Routed.
- Divergence: for US on-demand, the coverage-only bucket
  (`id === -1`, label "Valid ZIP - Rate By Distance") always has its
  own `bucketJobType = 'ondemand'` regardless of the Step 1 selection
  (`homeControl.js:3120-3124`). This is a hard-pin, not a suggestion.
- For on-demand buckets, `sortByDepot()` pre-populates
  `bookDate` + `bookTime` from the first spreadsheet row that has them
  (`homeControl.js:3126-3145`), so the operator does not have to hand
  type common values.

#### Step 6 - Depot Detail (KEY DIVERGENCE for on-demand)

- View: `homeView.html:512-631`
- Controls that show:
  - **Book Date picker** (`homeView.html:582-588`). `beforeShowDay`
    returns `[true, ""]` for on-demand
    (`homeControl.js:605-607`), so every date is enabled - no
    schedule-based greying.
  - **Service dropdown** (`homeView.html:589-594`). For on-demand,
    populated from `client.speeds` directly (all speeds, no schedule
    filtering) at `homeControl.js:550-557`. Auto-select behaviour
    still applies when only one speed.
  - **Schedule dropdown** (`homeView.html:596-599`). **HIDDEN** for
    on-demand - `onJobTypeChanged` calls `$('.select-schedules').hide();`
    at `homeControl.js:642` and resets `depot.scheduleId = ""` /
    `depot.schedule = null` at `homeControl.js:645-646`.
  - **Book Time input** (`homeView.html:600-605`). Fully editable for
    on-demand (`ng-readonly="import.depot.jobType === 'routed'"`),
    visible whenever a speed is picked OR when a `bookTime` was
    pre-populated from the spreadsheet (`homeControl.js:648-655`).
    Default value populates via `setDefaultTime()`
    (`homeControl.js:849-860`) which rounds to the next 15-minute
    increment.
  - **NZ On-Demand Job Options** (`homeView.html:607-618`). This is
    an on-demand-ONLY block, gated on
    `isNzTenant() && import.depot.jobType === 'ondemand'`:
    - **On Hold** checkbox at `homeView.html:610-613`. Sets
      `import.depot.onHold`.
    - **Nationwide Doc** checkbox at `homeView.html:614-617`. Hidden
      when the depot name contains "auckland"
      (`isDepotAuckland()` at `homeControl.js:959-962`). Sets
      `import.depot.nationwideDoc`.
- These On Hold / Nationwide Doc values are spread onto each job
  payload at `homeControl.js:3359-3363`:
  ```js
  if ($scope.isNzTenant() && $scope.import.depot.jobType === 'ondemand') {
      jobCopy.onHold = $scope.import.depot.onHold || false;
      jobCopy.nationwideDoc = $scope.import.depot.nationwideDoc || false;
  }
  ```
- Endpoints: none new at this step - same client-side filtering.
- Validation gate (`confirmImport()` at `homeControl.js:3253-3441`):
  - Same past-date auto-bump (`homeControl.js:3273-3289`) and
    30-day-forward guard (`homeControl.js:3291-3298`).
  - Same speed-required check (`homeControl.js:3302-3306`).
  - **Schedule required check is SKIPPED for on-demand** - only fires
    when `depot.jobType === 'routed'` (`homeControl.js:3309`).
- Payload: `POST /api/Bulk` with `jobType: 'ondemand'`, `scheduleId`
  NOT included (`homeControl.js:3373` sets `jobType`; the routed-only
  `scheduleId` line at `homeControl.js:3381-3383` is skipped).

#### Backend routing (BulkService.cs)

- `Import()` at `BulkService.cs:618` receives the request. UTC book
  date is converted to tenant local at `BulkService.cs:624-628`.
- Client + speed lookup at `BulkService.cs:642-686`. Note that
  `Schedule` sub-select at line 665-682 is gated on
  `request.ScheduleId.HasValue`, so for on-demand it returns `null`
  cleanly.
- Route decision at `BulkService.cs:688-697`:
  ```csharp
  if (string.Equals(request.JobType, "ondemand", StringComparison.OrdinalIgnoreCase))
      return await ProcessOnDemandJobs(...);
  else
      return await ProcessRoutedJobs(...);
  ```
- `ProcessOnDemandJobs` at `BulkService.cs:700-1256`:
  - Validates client (`:702-704`) and future book date (`:707-714`).
  - Validates speed (`:716-718`) - `client.Speed?.UcjtId != request.SpeedId`
    returns "Invalid speed."
  - Auto-generates job numbers when `job.JobNumber == "AUTOGENERATE"`
    (`:742-753`).
  - Gets from-region from first job's ZIP/PostCode (`:756-761`).
  - Per-job loop (`:768-1209`):
    - Geocodes from-address if lat/lng missing (`:808-811`).
    - Resolves toZoneZip: US via `ZoneZips` table (`:815-828`), NZ
      via `BulkZonePostcodes` (`:829-847`).
    - Checks for zone rates (US only, `:853-864`); if none, calls
      HERE Maps for total distance (`:867-873`).
    - Computes bookTimeForRating - since `request.ScheduleId` is null
      for on-demand, this is just `request.BookDate` (`:882-884`).
    - Computes cubic + formats addresses.
    - Resolves courier by code if provided (`:906-915`).
    - **Tenant branch:**
      - **NZ**: calls `INT_stpJob_BulkInsertAsync` at `:930-987`.
        Inserts directly into `tucJob` (live table). Wellington-depot
        detection at `:924-927` for `wellingtonJob` flag. Passes
        `onHold`, `nWDocJob`, `sourceID = 3`. No JobID returned from
        the SP - success is tracked with `successfulJobCount++` at
        `:990`. Job items inserted via
        `NET_stpBulkJobItems_InsertAsync` (`:1010-1017`), one per
        `qty`.
      - **US**: calls `DD_stpJob_InsertExceleratorAsync` at
        `:1023-1123`. `tenantCurrentTime` = `bookTimeForRating`
        (`:1116`). Returns JobID via output param
        (`jobIdParam.Value`); success at `:1126-1190`. If
        `ImportAsCompleted`, sets `UcjbStatus = 6` and clears
        tracking/POD fields (`:1136-1170`). Delivery note inserted
        via `InsertJobDeliveryNote()` (`:1173`), job items via
        `NET_stpBulkJobItems_InsertAsync` (`:1180-1183`).
  - Failed-job aggregation at `:1211-1253`:
    - If any successes: `response.Success = true`, adds warning +
      per-job failure detail messages.
    - If zero successes: `response.Success = false`, same detail
      output.
- Return type is `BulkImportResponse` with `Jobs` populated to failed
  rows only (never km-rated on the on-demand path - km-rating is
  routed-only).

#### Step 7 - Confirm Import (post-flight, shared)

- View: `homeView.html:633-847`
- On-demand path only ever hits the success or failed-jobs branch
  (never the "km-rated jobs" branch - `data.jobs` from the server
  contains failed jobs, not "would-rate-by-distance" jobs, for
  on-demand). Displays success alert, unimported jobs table if any.
- Buttons: "Skip these jobs" back to Step 5, "Next" to process next
  bucket, "Export list to Excel".

#### Step 8 - Book a Pickup (optional, shared)

Same as Routed - only visible when at least one processed depot came
back with a `pickupJob` payload.

### Sub-section B: Current gaps in RoutedOperations (On-Demand)

Reference file: `wwwroot/app/react/components/bulk-import/NewImportWizard.tsx`.

The current wizard collapses the on-demand path via
`SelectRegionsModal.onNext` at `NewImportWizard.tsx:161-168`:
```ts
if (!isUs || state.importType === 'onDemand') {
    fireImport();
    return;
}
```
This bypasses Step 6 entirely for on-demand imports.

**P0 - blocker, cannot complete an on-demand import correctly:**

1. **No book-date OR book-time picker for on-demand.** `fireImport()`
   at `NewImportWizard.tsx:66-67` hard-codes `bookDate` to tomorrow's
   ISO date with no time component. The server converts UTC to tenant
   time (`BulkService.cs:624-628`) so tomorrow 00:00 UTC lands mid-day
   the day before in NZ - the future-date guard at
   `BulkService.cs:710-714` will fail for NZ tenants past ~11am UTC
   yesterday. Operator cannot select an actual delivery time.
2. **`speedId: 0` breaks on-demand too.** The service-required check
   at `BulkService.cs:716-718` (`client.Speed?.UcjtId != request.SpeedId`)
   returns "Invalid speed." for every on-demand import currently
   fired from the React wizard. Same root cause as Routed's blocker
   but the failure is at a different check.
3. **No NZ on-demand Job Options (On Hold, Nationwide Doc).** These
   two checkboxes at BulkImportHyper `homeView.html:607-618` are
   NOT rendered anywhere in the React wizard. They are per-job flags
   spread onto every job in the payload
   (`homeControl.js:3359-3363`), and land at
   `INT_stpJob_BulkInsertAsync` params `onHold` and `nWDocJob`
   (`BulkService.cs:965, 967`). Without them, every NZ on-demand job
   defaults to `onHold=false, nationwideDoc=false` - the operator
   cannot flag a batch as on-hold or as nationwide doc jobs.

**P1 - degraded but on-demand happy path can complete:**

4. **No US Stop Type default dropdown.** BulkImportHyper Step 2
   `homeView.html:279-287` (three options: mapped / all pickup / all
   dropoff) is present in the React MapColumnsModal only if it was
   ported. Verify - if missing this is a P1 for on-demand too since
   the dropdown is gated on `isUsTenant()`, not on jobType.
5. **No pre-populate of book-date/time from spreadsheet.**
   BulkImportHyper `homeControl.js:3126-3145` picks the first row
   with a `bookDate` and pre-loads the picker for on-demand buckets.
   The React wizard has no such shortcut.
6. **No per-bucket auto-derived defaults.** For US, the coverage-only
   bucket (`id === -1`) is hard-pinned to `ondemand` regardless of
   Step 1 choice (`homeControl.js:3120-3124`). React wizard flattens
   everything into one payload with one `importType`.
7. **No past-date auto-bump.** `homeControl.js:3273-3289` bumps a
   past selection to `now + 15min`. Not enforced in React.
8. **No 30-day-forward guard.** `homeControl.js:3291-3298`. Not
   enforced in React.
9. **No `setDefaultTime()` (round to next 15 min).**
   `homeControl.js:849-860`. Not present in React.
10. **No per-row failed-jobs display on failure.** The on-demand
    backend surfaces per-job reasons via `response.Jobs` +
    per-message details (`BulkService.cs:1219-1252`). React just
    toasts the first `messages[0].message`.

### Sub-section C: Implementation plan (On-Demand)

The MVP work overlaps heavily with the Routed picker step from
Section 3 - build one picker modal that handles both flows via
`importType` gating. Below is the on-demand-specific delta.

#### Task A' - extend `SchedulePickerModal.tsx` for on-demand

Refer to Section 3 Task A. Same modal, additional rendering rules:

- When `state.importType === 'onDemand'`:
  - Book Date picker: `min = today`, `max = today + 30 days`. No
    schedule-based filter needed - every date enabled.
  - Service dropdown: populate from `state.clientSettings.speeds` in
    full (no schedule filter). Auto-select when only one.
  - Schedule dropdown: HIDE. Do not render, do not fetch.
  - Book Time input: FULLY EDITABLE `<input type="time">`. Default to
    round-up-to-next-15-min via a `useEffect` on modal open that
    computes and dispatches
    `dispatch({ type: 'SET_BOOK_TIME', time: nextQuarterHour() })`
    if `state.bookTime` is null.
  - **NZ on-demand Job Options block**: gated on
    `!isUs && state.importType === 'onDemand'`.
    - `On Hold` checkbox bound to `state.onHold`.
    - `Nationwide Doc` checkbox bound to `state.nationwideDoc`.
      Hide when the resolved depot name contains "auckland".
      Auckland check needs the bucket name string - if per-depot
      iteration lands (Task F below) use that bucket name;
      otherwise, always show the checkbox for MVP (matches the
      degraded-single-bucket behaviour).

Validation gates (`confirmImport()` at `homeControl.js:3253-3306`):

- `bookDate` required; if in the past, auto-bump to `now + 15min`.
- `speedId` required.
- Schedule check SKIPPED for on-demand (existing logic).

Auto-advance: on Next, apply the NZ on-demand fields per-job in
`buildJobs()` when applicable (see Task E), then `fireImport()`.

#### Task B' - update `wizardState.ts` for on-demand fields

Already covered in Section 3 Task B - the shared shape includes
`onHold`, `nationwideDoc`, `bookTime`. No additional on-demand-only
fields required.

#### Task C' - remove `speedId: 0` and hard-coded `bookDate` from `fireImport()`

`NewImportWizard.tsx:58-122` - replace:
```ts
bookDate: state.rateByDistanceDate ?? nextBusinessDayIsoDate(),
scheduleId: null,
speedId: 0,
```
with:
```ts
bookDate: composeBookDateTime(state.bookDate, state.bookTime),
scheduleId: state.importType === 'onDemand' ? null : state.scheduleId,
speedId: state.speedId ?? 0,
```
`composeBookDateTime()` should combine the yyyy-MM-dd + HH:mm into a
local-tz DateTime, then let the server convert (do NOT force UTC on
send - the backend timezone conversion at `BulkService.cs:624-628`
handles both UTC and local kinds).

#### Task D' - per-job on-demand fields in `buildJobs()`

In `buildJobs()` at `NewImportWizard.tsx:189-...`, when
`state.importType === 'onDemand' && !isUs`, spread `onHold` +
`nationwideDoc` onto every returned job DTO. Matches
`homeControl.js:3359-3363`.

#### Task E' - wire the flow

`SelectRegionsModal.onNext` at `NewImportWizard.tsx:161-168`:
- Remove the `fireImport()` shortcut for on-demand. Always transition
  to `'schedulePicker'`. Every path (routed AND on-demand, US AND NZ)
  goes through the picker; the picker's conditional rendering is what
  differs.

#### Task F' - post-MVP: pre-populate book-date/time from spreadsheet

Mirrors `homeControl.js:3126-3145`. When entering the picker step,
scan `state.parsed` rows for the first `bookDate` and `bookTime`
values (from mapped columns). If present, dispatch
`SET_BOOK_DATE` / `SET_BOOK_TIME` before the modal renders. Only
applies when `state.importType === 'onDemand'`.

#### Task G' - post-MVP: per-row failed-jobs table

When `response.Jobs?.length > 0` after a failed or partial import,
render a table below the toast with `jobNumber` + `errorMessage`
columns. Mirrors BulkImportHyper `homeView.html:673-741`.

--------------------------------------------------------------------------------

## Section 5: Staff Import - Full Flow

Staff Import is a separate wizard (not a variant of the main import
flow) triggered by a distinct button at
`components/home/homeView.html:22-25`, gated on
`isInternal() && isNzTenant() && clients !== null && templates && jobs && postCodesByDepot`.

The Staff Import wizard is a 5-step flow with a state machine keyed
by `$scope.showStaffImport = 'StaffStepN'` (declared at
`components/home/homeControl.js:4673`). Transitions are triggered by
`$scope.showStaffImportStep(step)` at `homeControl.js:4737-4740` and
by per-step handlers (`uploadStaffFile`, `validateStaffSuburbs`,
`fixStaffSuburbs`, `geocodeStaffAddresses`, `confirmStaffImport`).

### Sub-section A: BulkImportHyper flow map (Staff Import)

#### Trigger

- Button: `homeView.html:22-25`.
  ```html
  <div class="btn ... staff-import"
       ng-show="isInternal() && isNzTenant() && clients !== null && templates && jobs && postCodesByDepot"
       ng-click="startStaffImport()">
      <i class="fa fa-user-shield"></i> Staff Import
  </div>
  ```
- `startStaffImport()` at `homeControl.js:4708-4725` re-guards the two
  claim checks (Internal + NZ tenant), resets state via
  `resetStaffImport()`, then opens `showStaffImport = 'StaffStep1'`.
- **NO client picker.** The client is read PER ROW from the spreadsheet
  (`ClientID` or `ClientCode` column) at `BulkService.cs:4138-4176`.
- **NO job type picker.** Staff Import does not distinguish routed vs
  on-demand at the wizard level; each row can be routed or on-demand
  depending on its own columns (e.g. `PrebookJob`, `RunName`) and the
  backend `INT_stpJob_BulkInsert` SP handles the difference internally.

#### Staff Step 1 - Upload File (no client picker)

- View: `homeView.html:1225-1254`
- Controls:
  - File input `<input type="file" id="staffFile" file-model="staffFile" accept=".xlsx, .xls">`
    at `homeView.html:1239`.
  - "Upload & Preview" button calls `uploadStaffFile()`
    (`homeView.html:1250-1252`).
- Endpoints:
  - `POST /api/Bulk/Upload` (multipart) via
    `uBulkData.importFile()` at `homeService.js:165-176` (shared with
    the main wizard). Returns raw rows as an array of dictionaries.
- Post-upload validation (`homeControl.js:4762-4791`):
  - Parse response as JSON if returned as string.
  - Verify at least one row present.
  - **Verify a `ClientID` / `Client_ID` / `ClientCode` column exists
    in the parsed row keys** (`homeControl.js:4779-4786`). If missing,
    surface an error "Spreadsheet must contain a ClientID or
    ClientCode column" and stay on Step 1.
- Persisted state: `staffImport.data` (raw row dicts),
  `staffImport.fields` (sorted column names).
- Next: `showStaffImport = 'StaffStep2'`.

#### Staff Step 2 - Preview Data

- View: `homeView.html:1257-1297`
- Purpose: show the operator the parsed data before committing.
- Controls:
  - Read-only HTML table showing all `staffImport.fields` as columns
    and the first 50 rows.
  - "Showing first 50 of {count} rows" hint when rowCount > 50.
- Endpoints: none (client-side preview only).
- Validation gate: none.
- Buttons: Back to Step 1, "Validate Suburbs" ->
  `validateStaffSuburbs()`.

#### Staff Step 3 - Fix Suburbs (NZ only)

- View: `homeView.html:1300-1343`
- Purpose: hand-map any suburb string in the CSV that does NOT match a
  row in `$scope.suburbs`.
- Populated by `validateStaffSuburbs()` at `homeControl.js:4824-4872`:
  - Extracts `FromSuburb` / `ToSuburb` (case-insensitive; supports
    "From Suburb", "fromsuburb" variants) from every row.
  - For each unique (suburb, postCode) pair, calls
    `$scope.findSuburb(name, postCode)` and flags any suburb not
    found. Duplicates deduped by `name+postCode` key.
- Controls: per-flagged-suburb, a `<select>` picking a replacement from
  the full `$scope.suburbs` list (`homeView.html:1321-1324`).
- Endpoints: none new (uses the already-loaded `$scope.suburbs`).
- Validation gate (`fixStaffSuburbs()` at `homeControl.js:4874-4883`):
  - All flagged suburbs must have a `replace` selection.
- Applies suburb fixes back to `staffImport.data`
  (`homeControl.js:4886-4913`), overwriting the original suburb string
  in every row that matched. Then calls `geocodeStaffAddresses()`.

#### Staff Step 4 - Fix Addresses (geocoding)

- View: `homeView.html:1346-1380`
- Entered via `geocodeStaffAddresses()` at
  `homeControl.js:4919-4968`, which:
  - Extracts unique address triplets from every row (both from + to
    addresses) via `getStaffAddressesToGeocode(true)` at
    `homeControl.js:4970-5031`. Only addresses missing lat/lng are
    submitted.
  - Calls `POST /api/Address/Geocode` via `uBulkData.getGeocode()`.
  - Populates `staffImport.geocodeData` (all returned coords) and
    `staffImport.geocodeAttempted` (all submitted addresses).
  - Calls `populateStaffFlaggedAddresses()` at
    `homeControl.js:5034-5104` which produces `flaggedAddresses` for
    any address that came back without lat/lng.
- Controls:
  - Left column: per-flagged-address list (clickable rows with
    invalid/fixed styling).
  - Right column: `staffGpsForm.html` template with Google Map +
    Places autocomplete + draggable marker. Wired via
    `updateStaffGPS(address)` at `homeControl.js:5107-5216`.
- Endpoints:
  - `POST /api/Address/Geocode` (initial batch geocode).
- Validation gate: none inside the view - operator can proceed with
  unfixed addresses (they will fail at the backend, but no client-side
  block).
- Next: "Import {count} Jobs" button (`homeView.html:1376-1378`) ->
  `confirmStaffImport()`.

#### Staff Step 5 - Results (post-import)

- View: `homeView.html:1383-1428`
- Reached from `executeStaffImport()` at
  `homeControl.js:5275-5341`, but only when `response.successCount > 0`
  (`homeControl.js:5310-5312`). If zero successes, wizard stays on
  Step 4 with the per-row errors surfaced.
- Displays:
  - Success alert with `{{staffImport.result.successCount}} jobs
    imported successfully.`
  - Warning alert when partial success, with response messages.
  - **Failed jobs table** with columns `Row`, `Job Number`, `Error`
    (populated from `response.failedJobs`).
- Special handling: error strings containing "UNIQUE KEY constraint"
  + "ucjbNumber" are rewritten to "Job number already exists in the
  system" for cleaner display (`homeControl.js:5302-5304`).
- Only button: "Close" -> `closeStaffImport(true)` which refreshes
  the jobs list.

#### confirmStaffImport / executeStaffImport wiring

- `confirmStaffImport()` at `homeControl.js:5232-5272`:
  - Iterates every row, looks up its (from|to)Address in
    `staffImport.geocodeData`, and stamps `PickUpLatitude` /
    `PickUpLongitude` / `DeliveryLatitude` / `DeliveryLongitude`
    onto the row dict directly (`homeControl.js:5251-5266`).
  - Calls `executeStaffImport()`.
- `executeStaffImport()` at `homeControl.js:5275-5341`:
  - Shows a confirmation prompt: "Are you sure you want to import N
    jobs directly into tucJob table? This action cannot be undone."
  - On confirm, calls `POST /api/Bulk/StaffImport` via
    `uBulkData.staffImport({ jobs: staffImport.data })`
    (`homeService.js:191-197`).
  - The payload is `{ jobs: [Dictionary<string,object>...] }` -
    literally the raw row dicts with geocode coords stamped in.

#### Backend flow (`BulkService.StaffImport`)

- Controller: `BulkController.cs:117-160`.
  - Enforces `Internal` claim (`:127-139`, returns 401 Unauthorized
    with a friendly message otherwise).
  - Enforces `CountryCode == NZ` (`:141-151`, same 401 response
    shape).
- Service: `BulkService.cs:4104-4553`.
  - Re-checks NZ tenant at `:4117-4122` (defence in depth).
  - Loads `opId = StaffId` from the contact (`:4127-4130`) for
    `INT_stpJob_BulkInsertAsync.opID`.
  - Per-row loop (`:4132-4529`):
    - Client resolution (`:4137-4181`):
      - Read `ClientID` / `ClientId` / `Client_ID` / `clientid`
        via `GetIntValue()`.
      - Fallback to `ClientCode` / `Client_Code` / `clientcode`
        via `GetStringValue()`.
      - Cache both by-id and by-code to avoid repeat DB queries.
      - If neither resolves, throws "Client not found. ClientID: {x},
        ClientCode: {y}".
    - Job number: `GetStringValue("JobNumber", "Job Number",
      "jobnumber")`. Auto-generate when blank or literally
      "AUTOGENERATE" (`:4184-4192`). Uses `AssignJobNumbersAsync` +
      `JobPrefix`.
    - Book date/time (`:4194-4196`): supports `BookDate`, `Book Date`,
      `bookdate`, plus **legacy** `DeliveryDate` / `Delivery Date`.
      `BookTime` supports `BookTime`, `Book Time`, `booktime`,
      `DeliveryTime`, `Delivery Time`. Book date defaults to today,
      book time defaults to 09:00 (`:4305`).
    - Contact/amount/speed (`:4198-4201`): `Contact` / `FromContact`
      / `contact` / **legacy** `ContactName`; `Amount`; `Speed` /
      `SpeedId` / `speed` / `SpeedID`. Speed defaults to 1
      (`:4289-4292`).
    - Full from/to address bundle (`:4204-4221`): `FromCompany`,
      `FromAddress`, `FromSuburb`, `FromCity`, `FromState`,
      `FromPostCode`, `FromZipCode`, `ToCompany` / **legacy**
      `CompanyName`, `ToAddress`, `ToSuburb`, `ToCity`, `ToState`,
      `ToPostCode`, `ToZipCode`, `ToContact`, `ToContactPhone`.
    - Job details (`:4223-4247`): `Qty` / `Quantity` / `qty` /
      **legacy** `Items`; `Size` / `VehicleSize`; `Weight`;
      `CourierId` / `CourierID` (validated against `tucCourier` -
      dropped to null if not found at `:4230-4236`), `CourierCode`
      (fallback lookup by code at `:4237-4243`); `ClientRefA`,
      `ClientRefB`, `OurRef`, `Notes`.
    - Tracking / POD (`:4249-4254`): `TrackingEmail`,
      `TrackingMobile`, `PODEmail` / **legacy** `Email`, `PODMobile`
      / **legacy** `Mobile`.
    - Coordinates (`:4256-4260`): `PickUpLatitude` / `Pickup
      Latitude` / `pickuplatitude` / **legacy** `fromLat`, plus the
      long/to variants. GeoType fields at `:4262-4264` support
      `FromGeoType` / `fromGeoType`, `ToGeoType` / `toGeoType`.
    - NZ-specific flags (`:4266-4272`): `OnHold`, `NWDocJob`,
      `WellingtonJob`, `PrebookJob`, `RemoteJob` / **legacy**
      `RemoteScreen`, `RunName`.
    - Delivery options (`:4274-4276`): `Ok_To_Leave` / `OkToLeave` /
      `DeliverToPrivateBusiness`; `Location` / `DeliverToLeaveID`.
    - Status / completion (`:4278-4282`): `Status` (defaults to 1),
      `JobDone`, `ComplTime`, `PODName`.
    - Timezone codes from lat/lng (`:4284-4286`).
    - **Tenant branch (NZ vs US):** although the controller gates on
      NZ, the service still branches at `:4294`. NZ path calls
      `INT_stpJob_BulkInsertAsync` (`:4302-4359`) with the full
      column list. US path calls `DD_stpJob_InsertExceleratorAsync`
      (`:4405-4492`) with the equivalent US signature - reachable
      only if the controller gate is bypassed.
    - Post-insert (`:4364-4389` NZ): looks up the newly-created
      `tucJobId` by matching `UcjbNumber`, then optionally calls
      `InsertJobDeliveryNote()` and inserts `qty` job-item rows via
      `NET_stpBulkJobItems_InsertAsync`.
    - Per-row catch (`:4517-4528`): captures the exception message
      into `response.FailedJobs` with `RowNumber`, `JobNumber`, and
      `Error`.
  - Result aggregation (`:4531-4545`):
    - `response.SuccessCount = successCount`.
    - `response.FailedCount = failedJobs.Count`.
    - `response.Success = successCount > 0`.
    - Message text: either "Import completed with N failed jobs out
      of M total." or "Successfully imported N jobs.".

### Sub-section B: Current gaps in RoutedOperations (Staff Import)

Reference file:
`wwwroot/app/react/components/bulk-import/StaffImportModal.tsx`
(238 lines, already present).

The React `StaffImportModal` implements a compressed 3-view flow:
`Upload -> Preview -> Result`. Sits at
`StaffImportModal.tsx:30-238`.

**P0 - functional gaps vs BulkImportHyper:**

1. **No ClientID/ClientCode presence check on parse.**
   BulkImportHyper `homeControl.js:4779-4786` refuses to advance past
   Step 1 when the parsed rows do not contain a
   `ClientID` / `Client_ID` / `ClientCode` column, surfacing a clear
   "Spreadsheet must contain a ClientID or ClientCode column" error.
   `StaffImportModal.tsx:53-68` (`handleParse`) accepts any file
   and only fails at import time when the backend returns
   "Client not found" per row - the operator learns about the
   missing column only after the destructive Import runs.
2. **No suburb-fix step (Staff Step 3).** BulkImportHyper
   `homeControl.js:4824-4917` cross-checks every from/to suburb
   against the local `$scope.suburbs` list and blocks Import until
   the operator maps every unknown suburb to a known one. The React
   modal skips this entirely. Consequence: suburb typos in the
   spreadsheet reach `INT_stpJob_BulkInsertAsync` and the SP fails
   the row with a foreign-key or suburb-lookup error - shown to the
   operator only via the per-row failed-jobs table at the end.
3. **No address-geocode step (Staff Step 4).** BulkImportHyper
   `homeControl.js:4919-5216` batch-geocodes every from + to address
   that lacks lat/lng, then presents a hand-fix UI (Google Map +
   Places + draggable marker) for anything the geocoder could not
   place. React skips it. Consequence: rows with no lat/lng in the
   spreadsheet and un-geocodable addresses are sent to the SP with
   empty coordinates - `INT_stpJob_BulkInsert` writes the row but
   downstream routing/despatch has no pickup coords.
4. **No pre-import "Are you sure?" prompt.** BulkImportHyper
   `homeControl.js:5281-5340` wraps the actual POST in an
   `$rootScope.showPrompt` confirmation ("Are you sure you want to
   import N jobs directly into tucJob table? This action cannot be
   undone."). React fires the import immediately on button-click.

**P1 - degraded but Staff Import can happen:**

5. **No UNIQUE-KEY error rewrite.** BulkImportHyper rewrites
   "UNIQUE KEY constraint ... ucjbNumber ..." to the friendly "Job
   number already exists in the system" (`homeControl.js:5302-5304`).
   React shows the raw SQL string.
6. **Legacy field name coverage is backend-only.** BulkImportHyper's
   Staff Import cross-references `ContactName`, `DeliveryDate`,
   `DeliveryTime`, `CompanyName`, `Items`, `Email`, `Mobile`,
   `RemoteScreen`, `fromLat`/`fromLng`/`toLat`/`toLng` as legacy
   names for compatibility with older `Despatch_Root` spreadsheets
   (`BulkService.cs:4184-4272`). This works transparently because
   the raw row dict is passed straight through - but the React
   preview table shows the original column names, so the operator
   cannot tell whether a `DeliveryDate` column will be treated as
   `BookDate`. Add a small note or column-mapping-preview.
7. **Preview cap is 20 rows.** `StaffImportModal.tsx:97`. Hyper
   showed 50 (`homeView.html:1273`). Minor.
8. **No preview scrollable table styling / stuck header.** Present
   in Hyper via `max-height: 400px; overflow-y: auto` at
   `homeView.html:1265`. React uses `max-h-72` (~ 18 rem) at
   `StaffImportModal.tsx:167` which may clip large sheets.

### Sub-section C: Implementation plan (Staff Import)

The React `StaffImportModal` needs to grow from a 3-view flow to a
5-step flow. The good news: the backend endpoint
(`POST /api/Bulk/StaffImport`) already exists and works end-to-end -
the missing pieces are all client-side validation / UX shims.

#### Task S-A - add ClientID presence check to handleParse

`StaffImportModal.tsx:53-68`. After parsing, check for a
`ClientID` / `Client_ID` / `ClientCode` column key (case-insensitive)
in `response.headers` (or `Object.keys(response.rows[0])`). If
missing, set a local error state and refuse to advance to the
preview. Mirrors `homeControl.js:4779-4786`.

#### Task S-B - insert Staff Step 3 (Fix Suburbs)

New `StaffFixSuburbsStep` view / component inside the modal (or a new
subcomponent). Between "Parse OK" and "Preview" or between "Preview"
and "Import". Reuses `addressService.getSuburbs()` (already exposed
via `AddressController.cs`) to load the reference list.

Behaviour to mirror (`homeControl.js:4824-4913`):
- On step-open, walk every parsed row extracting `FromSuburb` +
  `ToSuburb` (case-insensitive column-name match with the same
  variants).
- Cross-check each unique (suburb, postCode) against the loaded
  suburbs list via a matching helper.
- Render one row per unknown suburb with a `<select>` dropdown of
  known suburbs.
- Block Next until every unknown suburb has a replacement selected.
- On Next, apply the replacements back onto the row dicts
  (overwriting the original suburb string in-place, same as Hyper),
  then advance to Step 4.

#### Task S-C - insert Staff Step 4 (Fix Addresses)

New `StaffFixAddressesStep` view. Uses the same geocode endpoint
(`POST /api/Address/Geocode`) and the same GpsForm component that the
main wizard's `FixAddressesModal` already renders.

Behaviour to mirror (`homeControl.js:4919-5216`):
- On step-open, extract unique from + to address triplets from every
  row that lacks lat/lng in the spreadsheet.
- Batch-geocode via the shared endpoint.
- For any address the geocoder cannot place, add to `flaggedAddresses`.
- Render the same left-list + right-map layout that
  `FixAddressesModal.tsx` uses; wire the "next flagged" hop.
- On Next, apply the geocoded / hand-placed coords onto the row dicts
  by writing `PickUpLatitude` / `PickUpLongitude` /
  `DeliveryLatitude` / `DeliveryLongitude` back into the row keys
  (same as `homeControl.js:5251-5266`).
- No hard block - operator can advance with unfixed addresses (Hyper
  does not block either). Show a warning banner.

#### Task S-D - add the "Are you sure?" confirmation prompt

`StaffImportModal.tsx:70-92` (`handleImport`). Wrap the
`bulkImportService.staffImport()` call in a confirmation modal
(reuse the existing `ConfirmModal` / prompt UI). Message: "Are you
sure you want to import N jobs directly into tucJob table? This
action cannot be undone.". Mirrors
`homeControl.js:5281-5283`.

#### Task S-E - error message rewrite for UNIQUE-KEY

In the failed-jobs render at `StaffImportModal.tsx:206-227`, rewrite
error strings containing both `UNIQUE KEY constraint` and
`ucjbNumber` to "Job number already exists in the system". Mirrors
`homeControl.js:5302-5304`.

#### Task S-F - state shape

Extend the local `useState` set in `StaffImportModal.tsx:32-40` to
carry:
- `step: 'upload' | 'preview' | 'fixSuburbs' | 'fixAddresses' | 'result'`
- `flaggedSuburbs: Array<{ name: string; postCode: string | null; replace: SuburbDto | null }>`
- `flaggedAddresses: Array<{ address; suburb; postCode; latitude?; longitude?; isOrigin }>`
- `geocodeData: GeocodeResultDto[]`
- `geocodeAttempted: AddressDto[]`

Or refactor to `useReducer` if the state graph justifies it (5 steps
+ two collections + a result payload is right on the edge).

#### Task S-G - preview table polish

- Bump preview cap from 20 to 50 rows to match Hyper
  (`StaffImportModal.tsx:97`).
- Bump the max-height on the preview table so 50 rows fit without
  clipping (`StaffImportModal.tsx:167`).
- Optional: add a small info banner when the row keys include any of
  the legacy names (`DeliveryDate`, `ContactName`, `CompanyName`,
  `Items`, `Email`, `Mobile`, `RemoteScreen`, `fromLat`, etc.) so
  the operator knows how they will be interpreted.

--------------------------------------------------------------------------------

## Section 6: Per-depot iteration

### Sub-A: BulkImportHyper flow map

Multi-depot / multi-region clients ship to more than one bucket per file.
BulkImportHyper walks the buckets one-at-a-time; each bucket gets its
own Step 6 picker + its own `POST /api/Bulk` call. State + termination
live entirely in `nextDepot()` (`homeControl.js:3178-3235`).

**Bucket source (tenant-branching).** The list to iterate is either
`import.depots` (NZ) or `import.locations` (US), picked up at
`homeControl.js:3180`:
```
var depotList = $scope.isNzTenant() ? $scope.import?.depots : $scope.import?.locations;
```
Both are built in `sortByDepot()` (`homeControl.js:2985-3175`) - NZ groups
by depot resolved via `postCodesByDepot`, US groups by
`zoneNameLocationForZip` with three special bucket IDs:
- `id = 0` -> "Unzoned" / "Unmatched" rows the operator can only
  download to Excel (`homeView.html:521-559`, `homeView.html:627`).
- `id = -1` -> "Valid ZIP - Rate By Distance" (US only, coverage-only).
  Forces `jobType = 'ondemand'`... except commented out per Steve's
  4-step origin precedence (see `homeControl.js:3151-3155` comment) -
  the bucket keeps the operator's Step 1 pick.
- `id > 0` -> a real depot / region.

Each bucket carries:
```
{ id, name, include, done, bookDate, bookTime, scheduleId,
  jobType, data, numberOfJobs, numberOfJobsImported,
  pickupJob }
```
`bookDate` / `bookTime` are pre-populated per bucket from the
spreadsheet where present (`homeControl.js:3195-3210`, on-demand only).

**Bucket selection at Step 5.** Operator ticks `depot.include` per bucket
(`homeView.html:471-486` US, `homeView.html:490-503` NZ). Step 5 Next
calls `nextDepot()`.

**`nextDepot()` state machine (`homeControl.js:3179-3235`):**

1. Find the next `include=true, done=false` bucket
   (`homeControl.js:3181`). Assign to `import.depot`.
2. If found:
   - Copy batch-level `import.jobType` down to `depot.jobType`
     unless the bucket already pinned one
     (`homeControl.js:3188-3190`). The coverage-only `id=-1` bucket
     is the one that used to pin ondemand; now it defers.
   - `resetDepotOptions()` (`homeControl.js:488-531`) clears speeds /
     schedules / speed / schedule / dayOfWeek back to empty, but
     PRESERVES `bookDate` + `bookTime` if pre-populated from the sheet.
   - Re-populate speeds via `onJobTypeChanged()`
     (`homeControl.js:533-598`) - filtered by day-of-week + depot for
     routed, all `client.speeds` for on-demand.
   - Go to Step 6 (`homeControl.js:3218`).
3. If none remain (all buckets done):
   - Walk every bucket looking for `pickupJob`. For each bucket that
     has one, pick the earliest pickup time as `import.pickupJob`
     (`homeControl.js:3221-3230`). This is the "one-pickup covers all
     depots" collapse.
   - If any bucket had a pickupJob -> go to Step 8
     (`homeControl.js:3232-3233`).
   - Otherwise close the wizard (`closeImport(true)` refreshes the
     jobs grid).

**Backend contract per bucket.** Each depot fires its OWN `POST /api/Bulk`
inside `confirmImport()` at `homeControl.js:3395`. The payload is
per-depot:
```
{ clientId,
  bookDate: depot.bookDate,
  speedId: parseInt(depot.speed.id),
  jobType: depot.jobType,
  scheduleId: depot.jobType==='routed' ? parseInt(depot.schedule.id) : undefined,
  jobs: depot.data,               // ONLY this depot's rows
  isKmRatedJobs: false,
  importAsCompleted: import.importAsCompleted,
  pickupJob: depot.pickupJob ?? null,
  // US routed only:
  routeFromClientSite,
  originLocationId }
```
On success (`homeControl.js:3396-3416`):
- `depot.done = true`
- `depot.numberOfJobsImported += qtySum` (counts multi-qty rows correctly)
- `depot.pickupJob = data.pickupJob?.pickupJob ? data.pickupJob : depot.pickupJob`
- If `data.jobs` came back non-empty -> km-rated review (Step 7,
  see Section 7).
- If `data.jobs` empty -> refresh jobs grid, jump to Step 7 success
  panel; operator hits "Next" which lands back on Step 5 for the
  NEXT bucket (which calls `nextDepot()` again).

**Loop termination.** The loop terminates when no bucket has
`include=true && done=false`. `hasNextDepot()`
(`homeControl.js:3238-3241`) is the query. The Next-button label on
Step 5 flips between "Next" and "Finish" based on
`hasNextDepot() || hasPickup()` (`homeView.html:508`).

**UI feedback.** BulkImportHyper does NOT surface "Importing depot X
of Y..." explicitly - the operator sees:
- Step 6 heading shows the current bucket's name
  (`homeView.html:514`, `<h3>{{import.depot.name}}</h3>`).
- Step 5 shows a per-bucket `numberOfJobsImported / numberOfJobs`
  counter and a checkmark when `depot.done` (implicit via the
  `hasDoneDepot()` helper at `homeControl.js:3243-3246` gating the
  "Back" button).
- Loading overlay carries the message "Processing... please don't
  refresh or close this page while processing. It may take up to 10
  minutes." (`homeControl.js:3255`).

### Sub-B: Current gap in RoutedOperations

`NewImportWizard.tsx:66-129` (`fireImport`) fires ONE
`POST /bulk-import/import` for the entire batch, no per-bucket loop.
`SelectRegionsModal.tsx:82-142` only renders two synthetic buckets
("valid", "unmatched") from a client-side geocode result
(`SelectRegionsModal.tsx:37-59`) - it does NOT call the real depot /
region endpoints (`GET /api/address/depots/postcodes` NZ,
`GET /api/address/locations/zipcodes` US). Consequences:

1. Multi-depot NZ clients: all rows go to a single import with one
   scheduleId + one bookDate. Rows destined for depots that aren't
   covered by that schedule will either fail rating or route to the
   wrong depot.
2. Multi-region US clients: same failure mode. If two US regions
   have different schedules, one schedule is silently used for both.
3. `SchedulePickerModal` has no `depot` context - it filters
   `clientSettings.schedules` by day-of-week only, not by depot ID.
   Same schedule cannot mean the same thing for two different depots.

### Sub-C: Implementation plan

**File adds:**
- `wwwroot/app/react/components/bulk-import/DepotIterator.tsx` (new)
  - a small state-holder + renderer that owns the "current depot"
    cursor and drives the SchedulePicker + fireImport per bucket.
- Optional: extract `PerDepotProgress.tsx` for the Step 5 checkmark
  + progress list.

**File edits:**
- `wwwroot/app/react/components/bulk-import/SelectRegionsModal.tsx`:
  - Replace the two synthetic buckets with a real per-depot / per-region
    render. Add `useEffect` to call `addressService.getPostcodesByDepot()`
    (NZ) or `addressService.getZipCodesByLocation()` (US) at mount.
  - Group `parsed.rows` by `toPostCode` -> depot (NZ) or `toZipCode` ->
    region (US) using the lookup table.
  - Render one checkbox per bucket + counts. Preserve the two special
    buckets: unzoned (`id=0`) is display-only + Excel download,
    coverage-only (`id=-1`, US) shows the info banner.
- `wwwroot/app/react/components/bulk-import/wizardState.ts`:
  - Add `depots: DepotBucket[]` where `DepotBucket = { id, name,
    include, done, bookDate?, bookTime?, scheduleId?, speedId?,
    jobType?, rowIndexes: number[], numberOfJobs, numberOfJobsImported,
    pickupJob?: PickupJobToCreateResponse | null }`.
  - Add `currentDepotIndex: number` (cursor for the iterator).
  - Add actions: `SET_DEPOTS`, `SET_DEPOT_INCLUDE`, `SET_DEPOT_FIELD`
    (patch speed/schedule/bookDate/bookTime on the current cursor),
    `MARK_DEPOT_DONE`, `ADVANCE_DEPOT`.
- `wwwroot/app/react/components/bulk-import/SchedulePickerModal.tsx`:
  - Read the current bucket via
    `state.depots[state.currentDepotIndex]` instead of top-level state.
  - Filter schedules by `depotId === bucket.id` in addition to
    day-of-week + speed (`SchedulePickerModal.tsx` currently filters
    by day-of-week only - port the `depotId ===` clause from
    `homeControl.js:750-758`).
  - Show the bucket name in the modal title (matches
    `<h3>{{import.depot.name}}</h3>` at `homeView.html:514`).
- `wwwroot/app/react/components/bulk-import/NewImportWizard.tsx`:
  - Replace the single `fireImport()` with a loop:
    ```ts
    async function importNextDepot() {
      const bucket = state.depots.find(d => d.include && !d.done);
      if (!bucket) { finishOrPickup(); return; }
      // build payload from bucket.rowIndexes -> parsed.rows subset
      const payload = buildDepotPayload(bucket, state, isUs);
      const { response } = await bulkImportService.import(payload);
      if (response.success && !response.jobs?.length) {
        dispatch({ type: 'MARK_DEPOT_DONE', id: bucket.id });
        // Loop straight back to Step 5 (which shows the picker cursor
        // moving to the next included bucket).
        dispatch({ type: 'GOTO', step: 'selectRegions' });
      } else if (response.jobs?.length) {
        // Km-rated review (Section 7).
        dispatch({ type: 'SET_KMRATED', bucketId: bucket.id, rows: response.jobs });
        dispatch({ type: 'GOTO', step: 'kmRatedReview' });
      }
    }
    function finishOrPickup() {
      const pickup = pickEarliestPickup(state.depots);
      if (pickup) dispatch({ type: 'GOTO', step: 'bookPickup' });
      else handleClose();
    }
    ```
- `wwwroot/app/react/services/bulkImportService.ts`:
  - `BulkImportRequest.pickupJob` is already defined (line 179);
    just make sure `buildDepotPayload` forwards the per-bucket value.
  - No new endpoints - each iteration hits the existing
    `/bulk-import/import`.

**Wizard state fields needed:**
```
depots: DepotBucket[]
currentDepotIndex: number
loopPickupJob: PickupJobToCreateResponse | null      // earliest pickup across buckets
```

**Endpoints to hit:**
- `GET /api/address/depots/postcodes` (NZ) - already exists on
  `AddressController.cs:118`.
- `GET /api/address/locations/zipcodes` (US) - already exists on
  `AddressController.cs:173`.
- `POST /api/bulk-import/import` per iteration - unchanged.

--------------------------------------------------------------------------------

## Section 7: Km-rated review (Step 7)

### Sub-A: BulkImportHyper flow map

**Server-side origin.** Inside `Import` -> `ProcessRoutedJobs`
(`BulkService.cs:1356`), the pipeline calls
`PriceAndSplitJobsAndReturnKmRatedJobs(...)` at
`BulkService.cs:1669`. That returns a tuple `(zoneRatedJobs,
kmRatedJobs, pendingJobItems)`. Zone-rated jobs are bulk-inserted
immediately (`BulkService.cs:1712-1761`). Km-rated jobs are NOT
inserted on the first pass - they're projected into
`BulkImportJobCreateDto` and returned as `response.Jobs`
(`BulkService.cs:1763-1817`). Response payload:
```
{ success: true,
  jobs: [ ...kmRatedJobs mapped to BulkImportJobCreateDto ],
  clientId, bookDate, scheduleId, speedId,
  messages: [] }
```
`response.jobs.length > 0` is the client's signal to render Step 7's
km-rated review table.

**Client-side handling.** `confirmImport()` (`homeControl.js:3396-3416`):
```
if (data.success) {
  depot.done = true;
  depot.pickupJob = ...;
  depot.numberOfJobsImported += qtySum;
  if (!data.jobs) {
    getBulkJobs();               // reload the jobs grid
    showImport = "Step7";        // success panel
  } else if (data.jobs) {
    depot.kmRatedJobsFound = true;
    depot.data = data.jobs;                                      // replace bucket rows
    depot.numberOfJobsImported -= data.jobs.length;              // don't double-count
    checkUncheckAll();                                           // pre-tick every km row
    var msg = "Warning: N job(s) already uploaded. The below have not been uploaded...";
    import.errors = data.messages?.length ? data.messages.map(m=>m.message) : [msg];
    showImport = "Step7";
  }
}
```

**Step 7 UI (`homeView.html:633-847`).** Three view modes gated by
flags on `depot`:
1. `depot.kmRatedJobsFound && depot.data.length > 0` -> render the
   checkbox table (`homeView.html:642-768`):
   - Every row is a km-rated job. Each has a checkbox
     (`homeView.html:678-683`) bound to `job.selected`.
   - Master checkbox in header
     (`homeView.html:653-655`) toggles all via
     `checkUncheckAll()` (`homeControl.js:3593-3597`).
   - Columns depend on tenant (US or NZ) and include Job Number,
     Book Date, from/to address triplet, `Amount` (formatted as
     currency), and `Error` (if any row has an `errorMessage`).
   - Pagination via `dir-pagination-controls` (50 rows/page).
   - Export-to-Excel button (`homeView.html:709-711`).
   - Two buttons at bottom:
     - "Skip these jobs" (`homeView.html:767`) -> `showImportStep('Step5')`.
       Advances to next bucket via `nextDepot()`.
     - "Upload selected" (`homeView.html:768`) -> `confirmImport(true)`.
       Re-fires the import with `isKmRatedJobs=true`.
2. `errors.length > 0 && !kmRatedJobsFound` -> error banner + Back
   button (`homeView.html:771-775`).
3. `errors.length < 1 && !kmRatedJobsFound` -> success banner
   (`homeView.html:777-844`) with:
   - "Jobs imported successfully." alert.
   - Optional "Unimported Jobs List" table when
     `failedImportJobs.length > 0` (rows the operator
     de-selected on the km-rated round).
   - "Next" button -> `showImportStep('Step5')` to loop to the next
     bucket.

**Re-fire payload (isKmRatedJobs=true).** In `confirmImport(true)`
(`homeControl.js:3253-3441`):
- `isKmRatedJobs = true` flips two paths:
  - Validation at `homeControl.js:3316-3324`: at least one row must be
    selected. Unselected rows are stashed as
    `import.failedImportJobs` (for the "Unimported" table on success).
  - Payload filter at `homeControl.js:3327`:
    `jobs = depot.data.filter(x => x.selected)` (only ticked rows).
- Sent as `isKmRatedJobs: true` at `homeControl.js:3375`.

**Server-side re-fire.** `ProcessRoutedJobs` at
`BulkService.cs:1667` (`if (!request.isKmRatedJobs)`) branches:
- FALSE branch (`BulkService.cs:1667-1817`) is the FIRST-pass path
  (split zone / km, insert zone-rated, return km-rated for review).
- TRUE branch (`BulkService.cs:1819-...`) is the RE-FIRE path.
  It skips the split, runs `SplitJobAndApplyAmount` on the incoming
  jobs (they already have Amounts from the km-rating round), inserts
  them straight into `tblBulkJob` via the same
  `BulkInsertAsync` path used by the zone-rated jobs. No second
  km-review round is possible - one round only.

### Sub-B: Current gap in RoutedOperations

- Backend is ALREADY parity-ported.
  `BulkImportJobFactory.cs:997-1146` mirrors the source's
  `!request.isKmRatedJobs` branch and the km-rated projection at
  `BulkImportJobFactory.cs:1094-1146`. Nothing to add server-side.
- Frontend hard-codes `isKmRatedJobs: true` at
  `NewImportWizard.tsx:73` (!!!). Look at line 73:
  ```
  isKmRatedJobs: true,
  ```
  This is a BUG masquerading as a feature: it forces every wizard
  submission into the "re-fire" path. That means:
  - `ProcessRoutedJobs` skips the km/zone split at
    `BulkImportJobFactory.cs:997` and jumps straight to inserting all
    rows with whatever `job.Amount` came in (likely null / 0 for
    freshly-uploaded rows since the client hasn't rated them).
  - The operator never gets to review km-rated rows because the
    server never returns `response.jobs` on this path.
  - Any row that legitimately would have km-rated silently inserts
    with a zero / null Amount.
- No React UI for the km-rated review table at all.

### Sub-C: Implementation plan

**Bug fix (P0):**
- `wwwroot/app/react/components/bulk-import/NewImportWizard.tsx:73` -
  change `isKmRatedJobs: true` to `isKmRatedJobs: false`. The re-fire
  path is now driven by the km-rated review flow below.

**File adds:**
- `wwwroot/app/react/components/bulk-import/KmRatedReviewModal.tsx` (new)
  - Renders the checkbox table from `response.jobs` returned by the
    first-pass import. Master checkbox + per-row `selected`. Two
    footer buttons: "Skip these jobs" (mark bucket done, advance)
    and "Upload selected" (fire the isKmRatedJobs=true re-import).

**File edits:**
- `wwwroot/app/react/components/bulk-import/wizardState.ts`:
  - Add step `'kmRatedReview'` to `WizardStep`.
  - Add state fields:
    ```
    kmRatedRows: BulkImportJobCreateDto[]           // rows from response.jobs
    kmRatedSelected: Record<number, boolean>        // rowIndex -> selected
    failedImportJobs: BulkImportJobCreateDto[]      // de-selected on re-fire
    ```
  - Add actions: `SET_KMRATED`, `TOGGLE_KMRATED_ROW`,
    `SET_ALL_KMRATED_SELECTED`, `SET_FAILED_IMPORT_JOBS`.
- `wwwroot/app/react/components/bulk-import/NewImportWizard.tsx`:
  - Replace `fireImport()` return handling:
    ```ts
    const { response } = await bulkImportService.import(payload);
    if (!response.success) { /* toast + return */ }
    if (response.jobs?.length) {
      dispatch({ type: 'SET_KMRATED', rows: response.jobs });
      dispatch({ type: 'GOTO', step: 'kmRatedReview' });
      return;
    }
    // else success: mark bucket done, advance depot loop
    ```
  - Add a `confirmKmRated(uploadSelected: boolean)` helper. Payload:
    ```ts
    {
      ...basePayload,
      isKmRatedJobs: true,
      jobs: uploadSelected
        ? state.kmRatedRows.filter((_, i) => state.kmRatedSelected[i])
        : [],
    }
    ```
    (Skip fires `MARK_DEPOT_DONE` + `GOTO selectRegions` directly - the
    Skip button doesn't call `/import` at all in the AngularJS source,
    see `homeView.html:767`.)
- `wwwroot/app/react/components/bulk-import/NewImportWizard.tsx`:
  - Insert `<KmRatedReviewModal>` after `<RateByDistanceModal>` in
    the render tree, gated on `state.step === 'kmRatedReview'`.

**Wizard state fields needed:** listed above under `wizardState.ts`.

**Endpoints to hit:**
- `POST /bulk-import/import` with `isKmRatedJobs: true` on re-fire.
  Same endpoint, same DTO. No new backend work.

--------------------------------------------------------------------------------

## Section 8: Pickup booking (Step 8)

### Sub-A: BulkImportHyper flow map

**Entry.** Step 8 is reached ONLY from `nextDepot()`
(`homeControl.js:3221-3234`) when all buckets are `done` AND at least
one bucket has a `pickupJob` payload attached. The "one-pickup covers
all deliveries" reduction lives at `homeControl.js:3226-3229`:
```
if (!import.pickupJob || import.pickupJob.pickupJob.time > d.pickupJob.pickupJob.time)
    import.pickupJob = d.pickupJob;
```
i.e. pick the earliest cutoff.

**Where the pickup payload comes from.** The server attaches
`response.PickupJob` to the /bulk-import/import response only when the
client has `CreateBulkHomeDeliveryPickup=true`. See
`BulkService.cs:1742-1746`:
```
if (client.CreatBulkHomeDeliveryPickupJob) {
    response.PickupJob = await GetBulkHomeDevlieryPickUpJob(
        request.MessageId, client, client.Schedule.StartTime.ToTimeSpan(),
        jobs, request.PickupJob);
}
```
`GetBulkHomeDeliveryPickupJob` (ported to R.O. as
`BulkImportRatingService.cs:403-476`) returns
`PickupJobToCreateResponse` with:
- `NumberOfVehicles` (dropdown: 1, 2, 3) - `AngularOption[]`.
- `VehicleSizes` (dropdown: Car, Van) - `AngularOption[]`.
- `PickupJob` - a fully-hydrated `PickupJobToCreateDto` with
  from/to addresses, weight, qty, book time (schedule.StartTime -
  2h), OurRef "PU", pickup lat/lng, hard-coded delivery lat/lng of
  17 Saleyards Rd Otahuhu (the depot).

Note: this is NZ-only in practice (delivery hard-coded to the
Auckland depot). US clients don't set `CreateBulkHomeDeliveryPickup`
so Step 8 never fires.

**Step 8 UI (`homeView.html:849-931`).** Two view modes:
1. `import.pickupJob.pickupJob` set (initial state) - render the form:
   - `Choose Vehicle Size` dropdown -> `import.pickupJob.vehicleSize`,
     `ng-change="getPickupRate()"`.
   - `Choose Number of Vehicles` dropdown -> same pattern.
   - `Pickup DateTime` `<input type="datetime-local">` with
     `min=today`, `max=maxTime` (schedule cutoff), `ng-change` also
     re-fires `getPickupRate()`.
   - Rate display `<h3>Amount: {{import.pickupJob.amount |
     currency:"NZD$"}}</h3>` at `homeView.html:894-896`.
   - Error banner.
   - Two buttons: "Book pickup" -> `bookPickup()`, "No pickup
     required" -> `closeImport(true)` (`homeView.html:903-904`).
2. `import.pickupJob.jobIds.length > 0` (post-book) - success banner
   + Finish button (`homeView.html:907-913`).

**`getPickupRate()` (`homeControl.js:3443-3492`).** Fires on every
form-field change once BOTH `vehicleSize` and `numberOfVehicle` are
set. Validates that `pickupJob.time <= maxTime` (schedule cutoff),
sets `pickupJob.size = vehicleSize.value`, then POSTs:
```
POST /api/Bulk/GetPickupRate
{ vehicleSize: pickupJob.vehicleSize.value,
  numberOfVehicle: pickupJob.numberOfVehicle.value,
  pickupJob: pickupJob.pickupJob }
```
Response `{ success, amount }` -> writes `import.pickupJob.amount`
for the currency display.

**`bookPickup()` (`homeControl.js:3494-3558`).** Validates required
fields (vehicleSize, numberOfVehicle, pickupJob.time <= maxTime),
clears `pickupJob.jobIds = null`, then POSTs:
```
POST /api/Bulk/BookPickup
{ vehicleSize, numberOfVehicle, pickupJob }
```
Response `{ success, jobId: [ ... ] }` (yes, `jobId` is plural). On
success clears `pickupJob.pickupJob = null` (hides form) and stashes
`pickupJob.jobIds = jobId` (shows success banner). Server-side
`BulkService.BookPickup` (`BulkService.cs:1893-1934`, ported to R.O.
at `BulkImportRatingService.cs:63-99`) loops `NumberOfVehicle` times
calling `WS_stpJob_Insert` for each vehicle, returns the job IDs.

### Sub-B: Current gap in RoutedOperations

- Backend endpoints exist and are parity-ported:
  - `POST /api/bulk-import/pickup-rate` -> `BulkImportController.cs:218`
    -> `BulkImportRatingService.GetPickupRate` at line 33.
  - `POST /api/bulk-import/book-pickup` -> `BulkImportController.cs:237`
    -> `BulkImportRatingService.BookPickup` at line 63.
  - `BulkImportResponse.PickupJob` field is present via the
    `BulkImportResponse` DTO (verify at `Core/Application/Dtos/BulkImport/Bulk/BulkImportResponse.cs`
    - already carries `PickupJob: PickupJobToCreateResponse`).
- Frontend has NO wrapper methods or modal:
  - `services/bulkImportService.ts` lines 262-347 do not expose
    `getPickupRate` / `bookPickup`. The interface has a
    `PickupJobRequest` stub at line 157-168 that's missing all the
    fields the server expects (`vehicleSize`, `numberOfVehicle`,
    `pickupJob` sub-object, `time`, `size`, `weight`, `quantity`,
    lat/lng, etc.).
  - No `BookPickupModal.tsx` component exists under
    `wwwroot/app/react/components/bulk-import/`.
  - `NewImportWizard.tsx` never inspects `response.pickupJob` -
    the field is silently discarded even on tenants where the server
    sends it.

### Sub-C: Implementation plan

**File adds:**
- `wwwroot/app/react/components/bulk-import/BookPickupModal.tsx` (new)
  - Renders the two view modes from `homeView.html:849-931`.
  - Local state: `vehicleSize`, `numberOfVehicle`, `pickupTime`
    (defaults from `pickupJob.time`), `amount`, `jobIds`, `error`.
  - Debounced `getPickupRate()` effect on any field change once both
    dropdowns are set (300ms debounce to avoid every keystroke firing
    a rate call).
  - "Book pickup" button gated on `vehicleSize && numberOfVehicle &&
    pickupTime <= maxTime`. On success, replace form with success
    banner + Finish button.

**File edits:**
- `wwwroot/app/react/services/bulkImportService.ts`:
  - Expand `PickupJobRequest` interface to match the DTO
    `Core/Application/Dtos/BulkImport/Bulk/PickupJobRequest.cs`:
    ```ts
    interface PickupJobToCreateDto {
      time: string; size: string; weight: string;
      quantity: number; bookedBy?: string; fromAddress?: string;
      fromSuburb?: string; fromPostCode?: number;
      toAddress?: string; toSuburb?: string; toPostCode?: number;
      speed?: string; speedID?: number; clientID: number;
      pickUpLatitude?: string; pickUpLongitude?: string;
      deliveryLatitude?: string; deliveryLongitude?: string;
      /* ... plus the ClientNotes, FromContactName, ToContactName,
         Type, OurRef, ReferenceA/B, JobNotification*, ... fields
         the SP expects */
    }
    interface PickupJobRequest {
      messageId?: string;
      vehicleSize: string;              // "Car" | "Van"
      numberOfVehicle: number;
      pickupJob: PickupJobToCreateDto;
    }
    interface PickupJobRateResponse extends BulkBaseResponse {
      amount: number | null;
    }
    interface PickupJobResponse extends BulkBaseResponse {
      jobId: number[];                  // plural
    }
    ```
  - Add wrappers:
    ```ts
    getPickupRate: (payload: PickupJobRequest) =>
      request<PickupJobRateResponse>('/bulk-import/pickup-rate', {
        method: 'POST', body: JSON.stringify(payload)
      }).then(raw => ({ response: raw })),
    bookPickup: (payload: PickupJobRequest) =>
      request<PickupJobResponse>('/bulk-import/book-pickup', {
        method: 'POST', body: JSON.stringify(payload)
      }).then(raw => ({ response: raw })),
    ```
  - Add `PickupJobToCreateResponse` interface (mirroring the DTO in
    `Core/Application/Dtos/BulkImport/Bulk/PickupJobRequest.cs:18-23`)
    and add `pickupJob: PickupJobToCreateResponse | null` to
    `BulkImportResponse`.
- `wwwroot/app/react/components/bulk-import/wizardState.ts`:
  - Add step `'bookPickup'` to `WizardStep`.
  - Add fields:
    ```
    pickupJobPayload: PickupJobToCreateResponse | null   // earliest across depots
    ```
  - Add actions: `SET_PICKUP_JOB`, `CLEAR_PICKUP_JOB`.
- `wwwroot/app/react/components/bulk-import/NewImportWizard.tsx`:
  - After each per-depot import success, if
    `response.pickupJob?.pickupJob` present, compare its `time` to
    `state.pickupJobPayload?.pickupJob?.time` and keep the earlier
    (matches `homeControl.js:3226-3229`).
  - After the depot loop exits with no more buckets, check
    `state.pickupJobPayload`: transition to `'bookPickup'` if set,
    otherwise close.
  - Render `<BookPickupModal>` gated on `state.step === 'bookPickup'`.

**Wizard state fields needed:** `pickupJobPayload:
PickupJobToCreateResponse | null`, plus step `'bookPickup'`.

**Endpoints to hit:**
- `POST /bulk-import/pickup-rate` - server ready.
- `POST /bulk-import/book-pickup` - server ready.

--------------------------------------------------------------------------------

## Section 9: US Staff Import branch

### Sub-A: BulkImportHyper flow map

**Tenant branch in the service.** `BulkService.StaffImport`
(`BulkService.cs:4104`) supports BOTH tenants inside a single loop.
Contrary to earlier notes, the source method does NOT early-return
for non-NZ - the `IsNzTenant()` check at `BulkService.cs:4117-4122`
was recently ADDED (see the "Attempted staff import on non-NZ tenant"
warning at line 4119) but the loop body's `if (IsNzTenant()) { ... }
else { ... }` branch (`BulkService.cs:4294-4516`) still contains a
complete US path. Two possibilities:
1. The early return is a safety net that was added later than the
   loop body's US branch was written (dead code kept for symmetry).
2. The early return was added to LOCK US out temporarily, with the
   loop's US branch preserved for eventual re-enable.

Either way, the US branch is line-for-line implemented at
`BulkService.cs:4391-4516`. It calls `DD_stpJob_InsertExceleratorAsync`
with 87+ params, then loops item-inserts via
`NET_stpBulkJobItems_InsertAsync` (same as the NZ branch).

**Controller gate.** `BulkController.StaffImport`
(`BulkImportHyper/Api/Controllers/BulkController.cs:117-160`) gates
on TWO claims:
- `Internal == true`
- `CountryCode == "NZ"` (case-insensitive)
Non-NZ callers get a 401 with the "Staff import is only available for
NZ tenants" message. To enable US, the CountryCode gate must be
removed OR relaxed to "NZ" OR "US".

**Frontend gate.** BulkImportHyper's `homeView.html` only offers the
Staff Import menu item when both `isInternal && isNzTenant` are true
(mirrors the controller gate).

**Field mapping US vs NZ (in the loop body).** Common column
extraction runs first (`BulkService.cs:4132-4293`) and reads the SAME
fields via `GetStringValue` / `GetIntValue` etc. Both branches read:
- Identity: JobNumber (AUTOGENERATE fallback), ClientID / ClientCode,
  Contact.
- Money / speed: Amount, SpeedId (defaults to 1).
- From address: FromCompany, FromAddress, FromSuburb / FromCity,
  FromState, FromPostCode / FromZipCode.
- To address: ToCompany, ToAddress, ToSuburb / ToCity, ToState,
  ToPostCode / ToZipCode, ToContact, ToContactPhone.
- Dimensions: Qty, Size (default 2), Weight.
- Courier: CourierId (validated against tucCourier), CourierCode
  fallback.
- Refs / notes: ClientRefA / ClientRefB / OurRef / Notes.
- Tracking: TrackingEmail / TrackingMobile / PODEmail / PODMobile
  (with legacy Email / Mobile fallbacks).
- Coordinates: PickUpLatitude / PickUpLongitude / DeliveryLatitude /
  DeliveryLongitude (with legacy fromLat/fromLng/toLat/toLng).
- Timezone: derived via `GetTimeZoneCode(lat, lng)`.

The US branch (`BulkService.cs:4391-4516`) then passes those into
`DD_stpJob_InsertExceleratorAsync` with US-specific quirks:
- Address strings prefixed with company name where present
  (`fullFromAddress = "{Company}, {Address}"`, `fullToAddress`
  similarly) at `BulkService.cs:4397-4403`.
- Speed sent as EMPTY STRING for `speed` param, SpeedID sent as-is.
  (NZ sends the SpeedID directly as `speed: speedId.Value`.)
- `vehicleSizeID: 2` hard-coded (NZ passes the parsed `size`).
- `type: "1"`, `pickUpFrom: "1"`, `leaveNotHome: "Signature
  Required"` all hard-coded strings.
- `sourceId: 3` (bulk import origin).
- `deliverByDateTime: null` (no ETA hint).
- `dGClass: null`, `dGDocs: false`, `dimensionsType: null`,
  `cubicList/weightList/barcodeList: string.Empty`.
- Output params `jobID` + `message`.

Post-SP steps mirror NZ:
- Delivery-note insert via `InsertJobDeliveryNote(jobIdParam.Value.Value, notes)`
  if `notes` present.
- Per-quantity item insert loop via `NET_stpBulkJobItems_InsertAsync`
  (barcode `{jobNumber}-{itemIndex+1}`).

**What params/data DIFFER US vs NZ:**
| Param | NZ (INT_stpJob_BulkInsert) | US (DD_stpJob_InsertExcelerator) |
|-------|----------------------------|----------------------------------|
| `size` | short (parsed) | vehicleSizeID: 2 (hard-coded) |
| `speed` | speedId int | "" + speedID separate |
| `qty` | short | `quantity: qty.ToString()` |
| `fromAddress` | address only | "{Company}, {Address}" |
| `toAddress` | "{Company}, {Address}" (both branches prefix - NZ at line 4297-4300, US at line 4401-4403) | same |
| `bookTime` | DateTime | `time: DateTime` (same field, different param name) |
| `sourceID` | 3 | `sourceId: 3` (casing) |
| `notes` | 4 separate params (Notes, ProofOf..., trackingEmail, trackingMobile) | 5 params (courierNotes, clientNotes, pickupNotes, deliveryNotes, jobNotificationEmail) |
| `runName / prebookJob / wellingtonJob / nWDocJob / onHold` | NZ-only params | absent on US SP |
| `recurringName / recurringDays / recurringFrequency` | absent on NZ | US SP requires (send empty strings) |

**Frontend wizard fields.** The BulkImportHyper `homeView.html` Staff
Import wizard (Step2 preview at `homeView.html:1265-1273` etc.) does
NOT add any US-specific fields. Both branches consume the same
row-dict payload. The differentiator is entirely on the backend loop
branch.

### Sub-B: Current gap in RoutedOperations

**Backend:**
- `BulkImportStaffImport.cs:53-58` early-returns for non-NZ with the
  "Staff import is only available for NZ tenants" message.
- Line 224 onwards runs ONLY `INT_stpJob_BulkInsertAsync`. There is
  no US branch equivalent to the source's
  `BulkService.cs:4391-4516`.
- Controller `BulkImportController.cs:173-181` gates on
  `CountryCode == "NZ"` and returns 403 for non-NZ. This gate must
  be removed or relaxed to "NZ" OR "US".

**Frontend:**
- `pages/BulkImport.tsx:147` gates the Staff Import button visibility
  on `isInternal && !isUsTenant` - button is hidden for US operators.
- Same gate at line 320 for the modal render.
- `StaffImportModal.tsx` has no US-specific branches - the payload is
  a raw row-dict, so no US fields to add.

### Sub-C: Implementation plan

**Backend file edits:**
- `RoutedOperations/API/Controllers/BulkImportController.cs`:
  - Remove or relax the `CountryCode == "NZ"` gate at lines
    173-181. Simplest: delete lines 173-181 entirely. The
    `Internal` claim gate at lines 160-171 stays.
- `RoutedOperations/Core/Application/Services/BulkImport/BulkImportStaffImport.cs`:
  - Remove the `if (!IsNzTenant())` early-return at lines 53-58.
  - Wrap the existing `INT_stpJob_BulkInsertAsync` call
    (currently lines 224-287) in `if (IsNzTenant()) { ... } else
    { ... }`.
  - Port the US branch from BulkImportHyper's
    `BulkService.cs:4391-4516` verbatim into the `else`. Adjustments:
    - Use `Context.Procedures.DD_stpJob_InsertExceleratorAsync` (the
      port already has this proc wired - see
      `BulkImportJobFactory.cs` which uses the same 91-param variant
      per the file header note at
      `BulkImportStaffImport.cs:20-22`).
    - Params: 91-param signature. The three extra tail params
      (`forceTucJobPush: false, jobBookingID: 0, pickupReadyDateTime:
      time`) documented at `BulkImportStaffImport.cs:20-22`.
    - Output params: use `OutputParameter<int?> jobIdParam` +
      `OutputParameter<string> messageParam` (same shape used by
      `BulkImportJobFactory.cs` on the routed / on-demand path).
    - Post-SP: mirror the NZ branch - if `notes` non-blank and
      `jobIdParam.Value.HasValue`, call `InsertJobDeliveryNote`. Then
      loop `NET_stpBulkJobItems_InsertAsync` `qty` times with the
      same barcode pattern.
    - Log messages: rewrite "NZ job" to "US job" so log tailing
      can distinguish.

**Frontend file edits:**
- `wwwroot/app/react/pages/BulkImport.tsx`:
  - Line 147: change `{isInternal && !isUsTenant && (` to
    `{isInternal && (`.
  - Line 320: same change.
  - No US-specific state needed - the modal already treats each row
    as a dict.
- `wwwroot/app/react/components/bulk-import/StaffImportModal.tsx`:
  - No US-specific fields required (both branches consume the same
    row-dict). Verify the modal's preview / column-detection helpers
    work with US column headers (FromCity / FromState / FromZipCode
    etc.) - they should, because everything is dict-shaped.
  - If Section 5 gap S-A (ClientID presence check) has already
    landed, keep the check tenant-agnostic - both branches need it.

**Wizard state fields needed:** none - the modal state is unchanged.

**Endpoints to hit:**
- `POST /bulk-import/staff-import` - same endpoint, now accepts US
  callers. No new endpoint.

--------------------------------------------------------------------------------
