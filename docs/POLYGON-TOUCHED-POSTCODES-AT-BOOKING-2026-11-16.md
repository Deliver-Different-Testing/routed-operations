# Polygons: every postcode a shape touches is assessed at booking

**For:** Kevin (owner). Kerran FYI (rating side already follows this rule).
**From:** Steve, 16 Nov 2026
**Repos:** routed-operations (panel + DTO), dbmigrationsv2 (availability + rating functions, callers), WebAPI (pass coordinates on GetSchedulerRates and rerate; approved by Steve 16 Nov)
**Researched on:** routed-operations GitLab `develop` 8231d13 (14 Nov), dbmigrationsv2 GitLab `master` 35f9322 (15 Nov)

## 1. What happened

Marcus drew polygon 30 **"Cambridge to Tirau Corridor"** on Urgent prod (15:04 NZT 16 Nov), placed it in **Zone 6 of "Std Regional Hamilton"** (zone group 11, 15:05:02), and reshaped it five times. A quote to **200 Lake View Drive, Karapiro 3494** (-37.9197, 175.5410) at 15:19 returned only *Direct Drive Sameday*: no regional schedule.

From the Routed Ops log, the last reshape wrote **7 `BulkRunPolygonZip` rows, of which 2 were >= 10%** overlap. The panel said "Covers 2 postcodes: 3410, 3484". Karapiro 3494 is one of the 5 rows under 10%, so booking never considered the polygon for it.

## 2. The rule (Steve, 16 Nov)

**If a polygon touches a postcode, that postcode is assessed.**

| Postcode vs shape | At booking |
|---|---|
| Fully inside (`IsFull = 1`, >= 99%) | Matches on postcode, no coordinates needed |
| Touched, not fully inside (`IsFull = 0`, any `OverlapPct > 0`) | One point-in-polygon test on the job end's lat/lng decides |
| Edge-only touch (area 0) | Not written today (`HAVING SUM(x.Area) > 0`), stays that way. A point can't fall inside a zero-area overlap. |

There is no "mostly inside" threshold. This is the same rule `UTL_fncJob_ExceleratorRate` already uses for rating (20261105110100), so booking and rating will agree.

A polygon does **not** need to be attached to a route for booking. Zone membership (`BulkZonePolygon`) is what decides availability. The route only decides who runs the job.

## 3. Why it fails today (code as of the commits above)

1. **10% floor in availability.** `UTL_fncJob_GetClientAvailableBulkRunSchedule` (latest emitter at time of writing: `20261113110200_AvailabilityLinkedDefaultsAndBlockDefaults`) has rule 2 reading `BulkRunPolygonZip ... AND pz.OverlapPct >= 10` on both ends. That was added in 20261105100100 to keep sliver rows out.
2. **No point test (rule 3 was never built).** The function only gets `@FromPostCode` / `@ToPostCode`. So rule 2 can only offer the *whole* postcode for any polygon tagged with it. That's why the 10% floor existed, and why the 20261007210000 header says the switch should stay off until rule 3 exists.
3. **Rule 2 only runs when rule 1 found nothing anywhere.** If the postcode is in `bulkzonepostcode` for *any* group, `@ToRegions` is non-empty and polygons are never consulted, even for a different group. If 3494 is already a postcode member of some other group, Marcus's polygon in group 11 can never add it. (Checked in M0.)
4. **Switch.** All of rule 2 sits behind `tblSetting.PolygonZoneResolutionEnabled` (default 0). If Urgent prod has it off, no polygon zone works at booking at all, including 3410/3484. (Checked in M0.)
5. **The panel hides partial postcodes.** `PolygonBuilder.tsx:3281-3287` counts `partiallyIncludedZips`, which is the >= 10% packed list (`PartialZipMinOverlapPct = 10` in `BulkPolygonService.cs:678`). The other 5 touched postcodes are invisible to the operator.

## 4. Changes

### 4.1 Availability function takes coordinates (dbmigrationsv2)

T-SQL functions can't take optional parameters without every caller passing `DEFAULT`, and there are many callers. So:

- **New** `dbo.UTL_fncJob_GetClientAvailableBulkRunScheduleAt(@ClientID, @JobTypeID, @Datetime, @FromPostCode, @ToPostCode, @FromLat, @FromLng, @ToLat, @ToLng)` holds the body.
- **Existing** `UTL_fncJob_GetClientAvailableBulkRunSchedule` becomes a one-line wrapper passing NULL coordinates, so it keeps compiling for callers that are not job paths (reports such as `REP_qryClientRateSchedule*`). Every path that quotes, books or rates a job moves to `...At` and passes the job's coordinates (4.2). Every job has coordinates (Steve, 16 Nov).
- Re-emit the full body from the **latest emitter on master at build time**, not the file named above. The collision-review header must name the emitter you actually used.

Rule 2, per end, inside the new function:

```sql
-- candidates: active polygons in an active zone membership, tagged with the postcode
-- IsFull = 1                      -> add (g.DepotId, bzp.PostcodeGroupId)
-- IsFull = 0 and point supplied   -> add only if p.GeographyData.STIntersects(geography::Point(@Lat, @Lng, 4326)) = 1
-- IsFull = 0 and no point         -> no match (only non-job callers such as reports get here)
```

- One clustered-PK seek on `BulkRunPolygonZip (Zip, PolygonId)` per end, and `STIntersects` only on partial candidates. Nothing per schedule row, no scalar UDF (remember the 14 Oct rates timeout).
- **Per-group rule 1 (D2, decided):** run rule 2 for every group where the postcode has *no* `bulkzonepostcode` row, not only when it has none anywhere. Inside one group the postcode zone still wins, so the polygon-versus-postcode pricing conflict still can't arise.
- Both zip spellings stay matched (`IN (@ZipText, RIGHT('0000'+@ZipText,4))`).
- `DD_fncJob_GetClientAvailableBulkRunSchedule` (US) is out of scope. It doesn't read `BulkZonePolygon`.

### 4.2 Pass coordinates from the quote and booking paths

The api log shows `GetSchedulerRates` and `POST /API/UrgentAPI/Job` already carry `To.Latitude` / `To.Longitude` (and `From`). Switch the entry points that sit behind those calls to the `...At` function and pass the coordinates through.

- Kevin to list them in M0. The likely set is `WS_stpJob_Scheduler_Rates`, `DD_stpJob_Scheduler_Rates`, `WS_stpJobType_Rates`, the `WS_/DD_stpBulkScheduleJob_Insert` family and `uspPrebookSet`.
- **Booking must use the same answer as the quote.** A schedule shown at quote must not be refused at insert because insert didn't get the point.

### 4.3 Polygon Builder panel shows what is assessed (routed-operations)

- `BulkPolygonDto` gains the `BulkRunPolygonZip` rows (`Zip`, `IsFull`, `OverlapPct`). They're already written by `RefreshPartiallyIncludedZipsAsync`.
- The panel reads **"Fully covers N postcodes · partly covers M"** and lists both. Partly-covered ones are marked "address checked against the line". Show-on-map shades partial ones lighter.
- Leave the packed `PartiallyIncludedZips` column and its 10% rule alone. Only the route resolver reads it (routing, not booking). Moving the resolver to the new rule is a separate decision.

### 4.5 Rating uses the zone the polygon gave (added 16 Nov after M0)

M0 found that NZ rating never sees polygon 30. `UTL_fncJob_ExceleratorRate` reads `tblBulkRunPolygon.ZoneNameId` (US model), polygon 30 has none, and `PolygonZoneRatingEnabled = 0` on Urgent. NZ zone rating resolves the zone from `bulkzonepostcode` by postcode. Once 4.1 offers the Std Regional Hamilton run into Karapiro 3494 through the polygon, the price lookup still goes by postcode. 3494 isn't a postcode member of that group, so Zone 6 may not price at all. Kevin's 20261007210000 header warned about exactly this split.

- **Rule (Steve, 16 Nov):** when availability gives a job end its group and zone through a polygon (`BulkZonePolygon`), NZ rating prices that end in the same group and zone. The quote price must match the schedule offered.
- Same order of precedence as availability: a postcode zone in that group wins. Then a full polygon postcode. Then a partial one, if the point is inside.
- Kevin to name the exact NZ zone resolution point(s) feeding `fncT_BulkZoneRate*` / `UCL_fncT_GetBulkZone` in M2b. Re-emit from the latest emitter on master at build time.
- Gate it on the same switch as 4.1, so availability and rating always turn on together.

### 4.4 Switch

`PolygonZoneResolutionEnabled` turns on for Urgent once M4 passes on Urgent staging, if M0 shows it's off. The old "do not enable until rule 3" condition is met by 4.1.

## 5. Decisions

| # | Question | Recommendation |
|---|---|---|
| D1 | A caller with **no coordinates** hits a partly-covered postcode | **Decided (Steve, 16 Nov): no fallback.** Every job has coordinates, so every job path passes them. A partly-covered postcode never matches without a point, and the 10% floor goes from availability entirely. |
| D2 | Postcode is a member of a *different* group by postcode | **Decided (Steve, 16 Nov): yes.** The polygon still adds its own group (per-group rule 1). Inside one group the postcode zone still wins. |
| D3 | Rating for NZ zones via polygon | Out of scope here. NZ zone rating (`UCL_fncT_GetBulkZone`) doesn't read polygons. Flag if Marcus's corridor needs a different price, not just availability. |

## 6. Read-only checks for M0 (Urgent prod)

```sql
SELECT PolygonZoneResolutionEnabled, PolygonZoneRatingEnabled FROM dbo.tblSetting;

SELECT pz.Zip, pz.IsFull, pz.OverlapPct
FROM dbo.BulkRunPolygonZip pz WHERE pz.PolygonId = 30 ORDER BY pz.OverlapPct DESC;

SELECT bzp.*, g.Name, g.DepotId
FROM dbo.BulkZonePolygon bzp JOIN dbo.BulkZonePostcodeGroup g ON g.Id = bzp.PostcodeGroupId
WHERE bzp.PolygonId = 30;

-- is each touched postcode already a postcode member somewhere (rule 1)?
SELECT z.PostCode, z.PostcodeGroupId, g.Name, z.Zone, z.DepotId
FROM dbo.bulkzonepostcode z LEFT JOIN dbo.BulkZonePostcodeGroup g ON g.Id = z.PostcodeGroupId
WHERE CAST(z.PostCode AS varchar(10)) IN (SELECT Zip FROM dbo.BulkRunPolygonZip WHERE PolygonId = 30);
```

## 7. Acceptance (Urgent staging, copy of polygon 30's shape in Zone 6 of Std Regional Hamilton)

1. An address in a fully-covered postcode gets the Hamilton regional schedule, with or without coordinates.
2. **200 Lake View Drive, Karapiro 3494** (inside the line) gets the schedule at quote **and** booking.
3. An address in 3494 **outside** the line does not get it.
4. Every job entry point from M0 passes coordinates. Prove it on staging: a quote and a booking into 3494 inside the line both offer the schedule.
5. The panel lists all touched postcodes, split into fully and partly covered.
6. The Karapiro quote prices in Zone 6 of Std Regional Hamilton, matching the schedule offered (4.5).
7. A quote with no polygon involved returns exactly what it did before (diff 50 recent Urgent quotes before and after).

## Milestones

| M | Title | Done when |
|---|---|---|
| M0 | Confirm facts | Section 6 run on Urgent prod and results posted. Entry-point list for 4.2 agreed. D1 and D2 decided by Steve 16 Nov. |
| M1 | Availability `...At` function | New function plus wrapper migration on a branch. Per-group rule 1, IsFull / point test, collision header names the real baseline. |
| M2 | Coordinates through quote and booking | Entry points from M0 pass From/To lat/lng. Quote and insert give the same schedule for the same address. |
| M2b | Rating uses the polygon zone | NZ rating prices a polygon-zoned end in the same group and zone that availability gave it, behind the same switch. A Karapiro quote on the corridor returns a Zone 6 price. |
| M3 | Panel shows touched postcodes | DTO carries `BulkRunPolygonZip` rows. Panel shows fully/partly lists and map shading. |
| M4 | Staging acceptance | Section 7 checks 1-7 pass on Urgent staging. |
| M5 | Prod + Marcus retest | Released. Switch on for Urgent if it was off. Marcus books into Karapiro on the corridor and gets the regional run. |
