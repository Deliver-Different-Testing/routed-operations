-- Restore staging from the snapshots taken by rationalise_schedules_staging.sql (20260908).
-- Drop the IDENTITY_INSERT lines for a table that has no identity column.
SET NOCOUNT ON; SET XACT_ABORT ON;
DECLARE @Commit bit = 0;
BEGIN TRAN;
IF OBJECT_ID('dbo.tblBulkRunSchedule_PreMerge_20260908', 'U') IS NULL THROW 50000, 'snapshot tables missing - nothing to restore from', 1;
DELETE FROM dbo.tblBulkRunScheduleClient;
INSERT INTO dbo.tblBulkRunScheduleClient (ScheduleId, ClientId, CreatedUtc, CreatedBy) SELECT ScheduleId, ClientId, CreatedUtc, CreatedBy FROM dbo.tblBulkRunScheduleClient_PreMerge_20260908;
UPDATE h SET h.RetiredUtc = p.RetiredUtc, h.RetiredBy = p.RetiredBy FROM dbo.tblBulkRunScheduleHeader h JOIN dbo.tblBulkRunScheduleHeader_PreMerge_20260908 p ON p.ScheduleId = h.ScheduleId;
SET IDENTITY_INSERT dbo.tblBulkRunSchedule ON;
INSERT INTO dbo.tblBulkRunSchedule (BulkRunScheduleId, Name, DayOfWeek, StartTime, EndTime, MaxJobs, Region, ClientId, SpeedId, CutoffHours, Description, AutoBook, PostcodeGroupId, BookPickup, PickupDepotId, StorageState, DeliveryState, PickupRatingSpeed, PickupPostcodeGroupId, ParentSpeedId, PickupBoxDiscount, DropOffLocationID, ApplyPickupCutoff, PickupCutoff, AutoBookScanAhead, IsRecurringSchedule, ScheduleId)
  SELECT BulkRunScheduleId, Name, DayOfWeek, StartTime, EndTime, MaxJobs, Region, ClientId, SpeedId, CutoffHours, Description, AutoBook, PostcodeGroupId, BookPickup, PickupDepotId, StorageState, DeliveryState, PickupRatingSpeed, PickupPostcodeGroupId, ParentSpeedId, PickupBoxDiscount, DropOffLocationID, ApplyPickupCutoff, PickupCutoff, AutoBookScanAhead, IsRecurringSchedule, ScheduleId FROM dbo.tblBulkRunSchedule_PreMerge_20260908 p WHERE NOT EXISTS (SELECT 1 FROM dbo.tblBulkRunSchedule s WHERE s.BulkRunScheduleId = p.BulkRunScheduleId);
SET IDENTITY_INSERT dbo.tblBulkRunSchedule OFF;
UPDATE s SET s.ClientId = p.ClientId FROM dbo.tblBulkRunSchedule s JOIN dbo.tblBulkRunSchedule_PreMerge_20260908 p ON p.BulkRunScheduleId = s.BulkRunScheduleId WHERE ISNULL(s.ClientId, -1) <> ISNULL(p.ClientId, -1);
SET IDENTITY_INSERT dbo.BulkZoneSchedule ON;
INSERT INTO dbo.BulkZoneSchedule (Id, Zone, ScheduleId, Active)
  SELECT Id, Zone, ScheduleId, Active FROM dbo.BulkZoneSchedule_PreMerge_20260908 p WHERE NOT EXISTS (SELECT 1 FROM dbo.BulkZoneSchedule z WHERE z.Id = p.Id);
SET IDENTITY_INSERT dbo.BulkZoneSchedule OFF;
-- DROP TABLE dbo.tblBulkRunSchedule_PreMerge_20260908; DROP TABLE dbo.tblBulkRunScheduleHeader_PreMerge_20260908; DROP TABLE dbo.tblBulkRunScheduleClient_PreMerge_20260908; DROP TABLE dbo.BulkZoneSchedule_PreMerge_20260908;  -- once you are happy
IF @Commit = 1 COMMIT TRAN ELSE ROLLBACK TRAN;
