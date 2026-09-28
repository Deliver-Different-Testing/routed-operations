-- 002: schedule BUNDLES (the E1/E2 launch blocker) + re-point Routes at the schedule header.
--
-- Naming: what the 2026-09-18 brief §4.1 called a "schedule group" is created here as a
-- BUNDLE. Decided 2026-09-20 — see docs/KEVIN-SCHEDULES-NEW-FIXES-2026-09-20.md §F18.
-- "Group" was doing two jobs: the group of day rows that IS a schedule
-- (tblBulkRunScheduleHeader.ScheduleId — the only thing anything links to), and this,
-- a convenience collection of several schedules for bulk edit and attach-clients.
-- A bundle is not an identity: nothing resolves through it at booking time, and no
-- route, booking, override or client link may ever point at a BundleId.
--
-- This supersedes the DDL in the 2026-09-18 brief §4.1. If those tables were already
-- created under the old names, see section 4 at the bottom for the rename.
--
-- Idempotent where it can be; runs in a transaction and ROLLS BACK unless @Commit = 1.
SET NOCOUNT ON; SET XACT_ABORT ON;
DECLARE @Commit    bit = 0;
DECLARE @CreatedBy nvarchar(100) = N'steve@urgent.co.nz';

BEGIN TRAN;

------------------------------------------------------------------------
-- 1. The bundle.
------------------------------------------------------------------------
IF OBJECT_ID('dbo.tblBulkRunScheduleBundle', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.tblBulkRunScheduleBundle (
        BundleId    int IDENTITY(1,1) NOT NULL
            CONSTRAINT PK_tblBulkRunScheduleBundle PRIMARY KEY,
        Name        nvarchar(200) NOT NULL,
        Description nvarchar(500) NULL,
        IsActive    bit NOT NULL
            CONSTRAINT DF_tblBulkRunScheduleBundle_IsActive DEFAULT 1,
        CreatedUtc  datetime2(0) NOT NULL
            CONSTRAINT DF_tblBulkRunScheduleBundle_CreatedUtc DEFAULT SYSUTCDATETIME(),
        CreatedBy   nvarchar(100) NOT NULL,
        UpdatedUtc  datetime2(0)  NULL,
        UpdatedBy   nvarchar(100) NULL,
        CONSTRAINT CK_tblBulkRunScheduleBundle_Name
            CHECK (Name = LTRIM(RTRIM(Name)) AND Name <> N'')
    );
    PRINT '  + tblBulkRunScheduleBundle';
END;

------------------------------------------------------------------------
-- 2. Membership. ScheduleId is the HEADER id — never a day row, never a name (§F18).
--    CreatedUtc/CreatedBy are an addition to the 2026-09-18 DDL: E2 makes membership
--    something ops edits by hand, so it needs the same audit as the client links.
------------------------------------------------------------------------
IF OBJECT_ID('dbo.tblBulkRunScheduleBundleMember', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.tblBulkRunScheduleBundleMember (
        BundleId   int NOT NULL
            CONSTRAINT FK_tblBulkRunScheduleBundleMember_Bundle
            REFERENCES dbo.tblBulkRunScheduleBundle (BundleId),
        ScheduleId int NOT NULL
            CONSTRAINT FK_tblBulkRunScheduleBundleMember_Header
            REFERENCES dbo.tblBulkRunScheduleHeader (ScheduleId),
        CreatedUtc datetime2(0) NOT NULL
            CONSTRAINT DF_tblBulkRunScheduleBundleMember_CreatedUtc DEFAULT SYSUTCDATETIME(),
        CreatedBy  nvarchar(100) NOT NULL,
        CONSTRAINT PK_tblBulkRunScheduleBundleMember PRIMARY KEY (BundleId, ScheduleId)
    );

    -- The PK answers "what is in this bundle?". This answers "what bundles is this
    -- schedule in?" — the opposite direction, and what makes E1's Bundles column cheap
    -- across 2,725 rows.
    CREATE INDEX IX_tblBulkRunScheduleBundleMember_ScheduleId
        ON dbo.tblBulkRunScheduleBundleMember (ScheduleId) INCLUDE (BundleId);
    PRINT '  + tblBulkRunScheduleBundleMember';
END;

------------------------------------------------------------------------
-- 3. Re-point Routes at the schedule header (2026-09-18 brief §4.2, and §F18).
--
--    Only needed if Routes.ScheduleId still resolves through the day row. Confirm
--    first: Unresolvable MUST be 0 before the UPDATE runs.
--
--    NOTE: the configurator's Route entity has no ScheduleId column at all
--    (Core/Domain/Despatch/Route.cs) — see §F17. If the column does not exist in this
--    database either, skip this section and settle F17 first; do not invent the column.
------------------------------------------------------------------------
IF COL_LENGTH('dbo.Routes', 'ScheduleId') IS NULL
    PRINT '  ! dbo.Routes has no ScheduleId column — skipping section 3 (see F17).';
ELSE
BEGIN
    SELECT COUNT(*) AS Bindings,
           SUM(CASE WHEN s.ScheduleId IS NULL THEN 1 ELSE 0 END) AS Unresolvable
      FROM dbo.Routes r
      LEFT JOIN dbo.tblBulkRunSchedule s ON s.BulkRunScheduleId = r.ScheduleId
     WHERE r.ScheduleId IS NOT NULL;

    IF COL_LENGTH('dbo.Routes', 'HeaderScheduleId') IS NULL
        ALTER TABLE dbo.Routes ADD HeaderScheduleId int NULL
            CONSTRAINT FK_Routes_ScheduleHeader
            REFERENCES dbo.tblBulkRunScheduleHeader (ScheduleId);

    EXEC(N'
    UPDATE r
       SET r.HeaderScheduleId = s.ScheduleId
      FROM dbo.Routes r
      JOIN dbo.tblBulkRunSchedule s ON s.BulkRunScheduleId = r.ScheduleId
     WHERE r.ScheduleId IS NOT NULL AND r.HeaderScheduleId IS NULL;');

    -- Both must be 0.
    EXEC(N'
    SELECT ''routes with a binding but no header'' AS Check_, COUNT(*) AS Value
      FROM dbo.Routes WHERE ScheduleId IS NOT NULL AND HeaderScheduleId IS NULL
    UNION ALL
    SELECT ''routes whose header does not exist'', COUNT(*)
      FROM dbo.Routes r
      LEFT JOIN dbo.tblBulkRunScheduleHeader h ON h.ScheduleId = r.HeaderScheduleId
     WHERE r.HeaderScheduleId IS NOT NULL AND h.ScheduleId IS NULL;');
END;

-- Routes.ScheduleId is kept beside the new column on purpose: tenant_routeService.ts and
-- the existing Recurring Routes page still read the day-row id. Drop it only once the
-- Configurator route editor reads HeaderScheduleId — separate piece of work.

IF @Commit = 1 COMMIT TRAN; ELSE ROLLBACK TRAN;
GO

------------------------------------------------------------------------
-- 4. Only if the tables were already created as "Group" before 2026-09-20.
--    sp_rename keeps the data and the FKs; the constraint names are cosmetic but
--    renamed too so nothing reads "Group" afterwards.
------------------------------------------------------------------------
-- IF OBJECT_ID('dbo.tblBulkRunScheduleGroup', 'U') IS NOT NULL
-- BEGIN
--     EXEC sp_rename 'dbo.tblBulkRunScheduleGroupMember', 'tblBulkRunScheduleBundleMember';
--     EXEC sp_rename 'dbo.tblBulkRunScheduleGroup',       'tblBulkRunScheduleBundle';
--     EXEC sp_rename 'dbo.tblBulkRunScheduleBundle.GroupId',       'BundleId', 'COLUMN';
--     EXEC sp_rename 'dbo.tblBulkRunScheduleBundleMember.GroupId', 'BundleId', 'COLUMN';
--     EXEC sp_rename 'IX_tblBulkRunScheduleGroupMember_ScheduleId',
--                    'IX_tblBulkRunScheduleBundleMember_ScheduleId', 'INDEX';
--     -- then the PK/FK/DF constraint names, e.g.
--     -- EXEC sp_rename 'PK_tblBulkRunScheduleGroup', 'PK_tblBulkRunScheduleBundle', 'OBJECT';
-- END;
