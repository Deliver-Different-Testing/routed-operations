/*
    03_impact_recurring_and_linehaul.sql
    -------------------------------------------------------------------
    PRE-FLIGHT. Run this BEFORE retiring any schedule.

    Enumerates what a soft-delete would silently break. Read-only.

    Covers report findings 2 (recurring bookings stop silently) and
    4 (RunViewer linehaul drop-out and miscount).
*/

SET NOCOUNT ON;
GO

/* ================================================================== */
/* A. Recurring bookings                                               */
/*                                                                     */
/* uspPrebookSet gates every firing on this existence check:           */
/*                                                                     */
/*   IF NOT EXISTS (SELECT 1 FROM tblBulkRunSchedule                   */
/*                  WHERE Name = @CurScheduleName                      */
/*                    AND (ClientId = @CurClientID OR ClientId IS NULL)*/
/*                    AND DayOfWeek = @TargetIsoDayOfWeek)             */
/*       SET @TargetMatch = 0                                          */
/*                                                                     */
/* When it fails the booking does not fire. Nothing is logged.         */
/* ================================================================== */

-- A1. Every active recurring booking that is bound to a schedule, with the
--     day rows that currently satisfy its gate. Any booking showing
--     MatchingDayRows = 0 is ALREADY not firing and is worth knowing about
--     before the migration is blamed for it.
SELECT
    jb.ucbkID              AS BookingId,
    jb.ucbkClientID        AS ClientId,
    jb.ScheduleID          AS BookingScheduleId,
    jb.ScheduleName,
    COUNT(s.BulkRunScheduleId) AS MatchingDayRows,
    MAX(CASE WHEN s.ClientId IS NULL THEN 1 ELSE 0 END) AS MatchesADefault,
    MAX(CASE WHEN s.ClientId = jb.ucbkClientID THEN 1 ELSE 0 END) AS MatchesOwn
FROM dbo.tucJobBooking jb
LEFT JOIN dbo.tblBulkRunSchedule s
       ON s.Name = jb.ScheduleName
      AND (s.ClientId = jb.ucbkClientID OR s.ClientId IS NULL)
WHERE jb.ucbkActive = 1
  AND jb.ucbkOneOff = 0
  AND ISNULL(jb.ScheduleID, 0) > 0
GROUP BY jb.ucbkID, jb.ucbkClientID, jb.ScheduleID, jb.ScheduleName
ORDER BY MatchingDayRows, jb.ucbkClientID;

-- A2. THE ONE THAT MATTERS. Active recurring bookings whose ONLY matching
--     day rows belong to a schedule that the rationalisation would retire.
--     Populate #ToRetire with the schedule names/ids the merge will retire
--     (from retired_schedule_rows.csv) before running this.
IF OBJECT_ID('tempdb..#ToRetire') IS NULL
BEGIN
    CREATE TABLE #ToRetire (Name nvarchar(250) NOT NULL, ClientId int NULL);
    -- INSERT INTO #ToRetire (Name, ClientId) VALUES (N'...', 12345);
    PRINT 'Populate #ToRetire from the merge output, then re-run section A2.';
END

SELECT
    jb.ucbkID       AS BookingId,
    jb.ucbkClientID AS ClientId,
    jb.ScheduleName,
    'recurring booking stops firing if this schedule is retired' AS Risk
FROM dbo.tucJobBooking jb
WHERE jb.ucbkActive = 1
  AND jb.ucbkOneOff = 0
  AND ISNULL(jb.ScheduleID, 0) > 0
  AND EXISTS (
        SELECT 1 FROM #ToRetire r
        WHERE r.Name = jb.ScheduleName
          AND (r.ClientId = jb.ucbkClientID OR r.ClientId IS NULL)
  )
  -- and nothing else would satisfy the gate afterwards
  AND NOT EXISTS (
        SELECT 1
        FROM dbo.tblBulkRunSchedule s
        WHERE s.Name = jb.ScheduleName
          AND (s.ClientId = jb.ucbkClientID OR s.ClientId IS NULL)
          AND NOT EXISTS (
                SELECT 1 FROM #ToRetire r2
                WHERE r2.Name = s.Name
                  AND (r2.ClientId = s.ClientId
                       OR (r2.ClientId IS NULL AND s.ClientId IS NULL))
          )
  )
ORDER BY jb.ucbkClientID;

-- A3. Day rows missing the legacy ClientId. Brief §5 says keep writing it;
--     compat.test.ts currently asserts the opposite. A row with a NULL
--     ClientId reads as a DEFAULT to the gate above, so it matches every
--     client with a booking of that name.
SELECT
    s.BulkRunScheduleId, s.Name, s.[DayOfWeek],
    'NULL ClientId - reads as a default to uspPrebookSet' AS Risk
FROM dbo.tblBulkRunSchedule s
WHERE s.ClientId IS NULL
  AND EXISTS (
        -- a same-named schedule IS owned by someone, so this name is not
        -- unambiguously a shared default
        SELECT 1 FROM dbo.tblBulkRunSchedule o
        WHERE o.Name = s.Name AND o.ClientId IS NOT NULL
  )
ORDER BY s.Name, s.[DayOfWeek];

/* ================================================================== */
/* B. RunViewer linehaul                                               */
/*                                                                     */
/* RVW_stpLinehaulOverview and RVW_stpLinehaulJobs join                */
/*   tblBulkScheduleLinehaul.BulkRunScheduleId = tblBulkRunSchedule    */
/*     .BulkRunScheduleId          <- DAY ROW ids, not header ids      */
/* and their WHERE clauses turn the LEFT JOINs into effective inner    */
/* joins whenever a depot is selected:                                 */
/*   ((@ToDepotID = 0 and bsl.BulkRunScheduleId is null) or ...)       */
/* so a retired schedule both drops the row from depot-filtered lists  */
/* AND miscounts it into the unassigned-depot bucket.                  */
/* ================================================================== */

-- B1. Historic linehaul jobs whose schedule would be retired. Each of these
--     is a row that must still render after the merge.
SELECT
    j.ucjbID       AS JobId,
    j.ucjbNumber   AS JobNumber,
    j.ScheduleID   AS DayRowScheduleId,
    s.Name         AS ScheduleName,
    bsl.ToDepotID
FROM dbo.tucJob j
JOIN dbo.tblBulkRunSchedule s      ON s.BulkRunScheduleId  = j.ScheduleID
LEFT JOIN dbo.tblBulkScheduleLinehaul bsl ON bsl.BulkRunScheduleId = s.BulkRunScheduleId
WHERE j.ucjbNumber LIKE '%LH%'
  AND j.ucjbNumber NOT LIKE '%LHP%'
  AND EXISTS (
        SELECT 1 FROM #ToRetire r
        WHERE r.Name = s.Name
          AND (r.ClientId = s.ClientId
               OR (r.ClientId IS NULL AND s.ClientId IS NULL))
  )
ORDER BY j.ucjbID;

-- B2. Linehaul legs orphaned by retiring a schedule header. bsl hangs off the
--     DAY-ROW id, so retiring a header must not remove or repoint day rows.
SELECT
    bsl.BulkRunScheduleId,
    COUNT(*) AS LegCount,
    'linehaul legs keyed on this day row' AS Note
FROM dbo.tblBulkScheduleLinehaul bsl
WHERE NOT EXISTS (
        SELECT 1 FROM dbo.tblBulkRunSchedule s
        WHERE s.BulkRunScheduleId = bsl.BulkRunScheduleId
  )
GROUP BY bsl.BulkRunScheduleId;
GO
