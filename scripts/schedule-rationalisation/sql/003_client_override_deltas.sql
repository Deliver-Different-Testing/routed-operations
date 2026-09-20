-- 003: client overrides as scoped deltas against a ScheduleId, not as cloned schedules.
--
-- Creates dbo.tblBulkRunScheduleOverride — one row per
-- (ScheduleId, ClientId, Scope, LegOrdinal, DayOfWeek), every value column nullable,
-- NULL = inherit from the schedule. Scope is 'schedule' or a leg role, so
-- "this client's pickup window is different" and "this client's destination speed is
-- different" are one row each instead of a second schedule.
--
-- Then folds the two populations of existing overrides into it:
--   A. clones created through the new Schedules view (BaseScheduleId / same-name headers)
--   B. legacy client-specific schedules (Header.LegacyClientId IS NOT NULL) that differ
--      from a default of the same name only within the overridable set
-- Anything differing OUTSIDE the overridable set is NOT an override: it is left alone
-- and listed in the report at the end for a human to decide.
--
-- See docs/KEVIN-SCHEDULES-NEW-FIXES-2026-09-20.md §F1.
--
-- Idempotent where it can be; runs in a transaction and ROLLS BACK unless @Commit = 1.
-- Run it with @Commit = 0 first and send Steve the report.
SET NOCOUNT ON; SET XACT_ABORT ON;
DECLARE @Commit    bit = 0;
DECLARE @CreatedBy nvarchar(100) = N'steve@urgent.co.nz';
DECLARE @Link      sysname = N'dbo.tblBulkRunScheduleClient';   -- from 001

BEGIN TRAN;

------------------------------------------------------------------------
-- 1. The override table.
------------------------------------------------------------------------
IF OBJECT_ID('dbo.tblBulkRunScheduleOverride', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.tblBulkRunScheduleOverride (
        OverrideId  int IDENTITY(1,1) NOT NULL
            CONSTRAINT PK_tblBulkRunScheduleOverride PRIMARY KEY,
        ScheduleId  int NOT NULL
            CONSTRAINT FK_tblBulkRunScheduleOverride_Header
            REFERENCES dbo.tblBulkRunScheduleHeader (ScheduleId),
        ClientId    int         NOT NULL,
        -- 'schedule' = the whole schedule; otherwise the role of one leg in the chain.
        -- No 'linehaul': per-client linehaul differences belong on the client's rating
        -- against the run (see §F9), not on the schedule.
        Scope       varchar(12) NOT NULL,
        -- ordinal within that role; 0 = the first/only one. The read mapper produces at
        -- most one collection, depot and delivery leg today, so this is 0 in practice.
        LegOrdinal  tinyint NOT NULL
            CONSTRAINT DF_tblBulkRunScheduleOverride_LegOrdinal DEFAULT 0,
        -- 0 = every operating day. Reserved so a per-day override needs no migration.
        DayOfWeek   tinyint NOT NULL
            CONSTRAINT DF_tblBulkRunScheduleOverride_DayOfWeek DEFAULT 0,

        -- ---- schedule scope --------------------------------------------------
        CutoffHours        int           NULL,
        CutoffDay          tinyint       NULL,   -- absolute cut-off; unused until §F11
        CutoffTime         time(0)       NULL,
        WeekDays           char(7)       NULL,   -- '1111100' Mon..Sun
        IsActive           bit           NULL,
        DisplayName        nvarchar(200) NULL,   -- §F13
        DisplayDescription nvarchar(500) NULL,

        -- ---- leg scope -------------------------------------------------------
        SpeedId            int           NULL,   -- the speed of THAT leg
        ZoneGroupId        int           NULL,   -- that leg's zone / postcode group
        PickupTimeMode     varchar(10)   NULL,   -- 'window' | 'fixed' | 'on_demand'
        PickupWindowStart  time(0)       NULL,
        PickupWindowEnd    time(0)       NULL,
        AdditionalItemChargingLogic varchar(40) NULL,

        CreatedUtc datetime2(0) NOT NULL
            CONSTRAINT DF_tblBulkRunScheduleOverride_CreatedUtc DEFAULT SYSUTCDATETIME(),
        CreatedBy  nvarchar(100) NOT NULL,
        UpdatedUtc datetime2(0)  NULL,
        UpdatedBy  nvarchar(100) NULL,

        CONSTRAINT UQ_tblBulkRunScheduleOverride
            UNIQUE (ScheduleId, ClientId, Scope, LegOrdinal, DayOfWeek),
        CONSTRAINT CK_tblBulkRunScheduleOverride_Scope
            CHECK (Scope IN ('schedule','collection','depot','delivery')),
        CONSTRAINT CK_tblBulkRunScheduleOverride_WeekDays
            CHECK (WeekDays IS NULL OR WeekDays LIKE '[01][01][01][01][01][01][01]'),
        CONSTRAINT CK_tblBulkRunScheduleOverride_PickupTimeMode
            CHECK (PickupTimeMode IS NULL
                   OR PickupTimeMode IN ('window','fixed','on_demand')),
        CONSTRAINT CK_tblBulkRunScheduleOverride_PickupWindow
            CHECK (PickupWindowStart IS NULL OR PickupWindowEnd IS NULL
                   OR PickupWindowStart < PickupWindowEnd),
        -- a schedule row carries no leg values, a leg row carries no schedule values
        CONSTRAINT CK_tblBulkRunScheduleOverride_ScopeFields CHECK (
            (Scope =  'schedule' AND SpeedId IS NULL AND ZoneGroupId IS NULL
                                 AND PickupTimeMode IS NULL AND PickupWindowStart IS NULL
                                 AND PickupWindowEnd IS NULL
                                 AND AdditionalItemChargingLogic IS NULL)
         OR (Scope <> 'schedule' AND CutoffHours IS NULL AND CutoffDay IS NULL
                                 AND CutoffTime IS NULL AND WeekDays IS NULL
                                 AND IsActive IS NULL AND DisplayName IS NULL
                                 AND DisplayDescription IS NULL)),
        -- never store a row that overrides nothing
        CONSTRAINT CK_tblBulkRunScheduleOverride_NotEmpty CHECK (
            CutoffHours IS NOT NULL OR CutoffDay IS NOT NULL OR CutoffTime IS NOT NULL
         OR WeekDays IS NOT NULL OR IsActive IS NOT NULL OR DisplayName IS NOT NULL
         OR DisplayDescription IS NOT NULL OR SpeedId IS NOT NULL
         OR ZoneGroupId IS NOT NULL OR PickupTimeMode IS NOT NULL
         OR PickupWindowStart IS NOT NULL OR PickupWindowEnd IS NOT NULL
         OR AdditionalItemChargingLogic IS NOT NULL)
    );

    CREATE INDEX IX_tblBulkRunScheduleOverride_Client
        ON dbo.tblBulkRunScheduleOverride (ClientId) INCLUDE (ScheduleId, Scope);
END;

------------------------------------------------------------------------
-- 2. Candidates: headers that look like an override of another header.
--
--    A clone is a header whose Name matches a live header with no LegacyClientId
--    (the default / shared one), and which is reachable from exactly one client.
--    Names are already trimmed and collapsed by 001, so an equality join is safe.
------------------------------------------------------------------------
IF OBJECT_ID('tempdb..#cand') IS NOT NULL DROP TABLE #cand;

SELECT  ov.ScheduleId          AS OverrideScheduleId,
        base.ScheduleId        AS BaseScheduleId,
        ov.Name                AS Name,
        COALESCE(ov.LegacyClientId, lnk.ClientId) AS ClientId
  INTO  #cand
  FROM  dbo.tblBulkRunScheduleHeader ov
  JOIN  dbo.tblBulkRunScheduleHeader base
        ON  base.Name = ov.Name
        AND base.ScheduleId <> ov.ScheduleId
        AND base.LegacyClientId IS NULL
        AND base.RetiredUtc IS NULL
  OUTER APPLY (
        SELECT MIN(l.ClientId) AS ClientId, COUNT(*) AS n
          FROM dbo.tblBulkRunScheduleClient l
         WHERE l.ScheduleId = ov.ScheduleId
  ) lnk
 WHERE  ov.RetiredUtc IS NULL
   AND  COALESCE(ov.LegacyClientId, lnk.ClientId) IS NOT NULL
   AND  (lnk.n IS NULL OR lnk.n <= 1);   -- a clone serves exactly one client

-- The day set of each side, reduced to the fields an override is allowed to carry.
-- Row 0 is NOT good enough here (see §F8): a schedule whose own day rows disagree on
-- one of these fields cannot be folded, because there is no single value to compare.
IF OBJECT_ID('tempdb..#sched') IS NOT NULL DROP TABLE #sched;

SELECT  s.ScheduleId,
        MIN(ISNULL(s.CutoffHours, -1))          AS CutoffHours,
        MAX(ISNULL(s.CutoffHours, -1))          AS CutoffHoursMax,
        MIN(ISNULL(s.SpeedId, -1))              AS SpeedId,
        MAX(ISNULL(s.SpeedId, -1))              AS SpeedIdMax,
        MIN(ISNULL(s.PickupRatingSpeed, -1))    AS PickupSpeedId,
        MAX(ISNULL(s.PickupRatingSpeed, -1))    AS PickupSpeedIdMax,
        MIN(ISNULL(s.PostcodeGroupId, -1))      AS PostcodeGroupId,
        MAX(ISNULL(s.PostcodeGroupId, -1))      AS PostcodeGroupIdMax,
        MIN(ISNULL(s.PickupPostcodeGroupId,-1)) AS PickupPostcodeGroupId,
        MAX(ISNULL(s.PickupPostcodeGroupId,-1)) AS PickupPostcodeGroupIdMax,
        -- day mask, Mon..Sun
        CAST(MAX(CASE WHEN s.DayOfWeek = 1 THEN '1' ELSE '0' END)
           + MAX(CASE WHEN s.DayOfWeek = 2 THEN '1' ELSE '0' END)
           + MAX(CASE WHEN s.DayOfWeek = 3 THEN '1' ELSE '0' END)
           + MAX(CASE WHEN s.DayOfWeek = 4 THEN '1' ELSE '0' END)
           + MAX(CASE WHEN s.DayOfWeek = 5 THEN '1' ELSE '0' END)
           + MAX(CASE WHEN s.DayOfWeek = 6 THEN '1' ELSE '0' END)
           + MAX(CASE WHEN s.DayOfWeek = 7 THEN '1' ELSE '0' END) AS char(7)) AS WeekDays,
        -- fields OUTSIDE the overridable set: if these differ, it is a real schedule
        MIN(ISNULL(s.Region, -1))               AS Region,
        MAX(ISNULL(s.Region, -1))               AS RegionMax,
        MIN(ISNULL(s.PickupDepotId, -1))        AS PickupDepotId,
        MAX(ISNULL(s.PickupDepotId, -1))        AS PickupDepotIdMax,
        MIN(ISNULL(s.ParentSpeedId, -1))        AS ParentSpeedId,
        MAX(ISNULL(s.ParentSpeedId, -1))        AS ParentSpeedIdMax,
        MIN(CAST(s.BookPickup AS int))          AS BookPickup,
        MAX(CAST(s.BookPickup AS int))          AS BookPickupMax,
        MIN(ISNULL(s.StorageState, -1))         AS StorageState,
        MAX(ISNULL(s.StorageState, -1))         AS StorageStateMax,
        MIN(ISNULL(s.DeliveryState, -1))        AS DeliveryState,
        MAX(ISNULL(s.DeliveryState, -1))        AS DeliveryStateMax,
        COUNT(*)                                AS DayRows
  INTO  #sched
  FROM  dbo.tblBulkRunSchedule s
 WHERE  s.ScheduleId IN (SELECT OverrideScheduleId FROM #cand
                         UNION SELECT BaseScheduleId FROM #cand)
 GROUP BY s.ScheduleId;

------------------------------------------------------------------------
-- 3. Classify every candidate.
------------------------------------------------------------------------
IF OBJECT_ID('tempdb..#plan') IS NOT NULL DROP TABLE #plan;

SELECT  c.*,
        CASE
          WHEN o.CutoffHours <> o.CutoffHoursMax
            OR o.SpeedId <> o.SpeedIdMax
            OR o.PickupSpeedId <> o.PickupSpeedIdMax
            OR o.PostcodeGroupId <> o.PostcodeGroupIdMax
            OR o.PickupPostcodeGroupId <> o.PickupPostcodeGroupIdMax
            OR b.CutoffHours <> b.CutoffHoursMax
            OR b.SpeedId <> b.SpeedIdMax
            OR b.PickupSpeedId <> b.PickupSpeedIdMax
            OR b.PostcodeGroupId <> b.PostcodeGroupIdMax
            OR b.PickupPostcodeGroupId <> b.PickupPostcodeGroupIdMax
               THEN 'skip: day rows disagree (see F8)'
          WHEN o.Region <> b.Region
            OR o.PickupDepotId <> b.PickupDepotId
            OR o.ParentSpeedId <> b.ParentSpeedId
            OR o.BookPickup <> b.BookPickup
            OR o.StorageState <> b.StorageState
            OR o.DeliveryState <> b.DeliveryState
               THEN 'skip: differs outside the overridable set'
          WHEN (o.CutoffHours = -1 AND b.CutoffHours <> -1)
            OR (o.SpeedId = -1 AND b.SpeedId <> -1)
            OR (o.PickupSpeedId = -1 AND b.PickupSpeedId <> -1)
            OR (o.PostcodeGroupId = -1 AND b.PostcodeGroupId <> -1)
            OR (o.PickupPostcodeGroupId = -1 AND b.PickupPostcodeGroupId <> -1)
               -- NULL means inherit, so "this client has no value here" is not expressible
               THEN 'skip: clears a value the base sets'
          WHEN o.CutoffHours = b.CutoffHours
           AND o.SpeedId = b.SpeedId
           AND o.PickupSpeedId = b.PickupSpeedId
           AND o.PostcodeGroupId = b.PostcodeGroupId
           AND o.PickupPostcodeGroupId = b.PickupPostcodeGroupId
           AND o.WeekDays = b.WeekDays
               THEN 'fold: identical — retire, no delta needed'
          ELSE 'fold: write delta'
        END AS Disposition,
        o.CutoffHours           AS OvCutoffHours,           b.CutoffHours           AS BaseCutoffHours,
        o.SpeedId               AS OvSpeedId,               b.SpeedId               AS BaseSpeedId,
        o.PickupSpeedId         AS OvPickupSpeedId,         b.PickupSpeedId         AS BasePickupSpeedId,
        o.PostcodeGroupId       AS OvPostcodeGroupId,       b.PostcodeGroupId       AS BasePostcodeGroupId,
        o.PickupPostcodeGroupId AS OvPickupPostcodeGroupId, b.PickupPostcodeGroupId AS BasePickupPostcodeGroupId,
        o.WeekDays              AS OvWeekDays,              b.WeekDays              AS BaseWeekDays
  INTO  #plan
  FROM  #cand c
  JOIN  #sched o ON o.ScheduleId = c.OverrideScheduleId
  JOIN  #sched b ON b.ScheduleId = c.BaseScheduleId;

------------------------------------------------------------------------
-- 4. Write the deltas. One row per scope that actually differs.
------------------------------------------------------------------------
-- 4a. schedule scope: cut-off and days
INSERT dbo.tblBulkRunScheduleOverride
      (ScheduleId, ClientId, Scope, CutoffHours, WeekDays, CreatedBy)
SELECT p.BaseScheduleId, p.ClientId, 'schedule',
       NULLIF(NULLIF(p.OvCutoffHours, p.BaseCutoffHours), -1),
       NULLIF(p.OvWeekDays,    p.BaseWeekDays),
       @CreatedBy
  FROM #plan p
 WHERE p.Disposition = 'fold: write delta'
   AND (p.OvCutoffHours <> p.BaseCutoffHours OR p.OvWeekDays <> p.BaseWeekDays)
   AND NOT EXISTS (SELECT 1 FROM dbo.tblBulkRunScheduleOverride x
                    WHERE x.ScheduleId = p.BaseScheduleId AND x.ClientId = p.ClientId
                      AND x.Scope = 'schedule' AND x.LegOrdinal = 0 AND x.DayOfWeek = 0);

-- 4b. delivery scope: destination speed and delivery zone group
INSERT dbo.tblBulkRunScheduleOverride
      (ScheduleId, ClientId, Scope, SpeedId, ZoneGroupId, CreatedBy)
SELECT p.BaseScheduleId, p.ClientId, 'delivery',
       NULLIF(NULLIF(p.OvSpeedId, p.BaseSpeedId), -1),
       NULLIF(NULLIF(p.OvPostcodeGroupId, p.BasePostcodeGroupId), -1),
       @CreatedBy
  FROM #plan p
 WHERE p.Disposition = 'fold: write delta'
   AND (p.OvSpeedId <> p.BaseSpeedId OR p.OvPostcodeGroupId <> p.BasePostcodeGroupId)
   AND COALESCE(NULLIF(NULLIF(p.OvSpeedId, p.BaseSpeedId), -1),
                NULLIF(NULLIF(p.OvPostcodeGroupId, p.BasePostcodeGroupId), -1)) IS NOT NULL
   AND NOT EXISTS (SELECT 1 FROM dbo.tblBulkRunScheduleOverride x
                    WHERE x.ScheduleId = p.BaseScheduleId AND x.ClientId = p.ClientId
                      AND x.Scope = 'delivery' AND x.LegOrdinal = 0 AND x.DayOfWeek = 0);

-- 4c. collection scope: pickup speed and pickup zone group
INSERT dbo.tblBulkRunScheduleOverride
      (ScheduleId, ClientId, Scope, SpeedId, ZoneGroupId, CreatedBy)
SELECT p.BaseScheduleId, p.ClientId, 'collection',
       NULLIF(NULLIF(p.OvPickupSpeedId, p.BasePickupSpeedId), -1),
       NULLIF(NULLIF(p.OvPickupPostcodeGroupId, p.BasePickupPostcodeGroupId), -1),
       @CreatedBy
  FROM #plan p
 WHERE p.Disposition = 'fold: write delta'
   AND (p.OvPickupSpeedId <> p.BasePickupSpeedId
     OR p.OvPickupPostcodeGroupId <> p.BasePickupPostcodeGroupId)
   AND COALESCE(NULLIF(NULLIF(p.OvPickupSpeedId, p.BasePickupSpeedId), -1),
                NULLIF(NULLIF(p.OvPickupPostcodeGroupId, p.BasePickupPostcodeGroupId), -1)) IS NOT NULL
   AND NOT EXISTS (SELECT 1 FROM dbo.tblBulkRunScheduleOverride x
                    WHERE x.ScheduleId = p.BaseScheduleId AND x.ClientId = p.ClientId
                      AND x.Scope = 'collection' AND x.LegOrdinal = 0 AND x.DayOfWeek = 0);

------------------------------------------------------------------------
-- 5. Move the client's link row onto the base, then retire the clone.
--    The client books the base schedule from here on; its differences are the delta.
------------------------------------------------------------------------
INSERT dbo.tblBulkRunScheduleClient (ScheduleId, ClientId, CreatedBy)
SELECT DISTINCT p.BaseScheduleId, p.ClientId, @CreatedBy
  FROM #plan p
 WHERE p.Disposition LIKE 'fold:%'
   AND NOT EXISTS (SELECT 1 FROM dbo.tblBulkRunScheduleClient l
                    WHERE l.ScheduleId = p.BaseScheduleId AND l.ClientId = p.ClientId);

DELETE l
  FROM dbo.tblBulkRunScheduleClient l
  JOIN #plan p ON p.OverrideScheduleId = l.ScheduleId AND p.ClientId = l.ClientId
 WHERE p.Disposition LIKE 'fold:%';

UPDATE h
   SET h.RetiredUtc = SYSUTCDATETIME(),
       h.RetiredBy  = @CreatedBy
  FROM dbo.tblBulkRunScheduleHeader h
  JOIN #plan p ON p.OverrideScheduleId = h.ScheduleId
 WHERE p.Disposition LIKE 'fold:%'
   AND h.RetiredUtc IS NULL;

------------------------------------------------------------------------
-- 6. Report. Read this before setting @Commit = 1.
------------------------------------------------------------------------
SELECT Disposition, COUNT(*) AS Schedules
  FROM #plan GROUP BY Disposition ORDER BY Disposition;

SELECT 'delta rows written' AS Metric, COUNT(*) AS Value
  FROM dbo.tblBulkRunScheduleOverride
UNION ALL SELECT 'by scope: ' + Scope, COUNT(*)
  FROM dbo.tblBulkRunScheduleOverride GROUP BY Scope;

-- The ones a human has to look at: real differences that an override cannot carry.
SELECT p.OverrideScheduleId, p.BaseScheduleId, p.ClientId, p.Name, p.Disposition
  FROM #plan p
 WHERE p.Disposition LIKE 'skip:%'
 ORDER BY p.Disposition, p.Name;

-- Nothing may resolve to two schedules for one client.
SELECT l.ClientId, l.ScheduleId, COUNT(*) AS LinkRows
  FROM dbo.tblBulkRunScheduleClient l
  JOIN dbo.tblBulkRunScheduleHeader h ON h.ScheduleId = l.ScheduleId
 WHERE h.RetiredUtc IS NULL
 GROUP BY l.ClientId, l.ScheduleId
HAVING COUNT(*) > 1;   -- must return no rows

IF @Commit = 1 COMMIT TRAN; ELSE ROLLBACK TRAN;
GO

------------------------------------------------------------------------
-- 7. The one resolver. Every caller uses this; nobody writes their own COALESCE.
--    Run this part after the table is committed.
------------------------------------------------------------------------
-- CREATE OR ALTER FUNCTION dbo.fnScheduleForClient (@ScheduleId int, @ClientId int)
-- RETURNS TABLE AS RETURN
--   SELECT s.BulkRunScheduleId,
--          s.DayOfWeek,
--          s.StartTime,
--          s.EndTime,
--          COALESCE(so.CutoffHours,       s.CutoffHours)           AS CutoffHours,
--          COALESCE(dl.SpeedId,           s.SpeedId)               AS SpeedId,
--          COALESCE(dl.ZoneGroupId,       s.PostcodeGroupId)       AS PostcodeGroupId,
--          COALESCE(cl.SpeedId,           s.PickupRatingSpeed)     AS PickupRatingSpeed,
--          COALESCE(cl.ZoneGroupId,       s.PickupPostcodeGroupId) AS PickupPostcodeGroupId,
--          COALESCE(cl.PickupWindowStart, s.StartTime)             AS PickupWindowStart,
--          COALESCE(cl.PickupWindowEnd,   s.EndTime)               AS PickupWindowEnd
--     FROM dbo.tblBulkRunSchedule s
--     LEFT JOIN dbo.tblBulkRunScheduleOverride so
--            ON so.ScheduleId = s.ScheduleId AND so.ClientId = @ClientId
--           AND so.Scope = 'schedule' AND so.DayOfWeek IN (0, s.DayOfWeek)
--     LEFT JOIN dbo.tblBulkRunScheduleOverride cl
--            ON cl.ScheduleId = s.ScheduleId AND cl.ClientId = @ClientId
--           AND cl.Scope = 'collection' AND cl.LegOrdinal = 0
--           AND cl.DayOfWeek IN (0, s.DayOfWeek)
--     LEFT JOIN dbo.tblBulkRunScheduleOverride dl
--            ON dl.ScheduleId = s.ScheduleId AND dl.ClientId = @ClientId
--           AND dl.Scope = 'delivery' AND dl.LegOrdinal = 0
--           AND dl.DayOfWeek IN (0, s.DayOfWeek)
--    WHERE s.ScheduleId = @ScheduleId
--      -- a schedule-scope WeekDays override removes days from the client's view
--      AND (so.WeekDays IS NULL OR SUBSTRING(so.WeekDays, s.DayOfWeek, 1) = '1');
