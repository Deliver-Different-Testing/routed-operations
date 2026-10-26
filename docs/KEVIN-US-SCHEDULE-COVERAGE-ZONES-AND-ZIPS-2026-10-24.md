# US schedules: selected zones and bound ZIPs limit what a schedule serves

**Owner:** Kevin. **Written:** 24 Oct 2026 (Steve, via Claude). **Status:** spec, not started.
**Revised 27 Oct 2026** after Kevin's count-first report (Slack, 27 Oct 09:59): D1 reversed, a third
live US tenant (Medical Couriers) added, the rule put behind a tenant setting. Changes are marked
**[27 Oct]**.
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
- **[27 Oct]** A leg tick on US is a **zone number under the schedule's depot**, the same reading as
  NZ, not a `ZoneName` id. Kevin measured it: Medical Couriers production, a third live US tenant,
  has 47 live schedules carrying 77 active ticks, every one resolves as a number under its depot and
  none as a `ZoneName` id. The 24 Oct D1 would have dropped every Medical schedule. D1 is reversed
  (section 2) and nothing is converted.
- **[27 Oct]** Those ticks have never been enforced on US, so enforcing them is a behaviour change on
  a tenant nobody has talked to. The rule goes behind a tenant setting
  (`tblSetting.ScheduleCoverageEnabled`, default off): on for Cheetah first, then OTG and Medical
  Couriers after the 4.5 diff on their staging has been reviewed with their ops. Section 4.
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
- Routed Ops side **[27 Oct, corrected]**: the leg zone picker is not empty on US. Its lookup unions
  the tick table into the list, so on any tenant that has ever ticked (Medical Couriers) it renders
  bare zone numbers with no labels and no depot filter, and that is how the 77 ticks were made. It
  needs to list the zone numbers under the leg's depot with their zone names. The schedule postcode
  picker needs a paste box. Kevin's 22 Oct Zone groups tab already edits a US zone's name, group and depot
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
  alone). `GetLookupsAsync` (`ScheduleService.cs:1198`) builds `ZoneNumbers` from `BulkZonePostcode`
  union `BulkZoneSchedule`; `ChainBuilder.tsx:834` and `:1236` render the picker only when that list is
  non-empty. **[27 Oct]** On a US tenant `BulkZonePostcode` is empty but the union brings in every
  number ever ticked, so on Medical Couriers the picker shows bare numbers with no label and no depot
  filter; on a fresh tenant (Cheetah) it is hidden until the first tick, which can only come from
  elsewhere. Either way the numbers are `ZoneZip.ZoneNumber` values.
- Bound ZIPs: `ScheduleService.SyncPostcodesAsync` (`:2455`) writes `tblSchedulePostcode` from
  `req.PostcodeIds`; `PostcodeLookupInput.tsx` is already US-aware (5 digits, `/api/territory/us/zip-zones`).
  `tblSchedulePostcode.ScheduleId` is the header id (added nullable by `20261016165000`; the
  `(ScheduleName, PostCode)` key is still the primary key until the follow-up migration). `PostCode` is `int`.

US zone tables (`Core/Domain/Despatch/ZoneZip.cs`, `ZoneName.cs`):

| Table | Columns that matter |
|---|---|
| `ZoneName` | `ZoneNameID`, `ZoneName`, `ZoneGroupId` (rate card grouping), `LocationID` (depot, nullable, FK `tblBulkRegion`) |
| `ZoneZip` | `ZoneZipID`, `Zip` (varchar), `ZoneNameID`, `ZoneNumber` (int, nullable), `ClientID` (nullable), `ApplyCongestion`, `ZoneZipGroupID` (unread) |

Territory API on master: `GET us/zone-names`, `GET us/zone-groups`, `GET us/zip-zones`,
`POST/PUT/DELETE us/zip-zones/{id}` (one ZIP per request), `POST/PUT/DELETE us/zone-names/{id}`
(`ZoneNameUpsertRequest { Name, ZoneGroupId, LocationId }`) and `POST/PUT/DELETE us/zone-groups/{id}`.
**[27 Oct, corrected]** The zone-name routes exist and Kevin's 22 Oct Zone groups tab calls them
(`ZoneGroupsTab.tsx`, Name / Zone Group / Location (Depot)), so a US zone's depot is editable in the
UI today; the 24 Oct text saying otherwise was stale. Cheetah's zones 39 and 40 have `LocationID = NULL`
(Dane's export, 23 Oct) because nobody has set it yet, not because nothing can.

---

## 2. The rule

Same words as parent 6.3, applied to US:

> A schedule that has any active zone tick or any bound ZIP is limited to the ZIPs of those zones plus
> the bound ZIPs, whatever its speed. A schedule with neither is open to its depot, as today. The depot
> rule is unchanged and still applies first.

Consequences:

- **[27 Oct]** Existing ticks are not zero. Measured by Kevin on 27 Oct: Medical Couriers production
  3a = 47 live schedules (every live schedule on the tenant), 77 active ticks; the DFRNT seed, which is
  a copy of Medical Couriers, 53 schedules. OTG and Cheetah are unmeasured (open point 1). None of
  those ticks is read today, so with the setting off nothing changes anywhere; with it on, those
  schedules become limited to their ticked zones for the first time. That is why the setting exists
  and why the 4.5 diff is reviewed per tenant before it is switched on.
- **[27 Oct]** A ticked zone is "the `ZoneZip` rows whose `ZoneNumber` is the tick and whose
  `ZoneName.LocationID` is the schedule's region". That is the NZ reading (`BulkZonePostcode.Zone`
  under `p.DepotId = s.Region`) with `ZoneZip` in place of `BulkZonePostcode`. Two zones at one depot
  may share a number (Medical Couriers depot 35: Sacramento and SMF are both 1); the tick then means
  both, a union, which is what "zone 1 at this depot" meant to whoever ticked it.
- A ZIP may be in several zones; the rate function builds `@ToZoneIDs` as the list of all of them
  (`20261019150000`, lines 226 to 227, commented "supports duplicate zip entries") and matches
  `ZoneCombo` lanes with `IN` (lines 261, 268, 281, 292), so a coverage zone with no lane never
  prices. Section 2.1.
- A zone with no depot never matches, because `ZoneName.LocationID = s.Region` is part of the join.
  The picker only offers numbers under the leg's depot (section 5.1), so this is a safety net, not a
  user-facing rule.
- Client-specific ZIP rows (`ZoneZip.ClientID`) count for that client only, as in the rate function.
- Bound ZIPs match on the integer: `tblSchedulePostcode.PostCode = @ToPostCode`. The function receives
  the ZIP as `int`, so a leading zero is gone before the function is called; a 5-digit US ZIP compared
  as `int` is still unique. Display is zero-padded (section 5.2).

**D1, zone key on US (reversed 27 Oct).** `BulkZoneSchedule.Zone` on US is a **zone number**
(`ZoneZip.ZoneNumber`), resolved under the schedule's depot, exactly as NZ resolves
`BulkZonePostcode.Zone`. The 24 Oct version chose `ZoneName.ZoneNameID` because `ZoneNumber` is
nullable and per row; Kevin's count-first run showed the live data is numbers (77 of 77 Medical
Couriers ticks resolve as numbers under their depot, 0 as `ZoneNameID`) and the picker writes numbers.
Rejected alternatives, with Kevin's reasons:

- *Convert the ticks to `ZoneNameID`.* Clean on Medical Couriers (77 ticks, one zone each, no orphans)
  but the seed has 18 ambiguous, 16 unresolvable and 40 rows on day rows that no longer exist, and
  depot plus number is not unique (depot 35), so the conversion needs rules and a failure mode. Not
  needed when nothing is converted.
- *Try both readings, id first then number.* Works today by one row: zone numbers run to 38 on Medical
  Couriers and the lowest `ZoneNameID` with a depot is 39. The first zone numbered 39 or 40 would
  match two different zones.

Consequences of the number reading: a coverage zone must carry a number on its `ZoneZip` rows (5.3
writes it), new coverage zones take a number unused at that depot (3c lists what is used), and the
Zone groups tab's grouping of US members by `ZoneNumber` (`TerritoryService.cs:130`) is now the same
key the schedule uses.

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
`ZoneNumber` on coverage rows **[27 Oct]**: required, the coverage zone's number, the same on every
row of the zone, chosen from the numbers not yet used at that depot (3c). It is the key the tick
resolves by (D1). `ZoneZipGroupID`: NULL, nothing reads it.

---

## 3. Count first (SELECT only; every US tenant's production, Kerran or Kevin)

**[27 Oct]** Every US tenant, not two: OTG, Cheetah and Medical Couriers, plus any other US tenant the
migration pipeline reaches (open point 2). Kevin ran 3a to 3e on Medical Couriers production and the
seed on 27 Oct; his login is refused on `Despatch-Otgcargo-Prod` and `Despatch-Cheetah-Prod`, so those
two are Kerran's. Paste results on the card.

Medical Couriers, 27 Oct (Kevin): 3a = 47 schedules, 77 active ticks, all resolving as numbers under
their depot; 3d = 0; 3e = 0 distance rates, 0 congestion ZIPs; zone numbers run to 38, lowest
`ZoneNameID` with a depot = 39; depot 35 has two zones numbered 1. Seed: 3a = 53; of 75 ticks on day
rows 41 clean, 18 ambiguous, 16 unresolvable, plus 40 ticks on day rows that no longer exist.

```sql
-- 3a. Any US schedule already carrying zone ticks or bound ZIPs? Medical Couriers = 47. On Cheetah,
--     say which rows are Dane's: if the tenant was stood up from the seed it may carry the seed's 53.
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

-- 3c. Every zone with its depot and the number(s) its rows carry. A zone with no depot can never be
--     offered, before or after this change. Numbers > 1 on one zone, or one number shared by two
--     zones at one depot (Medical depot 35), are findings to note, not to fix.
SELECT zn.ZoneNameID, zn.ZoneName, zn.LocationID, zn.ZoneGroupID,
       Zips = COUNT(zz.ZoneZipID),
       Numbers = COUNT(DISTINCT zz.ZoneNumber),
       MinNumber = MIN(zz.ZoneNumber), MaxNumber = MAX(zz.ZoneNumber),
       NullNumbers = SUM(CASE WHEN zz.ZoneNumber IS NULL THEN 1 ELSE 0 END)
FROM dbo.ZoneName zn LEFT JOIN dbo.ZoneZip zz ON zz.ZoneNameID = zn.ZoneNameID
GROUP BY zn.ZoneNameID, zn.ZoneName, zn.LocationID, zn.ZoneGroupID
ORDER BY zn.LocationID, MinNumber, zn.ZoneName;

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

-- 3f. [27 Oct] Ticks under the number reading (D1). Every active tick on a live day row, with how many
--     zones at the schedule's depot carry that number. Zones = 0 is a tick that will never match
--     (the schedule stays limited to its other ticks and bound ZIPs); Zones > 1 is a union.
--     Medical Couriers: 77 rows, all Zones = 1. The migration does not change these rows.
SELECT s.ScheduleId, h.Name, s.BulkRunScheduleId, s.Region, zs.Zone,
       Zones = (SELECT COUNT(DISTINCT zn.ZoneNameID)
                FROM dbo.ZoneZip zz INNER JOIN dbo.ZoneName zn ON zn.ZoneNameID = zz.ZoneNameID
                WHERE zz.ZoneNumber = zs.Zone AND zn.LocationID = s.Region),
       Zips  = (SELECT COUNT(*)
                FROM dbo.ZoneZip zz INNER JOIN dbo.ZoneName zn ON zn.ZoneNameID = zz.ZoneNameID
                WHERE zz.ZoneNumber = zs.Zone AND zn.LocationID = s.Region)
FROM dbo.BulkZoneSchedule zs
INNER JOIN dbo.tblBulkRunSchedule s ON s.BulkRunScheduleId = zs.ScheduleId
INNER JOIN dbo.tblBulkRunScheduleHeader h ON h.ScheduleId = s.ScheduleId AND h.RetiredUtc IS NULL
WHERE zs.Active = 1
ORDER BY s.Region, s.ScheduleId, zs.Zone;

-- Orphan ticks (day row gone): count only; they are inert and are not touched.
SELECT Orphans = COUNT(*) FROM dbo.BulkZoneSchedule zs
WHERE NOT EXISTS (SELECT 1 FROM dbo.tblBulkRunSchedule s WHERE s.BulkRunScheduleId = zs.ScheduleId);
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

-- [27 Oct] Tenant switch. Off = both sets stay empty and the predicate in 4.2 passes every
-- row, so the function is byte-for-byte the old behaviour. Same pattern as
-- tblSetting.PolygonZoneResolutionEnabled (20261007200000). The migration adds the column
-- (bit NOT NULL DEFAULT 0) if missing; nothing turns it on.
DECLARE @CoverageOn bit = ISNULL((SELECT TOP 1 ScheduleCoverageEnabled FROM dbo.tblSetting), 0)

-- Schedules that limit themselves. Small set, materialised once (plan stability; the
-- 8 Oct and 14 Oct booking-page outages were both bad plans on this function).
DECLARE @CoverageLimited TABLE (BulkRunScheduleId int PRIMARY KEY)
IF @CoverageOn = 1
INSERT INTO @CoverageLimited (BulkRunScheduleId)
SELECT s.BulkRunScheduleId
FROM dbo.tblBulkRunSchedule s
WHERE EXISTS (SELECT 1 FROM dbo.BulkZoneSchedule zs
              WHERE zs.ScheduleId = s.BulkRunScheduleId AND zs.Active = 1)
   OR EXISTS (SELECT 1 FROM dbo.tblSchedulePostcode sp
              WHERE sp.ScheduleId = s.ScheduleId)

-- Schedules whose coverage contains the destination ZIP.
DECLARE @CoverageMatched TABLE (BulkRunScheduleId int PRIMARY KEY)

-- (a) by zone [27 Oct, D1 reversed]: an active tick is a zone NUMBER; it matches when a ZoneZip
--     row with that number, under a zone whose depot is the schedule's region, holds the ZIP.
--     Two zones at the depot with the same number both count (union). This is the NZ join
--     (BulkZonePostcode.Zone = zs.Zone AND p.DepotId = s.Region) on the US tables.
IF @CoverageOn = 1
INSERT INTO @CoverageMatched (BulkRunScheduleId)
SELECT DISTINCT s.BulkRunScheduleId
FROM dbo.tblBulkRunSchedule s
INNER JOIN dbo.BulkZoneSchedule zs ON zs.ScheduleId = s.BulkRunScheduleId AND zs.Active = 1
INNER JOIN dbo.ZoneZip zz ON zz.ZoneNumber = zs.Zone
      AND zz.Zip IN (@ToZipText, @ToZipPadded)
      AND (zz.ClientID IS NULL OR zz.ClientID = @ClientID)
INNER JOIN dbo.ZoneName zn ON zn.ZoneNameID = zz.ZoneNameID AND zn.LocationID = s.Region

-- (b) by bound ZIP
IF @CoverageOn = 1
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

### 4.5 Regression gate before merge (staging, every US tenant) **[27 Oct]**

Keep a copy of the current function as `DD_fncJob_GetClientAvailableBulkRunSchedule_pre` on each US
staging (OTG, Cheetah, Medical Couriers, plus any other the pipeline reaches), run both for every
distinct `(ClientID, FromZip, ToZip)` quoted on that tenant in the last 30 days (`tucJob` pickup and
delivery ZIPs are enough), and `EXCEPT` both ways. Two passes:

1. **Setting off.** Expect zero rows on every tenant. This is the merge gate.
2. **Setting on.** On a tenant with no ticks (Cheetah today) expect zero rows. On a tenant with ticks
   (Medical Couriers: 47 schedules) the diff is the list of quotes that lose a schedule because its
   ticks now apply. That list is not a failure; it is the review pack for that tenant's ops before
   their switch is turned on (M6). Kevin's live case to include: client 1, speed 421, 89301 to 90620,
   5 schedules today; the number reading should keep 5, and if it does not the diff explains which tick
   removed which.

Then tick one zone on one test schedule and confirm the function narrows (section 7, tests 1 to 4).
Drop the `_pre` copy after.

---

## 5. Routed Operations

### 5.1 Leg zone picker: labelled zone numbers under the leg's depot **[27 Oct, reworked]**

Today on US the picker renders bare numbers from the tick union (section 1). M2 is about stopping it
offering meaningless numbers, not switching it on.

- `GetLookupsAsync` (`ScheduleService.cs:1198`): on a US tenant (`IsUsTenant()` as in
  `TerritoryService`), build the list from `ZoneZip` grouped by `(ZoneName.LocationID, ZoneNumber)`
  instead of `BulkZonePostcode`. The DTO gains a labelled shape next to `ZoneNumbers` (keep
  `ZoneNumbers` for NZ callers):
  `Zones: List<ZoneOptionDto(int Zone, string Label, int? DepotId, int ZipCount, string GroupLabel)>`.
  On NZ `Zone` is the zone number and `Label` the `BulkZonePostcode.Name`; on US `Zone` is the
  `ZoneNumber` (D1), `Label` the zone name(s) carrying that number at that depot (two names joined
  with " + " when a depot has two zones on one number), `DepotId` the `LocationID`, `GroupLabel` the
  `ZoneGroup` name (2.1). Rows with `ZoneNumber` NULL are not offered.
- `ChainBuilder.tsx` (`:834`, `:1236`): render the picker from `Zones` when non-empty. Filter to the
  leg's depot. A number already ticked on the leg that has no zone at that depot is shown greyed with
  "no zone numbered N at this depot" rather than hidden, so the operator sees why it never matches
  (3f Zones = 0). Chip label = zone name(s), with the ZIP count, listed under the `ZoneGroup` heading
  so pricing zones and coverage zones read as two families.
- Save path unchanged: `req.Zones[{ zone: ZoneNumber, active }]` to `BulkZoneSchedule`. Null still
  means leave alone (F7). Existing ticks are untouched and now display with their names.
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
  `ClientID` from an optional request field (default NULL), **`ZoneNumber` required [27 Oct]**: the
  request carries `zoneNumber`, prefilled from the zone's existing rows when they all agree, otherwise
  typed, and the endpoint refuses a number that another zone at the same depot already uses unless the
  caller passes `allowSharedNumber` (the depot 35 case is legitimate but must be deliberate).
  `ZoneZipGroupID` NULL. These are the 2.1 rules; the paste never writes a congestion flag.
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
   weekday pattern ("KC Mon+Thu", "KC Fri", ...), each with a zone number not yet used at Kansas City
   (3c on Cheetah says which are free; 1 to 8 if none are), and paste each pattern's ZIPs (5.3). 602
   rows once, all with the congestion flag off. Hold back the 118 ZIPs Dane listed (116 "DOS NOT ON
   FILE", 64429 / 64430 with no territory, 65333 with no day) until Hub Group answers.
3. Five schedules, Monday to Friday, 07:00 to 20:00, region Kansas City, origin Depot, linked to
   Hub Group (client-specific; the 6.1 fix is on master). Speed left as "any" so one schedule serves
   both 418 and 419 (`t1.SpeedID = s.SpeedId OR s.SpeedId IS NULL`), or ten schedules if ops prefer
   one per speed. On each schedule's Delivery leg tick every pattern zone whose pattern includes that
   weekday.
4. `UseSchedules = 1` on both Hub Group speeds; `ZoneRated` stays 0 (3d).
5. **[27 Oct]** `tblSetting.ScheduleCoverageEnabled = 1` on Cheetah (Kerran, confirm-then-write; one
   row). Cheetah is the first tenant switched on. OTG and Medical Couriers stay off until their 4.5
   pass-2 diff has been reviewed with their ops (M6).
6. Quotes only, no bookings: run section 7 live. A ZIP that changes days later is one move between
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
| 9 | **[27 Oct] moved to open point 3.** The depot lookup in front of the coverage sets is unpadded and returns early for a padded ZIP (Kevin, live body), so a padded-ZIP quote cannot reach this change. 4.1 keeps both spellings so it works once that item lands | | |
| 10 | `UseSchedules = 0` on the client speed | any | on-demand lines only, as today |
| 11 | client-specific `ZoneZip` row (`ClientID` = another client) in the ticked zone | quote for Hub Group | not matched |
| 12 | **[27 Oct]** `ScheduleCoverageEnabled = 0`, schedule with ticks | any ZIP under its depot | identical to before the change (4.5 pass 1) |
| 13 | **[27 Oct]** two zones at one depot numbered 1 (Medical depot 35 shape), schedule ticks 1 | a ZIP in either zone | offered (union) |
| 14 | **[27 Oct]** Medical Couriers staging, setting on, client 1, speed 421, 89301 to 90620 | quote | the same 5 schedules as before, or the 4.5 pass-2 diff names the tick that removed one |

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
- **[27 Oct]** Converting existing ticks to `ZoneName` ids, and cleaning the seed's ambiguous,
  unresolvable and orphan ticks. Nothing is converted (D1); orphans are inert and stay.
- **[27 Oct]** Turning the setting on for OTG or Medical Couriers. That is a per-tenant decision after
  their 4.5 pass-2 review, not part of the build.

---

## 9. Open points

| # | Point | Owner |
|---|---|---|
| 1 | 3a to 3f on OTG and Cheetah production, pasted on the card (Kevin's login is refused on both; Medical Couriers done 27 Oct) | Kerran (SELECT only) |
| 2 | **[27 Oct]** Which tenants a dbmigrationsv2 migration and a routed-operations deploy reach. The job list is in the shared ci-templates project Kevin cannot read; dbmigrationsv2 holds a medical production value file, so Medical Couriers is assumed in. This absorbs the 24 Oct question about Cheetah auto-deploying since `bf51541` | Garry or George |
| 3 | NJ leading-zero ZIPs: the depot lookup in front of this change is unpadded and returns early (Kevin, live body). Own item; acceptance test 9 moves there | Kevin |
| 4 | Hub Group's booking channel, which decides whether Part 2 blocks go-live | Dane |
| 5 | **[27 Oct]** Kevin's live Medical case (client 1, speed 421, 89301 to 90620, 5 schedules today) re-run on Medical staging under the number reading with the setting on: still 5? | Kevin (M1) |
| 6 | **[27 Oct]** Was Cheetah stood up from the DFRNT seed? If so its 3a may carry the seed's 53 Medical schedules and 40 orphan ticks, and they need to be retired before Cheetah's switch is turned on | Kerran (3a) / George |

---

## Milestones

| | Title | Done when |
|---|---|---|
| M0 | Count-first queries on every US tenant, and decisions | 3a to 3f on OTG, Cheetah and Medical Couriers on the card (Medical done 27 Oct); open points 2 and 6 answered |
| M1 | Migration: tenant setting + coverage predicate in both US candidate blocks, number reading | Migration on an MR; 4.5 pass 1 zero rows on every US staging; pass 2 diff produced for Medical Couriers and test 14 answered; tests 1 to 4, 11 to 13 pass on staging via the function directly |
| M2 | Leg zone picker shows labelled zone numbers under the leg's depot; Coverage tab paints the union | On Medical Couriers staging the 77 existing ticks display with zone names; a new tick lands in `BulkZoneSchedule` as a `ZoneNumber`; a number with no zone at the depot shows greyed |
| M3 | Paste on the schedule postcode picker; zero-padded display | 100 pasted ZIPs bind in one save; unknown ZIPs warned |
| M4 | ZIP paste into a US zone with its zone number (depot editor already exists) | `POST us/zone-names/{id}/zips` live with the 2.1 row rules and the shared-number guard; "+ paste ZIPs" on the Zone groups tab; a coverage group with eight numbered zones built on Cheetah staging from Ruth's file in one sitting |
| M5 | Staging acceptance | Section 7 table green on Cheetah staging with the setting on, quotes only |
| M6 | Production, per tenant | Deployed everywhere with the setting off (no behaviour change); Cheetah switched on and Dane runs section 6; OTG and Medical Couriers switched on only after their pass-2 diff is reviewed with their ops |
