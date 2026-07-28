// Part 2 of 3 of the BulkService port. Contains the Import dispatcher, the
// per-tenant ProcessOnDemandJobs / ProcessRoutedJobs flows, Steve's 4-step
// origin precedence, per-tenant SP call sites, geocoding helpers, and the
// StaffImport batch loader. See BulkImportServiceV2.cs for the shared
// constructor + fields.
//
// DEVIATIONS FROM SOURCE
//   - DD_stpJob_InsertExceleratorAsync call sites now pass forceTucJobPush,
//     jobBookingID, pickupReadyDateTime (91-param SP shape). Defaults follow
//     the plan: forceTucJobPush = false, jobBookingID = 0, pickupReadyDateTime
//     = @Time (mirror the pickup time).
//   - `dynamic client` retained verbatim - the ported code depends on the
//     late-bound property shape the anonymous type produces. Kept the
//     same to minimise diff risk.
using Microsoft.EntityFrameworkCore;
using RoutedOperations.Core.Application.Dtos.BulkImport.Address;
using RoutedOperations.Core.Application.Dtos.BulkImport.Bulk;
using RoutedOperations.Core.Application.Dtos.BulkImport.Common;
using RoutedOperations.Core.Application.Utilities;
using RoutedOperations.Core.Domain.Despatch;
using RoutedOperations.Core.Domain.Models;
using Serilog;
using System.Globalization;

namespace RoutedOperations.Core.Application.Services.BulkImport;

public partial class BulkImportServiceV2
{
    // ---- Import (main workflow dispatcher) --------------------------------

    public async Task<BulkImportResponse> Import(int contactId, BulkImportRequest request)
    {
        var response = new BulkImportResponse(request.MessageId);

        if (request.BookDate.Kind == DateTimeKind.Utc)
        {
            request.BookDate = TimeZoneUtility.ConvertToTenantTime(request.BookDate, _httpContextAccessor);
            Log.Information($"({request.MessageId})({contactId}) [Import] Converted BookDate from UTC to tenant timezone: {request.BookDate:yyyy-MM-dd HH:mm:ss}");
        }

        var jobsWithCourierPercentageOverrides = request.Jobs?.Where(j => j.CourierPercentageOverride.HasValue).ToList();
        if (jobsWithCourierPercentageOverrides?.Any() ?? false)
            foreach (var j in jobsWithCourierPercentageOverrides)
            {
                j.CourierPercentageOverride = Math.Round(j.CourierPercentageOverride.Value, 4, MidpointRounding.AwayFromZero);
            }

        var internalClaim = _httpContextAccessor.HttpContext?.User.Claims.FirstOrDefault(x => x.Type == "Internal")?.Value;
        var isInternal = !string.IsNullOrEmpty(internalClaim) && bool.TryParse(internalClaim, out var internalValue) && internalValue;

        var client = await Context.TucClients
            .Where(c => c.UcclId == request.ClientId && c.UcclActive
                && (isInternal || c.TucClientContacts.Any(x => x.UcctId == contactId && x.Active) || c.TblClientContacts.Any(x => x.ContactId == contactId && x.Contact.Active)))
            .Select(c => new
            {
                Id = c.UcclId,
                Code = c.UcclCode,
                JobPrefix = c.JobPrefix,
                UcclAddress = c.UcclAddress,
                UcclSuburbId = c.UcclSuburbId,
                UcclSuburbName = c.UcclSuburb != null ? c.UcclSuburb.UcsuName : null,
                UcclPostCode = c.UcclPostCode,
                Latitude = c.Latitude,
                Longitude = c.Longitude,
                Speed = Context.TucJobTypes
                    .Where(s => s.UcjtId == request.SpeedId)
                    .Select(s => new
                    {
                        s.UcjtId,
                        s.SystemName,
                        s.ZoneRated
                    })
                    .FirstOrDefault(),
                Schedule = request.ScheduleId.HasValue
                    ? Context.TblBulkRunSchedules
                        .Select(s => new
                        {
                            s.BulkRunScheduleId,
                            s.StartTime,
                            s.CutoffHours,
                            s.ClientId,
                            s.SpeedId,
                            s.RegionNavigation.FromCompany,
                            s.RegionNavigation.FromAddress,
                            s.RegionNavigation.FromSuburb,
                            s.RegionNavigation.FromPostCode,
                            s.RegionNavigation.PickupLatitude,
                            s.RegionNavigation.PickupLongitude
                        })
                        .FirstOrDefault(s => s.BulkRunScheduleId == request.ScheduleId && (!s.ClientId.HasValue || s.ClientId == c.UcclId))
                    : null,
                CreatBulkHomeDeliveryPickupJob = c.CreateBulkHomeDeliveryPickup ?? false,
                ContentsUnknownForBulkJobs = c.ContentsUnknownForBulkJobs
            })
            .FirstOrDefaultAsync();

        if (string.Equals(request.JobType, "ondemand", StringComparison.OrdinalIgnoreCase))
        {
            return await ProcessOnDemandJobs(contactId, request, response, client);
        }
        else
        {
            return await ProcessRoutedJobs(contactId, request, response, client);
        }
    }

    // ---- ProcessOnDemandJobs (all-tenant, per-job SP loop) ----------------

    private async Task<BulkImportResponse> ProcessOnDemandJobs(int contactId, BulkImportRequest request, BulkImportResponse response, dynamic client)
    {
        if (client == null)
            return BulkImportResponseUtility.AddMessageAndReturnResponse(response, "Invalid client.");

        var tenantNow = TimeZoneUtility.GetTenantNow(_httpContextAccessor);
        Log.Information($"({request.MessageId})({contactId}) [Schedule] Validating BookDate for on-demand job. TenantNow: {tenantNow:yyyy-MM-dd HH:mm:ss}, BookDate: {request.BookDate:yyyy-MM-dd HH:mm:ss}");

        if (request.BookDate < tenantNow)
        {
            Log.Warning($"({request.MessageId})({contactId}) [Schedule] BookDate is in the past. TenantNow: {tenantNow:yyyy-MM-dd HH:mm:ss}, BookDate: {request.BookDate:yyyy-MM-dd HH:mm:ss}");
            return BulkImportResponseUtility.AddMessageAndReturnResponse(response, "Book date must be in the future.");
        }

        // MVP: wizard omits SpeedId (sends 0) and defers to the client's default.
        // Server coerces to client.Speed.UcjtId when request.SpeedId == 0.
        if (request.SpeedId == 0 && client.Speed?.UcjtId is int defaultSpeedId)
            request.SpeedId = defaultSpeedId;

        if (client.Speed?.UcjtId != request.SpeedId)
            return BulkImportResponseUtility.AddMessageAndReturnResponse(response, "Invalid speed.");

        string podName = null;
        int? opId = null;
        var contactInfo = await Context.TucClientContacts
            .Where(c => c.UcctId == contactId)
            .Select(c => new { c.UcctFirstname, c.UcctSurname, c.UcctEmail, c.StaffId })
            .FirstOrDefaultAsync();

        if (contactInfo != null)
        {
            opId = contactInfo.StaffId;
            if (request.ImportAsCompleted)
            {
                podName = $"{contactInfo.UcctFirstname} {contactInfo.UcctSurname} ({contactInfo.UcctEmail})";
            }
        }
        else if (request.ImportAsCompleted)
        {
            podName = $"ContactID: {contactId}";
        }

        var autoJobs = request.Jobs.Where(j => j.JobNumber?.Trim().ToUpper() == "AUTOGENERATE").ToList();
        if (autoJobs.Any())
        {
            int currentJobNumber = await Context.AssignJobNumbersAsync(client.Id, autoJobs.Count());
            string prefix = string.IsNullOrWhiteSpace(client.JobPrefix) ? client.Id.ToString() : client.JobPrefix.Trim();

            foreach (var j in autoJobs)
            {
                j.JobNumber = $"{prefix}{currentJobNumber.ToString().PadLeft(4, '0')}";
                currentJobNumber += 1;
            }
        }

        int clientId = client.Id;
        var firstJob = request.Jobs.FirstOrDefault();
        // An empty request.Jobs list slipped past validation would NRE on the
        // first-job dereference below. Fail cleanly with a message instead so
        // the operator sees "Nothing to import" rather than a 500.
        if (firstJob == null)
        {
            return BulkImportResponseUtility.AddMessageAndReturnResponse(response, "No jobs to import.");
        }

        string postalCode = IsNzTenant() ? firstJob.ToPostCode : firstJob.ToZipCode;
        var fromLocation = await GetLocationForZip(postalCode, clientId);

        List<int> createdJobIds = new List<int>();
        List<BulkImportJobCreateDto> failedJobs = new List<BulkImportJobCreateDto>();
        int successfulJobCount = 0;

        foreach (var job in request.Jobs)
        {
            try
            {
                if (string.IsNullOrWhiteSpace(job.FromLatitude) || string.IsNullOrWhiteSpace(job.FromLongitude))
                {
                    await GeocodeJobFromAddress(job, request.MessageId, contactId);
                }

                ZoneLocationDto toZoneZip = null;
                if (IsUsTenant())
                {
                    toZoneZip = await Context.ZoneZips
                        .Where(z => z.Zip.ToString() == job.ToZipCode &&
                                   (z.ClientId == clientId || z.ClientId == null) &&
                                   z.ZoneName.LocationId.HasValue)
                        .OrderByDescending(z => z.ClientId)
                        .Select(z => new ZoneLocationDto
                        {
                            ZoneZipId = z.ZoneZipId,
                            LocationId = z.ZoneName.LocationId
                        })
                        .FirstOrDefaultAsync();
                }
                else
                {
                    if (int.TryParse(job.ToPostCode, out int toPostCode))
                    {
                        toZoneZip = await Context.BulkZonePostcodes
                            .Include(bzp => bzp.Depot)
                            .Where(bzp => bzp.PostCode == toPostCode &&
                                         bzp.DepotId.HasValue &&
                                         bzp.Depot != null &&
                                         bzp.Depot.Active == true)
                            .Select(bzp => new ZoneLocationDto
                            {
                                ZoneZipId = bzp.Id,
                                LocationId = bzp.DepotId
                            })
                            .FirstOrDefaultAsync();
                    }
                }

                bool hasZoneRate = false;
                int vehicleSizeId = job.Length > 120 || job.Width > 90 || job.Height > 90 || job.Weight > 400 ? 3 : 2;
                if (IsUsTenant() && fromLocation != null && toZoneZip != null)
                {
                    hasZoneRate = await Context.ZoneCombos
                        .Where(z =>
                            z.FromZoneNameId == fromLocation.ZoneZipId &&
                            z.ToZoneNameId == toZoneZip.ZoneZipId &&
                            z.VehicleSizeId == vehicleSizeId &&
                            z.Active.HasValue && z.Active == true)
                        .AnyAsync();
                }

                double? totalDistance = null;
                if (!hasZoneRate)
                {
                    totalDistance = await CalculateTotalDistance(job.FromLatitude, job.FromLongitude, job.ToLatitude, job.ToLongitude);
                }

                var jobIdParam = new OutputParameter<int?>();
                var messageParam = new OutputParameter<string>();

                DateTime bookTimeForRating = request.ScheduleId.HasValue && client.Schedule != null
                    ? DateTime.SpecifyKind(request.BookDate.Date.AddTicks(client.Schedule.StartTime.Ticks), request.BookDate.Kind)
                    : request.BookDate;

                DateTime bookTimeOnly = new DateTime(1900, 1, 1,
                    bookTimeForRating.Hour,
                    bookTimeForRating.Minute,
                    bookTimeForRating.Second,
                    bookTimeForRating.Kind);

                decimal cubic = job.Length * job.Width * job.Height / 1000000;

                string fromAddress = string.IsNullOrEmpty(job.FromCompany)
                    ? job.FromAddress
                    : $"{job.FromCompany}, {job.FromAddress}";

                string toAddress = string.IsNullOrEmpty(job.ToCompany)
                    ? job.ToAddress
                    : $"{job.ToCompany}, {job.ToAddress}";

                int? courierId = null;
                if (!string.IsNullOrWhiteSpace(job.CourierCode))
                {
                    courierId = await Context.TucCouriers
                        .Where(c => c.Code == job.CourierCode && c.Active)
                        .Select(c => c.UccrId)
                        .FirstOrDefaultAsync();
                }

                string pickupTimeZone = GetTimeZoneCode(job.FromLatitude, job.FromLongitude);
                string deliverByTimeZone = GetTimeZoneCode(job.ToLatitude, job.ToLongitude);

                if (IsNzTenant())
                {
                    bool isWellingtonDepot = fromLocation != null &&
                        !string.IsNullOrEmpty(fromLocation.AddressLine5) &&
                        fromLocation.AddressLine5.ToLower().Contains("wellington");

                    await Context.Procedures.INT_stpJob_BulkInsertAsync(
                        jobNumber: job.JobNumber,
                        bookDate: request.BookDate.Date,
                        bookTime: bookTimeOnly,
                        clientID: request.ClientId,
                        clientCode: client.Code,
                        contact: job.FromContact ?? string.Empty,
                        amount: job.Amount ?? 0,
                        speed: request.SpeedId,
                        fromAddress: job.FromAddress ?? string.Empty,
                        fromSuburb: job.FromSuburb ?? string.Empty,
                        toAddress: toAddress,
                        toSuburb: job.ToSuburb ?? string.Empty,
                        toContact: job.ToContact ?? string.Empty,
                        toContactPhone: job.ToContactPhone ?? string.Empty,
                        size: (short?)vehicleSizeId,
                        qty: (short?)(job.Quantity ?? 1),
                        weight: (double?)job.Weight,
                        courierID: courierId,
                        clientRefa: job.ClientRefA ?? string.Empty,
                        clientRefb: job.ClientRefB ?? string.Empty,
                        ourRef: job.OurRef ?? string.Empty,
                        deliverToPrivateBusiness: false,
                        deliverToLeaveID: null,
                        notes: job.Notes ?? string.Empty,
                        remoteJob: false,
                        trackingEmail: request.ImportAsCompleted ? null : (job.TrackingEmail ?? string.Empty),
                        trackingMobile: request.ImportAsCompleted ? null : (job.TrackingMobile ?? string.Empty),
                        proofOfDeliveryMobile: request.ImportAsCompleted ? null : (job.ToContactPhone ?? string.Empty),
                        proofOfDeliveryEmail: request.ImportAsCompleted ? null : (job.TrackingEmail ?? string.Empty),
                        // Lat/Lng SP params are nvarchar but INSERT into tucJob's
                        // decimal columns; SQL implicitly casts and blows up on
                        // empty string with SQL 8114 "Error converting data type
                        // nvarchar to numeric". Coerce whitespace/empty to null
                        // so the DespatchContextProcedures wrapper sends DBNull
                        // and the destination decimal column stays NULL.
                        pickUpLatitude: string.IsNullOrWhiteSpace(job.FromLatitude) ? null : job.FromLatitude,
                        pickUpLongitude: string.IsNullOrWhiteSpace(job.FromLongitude) ? null : job.FromLongitude,
                        deliveryLatitude: string.IsNullOrWhiteSpace(job.ToLatitude) ? null : job.ToLatitude,
                        deliveryLongitude: string.IsNullOrWhiteSpace(job.ToLongitude) ? null : job.ToLongitude,
                        prebookJob: false,
                        onHold: job.OnHold ?? false,
                        wellingtonJob: isWellingtonDepot,
                        nWDocJob: job.NationwideDoc ?? false,
                        runName: null,
                        fromGeoType: job.FromGeoType,
                        toGeoType: job.ToGeoType,
                        pODName: podName,
                        status: request.ImportAsCompleted ? 6 : 0,
                        complTime: request.ImportAsCompleted ? (DateTime?)DateTime.Now : null,
                        jobDone: request.ImportAsCompleted,
                        sourceID: 3,
                        fromCompany: job.FromCompany ?? string.Empty,
                        fromExtra: string.Empty,
                        fromStreet: job.FromAddress ?? string.Empty,
                        fromPostCode: ParseNullableIntSafe(job.FromPostCode),
                        toCompany: job.ToCompany ?? string.Empty,
                        toExtra: string.Empty,
                        toStreet: job.ToAddress ?? string.Empty,
                        toPostCode: ParseNullableIntSafe(job.ToPostCode),
                        pickupTimeZone: pickupTimeZone,
                        deliverByTimeZone: deliverByTimeZone,
                        opID: opId
                    );

                    successfulJobCount++;
                    Log.Information($"Successfully created NZ on-demand job: {job.JobNumber}");

                    var tucJobId = await Context.TucJobs
                        .Where(j => j.UcjbNumber == job.JobNumber)
                        .OrderByDescending(j => j.UcjbId)
                        .Select(j => j.UcjbId)
                        .FirstOrDefaultAsync();

                    if (!string.IsNullOrWhiteSpace(job.Notes) && tucJobId > 0)
                    {
                        await InsertJobDeliveryNote(tucJobId, job.Notes);
                    }

                    if (tucJobId > 0)
                    {
                        var itemCount = job.Quantity ?? 1;
                        for (int qi = 0; qi < itemCount; qi++)
                        {
                            await Context.Procedures.NET_stpBulkJobItems_InsertAsync(
                                tucJobId, qi, 1, (double?)job.Weight, (double?)job.Length,
                                (double?)job.Height, (double?)job.Width, null, null, null, null, null,
                                job.Notes, null, $"{job.JobNumber}-{qi + 1}");
                        }
                        Log.Information($"Inserted {itemCount} job items for NZ on-demand job {job.JobNumber} (ID: {tucJobId})");
                    }
                }
                else
                {
                    // US: DD_stpJob_InsertExcelerator (91 params - 3 new tail params
                    // passed here per the SP drift note at the top of the file).
                    await Context.Procedures.DD_stpJob_InsertExceleratorAsync(
                        bookedBy: job.FromContact ?? string.Empty,
                        fromAddress: fromAddress,
                        fromStreet: job.FromAddress ?? string.Empty,
                        fromBuilding: job.FromUnit ?? string.Empty,
                        fromCompany: job.FromCompany ?? string.Empty,
                        fromCity: job.FromCity ?? string.Empty,
                        fromState: job.FromState ?? string.Empty,
                        fromZipCode: ParseNullableIntSafe(job.FromZipCode),
                        speed: client.Speed.SystemName ?? string.Empty,
                        speedID: request.SpeedId,
                        toAddress: toAddress,
                        toStreet: job.ToAddress ?? string.Empty,
                        toBuilding: job.ToUnit ?? string.Empty,
                        toCompany: job.ToCompany ?? string.Empty,
                        toCity: job.ToCity ?? string.Empty,
                        toState: job.ToState ?? string.Empty,
                        toZipCode: ParseNullableIntSafe(job.ToZipCode),
                        toAddressType: null,
                        referenceA: job.ClientRefA ?? string.Empty,
                        referenceB: job.ClientRefB ?? string.Empty,
                        vehicleSizeID: vehicleSizeId,
                        // Numeric SP params typed as nvarchar. The SP internally CASTs to
                        // decimal/money, and CAST from string uses '.' as the decimal
                        // separator regardless of the server locale. Force InvariantCulture
                        // so a machine running under en-* other than en-US does not emit
                        // '5,5' and blow up with SQL 8114 "Error converting data type
                        // nvarchar to numeric".
                        totalWeight: job.Weight.ToString(CultureInfo.InvariantCulture),
                        totalDistance: totalDistance?.ToString(CultureInfo.InvariantCulture) ?? "0",
                        @return: "0",
                        courierNotes: string.Empty,
                        clientNotes: job.Notes ?? string.Empty,
                        pickupNotes: string.Empty,
                        deliveryNotes: string.Empty,
                        fromContactName: job.FromContact ?? string.Empty,
                        fromPhoneNumber: string.Empty,
                        toContactName: job.ToContact ?? string.Empty,
                        toPhoneNumber: job.ToContactPhone ?? string.Empty,
                        type: "1",
                        pickUpFrom: "1",
                        quantity: (job.Quantity ?? 1).ToString(CultureInfo.InvariantCulture),
                        leaveNotHome: "Signature Required",
                        jobNotificationType: null,
                        jobNotificationEmail: job.TrackingEmail ?? string.Empty,
                        jobNotificationMobile: job.TrackingMobile ?? string.Empty,
                        toAddressCode: string.Empty,
                        fromAddressCode: string.Empty,
                        clientID: request.ClientId,
                        time: bookTimeForRating,
                        hold: false,
                        fixedAmount: job?.Amount,
                        agentAmount: null,
                        agentCourierID: courierId,
                        fuelSurchargeAmount: null,
                        ourRef: job.OurRef ?? string.Empty,
                        pickUpLatitude: string.IsNullOrWhiteSpace(job.FromLatitude) ? null : job.FromLatitude,
                        pickUpLongitude: string.IsNullOrWhiteSpace(job.FromLongitude) ? null : job.FromLongitude,
                        deliveryLatitude: string.IsNullOrWhiteSpace(job.ToLatitude) ? null : job.ToLatitude,
                        deliveryLongitude: string.IsNullOrWhiteSpace(job.ToLongitude) ? null : job.ToLongitude,
                        pickup: null,
                        dropoff: null,
                        privateRes: null,
                        truckStartTime: null,
                        truckHours: null,
                        jobNumber: job.JobNumber,
                        storageState: null,
                        deliveryState: null,
                        sourceId: 3,
                        totalPallets: 0,
                        extraStopOffs: 0,
                        dryIceWeight: 0,
                        cubic: cubic,
                        waitTime: 0,
                        dGClass: null,
                        dGDocs: false,
                        loggedInContactId: contactId,
                        accessorialChargeGroupId: null,
                        deliverByDateTime: null,
                        pickupTimeZone: pickupTimeZone,
                        deliverByTimeZone: deliverByTimeZone,
                        recurringName: string.Empty,
                        recurringDays: string.Empty,
                        recurringFrequency: string.Empty,
                        recurringHoliday: null,
                        recurringInitialDays: null,
                        tenantCurrentTime: bookTimeForRating,
                        dimensionsType: 0,
                        cubicList: string.Empty,
                        weightList: string.Empty,
                        barcodeList: string.Empty,
                        forceTucJobPush: false,
                        jobBookingID: 0,
                        pickupReadyDateTime: bookTimeForRating,
                        jobID: jobIdParam,
                        message: messageParam
                    );

                    if (jobIdParam.Value.HasValue && jobIdParam.Value.Value > 0)
                    {
                        createdJobIds.Add(jobIdParam.Value.Value);
                        successfulJobCount++;

                        job.JobNumber = job.JobNumber;

                        if (request.ImportAsCompleted)
                        {
                            var tucJob = await Context.TucJobs.FindAsync(jobIdParam.Value.Value);
                            if (tucJob != null)
                            {
                                var contact = await Context.TucClientContacts
                                    .Where(c => c.UcctId == contactId)
                                    .Select(c => new { c.UcctFirstname, c.UcctSurname, c.UcctEmail })
                                    .FirstOrDefaultAsync();

                                var userName = contact != null
                                    ? $"{contact.UcctFirstname} {contact.UcctSurname} ({contact.UcctEmail})"
                                    : $"ContactID: {contactId}";

                                var completionNote = $"\n[BulkImport] Job imported as completed by {userName} on {DateTime.Now:yyyy-MM-dd HH:mm:ss}.";

                                tucJob.UcjbStatus = 6;
                                tucJob.UcjbComplTime = DateTime.Now;
                                tucJob.UcjbPodname = userName;
                                tucJob.UcjbNotes = string.IsNullOrEmpty(tucJob.UcjbNotes)
                                    ? completionNote
                                    : tucJob.UcjbNotes + completionNote;
                                tucJob.UcjbJobDone = true;
                                tucJob.TrackingMethod = null;
                                tucJob.TrackingEmail = null;
                                tucJob.TrackingMobile = null;
                                tucJob.ProofOfDelivery = null;
                                tucJob.ProofOfDeliveryEmail = null;
                                tucJob.ProofOfDeliveryMobile = null;

                                await Context.SaveChangesAsync();
                                Log.Information($"Marked US job {job.JobNumber} (ID: {jobIdParam.Value}) as completed during import");
                            }
                        }

                        await InsertJobDeliveryNote(jobIdParam.Value.Value, job.Notes);

                        {
                            var itemCount = job.Quantity ?? 1;
                            for (int qi = 0; qi < itemCount; qi++)
                            {
                                await Context.Procedures.NET_stpBulkJobItems_InsertAsync(
                                    jobIdParam.Value.Value, qi, 1, (double?)job.Weight, (double?)job.Length,
                                    (double?)job.Height, (double?)job.Width, null, null, null, null, null,
                                    job.Notes, null, $"{job.JobNumber}-{qi + 1}");
                            }
                            Log.Information($"Inserted {itemCount} job items for US on-demand job {job.JobNumber} (ID: {jobIdParam.Value})");
                        }

                        Log.Information($"Successfully created US job: {job.JobNumber}, JobID: {jobIdParam.Value}");
                    }
                    else
                    {
                        var spError = string.IsNullOrWhiteSpace(messageParam.Value?.ToString())
                            ? "Stored procedure returned a failure status with no error message."
                            : messageParam.Value.ToString();
                        Log.Error($"({request.MessageId}) Failed to create US on-demand job '{job.JobNumber}' (Client {request.ClientId}). SP message: {spError}");
                        job.ErrorMessage = spError;
                        failedJobs.Add(job);
                    }
                }
            }
            catch (Exception ex)
            {
                var friendlyError = BuildFriendlyJobError(ex);
                Log.Error(ex, $"({request.MessageId}) Error creating on-demand job '{job.JobNumber}' (Client {request.ClientId}, Speed {request.SpeedId}). Reason: {friendlyError}");
                job.ErrorMessage = friendlyError;
                failedJobs.Add(job);
            }
        }

        if (successfulJobCount > 0)
        {
            response.Success = true;

            if (failedJobs.Any())
            {
                response.Jobs = failedJobs.ToList();
                response.Messages.Add(new MessageDto
                {
                    Message = $"Warning: {successfulJobCount} job(s) were created. {failedJobs.Count} job(s) failed. See the table below for the reason against each failed job."
                });
                foreach (var f in failedJobs)
                {
                    response.Messages.Add(new MessageDto
                    {
                        Message = $"Job {f.JobNumber}: {(string.IsNullOrWhiteSpace(f.ErrorMessage) ? "Unknown error - check server logs." : f.ErrorMessage)}"
                    });
                }
            }
            else
            {
                response.Messages.Add(new MessageDto
                {
                    Message = $"Success: {successfulJobCount} job(s) were created successfully."
                });
            }
        }
        else
        {
            response.Success = false;
            response.Messages.Add(new MessageDto { Message = $"Failed to create any of the {failedJobs.Count} job(s). See per-job reasons below." });
            foreach (var f in failedJobs)
            {
                response.Messages.Add(new MessageDto
                {
                    Message = $"Job {f.JobNumber}: {(string.IsNullOrWhiteSpace(f.ErrorMessage) ? "Unknown error - check server logs." : f.ErrorMessage)}"
                });
            }
            response.Jobs = failedJobs.ToList();
        }

        return response;
    }

    // ---- ProcessRoutedJobs ------------------------------------------------

    private async Task<BulkImportResponse> ProcessRoutedJobs(int contactId, BulkImportRequest request, BulkImportResponse response, dynamic client)
    {
        var schedule = await Context.TblBulkRunSchedules.Include(s => s.RegionNavigation)
            .FirstOrDefaultAsync(s => s.BulkRunScheduleId == request.ScheduleId);

        if (client == null)
            return BulkImportResponseUtility.AddMessageAndReturnResponse(response, "Invalid client.");

        TblBulkRegion originRegion = null;
        if (request.OriginLocationId.HasValue)
        {
            originRegion = await Context.TblBulkRegions
                .Where(r => r.BulkRegionId == request.OriginLocationId.Value && r.Active == true)
                .FirstOrDefaultAsync();
            if (originRegion == null)
                return BulkImportResponseUtility.AddMessageAndReturnResponse(response, "Selected Origin Location does not exist or is not active.");
        }

        // MVP: coerce wizard-omitted SpeedId to the client's default BEFORE we
        // scan for a matching schedule so the schedule lookup uses the real
        // speed. Was previously done further down the method.
        if (request.SpeedId == 0 && client.Speed?.UcjtId is int defaultSpeedIdEarly)
            request.SpeedId = defaultSpeedIdEarly;

        // NZ wizard hard-codes scheduleId=null. When a schedule row matches
        // day+speed+client the legacy code threw "Schedule is required." here;
        // instead auto-resolve the schedule ID up front so the request behaves
        // as if the wizard had picked it. Same coercion pattern as SpeedId.
        if (!request.ScheduleId.HasValue)
        {
            short lookupDayOfWeek = request.BookDate.DayOfWeek == DayOfWeek.Sunday ? (short)7 : (short)request.BookDate.DayOfWeek;
            var resolvedScheduleId = await Context.TblBulkRunSchedules
                .Where(s => s.DayOfWeek == lookupDayOfWeek
                    && (!s.SpeedId.HasValue || s.SpeedId == request.SpeedId)
                    && (!s.ClientId.HasValue || s.ClientId == request.ClientId))
                // Prefer a client-specific match over a global one so per-client
                // overrides take precedence when both exist.
                .OrderByDescending(s => s.ClientId.HasValue)
                .ThenByDescending(s => s.SpeedId.HasValue)
                .Select(s => (int?)s.BulkRunScheduleId)
                .FirstOrDefaultAsync();
            if (resolvedScheduleId.HasValue)
            {
                request.ScheduleId = resolvedScheduleId;
                // Copy dynamic client.Id into a static local so it can be
                // captured inside the EF expression tree below (dynamic access
                // inside a Where() throws CS1963 otherwise).
                int clientIdForLookup = (int)client.Id;
                int scheduleIdForLookup = resolvedScheduleId.Value;
                // client.Schedule was loaded gated on request.ScheduleId.HasValue
                // so it is currently null. Load it now against the resolved ID.
                var scheduleSlice = await Context.TblBulkRunSchedules
                    .Where(s => s.BulkRunScheduleId == scheduleIdForLookup
                        && (!s.ClientId.HasValue || s.ClientId == clientIdForLookup))
                    .Select(s => new
                    {
                        s.BulkRunScheduleId,
                        s.StartTime,
                        s.CutoffHours,
                        s.ClientId,
                        s.SpeedId,
                        s.RegionNavigation.FromCompany,
                        s.RegionNavigation.FromAddress,
                        s.RegionNavigation.FromSuburb,
                        s.RegionNavigation.FromPostCode,
                        s.RegionNavigation.PickupLatitude,
                        s.RegionNavigation.PickupLongitude
                    })
                    .FirstOrDefaultAsync();

                if (scheduleSlice != null)
                {
                    // Rebuild `client` (dynamic) with the same shape but with
                    // Schedule populated so the rest of the method reads it as
                    // if the wizard had shipped a matching ScheduleId.
                    client = new
                    {
                        Id = client.Id,
                        Code = client.Code,
                        JobPrefix = client.JobPrefix,
                        UcclAddress = client.UcclAddress,
                        UcclSuburbId = client.UcclSuburbId,
                        UcclSuburbName = client.UcclSuburbName,
                        UcclPostCode = client.UcclPostCode,
                        Latitude = client.Latitude,
                        Longitude = client.Longitude,
                        Speed = client.Speed,
                        Schedule = scheduleSlice,
                        CreatBulkHomeDeliveryPickupJob = client.CreatBulkHomeDeliveryPickupJob,
                        ContentsUnknownForBulkJobs = client.ContentsUnknownForBulkJobs
                    };
                }
            }
        }

        if (request.ScheduleId.HasValue)
        {
            if (client.Schedule == null)
                return BulkImportResponseUtility.AddMessageAndReturnResponse(response, "Invalid schedule.");

            var tenantNow = TimeZoneUtility.GetTenantNow(_httpContextAccessor);
            var scheduleStartTime = DateTime.SpecifyKind(
                request.BookDate.Date.AddTicks(client.Schedule.StartTime.Ticks),
                request.BookDate.Kind);
            var cutoffTime = scheduleStartTime.AddHours(client.Schedule.CutoffHours >= 0 ? client.Schedule.CutoffHours * -1 : client.Schedule.CutoffHours);

            Log.Information($"({request.MessageId})({contactId}) [Schedule Cutoff] Checking schedule cutoff. " +
                $"ScheduleId: {request.ScheduleId}, " +
                $"BookDate: {request.BookDate:yyyy-MM-dd}, StartTime: {client.Schedule.StartTime}, " +
                $"CutoffHours: {client.Schedule.CutoffHours}, TenantNow: {tenantNow:yyyy-MM-dd HH:mm:ss}, " +
                $"ScheduleStartTime: {scheduleStartTime:yyyy-MM-dd HH:mm:ss}, CutoffTime: {cutoffTime:yyyy-MM-dd HH:mm:ss}");

            if (tenantNow >= cutoffTime)
            {
                Log.Warning($"({request.MessageId})({contactId}) [Schedule Cutoff] CUTOFF EXCEEDED! " +
                    $"TenantNow: {tenantNow:yyyy-MM-dd HH:mm:ss} >= CutoffTime: {cutoffTime:yyyy-MM-dd HH:mm:ss}");
                return BulkImportResponseUtility.AddMessageAndReturnResponse(response, "Schedule cutoff exceeded.");
            }
        }
        // Note: SpeedId coercion + schedule auto-resolve now run before the
        // ScheduleId.HasValue branch above, so this else / duplicate coercion
        // no longer needs to fire. Kept the "Invalid speed." validator here.
        if (client.Speed?.UcjtId != request.SpeedId || (request.ScheduleId.HasValue && client.Schedule.SpeedId > 0 && client.Schedule.SpeedId != request.SpeedId))
            return BulkImportResponseUtility.AddMessageAndReturnResponse(response, "Invalid speed.");

        // "Route starts from client site" preprocessing. When the operator
        // ticks the checkbox at Step 2 (MapColumnsModal), the wizard omits
        // every From* required field so the operator does not have to map
        // them. That leaves rows with an empty FromAddress, which then trips
        // the "No origin could be resolved" guard downstream because the
        // Route-from-client-site precedence branch itself keys off
        // !IsNullOrWhiteSpace(j.FromAddress). Populate the From* fields from
        // the client's saved site address here so the row satisfies that
        // guard and the existing branch runs as intended.
        if (request.RouteFromClientSite && !string.IsNullOrWhiteSpace((string)client.UcclAddress))
        {
            string clientAddress = ((string)client.UcclAddress).Trim();
            string clientLat = client.Latitude?.ToString();
            string clientLng = client.Longitude?.ToString();
            string clientSuburbName = client.UcclSuburbName as string;
            string clientPostCode = client.UcclPostCode as string;

            foreach (var j in request.Jobs)
            {
                if (string.IsNullOrWhiteSpace(j.FromAddress))
                {
                    j.FromAddress = clientAddress;
                    if (string.IsNullOrWhiteSpace(j.FromLatitude) && !string.IsNullOrWhiteSpace(clientLat))
                        j.FromLatitude = clientLat;
                    if (string.IsNullOrWhiteSpace(j.FromLongitude) && !string.IsNullOrWhiteSpace(clientLng))
                        j.FromLongitude = clientLng;

                    if (IsNzTenant())
                    {
                        if (string.IsNullOrWhiteSpace(j.FromSuburb) && !string.IsNullOrWhiteSpace(clientSuburbName))
                            j.FromSuburb = clientSuburbName;
                        if (string.IsNullOrWhiteSpace(j.FromPostCode) && !string.IsNullOrWhiteSpace(clientPostCode))
                            j.FromPostCode = clientPostCode;
                    }
                    else
                    {
                        // US: no UcclCity/State on TucClient, so leave those
                        // empty. The zip-precedence path uses UcclPostCode
                        // when present.
                        if (string.IsNullOrWhiteSpace(j.FromZipCode) && !string.IsNullOrWhiteSpace(clientPostCode))
                            j.FromZipCode = clientPostCode;
                    }
                }
            }
        }

        var suburbs = await Context.TucSuburbs
          .Select(s => new
          {
              s.UcsuName,
              s.PostCode
          })
          .ToListAsync();

        // Steve's 4-step origin precedence (US tenant only - NZ always
        // resolves at Step 1). Local function so it can close over the
        // captured schedule / originRegion / client / suburbs.
        ResolvedRoutedOrigin ResolveRoutedOriginLocal(BulkImportJobCreateDto j)
        {
            bool isUs = IsUsTenant();
            bool isNz = IsNzTenant();

            if (schedule?.RegionNavigation != null)
            {
                var r = schedule.RegionNavigation;
                string nzAL5 = null;
                string nzAL7 = null;
                if (isNz)
                {
                    nzAL5 = request.ScheduleId.HasValue
                        ? (string)client.Schedule.FromSuburb
                        : suburbs.FirstOrDefault(s => s.UcsuName?.Trim().ToLower() == j.FromSuburb?.Trim().ToLower().Replace('ā', 'a').Replace('ē', 'e').Replace('ī', 'i').Replace('ō', 'o').Replace('ū', 'u'))?.UcsuName;
                    nzAL7 = request.ScheduleId.HasValue
                        ? ((int?)client.Schedule.FromPostCode)?.ToString()
                        : j.FromPostCode?.Trim();
                }

                return new ResolvedRoutedOrigin
                {
                    FromCompany = r.FromCompany,
                    FromAddress = r.FromAddress,
                    FromSuburb = r.FromSuburb,
                    FromPostCode = r.FromPostCode,
                    PickUpLatitude = r.PickupLatitude?.ToString(),
                    PickUpLongitude = r.PickupLongitude?.ToString(),
                    FromGeoType = null,
                    AddressLine1 = r.FromCompany,
                    AddressLine2 = r.AddressLine2,
                    AddressLine3 = r.AddressLine3,
                    AddressLine4 = r.AddressLine4,
                    AddressLine5 = isNz ? nzAL5 : r.AddressLine5,
                    AddressLine6 = isNz ? null : r.AddressLine6,
                    AddressLine7 = isNz ? nzAL7 : r.AddressLine7,
                    AddressLine8 = r.AddressLine8
                };
            }

            if (isUs)
            {
                if (request.RouteFromClientSite && !string.IsNullOrWhiteSpace(j.FromAddress))
                {
                    return new ResolvedRoutedOrigin
                    {
                        FromCompany = string.IsNullOrWhiteSpace(j.FromCompany) ? null : j.FromCompany.Trim(),
                        FromAddress = j.FromAddress.Trim(),
                        FromSuburb = null,
                        FromPostCode = 0,
                        PickUpLatitude = string.IsNullOrWhiteSpace(j.FromLatitude) ? null : j.FromLatitude.Trim(),
                        PickUpLongitude = string.IsNullOrWhiteSpace(j.FromLongitude) ? null : j.FromLongitude.Trim(),
                        FromGeoType = j.FromGeoType,
                        AddressLine1 = string.IsNullOrWhiteSpace(j.FromCompany) ? null : j.FromCompany.Trim(),
                        AddressLine2 = string.IsNullOrWhiteSpace(j.FromUnit) ? null : j.FromUnit.Trim(),
                        AddressLine3 = null,
                        AddressLine4 = j.FromAddress.Trim(),
                        AddressLine5 = string.IsNullOrWhiteSpace(j.FromCity) ? null : j.FromCity.Trim(),
                        AddressLine6 = string.IsNullOrWhiteSpace(j.FromState) ? null : j.FromState.Trim(),
                        AddressLine7 = string.IsNullOrWhiteSpace(j.FromZipCode) ? null : j.FromZipCode.Trim(),
                        AddressLine8 = null
                    };
                }

                if (originRegion != null)
                {
                    return new ResolvedRoutedOrigin
                    {
                        FromCompany = originRegion.FromCompany,
                        FromAddress = originRegion.FromAddress,
                        FromSuburb = null,
                        FromPostCode = 0,
                        PickUpLatitude = originRegion.PickupLatitude?.ToString(),
                        PickUpLongitude = originRegion.PickupLongitude?.ToString(),
                        FromGeoType = null,
                        AddressLine1 = originRegion.FromCompany,
                        AddressLine2 = originRegion.AddressLine2,
                        AddressLine3 = originRegion.AddressLine3,
                        AddressLine4 = originRegion.AddressLine4,
                        AddressLine5 = originRegion.AddressLine5,
                        AddressLine6 = originRegion.AddressLine6,
                        AddressLine7 = originRegion.AddressLine7,
                        AddressLine8 = originRegion.AddressLine8
                    };
                }
            }

            return new ResolvedRoutedOrigin
            {
                Error = "No origin could be resolved for this row. Enable 'Route starts from client site' OR pick an Origin Location at Step 2."
            };
        }

        var resolvedOrigins = request.Jobs.ToDictionary(j => j, j => ResolveRoutedOriginLocal(j));
        var originResolutionErrors = resolvedOrigins.Where(kv => kv.Value.Error != null).ToList();
        if (originResolutionErrors.Any())
        {
            var firstErr = originResolutionErrors.First().Value.Error;
            return BulkImportResponseUtility.AddMessageAndReturnResponse(response,
                $"Could not resolve a rating origin for {originResolutionErrors.Count} job(s). {firstErr}");
        }

        Dictionary<string, int?> courierCodeToIdMap = new Dictionary<string, int?>();
        if (request.ImportAsCompleted)
        {
            var courierCodes = request.Jobs
                .Where(j => !string.IsNullOrWhiteSpace(j.CourierCode))
                .Select(j => j.CourierCode.Trim().ToUpper())
                .Distinct()
                .ToList();

            if (courierCodes.Any())
            {
                var couriers = await Context.TucCouriers
                    .Where(c => courierCodes.Contains(c.Code.ToUpper()) && c.Active)
                    .Select(c => new { c.Code, c.UccrId })
                    .ToListAsync();

                foreach (var courier in couriers)
                {
                    courierCodeToIdMap[courier.Code.ToUpper()] = courier.UccrId;
                }
            }
        }

        List<TblBulkJob> jobs = request.Jobs
            .Select(j => new TblBulkJob()
            {
                JobNumber = j.JobNumber.Trim().ToUpper(),
                BookDate = request.BookDate.Date,
                BookTime = request.ScheduleId.HasValue
                    ? DateTime.SpecifyKind(request.BookDate.Date.AddTicks(client.Schedule.StartTime.Ticks), request.BookDate.Kind)
                    : request.BookDate,
                Speed = request.SpeedId,
                ClientId = request.ClientId,
                ClientCode = client.Code,
                Contact = string.IsNullOrWhiteSpace(j.FromContact) ? null : j.FromContact.Trim(),
                FromCompany = resolvedOrigins[j].FromCompany,
                FromAddress = resolvedOrigins[j].FromAddress,
                FromSuburb = resolvedOrigins[j].FromSuburb,
                FromPostCode = resolvedOrigins[j].FromPostCode,
                PickUpLatitude = resolvedOrigins[j].PickUpLatitude,
                PickUpLongitude = resolvedOrigins[j].PickUpLongitude,
                FromGeoType = resolvedOrigins[j].FromGeoType,
                PickupAddressLine1 = resolvedOrigins[j].AddressLine1,
                PickupAddressLine2 = resolvedOrigins[j].AddressLine2,
                PickupAddressLine3 = resolvedOrigins[j].AddressLine3,
                PickupAddressLine4 = resolvedOrigins[j].AddressLine4,
                PickupAddressLine5 = resolvedOrigins[j].AddressLine5,
                PickupAddressLine6 = resolvedOrigins[j].AddressLine6,
                PickupAddressLine7 = resolvedOrigins[j].AddressLine7,
                PickupAddressLine8 = resolvedOrigins[j].AddressLine8,
                DeliverToContact = j.ToContact.Trim(),
                DeliverToPhone = string.IsNullOrWhiteSpace(j.ToContactPhone) ? null : j.ToContactPhone.Trim(),
                ToCompany = string.IsNullOrWhiteSpace(j.ToCompany) ? null : j.ToCompany.Trim(),
                ToAddress = string.IsNullOrWhiteSpace(j.ToCompany) ? j.ToAddress.Trim() : j.ToCompany.Trim() + AddressService.TO_COMPANY_SEPERATOR + j.ToAddress.Trim(),
                ToSuburb = IsNzTenant() ? suburbs.FirstOrDefault(s => s.UcsuName?.Trim().ToLower() == j.ToSuburb?.Trim().ToLower().Replace('ā', 'a').Replace('ē', 'e').Replace('ī', 'i').Replace('ō', 'o').Replace('ū', 'u'))?.UcsuName : null,
                ToPostCode = ParseNullableIntSafe(IsNzTenant() ? j.ToPostCode : j.ToZipCode) ?? 0,
                DeliveryLatitude = string.IsNullOrWhiteSpace(j.ToLatitude) ? null : j.ToLatitude.Trim(),
                DeliveryLongitude = string.IsNullOrWhiteSpace(j.ToLongitude) ? null : j.ToLongitude.Trim(),
                ToGeoType = j.ToGeoType,
                DeliveryAddressLine1 = string.IsNullOrWhiteSpace(j.ToCompany) ? null : j.ToCompany.Trim(),
                DeliveryAddressLine2 = null,
                DeliveryAddressLine3 = null,
                DeliveryAddressLine4 = j.ToAddress.Trim(),
                DeliveryAddressLine5 = IsNzTenant()
                    ? suburbs.FirstOrDefault(s => s.UcsuName?.Trim().ToLower() == j.ToSuburb?.Trim().ToLower().Replace('ā', 'a').Replace('ē', 'e').Replace('ī', 'i').Replace('ō', 'o').Replace('ū', 'u'))?.UcsuName
                    : j.ToCity,
                DeliveryAddressLine6 = IsNzTenant() ? null : j.ToState,
                DeliveryAddressLine7 = IsNzTenant() ? j.ToPostCode?.Trim() : j.ToZipCode,
                DeliveryAddressLine8 = null,
                Qty = j.Quantity ?? 1,
                Length = j.Length,
                Width = j.Width,
                Height = j.Height,
                Weight = j.Weight,
                Size = (short)EstimateVehicleSize(j.Length, j.Width, j.Height, j.Weight),
                ClientRefa = string.IsNullOrWhiteSpace(j.ClientRefA) ? null : j.ClientRefA.Trim(),
                ClientRefb = string.IsNullOrWhiteSpace(j.ClientRefB) ? null : j.ClientRefB.Trim(),
                OurRef = string.IsNullOrWhiteSpace(j.OurRef) ? null : j.OurRef.Trim(),
                Notes = string.IsNullOrWhiteSpace(j.Notes) ? null : j.Notes.Trim(),
                TrackingEmail = request.ImportAsCompleted ? null : (string.IsNullOrWhiteSpace(j.TrackingEmail) ? null : j.TrackingEmail.Trim()),
                TrackingMobile = request.ImportAsCompleted ? null : (string.IsNullOrWhiteSpace(j.TrackingMobile) ? null : j.TrackingMobile.Trim()),
                ProofOfDeliveryEmail = request.ImportAsCompleted ? null : (string.IsNullOrWhiteSpace(j.TrackingEmail) ? null : j.TrackingEmail.Trim()),
                ProofOfDeliveryMobile = request.ImportAsCompleted ? null : (string.IsNullOrWhiteSpace(j.TrackingMobile) ? null : j.TrackingMobile.Trim()),
                JobStatus = request.ImportAsCompleted ? 6 : 0,
                Done = request.ImportAsCompleted,
                RemoteJob = client.Speed.ZoneRated ?? false,
                Amount = j.Amount,
                ScheduleId = request.ScheduleId.HasValue ? request.ScheduleId : null,
                DropOffLocationId = schedule?.DropOffLocationId,
                StorageState = schedule?.StorageState,
                DeliveryState = schedule?.DeliveryState,
                ScheduleName = schedule?.Name,
                SourceId = 3,
                LoggedInContactId = contactId,
                CourierPercentageOverride = j.CourierPercentageOverride,
                CourierId = request.ImportAsCompleted && !string.IsNullOrWhiteSpace(j.CourierCode)
                    ? (courierCodeToIdMap.ContainsKey(j.CourierCode.Trim().ToUpper())
                        ? courierCodeToIdMap[j.CourierCode.Trim().ToUpper()]
                        : null)
                    : null,
                ContentsUnknownAtPickup = client.ContentsUnknownForBulkJobs
            })
            .ToList();

        if (IsNzTenant() && jobs.Any(j => string.IsNullOrWhiteSpace(j.FromSuburb) || string.IsNullOrWhiteSpace(j.ToSuburb)))
            return BulkImportResponseUtility.AddMessageAndReturnResponse(response, "Invalid suburb(s).");

        var autoJobs = jobs.Where(j => j.JobNumber.Trim().ToUpper() == "AUTOGENERATE").ToList();
        if (autoJobs.Any())
        {
            int currentJobNumber = await Context.AssignJobNumbersAsync(client.Id, autoJobs.Count());
            foreach (var j in autoJobs)
            {
                j.JobNumber = $"{(string.IsNullOrWhiteSpace(client.JobPrefix) ? client.Id.ToString() : client.JobPrefix.Trim())}{currentJobNumber.ToString().PadLeft(4, '0')}";
                currentJobNumber += 1;
            }
        }

        if (!request.isKmRatedJobs)
        {
            var ratedJobs = await PriceAndSplitJobsAndReturnKmRatedJobs(request.MessageId, jobs, request.ScheduleId);

            if (request.ScheduleId.HasValue)
            {
                var tenantNow = TimeZoneUtility.GetTenantNow(_httpContextAccessor);
                var scheduleStartTime = DateTime.SpecifyKind(
                    request.BookDate.Date.AddTicks(client.Schedule.StartTime.Ticks),
                    request.BookDate.Kind);
                var cutoffTime = scheduleStartTime.AddHours(client.Schedule.CutoffHours >= 0 ? client.Schedule.CutoffHours * -1 : client.Schedule.CutoffHours);

                Log.Information($"({request.MessageId})({contactId}) [Schedule Cutoff - Post-Pricing] Re-checking cutoff after pricing. " +
                    $"TenantNow: {tenantNow:yyyy-MM-dd HH:mm:ss}, CutoffTime: {cutoffTime:yyyy-MM-dd HH:mm:ss}");

                if (tenantNow >= cutoffTime)
                {
                    Log.Warning($"({request.MessageId})({contactId}) [Schedule Cutoff - Post-Pricing] CUTOFF EXCEEDED AFTER PRICING! " +
                        $"TenantNow: {tenantNow:yyyy-MM-dd HH:mm:ss} >= CutoffTime: {cutoffTime:yyyy-MM-dd HH:mm:ss}");
                    return BulkImportResponseUtility.AddMessageAndReturnResponse(response, "Schedule cutoff exceeded.");
                }
            }

            var jobNumbersByBookDate = jobs.GroupBy(x => x.BookDate.Date);
            foreach (var group in jobNumbersByBookDate)
            {
                var duplicates = group
                    .GroupBy(x => x.JobNumber.Trim().ToUpper())
                    .Where(x => x.Count() > 1)
                    .Select(x => x.Key);

                if (duplicates.Any())
                    return BulkImportResponseUtility.AddMessageAndReturnResponse(response, $"Duplicate job number(s) in file: {string.Join(",", duplicates.Take(10))}{(duplicates.Count() > 10 ? "... and more." : string.Empty)}");

                var jobNumbers = group.Select(x => x.JobNumber.Trim().ToUpper()).Distinct().ToList();
                var existing = await Context.TblBulkJobs
                    .Where(j => j.BookDate.Date == group.Key.Date && jobNumbers.Contains(j.JobNumber.Trim().ToUpper()))
                    .Select(j => j.JobNumber)
                    .ToListAsync();

                if (existing.Any())
                    return BulkImportResponseUtility.AddMessageAndReturnResponse(response, $"These job number(s) already exist for this date: {string.Join(",", existing.Take(10))}{(existing.Count() > 10 ? "... and more." : string.Empty)}");
            }

            jobs = ratedJobs.zoneRatedJobs;
            var zoneRatedPendingItems = ratedJobs.pendingJobItems;

            if (jobs.Any())
            {
                Log.Information($"({request.MessageId})({contactId}) Assigning Import Batch.");
                BulkImportBatch batch = new BulkImportBatch()
                {
                    Created = DateTime.Now,
                    ContactId = contactId,
                };
                Context.BulkImportBatches.Add(batch);
                await Context.SaveChangesAsync();

                jobs.ForEach(j => j.ImportId = batch.Id);
                Log.Information($"({request.MessageId})({contactId}) Inserting {jobs.Count()} Jobs. Import Batch ID {batch.Id}.");
                // EFCore.BulkExtensions 10.0.1 is binary-incompatible with EF
                // Core 10.0.3: TableInfo.LoadData still calls the removed
                // IReadOnlyNavigationBase.IsCollection instance member, throwing
                // MissingMethodException before any insert happens (P0-a). Fall
                // back to plain EF Core AddRange + SaveChanges. Batch sizes for
                // BulkImport are small (dozens to low hundreds of rows), so the
                // per-row INSERT round-trip is acceptable. Triggers + check
                // constraints still fire on the server side by default.
                await Context.TblBulkJobs.AddRangeAsync(jobs);
                await Context.SaveChangesAsync();

                await InsertBulkJobDeliveryNotes(jobs);

                var jobNumbersInBatch = new HashSet<string>(jobs.Select(j => j.JobNumber));
                var batchPendingItems = zoneRatedPendingItems
                    .Where(p => jobNumbersInBatch.Contains(p.ParentJobNumber))
                    .ToList();
                await InsertPendingJobItems(batchPendingItems, batch.Id);

                if (client.CreatBulkHomeDeliveryPickupJob)
                {
                    response.PickupJob = await GetBulkHomeDeliveryPickupJob(request.MessageId, client, (TimeSpan)(client.Schedule.StartTime ?? TimeSpan.Zero), jobs, request.PickupJob);
                }

                Log.Information($"({request.MessageId})({contactId}) Inserting Jobs Completed. BatchId {batch.Id}.");

                if (jobs.Any(j => j.JobRelationshipTypeId == 19))
                {
                    await Context.Database.ExecuteSqlRawAsync("UTL_stpJobBulk_UpdateParentID");
                }

                if (jobs.Any(j => j.JobRelationshipTypeId == 20 && j.JobNumber.Contains("-1")))
                {
                    await Context.Database.ExecuteSqlRawAsync("UTL_stpBulk_UpdateParentID");
                }
            }

            var kmRatedJobs = ratedJobs.kmRatedJobs;
            if (kmRatedJobs.Any())
            {
                response.Jobs = kmRatedJobs
                    .Select(j => new BulkImportJobCreateDto()
                    {
                        JobNumber = j.JobNumber,
                        BookDate = j.BookDate.ToString("dd/MM/yyyy"),
                        FromContact = j.Contact,
                        FromCompany = j.FromCompany,
                        FromAddress = j.FromAddress,
                        FromCity = IsNzTenant() ? j.FromSuburb : j.PickupAddressLine5,
                        FromState = IsNzTenant() ? null : j.PickupAddressLine6,
                        FromZipCode = IsNzTenant() ? j.FromPostCode.ToString() : j.PickupAddressLine7,
                        FromSuburb = IsNzTenant() ? j.FromSuburb : null,
                        FromPostCode = IsNzTenant() ? j.FromPostCode?.ToString() : null,
                        FromLatitude = j.PickUpLatitude,
                        FromLongitude = j.PickUpLongitude,
                        FromGeoType = j.FromGeoType,
                        ToCompany = j.ToCompany,
                        ToAddress = j.ToAddress,
                        ToCity = IsNzTenant() ? j.ToSuburb : j.DeliveryAddressLine5,
                        ToState = IsNzTenant() ? null : j.DeliveryAddressLine6,
                        ToZipCode = IsNzTenant() ? j.ToPostCode.ToString() : j.DeliveryAddressLine7,
                        ToSuburb = IsNzTenant() ? j.ToSuburb : null,
                        ToPostCode = IsNzTenant() ? j.ToPostCode?.ToString() : null,
                        ToLatitude = j.DeliveryLatitude,
                        ToLongitude = j.DeliveryLongitude,
                        ToGeoType = j.ToGeoType,
                        ToContact = j.DeliverToContact,
                        ToContactPhone = j.DeliverToPhone,
                        Quantity = j.Qty,
                        Length = j.Length ?? 1,
                        Width = j.Width ?? 1,
                        Height = j.Height ?? 1,
                        Weight = j.Weight ?? 1,
                        ClientRefA = j.ClientRefa,
                        ClientRefB = j.ClientRefb,
                        OurRef = j.OurRef,
                        Notes = j.Notes,
                        TrackingEmail = j.TrackingEmail,
                        TrackingMobile = j.TrackingMobile,
                        Amount = j.Amount,
                        CourierPercentageOverride = j.CourierPercentageOverride
                    })
                    .ToList();

                response.ClientId = request.ClientId;
                response.BookDate = request.BookDate;
                response.ScheduleId = request.ScheduleId;
                response.SpeedId = request.SpeedId;

                Log.Information($"({request.MessageId})({contactId}) contains {kmRatedJobs.Count} KmRatedJobs.");
            }
        }
        else
        {
            var kmPendingItems = new List<PendingBulkJobItem>();
            foreach (var job in jobs)
            {
                SplitJobAndApplyAmount(jobs, job, job.Amount, null, pendingJobItems: kmPendingItems);
            }

            Log.Information($"({request.MessageId})({contactId}) Assigning Import Batch.");
            BulkImportBatch batch = new BulkImportBatch()
            {
                Created = DateTime.Now,
                ContactId = contactId,
            };
            Context.BulkImportBatches.Add(batch);
            await Context.SaveChangesAsync();

            jobs.ForEach(j => j.ImportId = batch.Id);
            Log.Information($"({request.MessageId})({contactId}) Inserting {jobs.Count()} Jobs. Import Batch ID {batch.Id}.");
            // EFCore.BulkExtensions 10.0.1 is binary-incompatible with EF Core
            // 10.0.3 (P0-a: MissingMethodException on IsCollection); fall back
            // to plain AddRange + SaveChanges. See sibling call site for
            // full rationale.
            await Context.TblBulkJobs.AddRangeAsync(jobs);
            await Context.SaveChangesAsync();

            await InsertBulkJobDeliveryNotes(jobs);

            await InsertPendingJobItems(kmPendingItems, batch.Id);

            if (client.CreatBulkHomeDeliveryPickupJob)
            {
                response.PickupJob = await GetBulkHomeDeliveryPickupJob(request.MessageId, client, (TimeSpan)(client.Schedule.StartTime ?? TimeSpan.Zero), jobs, request.PickupJob);
            }

            Log.Information($"({request.MessageId})({contactId}) Inserting Jobs Completed. BatchId {batch.Id}.");
        }

        response.Success = true;
        return response;
    }

    // ---- geocode helpers --------------------------------------------------

    private async Task GeocodeJobFromAddress(BulkImportJobCreateDto job, Guid messageId, int contactId)
    {
        try
        {
            string suburb = IsNzTenant() ? job.FromSuburb : job.FromCity;
            string postCode = IsNzTenant() ? job.FromPostCode : job.FromZipCode;

            if (string.IsNullOrWhiteSpace(job.FromAddress) || string.IsNullOrWhiteSpace(suburb))
            {
                Log.Warning($"({messageId})({contactId}) [GeocodeJobFromAddress] FromAddress or suburb is empty, skipping geocoding.");
                return;
            }

            string addressInfo = string.IsNullOrWhiteSpace(postCode)
                ? $"{job.FromAddress}, {suburb}"
                : $"{job.FromAddress}, {suburb}, {postCode}";
            Log.Information($"({messageId})({contactId}) [GeocodeJobFromAddress] Geocoding from address: {addressInfo}");

            var geocodeRequest = new GeocodeRequest
            {
                MessageId = messageId,
                Addresses = new List<AddressDto>
                {
                    new AddressDto
                    {
                        Address = job.FromAddress,
                        Suburb = suburb,
                        PostCode = postCode
                    }
                }
            };

            var geocodeResponse = await _addressService.Geocode(geocodeRequest);

            if (geocodeResponse.Success && geocodeResponse.Addresses?.Any() == true)
            {
                var geocodedAddress = geocodeResponse.Addresses.First();

                job.FromLatitude = geocodedAddress.Latitude;
                job.FromLongitude = geocodedAddress.Longitude;

                if (IsNzTenant())
                {
                    if (string.IsNullOrWhiteSpace(job.FromPostCode))
                    {
                        job.FromPostCode = geocodedAddress.SuggestedPostCode ?? geocodedAddress.PostCode;
                        Log.Information($"({messageId})({contactId}) [GeocodeJobFromAddress] Populated missing FromPostCode: {job.FromPostCode}");
                    }
                    else if (!string.IsNullOrWhiteSpace(geocodedAddress.SuggestedPostCode))
                    {
                        job.FromPostCode = geocodedAddress.SuggestedPostCode;
                        Log.Information($"({messageId})({contactId}) [GeocodeJobFromAddress] Updated FromPostCode to suggested: {job.FromPostCode}");
                    }
                }
                else
                {
                    if (string.IsNullOrWhiteSpace(job.FromZipCode))
                    {
                        job.FromZipCode = geocodedAddress.SuggestedPostCode ?? geocodedAddress.PostCode;
                        Log.Information($"({messageId})({contactId}) [GeocodeJobFromAddress] Populated missing FromZipCode: {job.FromZipCode}");
                    }
                    else if (!string.IsNullOrWhiteSpace(geocodedAddress.SuggestedPostCode))
                    {
                        job.FromZipCode = geocodedAddress.SuggestedPostCode;
                        Log.Information($"({messageId})({contactId}) [GeocodeJobFromAddress] Updated FromZipCode to suggested: {job.FromZipCode}");
                    }
                }

                Log.Information($"({messageId})({contactId}) [GeocodeJobFromAddress] Successfully geocoded: Lat={job.FromLatitude}, Lng={job.FromLongitude}, PostCode={job.FromPostCode ?? job.FromZipCode}");
            }
            else
            {
                Log.Warning($"({messageId})({contactId}) [GeocodeJobFromAddress] Failed to geocode address: {addressInfo}");
            }
        }
        catch (Exception ex)
        {
            Log.Error(ex, $"({messageId})({contactId}) [GeocodeJobFromAddress] Error geocoding from address: {ex.Message}");
        }
    }
}
