-- 001: give every schedule its own id BEFORE any merging.
--
-- Creates dbo.tblBulkRunScheduleHeader (one row per schedule = one per distinct
-- Name + ClientId in tblBulkRunSchedule), stamps ScheduleId on every day row,
-- and keys the schedule/client link table on ScheduleId instead of ScheduleName.
-- Every existing client-specific schedule gets a link row, so from here on the
-- link table is the only thing that says which client a schedule belongs to;
-- tblBulkRunSchedule.ClientId is kept as LegacyClientId on the header.
--
-- Idempotent where it can be; runs in a transaction and ROLLS BACK unless @Commit = 1.
-- Statements that touch the new ScheduleId column run via EXEC so the batch compiles.
SET NOCOUNT ON; SET XACT_ABORT ON;
DECLARE @Commit bit = 0;
DECLARE @CreatedBy nvarchar(100) = N'steve@urgent.co.nz';
DECLARE @Link sysname = N'dbo.tblBulkRunScheduleClient';   -- Kevin's link table
BEGIN TRAN;

------------------------------------------------------------------------
-- 1. Header table: the schedule's identity.
------------------------------------------------------------------------
IF OBJECT_ID('dbo.tblBulkRunScheduleHeader', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.tblBulkRunScheduleHeader (
        ScheduleId      int IDENTITY(1,1) NOT NULL CONSTRAINT PK_tblBulkRunScheduleHeader PRIMARY KEY,
        Name            nvarchar(200)     NOT NULL,
        IsDefault       bit               NOT NULL,             -- 1 = available to clients with no schedule of their own
        LegacyClientId  int               NULL,                 -- ClientId the day rows carried before the link table existed
        CreatedUtc      datetime2(0)      NOT NULL CONSTRAINT DF_tblBulkRunScheduleHeader_CreatedUtc DEFAULT SYSUTCDATETIME(),
        CreatedBy       nvarchar(100)     NOT NULL,
        RetiredUtc      datetime2(0)      NULL,
        RetiredBy       nvarchar(100)     NULL,
        CONSTRAINT CK_tblBulkRunScheduleHeader_Name CHECK (Name = LTRIM(RTRIM(Name)) AND Name <> N'')
    );
    CREATE INDEX IX_tblBulkRunScheduleHeader_Name ON dbo.tblBulkRunScheduleHeader (Name) WHERE RetiredUtc IS NULL;
END;

-- One header per distinct (Name, ClientId). Names are trimmed and double spaces collapsed;
-- the spelling comes from the lowest BulkRunScheduleId of the group.
;WITH d AS (
    SELECT BulkRunScheduleId, ClientId,
           NormName = LTRIM(RTRIM(REPLACE(REPLACE(REPLACE(Name, N'  ', N' '), N'  ', N' '), N'  ', N' ')))
    FROM dbo.tblBulkRunSchedule
), first AS (
    SELECT MIN(BulkRunScheduleId) AS BulkRunScheduleId FROM d GROUP BY NormName, ClientId
)
INSERT INTO dbo.tblBulkRunScheduleHeader (Name, IsDefault, LegacyClientId, CreatedBy)
SELECT d.NormName, CASE WHEN d.ClientId IS NULL THEN 1 ELSE 0 END, d.ClientId, @CreatedBy
FROM d JOIN first f ON f.BulkRunScheduleId = d.BulkRunScheduleId
WHERE NOT EXISTS (SELECT 1 FROM dbo.tblBulkRunScheduleHeader h
                  WHERE h.Name = d.NormName AND ISNULL(h.LegacyClientId, -1) = ISNULL(d.ClientId, -1) AND h.RetiredUtc IS NULL);

------------------------------------------------------------------------
-- 2. Day rows point at their header.
------------------------------------------------------------------------
IF COL_LENGTH('dbo.tblBulkRunSchedule', 'ScheduleId') IS NULL
    ALTER TABLE dbo.tblBulkRunSchedule ADD ScheduleId int NULL;

EXEC(N'
UPDATE s SET s.ScheduleId = h.ScheduleId
FROM dbo.tblBulkRunSchedule s
JOIN dbo.tblBulkRunScheduleHeader h
  ON h.Name = LTRIM(RTRIM(REPLACE(REPLACE(REPLACE(s.Name, N''  '', N'' ''), N''  '', N'' ''), N''  '', N'' '')))
 AND ISNULL(h.LegacyClientId, -1) = ISNULL(s.ClientId, -1)
 AND h.RetiredUtc IS NULL
WHERE s.ScheduleId IS NULL OR s.ScheduleId <> h.ScheduleId;

IF EXISTS (SELECT 1 FROM dbo.tblBulkRunSchedule WHERE ScheduleId IS NULL)
    THROW 50001, ''tblBulkRunSchedule rows without a header - fix before continuing'', 1;

-- Sync day-row spelling to the header so the two never drift.
UPDATE s SET s.Name = h.Name FROM dbo.tblBulkRunSchedule s JOIN dbo.tblBulkRunScheduleHeader h ON h.ScheduleId = s.ScheduleId WHERE s.Name <> h.Name COLLATE Latin1_General_CS_AS;

ALTER TABLE dbo.tblBulkRunSchedule ALTER COLUMN ScheduleId int NOT NULL;
IF OBJECT_ID(''dbo.FK_tblBulkRunSchedule_Header'', ''F'') IS NULL
    ALTER TABLE dbo.tblBulkRunSchedule ADD CONSTRAINT FK_tblBulkRunSchedule_Header FOREIGN KEY (ScheduleId) REFERENCES dbo.tblBulkRunScheduleHeader (ScheduleId);
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = ''IX_tblBulkRunSchedule_ScheduleId'' AND object_id = OBJECT_ID(''dbo.tblBulkRunSchedule''))
    CREATE INDEX IX_tblBulkRunSchedule_ScheduleId ON dbo.tblBulkRunSchedule (ScheduleId, DayOfWeek);
');

------------------------------------------------------------------------
-- 3. Link table keyed on ScheduleId. Creates it if Kevin's does not exist yet;
--    otherwise adds ScheduleId beside ScheduleName and back-fills where the name is unambiguous.
------------------------------------------------------------------------
IF OBJECT_ID(@Link, 'U') IS NULL
    EXEC(N'
    CREATE TABLE ' + @Link + N' (
        ScheduleId  int           NOT NULL CONSTRAINT FK_tblBulkRunScheduleClient_Header REFERENCES dbo.tblBulkRunScheduleHeader (ScheduleId),
        ClientId    int           NOT NULL,
        CreatedUtc  datetime2(0)  NOT NULL CONSTRAINT DF_tblBulkRunScheduleClient_CreatedUtc DEFAULT SYSUTCDATETIME(),
        CreatedBy   nvarchar(100) NOT NULL,
        CONSTRAINT PK_tblBulkRunScheduleClient PRIMARY KEY (ScheduleId, ClientId)
    );
    CREATE INDEX IX_tblBulkRunScheduleClient_Client ON ' + @Link + N' (ClientId);');
ELSE IF COL_LENGTH(@Link, 'ScheduleId') IS NULL
    EXEC(N'
    ALTER TABLE ' + @Link + N' ADD ScheduleId int NULL;
    EXEC(N''
    UPDATE l SET l.ScheduleId = h.ScheduleId
    FROM ' + @Link + N' l
    CROSS APPLY (SELECT h.ScheduleId FROM dbo.tblBulkRunScheduleHeader h
                 WHERE h.Name = LTRIM(RTRIM(l.ScheduleName)) AND h.IsDefault = 0 AND h.RetiredUtc IS NULL
                 GROUP BY h.ScheduleId HAVING COUNT(*) = 1) h;
    -- rows whose name matches several headers stay NULL and are listed by the check below
    '');
    ALTER TABLE ' + @Link + N' ADD CONSTRAINT FK_tblBulkRunScheduleClient_Header FOREIGN KEY (ScheduleId) REFERENCES dbo.tblBulkRunScheduleHeader (ScheduleId);
    CREATE UNIQUE INDEX UX_tblBulkRunScheduleClient_Schedule_Client ON ' + @Link + N' (ScheduleId, ClientId) WHERE ScheduleId IS NOT NULL;
    -- once every row has a ScheduleId: ALTER COLUMN ScheduleId int NOT NULL; DROP COLUMN ScheduleName;');

-- Every client-specific schedule becomes a link row (this is what replaces the 1-1 ClientId).
EXEC(N'
INSERT INTO ' + @Link + N' (ScheduleId, ClientId, CreatedBy)
SELECT h.ScheduleId, h.LegacyClientId, N''' + @CreatedBy + N'''
FROM dbo.tblBulkRunScheduleHeader h
WHERE h.IsDefault = 0 AND h.RetiredUtc IS NULL
  AND NOT EXISTS (SELECT 1 FROM ' + @Link + N' l WHERE l.ScheduleId = h.ScheduleId AND l.ClientId = h.LegacyClientId);');

------------------------------------------------------------------------
-- 4. Checks. All three must return 0 rows / matching counts before @Commit = 1.
------------------------------------------------------------------------
SELECT (SELECT COUNT(*) FROM dbo.tblBulkRunScheduleHeader WHERE RetiredUtc IS NULL) AS Headers,
       (SELECT COUNT(*) FROM dbo.tblBulkRunScheduleHeader WHERE IsDefault = 1 AND RetiredUtc IS NULL) AS Defaults,
       (SELECT COUNT(*) FROM dbo.tblBulkRunSchedule) AS DayRows;
EXEC(N'SELECT * FROM ' + @Link + N' WHERE ScheduleId IS NULL;');                                        -- name-keyed rows that could not be resolved
EXEC(N'SELECT h.* FROM dbo.tblBulkRunScheduleHeader h WHERE h.IsDefault = 0 AND h.RetiredUtc IS NULL
       AND NOT EXISTS (SELECT 1 FROM ' + @Link + N' l WHERE l.ScheduleId = h.ScheduleId);');           -- client schedules with no link row

IF @Commit = 1 COMMIT TRAN ELSE ROLLBACK TRAN;
