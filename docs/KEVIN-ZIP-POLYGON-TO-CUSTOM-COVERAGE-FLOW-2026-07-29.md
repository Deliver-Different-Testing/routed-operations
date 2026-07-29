# Kevin — ZIP polygon as seed shape, save edits into custom polygon table

## Decision
Do **not** make ZIP/postcode source polygons directly editable in place.

Instead:

1. use the ZIP polygon shape as a **starting geometry source**
2. let the operator edit that shape in Polygon Builder
3. save the edited result into the existing **ad hoc / custom polygon table** (`tblBulkRunPolygon` + `tblBulkRunPolygonPoint`)
4. leave the original ZIP polygon source data unchanged

## Why
ZIP polygons and custom route coverage polygons are solving different problems.

### ZIP polygon
- reference geography
- canonical source boundary for a postcode / ZIP
- reusable starting shape
- should stay stable

### custom polygon
- operational geography
- route coverage tuned for dispatch reality
- may intentionally differ from the official ZIP boundary
- should be editable by operators

If we allow operators to edit the ZIP master polygon directly, we blur those two concerns and create unwanted global side effects.

## Recommended user flow

### New flow
1. operator searches or selects a ZIP/postcode
2. system loads the ZIP polygon onto the map
3. operator chooses **Use as starting shape** / **Convert to custom polygon**
4. polygon enters normal edit mode
   - drag vertices
   - insert midpoint vertices
   - delete vertices
5. operator saves
6. saved result is written as a new or updated record in:
   - `tblBulkRunPolygon`
   - `tblBulkRunPolygonPoint`
7. route can then attach to that saved custom polygon

## Explicit non-goal
This change should **not** update or overwrite the source ZIP polygon geometry.

That source data remains read-only from the Polygon Builder workflow.

## Why this is safer

### 1. no global geography corruption
Editing ZIP source data would change the meaning of that ZIP everywhere it is reused.

### 2. cleaner audit trail
A custom polygon can clearly represent:
- who created it
- what route it belongs to
- what source ZIP it came from
- when it was changed

### 3. better operational flexibility
Ops can slightly trim or extend a coverage area for real-world routing without pretending the ZIP boundary itself changed.

### 4. easier future precedence rules
Later, auto-assign can distinguish between:
- ZIP-level assignment
- custom coverage assignment

without ambiguity.

## Implementation direction

## Backend

### Keep current custom polygon storage as the save target
Use the existing custom polygon tables:
- `tblBulkRunPolygon`
- `tblBulkRunPolygonPoint`

This is the correct persistence target for edited coverage areas.

### Add ZIP polygon read model / endpoint
If not already present in Kevin's latest branch, add a read-only ZIP polygon source endpoint, for example:

- `GET /api/zip-polygons/{zipCode}`

Response should provide:
- ZIP/postcode code
- display name if available
- ordered polygon points
- possibly multipolygon support if needed later

### Add source metadata on custom polygons
When a custom polygon is created from a ZIP shape, persist source metadata so we know where it came from.

Recommended additions on `tblBulkRunPolygon` if not already present:
- `SourceType` (`ZipPolygon` / `Manual`)
- `SourceCode` (e.g. `02116`)

If Kevin wants to avoid schema change right now, this can be deferred, but it is useful.

## Frontend

### Polygon Builder changes
Add a flow like:
- search/select ZIP
- load ZIP shape onto map as a temporary source polygon
- user clicks **Convert to custom polygon** or **Edit as coverage area**
- geometry is copied into the editable polygon state
- save uses the existing polygon create/update API

### UI wording
Use wording that makes the distinction obvious.

Recommended labels:
- **Load ZIP polygon**
- **Use as starting shape**
- **Convert to custom polygon**
- **Save coverage polygon**

Avoid wording like:
- **Edit ZIP polygon**
- **Save ZIP boundary**

because that implies source-data mutation.

## Data model intent

### ZIP polygon source
- read-only in this workflow
- canonical reference geometry
- starting data only

### custom polygon
- editable
- route-facing
- dispatch-facing
- operational geometry used for coverage and auto-assign

## Auto-assign implication
This fits cleanly with Kevin's new custom polygon fallback.

Desired behaviour:
- source ZIP polygon is just a convenient seed shape
- edited saved polygon becomes a normal custom polygon
- auto-assign continues to work against saved custom polygons, not temporary ZIP source shapes

That keeps the runtime logic simple.

## Important rule
The system should never treat a loaded-but-unsaved ZIP polygon as active route coverage.

Only saved custom polygons should participate in:
- route attachment
- coverage logic
- custom polygon auto-assign

## Suggested API shape

### Read ZIP polygon
- `GET /api/zip-polygons/{zipCode}`

### Save custom polygon
Use existing polygon endpoints:
- `POST /api/polygons`
- `PUT /api/polygons/{id}`

The frontend should map the loaded ZIP geometry into the same payload shape already used by custom polygons.

## Acceptance criteria
- operator can load a ZIP/postcode polygon as a starting shape
- loaded ZIP polygon can enter edit mode
- edited geometry saves into `tblBulkRunPolygon` / `tblBulkRunPolygonPoint`
- source ZIP polygon data remains unchanged
- saved polygon behaves exactly like any other custom polygon
- saved polygon can be attached to a recurring route
- unsaved ZIP shapes do not affect auto-assign or route coverage
- UI clearly distinguishes source ZIP geometry from saved custom coverage geometry

## Recommended implementation sequence
1. add read-only ZIP polygon load endpoint
2. wire Polygon Builder to fetch and display ZIP source geometry
3. add convert-to-custom/edit flow in the UI
4. save edited geometry through the existing custom polygon API
5. optionally add source metadata fields for traceability
6. verify end-to-end:
   - load ZIP
   - edit
   - save custom polygon
   - attach to route
   - confirm auto-assign uses saved custom polygon only

## Recommendation
This should be implemented as:

> **ZIP polygon = source geometry**
> **custom polygon = editable saved operational coverage**

That gives us the operator convenience Steve wants without mutating the canonical postcode boundary data.
