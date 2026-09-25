// Part 3 of 3. Pricing helpers ported from BulkService.cs:
//   - PriceAndSplitJobsAndReturnKmRatedJobs (main entry)
//   - SplitJobAndApplyAmount / InsertLinehaulJobsAndApplyAmount
//   - InsertLinehaulJobs / InsertPickupJobs / InsertDeliveryJobs
//   - GetLinehaulAmount / CalculatePickupBookingDateTime / CalculateLinehaulBookingDateTime
//   - GetZoneZipsForCountry / GetLocationForZip / GetLocationIdFromZipCode /
//     GetFromLatLngFromZipCode / GetStateMapping
//   - GetPickupRate / BookPickup / GetBulkHomeDeliveryPickupJob
//   - GetSuburbID_FromNameWithPostCode / GetStockSizeID
//   - GeocodePickupFromAddress
//
// This is the fattest partial - all zone / linehaul / pickup / delivery
// splitting lives here. Behaviour is kept byte-identical vs BulkImportHyper.
using Microsoft.EntityFrameworkCore;
using Microsoft.Data.SqlClient;
using Newtonsoft.Json;
using RoutedOperations.Core.Application.Dtos.BulkImport.Address;
using RoutedOperations.Core.Application.Dtos.BulkImport.Bulk;
using RoutedOperations.Core.Application.Dtos.BulkImport.Common;
using RoutedOperations.Core.Application.Utilities;
using RoutedOperations.Core.Domain;
using RoutedOperations.Core.Domain.Despatch;
using RoutedOperations.Core.Domain.Models;
using Serilog;
using System.Data;
using System.Globalization;

namespace RoutedOperations.Core.Application.Services.BulkImport;

public partial class BulkImportServiceV2
{
    // ---- pickup rate + book ----------------------------------------------

    public async Task<PickupJobRateResponse> GetPickupRate(int contactId, PickupJobRequest request)
    {
        PickupJobRateResponse response = new PickupJobRateResponse(request.MessageId);

        if (request.PickupJob.Time.Kind == DateTimeKind.Utc)
        {
            request.PickupJob.Time = TimeZoneUtility.ConvertToTenantTime(request.PickupJob.Time, _httpContextAccessor);
            Log.Information($"({request.MessageId})({contactId}) [GetPickupRate] Converted pickup time from UTC to tenant timezone: {request.PickupJob.Time:yyyy-MM-dd HH:mm:ss}");
        }
        request.PickupJob.Quantity = (int)Math.Ceiling((decimal)request.PickupJob.Quantity / request.NumberOfVehicle);
        request.PickupJob.Weight = (Convert.ToDecimal(request.PickupJob.Weight) / request.NumberOfVehicle).ToString();

        var rates = await Context.UrgentRates
                    .FromSqlInterpolated($"EXEC WS_stpJobType_Rates {request.PickupJob.ClientID}, {request.VehicleSize}, {request.PickupJob.FromSuburb}, {request.PickupJob.ToSuburb}, {request.PickupJob.Weight}, 1, {request.PickupJob.Time}, null")
                    .ToListAsync();

        var priorityOrder = new[] { 1, 29, 24, 25 };
        var rate = priorityOrder
            .Select(id => rates.FirstOrDefault(r => r.JobTypeID == id && r.Rate > 0))
            .FirstOrDefault(r => r != null);
        response.Amount = request.NumberOfVehicle * rate?.Rate;

        if (response.Amount.HasValue && response.Amount > 0)
        {
            response.Success = true;
        }

        return response;
    }

    public async Task<PickupJobResponse> BookPickup(int contactId, PickupJobRequest request)
    {
        PickupJobResponse response = new PickupJobResponse(request.MessageId);

        if (request.PickupJob.Time.Kind == DateTimeKind.Utc)
        {
            request.PickupJob.Time = TimeZoneUtility.ConvertToTenantTime(request.PickupJob.Time, _httpContextAccessor);
            Log.Information($"({request.MessageId})({contactId}) [BookPickup] Converted pickup time from UTC to tenant timezone: {request.PickupJob.Time:yyyy-MM-dd HH:mm:ss}");
        }

        request.PickupJob.Quantity = (int)Math.Ceiling((decimal)request.PickupJob.Quantity / request.NumberOfVehicle);
        request.PickupJob.Weight = (Convert.ToDecimal(request.PickupJob.Weight) / request.NumberOfVehicle).ToString();

        for (int i = 0; i < request.NumberOfVehicle; i++)
        {
            var jobId = new SqlParameter("@JobID", SqlDbType.Int) { Direction = ParameterDirection.Output };
            var message = new SqlParameter("@Message", SqlDbType.NVarChar, 1000) { Direction = ParameterDirection.Output };

            var result =
                await Context.Database.ExecuteSqlInterpolatedAsync($"EXEC WS_stpJob_Insert {request.PickupJob.BookedBy}, {request.PickupJob.FromAddress}, {request.PickupJob.FromSuburb}, {request.PickupJob.FromPostCode}, {request.PickupJob.Speed}, {request.PickupJob.SpeedID}, {request.PickupJob.ToAddress}, {request.PickupJob.ToSuburb}, {request.PickupJob.ToPostCode}, {request.PickupJob.ToAddressType}, {request.PickupJob.ReferenceA}, {request.PickupJob.ReferenceB}, {request.VehicleSize}, {request.PickupJob.Weight}, {request.PickupJob.Return}, {request.PickupJob.CourierNotes}, {request.PickupJob.ClientNotes}, {request.PickupJob.FromContactName}, {request.PickupJob.FromPhoneNumber}, {request.PickupJob.ToContactName}, {request.PickupJob.ToPhoneNumber}, {request.PickupJob.Type}, {request.PickupJob.PickUpFrom}, {request.PickupJob.Quantity}, {request.PickupJob.LeaveNotHome}, {request.PickupJob.JobNotificationType}, {request.PickupJob.JobNotificationEmail}, {request.PickupJob.JobNotificationMobile}, {request.PickupJob.ToAddressCode}, {request.PickupJob.FromAddressCode}, {request.PickupJob.ClientID}, {request.PickupJob.Time}, {request.PickupJob.Hold}, {request.PickupJob.FixedAmount}, {jobId} out, {request.PickupJob.AgentAmount}, {request.PickupJob.AgentCourierID}, {request.PickupJob.FuelSurchargeAmount}, {request.PickupJob.OurRef}, {message} out, {request.PickupJob.PickUpLatitude}, {request.PickupJob.PickUpLongitude}, {request.PickupJob.DeliveryLatitude}, {request.PickupJob.DeliveryLongitude}, {request.PickupJob.Kms}, {request.PickupJob.DGClass}, {request.PickupJob.DGDocument}, {request.PickupJob.ShopId}, {request.PickupJob.ShopRef1}, {request.PickupJob.ShopRef2}, {request.PickupJob.ShopRef3}, {request.PickupJob.ShopRef4}, {request.PickupJob.ShopRef5}, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 3");

            if (jobId.Value != null && jobId.Value != DBNull.Value)
            {
                response.JobId.Add((Int32)jobId.Value);
            }

            if (message.Value != null && jobId.Value != DBNull.Value)
            {
                response.Messages.Add(new MessageDto() { Message = message.Value.ToString() });
            }

            Log.Information($"({request.MessageId})({contactId}) Insert Pickup Job with JobID {jobId.Value}.");
        }

        response.Success = true;
        return response;
    }

    // ---- pricing (main entry) ---------------------------------------------

    private async Task<(List<TblBulkJob> zoneRatedJobs, List<TblBulkJob> kmRatedJobs, List<PendingBulkJobItem> pendingJobItems)> PriceAndSplitJobsAndReturnKmRatedJobs(Guid messageId, List<TblBulkJob> jobs, int? scheduleId)
    {
        var returnJobs = new List<List<TblBulkJob>>();
        var pendingJobItems = new List<PendingBulkJobItem>();

        Log.Information($"({messageId}) Pricing {jobs.Sum(x => x.Qty)} Jobs.");

        var schedule = await Context.TblBulkRunSchedules
                        .FirstOrDefaultAsync(s => s.BulkRunScheduleId == scheduleId);

        var clients = await Context.TucClients
            .Where(c => jobs.Select(j => j.ClientId).Distinct().Contains(c.UcclId))
            .Select(c => new
            {
                c.UcclId,
                AddonPercentage = c.AddonPercentage > 0 && c.AddonPercentage <= 1 ? c.AddonPercentage : null
            })
            .ToListAsync();

        var activeZonesBySchedule = await Context.BulkZoneSchedules
            .Where(x => x.Active == true && (!x.ScheduleId.HasValue || (x.ScheduleId.HasValue && x.ScheduleId == scheduleId)))
            .Select(x => new
            {
                x.Zone,
                depotId = x.ScheduleId.HasValue ? x.Schedule.Region : schedule.Region,
                ScheduleId = x.ScheduleId ?? schedule.BulkRunScheduleId,
                x.Active,
                postcodes = IsUsTenant()
                                ? Context.ZoneZips
                                    .Where(z => z.ZoneNumber == x.Zone && z.ZoneName.LocationId == (x.ScheduleId.HasValue ? x.Schedule.Region : schedule.Region))
                                    .Select(z => z.Zip)
                                    .ToArray()
                                : Context.BulkZonePostcodes
                                            .Where(p => p.Zone == x.Zone && p.DepotId == (x.ScheduleId.HasValue ? x.Schedule.Region : schedule.Region) && p.PostcodeGroupId == x.Schedule.PostcodeGroupId)
                                            .Select(P => P.PostCode.ToString())
                                            .ToArray()
            })
            .ToListAsync();

        var activePostCodes = activeZonesBySchedule.SelectMany(l => l.postcodes).ToList();

        var surchargePostcodes = await Context.BulkZonePostcodeSurcharges
            .Where(c => jobs.Select(j => j.ClientId).Distinct().Contains(c.ClientId.Value) && c.Surcharge.HasValue && c.Surcharge > 0)
            .Select(x => x.PostCode)
            .ToListAsync();

        var suburbs = await Context.TucSuburbs
            .Select(s => new
            {
                s.UcsuId,
                s.UcsuName,
                s.PostCode,
                s.SiteId
            })
            .ToListAsync();

        var zoneSpeedIds = await Context.TucJobTypes
            .Where(s => s.ZoneRated == true)
            .Select(s => s.UcjtId)
            .ToListAsync();

        var stateMapping = await GetStateMapping(jobs);

        List<ZipCodeDto> zipCodes;
        Dictionary<string, int?> postCodeLocationMap = new Dictionary<string, int?>();

        if (IsUsTenant())
        {
            var jobPostCodes = jobs.Select(j => j.ToPostCode.ToString()).Distinct().ToList();
            var zoneZipsData = await Context.ZoneZips
                .Include(z => z.ZoneName)
                .Where(z => jobPostCodes.Contains(z.Zip) && z.ZoneName.LocationId.HasValue)
                .Select(z => new
                {
                    Id = z.ZoneZipId,
                    ZoneNumber = z.ZoneNameId,
                    Zip = z.Zip.ToString(),
                    ClientId = z.ClientId,
                    LocationId = z.ZoneName.LocationId
                })
                .ToListAsync();

            zipCodes = zoneZipsData.Select(z => new ZipCodeDto
            {
                Id = z.Id,
                ZoneNumber = z.ZoneNumber,
                Zip = z.Zip,
                ClientId = z.ClientId
            }).ToList();

            foreach (var z in zoneZipsData)
            {
                var formattedZip = AddressUtility.FormatPostCode(z.Zip);
                if (!postCodeLocationMap.ContainsKey(formattedZip))
                    postCodeLocationMap[formattedZip] = z.LocationId;
            }
        }
        else
        {
            var bulkZoneData = await Context.BulkZonePostcodes
                .Where(x => jobs.Select(j => j.ToPostCode).Distinct().Contains(x.PostCode) &&
                           (scheduleId == null || x.PostcodeGroupId == schedule.PostcodeGroupId))
                .Select(x => new
                {
                    Id = x.Id,
                    ZoneNumber = x.Zone,
                    PostCode = x.PostCode.ToString(),
                    DepotId = x.DepotId
                })
                .ToListAsync();

            zipCodes = bulkZoneData.Select(x => new ZipCodeDto
            {
                Id = x.Id,
                ZoneNumber = x.ZoneNumber,
                Zip = x.PostCode,
                ClientId = null
            }).ToList();

            foreach (var z in bulkZoneData)
            {
                var formattedPostCode = AddressUtility.FormatPostCode(z.PostCode);
                if (!postCodeLocationMap.ContainsKey(formattedPostCode))
                    postCodeLocationMap[formattedPostCode] = z.DepotId;
            }
        }

        var zonesToPrice = jobs
            .Where(j => zoneSpeedIds.Contains(j.Speed) && activePostCodes.Contains(j.ToPostCode.ToString()))
            .GroupBy(j => new
            {
                BookDate = j.BookDate.Date,
                j.ClientId,
                SiteId = postCodeLocationMap.GetValueOrDefault(AddressUtility.FormatPostCode(j.ToPostCode.ToString())),
                Zone = zipCodes.FirstOrDefault(x =>
                    AddressUtility.FormatPostCode(x.Zip) ==
                    AddressUtility.FormatPostCode(j.ToPostCode.ToString()))?.ZoneNumber,
                Cubic = j.Length * j.Width * j.Height,
                SpeedId = j.Speed,
                BulkRunScheduleId = scheduleId,
                FromSuburbID = j.FromSuburb != null ? GetSuburbID_FromNameWithPostCode(Context, j.FromSuburb, j.FromPostCode) : 0,
                ToSuburbID = j.ToSuburb != null ? GetSuburbID_FromNameWithPostCode(Context, j.ToSuburb, j.ToPostCode) : 0,
                OurRef = j.OurRef,
                ClientReferenceA = j.ClientRefa,
                ClientReferenceB = j.ClientRefb,
                Quantity = j.Qty,
                FromPostCode = j.FromPostCode,
                ToPostCode = j.ToPostCode,
                // Qty is nullable on TblBulkJob; coerce to 1 so a row without a
                // quantity still produces a single-item cubic/weight list rather
                // than throwing at projection time. Matches the group.Sum guard
                // at the aggregate side.
                CubicList = string.Join(", ", Enumerable.Repeat(((j.Length * j.Width * j.Height) / 1000000).ToString(), j.Qty ?? 1)),
                WeightList = string.Join(", ", Enumerable.Repeat(j.Weight, j.Qty ?? 1)),
                stockSizeID = GetStockSizeID(j.Length, j.Width, j.Height, j.Weight)
            })
            .Where(j => activeZonesBySchedule.Select(x => x.Zone).Contains(j.Key.Zone ?? 0))
            .ToList();

        var zoneRatedJobs = new List<TblBulkJob>();
        int zonePricedCount = 0;
        if (zonesToPrice.Any())
        {
            foreach (var group in zonesToPrice)
            {
                decimal? amount = null;
                var zoneLinehaulRate = new List<ZoneLinehaulRate>();
                if (group.Key.SiteId.HasValue && group.Key.Zone.HasValue)
                {
                    var firstJob = group.FirstOrDefault();
                    if (firstJob != null)
                    {
                        int fromZipCode = firstJob.FromPostCode ?? 0;
                        int toZipCode = firstJob.ToPostCode ?? 0;
                        string fromState = stateMapping.GetValueOrDefault(firstJob.FromPostCode?.ToString());
                        string toState = stateMapping.GetValueOrDefault(firstJob.ToPostCode?.ToString());
                        decimal totalWeight = group.Sum(j => j.Weight ?? 0);
                        int quantity = group.Sum(j => j.Qty ?? 1);
                        int vehicleSizeId = EstimateVehicleSize(firstJob.Length ?? 1, firstJob.Width ?? 1, firstJob.Height ?? 1, firstJob.Weight ?? 1);

                        decimal kms = 0;
                        if (!string.IsNullOrEmpty(firstJob.PickUpLatitude) && !string.IsNullOrEmpty(firstJob.PickUpLongitude) &&
                            !string.IsNullOrEmpty(firstJob.DeliveryLatitude) && !string.IsNullOrEmpty(firstJob.DeliveryLongitude))
                        {
                            var distance = await GetKmsAsync($"{firstJob.PickUpLatitude},{firstJob.PickUpLongitude}",
                                                           $"{firstJob.DeliveryLatitude},{firstJob.DeliveryLongitude}");
                            kms = (decimal)distance;
                        }

                        if (IsUsTenant())
                        {
                            var exceleratorRates = await Context.UrgentRates
                                .FromSqlInterpolated($"SELECT * FROM [dbo].[UTL_fncJob_ExceleratorRate] ({group.Key.ClientId}, {fromZipCode}, {fromState}, {toZipCode}, {toState}, {kms}, {totalWeight}, {quantity}, null, null, null, {group.Key.BookDate}, {vehicleSizeId}, null, null, null, null)")
                                .ToListAsync();

                            var rateForSpeed = exceleratorRates.FirstOrDefault(r => r.JobTypeID == group.Key.SpeedId);
                            if (rateForSpeed != null)
                            {
                                amount = rateForSpeed.Rate;
                            }
                            else
                            {
                                amount = exceleratorRates.FirstOrDefault()?.Rate;
                            }
                        }
                        else
                        {
                            zoneLinehaulRate = await Context.ZoneLinehaulRate
                                .FromSqlInterpolated($"select * from dbo.fncT_BulkZoneRate_WithLinehaul({group.Key.Zone}, {group.Key.ClientId}, {group.Key.SiteId}, 1, {group.Key.BookDate}, 1, 1, {group.Key.SpeedId}, {group.Key.BulkRunScheduleId}, {group.Key.FromSuburbID}, {group.Key.ToSuburbID}, 1, 0, 0, {group.Key.OurRef}, {group.Key.ClientReferenceA}, {group.Key.ClientReferenceB}, {group.Key.Quantity}, 0, {group.Key.FromPostCode}, {group.Key.ToPostCode}, {group.Key.CubicList}, {group.Key.WeightList}, {group.Key.stockSizeID})")
                                .ToListAsync();

                            amount = zoneLinehaulRate.FirstOrDefault()?.ZoneAmount;
                        }

                        if (IsUsTenant() && (schedule?.Region != group.Key.SiteId || schedule?.BookPickup == true))
                        {
                            zoneLinehaulRate = await Context.ZoneLinehaulRate
                                .FromSqlInterpolated($"select * from dbo.fncT_BulkZoneRate_WithLinehaul({group.Key.Zone}, {group.Key.ClientId}, {group.Key.SiteId}, 1, {group.Key.BookDate}, 1, 1, {group.Key.SpeedId}, {group.Key.BulkRunScheduleId}, {group.Key.FromSuburbID}, {group.Key.ToSuburbID}, 1, 0, 0, {group.Key.OurRef}, {group.Key.ClientReferenceA}, {group.Key.ClientReferenceB}, {group.Key.Quantity}, 0, {group.Key.FromPostCode}, {group.Key.ToPostCode}, {group.Key.CubicList}, {group.Key.WeightList}, {group.Key.stockSizeID})")
                                .ToListAsync();

                            amount = zoneLinehaulRate.FirstOrDefault()?.ZoneAmount ?? amount;
                        }
                    }
                }

                foreach (var job in group)
                {
                    decimal? newAmount = null;
                    // Nullable dereference guard: rows without a resolved
                    // ToPostCode never match the surcharge list, so skip the
                    // rate lookup rather than NRE.
                    if (job.ToPostCode.HasValue && surchargePostcodes.Contains(job.ToPostCode.Value))
                    {
                        var rates = await Context.ZoneRates
                            .FromSqlInterpolated($"EXEC sp_BulkZoneRate_AddPostCodeSurcharge {job.ClientId}, {job.ToPostCode}, {amount}, {job.BookDate}")
                            .ToListAsync();
                        newAmount = rates.FirstOrDefault()?.Rate;
                    }

                    if (zoneLinehaulRate.Any())
                    {
                        InsertLinehaulJobsAndApplyAmount(jobs, job, zoneLinehaulRate.FirstOrDefault(), zoneRatedJobs, schedule, pendingJobItems);
                    }
                    else
                    {
                        SplitJobAndApplyAmount(jobs, job, newAmount ?? amount, zoneRatedJobs, schedule, pendingJobItems: pendingJobItems);
                    }
                }
            }
            zonePricedCount = jobs.Count(j => j.Amount.HasValue);
            Log.Information($"({messageId}) Zone pricing has completed and priced {zonePricedCount} jobs.");
        }

        var kmRatedJobs = new List<TblBulkJob>();
        var kmJobs = jobs.Where(x => !zoneRatedJobs.Contains(x)).ToList();
        if (kmJobs.Any())
        {
            var ratesRequests = kmJobs
             .GroupBy(j => new
             {
                 j.Speed,
                 j.ClientId,
                 Size = j.Size == 1 ? "Bike" : j.Size == 2 ? "Car" : j.Size == 3 ? "Van" : j.Size == 4 ? "Truck" : "Car",
                 j.FromSuburb,
                 j.ToSuburb,
                 j.Weight,
                 j.BookDate,
                 Zone = zipCodes.FirstOrDefault(x =>
                     AddressUtility.FormatPostCode(x.Zip) ==
                     AddressUtility.FormatPostCode(j.ToPostCode.ToString()))?.ZoneNumber,
                 Kms = GetKmsAsync(
                     GetFromLatLngFromZipCode(zipCodes, j.ToPostCode.ToString()).Result ??
                     j.PickUpLatitude + "," + j.PickUpLongitude,
                     j.DeliveryLatitude + "," + j.DeliveryLongitude).Result
             }).ToList();

            if (ratesRequests.Any())
            {
                Log.Information($"({messageId}) Standard pricing {ratesRequests.Sum(x => x.Sum(j => j.Qty))} jobs. Request required {ratesRequests.Count()}.");
                foreach (var group in ratesRequests)
                {
                    var rates = await Context.UrgentRates
                        .FromSqlInterpolated($"EXEC WS_stpJobType_KmRates {group.Key.ClientId}, {group.Key.Speed}, {group.Key.BookDate}, {group.Key.Kms}, 1, 1")
                        .ToListAsync();

                    foreach (var job in group)
                    {
                        var selectedRate = rates
                                        .FirstOrDefault(r => (r.JobTypeID == job.Speed || (r.JobTypeID.ToString() == schedule.BulkRunScheduleId.ToString() + job.Speed.ToString().PadLeft(3, '0')))
                                                                && r.Rate > 0)?.Rate;

                        SplitJobAndApplyAmount(kmJobs, job, selectedRate, null, schedule);
                    }
                }

                kmRatedJobs.AddRange(kmJobs);
                Log.Information($"({messageId}) Standard pricing completed pricing {jobs.Count(j => j.Amount.HasValue) - zonePricedCount} jobs.");
            }
        }

        Log.Information($"({messageId}) Pricing completed pricing {jobs.Count(j => j.Amount.HasValue)} out of {jobs.Count()} jobs.");

        return (zoneRatedJobs, kmRatedJobs, pendingJobItems);
    }

    // ---- home delivery pickup ---------------------------------------------

    private async Task<PickupJobToCreateResponse> GetBulkHomeDeliveryPickupJob(Guid messageId, dynamic client, TimeSpan scheduleStartTime, List<TblBulkJob> jobs, PickupJobRequest request)
    {
        PickupJobToCreateResponse response = new PickupJobToCreateResponse();

        decimal? weight = jobs.Sum(j => j.Weight);
        int? qty = jobs.Sum(j => j.Qty);

        if (request != null && request.PickupJob != null)
        {
            request.PickupJob.Quantity += qty;
        }
        else
        {
            string clientAddress = client.UcclAddress;
            int? clientSuburbId = client.UcclSuburbId;
            string clientPostCode = client.UcclPostCode;
            string clientLatitude = client.Latitude?.ToString();
            string clientLongitude = client.Longitude?.ToString();

            string fromSuburb = null;
            if (clientSuburbId.HasValue)
            {
                var suburb = await Context.TucSuburbs.FirstOrDefaultAsync(x => x.UcsuId == clientSuburbId.Value);
                fromSuburb = suburb?.UcsuName;
            }

            response = jobs
                    .Select(j => new PickupJobToCreateResponse()
                    {
                        NumberOfVehicles = new List<AngularOption>{
                            new AngularOption{ label ="1", value="1" },
                            new AngularOption{ label="2", value="2" },
                            new AngularOption{ label="3", value="3" }
                        },
                        VehicleSizes = new List<AngularOption> {
                            new AngularOption{ label ="Car (L 1.5m, H 0.73m, W 0.9m)", value="Car" },
                            new AngularOption{ label="Van (L 2.4m, H 1.10m, W 1.1m)", value="Van" },
                        },
                        PickupJob = new PickupJobToCreateDto()
                        {
                            BookedBy = j.Contact,
                            FromAddress = clientAddress,
                            FromSuburb = fromSuburb,
                            FromPostCode = Convert.ToInt32(clientPostCode),
                            Speed = "60",
                            SpeedID = 1,
                            ToAddress = "17 Saleyards Road",
                            ToSuburb = "Otahuhu",
                            ToPostCode = 1062,
                            ReferenceA = j.ClientRefa,
                            ReferenceB = j.ClientRefb,
                            Size = "Car",
                            Weight = weight.ToString(),
                            ClientNotes = j.Notes,
                            FromContactName = j.Contact,
                            ToContactName = j.DeliverToContact,
                            ToPhoneNumber = j.DeliverToPhone,
                            Type = "PICKUP",
                            Quantity = qty,
                            ClientID = j.ClientId,
                            // TODO: replace hard-coded -2 hours with configurable BulkPickupMinutesBeforeSchedule
                            Time = DateTime.SpecifyKind(j.BookDate.Date.AddTicks(scheduleStartTime.Ticks).AddHours(-2), j.BookDate.Kind),
                            OurRef = "PU",
                            PickUpLatitude = clientLatitude,
                            PickUpLongitude = clientLongitude,
                            DeliveryLatitude = "-36.939340000",
                            DeliveryLongitude = "174.832840000"
                        }
                    }).FirstOrDefault();
        }

        Log.Information($"({messageId}) ClientPickupJobToCreate Object created {JsonConvert.SerializeObject(response)} ");
        return response;
    }

    // ---- split / apply amount --------------------------------------------

    private void SplitJobAndApplyAmount(List<TblBulkJob> jobs, TblBulkJob job, decimal? amount, List<TblBulkJob> splitJobs, TblBulkRunSchedule schedule = null, ZoneLinehaulRate zoneRates = null, List<PendingBulkJobItem> pendingJobItems = null)
    {
        decimal addonPercentage = 0M;
        decimal? specialAddtionalAmount;

        if (amount.HasValue && amount <= 0)
            amount = null;

        if (job.Qty < 2)
        {
            // JobNumber is nullable when the operator used the "Autogenerate"
            // batch option and this row is being priced BEFORE the SP assigns
            // its number. A null number can't be a multi-box, so short-circuit
            // safely instead of NRE on Contains / Split / StartsWith.
            var jobNumberSafe = job.JobNumber ?? string.Empty;
            if (jobNumberSafe.Contains("-") && jobs.Count(j => (j.JobNumber ?? string.Empty).StartsWith($"{jobNumberSafe.Split("-")[0]}-")) > 1)
                job.Multibox = true;

            job.Amount = job.Multibox == true && amount.HasValue && jobNumberSafe.Contains("-") && !jobNumberSafe.EndsWith("-1") && jobs.Any(j => j.JobNumber == $"{jobNumberSafe.Split("-")[0]}-1")
                ? Math.Round(amount.Value * 0.80M, 2, MidpointRounding.AwayFromZero)
                : amount;
            job.SourceId = 3;

            pendingJobItems?.Add(new PendingBulkJobItem
            {
                ParentJobNumber = job.JobNumber,
                ItemId = 0,
                Items = 1,
                Weight = (double?)job.Weight,
                Length = (double?)job.Length,
                Height = (double?)job.Height,
                Depth = (double?)job.Width,
                Cubic = null,
                Notes = job.Notes,
                Barcode = $"{job.JobNumber}-1"
            });

            if (splitJobs != null)
            {
                splitJobs.Add(job);
            }
            return;
        }
        else
        {
            var rates = Context.ZoneRates
            .FromSqlInterpolated($"EXEC sp_BulkZoneRate_AdditionalSpecialRate {job.ClientId}, {job.Speed}, {job.BookDate}, 1, 1, {job.OurRef}, {job.ClientRefa}, {job.ClientRefb}, {job.Qty}")
            .ToList();
            specialAddtionalAmount = rates.FirstOrDefault()?.Rate;

            if (specialAddtionalAmount == null)
            {
                var clientAvailableSpeed = Context.TblClientAvailableSpeeds
                                        .FirstOrDefault(s => jobs.Select(j => j.ClientId).Distinct().Contains(s.ClientId) && jobs.Select(j => j.Speed).Distinct().Contains(s.SpeedId) && s.Active == true && s.UseSchedules == true);
                decimal? clientAvailableSpeedAddonPercentage = clientAvailableSpeed?.AddonPercentage;

                if (clientAvailableSpeedAddonPercentage != null)
                {
                    addonPercentage = clientAvailableSpeedAddonPercentage.Value;
                }
                else
                {
                    var clients = Context.TucClients
                  .Where(c => c.UcclId == job.ClientId)
                  .Select(c => new
                  {
                      c.UcclId,
                      AddonPercentage = c.AddonPercentage > 0 && c.AddonPercentage <= 1 ? c.AddonPercentage : null
                  })
                  .ToList();

                    // SplitJobAndApplyAmount is a sync method; use the sync EF
                    // API instead of blocking on .Result which risks deadlock
                    // under sync-context schedulers and starves the thread pool.
                    var speed = Context.TucJobTypes.FirstOrDefault(s => s.UcjtId == job.Speed);
                    decimal? speedAddonPercentage = speed?.AddonPercentage;

                    // Client row may not exist (soft-deleted between validate
                    // + price, or a race on tenant contact-perm). Fall back
                    // to speed default -> env/appsettings -> constant.
                    var clientAddon = clients.FirstOrDefault()?.AddonPercentage;
                    addonPercentage = clientAddon ?? (speedAddonPercentage ?? GetDefaultAddonPercentage());
                }
            }
        }

        decimal summedTotal = 0M;
        for (int i = 1; i <= job.Qty; i++)
        {
            decimal? itemAmount = i > 1
                ? (specialAddtionalAmount.HasValue ? specialAddtionalAmount : (amount.HasValue ? Math.Round(amount.Value * addonPercentage, 2, MidpointRounding.AwayFromZero) : amount))
                : amount;

            if (itemAmount.HasValue)
                summedTotal += itemAmount.Value;

            pendingJobItems?.Add(new PendingBulkJobItem
            {
                ParentJobNumber = job.JobNumber,
                ItemId = i - 1,
                Items = 1,
                Weight = (double?)job.Weight,
                Length = (double?)job.Length,
                Height = (double?)job.Height,
                Depth = (double?)job.Width,
                Cubic = null,
                Notes = job.Notes,
                Barcode = $"{job.JobNumber}-{i}"
            });
        }

        job.Barcode = job.JobNumber;
        job.Amount = zoneRates?.TotalAmount ?? (summedTotal > 0 ? summedTotal : amount);
        job.Multibox = true;
        job.SourceId = 3;
        job.ScheduleId = schedule?.BulkRunScheduleId;
        job.ScheduleName = schedule?.Name;

        if (splitJobs != null)
        {
            splitJobs.Add(job);
        }
    }

    // Default multi-box add-on percentage when the client has no per-account
    // override AND the speed has no default. Legacy sources use 0.8 in every
    // environment (envfile / appsettings). Env var stays a first-class
    // override so ops can tune per-tenant without a redeploy; the constant
    // is the safety net so a missing config never crashes /import.
    private const decimal DefaultAddonPercentageFallback = 0.8M;

    private static decimal GetDefaultAddonPercentage()
    {
        var raw = Environment.GetEnvironmentVariable("DefaultAddonPercentage");
        if (!string.IsNullOrWhiteSpace(raw)
            && decimal.TryParse(raw, System.Globalization.NumberStyles.Number,
                System.Globalization.CultureInfo.InvariantCulture, out var parsed))
        {
            return parsed;
        }
        return DefaultAddonPercentageFallback;
    }

    private void InsertLinehaulJobsAndApplyAmount(List<TblBulkJob> jobs, TblBulkJob job, ZoneLinehaulRate zoneRates, List<TblBulkJob> splitJobs, TblBulkRunSchedule schedule = null, List<PendingBulkJobItem> pendingJobItems = null)
    {
        var client = Context.TucClients.FirstOrDefault(c => jobs.Select(j => j.ClientId).Distinct().Contains(c.UcclId));
        decimal? amount = zoneRates?.ZoneAmount;

        if (amount.HasValue && amount <= 0)
            amount = null;

        // schedule can legitimately be null: on-demand batches pass null and
        // routed batches with an invalid schedule id also reach here via a
        // failed FirstOrDefaultAsync. When schedule is missing there is no
        // pickup or linehaul to expand, so fall straight through to the
        // per-job split path.
        if (schedule == null)
        {
            SplitJobAndApplyAmount(jobs, job, amount, splitJobs, schedule, zoneRates, pendingJobItems);
            return;
        }

        var hasPickup = schedule.BookPickup.HasValue && schedule.BookPickup.Value == true;
        var hasLinehaul = Context.TblBulkScheduleLinehauls.Any(l => l.BulkRunScheduleId == schedule.BulkRunScheduleId && (l.Active ?? false) == true);

        var insertParentJob = hasPickup || hasLinehaul;

        if (!insertParentJob)
        {
            SplitJobAndApplyAmount(jobs, job, amount, splitJobs, schedule, zoneRates, pendingJobItems);
        }
        else
        {
            if (schedule.BookPickup ?? false)
            {
                InsertPickupJobs(jobs, job, zoneRates, splitJobs, schedule, client);
            }

            if (hasLinehaul)
            {
                InsertLinehaulJobs(jobs, job, zoneRates, splitJobs, schedule, client);
            }

            InsertDeliveryJobs(jobs, job, zoneRates, splitJobs, schedule, client);

            job.Amount = zoneRates?.TotalAmount;
            job.Multibox = false;
            job.SourceId = 3;
            job.JobRelationshipTypeId = 19;
            job.ScheduleId = schedule?.BulkRunScheduleId;
            job.ScheduleName = schedule?.Name;

            for (int i = 1; i <= job.Qty; i++)
            {
                pendingJobItems?.Add(new PendingBulkJobItem
                {
                    ParentJobNumber = job.JobNumber,
                    ItemId = i - 1,
                    Items = 1,
                    Weight = (double?)job.Weight,
                    Length = (double?)job.Length,
                    Height = (double?)job.Height,
                    Depth = (double?)job.Width,
                    Cubic = null,
                    Notes = job.Notes,
                    Barcode = $"{job.JobNumber}-{i}"
                });
            }

            if (splitJobs != null)
            {
                splitJobs.Add(job);
            }
        }
    }

    private void InsertLinehaulJobs(List<TblBulkJob> jobs, TblBulkJob job, ZoneLinehaulRate zoneRates, List<TblBulkJob> splitJobs, TblBulkRunSchedule schedule, TucClient client)
    {
        var linehaulDetails = Context.TblBulkScheduleLinehauls.Where(l => l.BulkRunScheduleId == schedule.BulkRunScheduleId && l.Active.HasValue && l.Active == true).ToList();

        var legSingleAmounts = linehaulDetails
            .Select(l => GetLinehaulAmount(l, zoneRates.ZoneBaseAmount, client.UcclId, job.BookDate, job.Speed, job.Size))
            .ToList();
        var totalSingleLH = legSingleAmounts.Sum();
        var linehaulSumAmount = zoneRates.LinehaulSumAmount ?? totalSingleLH;

        var jobNumberStartCount = 1;
        foreach (var linehaul in linehaulDetails)
        {
            var linehaulAmount = legSingleAmounts[linehaulDetails.IndexOf(linehaul)];

            var linehaulFrom = Context.TblBulkRegions.Where(r => r.BulkRegionId == linehaul.FromDepotId && r.Active == true)
                                .Select(r => new LinehaulAddressDto()
                                {
                                    Company = r.FromCompany,
                                    Address = r.FromCompany + " " + r.Name + " Depot: " + r.FromAddress,
                                    Suburb = r.FromSuburb,
                                    SuburbID = 0,
                                    PostCode = r.FromPostCode,
                                    PickUpLatitude = r.PickupLatitude,
                                    PickUpLongitude = r.PickupLongitude
                                }).FirstOrDefault();
            var linehaulTo = Context.TblBulkRegions.Where(r => r.BulkRegionId == linehaul.ToDepotId && r.Active == true)
                                .Select(r => new LinehaulAddressDto()
                                {
                                    Company = r.FromCompany,
                                    Address = r.FromCompany + " " + r.Name + " Depot: " + r.FromAddress,
                                    Suburb = r.FromSuburb,
                                    SuburbID = 0,
                                    PostCode = r.FromPostCode,
                                    PickUpLatitude = r.PickupLatitude,
                                    PickUpLongitude = r.PickupLongitude
                                })
                                .FirstOrDefault();

            if (linehaulFrom != null && !string.IsNullOrEmpty(linehaulFrom.Suburb))
            {
                linehaulFrom.SuburbID = GetSuburbID_FromNameWithPostCode(Context, linehaulFrom.Suburb, linehaulFrom.PostCode);
            }
            if (linehaulTo != null && !string.IsNullOrEmpty(linehaulTo.Suburb))
            {
                linehaulTo.SuburbID = GetSuburbID_FromNameWithPostCode(Context, linehaulTo.Suburb, linehaulTo.PostCode);
            }

            if (linehaul.FromClientAddress ?? false)
            {
                linehaulFrom = new LinehaulAddressDto()
                {
                    Company = client.UcclLegalName,
                    Address = client.UcclAddress,
                    // Suburb lookup may return null when the client's suburb id
                    // points at a row that has since been merged / retired.
                    // Fall back to the raw client suburb nav name instead of NRE.
                    Suburb = Context.TucSuburbs.FirstOrDefault(x => x.UcsuId == client.UcclSuburbId)?.UcsuName
                             ?? client.UcclSuburb?.UcsuName,
                    SuburbID = client.UcclSuburbId ?? client.UcclSuburb?.UcsuId ?? 0,
                    PostCode = Convert.ToInt32(client.UcclPostCode),
                    PickUpLatitude = client.Latitude,
                    PickUpLongitude = client.Longitude
                };
            }

            var linehaulRun = Context.TblbulkLinehaulRuns.FirstOrDefault(r => r.Id == linehaul.LinehaulRunId);

            var linehaulJobNumber = $"{job.JobNumber}LH{jobNumberStartCount}";
            var linehaulBookingDateTime = CalculateLinehaulBookingDateTime(job.BookTime, linehaul.DepartureAdvanceDays, linehaul.WeekDay);
            var linehaulBookingTime = linehaulBookingDateTime;
            // StartTime is TimeOnly? on TblbulkLinehaulRun. Only override the
            // booking wall-clock when the run actually has one configured;
            // otherwise fall through to the computed CalculateLinehaulBookingDateTime.
            if (linehaulRun != null && linehaulRun.StartTime.HasValue)
            {
                linehaulBookingTime = linehaulBookingDateTime.Date.Add(linehaulRun.StartTime.Value.ToTimeSpan());
            }

            var summedAmount = totalSingleLH > 0
                ? Math.Round(linehaulSumAmount * (linehaulAmount / totalSingleLH), 2)
                : Math.Round(linehaulSumAmount / linehaulDetails.Count, 2);

            jobs.Insert(jobs.IndexOf(job) + 1, new TblBulkJob()
            {
                JobNumber = linehaulJobNumber,
                BookDate = linehaulBookingDateTime.Date,
                BookTime = linehaulBookingTime,
                Speed = 126,
                ClientId = job.ClientId,
                ClientCode = job.ClientCode,
                Contact = job.Contact,
                FromCompany = linehaulFrom.Company,
                FromAddress = linehaulFrom.Address,
                FromSuburb = linehaulFrom.Suburb,
                FromPostCode = linehaulFrom.PostCode,
                // Nullable decimal -> string: emit null (not "") when the depot
                // has no coords configured, so downstream distance / rating
                // helpers can string.IsNullOrWhiteSpace() them cleanly instead
                // of racing an empty-string parse.
                PickUpLatitude = linehaulFrom.PickUpLatitude?.ToString(CultureInfo.InvariantCulture),
                PickUpLongitude = linehaulFrom.PickUpLongitude?.ToString(CultureInfo.InvariantCulture),
                FromGeoType = job.FromGeoType,
                DeliverToContact = job.DeliverToContact,
                DeliverToPhone = job.DeliverToPhone,
                ToCompany = linehaulTo.Company,
                ToAddress = linehaulTo.Address,
                ToSuburb = linehaulTo.Suburb,
                ToPostCode = linehaulTo.PostCode,
                DeliveryLatitude = linehaulTo.PickUpLatitude?.ToString(CultureInfo.InvariantCulture),
                DeliveryLongitude = linehaulTo.PickUpLongitude?.ToString(CultureInfo.InvariantCulture),
                ToGeoType = job.ToGeoType,
                PickupAddressLine1 = linehaulFrom.Company,
                PickupAddressLine2 = linehaulFrom.Address,
                PickupAddressLine3 = null,
                PickupAddressLine4 = null,
                PickupAddressLine5 = linehaulFrom.Suburb,
                PickupAddressLine6 = null,
                PickupAddressLine7 = linehaulFrom.PostCode.ToString(),
                PickupAddressLine8 = null,
                DeliveryAddressLine1 = linehaulTo.Company,
                DeliveryAddressLine2 = linehaulTo.Address,
                DeliveryAddressLine3 = null,
                DeliveryAddressLine4 = null,
                DeliveryAddressLine5 = linehaulTo.Suburb,
                DeliveryAddressLine6 = null,
                DeliveryAddressLine7 = linehaulTo.PostCode.ToString(),
                DeliveryAddressLine8 = null,
                Size = job.Size,
                Length = job.Length,
                Width = job.Width,
                Height = job.Height,
                Weight = job.Weight,
                ClientRefa = job.ClientRefa,
                ClientRefb = job.ClientRefb,
                OurRef = job.OurRef,
                Notes = job.Notes,
                TrackingEmail = null,
                TrackingMobile = null,
                ProofOfDeliveryEmail = null,
                ProofOfDeliveryMobile = null,
                JobStatus = job.JobStatus,
                Done = job.Done,
                RemoteJob = job.RemoteJob,
                Qty = job.Qty,
                Amount = summedAmount,
                CourierId = linehaulRun?.CourierId ?? null,
                RegionId = linehaul.ToDepotId,
                LinehaulRunId = linehaulRun?.Id ?? null,
                Barcode = linehaulJobNumber,
                JobRelationshipTypeId = 20,
                DropOffLocationId = linehaul.DropOffLocationId,
                StorageState = schedule.StorageState,
                DeliveryState = schedule.DeliveryState,
                SourceId = 3,
                LoggedInContactId = job.LoggedInContactId,
                ScheduleId = schedule.BulkRunScheduleId,
                ScheduleName = schedule.Name
            });

            var insertedJob = jobs[jobs.IndexOf(job) + 1];
            if (splitJobs != null)
            {
                splitJobs.Add(insertedJob);
            }

            jobNumberStartCount++;
        }
    }

    private decimal GetLinehaulAmount(TblBulkScheduleLinehaul linehaul, decimal? baseAmount, int clientId, DateTime? bookDate, int jobTypeId, int? vehicleSize = null)
    {
        // UTL_fncMFV_FAF_Rates returns a single scalar wrapped in a Rates row.
        // If the function returns no row (missing rate config for this client
        // + speed + date), treat MFV as 0 rather than NRE.
        var mfv = Context.Rates
            .FromSqlInterpolated($"SELECT dbo.UTL_fncMFV_FAF_Rates({clientId}, CAST({bookDate ?? DateTime.Now} AS DATE), {jobTypeId}, {vehicleSize}) as rate")
            .FirstOrDefault()?.rate ?? 0m;

        // Client may have been soft-deleted between validation and pricing.
        // SingleOrDefault returns null cleanly instead of throwing; the
        // callsite treats a missing client as zero PPD / zero discount so
        // the batch still lands with the base linehaul math.
        var client = Context.TucClients.SingleOrDefault(c => c.UcclId == clientId);
        decimal ppdRate = client?.Ppdrate ?? 0m;
        decimal clientDiscount = client?.Discount ?? 0m;
        decimal linehaulStaticAmount = ((linehaul?.Amount) ?? 0) > 0 ? linehaul.Amount.Value : 0;
        decimal linehaulAmountPercentage = ((linehaul?.AmountPercentage) ?? 0) > 0 ? linehaul.AmountPercentage.Value : 0;

        var linehaulAmount = Math.Round(
            Math.Round(
                (decimal)((Math.Round(
                    (linehaulStaticAmount > 0 ? linehaulStaticAmount :
                        linehaulAmountPercentage > 0 ? baseAmount.Value * linehaulAmountPercentage :
                    0),
                    2) * (1 + mfv) /
                (ppdRate >= 0 ? (1 - ppdRate) : 1)) /
            (1 + (linehaul.ApplyDiscount.HasValue && linehaul.ApplyDiscount.Value ? clientDiscount : 0))),
            4),
        2);

        return linehaulAmount;
    }

    private void InsertPickupJobs(List<TblBulkJob> jobs, TblBulkJob job, ZoneLinehaulRate zoneRates, List<TblBulkJob> splitJobs, TblBulkRunSchedule schedule, TucClient client)
    {
        var pickupFrom = new PikupAddressDto()
        {
            Company = client.UcclLegalName,
            Address = client.UcclAddress,
            // Same defensive fallback as InsertLinehaulJobs (see above).
            Suburb = Context.TucSuburbs.FirstOrDefault(x => x.UcsuId == client.UcclSuburbId)?.UcsuName
                     ?? client.UcclSuburb?.UcsuName,
            SuburbID = client.UcclSuburbId ?? client.UcclSuburb?.UcsuId ?? 0,
            PostCode = Convert.ToInt32(client.UcclPostCode),
            PickUpLatitude = client.Latitude,
            PickUpLongitude = client.Longitude
        };

        var pickupTo = Context.TblBulkRegions.Where(r => r.BulkRegionId == schedule.PickupDepotId && r.Active == true)
                                .Select(r => new PikupAddressDto()
                                {
                                    Company = r.FromCompany,
                                    Address = r.FromCompany + " " + r.Name + " Depot: " + r.FromAddress,
                                    Suburb = r.FromSuburb,
                                    SuburbID = 0,
                                    PostCode = r.FromPostCode,
                                    PickUpLatitude = r.PickupLatitude,
                                    PickUpLongitude = r.PickupLongitude
                                }).FirstOrDefault();

        if (pickupFrom != null && !string.IsNullOrEmpty(pickupFrom.Suburb))
        {
            pickupFrom.SuburbID = GetSuburbID_FromNameWithPostCode(Context, pickupFrom.Suburb, pickupFrom.PostCode);
        }
        if (pickupTo != null && !string.IsNullOrEmpty(pickupTo.Suburb))
        {
            pickupTo.SuburbID = GetSuburbID_FromNameWithPostCode(Context, pickupTo.Suburb, pickupTo.PostCode);
        }

        if (pickupTo == null)
            return;

        var pickupJobNumber = $"{job.JobNumber}LHP";

        decimal summedAmount = 0M;
        for (int i = 1; i <= job.Qty; i++)
        {
            var itemAmount = i > 1 ? zoneRates.PickupAddtionItemAmount : zoneRates.PickupBaseAmount;
            summedAmount += itemAmount ?? 0;
        }

        jobs.Insert(jobs.IndexOf(job) + 1, new TblBulkJob()
        {
            JobNumber = pickupJobNumber,
            BookDate = job.BookDate,
            BookTime = CalculatePickupBookingDateTime(job.BookTime, schedule),
            Speed = 142,
            ClientId = job.ClientId,
            ClientCode = job.ClientCode,
            Contact = job.Contact,
            FromCompany = pickupFrom.Company,
            FromAddress = pickupFrom.Address,
            FromSuburb = pickupFrom.Suburb,
            FromPostCode = pickupFrom.PostCode,
            // Same nullable-decimal guard as InsertLinehaulJobs above -
            // depot with unconfigured coords emits null, not "".
            PickUpLatitude = pickupFrom.PickUpLatitude?.ToString(CultureInfo.InvariantCulture),
            PickUpLongitude = pickupFrom.PickUpLongitude?.ToString(CultureInfo.InvariantCulture),
            FromGeoType = job.FromGeoType,
            DeliverToContact = job.DeliverToContact,
            DeliverToPhone = job.DeliverToPhone,
            ToCompany = pickupTo.Company,
            ToAddress = pickupTo.Address,
            ToSuburb = pickupTo.Suburb,
            ToPostCode = pickupTo.PostCode,
            DeliveryLatitude = pickupTo.PickUpLatitude?.ToString(CultureInfo.InvariantCulture),
            DeliveryLongitude = pickupTo.PickUpLongitude?.ToString(CultureInfo.InvariantCulture),
            ToGeoType = job.ToGeoType,
            PickupAddressLine1 = pickupFrom.Company,
            PickupAddressLine2 = pickupFrom.Address,
            PickupAddressLine3 = null,
            PickupAddressLine4 = null,
            PickupAddressLine5 = pickupFrom.Suburb,
            PickupAddressLine6 = null,
            PickupAddressLine7 = pickupFrom.PostCode.ToString(),
            PickupAddressLine8 = null,
            DeliveryAddressLine1 = pickupTo.Company,
            DeliveryAddressLine2 = pickupTo.Address,
            DeliveryAddressLine3 = null,
            DeliveryAddressLine4 = null,
            DeliveryAddressLine5 = pickupTo.Suburb,
            DeliveryAddressLine6 = null,
            DeliveryAddressLine7 = pickupTo.PostCode.ToString(),
            DeliveryAddressLine8 = null,
            Size = job.Size,
            Length = job.Length,
            Width = job.Width,
            Height = job.Height,
            Weight = job.Weight,
            ClientRefa = job.ClientRefa,
            ClientRefb = job.ClientRefb,
            OurRef = job.OurRef,
            Notes = job.Notes,
            TrackingEmail = null,
            TrackingMobile = null,
            TrackingMethod = null,
            ProofOfDeliveryEmail = null,
            ProofOfDeliveryMobile = null,
            JobStatus = job.JobStatus,
            Done = job.Done,
            RemoteJob = job.RemoteJob,
            Qty = job.Qty,
            Amount = summedAmount,
            Multibox = false,
            SourceId = 3,
            LoggedInContactId = job.LoggedInContactId,
            Barcode = pickupJobNumber,
            JobRelationshipTypeId = 20,
            DropOffLocationId = schedule.DropOffLocationId,
            StorageState = schedule.StorageState,
            DeliveryState = schedule.DeliveryState,
            ScheduleId = schedule.BulkRunScheduleId,
            ScheduleName = schedule.Name
        });

        var insertedJob = jobs[jobs.IndexOf(job) + 1];
        if (splitJobs != null)
        {
            splitJobs.Add(insertedJob);
        }
    }

    private void InsertDeliveryJobs(List<TblBulkJob> jobs, TblBulkJob job, ZoneLinehaulRate zoneRates, List<TblBulkJob> splitJobs, TblBulkRunSchedule schedule, TucClient client)
    {
        var deliveryJobNumber = $"{job.JobNumber}DEL";

        decimal summedAmount = 0M;
        for (int i = 1; i <= job.Qty; i++)
        {
            var itemAmount = i > 1 ? zoneRates.ZoneAddtionItemAmount : zoneRates.ZoneAmount;
            summedAmount += itemAmount ?? 0;
        }

        jobs.Insert(jobs.IndexOf(job) + 1, new TblBulkJob()
        {
            JobNumber = deliveryJobNumber,
            BookDate = job.BookDate,
            BookTime = job.BookTime,
            Speed = job.Speed,
            ClientId = job.ClientId,
            ClientCode = job.ClientCode,
            Contact = job.Contact,
            FromCompany = job.FromCompany,
            FromAddress = job.FromAddress,
            FromSuburb = job.FromSuburb,
            FromPostCode = job.FromPostCode,
            // job.PickUpLatitude/Longitude are already string on TblBulkJob.
            // Calling .ToString() on a null string throws NRE - just assign
            // the raw value so unresolved coords propagate as null and don't
            // blow up the whole batch.
            PickUpLatitude = job.PickUpLatitude,
            PickUpLongitude = job.PickUpLongitude,
            FromGeoType = job.FromGeoType,
            DeliverToContact = job.DeliverToContact,
            DeliverToPhone = job.DeliverToPhone,
            ToCompany = job.ToCompany,
            ToAddress = job.ToAddress,
            ToSuburb = job.ToSuburb,
            ToPostCode = job.ToPostCode,
            // Same guard as PickUp above: raw string, no .ToString().
            DeliveryLatitude = job.DeliveryLatitude,
            DeliveryLongitude = job.DeliveryLongitude,
            ToGeoType = job.ToGeoType,
            PickupAddressLine1 = job.PickupAddressLine1,
            PickupAddressLine2 = job.PickupAddressLine2,
            PickupAddressLine3 = job.PickupAddressLine3,
            PickupAddressLine4 = job.PickupAddressLine4,
            PickupAddressLine5 = job.PickupAddressLine5,
            PickupAddressLine6 = job.PickupAddressLine6,
            PickupAddressLine7 = job.PickupAddressLine7,
            PickupAddressLine8 = job.PickupAddressLine8,
            DeliveryAddressLine1 = job.DeliveryAddressLine1,
            DeliveryAddressLine2 = job.DeliveryAddressLine2,
            DeliveryAddressLine3 = job.DeliveryAddressLine3,
            DeliveryAddressLine4 = job.DeliveryAddressLine4,
            DeliveryAddressLine5 = job.DeliveryAddressLine5,
            DeliveryAddressLine6 = job.DeliveryAddressLine6,
            DeliveryAddressLine7 = job.DeliveryAddressLine7,
            DeliveryAddressLine8 = job.DeliveryAddressLine8,
            Size = job.Size,
            Length = job.Length,
            Width = job.Width,
            Height = job.Height,
            Weight = job.Weight,
            ClientRefa = job.ClientRefa,
            ClientRefb = job.ClientRefb,
            OurRef = job.OurRef,
            Notes = job.Notes,
            TrackingEmail = string.IsNullOrWhiteSpace(job.TrackingEmail) ? null : job.TrackingEmail.Trim(),
            TrackingMobile = string.IsNullOrWhiteSpace(job.TrackingMobile) ? null : job.TrackingMobile.Trim(),
            TrackingMethod = job.TrackingMethod,
            ProofOfDeliveryEmail = string.IsNullOrWhiteSpace(job.TrackingEmail) ? null : job.TrackingEmail.Trim(),
            ProofOfDeliveryMobile = string.IsNullOrWhiteSpace(job.TrackingMobile) ? null : job.TrackingMobile.Trim(),
            JobStatus = job.JobStatus,
            Done = job.Done,
            RemoteJob = job.RemoteJob,
            Qty = job.Qty,
            Amount = summedAmount,
            Multibox = job.Qty > 1,
            SourceId = 3,
            LoggedInContactId = job.LoggedInContactId,
            Barcode = deliveryJobNumber,
            JobRelationshipTypeId = 20,
            DropOffLocationId = schedule.DropOffLocationId,
            StorageState = schedule.StorageState,
            DeliveryState = schedule.DeliveryState,
            ScheduleId = schedule.BulkRunScheduleId,
            ScheduleName = schedule.Name
        });

        var insertedJob = jobs[jobs.IndexOf(job) + 1];
        if (splitJobs != null)
        {
            splitJobs.Add(insertedJob);
        }
    }

    // ---- lookups ----------------------------------------------------------

    public static int GetSuburbID_FromNameWithPostCode(DynamicDespatchDbContext context, string suburbName, int? postcode)
    {
        // UTL_fncSuburb_FromNameWithPostCode returns 0 when nothing matches,
        // but the wrapping SqlInterpolated + FromSqlInterpolated projection
        // is technically nullable at the row level. Guard both paths.
        var row = context.SuburbID
            .FromSqlInterpolated($"select dbo.UTL_fncSuburb_FromNameWithPostCode({suburbName}, NULL, {postcode}) as SuburbID")
            .FirstOrDefault();
        return row?.SuburbID ?? 0;
    }

    public DateTime CalculateLinehaulBookingDateTime(DateTime scheduleDateTime, int? linehaulDepartureAdvanceDays, string linehaulWeekday)
    {
        DateTime linehaulBookingDateTime = scheduleDateTime.AddDays(-linehaulDepartureAdvanceDays ?? 0);

        if (!string.IsNullOrEmpty(linehaulWeekday))
        {
            string adjustedLinehaulWeekday = linehaulWeekday.Length == 7 ? linehaulWeekday : "000000";

            DayOfWeek currentDayOfWeek = linehaulBookingDateTime.DayOfWeek;

            int currentIndex = ((int)currentDayOfWeek + 6) % 7;
            char currentWeekdayChar = adjustedLinehaulWeekday[currentIndex];

            if (currentWeekdayChar != '1')
            {
                for (int i = 1; i <= 7; i++)
                {
                    int forwardIndex = ((int)currentDayOfWeek + 6 + i) % 7;
                    int backwardIndex = ((int)currentDayOfWeek + 6 - i + 7) % 7;

                    char forwardWeekdayChar = adjustedLinehaulWeekday[forwardIndex];
                    char backwardWeekdayChar = adjustedLinehaulWeekday[backwardIndex];

                    if (forwardWeekdayChar == '1')
                    {
                        linehaulBookingDateTime = linehaulBookingDateTime.AddDays(i);
                        break;
                    }
                    else if (backwardWeekdayChar == '1')
                    {
                        linehaulBookingDateTime = linehaulBookingDateTime.AddDays(-i);
                        break;
                    }
                }
            }
        }

        linehaulBookingDateTime = linehaulBookingDateTime > DateTime.Now ? linehaulBookingDateTime : DateTime.Now;

        linehaulBookingDateTime = linehaulBookingDateTime < scheduleDateTime ? linehaulBookingDateTime : scheduleDateTime;

        return linehaulBookingDateTime;
    }

    public int? GetStockSizeID(decimal? length, decimal? width, decimal? height, decimal? weight)
    {
        return Context.TblGssstockSizes.FirstOrDefault(x => x.Width == (double)width && x.Length == (double)length && x.Height == (double)height && x.IsDefaultSize == true && x.ClientId == null)?.Id;
    }

    private DateTime CalculatePickupBookingDateTime(DateTime bookTime, TblBulkRunSchedule schedule)
    {
        if (schedule.ApplyPickupCutoff.HasValue && schedule.ApplyPickupCutoff.Value && schedule.PickupCutoff.HasValue && schedule.PickupCutoff.Value > 0)
        {
            bookTime = bookTime.AddMinutes(-(double)schedule.PickupCutoff.Value);
        }

        return bookTime;
    }

    // ---- zone / zip lookups ----------------------------------------------

    private async Task<List<ZipCodeDto>> GetZoneZipsForCountry(List<string> postCodes, int? scheduleId = null)
    {
        if (IsUsTenant())
        {
            return await Context.ZoneZips
                .Where(z => postCodes.Contains(z.Zip) && z.ZoneName.LocationId.HasValue)
                .Select(z => new ZipCodeDto
                {
                    Id = z.ZoneZipId,
                    ZoneNumber = z.ZoneNameId,
                    Zip = z.Zip.ToString(),
                    ClientId = z.ClientId
                })
                .ToListAsync();
        }
        else
        {
            var schedule = await Context.TblBulkRunSchedules
                .FirstOrDefaultAsync(s => s.BulkRunScheduleId == scheduleId);

            return await Context.BulkZonePostcodes
                .Where(x => postCodes.Contains(x.PostCode.ToString()) &&
                           (scheduleId == null || x.PostcodeGroupId == schedule.PostcodeGroupId))
                .Select(x => new ZipCodeDto
                {
                    Id = x.Id,
                    ZoneNumber = x.Zone,
                    Zip = x.PostCode.ToString(),
                    ClientId = null
                })
                .ToListAsync();
        }
    }

    private async Task<ZoneLocationDto> GetLocationForZip(string zipCode, int? clientId = null)
    {
        if (IsUsTenant())
        {
            return await Context.ZoneZips
                .Include(z => z.ZoneName.Location)
                .Where(z => z.Zip.ToString() == zipCode &&
                           (clientId == null || z.ClientId == clientId || z.ClientId == null) &&
                           z.ZoneName.LocationId.HasValue)
                .OrderByDescending(z => z.ClientId)
                .Select(z => new ZoneLocationDto
                {
                    ZoneZipId = z.ZoneZipId,
                    LocationId = z.ZoneName.LocationId,
                    FromCompany = z.ZoneName.Location.FromCompany,
                    FromAddress = z.ZoneName.Location.FromAddress,
                    AddressLine5 = z.ZoneName.Location.AddressLine5,
                    AddressLine6 = z.ZoneName.Location.AddressLine6,
                    AddressLine7 = z.ZoneName.Location.AddressLine7,
                    PickupLatitude = z.ZoneName.Location.PickupLatitude,
                    PickupLongitude = z.ZoneName.Location.PickupLongitude
                })
                .FirstOrDefaultAsync();
        }
        else
        {
            if (!int.TryParse(zipCode, out int postCode))
                return null;

            return await Context.BulkZonePostcodes
                .Include(bzp => bzp.Depot)
                .Where(bzp => bzp.PostCode == postCode &&
                             bzp.DepotId.HasValue &&
                             bzp.Depot != null &&
                             bzp.Depot.Active == true)
                .Select(bzp => new ZoneLocationDto
                {
                    ZoneZipId = bzp.Id,
                    LocationId = bzp.DepotId,
                    FromCompany = bzp.Depot.FromCompany,
                    FromAddress = bzp.Depot.FromAddress,
                    AddressLine5 = bzp.Depot.FromSuburb,
                    AddressLine6 = null,
                    AddressLine7 = bzp.Depot.FromPostCode.ToString(),
                    PickupLatitude = bzp.Depot.PickupLatitude,
                    PickupLongitude = bzp.Depot.PickupLongitude
                })
                .FirstOrDefaultAsync();
        }
    }

    private async Task<int?> GetLocationIdFromZipCode(List<ZipCodeDto> zipCodes, string postCode)
    {
        var zipCode = zipCodes.FirstOrDefault(x =>
            AddressUtility.FormatPostCode(x.Zip) == AddressUtility.FormatPostCode(postCode));

        if (zipCode == null) return null;

        if (IsUsTenant())
        {
            var zoneZip = await Context.ZoneZips
                .Include(z => z.ZoneName)
                .FirstOrDefaultAsync(z => z.ZoneZipId == zipCode.Id);

            return zoneZip?.ZoneName?.LocationId;
        }
        else
        {
            var bulkZone = await Context.BulkZonePostcodes
                .FirstOrDefaultAsync(x => x.Id == zipCode.Id);

            return bulkZone?.DepotId;
        }
    }

    private async Task<string> GetFromLatLngFromZipCode(List<ZipCodeDto> zipCodes, string postCode)
    {
        var zipCode = zipCodes.FirstOrDefault(x =>
            AddressUtility.FormatPostCode(x.Zip) == AddressUtility.FormatPostCode(postCode));

        if (zipCode == null) return null;

        if (IsUsTenant())
        {
            var zoneZip = await Context.ZoneZips
                .Include(z => z.ZoneName.Location)
                .FirstOrDefaultAsync(z => z.ZoneZipId == zipCode.Id);

            return zoneZip?.ZoneName?.Location?.PickupLatitude != null && zoneZip?.ZoneName?.Location?.PickupLongitude != null
                ? $"{zoneZip.ZoneName.Location.PickupLatitude},{zoneZip.ZoneName.Location.PickupLongitude}"
                : null;
        }
        else
        {
            var bulkZone = await Context.BulkZonePostcodes
                .FirstOrDefaultAsync(x => x.Id == zipCode.Id);

            return bulkZone?.FromLatLng;
        }
    }

    private async Task<Dictionary<string, string>> GetStateMapping(List<TblBulkJob> jobs)
    {
        var stateMapping = new Dictionary<string, string>();

        if (IsUsTenant())
        {
            var allZipCodes = jobs.SelectMany(j => new[] { j.FromPostCode?.ToString(), j.ToPostCode?.ToString() })
                                 .Where(z => !string.IsNullOrEmpty(z))
                                 .Distinct()
                                 .ToList();

            var stateData = await Context.ZoneZips
                .Include(z => z.ZoneName.Location)
                .Where(z => allZipCodes.Contains(z.Zip) && z.ZoneName.LocationId.HasValue)
                .Select(z => new { ZipCode = z.Zip.ToString(), State = z.ZoneName.Location.AddressLine6 })
                .ToListAsync();

            foreach (var item in stateData)
            {
                if (!stateMapping.ContainsKey(item.ZipCode))
                {
                    stateMapping[item.ZipCode] = item.State;
                }
            }
        }

        return stateMapping;
    }
}
