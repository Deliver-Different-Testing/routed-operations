-- 003: how bad is the shared postcode/polygon problem? READ ONLY.
--
-- Addresses finding A3 of STEVE-REGRESSION-REVIEW-SCHEDULE-CLIENT-LINK-2026-09-09.md.
--
-- DespatchContext.cs:249-256 keys SchedulePostcode on (ScheduleName, PostCode)
-- and SchedulePolygon on (ScheduleName, PolygonId). Neither table carries a
-- client or schedule-id column. Two schedules sharing a name therefore do not
-- risk sharing a binding set - the primary key makes them the same row.
--
-- Production has 164 names mapping to more than one definition and 48 names
-- shared between a default and client schedules, so this is present tense, not
-- a hazard waiting on a rename.
--
-- Run this BEFORE deciding whether the port (004/005) is in or out of Phase 1.
-- Every row returned by query 2 is a group where one binding set is doing duty
-- for several operationally distinct schedules. Nothing here writes.
SET NOCOUNT ON;

------------------------------------------------------------------------
-- 1. Headline counts.
------------------------------------------------------------------------
SELECT  Metric = 'Live headers',
        Value  = COUNT(*)
FROM    dbo.tblBulkRunScheduleHeader WHERE RetiredUtc IS NULL
UNION ALL
SELECT  'Names shared by 2+ live headers',
        COUNT(*)
FROM    (SELECT Name
         FROM   dbo.tblBulkRunScheduleHeader
         WHERE  RetiredUtc IS NULL
         GROUP  BY Name
         HAVING COUNT(*) > 1) x
UNION ALL
SELECT  'Postcode rows total',      COUNT(*) FROM dbo.SchedulePostcode
UNION ALL
SELECT  'Polygon rows total',       COUNT(*) FROM dbo.SchedulePolygon;

------------------------------------------------------------------------
-- 2. Postcode sets shared across schedules. THE PRUNE LIST.
--
--    SchedulesSharingName = how many live headers currently read this one set.
--    PostcodeRows         = how many rows the port would have to fan out.
------------------------------------------------------------------------
SELECT   sp.ScheduleName,
         SchedulesSharingName = COUNT(DISTINCT h.BulkRunScheduleId),
         PostcodeRows         = COUNT(DISTINCT sp.PostCode),
         FanOutRows           = COUNT(DISTINCT h.BulkRunScheduleId) * COUNT(DISTINCT sp.PostCode)
FROM     dbo.SchedulePostcode sp
JOIN     dbo.tblBulkRunScheduleHeader h
         ON h.Name = sp.ScheduleName AND h.RetiredUtc IS NULL
GROUP BY sp.ScheduleName
HAVING   COUNT(DISTINCT h.BulkRunScheduleId) > 1
ORDER BY FanOutRows DESC;

------------------------------------------------------------------------
-- 3. Same for polygons.
------------------------------------------------------------------------
SELECT   spg.ScheduleName,
         SchedulesSharingName = COUNT(DISTINCT h.BulkRunScheduleId),
         PolygonRows          = COUNT(DISTINCT spg.PolygonId),
         FanOutRows           = COUNT(DISTINCT h.BulkRunScheduleId) * COUNT(DISTINCT spg.PolygonId)
FROM     dbo.SchedulePolygon spg
JOIN     dbo.tblBulkRunScheduleHeader h
         ON h.Name = spg.ScheduleName AND h.RetiredUtc IS NULL
GROUP BY spg.ScheduleName
HAVING   COUNT(DISTINCT h.BulkRunScheduleId) > 1
ORDER BY FanOutRows DESC;

------------------------------------------------------------------------
-- 4. Orphans: binding rows whose ScheduleName matches no live header.
--
--    These are already-stranded sets - from a rename, or from a schedule that
--    was retired. They are the ammunition for finding A2: the day anything is
--    renamed to one of these names, it silently inherits this set.
------------------------------------------------------------------------
SELECT   sp.ScheduleName,
         StrandedPostcodeRows = COUNT(*)
FROM     dbo.SchedulePostcode sp
WHERE    NOT EXISTS (SELECT 1
                     FROM   dbo.tblBulkRunScheduleHeader h
                     WHERE  h.Name = sp.ScheduleName AND h.RetiredUtc IS NULL)
GROUP BY sp.ScheduleName
ORDER BY StrandedPostcodeRows DESC;
