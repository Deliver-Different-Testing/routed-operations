-- 002: back-fill tblBulkRunSchedule.ClientId on day rows created since the rollout.
--
-- Addresses finding 6 of STEVE-REGRESSION-REVIEW-SCHEDULE-CLIENT-LINK-2026-09-09.md.
--
-- ScheduleService.UpsertAsync (~539-545) and CopyAsync (~727) write
-- ClientId = null on every new day row, unconditionally. Brief section 5 requires
-- the legacy column to keep being written until nothing reads it; consumers that
-- still do include ClientManager ScheduleService.GetByClient and booking
-- ScheduleService.GetRecurringScheduleIds.
--
-- This repairs the data. It does NOT fix the cause - that is a two-site C#
-- change (ClientId = header.LegacyClientId) which must ship as well, or these
-- rows come back on the next schedule an operator creates.
--
-- Run the survey with @Commit = 0 first: the affected row count is also the
-- answer to "how long has this been broken".
SET NOCOUNT ON; SET XACT_ABORT ON;
DECLARE @Commit bit = 0;
BEGIN TRAN;

------------------------------------------------------------------------
-- 1. Survey: which day rows are missing the legacy ClientId?
--
--    Only rows whose header is client-specific are wrong. A default header has
--    LegacyClientId NULL and its day rows correctly carry ClientId NULL, so
--    they must be left alone.
------------------------------------------------------------------------
SELECT  Affected = COUNT(*)
FROM    dbo.tblBulkRunSchedule s
JOIN    dbo.tblBulkRunScheduleHeader h
        ON h.BulkRunScheduleId = s.BulkRunScheduleGroupId
WHERE   s.ClientId IS NULL
  AND   h.LegacyClientId IS NOT NULL;

SELECT  h.BulkRunScheduleId,
        h.Name,
        h.LegacyClientId,
        h.CreatedUtc,
        DayRowsMissingClientId = COUNT(*)
FROM    dbo.tblBulkRunSchedule s
JOIN    dbo.tblBulkRunScheduleHeader h
        ON h.BulkRunScheduleId = s.BulkRunScheduleGroupId
WHERE   s.ClientId IS NULL
  AND   h.LegacyClientId IS NOT NULL
GROUP BY h.BulkRunScheduleId, h.Name, h.LegacyClientId, h.CreatedUtc
ORDER BY h.CreatedUtc;   -- earliest row dates the regression

------------------------------------------------------------------------
-- 2. Repair.
------------------------------------------------------------------------
UPDATE  s
SET     s.ClientId = h.LegacyClientId
FROM    dbo.tblBulkRunSchedule s
JOIN    dbo.tblBulkRunScheduleHeader h
        ON h.BulkRunScheduleId = s.BulkRunScheduleGroupId
WHERE   s.ClientId IS NULL
  AND   h.LegacyClientId IS NOT NULL;

PRINT 'Back-filled ' + CAST(@@ROWCOUNT AS varchar(20)) + ' day rows.';

------------------------------------------------------------------------
-- 3. Check: nothing client-specific should be left with a null ClientId.
------------------------------------------------------------------------
SELECT  Remaining = COUNT(*)
FROM    dbo.tblBulkRunSchedule s
JOIN    dbo.tblBulkRunScheduleHeader h
        ON h.BulkRunScheduleId = s.BulkRunScheduleGroupId
WHERE   s.ClientId IS NULL
  AND   h.LegacyClientId IS NOT NULL;   -- must be 0

IF @Commit = 1 COMMIT TRAN ELSE ROLLBACK TRAN;
