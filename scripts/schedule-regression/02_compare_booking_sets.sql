/*
    02_compare_booking_sets.sql
    -------------------------------------------------------------------
    Re-runs the same probes AFTER the schedule/client link migration and
    diffs against the baseline captured by 01.

    Requires dbo.ZZ_SchedRegr_Probe and dbo.ZZ_SchedRegr_Baseline to still
    exist from the pre-migration run. Do not re-run 01 first - it rebuilds
    the probe set and drops the baseline.

    Decides regression tests 1-4 and 6 in the report.
*/

SET NOCOUNT ON;
SET XACT_ABORT ON;
GO

DECLARE @Variant  sysname  = N'UTL';         -- 'UTL' = NZ, 'DD' = US. Match the 01 run.
DECLARE @JobTypeID int     = NULL;           -- match the 01 run
DECLARE @ProbeDate datetime = CAST(CAST(DATEADD(day, 1, GETDATE()) AS date) AS datetime);

IF OBJECT_ID('dbo.ZZ_SchedRegr_Baseline') IS NULL
BEGIN
    THROW 50100, 'No baseline. Run 01_capture_booking_baseline.sql before the migration.', 1;
END

IF OBJECT_ID('dbo.ZZ_SchedRegr_After') IS NOT NULL DROP TABLE dbo.ZZ_SchedRegr_After;

SELECT TOP (0) * INTO dbo.ZZ_SchedRegr_After FROM dbo.ZZ_SchedRegr_Baseline;

DECLARE @sql nvarchar(max) = N'
INSERT INTO dbo.ZZ_SchedRegr_After
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
/* CHECK 1 - headline. Schedule-set parity per client.                  */
/* Compared on the schedule DEFINITION, not on the id, because the      */
/* migration is allowed to change ids. Must return zero rows.           */
/* ------------------------------------------------------------------ */

WITH B AS (
    SELECT DISTINCT ClientId, ClientHasOwn, Name, [DayOfWeek], StartTime, SpeedId, CutoffHours
    FROM dbo.ZZ_SchedRegr_Baseline
),
A AS (
    SELECT DISTINCT ClientId, ClientHasOwn, Name, [DayOfWeek], StartTime, SpeedId, CutoffHours
    FROM dbo.ZZ_SchedRegr_After
)
SELECT 'LOST - client no longer offered this schedule' AS Finding, *
FROM (SELECT * FROM B EXCEPT SELECT * FROM A) x
UNION ALL
SELECT 'GAINED - client newly offered this schedule', *
FROM (SELECT * FROM A EXCEPT SELECT * FROM B) y
ORDER BY Finding, ClientId, Name, [DayOfWeek];

/* ------------------------------------------------------------------ */
/* CHECK 2 - the UNION regression, isolated.                            */
/* Counts defaults newly offered to clients that own a schedule for     */
/* the SAME speed and weekday. Today's fallback rule suppresses these.  */
/* Non-zero here is finding 1 reproduced.                               */
/* ------------------------------------------------------------------ */

SELECT
    a.ClientId,
    a.Name          AS DefaultScheduleNewlyOffered,
    a.SpeedId,
    a.[DayOfWeek],
    own.Name        AS ClientOwnScheduleForSameSlot
FROM dbo.ZZ_SchedRegr_After a
JOIN dbo.ZZ_SchedRegr_After own
      ON  own.ClientId    = a.ClientId
      AND own.SpeedId     = a.SpeedId
      AND own.[DayOfWeek] = a.[DayOfWeek]
      AND own.RowClientId IS NOT NULL
WHERE a.RowClientId IS NULL
  AND NOT EXISTS (
        SELECT 1 FROM dbo.ZZ_SchedRegr_Baseline b
        WHERE b.ClientId = a.ClientId AND b.Name = a.Name
          AND b.SpeedId = a.SpeedId AND b.[DayOfWeek] = a.[DayOfWeek]
  )
ORDER BY a.ClientId, a.Name;

/* ------------------------------------------------------------------ */
/* CHECK 3 - definition drift on ambiguous names.                       */
/* For the 164 names with differing definitions and the 48 shared       */
/* between a default and client schedules, the client must still get    */
/* the SAME cutoff and start time it got before.                        */
/* ------------------------------------------------------------------ */

SELECT
    b.ClientId, b.Name, b.[DayOfWeek],
    b.StartTime   AS StartTime_Before, a.StartTime   AS StartTime_After,
    b.CutoffHours AS CutoffHours_Before, a.CutoffHours AS CutoffHours_After
FROM dbo.ZZ_SchedRegr_Baseline b
JOIN dbo.ZZ_SchedRegr_After a
      ON  a.ClientId    = b.ClientId
      AND a.Name        = b.Name
      AND a.[DayOfWeek] = b.[DayOfWeek]
      AND a.SpeedId     = b.SpeedId
WHERE ISNULL(a.CutoffHours, -1) <> ISNULL(b.CutoffHours, -1)
   OR ISNULL(a.StartTime, '00:00') <> ISNULL(b.StartTime, '00:00')
ORDER BY b.ClientId, b.Name;

/* ------------------------------------------------------------------ */
/* CHECK 4 - clients with no schedule of their own keep the defaults.   */
/* Brief §6 names this case explicitly. Must return zero rows.          */
/* ------------------------------------------------------------------ */

SELECT b.ClientId, b.Name, b.[DayOfWeek], 'default lost' AS Finding
FROM dbo.ZZ_SchedRegr_Baseline b
WHERE b.ClientHasOwn = 0
  AND NOT EXISTS (
        SELECT 1 FROM dbo.ZZ_SchedRegr_After a
        WHERE a.ClientId = b.ClientId AND a.Name = b.Name AND a.[DayOfWeek] = b.[DayOfWeek]
  );

/* ------------------------------------------------------------------ */
/* Summary                                                              */
/* ------------------------------------------------------------------ */

SELECT 'Baseline rows' AS Metric, COUNT(*) AS Value FROM dbo.ZZ_SchedRegr_Baseline
UNION ALL SELECT 'After rows', COUNT(*) FROM dbo.ZZ_SchedRegr_After
UNION ALL SELECT 'Defaults to owning clients - before',
       COUNT(*) FROM dbo.ZZ_SchedRegr_Baseline WHERE ClientHasOwn = 1 AND RowClientId IS NULL
UNION ALL SELECT 'Defaults to owning clients - after',
       COUNT(*) FROM dbo.ZZ_SchedRegr_After    WHERE ClientHasOwn = 1 AND RowClientId IS NULL;
GO
