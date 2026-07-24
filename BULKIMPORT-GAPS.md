# BulkImport - Discovery / Gaps Audit

Audit date: 2026-07-22
Auditor: discovery agent (read-only pass)
Scope: everything shipped in the Full-parity pass 1 BulkImport iteration, plus
a wish-list of what a production-grade bulk-job-import experience needs.

---

## Section 1: Current state inventory

### 1.1 Frontend page

`wwwroot/app/react/pages/BulkImport.tsx` (558 lines)

- Header + 4-panel grid layout, cyan/cream design tokens matching
  `Quoting.tsx` (tsx:308-518).
- Upload panel: single file picker (`accept=".csv,text/csv"` tsx:334) plus
  free-text `Import set code` input auto-derived from filename (tsx:135-137).
- File-type gate rejects xlsx explicitly with a warning toast (tsx:120-123).
- CSV parsing is inline: `parseCsv` + `parseLine` at tsx:525-557. Handles
  quoted fields, doubled-quote escape, ignores blank lines. Comma-only
  delimiter. No BOM stripping, no delimiter auto-detection.
- Auto-map by alias: `TARGET_FIELDS` array (tsx:37-54) declares 16 target
  keys with 2-5 aliases each; `autoMap` (tsx:93-110) normalises headers
  (lowercase, non-alphanum stripped) and tries exact alias match first, then
  contains-match fallback.
- Manual mapping override: per-column dropdown with `-- unmapped --` sentinel
  (tsx:361-372).
- Required-field enforcement: `missingRequired` computed at tsx:304-306,
  warning banner rendered at tsx:376-381, Import button disabled when any
  required target is unmapped (tsx:395-396).
- Client-side type coercion in `mappedRows` useMemo (tsx:146-223): trim,
  numeric strip regex, three date formats (dd/mm/yyyy, yyyy-mm-dd,
  mm/dd/yyyy plus Date.parse fallback), time formats HH:mm / HH:mm:ss /
  "HHmm" Excel-stripped. All-null row: not skipped, will fail validation.
- Client-side validation `clientValidate` (tsx:226-239) checks 4 required
  fields; results merged with server response in `doValidate` (tsx:241-266).
- Preview grid: capped at `PREVIEW_LIMIT = 50` (tsx:59). Fixed 11-column
  table (tsx:421-464). No sort, no filter, no pagination, no inline edit.
- Submit path calls `bulkImportService.submit(setCode, mappedRows)`; toast
  on result; reloads set list (tsx:268-290).
- Import history: `sets` state loaded via `loadSets` (tsx:80-88), rendered
  at tsx:482-500 with `Delete` button per set. No view-rows-of-set drill-in.
- No drag-and-drop, no multi-file, no progress bar, no cancel, no template
  download, no mapping-save.

### 1.2 Frontend service

`wwwroot/app/react/services/bulkImportService.ts` (79 lines)

- Interfaces: `BulkImportRow`, `BulkImportRowValidation`,
  `BulkImportPreviewResult`, `BulkImportSubmitResult`, `BulkImportSetSummary`
  (ts:8-56).
- Four endpoints (ts:58-79): `GET /bulk-import/sets`, `POST /preview`,
  `POST /submit`, `DELETE /sets/{code}`. All go through the shared `request`
  helper.

### 1.3 API controller

`API/Controllers/BulkImportController.cs` (57 lines)

- Route prefix `api/bulk-import`, single policy `RouteBuilder.Admin`
  (cs:16-17).
- Four actions matching the frontend service (cs:21-56).
- No file-upload endpoint (client parses CSV before hitting the API).
- No admin-only guard beyond the policy; no per-tenant quota.

### 1.4 Application service

`Core/Application/Services/BulkImport/BulkImportService.cs` (161 lines)

- `PreviewAsync` (cs:27-36): calls `ValidateRows`, returns tallied result;
  synchronous under the hood (`Task.FromResult`).
- `SubmitAsync` (cs:38-86): re-validates, keeps only valid rows, inserts
  via EF Core AddRange + SaveChanges. Sets `ValidationStatus = "Ok"` on every
  inserted row (cs:67). Does NOT persist rejected rows; they only round-trip
  in the response.
- `GetSetsAsync` (cs:88-109): GROUP BY ImportSetCode, counts + max
  CreatedUtc + invalid count. `Invalid` counts rows where ValidationStatus
  is not "Ok" - since every inserted row is written with "Ok" this always
  returns zero today (dead branch).
- `DeleteSetAsync` (cs:111-121): whole-set delete, no soft-delete, no
  audit row.
- `ValidateRows` (cs:125-145): four required-field checks + one time-parse
  check. No dedupe, no geocode, no client lookup, no cross-file dedupe, no
  duplicate-of-existing-job check.
- `ParseTime` (cs:147-160): duplicates the client-side "HHmm" tolerance.

### 1.5 DTOs

`Core/Application/Dtos/BulkImport/BulkImportDtos.cs` (68 lines)

- `BulkImportRow` (dtos:8-24): 16 nullable fields, all primitives. No
  geocoded lat/lng, no ClientId, no VehicleSizeId - operator-facing strings
  only.
- Request/result records straightforward; `BulkImportRowValidation` is
  echoed in Rejections so the frontend can rebuild a per-row problem view
  (dtos:38-42).

### 1.6 Domain entity + migration

`Core/Domain/Despatch/TblBulkImportJob.cs` (81 lines)

- Table name `tblBulkImportJob`. Columns match DTO shape 1:1 + audit
  `CreatedUtc` and `ValidationStatus` (entity:31-80).
- No CreatedBy / UpdatedBy / PromotedToBulkJobId fields - no audit path
  for who ran the import or whether a row has been promoted.

`DBMigrationV2/DatabaseScripts/Migrations/20260722100000_RoutedOperationsBulkImport.sql`
(103 lines)

- Creates the table + PK + one nonclustered index on ImportSetCode
  (mig:25-65).
- Grants mirror the tblQuoteJob pattern (mig:71-100).
- Ends with `EXEC procRefreshAllViews`.
- NOT APPLIED yet (per PARITY-TRACKING line 331 - "user to run manually").

### 1.7 Sidebar + routing

- `PARITY-TRACKING.md:321-322` records the entry point:
  `Sidebar.tsx` new "Bulk Import" item + `App.tsx` route `/bulk-import`.
- Not verified against the actual App.tsx/Sidebar.tsx in this audit but
  the tracking table says landed.

---

## Section 2: Full feature matrix

Legend: COVERED = works today. PARTIAL = present but limited. GAP = not
implemented. N/A = not needed / out of scope.

### A. File input

| Feature | Status | Notes |
|---------|--------|-------|
| CSV upload | COVERED | tsx:334, parseCsv 525-557 |
| Excel .xlsx | GAP | Explicit reject at tsx:120-123. SetUpDashboard uses ClosedXML. |
| Excel legacy .xls | GAP | SetUpDashboard uses ExcelDataReader. |
| Drag-and-drop | GAP | Plain `<input type=file>` only. |
| Multiple file upload / batch | GAP | Single file at tsx:113. |
| File size limit | GAP | No client-side check; unbounded server request. |
| UTF-8 BOM stripping | GAP | `parseCsv` does not strip 0xEF 0xBB 0xBF from first header cell - Excel exports commonly include it. First header would parse as "﻿Reference" and fail auto-map. |
| Non-UTF-8 encoding (ISO-8859-1 / Windows-1252) | GAP | `file.text()` assumes UTF-8. NZ / US operator exports from Excel default to Windows-1252 - mojibake in address strings. |
| Delimiter auto-detect (`,` vs `;` vs `\t`) | GAP | Hard-coded comma at tsx:550. European CSV exports use semicolons. |
| Quote / escape handling | COVERED | tsx:536-557 handles `"` fields and `""` escapes. |
| Google Sheets URL input | GAP | SetUpDashboard supports it; RoutedOperations does not. |

### B. Column mapping

| Feature | Status | Notes |
|---------|--------|-------|
| Auto-map by header alias | COVERED | tsx:93-110, alias table 37-54. |
| Manual per-column override | COVERED | tsx:361-372. |
| Ignore column option | COVERED | `-- unmapped --` sentinel (tsx:366). |
| Save mapping as template | GAP | No persistence layer. Every upload re-maps from scratch. |
| Reuse saved mapping template | GAP | Same. |
| Detect ambiguous / mismatched header | PARTIAL | Silent fallback to UNMAPPED. Operator has to notice manually. |
| Required-column enforcement | COVERED | tsx:304-306 + 376-381 + disabled Import button. |
| Confidence score display | GAP | SetUpDashboard shows red/yellow/green badges. RO alias-match is boolean. |
| Fuzzy match (Levenshtein) | GAP | Exact alias / contains only. SetUpDashboard uses FuzzySharp. |
| Detect competitor TMS format | GAP | SetUpDashboard identifies 7 systems (Key Software, Elite EXTRA, Datatrac, OnTime, GetSwift, Track-POD, DFRNT). Not present. |
| One column -> multiple targets | GAP | Not needed for current shape but flag if concatenation (e.g. City+State+Zip -> single address) is required. |

### C. Data validation

| Feature | Status | Notes |
|---------|--------|-------|
| Per-row validation | COVERED | 4 required-field checks + time parse (svc:132-141). |
| Server-authoritative revalidation | COVERED | preview endpoint + submit re-runs (svc:29,40). |
| Address geocoding at preview | GAP | Live path needs lat/lng (tblBulkJob PickUp/Delivery Latitude/Longitude are populated by geocoder). Without it, promotion cannot succeed. |
| Postcode format sanity | GAP | Just stored as int. NZ = 4 digit, US = 5 or ZIP+4 (9 digit with dash). "12345-6789" would parse to NaN and be dropped. |
| Date parsing (multiple formats) | PARTIAL | tsx:173-192 accepts 3 shapes. Ambiguous mm/dd vs dd/mm not disambiguated - a NZ operator pasting 03/07/2026 would land as 3 July, but the same file re-imported by a US operator lands as March 7. No locale hint. |
| Time parsing | PARTIAL | tsx:193-204 covers HH:mm, HH:mm:ss, HHmm. Doesn't handle 12-hour "7:00 AM" strings common in US Excel exports. |
| Client lookup (name -> ClientId) | GAP | Shadow just stores `Client` as a string. tblBulkJob wants ClientId (int FK to tucClient). Blocks promotion. |
| Speed lookup (name -> SpeedId) | GAP | Shadow stores `Speed` as string. tblBulkJob wants Speed as int (FK to tucSpeed). Blocks promotion. |
| Vehicle size lookup | GAP | Same. |
| Suburb split (single Suburb column -> From/To) | GAP | Shadow has ONE Suburb + ONE PostCode column. tblBulkJob has From* AND To* variants. Ambiguous today - the mapping assumes single-pickup jobs. |
| Duplicate detection within file (by Reference) | GAP | Two rows with the same Reference both land in the shadow table. |
| Duplicate detection against existing shadow rows | GAP | Same ImportSetCode + Reference is not enforced unique. |
| Duplicate detection against live tblBulkJob | GAP | No cross-check. |
| Weight / cubic sanity check | GAP | Negative or extreme values accepted silently. |
| Address non-empty length check | GAP | Only checks null / empty. A single-char "-" would pass. |

### D. Preview + edit

| Feature | Status | Notes |
|---------|--------|-------|
| Preview grid | COVERED | tsx:421-464. |
| Preview all rows (pagination) | GAP | Hard cap at 50 (tsx:59). Operator uploading 500 rows only sees first 50. |
| Inline edit | GAP | Read-only grid. Correcting a bad row requires editing the CSV and re-uploading. |
| Sort / filter rows | GAP | Fixed row order. |
| Highlight problem rows | COVERED | `bg-error/5` + tooltip with problems (tsx:444-445). |
| Filter by "problems only" toggle | GAP | Operator scrolls to find. |
| Column visibility toggle | GAP | Fixed 11 columns; some target fields (Cubic, Items, Speed, VehicleSize, Notes) not shown at all. |

### E. Submission

| Feature | Status | Notes |
|---------|--------|-------|
| Writes to shadow table `tblBulkImportJob` | COVERED | svc:38-75. |
| Promote to live `tblBulkJob` | GAP - **P0** | This is the whole reason bulk-import exists. Today the shadow is a dead-end audit table. Requires new SP `UTL_stpBulkImportJob_PromoteToTblBulkJob` OR EF-Core-native promotion service. Impedance mismatch: needs client resolve, speed resolve, geocode, suburb split. |
| Promote to live `tucJob` directly | N/A | tblBulkJob is the intermediate - once rows are there, the existing RunBuilder flow handles the rest via UTL_stpJob_InsertFromRunBuilder. |
| Partial success (accept valid, reject invalid) | COVERED | svc:41-42, only valid rows inserted. |
| Progress indicator for large imports | GAP | Toast fires only after completion. A 10k-row insert will silently hang the UI. |
| Download success report as CSV | GAP | No export button. |
| Download error report as CSV | GAP | Rejections shown in-app but not exportable. |
| Transactional rollback ("all or nothing") | GAP | AddRange + SaveChanges is one transaction, but there is no operator-toggle for "reject the whole batch if any row fails". |
| Idempotency (double-submit protection) | GAP | If operator clicks Import twice fast, two batches with the same ImportSetCode are inserted; no unique constraint on ImportSetCode. |
| Batch size cap | GAP | POST body is uncapped. 100k rows would OOM the server. |
| Async / background job for large uploads | GAP | Synchronous request/response only. |
| Retry-safe (server has SaveChanges failure recovery) | GAP | SaveChanges throws bubble up unhandled; frontend sees generic error toast. |

### F. Import history / audit

| Feature | Status | Notes |
|---------|--------|-------|
| List past import sets | COVERED | GET /sets (ctrl:22-26). |
| Show row / invalid counts | COVERED | Set summary (ts:52-56). |
| Show upload timestamp | COVERED | `lastUploadedUtc`. |
| Show WHO uploaded (audit trail) | GAP | Entity has no CreatedBy field. Compliance risk in multi-operator tenants. |
| View rows of a past import set | GAP | List only; no drill-in endpoint. |
| Edit rows of a past import set | GAP | Would need PATCH endpoint. |
| Re-run validation on a past set | GAP | Would need re-preview endpoint targeting stored rows. |
| Delete import set | COVERED | DELETE endpoint (ctrl:52-56). |
| Promote a past set to live jobs | GAP - **P0** | The whole missing piece. |
| Track promotion state (Promoted / Failed / Not yet) | GAP | Would need PromotedAt + PromotedBulkJobId columns on entity. |
| Retention policy (auto-purge sets older than N days) | GAP | Table will grow unbounded. |

### G. Admin / auth

| Feature | Status | Notes |
|---------|--------|-------|
| Policy gate on controller | COVERED | `RouteBuilder.Admin` (ctrl:17). |
| Actual admin scoping | PARTIAL | The policy at `Program.cs:174-183` admits UserGroupID=1 OR any non-courier tenant user. Effectively ANY authenticated operator, not admins. Fine for now but worth flagging. |
| Tenant scoping | PARTIAL | `Context` factory is tenant-aware (all EF reads/writes go through DynamicDespatchDbContext). But there is no tenant column on `tblBulkImportJob` - it lives in the tenant DB so multi-tenancy is inherent. OK. |
| Per-tenant rate limiting | GAP | Nothing stops an operator uploading 20 100k-row batches. |
| Audit log of admin operations | GAP | Serilog "Bulk-import set {Set}: inserted {N}" (svc:77-78) is the only trail. |

### H. Edge cases + UX polish

| Feature | Status | Notes |
|---------|--------|-------|
| Empty file | PARTIAL | tsx:127-130 checks header.length === 0, shows toast. But a file that is JUST whitespace parses to header=['']. |
| Headers-only, no data | GAP | Uploads with 0 rows; submit hits controller which returns 400 "No rows in request" (ctrl:34). Reasonable but silent client-side. |
| Non-CSV file | COVERED | Regex reject at tsx:116-118. |
| Malformed CSV (unmatched quote) | PARTIAL | `parseLine` swallows the malformed line silently - `inQuotes` stays true through EOL. No user-facing warning. |
| Very large file (>10k rows) | GAP | Client-side memory + server payload risk. |
| Network failure mid-submit | PARTIAL | Toast fires (tsx:286) but no retry, no local persistence of the parsed data - operator has to re-upload. |
| Session timeout during upload | GAP | Request would 401; toast fires with the raw error. |
| Cancel / abort in-progress upload | GAP | No cancel button; no AbortController. |
| Character-encoding preview / warning | GAP | Silent mojibake. |
| Undo delete of a set | GAP | Delete is hard. |
| Keyboard shortcut (Enter to submit) | GAP | Mouse only. |
| Import a set from a URL | GAP | SetUpDashboard supports Google Sheets URL. |
| Template CSV download | GAP | SetUpDashboard has GET template/{entityType}. Operator has to hand-craft headers today. |

---

## Section 3: Prioritized gap list

### P0 - blocks operator from using it for real

| Gap | Files to touch | Complexity | Migration / SP |
|-----|----------------|------------|----------------|
| **Promotion path from `tblBulkImportJob` -> `tblBulkJob`** | New: `BulkImportPromotionService.cs`, `PromoteAsync` endpoint on `BulkImportController.cs`. Frontend: add "Promote" button per set in `BulkImport.tsx`. Extend `TblBulkImportJob.cs` with `PromotedUtc DATETIME2 NULL`, `PromotedBulkJobId INT NULL`, `PromotedByUser NVARCHAR(100) NULL`. | L | YES. Add columns to `tblBulkImportJob` (new migration). Recommend NEW C# service (EF Core + Dapper) that hydrates each shadow row into a tblBulkJob insert - avoid a new SP so the promotion logic is code-reviewable. If SP is preferred, `UTL_stpBulkImportJob_PromoteToTblBulkJob` following the shape of `UTL_stpJob_InsertFromRunBuilder`. Needs: geocode addresses, resolve Client name -> ClientId, resolve Speed name -> Speed int, split Suburb -> From/To. |
| **Client / Speed / VehicleSize FK resolution** | `BulkImportService.cs` `ValidateRows` (new lookup step); `BulkImportRow` DTO gets resolved `ClientId`, `SpeedId` companion fields. | M | Lookups against tucClient + tucSpeed via `Context`. Warn in preview if name is ambiguous or missing. |
| **Address geocoding at preview** | New: reuse `GoogleDirectionRepository` pattern from legacy RunBuilder OR call HERE Maps geocoder used elsewhere in RoutedOperations (`heremap` libs in `wwwroot/scripts/libs/heremap`). Integrate into preview so bad addresses are flagged BEFORE promote. | L | No SQL. External API integration; requires HERE Maps / Google key. |
| **CreatedBy audit column** | Migration + entity + service. `BulkImportService.SubmitAsync` reads from `HttpContext.User`. | S | Add `CreatedBy NVARCHAR(100) NULL` to `tblBulkImportJob`. |

### P1 - essential completeness

| Gap | Files to touch | Complexity | Migration / SP |
|-----|----------------|------------|----------------|
| **XLSX support** | Add ClosedXML nuget to `RoutedOperations.csproj`. New `POST /api/bulk-import/parse` multipart endpoint returning normalised rows + headers. Frontend switches from client-side parse to server-side for xlsx (keeps CSV client-side for zero-round-trip). | M | No. |
| **BOM stripping + encoding sniff** | `parseCsv` (tsx:525) or move parse fully server-side. Handle 0xEF 0xBB 0xBF; detect Windows-1252 via BOM absence + high-byte density. | S | No. |
| **Delimiter auto-detect** | Sniff first row for `,`, `;`, `\t`. Preview shows detected delimiter. | S | No. |
| **Dedupe within file (by Reference)** | `ValidateRows` - track seen References, flag second+ occurrence. | S | No. |
| **Dedupe against live jobs (by Reference)** | New EF query at preview time: exists in tblBulkJob where JobNumber == row.Reference AND BookDate == row.BookedDate. Optional strictness level. | S | No; consider index on tblBulkJob(JobNumber, BookDate) if not already there. |
| **Dedupe against shadow (unique ImportSetCode + Reference)** | Add unique index `IX_tblBulkImportJob_SetCode_Reference` to migration. | S | YES (new migration). |
| **Preview: pagination + show all rows** | `BulkImport.tsx` - lift `PREVIEW_LIMIT`, add paginator or windowed grid. Server GET `/api/bulk-import/sets/{code}/rows` for past-set drill-in. | M | No. |
| **Inline edit of preview rows** | `BulkImport.tsx` - swap `<td>` for controlled `<input>` on click; re-run validation on change. | M | No. |
| **Download error report as CSV** | `BulkImport.tsx` add "Download failed rows" button that serialises rejections + problems back to CSV. | S | No. |
| **Progress indicator + batch chunking for large imports** | Chunk mappedRows into 500-row POST batches; show progress bar. | M | No. |
| **Idempotency: unique ImportSetCode enforcement or fingerprint** | Frontend disables Import while `submitting`; server rejects duplicate ImportSetCode (or appends `-N` suffix). | S | No; possibly unique index. |
| **View-rows-of-past-set endpoint + drill-in** | New GET `/api/bulk-import/sets/{code}/rows` returning paged rows. Frontend clickable set list. | M | No. |
| **12-hour AM/PM time parsing** | `readTime` (tsx:193) + `ParseTime` (svc:147). Regex for `\d{1,2}:\d{2}\s*(AM\|PM)`. | S | No. |
| **Ambiguous date locale hint** | Add tenant-scope hint (NZ=dd/mm, US=mm/dd) from claims or a UI toggle. | S | No. |

### P2 - nice-to-have

| Gap | Files to touch | Complexity | Migration / SP |
|-----|----------------|------------|----------------|
| **Save mapping as template + reuse** | New table `tblBulkImportMappingTemplate` (Id, TenantScope, Name, MappingJson, CreatedBy, CreatedUtc). CRUD endpoints. Frontend "Load template" dropdown. | M | YES (new migration). |
| **Drag-and-drop upload** | `BulkImport.tsx` add ondrop / ondragover handlers around the upload panel. | S | No. |
| **Multiple file batch upload** | Loop over files, share ImportSetCode across them. | S | No. |
| **Template CSV download** | New GET `/api/bulk-import/template.csv` returning the expected headers. | S | No. |
| **Confidence score display on mappings** | Adopt FuzzySharp; render red/yellow/green badges. | M | No; new dep. |
| **Competitor-TMS format detection** | Port heuristic from SetUpDashboard's `SmartUploaderService`. | L | No. |
| **Cancel in-progress upload** | AbortController wiring. | S | No. |
| **Retention policy** | Nightly job (or on-demand button) delete sets older than N days. | S | No. |
| **Sort + filter preview grid** | Table state in BulkImport.tsx or introduce react-table / TanStack. | M | No. |
| **Google Sheets URL upload** | Server-side fetch via Google Sheets API. | M | No; API key. |

### P3 - polish

| Gap | Files to touch | Complexity | Migration / SP |
|-----|----------------|------------|----------------|
| **Weight / cubic sanity bounds** | `ValidateRows` bounds check (>0, <max). | S | No. |
| **Column visibility toggle in preview** | Chip toggles above table. | S | No. |
| **Keyboard shortcuts (Ctrl+Enter to import)** | React hotkey. | S | No. |
| **Better empty-file / whitespace-only detection** | Strengthen `parseCsv` guard. | S | No. |
| **Malformed-CSV warning banner** | Track unmatched-quote lines and surface. | S | No. |
| **Undo-delete window (soft delete)** | Add `DeletedUtc` column and 30-day recovery. | M | Yes. |

---

## Section 4: Design decisions the coding agent needs answered

Each decision includes a recommended default so the coding agent can proceed
without blocking on a user reply.

### D1. Promotion strategy: SP vs C# service

**Question:** When promoting `tblBulkImportJob` rows into `tblBulkJob`, wrap
in a new SP `UTL_stpBulkImportJob_PromoteToTblBulkJob` OR build a C# service
that does EF Core + Dapper inserts?

**Recommendation:** **C# service.** Rationale:
- Promotion needs external calls (geocoder) which SPs cannot do cleanly.
- Legacy `UTL_stpJob_InsertFromRunBuilder` is 140-column, hard to review;
  new logic should not perpetuate that pattern.
- C# lets validation results, promotion outcomes, and rollback all live in
  one auditable transaction scope.
- Follow-up SP call at the end for the tblBulkJob insert row(s) is fine if
  needed for schema consistency, but the orchestration stays in C#.

### D2. Promotion trigger: automatic on submit vs explicit two-step

**Question:** Should submit-to-shadow AND promote-to-live happen in one
click, or should promote be a separate button on the set summary?

**Recommendation:** **Two-step.** Rationale:
- Aligns with the current safety-first pattern (shadow-only today).
- Operator can eyeball the shadow rows in a drill-in view, fix any bad
  addresses, then promote.
- One-click "upload and go" can be layered later as a checkbox on the
  Import panel.

### D3. Client / Speed / VehicleSize lookup strictness

**Question:** If a shadow row references an unknown Client, should promote
(a) fail the row, (b) create a placeholder tucClient, (c) prompt operator
to map name -> ClientId at promote time?

**Recommendation:** **(c) prompt at promote time**, falling back to (a) if
operator skips. Rationale:
- (b) leaks bad clients into live data.
- (a) surprises operators who thought they were ready.
- (c) is the same pattern SetUpDashboard uses for smart-mapping.
- MVP: implement (a) with a clear error toast citing the exact row +
  missing client; iterate to (c) once the promote flow is live.

### D4. Duplicate detection scope

**Question:** Dedupe by (a) Reference only within the current file, (b)
Reference + BookedDate against tblBulkJob, or (c) both?

**Recommendation:** **Both, warn not block.** Rationale:
- Same Reference twice in a file is almost always a mistake - flag as
  warning, let operator resolve.
- Same Reference + BookedDate already in tblBulkJob is almost always a
  re-import of a batch the operator forgot they ran - warn hard, offer
  "force overwrite" toggle for edge cases.
- Never silently drop - always surface.

### D5. Geocoding: preview-time vs promote-time

**Question:** Geocode addresses at preview (slow, expensive, comprehensive)
or at promote (invisible to operator until failure)?

**Recommendation:** **Promote-time by default, with an operator-triggered
"Geocode now" button on preview.** Rationale:
- Geocoding 1000 addresses on every preview is wasteful during iteration.
- Explicit button gives operator control over cost.
- Promote-time geocode failures surface as row-level errors in the promote
  result panel.

### D6. Batch cap + async threshold

**Question:** What row count triggers async / background processing vs
synchronous request?

**Recommendation:** **500 rows synchronous, > 500 chunked with progress
bar, > 5000 rejected with "please split" error.** Rationale:
- 500 rows in a single POST is well under IIS default request limits.
- Chunked 500-row batches with progress feels responsive up to a few thousand.
- Anything above that is either a data-migration event (do it manually) or
  a runaway operator mistake.

### D7. Import-set ownership + audit

**Question:** Should ImportSetCode be unique per-tenant-per-set, or
per-tenant-per-operator?

**Recommendation:** **Per-tenant unique.** Rationale:
- Two operators uploading "Acme-2026-07-22" should conflict, not silently
  double-import.
- Add `CreatedBy` audit column regardless so we know who ran it.
- Server appends `-2` / `-3` suffix on collision as a soft-conflict UX.

### D8. Retention policy

**Question:** Auto-purge shadow sets after N days?

**Recommendation:** **Yes, 90 days, soft-delete first.** Rationale:
- Shadow table will grow indefinitely otherwise.
- 90 days is enough for month-end reconciliation.
- Soft-delete gives 30-day undo window in a follow-up.

### D9. XLSX support: client-side (sheetjs) vs server-side (ClosedXML)

**Question:** Parse XLSX in the browser (adds ~500 KB to bundle) or on the
server (already have ClosedXML precedent in SetUpDashboard)?

**Recommendation:** **Server-side.** Rationale:
- Bundle size matters more than a 1-second parse round-trip.
- ClosedXML in .NET is already proven in SetUpDashboard and handles
  smart-header-detection.
- Frontend stays simple: same upload endpoint, server hands back headers
  + rows in the existing shape.

### D10. RouteBuilder.Admin scoping

**Question:** Keep the current policy (effectively any authenticated
tenant operator) or narrow to a true admin subset?

**Recommendation:** **Keep for MVP, add TODO note.** Rationale:
- Bulk import is a legitimate operator action, not admin-only.
- The name `RouteBuilder.Admin` is misleading given its actual permissive
  behaviour, but that's a broader policy-rename discussion.
- Post-MVP, consider a `RouteBuilder.Import` policy for granular gate.

---

## Surprises worth flagging

1. **The migration has not been applied yet.** PARITY-TRACKING.md line 331
   says "NOT APPLIED - user to run manually." The service+controller compile
   and pass DI but the first end-to-end request will fail with "Invalid
   object name 'tblBulkImportJob'" until the user runs the SQL. The coding
   agent should NOT assume the shadow table exists in any tenant DB.

2. **`GetSetsAsync` has a dead branch.** `Invalid` count in `svc:100`
   filters for `ValidationStatus != "Ok"`, but every inserted row is written
   with `"Ok"` at `svc:67`. The invalid count on the summary API will always
   be zero. Either drop the column from the summary DTO or write real
   validation snapshots into the shadow. Recommend: fold this into the P0
   audit-columns migration and record `"Ok"` OR the semi-colon list of
   problems, so operators can see WHY a past batch had failures.

3. **Impedance mismatch is worse than the file suggests.** The BulkImport
   comment "the server-side contract is happy to accept the same row shape
   from either source when we're ready" (tsx:19) understates the promote
   gap. Shadow has 16 loose primitives; `tblBulkJob` has ~90 columns
   including lat/lng, FK to tucClient, FK to tucSpeed, split From/To
   suburb+postcode, contact metadata, region, drop-off location, etc. The
   promotion service is L complexity, not S.

4. **Suburb is single-column but tblBulkJob wants From AND To.** Today the
   mapping suggests a delivery-only shape (no pickup suburb, no pickup
   postcode). If bulk-import supports pickup+delivery pairs on a single row
   (the norm in courier ops), the shadow needs `PickupSuburb`,
   `PickupPostCode`, and probably `PickupLat/Long`, `DeliveryLat/Long`. This
   is worth clarifying with the user before extending the shadow schema.

5. **No LaTeX-like round-trip cache after failure.** If submit fails mid-way
   (network drop, session expiry), the operator loses the parsed CSV state
   and has to re-upload. Small localStorage cache of the last-parsed file +
   mapping would save a lot of frustration. P2 polish, but easy win.

6. **`RouteBuilder.Admin` in Program.cs:174-183 is effectively "any
   non-courier tenant user", not admin-only.** UserGroupID=1 gates a fast
   yes, but the fallback lets everyone in. Not a BulkImport-specific issue,
   but worth flagging so a future policy tightening doesn't accidentally
   lock operators out of bulk import.

---

## Loop 2 Findings - BulkImport convergence check

Audit date: 2026-07-22 (post pass 2 sweep)
Auditor: discovery agent (independent read-only convergence pass)

### Section 1: New bugs found

#### P1 bugs (worth fixing before ship)

| ID | Severity | Location | Description | Suggested fix |
|----|----------|----------|-------------|---------------|
| L2B.1 | P1 | `BulkImportService.cs:304-312` (UpdateRowAsync reval) | Every inline edit re-runs `ValidateRowsAsync` with the row's own ImportSetCode. The reval query pulls existing References in the set - which includes THIS row itself. The single-row loop then flags the just-edited row as `"Reference already exists in this import set"` and stamps `ValidationStatus` to that error. Result: editing ANY field on a Pending row silently flips it to Failed, even when nothing about Reference changed. Guaranteed repro: edit a `Notes` field, save, drill in - row shows as failed with a bogus dedupe error. | Either (a) pass a `skipSelfRowId` int? through `ValidateRowsAsync` so the same-set dedupe check excludes that PK, or (b) build a lightweight `ValidateSingleRowAsync` that skips the existing-set query entirely (the unique-index still catches an actual collision at save time). Option (a) is safer because it preserves the live-jobs dedupe warning. |
| L2B.2 | P1 | `BulkImportPromotionService.cs:47-233` | No concurrency guard on `PromoteAsync`. Two operators (or a single operator double-clicking Promote) both enter the loop, both call `Context.TblBulkImportJobs.Where(x => x.PromotedUtc == null).ToListAsync()`, both see the SAME pending rows. Both then geocode, both `Context.TblBulkJobs.Add(bulkJob)`, both `SaveChanges` - and because `tblBulkJob.JobNumber` has no unique constraint (verified in `TblBulkJob.cs`), you get duplicate live jobs with matching JobNumber values. `PromotedBulkJobId` on the shadow row ends up pointing at whichever insert wrote last. HERE quota also gets double-billed. | (a) Take a pessimistic app-lock at the start of Promote: `EXEC sp_getapplock @Resource = 'bulkimport-promote-' + @setcode, @LockMode='Exclusive'`, or (b) add `[ConcurrencyCheck] byte[] RowVersion` to `TblBulkImportJob` and re-check `PromotedUtc IS NULL` inside a transaction per row. (a) is simplest and matches how legacy dispatch guards similar batch ops. Also: frontend should disable the Promote button while `promoting` is true (already true via `disabled={promoting}` at BulkImport.tsx:776 - but a second tab has no such gate). |
| L2B.3 | P1 | `BulkImportParseService.cs:172-177` (ParseXlsx) | Header row read is `rows[0].Cells()` - ClosedXML returns only cells that ClosedXML considers "used", which for a sparse header row skips blank cells silently. Header row `A1=Reference / B1=Client / C1=(blank) / D1=Address` yields `header.Count == 3`. Then `rows[r].Cells(1, header.Count)` reads columns 1-3 for every data row - the entire `Address` column at D is discarded. Operator sees a preview missing a whole column with no warning. | Use `sheet.LastColumnUsed().ColumnNumber()` to get the true right edge, then `rows[0].Cells(1, lastCol).Select(c => c.GetString().Trim())` to read the header (filling blanks with empty string), and iterate data rows over the same `[1..lastCol]` range. Filter trailing all-blank header columns before returning. |
| L2B.4 | P1 | `BulkImportParseService.cs:155-195` (ParseXlsx) - no cell / row cap | The 25 MB `RequestSizeLimit` at `Program.cs:142` gates raw upload bytes but a compressed XLSX at 5 MB can expand to millions of cells. `ClosedXML` loads the entire workbook into memory; a malicious or malformed sheet with a formula fill-down to row 1,000,000 will OOM the process. `RoutedOperations` is multi-tenant so one tenant's ~2GB parse pins the shared pool. | Post-load check: `if (rows.Count > HARD_ROW_CAP) throw new InvalidOperationException(...)`. Reuse `MaxRowsPerSubmit = 5000` from `BulkImportService.cs:42` (or a smaller parse-side cap like 20000 to allow rejecting-after-preview UX). |
| L2B.5 | P1 | `BulkImportService.cs:335-360` (AllocateSetCodeAsync) | TOCTOU race between the `takenSet` snapshot query and the eventual INSERT. Two concurrent submits with the same base `ImportSetCode` (two operators pasted "Acme-2026-07-22" simultaneously) both see the code as free, both proceed with the SAME setCode. Their rows silently merge into one logical set instead of getting the `-2` suffix design D7 promised. The `UX_tblBulkImportJob_SetCode_Reference` unique index only catches the case where the two batches share a Reference. Different References -> silent merge. | Wrap allocation + first-row-insert in a transaction with `SERIALIZABLE` isolation, OR add a unique-per-tenant index on `ImportSetCode` alone (rows-existing check becomes constraint-driven, and the service retries the next suffix on 2601). Simplest: `sp_getapplock @Resource = 'bulkimport-alloc-' + @baseCode` before the check + first insert. |

#### P2 bugs (nice to fix)

| ID | Severity | Location | Description | Suggested fix |
|----|----------|----------|-------------|---------------|
| L2B.6 | P2 | `BulkImport.tsx:414-428` (openHistory) | Race on rapid set-switching: clicking set A then set B fires two `getRows()` in flight. If A's response arrives after B's, `setHistoryRows` overwrites B's rows with A's data, but `historyOpen` state still says B - operator sees wrong-set rows. | Guard with a request token: `const token = ++historyTokenRef.current; if (token !== historyTokenRef.current) return;` after the await, before `setHistoryRows`. Same pattern already exists in `GoogleMap.tsx drawRunPolyline` per PARITY-TRACKING P1.12. |
| L2B.7 | P2 | `HereGeocodeService.cs:23-84` | No timeout / retry / circuit breaker configured. Uses stock `HttpClient` from bare `AddHttpClient()` (Program.cs:194). Default timeout is 100s. A stalled HERE endpoint hangs the whole promote loop - 1000 pending rows would sit for 27 hours worst-case. No Polly retry means intermittent 5xx from HERE fails the row permanently on first attempt. | Register a NAMED `HttpClient` via `AddHttpClient<HereGeocodeService>(...)` with `Timeout = 10s`, plus `.AddPolicyHandler(Policy.Handle<...>().WaitAndRetryAsync(3, ...))`. Also add a short in-service in-memory cache (5-min TTL) keyed by normalised address so repeat rows sharing an address don't triple-hit HERE. |
| L2B.8 | P2 | `BulkImport.tsx:137-141` | No client-side file size gate. Server rejects >25MB with a 413 that surfaces as a raw `HTTP 413` error toast (per api.ts:24). User has no idea why upload failed. | Add `if (f.size > 25 * 1024 * 1024) { toast.show('File too large - max 25MB', 'error'); return; }` at the top of `handleFile`. |
| L2B.9 | P2 | `BulkImport.tsx:390-410` (downloadErrorsCsv) | The errors CSV only includes rows that failed CLIENT-side validation (from `validation.problems`, populated by `doValidate`). Rows that ONLY have WARNINGS (dedupe-vs-live, unknown client) are excluded from the export because `validation.problems.get(i)` returns undefined for warning-only rows. Operators debugging why a batch is "50 warned" have nothing to download. | Add a second button "Download warnings" that walks `validation.warnings` in the same shape, OR extend the current export to include warned rows with a "Severity" column. |
| L2B.10 | P2 | `BulkImportService.cs:203-218` (DeleteSetAsync) | Soft-delete is documented as reversible ("clearing DeletedUtc"), but there's no UI to undo. Operator who mis-clicks Delete has to raise a ticket. Two-click confirm at `BulkImport.tsx:378` is the only guard. | Add `POST /api/bulk-import/sets/{code}/restore` that clears `DeletedUtc` where it's non-null. Frontend: 5-second toast with "Undo" button after delete. |
| L2B.11 | P2 | `BulkImportService.cs:503-539` (LookupKnownClientsAsync + siblings) - fetches ENTIRE tables | The `names` argument is passed in but never used inside the query. `SELECT ucclName, ucclCode FROM tucClient` pulls every row (US tenants have 4k+ clients). Same pattern in `LookupKnownSpeedsAsync` / `LookupKnownVehiclesAsync`. Called on EVERY preview + EVERY submit + inside `UpdateRowAsync` reval - so a per-row inline edit hits 3 full-table fetches. | Filter server-side with a Dapper `WHERE Name IN @names OR Code IN @names` (or LINQ `.Where(c => names.Contains(c.UcjtName))`). Fewer bytes over the wire, and the `Distinct(StringComparer.OrdinalIgnoreCase)` on the caller side already caps `names.Count`. |
| L2B.12 | P2 | `BulkImport.tsx:390-395` | `downloadErrorsCsv` uses `validation` state that goes stale after a successful submit (submit doesn't re-run preview) - so the "Download errors" button reflects the PRE-submit validation, not the actual server-side rejections that arrived in `submitResult.rejections`. Operator downloads errors for rows they might have already fixed. | After submit, either (a) clear `validation` state and disable the download button, or (b) source the errors from `submitResult.rejections` instead of `validation` when a submit has completed. |
| L2B.13 | P2 | `BulkImportPromotionService.cs:69-233` (PromoteAsync main loop) | No cancellation support - the loop runs to completion even if the operator navigates away or the browser drops. On a 5000-row set with 500ms/geocode + 200ms/insert, that is ~1 hour of unstoppable work per invocation. | Accept an optional `CancellationToken` on `PromoteAsync`, pass it through to `SaveChangesAsync` and `geocode.GeocodeAsync`. Wire it to `HttpContext.RequestAborted` at the controller. |

#### P3 (polish, no operator impact)

- L2B.14 `BulkImport.tsx:530-544` no visual indicator that server auto-detected locale differs from operator's radio choice.
- L2B.15 `BulkImportService.cs:132-146` retry-per-row branch on duplicate-key failure logs but does NOT surface which rows were rejected back to the operator - `inserted` count updates but `rejections` list is not appended to.
- L2B.16 `BulkImport.tsx:659-687` preview table's `truncate max-w-32` on address columns can silently hide the trailing suburb / postcode when address is >32ch, obscuring "why does this row look wrong".
- L2B.17 `BulkImportParseService.cs:47` splits on `\n` after normalising `\r\n` - old-Mac CR-only line endings (`\r`) fall through untouched, so a file exported from legacy Mac Excel parses as ONE giant row.
- L2B.18 `BulkImport.tsx:585` "Validate rows" button is `disabled={validating || mappedRows.length === 0}` but NOT disabled when required fields are missing - operator can still click and see the same 4 errors on every row. Confusing.
- L2B.19 `BulkImportController.cs:73` `[AllowAnonymous]` on template.csv download - fine because content is static, but consider tightening once the header set is tenant-specific.

### Section 2: New missed features

#### P1 features (worth adding before ship)

| ID | Priority | Feature | Complexity | Files to touch |
|----|----------|---------|------------|----------------|
| L2F.1 | P1 | Persist geocoded coords back to the shadow row after promote | S | `TblBulkImportJob.cs` + migration: add `PickupLat/Lng/DeliveryLat/Lng` (nullable). `BulkImportPromotionService.cs:210-213` writes them alongside `PromotedUtc`. Rationale: re-running promote today re-geocodes every row that failed the first time (e.g. FK resolve). With coords cached, retries skip HERE. |
| L2F.2 | P1 | Server-side pre-check on file size + row count BEFORE parse work | S | `BulkImportController.cs Parse` - check `file.Length` explicitly + return actionable error. `BulkImportParseService.Parse` - cap ClosedXML row count post-load. |
| L2F.3 | P1 | Progress feedback for promote (currently silent 1-hour black box on large sets) | M | Server: SignalR stream OR polling endpoint that returns `(promoted, failed, remaining)` for a set. Frontend: promote button opens progress modal, polls every 2s. |

#### P2 features

| ID | Priority | Feature | Complexity | Rationale |
|----|----------|---------|------------|-----------|
| L2F.4 | P2 | Mapping templates (was L in original audit, is actually M) | M | Pattern for a shadow-table CRUD already exists as `TblQuoteRun` / `TblBulkImportJob`. Add `TblBulkImportMappingTemplate` table + `POST/GET` on new controller. Frontend adds a "Load template" dropdown above the mapping panel and a "Save current mapping" button. |
| L2F.5 | P2 | Sort/filter grid in preview (was M) | M | `Quoting.tsx` already has sortable columns; copy `useMemo(() => sortRows(rows, sortKey, sortDir))` pattern. Adds ~40 lines to `BulkImport.tsx`. |
| L2F.6 | P2 | Fuzzy-match confidence badges on mapping dropdown (was M) | M | Add `FuzzySharp` package + score header vs each target's aliases, render green (>90) / yellow (>60) / red (>0) chip next to each dropdown. Matches SetUpDashboard smart-import convention. |
| L2F.7 | P2 | Retention purge job (was P2 deferred, still needed) | S | `IHostedService` firing daily at 02:00 UTC deleting shadow rows where `DeletedUtc IS NOT NULL AND DeletedUtc < DATEADD(day, -30, GETUTCDATE())` OR `CreatedUtc < DATEADD(day, -90, GETUTCDATE())`. Registered in Program.cs alongside `EfModelWarmupService`. |
| L2F.8 | P2 | Success toast + explicit summary after promote ("Promoted 47 rows, 3 skipped, 0 failed") - currently only appears in a fine-print modal footer | S | Already have `promoteResult` state - just also emit `toast.show(msg, 'success')` with the counts (already done - line 443-445, but the count is displayed as text not celebrated with color / icon). |
| L2F.9 | P2 | Pass tenant `countryCode` through to `HereGeocodeService` | S | `BulkImportPromotionService` reads `httpContextAccessor.HttpContext?.User.FindFirst("Region")?.Value` (or the tenant hint claim used by `AuthContext.isUsTenant`) and passes `"NZL"` / `"USA"` through to both geocode calls. Aligns with L2.P2.1 fix on FixGpsModal in pass 3. |

### Section 3: Confirmations of coverage (verified truly done)

- **X-Requested-With CSRF header** correctly sent by both `api.ts request()` (line 14) and the raw `parseFile` fetch (bulkImportService.ts:177). No gap.
- **Idempotency dedup** in `SubmitAsync` via `IMemoryCache` correctly keyed and TTL-bounded (BulkImportService.cs:67-75, 156-159). Confirmed working for double-click submit within 5 min.
- **Chunked submit** correctly shares one idempotency root + per-chunk suffix (BulkImport.tsx:325, 348) - server treats each chunk as its own dedup unit, so a mid-batch retry of chunk 4 doesn't re-import chunks 1-3.
- **Soft delete** filters properly propagate: every `Where(x => x.DeletedUtc == null)` present in `GetSetsAsync` (line 170), `GetRowsAsync` (line 230), `DeleteSetAsync` (line 208), `UpdateRowAsync` (line 270), `PromoteAsync` (line 50). No missing predicate.
- **PATCH semantics** in UpdateRowAsync consistently `req.X ?? row.X` per field (BulkImportService.cs:283-298). No accidental clobber.
- **Promote idempotency** (skipping already-promoted rows) is correct in the single-invocation case (BulkImportPromotionService.cs:72-79). Only breaks in concurrent invocations - see L2B.2.
- **Client-side reference dedupe** in `ValidateRowsAsync` correctly reports the FIRST occurrence's row number, not the current one (BulkImportService.cs:471-474).
- **Migration idempotent guards** using `IF NOT EXISTS` on both ALTER + CREATE INDEX are correct (migration:93-105, 108-145) - partial re-apply is safe.
- **12-hour time parsing** handles `9:30am`, `9:30 AM`, `21:30`, `HHmm`, `HHmmss`, `HH:mm:ss` correctly per unit reads (BulkImportService.cs:549-586).
- **HTTP retry-loop fix** (useEffect deps dropped for loadSets at BulkImport.tsx:112-116) is correctly in place with an accurate eslint-disable comment.
- **File-type gate** at BulkImport.tsx:139 accepts .csv / .xlsx / .xlsm and rejects all others - matches server accept-list at BulkImportController.cs:58-63.
- **Auth policy** `RouteBuilder.Admin` applied at class level on BulkImportController; only `template.csv` overrides with `[AllowAnonymous]` (harmless).
- **Positional record arg order** in `BulkImportService.UpdateRowAsync` line 304-308 matches `BulkImportRow` declaration - no shifted args (16 fields, correct order).

### Section 4: Convergence verdict

**NOT converged - 5 P1 bugs + 3 P1 features found (13 items total including P2s).**

The pass-2 testing round was green end-to-end for the HAPPY PATH scenarios (one operator, one file, small batch). The bugs surfaced by this convergence pass are all concurrency / edge-case / operator-error paths that a single-user Playwright run does not exercise:

- **Inline edit -> auto-fail** (L2B.1) is the most user-visible and highest-priority - it will bite the first operator who edits a row and drills back in.
- **Concurrent promote** (L2B.2) is a data-integrity risk that produces silent duplicate live jobs.
- **XLSX sparse-header + no row cap** (L2B.3, L2B.4) are file-format edge cases that will bite a real customer within weeks.
- **AllocateSetCode race** (L2B.5) is subtle but produces silently-merged batches that violate design D7.

Recommend a pass 3 targeted at these 5 P1 bugs + at minimum L2F.1 (cache geocoded coords) before declaring convergence. The P2 items can wait.

### Surprises worth flagging

1. The `UpdateRowAsync` reval bug (L2B.1) is a straight regression from pass 2 introducing "re-validate on edit". The pass 1 code path had no reval so the bug did not exist. The docs at BulkImportService.cs:300-303 acknowledge "same-set duplicate detection will see this row itself, so we skip it in the check below" - but the skip is not actually implemented. It's a TODO the author knew about but forgot to code.
2. The full-table client/speed/vehicle lookups (L2B.11) mean every keystroke-triggered validate on a big-tenant DB pulls 4000+ rows. Not a bug but a real UX regression for interactive editing.
3. `BulkImportPromotionService` does NOT pass `countryCode` to `HereGeocodeService` (L2F.9) despite the geocoder accepting it. This is a straight parity gap with the FixGpsModal country-restriction fix landed in pass 3 (L2.P2.1). Same tenant-hint plumbing.
4. Pass 2 successfully solved 90%+ of what the audit called out. The remaining gaps are almost entirely operational-safety concerns (concurrency, quotas, cancellation) rather than feature gaps - which is a healthy convergence signal even though I've listed them here.

---

## Loop 3 Findings - final convergence check

Audit date: 2026-07-22 (post pass 3 - third independent read-only sweep)
Auditor: discovery agent (Loop 3, converging on ship-readiness)

### Section 1: New bugs found

#### P1 bugs

| ID | Severity | Location | Description | Suggested fix |
|----|----------|----------|-------------|---------------|
| L3B.1 | P1 | `BulkImportPromotionService.cs:88` (`Progress` ConcurrentDictionary) | The in-memory promote-progress dictionary is a `static ConcurrentDictionary<string, PromoteProgress>` keyed ONLY on `importSetCode`. It is NOT tenant-scoped. Two tenants that both upload a set with a common human name ("Acme-2026-07-22", "Weekly-Run", "Import-1") and click Promote at the same time will collide: whichever writes second overwrites the first's tracking entry, and both tenants' polls read the mixed state. Additionally the dedupe guard at line 153 (`if (Progress.TryGetValue(importSetCode, out var existing) && !existing.Done)`) will silently drop tenant B's Promote call on the floor because tenant A already has an active entry with the same key. Tenant B's operator sees a 202 with a set count and a status URL that reports someone else's progress. The DB applock at line 253 is session-scoped and per-tenant (each tenant runs on its own DB connection), so this is a pure in-memory concurrency bug that ONLY manifests in the shared pod, not in the DB. | Key the dictionary on `(tenantId, importSetCode)` - either as a composite `string` (`$"{tenantId}:{importSetCode}"`) or as a `ValueTuple<string, string>`. Both `StartBackgroundPromote` and `GetProgressSnapshot` need to resolve the tenant from the same source (`CurrentTenantID` claim). Same fix applies to the applock resource name at line 254 for defence-in-depth (it is currently `bulkimport-promote-{importSetCode}`; adding tenantId prevents the cross-tenant unlikely-but-possible sp_getapplock naming collision on the shared server if two tenants happen to share a physical SQL instance). |
| L3B.2 | P1 | `BulkImportController.cs:173-180` (`PromoteStatus` endpoint) | Same root cause as L3B.1 exposed at the HTTP boundary: `GetProgressSnapshot(importSetCode)` accepts a set code from the URL and returns the in-memory entry with NO ownership check. An authenticated operator at Tenant A (any user who satisfies `RouteBuilder.Admin`, which is any non-courier authenticated user per Program.cs:177-186) can enumerate `/api/bulk-import/{arbitrary-code}/promote/status` and read Tenant B's `{importSetCode, total, completed, failed, pending, error, result: {rows: [{reference, bulkJobId, error}, ...]}}` - which leaks other-tenants' job References, error messages, and business volume. In a multi-tenant SaaS pod this is a cross-tenant information disclosure vulnerability. | Fix at the same time as L3B.1 (key by tenant + set). Additionally in the controller: `if (snap.active && snap.ImportSetCode != importSetCode || !ownedByCurrentTenant) return NotFound(...)`. The FinalResult payload in particular should be tenant-verified before serialising back to the client - it contains per-row Reference strings and error text that would let a curious operator learn a competitor's job naming conventions or client names. |
| L3B.3 | P1 | `BulkImportPromotionService.cs:147-156` (`StartBackgroundPromote` dedupe) | Race between the TryGetValue check at line 153 and the `Progress[importSetCode] = progress;` assignment at line 168. Two `?async=true` promote requests arriving microseconds apart both observe `Progress.TryGetValue` returning false, both proceed to construct their own `PromoteProgress`, both blow away each other's entry, and both spawn a `Task.Run` background task. The applock inside `PromoteCoreAsync` will serialise the DB work (second task waits 30 s then throws), but the frontend that latched onto the second progress entry sees `error = "Could not acquire application lock ..."` for a promote it thought was running fine. Additionally both tasks scope their own DI container + HttpClient, doubling the tenant's DB-connection footprint for the duration of the wait. | Replace with `GetOrAdd` for the atomicity guarantee: `var progress = Progress.GetOrAdd(importSetCode, _ => new PromoteProgress { ImportSetCode = importSetCode });` then check `if (progress.Total > 0 && !progress.Done) return progress;` (Total is 0 until PromoteCoreAsync sets it, so a returned-existing-completed entry is distinguishable from a fresh one only via Done). Cleaner: use a `SemaphoreSlim` or `AddOrUpdate` with the started-Task tracked as a field so the second caller returns the FIRST task's progress instead of spawning a second one. |
| L3B.4 | P1 | `wwwroot/app/react/pages/BulkImport.tsx:455-460` (`closeHistory`) | The History drill-in modal closes via `closeHistory()`, which resets `historyOpen`, `historyRows`, `editingRow`, `promoteResult` - but does NOT clear `promotePollRef.current`. If the operator clicks Close while a background promote poll is running (2 s interval firing `bulkImportService.promoteStatus(code)`), the `setInterval` continues to fire indefinitely for the lifetime of the React tree - and because `promoting` state is still true, the finally block at line 543-549 never runs to clean up. Every 2 s the tab hits the status endpoint until the whole SPA navigates away. Multiply by an operator who closes and reopens the modal a few times mid-promote (checking a different set) and you have a stack of parallel intervals all polling. | In `closeHistory()`: `if (promotePollRef.current != null) { window.clearInterval(promotePollRef.current); promotePollRef.current = null; setPromoting(false); setPromoteProgress(null); }`. Additionally add a `useEffect` cleanup on unmount: `useEffect(() => () => { if (promotePollRef.current != null) window.clearInterval(promotePollRef.current); }, []);` so a page navigation also releases the interval. Same shape as the abortRef guard pattern. |

#### P2 bugs

| ID | Severity | Location | Description | Suggested fix |
|----|----------|----------|-------------|---------------|
| L3B.5 | P2 | `BulkImport.tsx:527-529` (`setInterval` inside `doPromote`) | The poll uses `setInterval(() => { void poll(); }, 2000)`, but `poll` is async and awaits `bulkImportService.promoteStatus(code)`. If the server slows to 3-5 s per response, intervals fire while the previous poll's await is still in flight, stacking concurrent status calls. On a truly stalled server every 2 s adds another open request. Because the browser caps 6 concurrent requests per host, this can starve OTHER page requests (loadSets, etc). | Switch to a recursive `setTimeout` pattern that only schedules the next poll AFTER the current poll settles: `const schedule = () => { pollTimeoutRef.current = window.setTimeout(async () => { await poll(); if (!done) schedule(); }, 2000); };`. Also add an in-flight guard: `if (pollInFlightRef.current) return;` at the top of `poll` as belt-and-braces. |
| L3B.6 | P2 | `BulkImportPromotionService.cs:433,438` (per-row SaveChanges without transaction) | The tblBulkJob insert (line 432-433) and the shadow-row promote metadata update (line 435-438) are TWO separate `SaveChangesAsync` calls. If the pod is killed / drops DB connection / times out between them, the live tblBulkJob row exists but the shadow row still shows PromotedUtc = null. A subsequent promote retry re-inserts the same tblBulkJob (no unique-JobNumber constraint per L2B.2 discovery still applies to this in-between-crashes window). | Wrap the two SaveChanges pair in a single EF Core transaction: `using var tx = await Context.Database.BeginTransactionAsync(); Context.TblBulkJobs.Add(bulkJob); await Context.SaveChangesAsync(); row.PromotedUtc = ...; await Context.SaveChangesAsync(); await tx.CommitAsync();`. On exception the tx auto-rolls-back, so the retry sees a clean state. |
| L3B.7 | P2 | `wwwroot/app/react/services/api.ts:12-16` (headers spread order) | The comment claims per-call overrides "can't strip X-Requested-With" - but `headers: { 'Content-Type': ..., 'X-Requested-With': ..., ...(options?.headers ?? {}) }` spreads the caller's headers LAST, meaning caller values win and CAN in fact override X-Requested-With. Not a bug BulkImport currently exercises (none of the bulkImportService methods override headers), but the comment misleads future maintainers and the guardrail is one bad copy-paste away from disappearing. NB: bulkImportService.parseFile at bulkImportService.ts:212 raw-fetches with an explicit X-Requested-With, so it is safe by construction. | Either (a) reverse the spread order so defaults win: `headers: { ...(options?.headers ?? {}), 'Content-Type': ..., 'X-Requested-With': ... }`, or (b) fix the comment to match reality. (a) preferred - matches the stated intent. |
| L3B.8 | P2 | `BulkImportPromotionService.cs:483-497` (`ResolvePickupCoordsAsync` cache hit path) | On cache hit, the method returns `(row.PickupLat, row.PickupLng, null, null)` - the suburb + postcode are NULL. The caller at line 356-357 destructures into `pickupSuburb` / `pickupPostCode`, which then flow into `fromSuburb` / `fromPostCode` at line 390-391 and eventually the tblBulkJob insert. On a cache-hit retry, `FromSuburb` becomes `""` (line 412 default) and `FromPostCode` becomes NULL. On a cache-miss first attempt, `FromSuburb` gets HERE's District/City and `FromPostCode` gets HERE's numeric postcode. So the tblBulkJob pickup-side geographic detail SILENTLY DIFFERS depending on whether the promote was a first-try or a retry. Downstream RunBuilder pickup grouping will treat the same shadow row differently between attempts. | Cache the derived suburb + postcode alongside the coords: add `PickupSuburb NVARCHAR(200) NULL` + `PickupPostCode INT NULL` (and delivery variants) to `TblBulkImportJob` in a follow-up migration; write them alongside the coord cache; read them back on cache hit. Cheap columns, closes the divergence. |

#### P3 (polish)

- L3B.9 `BulkImportPromotionService.cs:452-453` - on the catch-block SaveChanges-failure branch, `Context.ChangeTracker.Clear()` is called but the shadow row's PromoteFailed status update is LOST. Next promote retry does not see the operator-facing error text.
- L3B.10 `BulkImportPromotionService.cs:399` - `JobNumber = row.Reference ?? $"BULK-{row.BulkImportJobId}"` synthesises a fallback reference silently. If tblBulkJob.JobNumber has a downstream unique constraint (not verified but likely), two rows with null Reference would both get a fresh synthesised code so no collision - but the operator has no idea their references were silently invented. Log an info line or reject the row.
- L3B.11 `BulkImport.tsx:143` - the regex `/\.(csv|xlsx|xlsm)$/i` accepts `.csv`, `.xlsx`, `.xlsm` but the accept attribute at line 611 additionally accepts `text/csv` MIME. If a user drops a file with no extension but MIME text/csv (rare, some Linux tools), the drop handler rejects even though the file input would accept.
- L3B.12 The static Progress dictionary is never purged on pod restart, and the 10-min cleanup at line 215 uses `Task.Delay(...).ContinueWith(...)`. If the pod recycles during those 10 minutes, entries live briefly then vanish. Frontend polls that saw active=true suddenly see active=false with no explanation. Cosmetic - a page refresh gets the shadow-row state.

### Section 2: New missed features

#### P1 features

None found - all pass-1/2/3 P1 features from prior loops are shipped and code-verified. The three questions in the brief resolve:

- **Cancel-promote affordance on History?** Not needed for P1: promote is now async with progress and typical run is < 2 minutes on realistic batches (< 500 rows with cached geocodes). Cancel is L2B.13 already parked as P2. Given operators can just navigate away (with L3B.4 fixed to clean up polls) and rows are idempotent, hard cancel is P2 not P1.
- **Shadow-row EditableBy audit column?** `CreatedByUserName` + `PromotedByUser` already provide who-touched-this trace. An additional `LastEditedByUserName` would be a nice-to-have but is not blocking - inline edits are only allowed on unpromoted rows and the surface area is small enough that Serilog + git-tracked timestamps cover the audit need for MVP. P2.
- **Resubmit-failed-rows button on History?** Interesting UX affordance but complicates the mental model (retry vs re-import). The current path (inline edit -> re-run promote, which is idempotent per L3B.6 concerns) covers the same operator intent. P2.

#### P2 features

| ID | Priority | Feature | Rationale |
|----|----------|---------|-----------|
| L3F.1 | P2 | Deployment ordering note in `changes.log` header + PR description | The pass-3 migration `20260722120000_BulkImportGeocodeCache.sql` adds four DECIMAL columns that the pass-3 promoter code READS on cache-hit (`row.PickupLat.HasValue`). If code ships first and hits a tenant that has not yet run the migration, EF Core throws `Invalid column name 'PickupLat'` on the very first promote. Testing report flagged YELLOW for this reason. Discovery agent recommends the deployment doc explicitly say "migration MUST be applied BEFORE the pass-3 code rolls out; if a tenant runs pass-2 code + pass-3 migration or pass-3 code + pass-2 schema, one direction is safe (code + old schema throws), the other is safe by design (new schema + old code just ignores the new columns)." Not yet found in any project-level doc. |
| L3F.2 | P2 | Cross-tenant progress-poll ownership audit doc | With L3B.1 + L3B.2 fixed, add a comment in `BulkImportPromotionService` documenting the tenant-scoping invariant so a future refactor does not accidentally revert to key-by-set-code. |

### Section 3: Convergence verdict

**NOT converged - 4 P1 bugs found.**

All four P1s are concurrency / multi-tenant safety issues that a single-user Playwright pass will not catch and that Loop 2 explicitly did not test for in the cross-tenant dimension. L3B.1 + L3B.2 are the most serious: they are a cross-tenant information-disclosure surface in a shared pod. L3B.3 is a race that surfaces under double-click load. L3B.4 is a slow-burn resource leak in the frontend that will accumulate over an operator's day.

Recommend a targeted pass-4 addressing:
1. L3B.1 - key `Progress` by `(tenantId, importSetCode)`.
2. L3B.2 - controller filters `PromoteStatus` by current tenant.
3. L3B.3 - `GetOrAdd` on the dictionary insert.
4. L3B.4 - `closeHistory` clears the poll interval + `useEffect` unmount cleanup.

L3B.5-L3B.8 are P2 and can wait; L3F.1 (deployment note) should ship WITH the code since the migration-then-code ordering is a real cutover hazard the testing agent already flagged YELLOW.

Estimated pass-4 effort: 2-3 hours of focused code, 30 min of manual multi-tenant Playwright verification.

### Section 4: What is truly converged (verified truly done in pass 3)

- **All 13 pass-3 items code-verified**: inline-edit self-dupe skip (BulkImportService.cs:333 `ignoreRowId`), promote applock (BulkImportPromotionService.cs:253), XLSX sparse header via LastColumnUsed (BulkImportParseService.cs:213), XLSX row/col/cell caps (BulkImportParseService.cs:221-237), set-code TOCTOU applock (BulkImportService.cs:97), geocode coord cache (BulkImportPromotionService.cs:486-513 + entity:118-128 + migration:45-52), row cap MaxRowsPerSubmit (BulkImportService.cs:53,69), background promote + status poll (BulkImportPromotionService.cs:147-223 + controller:141-180), CountryCode claim + geocode hint (BulkImportPromotionService.cs:240-247), HERE HttpClient timeout 5s (Program.cs:221-224), server-side FK lookup filter (BulkImportService.cs:572-610), client-side file-size gate (BulkImport.tsx:151-157), warnings in errors CSV (BulkImport.tsx:410-434).
- **Auth policy `[Authorize(Policy = "RouteBuilder.Admin")]` present at controller-class scope** (BulkImportController.cs:22) - covers ALL 9 action methods. Only override is `template.csv` [AllowAnonymous] (harmless static content).
- **CSRF X-Requested-With header** sent by both `api.ts request()` (line 14) and the raw `parseFile` fetch (bulkImportService.ts:212). See L3B.7 for a minor comment/code mismatch.
- **Migration idempotent** via `IF NOT EXISTS` on every ALTER (20260722120000:45-52).
- **Prior loop items** L2B.1-13 + L2F.1-9 all landed as advertised in the pass-3 code.

### Deployment-order reminder

Ship in this order:
1. **APPLY** `C:\Gitlab\DBMigrationV2\DatabaseScripts\Migrations\20260722120000_BulkImportGeocodeCache.sql` on every tenant DB (adds `PickupLat`, `PickupLng`, `DeliveryLat`, `DeliveryLng` DECIMAL(9,6) NULL columns to `tblBulkImportJob`).
2. **THEN** roll out the pass-3 RoutedOperations code that reads/writes those columns in `BulkImportPromotionService.ResolvePickupCoordsAsync` / `ResolveDeliveryCoordsAsync`.

Reverse order (code-first) throws `Invalid column name 'PickupLat'` on the first promote invocation for any tenant that has not yet run the migration. The migration is safe to apply before the code ships - old pass-2 code simply ignores the new columns and continues geocoding-every-time.

### Surprises worth flagging (Loop 3)

1. The static `Progress` dictionary is the single largest architectural miss across all three passes. It was added specifically for L2F.3 (background promote progress) which was itself a Loop-2 P1 finding, but multi-tenancy was not considered when picking the key. This is exactly the class of bug that surfaces only when independent agents look at the same code with fresh eyes - Loop 2 built the feature, Loop 3 sees the tenant-scoping gap.
2. The applock resource name at line 254 is also not tenant-scoped. sp_getapplock in SQL Server is server-scoped, and if the Despatch DB were ever consolidated onto a shared SQL instance across tenants (multi-DB single-server), the applock would serialise across tenants too. Currently each tenant has its own DB + its own connection so this is theoretical, but flagging alongside L3B.1 for symmetry.
3. The `closeHistory` poll-leak (L3B.4) is a classic React interval-cleanup miss. Only surfaces on a specific user flow (start promote, then close modal mid-flight) so single-happy-path Playwright would never see it.
4. Convergence is close: 3 passes have driven the P1/P2 count down monotonically (Loop 1: many gaps; Loop 2: 5 P1 bugs + 3 P1 features; Loop 3: 4 P1 bugs + 0 P1 features). The remaining P1s are architectural rather than functional, which suggests one more pass will close the loop.

---

## Loop 4 Findings - final convergence check

Audit date: 2026-07-22 (post pass 4 - fourth independent read-only sweep)
Auditor: discovery agent (Loop 4, convergence verdict)

### Section 1: New bugs found

**None found at P0 or P1.**

Every Loop 3 P1 fix is code-verified in the pass-4 sources:

- **L3B.1 (tenant-scoped Progress key)**: `BulkImportPromotionService.cs:92-95` composes the key as `$"{tenantId ?? "?"}:{importSetCode}"` via `ProgressKey`; used at every read/write site (lines 98, 109, 172, 180, 197, 204, 259-261). Case-insensitive comparer preserved.
- **L3B.2 (controller PromoteStatus tenant filter)**: `BulkImportController.cs:181-196` resolves `CurrentTenantID` via `ResolveTenantId()` (line 201-202) and passes it into `GetProgressSnapshot(tenantId, importSetCode)`. Missing-tenant case returns 401 (line 187-193) rather than silently reading global state. Miss returns `{active=false}` shape (BulkImportPromotionService.cs:111-112) so a probe cannot distinguish a real absence from an ownership rejection.
- **L3B.3 (atomic GetOrAdd)**: `BulkImportPromotionService.cs:179-211` uses `Progress.GetOrAdd(key, _ => { started = true; return new PromoteProgress {...}; })`. Losing racer returns the existing entry without spawning a duplicate `Task.Run`. Stale-done replacement uses `TryUpdate` to keep the swap atomic (lines 194-206).
- **L3B.4 (closeHistory + unmount cleanup)**: `BulkImport.tsx:455-470` clears `promotePollRef.current` inside `closeHistory`; `useEffect(() => () => {...}, [])` at lines 476-485 cleans up on unmount + also aborts pending fetches via `abortRef.current?.abort()`.
- **L3F.1 (deployment-order note)**: BULKIMPORT-GAPS.md:662-667 documents the migration-first ordering explicitly.

Loop 3 P2/P3 items (L3B.5-L3B.12) remain unresolved but were classified as deferred; not re-flagged.

### Section 2: New missed features

None.

### Section 3: Convergence verdict

**Convergence reached. No new P0/P1 items after 4 loops. BulkImport is production-ready pending both migrations applied in order (`20260722100000_RoutedOperationsBulkImport.sql` then `20260722120000_BulkImportGeocodeCache.sql`).**

Four independent read-only passes have driven the P0/P1 count monotonically to zero:
- Loop 1: many gaps (P0 promotion path + P1 XLSX/dedupe/etc)
- Loop 2: 5 P1 bugs + 3 P1 features
- Loop 3: 4 P1 bugs + 0 P1 features
- Loop 4: 0 P1 bugs + 0 P1 features

Residual P2 items (L2B.6, L2B.10, L2B.13, L3B.5-L3B.8, L3F.2) are backlog polish - not blockers.

### Section 4: Deployment reminder (unchanged)

Apply BOTH migrations to every tenant DB before the RoutedOperations pass-4 code rolls out:
1. `C:\Gitlab\DBMigrationV2\DatabaseScripts\Migrations\20260722100000_RoutedOperationsBulkImport.sql` (shadow table, indexes, grants)
2. `C:\Gitlab\DBMigrationV2\DatabaseScripts\Migrations\20260722120000_BulkImportGeocodeCache.sql` (PickupLat/Lng, DeliveryLat/Lng columns)

Reverse order is unsafe: code that reads `row.PickupLat` throws `Invalid column name 'PickupLat'` on first promote for tenants where the second migration has not yet applied.
