# FINAL-LEGACY-GAPS.md

Exhaustive audit of `BulkImportHyper/wwwroot/app/components/home/homeControl.js`
(5,345 lines) + `homeView.html` (1,438 lines) against the current React port
under `RoutedOperations/wwwroot/app/react/components/bulk-import/`.

Reference paths are ABSOLUTE. Legacy = `C:\Gitlab\BulkImportHyper\...`. Current
= `C:\Gitlab\RoutedOperations_Root\RoutedOperations\wwwroot\app\react\...`.

Priorities:
- **P0** broken (feature exists but does not work or cannot be reached)
- **P1** missing capability the operator would notice
- **P2** minor differences
- **P3** pure polish


## P0 - Broken / unreachable

### P0-1. Delete Template UI is completely absent
- Legacy `homeView.html:309-319`: template dropdown + trash icon.
  ```html
  <div class="templates-container">
    <select ng-model="import.template" ng-options="template as template.name for template in templates track by template.id"
            ng-change="loadFromTemplate()" ...>
      <option value="">Select Template... (Optional)</option>
    </select>
    <i class="fas fa-trash" ng-if="import.template" ng-click="deleteTemplate()"></i>
  </div>
  ```
- Legacy delete handler `homeControl.js:322-337` calls `uBulkData.deleteTemplate({ id })`.
- Backend endpoint exists: `RoutedOperations\API\Controllers\TemplatesController.cs:98-114` (`DELETE /api/templates/{Id}`).
- Client method exists: `wwwroot\app\react\services\templatesService.ts:59-62` (`templatesService.deleteTemplate`).
- Current UI: `components\bulk-import\MapColumnsModal.tsx:382-412` renders the Select-Template dropdown but has NO trash icon and no delete handler.
- **User screenshot symptom**: operator sees an input labelled "test data" + trash icon that does nothing = probably the `Save-as-template` textbox at `MapColumnsModal.tsx:478-493` being confused for a delete field.
- **Fix**: add a trash button beside the Select-Template dropdown that fires `templatesService.deleteTemplate(state.options.templateId)` when a template is loaded, then removes it from local `templates` state and clears `state.options.templateId`. Confirmation modal preferred (matches other delete flows in this repo).

### P0-2. Non-internal (single/multi) client picker branch missing
- Legacy `homeView.html:151-172`: two `ui-select` variants - internal branch does server-side search (min 3 chars), REGULAR branch does client-side filter over a pre-loaded `$scope.clients` list. Also `homeView.html:151` skips the dropdown entirely when `clients.length === 1`.
- Current `components\bulk-import\NewImportModal.tsx:22-138` + `shared\ClientTypeahead.tsx:1-171` ALWAYS uses server search with min-3-char rule.
- Impact: single-client contacts (99% of external clients) still have to type; there is no auto-fill.
- **Fix**: On modal open call `clientsService.getClients()` first. If response contains a `clients` list AND `!isInternal`, use a plain `<select>` (auto-pick when `clients.length === 1`). Fall through to the server-search typeahead only for internal users. Mirrors `homeControl.js:16-40`.

### P0-3. "Fix Suburbs" / "Fix Zip Codes" writes the corrected value onto the WRONG row when the same bad value maps to different corrections per row
- Legacy `homeControl.js:2339-2353` (fixSuburbs) loops each flagged suburb + writes into every row whose `toSuburb + toPostCode` matches (postcode-aware).
- Current `wwwroot\app\react\components\bulk-import\NewImportWizard.tsx:440-445` uses only `state.fixedZips[j.toSuburb]` keyed on the bare suburb name.
- Impact: NZ dataset with `"Ponsonby, 1010"` and `"Ponsonby, 1011"` both flagged - operator picks two different corrections in the modal, but only ONE key survives in `state.fixedZips` because the dict is keyed by name-only. Second correction silently overwrites the first.
- Current `components\bulk-import\FixZipCodesModal.tsx:102-121` builds `badZips` as a bare-name list (no postcode dedup key).
- **Fix**: change `state.fixedZips` key to `${badValue}|${postcode || ''}` and iterate flagged rows with both name AND postcode; also update `NewImportWizard.buildJobs:440-445` to look up on the same composite key.

### P0-4. No US "coverage-only" (id=-1) bucket rendered in SelectRegionsModal
- Legacy `homeControl.js:3099-3110` returns three US buckets: assigned location, `coverageOnly` (id=-1, "Valid ZIP - Rate By Distance"), and `unmatched` (id=0). Legacy `homeView.html:483-485` renders a distinct info banner for id=-1.
- Current `components\bulk-import\SelectRegionsModal.tsx:97-128` only builds `id > 0` real buckets + `id === 0` unmatched. Coverage-only rows fall into `Unmatched` and get blocked as "cannot be imported".
- Impact: US operators with valid ZIPs that fall outside a fixed zone get NO way to rate-by-distance those rows through the wizard, even though `RateByDistanceModal.tsx` exists and reads `state.selectedRegions.has('valid')` (never true because the bucket is never created).
- **Fix**: in `SelectRegionsModal` add a `getZipPolygons()` call (currently no service method; add one against `/address/zippolygons`). For rows that are NOT in `depotLookup` BUT are in the `zipPolygons` Set, put them in a synthetic `{ depotId: -1, depotName: 'Valid ZIP - Rate By Distance', ... }` bucket. Store as `'valid'` in `selectedRegions` so `NewImportWizard.afterSchedulePicker:256-265` finds them.

### P0-5. Km-Rated review is presented even when there are no km-rated rows (dead path) OR skipped entirely when it should fire
- Legacy `homeControl.js:3401-3416`: km-rated pivot only fires when server returns `data.jobs`. Current wizard mirrors this at `NewImportWizard.tsx:230-234`, BUT the server response's `jobs` field is used AS the payload for the second call. If server returns `jobs: []` (empty array, not null) the check `response.jobs && response.jobs.length > 0` never trips, which matches legacy. That path is OK.
- The real problem: `state.pickupJobPayload` is captured but the wizard advances immediately with `advanceOrFinish(...)` at `NewImportWizard.tsx:244` reading `state.perDepotResults` synchronously AFTER a `dispatch`. React state IS stale within the same handler. The `justAddedResult`/`justAddedPickup` args at `NewImportWizard.tsx:159-198` cover ONE result but the summary loop rebuilds `allResults = [...state.perDepotResults, justAddedResult]` from the STALE `state.perDepotResults`. If more than 2 depots were iterated, results 1..N-2 are correct (state settled between renders) but the very last summary is off-by-one.
- Impact: minor visible - the summary toast shows one fewer imported count than truth on the final depot. All jobs ARE imported.
- **Fix**: track `perDepotResults` in a `useRef` alongside the dispatch, and read from the ref in `advanceOrFinish`. Or refactor to pass the accumulated results array through the recursion.


## P1 - Missing capabilities operators would notice

### P1-1. Ref A / Ref B never become required when client demands them; label never shows tenant-configured message
- Legacy `homeControl.js:1575-1606`: `clientRefA.required = !!client.referenceAMandatory`; label = `'Ref A (' + client.referenceAMessage + ')'` when set.
- Current `wwwroot\app\react\components\bulk-import\wizardState.ts:456-466`: RefA / RefB are always optional and use a static label. Client settings ARE available via `state.clientSettings` (see `MapColumnsModal.tsx:86`), so this is a plumbing gap not a data gap.
- **Fix**: pass `clientSettings` into `urgentFieldsFor()` and stamp `required = clientSettings.referenceAMandatory` + `label = 'Ref A' + (msg ? ` (${msg})` : '')`.

### P1-2. From-fields never appear even when "Route starts from client site" is off AND no Origin Location is picked
- Legacy `homeControl.js:1141-1180`: `fromFieldsActiveAnyTenant()` returns true when the operator has NOT enabled clientSite AND has NOT picked an origin location; in that case fromAddress/fromCity/fromState/fromZipCode/fromSuburb/fromPostCode become REQUIRED and RENDERED.
- Current `wwwroot\app\react\components\bulk-import\wizardState.ts:353-364`: from-fields are hardcoded OFF except `fromContact`. Comment explicitly says the legacy `homeControl_bk.js:261-285` had the block commented out. That reasoning is wrong - `homeControl.js` (the LIVE file, not `_bk.js`) at lines 1298-1358 reinstated the from-fields as conditionally required.
- Impact: US operator who does not enable `routeStartsFromClientSite` and does not pick an `originLocation` cannot map the from-address columns, so the server has NO origin for on-demand rows and either rejects them or rates them badly.
- **Fix**: in `urgentFieldsFor()`, when tenant is US AND `!routeStartsFromClientSite` AND `!originLocation`, emit `fromAddress` (required), `fromCity` (required), `fromState` (required), `fromZipCode` (optional). For NZ ondemand, emit `fromSuburb` (required) + `fromPostCode` (optional). Wire the two options into the memo dep list.

### P1-3. Address auto-fix (Places autocomplete) not present
- Legacy `tpls\gpsForm.html:33`: `<input ng-map-autocomplete>` with 1s debounce - operator types a search string and picks a Places autocomplete suggestion; the marker moves + zip/lat/lng auto-fill from `place.geometry.location`.
- Current `components\bulk-import\FixAddressesModal.tsx:208-215`: renders a bare text input labelled "Search Address" that only echoes state - no autocomplete, no place lookup. The only way to move the pin is right-click / drag OR manually type lat/lng.
- Impact: fixing a batch of 30-50 flagged addresses is now click-drag per pin (slow) vs type-a-few-chars-Enter (fast).
- **Fix**: on top of the existing `@vis.gl/react-google-maps` bundle, add `PlaceAutocompleteElement` (or the `usePlacesAutocomplete` hook) bound to the search input. When user picks a suggestion, call `saveCoords(lat, lng)` and populate zip/postcode from the resolved place.

### P1-4. Failed / Unimported Jobs list not rendered anywhere
- Legacy `homeView.html:783-841`: at the end of the wizard, when `import.failedImportJobs.length > 0`, an "Unimported Jobs List" table renders with job number, book date, addresses + Export-to-Excel link.
- Current `components\bulk-import\wizardState.ts:111`: `failedImportJobs: BulkImportJobCreateDto[]` is defined AND populated at `KmRatedReviewModal.tsx:64-66`, but no view ever reads it - `NewImportWizard.tsx` closes the modal on completion.
- Impact: operator loses visibility of rows they deselected. In legacy the CSV export lets them fix + retry.
- **Fix**: add a `WizardStep = 'summary'` and render a `SummaryModal` reading `state.failedImportJobs` + `state.perDepotResults`. Add an Export-to-CSV button. Route to it from `advanceOrFinish` before closing.

### P1-5. Book date range max is 30 days but message is not surfaced pre-submit
- Legacy `homeControl.js:3291-3298`: server-side rejects `bookDate >= today + 30`; user sees "Book Date must not exceed 30 days from now." AFTER hitting Next.
- Current `components\bulk-import\SchedulePickerModal.tsx:184-195` already enforces `max = today + 30` via the input's `max` attr - GOOD - but iOS Safari + some Chromium builds do NOT honour min/max on `type=date`. Add an explicit JS validation in the Next button click. Cosmetic P2 in most browsers, P1 for iPad operators.

### P1-6. Preview pagination legacy shows `previewIndex+1` numbered like `1..N`; current shows `Row N of Total` which is fine, BUT the pagination buttons in current MapColumns are visually smaller/less obvious than legacy `<< < > >>` icons. Not really a P1, downgrading to P3.

### P1-7. Job-list "Search" is server-side in current impl? No - it's client-side (`BulkImport.tsx:58-85`) but the endpoint returns limited rows. If a tenant has >1000 imports, search only finds within the first page.
- Legacy `homeControl.js:99-132` also does client-side filter on the same in-memory jobs array. So this is parity.
- No action needed.

### P1-8. Datepicker for Book Date in Step 6 disables non-schedule dates in legacy
- Legacy `homeControl.js:601-637`: `beforeShowDay` callback GREY-OUT any date that does not have a matching schedule for the current depot + selected speed.
- Current `SchedulePickerModal.tsx:249-258`: bare `<input type=date>` with min/max; operator can pick a Tuesday even if no Tuesday schedule exists for the depot, then discover it in the Schedule dropdown.
- Impact: extra click, no data loss. The Schedule dropdown correctly shows "No schedules for this date + service" (`SchedulePickerModal.tsx:302-305`) so the operator can recover.
- **Fix (optional)**: render a small helper text under Book Date listing valid days-of-week for the current depot's schedules. Full calendar-cell greying-out would require a custom date picker component, probably not worth it.

### P1-9. Auto-populate bookDate + bookTime per-depot from spreadsheet columns for on-demand
- Legacy `homeControl.js:3030-3053` (NZ) + `3115-3145` (US): for on-demand imports, if a bucket's first row has a mapped bookDate + bookTime, pre-populate the depot's picker defaults from that row.
- Current: `SchedulePickerModal.tsx:169-180` always defaults to next-15-min-slot from `now()`. Per-bucket spreadsheet-derived defaults never surface.
- Impact: on-demand operators re-pick date/time per depot even when their spreadsheet has the correct values.
- **Fix**: in `SelectRegionsModal` when building buckets, also stash `firstRowBookDate` / `firstRowBookTime` (from mapped bookDate/bookTime columns) onto the `DepotBucket`. In `SchedulePickerModal`'s open effect, seed `state.bookDate` / `state.bookTime` from those when the bucket carries them.


## P2 - Minor differences

### P2-1. NewImportModal has NO "click file to browse" text hint - `FileUploadZone` presumably shows one, but legacy explicitly labels `Upload file from PC...` on the input's associated label.

### P2-2. NewImportModal shows the client typeahead ABOVE the file uploader; legacy shows it above too - OK. But legacy hides the client selector entirely when the client is pre-populated (`homeView.html:151`); current always shows the field. Cosmetic.

### P2-3. Legacy `homeView.html:184-193` retains Google Drive upload UI (behind `ng-if="false"`) with wiring for the picker. Current omits this. USER EXPLICITLY REQUESTED this hidden. Comment in `NewImportModal.tsx:79-84` correctly acknowledges. No action.

### P2-4. Legacy Templates dropdown uses `whiteselect` (styled) skin; current uses a plain `<select>`. Cosmetic.

### P2-5. Legacy "Preview" row shows the value alignment closer to the field it applies to (right side of the customer-column card); current renders it as a small text under the dropdown - similar. OK.

### P2-6. Legacy `homeControl.js:1049-1060` `getTableHeaders()` returns tenant-specific column list; current `BulkImport.tsx:207-216` renders a FIXED column set that doesn't split origin/destination for US vs NZ. Legacy shows Origin City/State/Zip for US, From Suburb for NZ. Current shows only Job Number / Book Date / Client Code / Service / Qty / Amount / Type. All the address columns are gone.
- **Fix**: read `isUsTenant` from `useAuth` and render extra columns matching `homeView.html:70-85`.

### P2-7. Legacy On-Demand step 6 has `id="pickupJobDateTime"` with per-field validation min = now, max = schedule cutoff. Current `SchedulePickerModal.tsx` handles book time separately from pickup time (pickup is on `BookPickupModal` only). OK, but on-demand `bookTime` in current has no min-time validation, so operator can pick 10 minutes AGO. Legacy `homeControl.js:3273-3289` rewinds to now+15min silently.
- **Fix**: mirror the auto-forward in `NewImportWizard.buildDepotPayload` (compose bookDateTime, if < now+15min, set to now+15min).

### P2-8. Legacy sortTable() (job list header click) is missing in current. `BulkImport.tsx:207-216` renders `th` without click handlers.

### P2-9. Legacy `homeView.html:33-58` filter bar has radio buttons; current uses toggle-buttons with counts inline (nicer). Not a gap.

### P2-10. Legacy Job List shows `job.canDelete` gate with trash icon in a cell; current does the same at `BulkImport.tsx:260-274`. Matches.

### P2-11. Legacy `homeControl.js:3593` `checkUncheckAll` toggles km-rated selections; current uses `SET_ALL_KMRATED_SELECTED` action - matches.

### P2-12. Legacy `homeControl.js:3570` `exportToExcel(tableId)` uses SheetJS to export the km-rated + unimported tables to XLSX. Current has NO export UI on km-rated or summary.

### P2-13. Legacy `homeControl.js:198-231` `deleteBulkJob` sends different DTOs (`deleteBulkJob` vs `deleteTucJob`) based on `job.type`. Current `BulkImport.tsx:98-102` does the same with `deleteRouted` vs `deleteOnDemand`. Matches.

### P2-14. Legacy Bulk Complete modal (`homeView.html:931-1219`, `homeControl.js:4446-4685`) is intentionally commented out at legacy `homeView.html:26-28`. Current does not implement it. Matches by omission.


## P3 - Polish

### P3-1. Legacy uses `<h1>Data Import</h1>`; current uses `<h1>Data Import</h1>` - same.

### P3-2. Legacy has a `dir-paginate` control with 50 per page; current also 50 per page - matches.

### P3-3. Legacy trash icon uses `fas fa-trash-alt` (FontAwesome); current uses inline SVG. Consistent with rest of react app.

### P3-4. Legacy loading overlay covers whole modal with big spinner + `loadingMessage`; current uses button text "Uploading..." / "Importing..." - less obtrusive but different feel.

### P3-5. Legacy shows `Amount: {{amount | currency:"NZD$"}}` in pickup step; current uses `Intl.NumberFormat` with 'NZD' - correct but always NZD even for US tenants (`BookPickupModal.tsx:258-266`). Should key on tenant like `KmRatedReviewModal.tsx` does.

### P3-6. Legacy suburb dropdown option label = `suburb.name + (city ? ', ' + city : '')`; current uses `k.zip + (k.zoneName ? ` (${k.zoneName})` : '')` - functionally equivalent.

### P3-7. Legacy `homeView.html:571-580` shows THREE variants of the coverage-only info banner (no-origin/client-site/origin-location); current renders one variant in `RateByDistanceModal.tsx:69-74` (only when a coverage-only bucket is selected). Since P0-4 above blocks the bucket from ever existing, this is moot until P0-4 is fixed.

### P3-8. Legacy has no keyboard shortcuts; current has none either. No gap.

### P3-9. Legacy shows `import.errors` as a red banner inside every step; current uses toasts + inline missing-required banner in Step 2. Consistent modernization.

### P3-10. Legacy `formatZipCode` strips ZIP+4 before sending (`homeControl.js:3347-3350`); current `buildJobs` at `NewImportWizard.tsx:389-454` does NOT strip ZIP+4. Server may reject "02110-1234" as int-parseable. If reports of US import failures on hyphenated ZIPs, this is the cause.


## Templates specific summary (per user question)

The Select-Template dropdown IS wired. The GAP is the delete affordance:

| Feature | Legacy | Current |
|---|---|---|
| List templates in dropdown | `homeView.html:310-317` | `MapColumnsModal.tsx:382-412` OK |
| Load template on select | `homeControl.js:475-486` (`loadFromTemplate`) | `MapColumnsModal.tsx:384-401` OK |
| Save-as-template checkbox + name | `homeView.html:327-333` | `MapColumnsModal.tsx:463-495` OK |
| POST /api/templates on save | `homeControl.js:2253-2279` | `NewImportWizard.tsx:96-114` OK |
| Trash icon to delete loaded template | `homeView.html:318` | **MISSING** |
| DELETE /api/templates/{id} | Legacy `homeControl.js:322-337` | Backend + service ready, no UI |

**User's "test data" text input + trash observation**: that IS the `Save-as-template` textbox at `MapColumnsModal.tsx:479-492` which only shows when `saveAsTemplate` checkbox is on and `templateId == null`. It has NO trash icon in the code - user may be seeing the Save box below the Select-Template dropdown and misreading it. The actual load/delete affordance is missing.

**Fix path** (concrete):
1. In `MapColumnsModal.tsx` add a horizontal flex wrapping the Select-Template `<select>` + a trash icon button.
2. Trash button renders only when `state.options.templateId != null`.
3. On click: `templatesService.deleteTemplate(state.options.templateId)`, then remove from local `templates` state and `dispatch({ type: 'SET_OPTIONS', options: { templateId: null } })`, then clear the mapping if desired (legacy does NOT clear mapping, so match that).
4. Confirmation via `window.confirm('Delete template "..."?')` or a small confirmation modal per repo style.


## Anything surprising

1. **From-address fields hidden by design in current port is WRONG for on-demand US.** The comment in `wizardState.ts:352-357` cites `homeControl_bk.js` (the BACKUP file) instead of the LIVE `homeControl.js:1298-1358`. Backup file's block IS commented out; live file's isn't. This is the single biggest logic drift.
2. **US Coverage-Only bucket dead code**: `RateByDistanceModal.tsx` and the `selectedRegions.has('valid')` check exist and are gated on a bucket that no code path ever creates. Dead path pending P0-4 fix.
3. **Per-depot iteration cursor DOES work end-to-end** (I traced `NewImportWizard.fireImportForCurrentDepot` through the KM-rated branch and the advance loop), but the summary-total off-by-one in P0-5 will bite when a batch spans 3+ depots.
4. **Staff Import** (`StaffImportModal.tsx`) is a full 5-step port with Places-fallback map, sane suburb reference + geocode. Better ported than the New Import wizard in some respects.
5. **`clientsService.getClients()` exists** in the client service but is called nowhere in the react tree. That's why non-internal single-client contacts have no fast path (P0-2).
6. **NZ tenant "unmatched" ZIP bucket has NO way to download the row list** in current impl. Legacy `homeView.html:522-559` renders a full table + `exportToExcel('jobsByZip')` button so the operator can hand the failed rows to support. Missing feature - probably P1 not P2.
