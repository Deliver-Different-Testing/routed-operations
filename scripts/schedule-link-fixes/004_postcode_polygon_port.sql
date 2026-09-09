-- 004: port the postcode and polygon junctions from ScheduleName to BulkRunScheduleId.
--
-- Addresses findings A1, A2 and A3 of
-- STEVE-REGRESSION-REVIEW-SCHEDULE-CLIENT-LINK-2026-09-09.md.
--
-- Run 003_postcode_polygon_survey.sql first and read the output. This script
-- fans out shared binding sets, so its row growth is exactly the FanOutRows
-- column that survey reports.
--
-- ---------------------------------------------------------------------------
-- SEQUENCING NOTE - this corrects the ordering sketched in the review doc.
--
-- The fan-out CANNOT happen before the primary key is dropped. The existing PK
-- is (ScheduleName, PostCode); copying a shared set to a second header means
-- writing a second row with the same (ScheduleName, PostCode), which the old PK
-- forbids. Correct order is:
--
--   1. add the nullable column
--   2. back-fill every existing row with ONE header (the lowest id for its name)
--   3. drop the old PK          <- must precede the fan-out
--   4. fan out to the remaining headers sharing that name
--   5. NOT NULL, new PK, FK
--
-- ---------------------------------------------------------------------------
-- DISAMBIGUATION RULE
--
-- For the name groups the survey reports, the data to say which schedule owned
-- which postcode does not exist - the rows were never stored separately. The
-- only behaviour-preserving rule is: give every schedule sharing the name the
-- whole shared set, then let operations prune. Nobody loses a binding, and a
-- structural problem becomes a tidy-up queue. Query 2 of the survey is that
-- queue.
--
-- Idempotent. Rolls back unless @Commit = 1.
SET NOCOUNT ON; SET XACT_ABORT ON;
DECLARE @Commit bit = 0;
BEGIN TRAN;

------------------------------------------------------------------------
-- 1. Additive column. No behaviour change; safe to ship on its own.
------------------------------------------------------------------------
IF COL_LENGTH('dbo.SchedulePostcode', 'BulkRunScheduleId') IS NULL
    ALTER TABLE dbo.SchedulePostcode ADD BulkRunScheduleId int NULL;

IF COL_LENGTH('dbo.SchedulePolygon', 'BulkRunScheduleId') IS NULL
    ALTER TABLE dbo.SchedulePolygon ADD BulkRunScheduleId int NULL;

------------------------------------------------------------------------
-- 2. Quarantine stranded rows.
--
--    Rows whose ScheduleName matches no live header cannot be given an id, and
--    would block the NOT NULL in step 5. They are also the ammunition for
--    finding A2 - leave them in place and a future rename onto that name
--    silently inherits them. Move them out; do not delete outright.
------------------------------------------------------------------------
IF OBJECT_ID('dbo.SchedulePostcode_Orphaned', 'U') IS NULL
    SELECT *, QuarantinedUtc = SYSUTCDATETIME()
    INTO   dbo.SchedulePostcode_Orphaned
    FROM   dbo.SchedulePostcode sp
    WHERE  NOT EXISTS (SELECT 1 FROM dbo.tblBulkRunScheduleHeader h
                       WHERE h.Name = sp.ScheduleName AND h.RetiredUtc IS NULL);

IF OBJECT_ID('dbo.SchedulePolygon_Orphaned', 'U') IS NULL
    SELECT *, QuarantinedUtc = SYSUTCDATETIME()
    INTO   dbo.SchedulePolygon_Orphaned
    FROM   dbo.SchedulePolygon spg
    WHERE  NOT EXISTS (SELECT 1 FROM dbo.tblBulkRunScheduleHeader h
                       WHERE h.Name = spg.ScheduleName AND h.RetiredUtc IS NULL);

DELETE sp
FROM   dbo.SchedulePostcode sp
WHERE  NOT EXISTS (SELECT 1 FROM dbo.tblBulkRunScheduleHeader h
                   WHERE h.Name = sp.ScheduleName AND h.RetiredUtc IS NULL);
PRINT 'Quarantined ' + CAST(@@ROWCOUNT AS varchar(20)) + ' stranded postcode rows.';

DELETE spg
FROM   dbo.SchedulePolygon spg
WHERE  NOT EXISTS (SELECT 1 FROM dbo.tblBulkRunScheduleHeader h
                   WHERE h.Name = spg.ScheduleName AND h.RetiredUtc IS NULL);
PRINT 'Quarantined ' + CAST(@@ROWCOUNT AS varchar(20)) + ' stranded polygon rows.';

------------------------------------------------------------------------
-- 3. Back-fill each surviving row with the LOWEST header id for its name.
--    One row, one id - the fan-out to the rest happens after the PK is dropped.
------------------------------------------------------------------------
UPDATE sp
SET    sp.BulkRunScheduleId = x.MinId
FROM   dbo.SchedulePostcode sp
CROSS APPLY (SELECT MinId = MIN(h.BulkRunScheduleId)
             FROM   dbo.tblBulkRunScheduleHeader h
             WHERE  h.Name = sp.ScheduleName AND h.RetiredUtc IS NULL) x
WHERE  sp.BulkRunScheduleId IS NULL;

UPDATE spg
SET    spg.BulkRunScheduleId = x.MinId
FROM   dbo.SchedulePolygon spg
CROSS APPLY (SELECT MinId = MIN(h.BulkRunScheduleId)
             FROM   dbo.tblBulkRunScheduleHeader h
             WHERE  h.Name = spg.ScheduleName AND h.RetiredUtc IS NULL) x
WHERE  spg.BulkRunScheduleId IS NULL;

IF EXISTS (SELECT 1 FROM dbo.SchedulePostcode WHERE BulkRunScheduleId IS NULL)
   OR EXISTS (SELECT 1 FROM dbo.SchedulePolygon WHERE BulkRunScheduleId IS NULL)
BEGIN
    ROLLBACK TRAN;
    THROW 50030, 'Binding rows left without a header id after back-fill - investigate before continuing.', 1;
END;

------------------------------------------------------------------------
-- 4. Drop the old primary keys. MUST precede the fan-out.
------------------------------------------------------------------------
DECLARE @pk sysname;

SELECT @pk = name FROM sys.key_constraints
WHERE  parent_object_id = OBJECT_ID('dbo.SchedulePostcode') AND type = 'PK';
IF @pk IS NOT NULL EXEC('ALTER TABLE dbo.SchedulePostcode DROP CONSTRAINT ' + @pk);

SET @pk = NULL;
SELECT @pk = name FROM sys.key_constraints
WHERE  parent_object_id = OBJECT_ID('dbo.SchedulePolygon') AND type = 'PK';
IF @pk IS NOT NULL EXEC('ALTER TABLE dbo.SchedulePolygon DROP CONSTRAINT ' + @pk);

------------------------------------------------------------------------
-- 5. Fan out: every other live header sharing the name gets the same set.
--    Behaviour-preserving - this is what those schedules already resolve to.
------------------------------------------------------------------------
INSERT INTO dbo.SchedulePostcode (BulkRunScheduleId, ScheduleName, PostCode)
SELECT DISTINCT h.BulkRunScheduleId, sp.ScheduleName, sp.PostCode
FROM   dbo.SchedulePostcode sp
JOIN   dbo.tblBulkRunScheduleHeader h
       ON h.Name = sp.ScheduleName AND h.RetiredUtc IS NULL
WHERE  NOT EXISTS (SELECT 1 FROM dbo.SchedulePostcode x
                   WHERE x.BulkRunScheduleId = h.BulkRunScheduleId
                     AND x.PostCode          = sp.PostCode);
PRINT 'Fanned out ' + CAST(@@ROWCOUNT AS varchar(20)) + ' postcode rows.';

INSERT INTO dbo.SchedulePolygon (BulkRunScheduleId, ScheduleName, PolygonId)
SELECT DISTINCT h.BulkRunScheduleId, spg.ScheduleName, spg.PolygonId
FROM   dbo.SchedulePolygon spg
JOIN   dbo.tblBulkRunScheduleHeader h
       ON h.Name = spg.ScheduleName AND h.RetiredUtc IS NULL
WHERE  NOT EXISTS (SELECT 1 FROM dbo.SchedulePolygon x
                   WHERE x.BulkRunScheduleId = h.BulkRunScheduleId
                     AND x.PolygonId         = spg.PolygonId);
PRINT 'Fanned out ' + CAST(@@ROWCOUNT AS varchar(20)) + ' polygon rows.';

------------------------------------------------------------------------
-- 6. New keys. ScheduleName is kept for one release so anything still reading
--    it keeps working; drop it once nothing does.
------------------------------------------------------------------------
ALTER TABLE dbo.SchedulePostcode ALTER COLUMN BulkRunScheduleId int NOT NULL;
ALTER TABLE dbo.SchedulePolygon  ALTER COLUMN BulkRunScheduleId int NOT NULL;

ALTER TABLE dbo.SchedulePostcode ADD CONSTRAINT PK_SchedulePostcode
    PRIMARY KEY (BulkRunScheduleId, PostCode);
ALTER TABLE dbo.SchedulePolygon ADD CONSTRAINT PK_SchedulePolygon
    PRIMARY KEY (BulkRunScheduleId, PolygonId);

ALTER TABLE dbo.SchedulePostcode ADD CONSTRAINT FK_SchedulePostcode_Header
    FOREIGN KEY (BulkRunScheduleId) REFERENCES dbo.tblBulkRunScheduleHeader (BulkRunScheduleId);
ALTER TABLE dbo.SchedulePolygon ADD CONSTRAINT FK_SchedulePolygon_Header
    FOREIGN KEY (BulkRunScheduleId) REFERENCES dbo.tblBulkRunScheduleHeader (BulkRunScheduleId);

------------------------------------------------------------------------
-- 7. Checks.
------------------------------------------------------------------------
-- No two live headers should now share a binding row.
SELECT  SharedRowsRemaining = COUNT(*)
FROM   (SELECT ScheduleName, PostCode
        FROM   dbo.SchedulePostcode
        GROUP  BY ScheduleName, PostCode
        HAVING COUNT(DISTINCT BulkRunScheduleId) > 1) x;   -- expected: > 0 rows is fine,
        -- they are now DISTINCT rows per schedule; this counts groups that were fanned out.

SELECT  PostcodeRows = (SELECT COUNT(*) FROM dbo.SchedulePostcode),
        PolygonRows  = (SELECT COUNT(*) FROM dbo.SchedulePolygon),
        OrphanedPostcodes = (SELECT COUNT(*) FROM dbo.SchedulePostcode_Orphaned),
        OrphanedPolygons  = (SELECT COUNT(*) FROM dbo.SchedulePolygon_Orphaned);

IF @Commit = 1 COMMIT TRAN ELSE ROLLBACK TRAN;

------------------------------------------------------------------------
-- AFTER THIS SCRIPT, the code change in DespatchContext.cs:249-256 and
-- ScheduleService.cs:838-869 must ship together with it:
--
--   modelBuilder.Entity<SchedulePostcode>(e => e.HasKey(x => new { x.BulkRunScheduleId, x.PostCode }));
--   modelBuilder.Entity<SchedulePolygon>(e  => e.HasKey(x => new { x.BulkRunScheduleId, x.PolygonId }));
--
--   SyncPostcodesAsync(int scheduleId, ...)  ->  Where(x => x.BulkRunScheduleId == scheduleId)
--   SyncPolygonsAsync (int scheduleId, ...)  ->  Where(x => x.BulkRunScheduleId == scheduleId)
--
-- Once keyed on the id, UpsertAsync's rename path (493-494) needs no cascade:
-- bindings follow the id and a rename becomes a pure display change.
------------------------------------------------------------------------
