/*
    04_post_migration_structure_checks.sql
    -------------------------------------------------------------------
    Run AFTER the migration. Structural and id-space checks.

    Covers report findings 3 (id-space collision), 5 (rename re-runs the
    reshape), 6 (procRefreshAllViews) and 8 (two parallel migrations).

    Read-only.
*/

SET NOCOUNT ON;
GO

/* ================================================================== */
/* 1. Which structure actually landed                                  */
/*                                                                     */
/* The baseline migration builds:  header PK ScheduleId,               */
/*   day-row FK ScheduleId, link table tblBulkRunScheduleClient.       */
/* Kevin's reportedly builds:      day-row FK BulkRunScheduleGroupId,  */
/*   link table tblScheduleClient keyed on BulkRunScheduleId.          */
/* BOTH present means two parallel structures - see finding 8.         */
/* ================================================================== */

SELECT 'tblBulkRunScheduleHeader'   AS Object, OBJECT_ID('dbo.tblBulkRunScheduleHeader')   AS ObjectId
UNION ALL SELECT 'tblBulkRunScheduleClient (brief)', OBJECT_ID('dbo.tblBulkRunScheduleClient')
UNION ALL SELECT 'tblScheduleClient (reported)',     OBJECT_ID('dbo.tblScheduleClient');

SELECT
    t.name AS TableName,
    c.name AS ColumnName,
    ty.name AS DataType,
    c.is_nullable
FROM sys.tables t
JOIN sys.columns c  ON c.object_id = t.object_id
JOIN sys.types  ty  ON ty.user_type_id = c.user_type_id
WHERE t.name IN ('tblBulkRunScheduleHeader', 'tblBulkRunScheduleClient',
                 'tblScheduleClient', 'tblBulkRunSchedule')
  AND c.name IN ('ScheduleId', 'BulkRunScheduleId', 'BulkRunScheduleGroupId',
                 'ClientId', 'LegacyClientId', 'IsDefault', 'RetiredUtc', 'ScheduleName')
ORDER BY t.name, c.name;

/* ================================================================== */
/* 2. ID-SPACE COLLISION                                               */
/*                                                                     */
/* BulkRunScheduleId means a DAY ROW in tblBulkRunSchedule and in      */
/* tblBulkScheduleLinehaul, but a HEADER in the reported link table.   */
/* 57 join sites across 46 migrations join ScheduleID to the day-row   */
/* id, so a mixed-up join returns plausible wrong rows silently.       */
/*                                                                     */
/* This measures how far the two id ranges overlap. High overlap means */
/* a wrong join will never fail loudly.                                */
/* ================================================================== */

IF OBJECT_ID('dbo.tblScheduleClient') IS NOT NULL
BEGIN
    DECLARE @overlap int, @linkRows int;

    SELECT @linkRows = COUNT(*) FROM dbo.tblScheduleClient;

    SELECT @overlap = COUNT(*)
    FROM dbo.tblScheduleClient sc
    WHERE EXISTS (SELECT 1 FROM dbo.tblBulkRunSchedule s
                  WHERE s.BulkRunScheduleId = sc.BulkRunScheduleId);

    SELECT 'Link rows'                            AS Metric, @linkRows AS Value
    UNION ALL
    SELECT 'Link rows whose header id ALSO exists as a day-row id', @overlap
    UNION ALL
    SELECT 'Percent silently joinable to the wrong table',
           CASE WHEN @linkRows = 0 THEN 0 ELSE (@overlap * 100) / @linkRows END;

    -- Concrete demonstration: the join a developer would write by name.
    -- Every row it returns is WRONG - a header id matched to a day row.
    SELECT TOP (20)
        sc.BulkRunScheduleId AS HeaderId_FromLinkTable,
        s.BulkRunScheduleId  AS DayRowId_Matched,
        s.Name               AS DayRowName,
        'this join compiles and returns wrong rows' AS Warning
    FROM dbo.tblScheduleClient sc
    JOIN dbo.tblBulkRunSchedule s ON s.BulkRunScheduleId = sc.BulkRunScheduleId;
END

/* ================================================================== */
/* 3. Referential integrity of the reshape                             */
/* ================================================================== */

-- 3a. Day rows with no header.
IF COL_LENGTH('dbo.tblBulkRunSchedule', 'BulkRunScheduleGroupId') IS NOT NULL
EXEC sp_executesql N'
SELECT COUNT(*) AS DayRowsWithoutHeader
FROM dbo.tblBulkRunSchedule s
WHERE s.BulkRunScheduleGroupId IS NULL
   OR NOT EXISTS (SELECT 1 FROM dbo.tblBulkRunScheduleHeader h
                  WHERE h.ScheduleId = s.BulkRunScheduleGroupId);';

-- 3b. Counts must match the pre-migration profile.
SELECT 'Day rows'  AS Metric, COUNT(*) AS Value, 11110 AS Expected FROM dbo.tblBulkRunSchedule
UNION ALL
SELECT 'Headers', COUNT(*), 2725 FROM dbo.tblBulkRunScheduleHeader
UNION ALL
SELECT 'Default headers', COUNT(*), 119 FROM dbo.tblBulkRunScheduleHeader WHERE IsDefault = 1;

-- 3c. A header must not merge a default and a client schedule of the same
--     name. 48 names are used by both; grouping on name alone would fuse them.
SELECT h.Name, COUNT(*) AS HeaderCount,
       SUM(CASE WHEN h.IsDefault = 1 THEN 1 ELSE 0 END) AS Defaults,
       SUM(CASE WHEN h.IsDefault = 0 THEN 1 ELSE 0 END) AS ClientSpecific
FROM dbo.tblBulkRunScheduleHeader h
WHERE h.RetiredUtc IS NULL
GROUP BY h.Name
HAVING SUM(CASE WHEN h.IsDefault = 1 THEN 1 ELSE 0 END) > 0
   AND SUM(CASE WHEN h.IsDefault = 0 THEN 1 ELSE 0 END) > 0
ORDER BY h.Name;

/* ================================================================== */
/* 4. Idempotency after the migration rename                           */
/*                                                                     */
/* DbUp journals by FILENAME in dbo.SchemaVersions. Renaming            */
/* 20260908120000_... to 20260908180000_... makes it an unknown script, */
/* so it RUNS AGAIN on any environment that already applied 120000.     */
/* Both names appearing below means the reshape ran twice there.        */
/* ================================================================== */

SELECT ScriptName, Applied
FROM dbo.SchemaVersions
WHERE ScriptName LIKE '%ScheduleHeader%'
   OR ScriptName LIKE '%IdKeyedLinks%'
   OR ScriptName LIKE '2026090%'
ORDER BY Applied;

-- Duplicate headers or link rows are what a non-idempotent second run leaves.
SELECT h.Name, ISNULL(h.LegacyClientId, -1) AS LegacyClientId, COUNT(*) AS Copies
FROM dbo.tblBulkRunScheduleHeader h
WHERE h.RetiredUtc IS NULL
GROUP BY h.Name, ISNULL(h.LegacyClientId, -1)
HAVING COUNT(*) > 1
ORDER BY Copies DESC;

/* ================================================================== */
/* 5. Dependent views                                                  */
/*                                                                     */
/* Adding a column to tblBulkRunSchedule requires EXEC                 */
/* procRefreshAllViews - the repo's pre-commit hook enforces it and    */
/* 220 migrations comply. DESWEB_qryDespatch and tblJobBooking read    */
/* the table. A stale view definition breaks at runtime, not at        */
/* migration time.                                                     */
/* ================================================================== */

SELECT
    v.name AS ViewName,
    'SELECT TOP 1 * FROM ' + QUOTENAME(v.name) + ' -- must not error' AS SmokeTest
FROM sys.views v
WHERE v.name IN ('DESWEB_qryDespatch', 'tblJobBooking', 'tblJob');

-- Views whose stored definition no longer matches the base table shape.
SELECT DISTINCT o.name AS StaleViewCandidate
FROM sys.sql_expression_dependencies d
JOIN sys.objects o ON o.object_id = d.referencing_id
WHERE d.referenced_entity_name = 'tblBulkRunSchedule'
  AND o.type = 'V';
GO
