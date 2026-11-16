# Polygon Builder: layers, show / hide, draw by points that follows boundaries

**Branch:** `feat/polygon-builder-layers-follow-boundary` (routed-operations, off develop 32baca1)
**For:** Kevin, review and merge. Built by Steve's assistant 12 Nov 2026 from Steve's request while drawing the AD polygons on Urgent production.
**Database:** no migration. The layer is stored in `tblBulkRunPolygon.TagLocation` (NVARCHAR(200) NULL), created by `20260730095959_EnsureBulkRunPolygonBaseTablesExist` and never used until now.

## Why

Steve has 11 "AD ..." polygons on Urgent beside Akhil's MC1 / MC6 / MC8 and Marcus's test shapes, all drawn on top of each other with no way to hide any of them, and the postcode boundaries auto-load on every pan and bury the lot. Drawing a polygon that shares a boundary with its neighbour was not possible: the only tool that snaps (point-by-point) was taken off the toolbar on 5 Aug, and even it joined two clicks with a straight line.

## What changed

### 1. Layers (sidebar, save modal, API)

- Every polygon has an optional **layer** name. The sidebar groups polygons by layer, named layers A-Z, then a trailing **No layer** group.
- **Save coverage polygon** has a Layer field with the existing names as suggestions. The last layer typed is remembered in the browser so a run of shapes for one layer needs no retyping.
- Each sidebar row has a **Layer: X** / **+ Layer** chip. Click it to move the polygon to another layer or clear it (blank = no layer). Goes through `PUT /api/bulk-polygons/{id}` with `{ name, layer }`.
- API: `BulkPolygonDto.Layer`, `CreateBulkPolygonRequest.Layer`, `UpdateBulkPolygonMetaRequest.Layer`. Blank is normalised to NULL server-side. 200-character limit like Name.

### 2. Show / hide

- Each layer header: an **eye** toggle (hide / show the whole layer) and **Only** (show this layer, hide every other one, including No layer).
- Each polygon row: its own eye toggle. A hidden polygon stays in the list greyed out; clicking its name shows it again and zooms to it.
- **Show all** at the top of the list clears every hide.
- Hidden shapes are off the map, not clickable, and **not snap targets** (both in point drawing and in edit-mode vertex drag).
- The polygon being edited is always shown.
- A **Hide / Show postcode boundaries** button in the toolbar. Hidden = boundaries come off the map and the viewport auto-load stops, so a pan no longer pulls WKT bodies. Shown = instant, the loaded shapes are kept.
- All of this is a per-browser preference in localStorage (`polygonBuilder.visibility.v1`), per origin, so per tenant. It is not data and nothing downstream reads it.

### 3. Stable colours

Colour was the list index modulo a 7-colour palette, so a shape changed colour whenever one was added above it in the alphabet. It is now the polygon's own `ColorHex` when set, else a palette slot keyed on `polygonId`. Same palette, no new column.

### 4. Draw by points, back on the toolbar, with follow-boundary

- **New Drawing > Draw by points (P)**, also on the map right-click menu. The `mode === 'drawing'` code was still in the file; this wires it back in.
- Finishing lands in **pending** mode like the drag tools, so the draft gets the same Add / Cut / Clip / Split + Undo before it is named and saved.
- Snapping (unchanged): within 14 px the cursor snaps to a vertex (red ring) or an edge (orange ring) of any shown postcode boundary or other polygon.
- **Follow boundary (new):** when two consecutive clicks snap to the **same ring**, the vertices of that ring between the two clicks are inserted, the shorter way round. So click once where your shape meets the neighbour, click again where it leaves it, and the whole shared edge comes with it. Hold **Alt** on the second click for a straight line instead.
- **Del / Backspace / Ctrl+Z** undo one **click**, so a followed run of vertices goes together.
- Pure logic is `boundaryArc()` in `lib/polygonOps.ts`. A position on a ring is a fractional index (vertex i = `i`, a point on edge i to i+1 = `i + t`).

## Files

| File | Change |
|---|---|
| `Core/Application/Dtos/BulkPolygon/BulkPolygonDtos.cs` | `Layer` on the DTO, create and meta requests |
| `Core/Application/Services/BulkPolygon/BulkPolygonService.cs` | read / write `TagLocation` as the layer; `NormaliseLayer`, `ValidateLayer` |
| `tests/RoutedOperations.Tests/Services/BulkPolygon/BulkPolygonServiceTests.cs` | two new tests (set + clear, too long) |
| `wwwroot/app/react/services/bulkPolygonService.ts` | `layer` on the model and bodies |
| `wwwroot/app/react/lib/polygonLayers.ts` (+ test) | grouping, visibility rules, colour, localStorage load / save |
| `wwwroot/app/react/lib/polygonOps.ts` (+ test) | `boundaryArc`, `chainLengthMetres` |
| `wwwroot/app/react/pages/PolygonBuilder.tsx` | visibility state, grouped sidebar, eye toggles, layer chip editor, postcode switch, stable colours, draw-by-points tool, follow-boundary click handler, click-level undo |
| `wwwroot/app/react/pages/PolygonBuilder.layers.test.tsx` | 7 render tests: grouping, hide / Only / Show all, per-polygon hide + reveal, move to layer, postcode switch, draw-by-points entry + undo, P shortcut |

## Tests

- `npm run type-check`: clean.
- `npm run test`: 176 files; the only red is `bulkImportService > uploadFile > POSTs multipart`, the known Node 24 vs CI Node 22 difference (see routed-ops pre-push note), untouched by this branch.
- Backend: `dotnet run -c Release` in `tests/RoutedOperations.Tests`: 2020 tests, 0 failed after `npm run build` (the 24 Integration host tests need `wwwroot/dist`).

## Done when (for Steve on staging)

1. Save a new shape with layer `AD`; it appears under an **AD** header. Existing AD shapes have no layer until moved: click **+ Layer** on each, type `AD`, Save (or leave them; grouping by name was the only thing before).
2. Eye on the **MC** header hides MC1 / MC6 / MC8; **Only** on AD leaves just the AD shapes; reload the page and it is remembered.
3. **Hide postcode boundaries**, pan around central Auckland: the map stays clear.
4. **New Drawing > Draw by points**. Click on AD Deep East's edge, click again further along the same edge: the new shape runs along AD Deep East between the two clicks. Alt-click the second time: straight line. Del removes that whole click. Enter, then refine and save.
5. Hidden shapes do not snap: hide MC6, draw next to where it was, no orange ring.

## Not in this branch

- Rename inline (Name is still edited where it was). Only the layer chip is new.
- A tenant-wide layer catalogue: layers are just the names in use.
- Colour picking: `ColorHex` is read but there is still no UI to set it.
