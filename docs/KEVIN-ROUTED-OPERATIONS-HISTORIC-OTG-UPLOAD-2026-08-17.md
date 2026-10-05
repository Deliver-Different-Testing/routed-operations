# Kevin — Routed Operations historic OTG upload capability

Date: 2026-08-17
Owner: Kevin
System: Routed Operations v2
Target tenant: OTG

## Goal

Add a **historic data upload** capability into Routed Operations so ops can upload legacy OTG job-history CSVs themselves without needing a developer to run a DB script each time.

This is **not** a quoting import and **not** a live dispatch import.

The purpose is:

- searchable historical jobs
- reporting
- year-vs-year sales comparison
- historical operational lookup

The imported rows must **not** be picked up by future customer invoice runs.

## Important decision

Do **not** extend the current quoting upload path to do this.

The current Routed Operations v2 upload is intentionally a **shadow-table quoting import**:

- `v2/backend/Controllers/QuoteController.cs`
- `v2/backend/Services/QuoteService.cs`
- `v2/backend/Entities/TblQuoteJob.cs`
- `v2/frontend/src/pages/Quoting.tsx`

That path writes only to `tblQuoteJob` for simulation.

Historic operational imports should be a **separate upload feature** with a separate API, service, validation flow, and permissions boundary.

## Why archive-only matters

Customer invoice batching in Accounts is based on live job selection logic, not historical archive rows.

So the safe import target is:

- `tucJobArchive`

Not:

- `tucJob`
- `tblJob`/live job flow
- `tblQuoteJob`

This historic uploader must never promote uploaded rows into live dispatch workflow.

## Required product behaviour

### User flow

1. User opens a new **Historic Upload** area in Routed Operations
2. User uploads CSV
3. User selects import type = `Historic archive`
4. System parses and previews rows
5. System validates required mappings
6. User confirms upload
7. Backend writes rows into `tucJobArchive`
8. System returns:
   - inserted row count
   - skipped/error row count
   - import batch reference
   - downloadable validation error list if applicable

### Non-negotiable safety rules

- upload goes to `tucJobArchive` only
- no writes to `tucJob`
- no writes to `tblBulkJob`
- no writes to `tblQuoteJob` for this flow
- imported jobs must land as completed historical rows
- imported jobs must not become customer invoice candidates
- imported jobs must not accidentally become courier settlement / agent BCTI candidates

## Files / areas to extend

### Frontend

- `v2/frontend/src/pages/Quoting.tsx` — reference only, do not overload this page
- add a new page, route, and menu entry for historic uploads
- likely new API methods in `v2/frontend/src/lib/api.ts`

### Backend

- add a new controller for historic imports, not `QuoteController`
- add a dedicated service, e.g. `HistoricImportService`
- extend `RouteBuilderDbContext` with `DbSet<TucJobArchive>`
- add entity mapping for `tucJobArchive`
- keep current quote upload flow untouched

### Permissions

Create a separate permission/policy from quoting so historic archive upload is explicitly controlled.

## Data shape from OTG CSV

The supplied OTG file contains 20k+ rows and is structurally usable for archive import.

Strong source columns include:

- `OrderTrackingID`
- `Company Name`
- `Ref#`
- `Ref#2`
- `Pickup Company`
- pickup address fields
- `Delivery Company`
- delivery address fields
- `Grand Total`
- `Driver Pay`
- `Weight`
- `POD Name`
- `POD Date/Time`
- pickup/delivery timing fields
- `Status`
- `Service`
- `Vehicle`
- `CSR`
- `DriverNo`

## Minimum archive mapping

At minimum the uploader must populate enough data for reporting and search:

- `UcjbNumber` ← `OrderTrackingID`
- `UcjbDate`
- `UcjbTime` / `PickUpTime`
- `UcjbClientCode` and ideally `UcjbClientId`
- `UcjbClientRefa` ← `Ref#`
- `UcjbClientRefb` ← `Ref#2`
- `UcjbFromAddr`
- `UcjbToAddr`
- `UcjbAmount` ← `Grand Total`
- `CourierPayment` ← `Driver Pay`
- `UcjbWeight`
- `UcjbPodname` ← `POD Name`
- `UcjbComplTime` ← `POD Date/Time`
- `UcjbMonth`
- `UcjbYear`

## Archive-state defaults

All imported rows must land as completed historic jobs:

- `UcjbJobDone = 1`
- `UcjbVoid = 0`
- `UcjbStatus = 6` unless OTG tenant has a different confirmed completed status code
- `UcjbComplTime` populated
- `UcjbMonth = month(UcjbDate)`
- `UcjbYear = year(UcjbDate)`

## Settlement / BCTI exclusion rules

Archive-only import is enough to keep the rows out of normal customer invoicing, but it is **not** enough on its own to protect against every downstream batch process.

Kevin’s uploader spec therefore needs an explicit backend import mode that stamps imported archive rows so they are treated as historical-only.

### Required behaviour

The import service should either:

1. stamp dedicated historical exclusion values for settlement/BCTI-related fields, or
2. call a shared import helper that Kerran’s DB-level upload also uses so both paths apply the same exclusion rules

The important thing is consistency.

Do not leave this as “insert rows and hope downstream processes ignore them”.

## Recommended architecture

### 1. Add a dedicated historic import endpoint

Example shape:

- `POST /api/historic-import/preview`
- `POST /api/historic-import/commit`
- `GET /api/historic-import/{id}`

### 2. Use staged preview validation

Preview should validate:

- required columns present
- client-code/client mapping success
- money/date parsing success
- duplicate `OrderTrackingID`
- missing POD/completion data
- unmapped service/vehicle/status values

### 3. Keep import logic server-side

Do not trust frontend transforms for status/value safety.

Server should own:

- money parsing
- date parsing
- status mapping
- completed-job defaults
- exclusion stamping
- dedupe logic

### 4. Track import batches

Add an import batch/audit table if needed so ops can see:

- file name
- uploaded by
- uploaded at
- row count
- inserted count
- rejected count
- batch notes / import type

## UX expectation

This should feel like a safe admin upload tool, not a raw CSV dump.

Minimum UX:

- file chooser
- preview grid
- validation summary
- confirm upload button
- success summary with batch reference
- downloadable error report for failed rows

## Acceptance criteria

### Scenario A — normal historic upload
Given:

- ops uploads a valid OTG legacy CSV

When:

- the upload is confirmed

Then:

- rows are inserted into `tucJobArchive`
- rows are not inserted into `tucJob`
- rows are searchable/reportable as historical jobs

### Scenario B — no customer invoicing side effects
Given:

- historic archive rows have been uploaded

When:

- future customer invoice runs execute

Then:

- those uploaded historical rows are not selected as pending live invoice jobs

### Scenario C — validation failures
Given:

- uploaded rows contain bad dates, bad amounts, or unmapped clients/services/statuses

When:

- preview runs

Then:

- invalid rows are clearly flagged
- ops cannot commit blindly without seeing the issues

### Scenario D — import auditability
Given:

- a historic import was completed

When:

- ops later reviews what happened

Then:

- the system can identify who uploaded it, when, which file, and how many rows succeeded/failed

## Deliverable

Build a **separate historic archive upload capability** in Routed Operations that lets OTG ops upload legacy job history into `tucJobArchive` safely, with preview/validation/auditability, while keeping the current quote-shadow upload untouched and preventing any live dispatch or future invoice side effects.
