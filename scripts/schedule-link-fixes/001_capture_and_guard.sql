-- 001: capture tblScheduleClient and refuse to discard operator-created bindings.
--
-- Addresses finding B of STEVE-REGRESSION-REVIEW-SCHEDULE-CLIENT-LINK-2026-09-09.md.
--
-- Step 4d of 20260908120000_AddScheduleHeaderAndIdKeyedLinks.sql deletes
-- tblScheduleClient (guarded on BulkRunScheduleId still being nullable, which is
-- true on fresh apply) and repopulates one row per header from LegacyClientId.
-- Any second client an operator bound through the Routed Operations UI since the
-- junction was created on 2026-08-25 is discarded, and nothing detects it: the
-- post-state passes both of the migration's own checks and its count print,
-- because it is internally consistent.
--
-- RUN THIS BEFORE 20260908120000 ON ANY TENANT THAT HAS NOT YET MIGRATED.
-- On an already-migrated tenant it is too late for the capture; reconcile from a
-- backup taken before the apply date instead.
--
-- Safe to re-run. Read-only unless the capture table is missing.
SET NOCOUNT ON; SET XACT_ABORT ON;
DECLARE @Commit bit = 0;   -- set to 1 to keep the capture table
BEGIN TRAN;

------------------------------------------------------------------------
-- 1. Capture. A real table, not a saved query result - it survives a
--    rollback of the main migration and can be joined against later.
------------------------------------------------------------------------
IF OBJECT_ID('dbo.tblScheduleClient', 'U') IS NULL
BEGIN
    PRINT 'tblScheduleClient does not exist on this tenant - nothing to capture.';
END
ELSE IF OBJECT_ID('dbo.tblScheduleClient_PreMigration', 'U') IS NOT NULL
BEGIN
    PRINT 'dbo.tblScheduleClient_PreMigration already exists - leaving it alone.';
END
ELSE
BEGIN
    SELECT *, CapturedUtc = SYSUTCDATETIME()
    INTO   dbo.tblScheduleClient_PreMigration
    FROM   dbo.tblScheduleClient;

    PRINT 'Captured ' + CAST(@@ROWCOUNT AS varchar(20)) + ' rows into dbo.tblScheduleClient_PreMigration.';
END;

------------------------------------------------------------------------
-- 2. The assertion 20260908120000 step 4d is missing.
--
--    Pre-migration the link table is name-keyed, so a binding that the
--    repopulate step can reconstruct is one that matches an existing 1:1
--    day-row relationship (Name + ClientId). Anything else is operator-created
--    and would be silently lost.
------------------------------------------------------------------------
IF OBJECT_ID('dbo.tblScheduleClient', 'U') IS NOT NULL
   AND COL_LENGTH('dbo.tblScheduleClient', 'ScheduleName') IS NOT NULL
BEGIN
    -- Report them before throwing, so the operator sees what is at stake.
    SELECT sc.*
    FROM   dbo.tblScheduleClient sc
    WHERE  NOT EXISTS (SELECT 1
                       FROM   dbo.tblBulkRunSchedule s
                       WHERE  s.Name     = sc.ScheduleName
                         AND  s.ClientId = sc.ClientId);

    IF EXISTS (SELECT 1
               FROM   dbo.tblScheduleClient sc
               WHERE  NOT EXISTS (SELECT 1
                                  FROM   dbo.tblBulkRunSchedule s
                                  WHERE  s.Name     = sc.ScheduleName
                                    AND  s.ClientId = sc.ClientId))
    BEGIN
        IF @Commit = 1 COMMIT TRAN ELSE ROLLBACK TRAN;
        THROW 50010,
          'tblScheduleClient holds bindings that cannot be reconstructed from the day rows. These are operator-created multi-client links and step 4d of 20260908120000 would discard them. Reconcile from dbo.tblScheduleClient_PreMigration before applying.', 1;
    END

    PRINT 'No operator-created multi-client bindings found. Step 4d is safe on this tenant.';
END;

IF @Commit = 1 COMMIT TRAN ELSE ROLLBACK TRAN;
