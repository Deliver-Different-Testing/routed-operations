# US schedules: selected zones and bound ZIPs limit what a schedule serves

**Owner:** Kevin. **Written:** 24 Oct 2026 (Steve, via Claude). **Status:** spec, not started.
**Trigger:** Dane's Cheetah report, 23 Oct 2026:
`https://github.com/Deliver-Different-Testing/dfrnt-ops/blob/main/docs/2026-10-23-us-schedule-service-days-bug-report.md`
and the companion issue `https://github.com/Deliver-Different-Testing/dfrnt-ops/issues/2`.
**Parent:** `PRICING-AND-ZONES-INTO-ROUTED-OPS-2026-10-09.md` section 6.3, which built this rule for NZ on
16 Oct and said "the DD_ twin has no zone gate; no US change". This spec is the US change.

Refs checked for this spec: dbmigrationsv2 master `02860b7` (23 Oct), routed-operations master `bf51541`
(23 Oct; identical to develop `25921f4` apart from the Cheetah deploy values), api master `2d9b6d3`.
`[V]` = read in source. `[C]` = to confirm with a SELECT before building.

---

## 0. TL;DR

- On NZ a schedule that has active zones or bound postcodes is offered only to those postcodes. On US the
  availability function keys a schedule to the destination ZIP through one thing only: the ZIP's zone
  and that zone's depot. Every ZIP under the depot gets every schedule at the depot. The zones ticked on
  a leg and the ZIPs bound in the postcode picker are saved on US today and read by nothing. `[V]`
- The fix is the NZ rule, translated to US tables: **coverage = the ZIPs of the schedule's active zones
  (via `ZoneZip`) plus the schedule's bound ZIPs (`tblSchedulePostcode`). A schedule with neither stays
  depot-wide, as today.** The depot rule is unchanged and still applies first. One migration, both
  candidate blocks of `DD_fncJob_GetClientAvailableBulkRunSchedule`.
- `ZoneZip` is reused as the membership table. A ZIP may sit in several zones; the Excelerator rate
  function already matches lanes against the list of all zones a ZIP is in, so adding a ZIP to a
  coverage zone never moves a price unless someone defines a lane on that zone. `[V]` Pricing zones
  (lane geography, area to area) and coverage zones (any shape: rings out from a depot, weekday
  patterns, one client's run) are both `ZoneName` rows, kept apart by `ZoneGroup`. The rater reads
  three things off `ZoneZip` that ignore which zone a row is in (congestion flag, "only in zips"
  distance rates, the depot lookup); section 2.1 sets the rules for coverage rows so none of them moves.
- Zone groups are not involved. Nothing on master reads `ZoneZip.ZoneZipGroupID` `[V]`; Zip Groups stay
  hidden on US (Steve, 23 Oct). The zone-rated gate in `DD_stpJob_Scheduler_Rates` is not the lever
  either: turning `ZoneRated` on for a US speed switches schedule pricing to the NZ bulk zone rate
  tables and marks every line Unavailable. `[V]` Dane's Fix 1c is therefore not needed.
- The per-weekday fake depot workaround (five depots, one per day, 1,152 duplicated ZIP rows) works
  with today's code but is permanent bloat. Rejected by Steve, 24 Oct.
- Routed Ops side: the leg zone picker is empty on US because its list comes from the NZ postcode
  table; it needs to list US zones under the schedule's depot. The schedule postcode picker needs a
  paste box. Kevin's 22 Oct Zone groups tab already edits a US zone's name, group and depot
  (`ZoneGroupsTab.tsx`, `POST/PUT us/zone-names`), so the only zone-editor gap is a ZIP paste: the
  Zones tab adds one ZIP per request. `[V]`
- Dane's Part 2 (an undated on-demand price next to the dated lines, bookable any day) is a separate
  change and is out of scope here. Section 8.

---

## 1. What the US code does today `[V]`

`DD_fncJob_GetClientAvailableBulkRunSchedule`, latest emitter
`20261016170000_Availability_DefaultSuppressionAndZoneLimits.sql`, US body from line 761.

- Lines 863 to 880: `@FromDepots` and `@ToDepots` are filled from `ZoneZip` joined to
  `ZoneName.LocationID` for the pickup and destination ZIPs. Both are sets: a ZIP in several zones
  yields several depots. If either set is empty the function returns nothing.
- Cross-region block (line 909 on): a schedule is kept when `s.Region` is a destination depot and the
  origin side resolves to a pickup depot (`h.OriginRegionId` for client origin, else `s.PickupDepotId`),
  with the two different.
- Standard block (line 950 on): same-depot arm, or an explicit-origin arm (`client` =
  `OriginRegionId`, `direct` = `s.Region`, else `PickupDepotId`) plus destination depot = `s.Region`.
- `s.PostcodeGroupId` is selected into the output and never used as a predicate. Neither block reads
  `BulkZoneSchedule` or `tblSchedulePostcode`.
- Comment at lines 62 to 64: "The US body has no zone gate and never has … No US change."

`DD_stpJob_Scheduler_Rates`, latest emitter `20261015140000_RatingProcs_SetBasedZoneCheck.sql`,
proc from line 1204.

- Line 1305 on: `@ClientAvailableSchedule` is filled from the function above, so it inherits whatever
  the function filters.
- Lines 1328 to 1336: `@ZoneActiveSchedules` is built from the NZ tables `BulkZoneSchedule` +
  `BulkZonePostcode`, deliberately (header comment: the set-based rewrite had to match the scalar
  row for row).
- Line 1447: a schedule row is marked `Unavailable` only when `UseSchedules > 0 AND ZoneRated > 0`
  and the schedule is not in that set. Header line 78: no US job type has `ZoneRated > 0`, so this
  branch never fires on US. It stays as it is. Section 4.4.

What the schedule editor already saves on US (routed-operations master `bf51541`):

- Leg zone ticks: `ScheduleService.cs:1636` writes `BulkZoneSchedule { ScheduleId = day row
  BulkRunScheduleId, Zone, Active }` from `req.Zones` (`{ zone: number, active }`, null = leave
  alone). Today the picker is hidden on US because `GetLookupsAsync` (`ScheduleService.cs:1198`)
  builds `ZoneNumbers` from `BulkZonePostcode` union `BulkZoneSchedule`, which is empty on a US
  tenant; `ChainBuilder.tsx:834` and `:1236` render the picker only when that list is non-empty.
- Bound ZIPs: `ScheduleService.SyncPostcodesAsync` (`:2455`) writes `tblSchedulePostcode` from
  `req.PostcodeIds`; `PostcodeLookupInput.tsx` is already US-aware (5 digits, `/api/territory/us/zip-zones`).
  `tblSchedulePostcode.ScheduleId` is the header id (added nullable by `20261016165000`; the
  `(ScheduleName, PostCode)` key is still the primary key until the follow-up migration). `PostCode` is `int`.

US zone tables (`Core/Domain/Despatch/ZoneZip.cs`, `ZoneName.cs`):

| Table | Columns that matter |
|---|---|
| `ZoneName` | `ZoneNameID`, `ZoneName`, `ZoneGroupId` (rate card grouping), `LocationID` (depot, nullable, FK `tblBulkRegion`) |
| `ZoneZip` | `ZoneZipID`, `Zip` (varchar), `ZoneNameID`, `ZoneNumber` (int, nullable), `ClientID` (nullable), `ApplyCongestion`, `ZoneZipGroupID` (unread) |

Territory API on master: `GET us/zone-names`, `GET us/zip-zones`, `POST/PUT/DELETE us/zip-zones/{id}`
(one ZIP per request). `TerritoryService.CreateZoneNameAsync` / `UpdateZoneNameAsync` exist
(`:551`, `:566`, both set `LocationId`) but no controller route calls them, so there is no UI that sets a
US zone's depot. Cheetah's zones 39 and 40 have `LocationID = NULL` (Dane's export, 23 Oct).

---

## 2. The rule

Same words as parent 6.3, applied to US:

> A schedule that has any active zone tick or any bound ZIP is limited to the ZIPs of those zones plus
> the bound ZIPs, whatever its speed. A schedule with neither is open to its depot, as today. The depot
> rule is unchanged and still applies first.

Consequences:

- Every existing US schedule has no zone ticks and no bound ZIPs `[C, section 3]`, so nothing changes
  for OTG or any other US tenant until an operator ticks a zone or binds a ZIP.
- A zone is "the ZIPs in `ZoneZip` whose `ZoneNameID` is the ticked zone". A ZIP may be in several
  zones; the rate function builds `@ToZoneIDs` as the list of all of them (`20261019150000`, lines
  226 to 227, commented "supports duplicate zip entries") and matches `ZoneCombo` lanes with `IN`
  (lines 261, 268, 281, 292), so a coverage zone with no lane never prices. Section 2.1.
- The ticked zone must belong to the schedule's region (`ZoneName.LocationID = s.Region`), mirroring
  the NZ `p.DepotId = s.Region` test. A zone with no depot never matches. The picker only offers zones
  under the leg's depot (section 5.1), so this is a safety net, not a user-facing rule.
- Client-specific ZIP rows (`ZoneZip.ClientID`) count for that client only, as in the rate function.
- Bound ZIPs match on the integer: `tblSchedulePostcode.PostCode = @ToPostCode`. The function receives
  the ZIP as `int`, so a leading zero is gone before the function is called; a 5-digit US ZIP compared
  as `int` is still unique. Display is zero-padded (section 5.2).

**D1, zone key on US.** `BulkZoneSchedule.Zone` stores `ZoneName.ZoneNameID` on US tenants. Not
`ZoneZip.ZoneNumber`: it is nullable, it is a per-ZIP-row value rather than a zone attribute, and the
depot test needs `ZoneName` anyway. Kevin's zone-groups tab groups US members by `ZoneNumber` with the
zone name as label (`TerritoryService.cs:130`); that is a display grouping and is not changed here. If
`ZoneNumber` turns out to be populated one-to-one with `ZoneNameID` on OTG `[C]`, this decision costs
nothing; if it is not, it is the only key that works.

### 2.1 Pricing zones and coverage zones share one table `[V]`

Scheduling is a rating procedure: `DD_stpJob_Scheduler_Rates` takes its candidates from the
availability function and the Excelerator rater prices them (section 1). So the question is whether
the zones OTG prices by, and the zones a schedule is limited by, can both live in `ZoneName` /
`ZoneZip` without one disturbing the other. They can, and the two do not have to be the same shape.

- **Pricing zones** are lane geography: area to area. `ZoneCombo.FromZoneNameID` and `ToZoneNameID`
  name them, and that is the only place a zone has a price.
- **Coverage zones** are whatever shape a schedule needs: rings out from a depot, weekday patterns
  (Cheetah), one client's run. They have no `ZoneCombo` rows. They are ordinary `ZoneName` rows
  with ordinary `ZoneZip` members.
- **One ZIP, one row per zone.** `ZoneZip` has no unique key on `Zip` (EF model and the migration
  trail; the rater's own comment says duplicates are expected). A ZIP sits in exactly one pricing
  zone per lane geography and in as many coverage zones as it needs. Nothing is moved; coverage
  rows are added next to the pricing row.
- **`ZoneGroup` keeps the families apart.** `ZoneName.ZoneGroupId` already exists, `TerritoryService`
  already lists groups on US (`GetZoneGroupsAsync`) and returns the group name on every zone and
  every ZIP row (`ZoneNameDto.ZoneGroupName`, `UsZipZoneDto.ZoneGroupName`). Coverage zones go in
  their own group (for example "KC coverage"), pricing zones stay in the rate-card groups. The leg
  zone picker shows the group heading (5.1), so an operator ticking "Zone 2" sees whether it is the
  pricing ring or a coverage shape.
- **Both ways of ticking are legitimate.** If the pricing zones already cut the map the way a
  schedule needs, tick the pricing zone itself; no coverage zone is required. If they do not, build
  coverage zones. The SQL in section 4 does not care which family a ticked zone belongs to.

Three things the rater reads off `ZoneZip` without looking at which zone the row is in. Each has a
rule for coverage rows so prices do not move.

| Read | Where | Rule for coverage rows |
|---|---|---|
| Congestion flag: a ZIP is congested if **any** of its rows has `ApplyCongestion = 1` | `20261019150000` lines 230 to 231 | Coverage rows are written with `ApplyCongestion = 0`. The paste endpoint in 5.3 hard-codes it; the single-row `us/zip-zones` form defaults it off |
| "Only in zips" distance rates: a distance rate with `OnlyInZips = 1` applies when both ZIPs have **any** `ZoneZip` row | lines 253, 305, 324, 340 | A ZIP whose first-ever row is a coverage row becomes eligible for those rates. 3e counts them per tenant; on a tenant that has any, paste only ZIPs that already sit in a pricing zone, which is the normal case (a schedule serves ZIPs the tenant already prices) |
| Depot lookup in availability: `@ToDepots` is every `LocationID` over every zone the ZIP is in | `20261016170000` lines 863 to 880 | A coverage zone carries the depot of the schedules that tick it. If that depot differs from the ZIP's pricing-zone depot, the ZIP also becomes visible to that depot's depot-wide schedules. That is the intended meaning of a depot on a zone, not a side effect, but the zone editor (5.3) shows the depot so it is a conscious choice |

`ClientID` on coverage rows: NULL unless the zone exists for one client's schedules; both the rater
and the section 4 predicate honour it the same way (`ClientID IS NULL OR ClientID = @ClientID`).
`ZoneNumber` and `ZoneZipGroupID` on coverage rows: NULL (D1 does not use `ZoneNumber`; nothing reads
`ZoneZipGroupID`). If 3b shows OTG keeps `ZoneNumber` filled one-to-one with the zone, copy the
convention so the Zip Groups view (hidden on US today) does not show a zero bucket later.

---

## 3. Count first (SELECT only; OTG and Cheetah production, Kerran or Kevin)

Run before building. Paste results on the card.

```sql
-- 3a. Any US schedule already carrying zone ticks or bound ZIPs? Expect 0 on both tenants.
SELECT s.ScheduleId, h.Name, s.BulkRunScheduleId, s.Region, s.SpeedId,
       ActiveZones = (SELECT COUNT(*) FROM dbo.BulkZoneSchedule zs
                      WHERE zs.ScheduleId = s.BulkRunScheduleId AND zs.Active = 1),
       BoundZips   = (SELECT COUNT(*) FROM dbo.tblSchedulePostcode sp WHERE sp.ScheduleId = s.ScheduleId)
FROM dbo.tblBulkRunSchedule s
INNER JOIN dbo.tblBulkRunScheduleHeader h ON h.ScheduleId = s.ScheduleId AND h.RetiredUtc IS NULL
WHERE EXISTS (SELECT 1 FROM dbo.BulkZoneSchedule zs WHERE zs.ScheduleId = s.BulkRunScheduleId AND zs.Active = 1)
   OR EXISTS (SELECT 1 FROM dbo.tblSchedulePostcode sp WHERE sp.ScheduleId = s.ScheduleId);

-- 3b. Leading zeros. OTG serves NJ (07xxx). How are those ZIPs stored, and do any schedules
--     at an NJ depot exist? If Zip is stored zero-padded, the EXISTING depot lookup
--     (CAST(@ToPostCode AS varchar) = '7030') already misses them; section 4.2 handles both spellings.
SELECT Padded = SUM(CASE WHEN Zip LIKE '0%' THEN 1 ELSE 0 END),
       Total  = COUNT(*),
       NoZoneName = SUM(CASE WHEN ZoneNameID IS NULL THEN 1 ELSE 0 END),
       NoZoneNumber = SUM(CASE WHEN ZoneNumber IS NULL THEN 1 ELSE 0 END)
FROM dbo.ZoneZip;

-- 3c. Zones without a depot (these can never be offered, before or after this change).
SELECT zn.ZoneNameID, zn.ZoneName, zn.LocationID, Zips = COUNT(zz.ZoneZipID)
FROM dbo.ZoneName zn LEFT JOIN dbo.ZoneZip zz ON zz.ZoneNameID = zn.ZoneNameID
GROUP BY zn.ZoneNameID, zn.ZoneName, zn.LocationID
ORDER BY zn.LocationID, zn.ZoneName;

-- 3d. Cheetah speeds 418 / 419: ZoneRated must be 0 (section 4.4). Any US speed with it set is a finding.
SELECT ucjtID, ucjtName, ZoneRated FROM dbo.tucJobType WHERE ISNULL(ZoneRated, 0) > 0;

-- 3e. Side channels the rater reads off ZoneZip regardless of zone (section 2.1).
--     Distance rates that apply only when both ZIPs are in some zone: expect 0 on Cheetah; on OTG
--     list them. Congestion rows: how many ZIPs carry the flag today (coverage rows never add one).
SELECT DistanceRateID, DistanceRateName, SpeedID FROM dbo.DistanceRates WHERE OnlyInZips = 1;
SELECT CongestionZips = COUNT(DISTINCT Zip) FROM dbo.ZoneZip WHERE ApplyCongestion = 1;
-- Zone families as they stand: every group with its zone count and lane count.
SELECT zg.ZoneGroupID, zg.Name,
       Zones = COUNT(DISTINCT zn.ZoneNameID),
       Lanes = (SELECT COUNT(*) FROM dbo.ZoneCombo zc
                INNER JOIN dbo.ZoneName z2 ON z2.ZoneNameID IN (zc.FromZoneNameID, zc.ToZoneNameID)
                WHERE z2.ZoneGroupID = zg.ZoneGroupID)
FROM dbo.ZoneGroup zg LEFT JOIN dbo.ZoneName zn ON zn.ZoneGroupID = zg.ZoneGroupID
GROUP BY zg.ZoneGroupID, zg.Name ORDER BY zg.Name;
```

---

## 4. SQL (dbmigrationsv2, one migration)

`<stamp>_DD_Availability_ZonesAndZipsCoverage.sql`. Baseline is the latest emitter of
`DD_fncJob_GetClientAvailableBulkRunSchedule` on master at build time (`20261016170000` today). Re-emit
the whole function, US body only; the NZ body is untouched. Keep the plan-flush and
`tblMigrationCheckLog` pattern of `20261016170000`.

### 4.1 Sets, built once after `@FromDepots` / `@ToDepots`

```sql
-- Two spellings: the function gets the ZIP as int. ZoneZip.Zip is varchar and may be
-- stored zero-padded (3b). Match either.
DECLARE @ToZipText   varchar(10) = CAST(@ToPostCode AS varchar(10))
DECLARE @ToZipPadded varchar(10) = RIGHT('00000' + CAST(@ToPostCode AS varchar(10)), 5)

-- Schedules that limit themselves. Small set, materialised once (plan stability; the
-- 8 Oct and 14 Oct booking-page outages were both bad plans on this function).
DECLARE @CoverageLimited TABLE (BulkRunScheduleId int PRIMARY KEY)
INSERT INTO @CoverageLimited (BulkRunScheduleId)
SELECT s.BulkRunScheduleId
FROM dbo.tblBulkRunSchedule s
WHERE EXISTS (SELECT 1 FROM dbo.BulkZoneSchedule zs
              WHERE zs.ScheduleId = s.BulkRunScheduleId AND zs.Active = 1)
   OR EXISTS (SELECT 1 FROM dbo.tblSchedulePostcode sp
              WHERE sp.ScheduleId = s.ScheduleId)

-- Schedules whose coverage contains the destination ZIP.
DECLARE @CoverageMatched TABLE (BulkRunScheduleId int PRIMARY KEY)

-- (a) by zone: an active tick whose zone belongs to the schedule's region and holds the ZIP
INSERT INTO @CoverageMatched (BulkRunScheduleId)
SELECT DISTINCT s.BulkRunScheduleId
FROM dbo.tblBulkRunSchedule s
INNER JOIN dbo.BulkZoneSchedule zs ON zs.ScheduleId = s.BulkRunScheduleId AND zs.Active = 1
INNER JOIN dbo.ZoneName zn ON zn.ZoneNameID = zs.Zone AND zn.LocationID = s.Region   -- D1
INNER JOIN dbo.ZoneZip zz ON zz.ZoneNameID = zn.ZoneNameID
      AND zz.Zip IN (@ToZipText, @ToZipPadded)
      AND (zz.ClientID IS NULL OR zz.ClientID = @ClientID)

-- (b) by bound ZIP
INSERT INTO @CoverageMatched (BulkRunScheduleId)
SELECT DISTINCT s.BulkRunScheduleId
FROM dbo.tblBulkRunSchedule s
INNER JOIN dbo.tblSchedulePostcode sp ON sp.ScheduleId = s.ScheduleId AND sp.PostCode = @ToPostCode
WHERE NOT EXISTS (SELECT 1 FROM @CoverageMatched m WHERE m.BulkRunScheduleId = s.BulkRunScheduleId)
```

### 4.2 Predicate, added to the WHERE of both US inserts

Cross-region block (after the `s.PickupDepotId IS NOT NULL` line, ~945) and standard block (after the
origin arms close, ~1008):

```sql
AND (   NOT EXISTS (SELECT 1 FROM @CoverageLimited cl WHERE cl.BulkRunScheduleId = s.BulkRunScheduleId)
     OR     EXISTS (SELECT 1 FROM @CoverageMatched  cm WHERE cm.BulkRunScheduleId = s.BulkRunScheduleId))
```

Nothing else in either block changes. The depot joins stay in front; a ZIP that is in a coverage zone
but whose zones carry no depot still gets nothing, as today.

### 4.3 Header comment

Replace lines 62 to 64 ("no US change") with a pointer to this spec and the rule in section 2.

### 4.4 What is deliberately not changed

- `DD_stpJob_Scheduler_Rates`: takes its candidates from the function, so a schedule the function
  drops never reaches it. Its `ZoneRated` gate (line 1447) never fires on US and is left alone. If the
  team later wants belt and braces, the same two sets can be built there; not in this change.
- `DD_stpGetExceleratorRates`, `UTL_fncJob_ExceleratorRate`, the API `GetUSRatesAsync` merge: no
  change. Part 2 lives elsewhere (section 8).
- `uspPrebookSet`: out of scope, as in 6.3. Prebook books onto a schedule the client already chose.
- Pickup-side zone ticks (`BulkPickupZoneSchedule`) on US: not read today and not added here. The US
  body has no pickup zone-group predicate (comment at ~line 1000). A later item, the US twin of 6.4.

### 4.5 Regression gate before merge (staging, OTG and Cheetah)

With no US schedule carrying zones or bound ZIPs (3a = 0 rows), the new function must return exactly
the old rows. Keep a copy of the current function as `DD_fncJob_GetClientAvailableBulkRunSchedule_pre`
on staging, run both for every distinct `(ClientID, FromZip, ToZip)` quoted on that tenant in the last
30 days (`tucJob` pickup and delivery ZIPs are enough), and `EXCEPT` both ways. Expect zero rows. Then
tick one zone on one test schedule and confirm the function narrows (section 7, tests 1 to 4). Drop
the `_pre` copy after.

---

## 5. Routed Operations

### 5.1 Leg zone picker lists US zones under the leg's depot

- `GetLookupsAsync` (`ScheduleService.cs:1198`): on a US tenant (`IsUsTenant()` as in
  `TerritoryService`), build the list from `ZoneName` instead of `BulkZonePostcode`. The DTO gains a
  labelled shape next to `ZoneNumbers` (keep `ZoneNumbers` for NZ callers):
  `Zones: List<ZoneOptionDto(int Zone, string Label, int? DepotId, int ZipCount)>`. On NZ `Zone` is
  the zone number and `Label` the `BulkZonePostcode.Name`; on US `Zone` is `ZoneNameID` (D1), `Label`
  the zone name, `DepotId` the `LocationID`.
- `ChainBuilder.tsx` (`:834`, `:1236`): render the picker from `Zones` when non-empty. Filter to the
  leg's depot (`DepotId = the leg's region`); show zones with no depot greyed with "no depot set"
  rather than hiding them, so the operator learns why. Chip label = zone name, with the ZIP count,
  listed under the zone's `ZoneGroup` name as a heading (2.1), so pricing zones and coverage zones
  read as two families. `ZoneOptionDto` gains `string GroupLabel` (null on NZ).
- Save path unchanged: `req.Zones[{ zone: ZoneNameID, active }]` to `BulkZoneSchedule`. Null still
  means leave alone (F7).
- `ScheduleDetailModal` Coverage tab: on US paint the ticked zones' ZIPs from `ZoneZip` plus the bound
  ZIPs, the same union the SQL applies. `ScheduleCoverageMap` already draws US polygons bound to
  zone names (`BindPolygonsModal`); where a zone has none, list the ZIPs.

### 5.2 Paste on the schedule postcode picker

`PostcodeLookupInput.tsx` gains a "+ paste" box, same contract as parent 11.8: comma, space, semicolon
or newline separated; on US 5 digits (zero-pad 4-digit input and warn); de-duplicate; resolve each
against `/api/territory/us/zip-zones` (NZ: `/nz/postcodes`). Result list: added / already bound /
not in any zone (warn, not added by default, with "add anyway"). A ZIP in no zone can never be offered
because the depot rule runs first; the warning says so. Display zero-padded everywhere the picker and
the Coverage tab show a US ZIP.

### 5.3 US zone editor: ZIP paste (the depot editor already exists)

Already on master from Kevin's 22 Oct work `[V]`: Schedules NEW > Zone groups on US edits a zone's
name, `ZoneGroup` and depot (`ZoneGroupsTab.tsx` zone-name modal: Name / Zone Group / Location
(Depot), over `POST/PUT us/zone-names` with `ZoneNameUpsertRequest { Name, ZoneGroupId, LocationId }`),
and creates, renames and deletes zone groups (`POST/PUT/DELETE us/zone-groups`). Nothing to build
there. `zoneGroupId` is the family switch of 2.1: a coverage zone is created in a coverage group,
never in a rate-card group; the modal's Zone Group select already offers both.

The gap is volume. The Zones tab adds one ZIP per request (`POST us/zip-zones`, `ZonesTab.tsx:340`),
so 602 ZIPs across eight coverage zones is 602 form submissions.

- `POST us/zone-names/{id}/zips` takes a pasted list and adds `ZoneZip` rows in one call (the US
  twin of 11.8's `postcode-groups/{id}/zones/{zone}/postcodes`). Returns added / already in this zone /
  ignored. A ZIP already in another zone is **added here as well**, not moved: on US a ZIP in several
  zones is normal (pricing zone plus coverage zone, 2.1). Store the ZIP exactly as the tenant's
  existing rows are stored (3b decides padded or not); never mix spellings within a tenant.
- Rows written by the paste: `ZoneNameID` = the zone, `Zip` as above, `ApplyCongestion = 0`,
  `ClientID` from an optional request field (default NULL), `ZoneNumber` NULL unless 3b says OTG
  keeps it one-to-one with the zone, `ZoneZipGroupID` NULL. These are the 2.1 rules; the paste never
  writes a congestion flag.
- UI: a "+ paste ZIPs" box on the zone row in the Zone groups tab, same contract as 5.2
  (separators, 5-digit padding with a warning, de-duplicate), result list added / already here /
  ignored.
- Zip Groups stay hidden on US. Nothing in this spec touches `ZoneZipGroupID` or `PostcodeGroupId`.

---

## 6. Cheetah after the code lands (configuration, Dane)

Replaces the rollout in Dane's report. Ruth's file: 602 ZIPs, eight distinct weekday patterns.

1. Set the depot on zones 39 GRANDVIEW and 40 KC OUTER to Kansas City (bulk region 29) in Schedules
   NEW > Zone groups (the zone-name modal's Location (Depot) select; it exists today, open point 5 is
   only whether Cheetah has the deploy). Zone 40 keeps the 602 ZIPs and the $120 / $150 lanes; it is
   the pricing zone and is never ticked on a schedule.
2. Create a zone group "KC coverage" (2.1), then eight coverage zones in it under Kansas City, one per
   weekday pattern ("KC Mon+Thu", "KC Fri", ...), and paste each pattern's ZIPs (5.3). 602 rows once,
   all with the congestion flag off. Hold back the 118 ZIPs Dane listed (116 "DOS NOT ON FILE",
   64429 / 64430 with no territory, 65333 with no day) until Hub Group answers.
3. Five schedules, Monday to Friday, 07:00 to 20:00, region Kansas City, origin Depot, linked to
   Hub Group (client-specific; the 6.1 fix is on master). Speed left as "any" so one schedule serves
   both 418 and 419 (`t1.SpeedID = s.SpeedId OR s.SpeedId IS NULL`), or ten schedules if ops prefer
   one per speed. On each schedule's Delivery leg tick every pattern zone whose pattern includes that
   weekday.
4. `UseSchedules = 1` on both Hub Group speeds; `ZoneRated` stays 0 (3d).
5. Quotes only, no bookings: run section 7 live. A ZIP that changes days later is one move between
   pattern zones.

---

## 7. Acceptance (staging first, then Cheetah)

Cheetah data: pickup 1200 Main St, Grandview, MO 64030. Customer Hub Group (84). Speeds 418 / 419.

| # | Setup | Quote | Expected |
|---|---|---|---|
| 1 | Mon schedule ticks "Mon+Thu" zone (holds 65201); Fri schedule ticks "Fri" zone (holds 63501) | 64030 to 65201, next Mon | Mon dated line, $120 / $150 |
| 2 | same | 64030 to 65201, next Fri | no line |
| 3 | same | 64030 to 63501, next Fri | Fri dated line |
| 4 | same | 64030 to 63501, next Mon | no line |
| 5 | a schedule with no ticks and no bound ZIPs, any US tenant | any ZIP under its depot | identical to before the change (4.5) |
| 6 | schedule with no ticks, one bound ZIP 65201 | 65201 / 63501 | offered / not offered |
| 7 | ticked zone plus a bound ZIP outside it | the bound ZIP | offered (union, not intersection) |
| 8 | ticked zone whose depot is NULL | a ZIP in it | no line, and the picker showed the zone greyed |
| 9 | ZIP stored as "07030" on a test zone, OTG staging | quote to 07030 | matches (both spellings) |
| 10 | `UseSchedules = 0` on the client speed | any | on-demand lines only, as today |
| 11 | client-specific `ZoneZip` row (`ClientID` = another client) in the ticked zone | quote for Hub Group | not matched |

Part 2 tests from Dane's table (no undated line, API booking refused, hybrid customers) belong to the
Part 2 spec, not this one.

---

## 8. Out of scope, and why

- **Part 2: schedule-only speeds.** On US the on-demand rate path ignores `UseSchedules`, the API
  keeps on-demand rows next to schedule rows, and the only day control on a client speed is a
  speed-wide weekday mask. So a Hub Group user can still book the undated $120 line on a Thursday.
  Dane's Fix 2 (an opt-in "schedule only" flag on `tblClientAvailableSpeed`, the on-demand rows
  removed in `DD_stpGetExceleratorRates` or `GetUSRatesAsync`, and a booking guard in
  `BookExceleratorPickupAsync`) is the right shape. Whether it blocks Cheetah's go-live depends on
  how Hub Group will book: through the booking page or API directly, it does; through Cheetah's bulk
  import or portal with Cheetah ops choosing the day, it does not. Question for Dane (open point 4).
  Separate spec once answered.
- Pickup-side zone ticks on US (twin of 6.4). Not read today; not added here.
- `uspPrebookSet` and the six prebook sites.
- Polygons as US coverage (`tblSchedulePolygon`, `BulkRunPolygonZip`): the NZ polygon fallback only
  fills the depot lookup when the setting is on; no US polygon coverage in this change.
- Zip Groups (`ZoneZipGroupID`) on US.

---

## 9. Open points

| # | Point | Owner |
|---|---|---|
| 1 | 3a to 3e on OTG and Cheetah production, pasted on the card | Kerran (prod write access, SELECT only here) or Kevin |
| 2 | Whether `ZoneNumber` is one-to-one with `ZoneNameID` on OTG (D1 holds either way) | from 3b |
| 3 | NJ leading-zero ZIPs: if 3b shows padded rows, raise the existing depot-lookup miss as its own item | Kevin |
| 4 | Hub Group's booking channel, which decides whether Part 2 blocks go-live | Dane |
| 5 | Cheetah routed-operations and dbmigrationsv2 production deploys: both auto-deploy since `bf51541`? Confirm from the pipeline before telling Dane the UI is there | Steve / Garry |

---

## Milestones

| | Title | Done when |
|---|---|---|
| M0 | Count-first queries and decisions | 3a to 3e results on the card; D1, the leading-zero handling and the 2.1 coverage-row rules confirmed against them |
| M1 | Migration: coverage predicate in both US candidate blocks | Migration on an MR; 4.5 regression gate zero rows on OTG and Cheetah staging; tests 1 to 4, 9, 11 pass on staging via the function directly |
| M2 | Leg zone picker lists US zones under the leg's depot; Coverage tab paints the union | A US schedule can tick a zone in Schedules NEW and the tick lands in `BulkZoneSchedule` as `ZoneNameID`; test 8 greyed state shown |
| M3 | Paste on the schedule postcode picker; zero-padded display | 100 pasted ZIPs bind in one save; unknown ZIPs warned |
| M4 | ZIP paste into a US zone (depot editor already exists) | `POST us/zone-names/{id}/zips` live with the 2.1 row rules; "+ paste ZIPs" on the Zone groups tab; a coverage group with eight zones built on Cheetah staging from Ruth's file in one sitting |
| M5 | Staging acceptance | Section 7 table green on Cheetah staging, quotes only |
| M6 | Production: OTG and Cheetah | Deployed; 3a re-run shows only the intended Cheetah schedules limited; Dane runs section 6 and the live quote checks |
