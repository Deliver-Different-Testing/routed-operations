/*
    01_capture_booking_baseline.sql
    -------------------------------------------------------------------
    Captures, per client, the exact set of schedules the booking function
    returns TODAY. Run this BEFORE the schedule/client link migration.
    Run 02_compare_booking_sets.sql after, to diff.

    This is the check that decides finding 1 (the UNION resolution rule).
    Brief acceptance test §6 requires the sample to include a client that
    HAS its own schedule, not only one with none.

    Target function (NZ):  dbo.UTL_fncJob_GetClientAvailableBulkRunSchedule
    Target function (US):  dbo.DD_fncJob_GetClientAvailableBulkRunSchedule
      (@ClientID, @JobTypeID, @Datetime, @FromPostCode, @ToPostCode)

    Read-only apart from the two ZZ_SchedRegr_* capture tables it creates.
    Safe to run on production; it only SELECTs through the function.
*/

SET NOCOUNT ON;
SET XACT_ABORT ON;
GO

-- Which variant to probe. 'UTL' = NZ, 'DD' = US.
DECLARE @Variant sysname = N'UTL';

-- Pass the tenant's bulk job type here. NULL exercises the function's own
-- default, which is what the booking screen does when no type is chosen.
DECLARE @JobTypeID int = NULL;

-- Probe against a fixed date so a re-run is comparable. Use a weekday.
DECLARE @ProbeDate datetime = CAST(CAST(DATEADD(day, 1, GETDATE()) AS date) AS datetime);

/* ------------------------------------------------------------------ */
/* Probe set: one realistic (client, from, to) triple per schedule.     */
/* Postcodes are derived from bulkzonepostcode so that each probe is    */
/* guaranteed to be able to reach the schedule it was built from.       */
/* ------------------------------------------------------------------ */

IF OBJECT_ID('dbo.ZZ_SchedRegr_Probe') IS NOT NULL DROP TABLE dbo.ZZ_SchedRegr_Probe;

CREATE TABLE dbo.ZZ_SchedRegr_Probe
(
    ProbeId            int IDENTITY(1,1) NOT NULL PRIMARY KEY,
    ClientId           int          NOT NULL,
    ClientHasOwn       bit          NOT NULL,   -- 1 = has client-specific schedules
    SourceScheduleId   int          NULL,       -- day-row id the probe was built from
    SourceScheduleName nvarchar(250) NULL,
    FromPostCode       int          NULL,
    ToPostCode         int          NULL
);

-- Clients that own at least one schedule, one probe per distinct schedule.
INSERT INTO dbo.ZZ_SchedRegr_Probe (ClientId, ClientHasOwn, SourceScheduleId, SourceScheduleName, FromPostCode, ToPostCode)
SELECT
    s.ClientId,
    1,
    s.BulkRunScheduleId,
    s.Name,
    fp.postcode,
    tp.postcode
FROM dbo.tblBulkRunSchedule s
OUTER APPLY (
    SELECT TOP (1) z.postcode
    FROM dbo.bulkzonepostcode z
    WHERE z.DepotId = ISNULL(s.PickupDepotId, s.Region)
      AND ISNULL(z.PostcodeGroupId, 0) = ISNULL(s.PickupPostcodeGroupId, ISNULL(z.PostcodeGroupId, 0))
    ORDER BY z.postcode
) fp
OUTER APPLY (
    SELECT TOP (1) z.postcode
    FROM dbo.bulkzonepostcode z
    WHERE z.DepotId = s.Region
      AND ISNULL(z.PostcodeGroupId, 0) = ISNULL(s.PostcodeGroupId, ISNULL(z.PostcodeGroupId, 0))
    ORDER BY z.postcode
) tp
WHERE s.ClientId IS NOT NULL;

-- Clients with NO schedule of their own. These must keep seeing the defaults.
-- Probes are built from the default schedules instead.
INSERT INTO dbo.ZZ_SchedRegr_Probe (ClientId, ClientHasOwn, SourceScheduleId, SourceScheduleName, FromPostCode, ToPostCode)
SELECT
    c.ucclID,
    0,
    s.BulkRunScheduleId,
    s.Name,
    fp.postcode,
    tp.postcode
FROM dbo.tucClient c
CROSS JOIN dbo.tblBulkRunSchedule s
OUTER APPLY (
    SELECT TOP (1) z.postcode FROM dbo.bulkzonepostcode z
    WHERE z.DepotId = ISNULL(s.PickupDepotId, s.Region) ORDER BY z.postcode
) fp
OUTER APPLY (
    SELECT TOP (1) z.postcode FROM dbo.bulkzonepostcode z
    WHERE z.DepotId = s.Region ORDER BY z.postcode
) tp
WHERE s.ClientId IS NULL
  AND NOT EXISTS (SELECT 1 FROM dbo.tblBulkRunSchedule o WHERE o.ClientId = c.ucclID)
  AND c.ucclID IN (
        -- keep the run bounded: 25 such clients is enough for parity
        SELECT TOP (25) c2.ucclID FROM dbo.tucClient c2
        WHERE NOT EXISTS (SELECT 1 FROM dbo.tblBulkRunSchedule o2 WHERE o2.ClientId = c2.ucclID)
        ORDER BY c2.ucclID
  );

/* ------------------------------------------------------------------ */
/* Capture: run the booking function for every probe.                   */
/* ------------------------------------------------------------------ */

IF OBJECT_ID('dbo.ZZ_SchedRegr_Baseline') IS NOT NULL DROP TABLE dbo.ZZ_SchedRegr_Baseline;

CREATE TABLE dbo.ZZ_SchedRegr_Baseline
(
    ProbeId            int           NOT NULL,
    ClientId           int           NOT NULL,
    ClientHasOwn       bit           NOT NULL,
    BulkRunScheduleId  int           NULL,
    Name               nvarchar(250) NULL,
    [DayOfWeek]        smallint      NULL,
    StartTime          time          NULL,
    SpeedId            int           NULL,
    CutoffHours        int           NULL,
    RowClientId        int           NULL,      -- NULL here means a default schedule
    CapturedAt         datetime      NOT NULL DEFAULT (GETDATE())
);

DECLARE @sql nvarchar(max) = N'
INSERT INTO dbo.ZZ_SchedRegr_Baseline
    (ProbeId, ClientId, ClientHasOwn, BulkRunScheduleId, Name, [DayOfWeek], StartTime, SpeedId, CutoffHours, RowClientId)
SELECT p.ProbeId, p.ClientId, p.ClientHasOwn,
       f.BulkRunScheduleId, f.Name, f.[DayOfWeek], f.StartTime, f.SpeedId, f.CutoffHours, f.ClientId
FROM dbo.ZZ_SchedRegr_Probe p
CROSS APPLY dbo.' + QUOTENAME(@Variant + N'_fncJob_GetClientAvailableBulkRunSchedule') + N'
    (p.ClientId, @JobTypeID, @ProbeDate, p.FromPostCode, p.ToPostCode) f;';

EXEC sp_executesql @sql,
     N'@JobTypeID int, @ProbeDate datetime',
     @JobTypeID = @JobTypeID, @ProbeDate = @ProbeDate;

/* ------------------------------------------------------------------ */
/* Summary. Record these numbers before proceeding.                     */
/* ------------------------------------------------------------------ */

SELECT 'Probes'                  AS Metric, COUNT(*) AS Value FROM dbo.ZZ_SchedRegr_Probe
UNION ALL SELECT 'Captured rows',          COUNT(*) FROM dbo.ZZ_SchedRegr_Baseline
UNION ALL SELECT 'Clients with own',       COUNT(DISTINCT ClientId) FROM dbo.ZZ_SchedRegr_Probe WHERE ClientHasOwn = 1
UNION ALL SELECT 'Clients without own',    COUNT(DISTINCT ClientId) FROM dbo.ZZ_SchedRegr_Probe WHERE ClientHasOwn = 0
UNION ALL SELECT 'Default rows returned',  COUNT(*) FROM dbo.ZZ_SchedRegr_Baseline WHERE RowClientId IS NULL
UNION ALL SELECT 'Own rows returned',      COUNT(*) FROM dbo.ZZ_SchedRegr_Baseline WHERE RowClientId IS NOT NULL;

-- The number that finding 1 turns on. Under today's fallback rule this is
-- small: a client that owns a schedule for a given speed+weekday does NOT
-- also get the default for that speed+weekday. Under a UNION rule it grows.
SELECT 'Default rows returned to clients that own a schedule' AS Metric,
       COUNT(*) AS Value
FROM dbo.ZZ_SchedRegr_Baseline
WHERE ClientHasOwn = 1 AND RowClientId IS NULL;
GO
