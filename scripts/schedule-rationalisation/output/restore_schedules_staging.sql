-- Restore staging from the snapshot taken by rationalise_schedules_staging.sql (20260908).
-- Puts back retired rows, original Name/ClientId on surviving rows, zone rows, and removes the link rows.
-- Drop the two IDENTITY_INSERT lines per table if that table has no identity column.
SET NOCOUNT ON; SET XACT_ABORT ON;
DECLARE @Commit bit = 0;
BEGIN TRAN;
IF OBJECT_ID('dbo.tblBulkRunSchedule_PreRationalise_20260908', 'U') IS NULL THROW 50000, 'snapshot table missing - nothing to restore from', 1;
DELETE FROM dbo.tblBulkRunScheduleClient WHERE CreatedBy = N'steve@urgent.co.nz' AND CreatedUtc = '2026-09-08T02:00:00Z';
SET IDENTITY_INSERT dbo.tblBulkRunSchedule ON;
INSERT INTO dbo.tblBulkRunSchedule (BulkRunScheduleId, Name, DayOfWeek, StartTime, EndTime, MaxJobs, Region, ClientId, SpeedId, CutoffHours, Description, AutoBook, PostcodeGroupId, BookPickup, PickupDepotId, StorageState, DeliveryState, PickupRatingSpeed, PickupPostcodeGroupId, ParentSpeedId, PickupBoxDiscount, DropOffLocationID, ApplyPickupCutoff, PickupCutoff, AutoBookScanAhead, IsRecurringSchedule)
  SELECT BulkRunScheduleId, Name, DayOfWeek, StartTime, EndTime, MaxJobs, Region, ClientId, SpeedId, CutoffHours, Description, AutoBook, PostcodeGroupId, BookPickup, PickupDepotId, StorageState, DeliveryState, PickupRatingSpeed, PickupPostcodeGroupId, ParentSpeedId, PickupBoxDiscount, DropOffLocationID, ApplyPickupCutoff, PickupCutoff, AutoBookScanAhead, IsRecurringSchedule FROM dbo.tblBulkRunSchedule_PreRationalise_20260908 p WHERE NOT EXISTS (SELECT 1 FROM dbo.tblBulkRunSchedule s WHERE s.BulkRunScheduleId = p.BulkRunScheduleId);
SET IDENTITY_INSERT dbo.tblBulkRunSchedule OFF;
UPDATE s SET s.Name = p.Name, s.ClientId = p.ClientId FROM dbo.tblBulkRunSchedule s JOIN dbo.tblBulkRunSchedule_PreRationalise_20260908 p ON p.BulkRunScheduleId = s.BulkRunScheduleId
  WHERE s.Name <> p.Name OR ISNULL(s.ClientId, -1) <> ISNULL(p.ClientId, -1);
SET IDENTITY_INSERT dbo.BulkZoneSchedule ON;
INSERT INTO dbo.BulkZoneSchedule (Id, Zone, ScheduleId, Active)
  SELECT Id, Zone, ScheduleId, Active FROM dbo.BulkZoneSchedule_PreRationalise_20260908 p WHERE NOT EXISTS (SELECT 1 FROM dbo.BulkZoneSchedule z WHERE z.Id = p.Id);
SET IDENTITY_INSERT dbo.BulkZoneSchedule OFF;
-- DROP TABLE dbo.tblBulkRunSchedule_PreRationalise_20260908; DROP TABLE dbo.BulkZoneSchedule_PreRationalise_20260908;  -- once you are happy
IF @Commit = 1 COMMIT TRAN ELSE ROLLBACK TRAN;
