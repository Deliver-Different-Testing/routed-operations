// Part 4 of the BulkService port - internal-staff direct-insert flow.
//
// Ported verbatim from BulkImportHyper/Application/Core/Services/BulkService.cs
// (StaffImport method + helper block). Kept in its own partial file so the
// three-file split at BulkImportServiceV2 stays coherent; StaffImport is
// self-contained and shares only the IHttpContextAccessor + DbContext with
// the rest of the partial class.
//
// Feature 4 (2026-07-23) - Staff Import now supports BOTH tenants. NZ jobs
// go through INT_stpJob_BulkInsertAsync; US jobs go through
// DD_stpJob_InsertExceleratorAsync (91-param variant). Controller-side
// country gate has been removed; the Internal claim gate remains.
//
// DEVIATIONS FROM SOURCE
//   - Base class: source uses BaseService(IDbContextFactory<DespatchContext>),
//     port uses IDbContextFactory<DynamicDespatchDbContext> - inherited from
//     the partial class ctor.
//   - Namespaces: `BulkImport.Application.*` -> `RoutedOperations.Core.*`.
//   - DD_stpJob_InsertExceleratorAsync now takes 91 params (3 new tail params
//     forceTucJobPush / jobBookingID / pickupReadyDateTime - same defaults
//     as BulkImportJobFactory: false, 0, @Time).
using Microsoft.EntityFrameworkCore;
using RoutedOperations.Core.Application.Dtos.BulkImport.Bulk;
using RoutedOperations.Core.Application.Dtos.BulkImport.Common;
using RoutedOperations.Core.Application.Utilities;
using RoutedOperations.Core.Domain.Despatch;
using Serilog;

namespace RoutedOperations.Core.Application.Services.BulkImport;

public partial class BulkImportServiceV2
{
    /// <summary>
    /// Staff Import - Allows internal staff to import job data directly from
    /// spreadsheet into the live tucJob table. Reads all fields from the
    /// spreadsheet row-dictionary and inserts via per-tenant SPs. ClientID
    /// is read from each row's data.
    /// </summary>
    public async Task<StaffImportResponse> StaffImport(int contactId, StaffImportRequest request)
    {
        var response = new StaffImportResponse(request.MessageId);
        int successCount = 0;
        int rowNumber = 0;

        // Cache client lookups so a 1000-row batch doesn't hit the DB 1000
        // times for the same client. Anonymous type -> `dynamic` to preserve
        // the source's late-bound property shape.
        var clientCache = new Dictionary<int, dynamic>();
        var clientCodeCache = new Dictionary<string, dynamic>();

        try
        {
            // Feature 4 - Staff Import now supports both tenants. The NZ
            // early-return has been removed; tenant branching happens per-row
            // below (INT_stpJob_BulkInsertAsync vs DD_stpJob_InsertExceleratorAsync).
            var isNz = IsNzTenant();

            Log.Information($"({request.MessageId})({contactId}) [StaffImport] Starting staff import with {request.Jobs.Count()} jobs (tenant={(isNz ? "NZ" : "US")})");

            // Get StaffId from contact for opID parameter
            int? opId = await Context.TucClientContacts
                .Where(c => c.UcctId == contactId)
                .Select(c => c.StaffId)
                .FirstOrDefaultAsync();

            foreach (var jobData in request.Jobs)
            {
                rowNumber++;
                try
                {
                    // Get ClientID from the job data - supports ClientID, Client_ID, ClientCode
                    int? clientId = GetIntValue(jobData, "ClientID", "ClientId", "Client_ID", "clientid");
                    string clientCode = GetStringValue(jobData, "ClientCode", "Client_Code", "clientcode");

                    dynamic client = null;

                    if (clientId.HasValue && clientId.Value > 0)
                    {
                        if (!clientCache.TryGetValue(clientId.Value, out client))
                        {
                            var dbClient = await Context.TucClients
                                .Where(c => c.UcclId == clientId.Value && c.UcclActive)
                                .Select(c => new { Id = c.UcclId, Code = c.UcclCode, Name = c.UcclName, JobPrefix = c.JobPrefix })
                                .FirstOrDefaultAsync();

                            if (dbClient != null)
                            {
                                client = dbClient;
                                clientCache[clientId.Value] = client;
                            }
                        }
                    }
                    else if (!string.IsNullOrWhiteSpace(clientCode))
                    {
                        var codeKey = clientCode.Trim().ToUpperInvariant();
                        if (!clientCodeCache.TryGetValue(codeKey, out client))
                        {
                            var dbClient = await Context.TucClients
                                .Where(c => c.UcclCode.ToUpper() == codeKey && c.UcclActive)
                                .Select(c => new { Id = c.UcclId, Code = c.UcclCode, Name = c.UcclName, JobPrefix = c.JobPrefix })
                                .FirstOrDefaultAsync();

                            if (dbClient != null)
                            {
                                client = dbClient;
                                clientCodeCache[codeKey] = client;
                            }
                        }
                    }

                    if (client == null)
                    {
                        throw new Exception($"Client not found. ClientID: {clientId}, ClientCode: {clientCode}");
                    }

                    string jobNumber = GetStringValue(jobData, "JobNumber", "Job Number", "jobnumber");

                    // Auto-generate job number if not provided or empty. Uses the
                    // shared AssignJobNumbersAsync SP that stamps a client-prefixed
                    // 4-digit sequence (same as the wizard's AUTOGENERATE flag).
                    if (string.IsNullOrWhiteSpace(jobNumber) || jobNumber.ToUpper() == "AUTOGENERATE")
                    {
                        int currentJobNumber = await Context.AssignJobNumbersAsync(client.Id, 1);
                        string prefix = string.IsNullOrWhiteSpace(client.JobPrefix) ? client.Id.ToString() : client.JobPrefix.Trim();
                        jobNumber = $"{prefix}{currentJobNumber.ToString().PadLeft(4, '0')}";
                    }

                    // Dates - support both BookDate and DeliveryDate (Despatch_Root legacy)
                    DateTime bookDate = GetDateValue(jobData, "BookDate", "Book Date", "bookdate", "DeliveryDate", "Delivery Date") ?? DateTime.Today;
                    DateTime? bookTime = GetDateValue(jobData, "BookTime", "Book Time", "booktime", "DeliveryTime", "Delivery Time");

                    string contact = GetStringValue(jobData, "Contact", "FromContact", "contact", "ContactName");
                    decimal amount = GetDecimalValue(jobData, "Amount", "amount") ?? 0;
                    int? speedId = GetIntValue(jobData, "Speed", "SpeedId", "speed", "SpeedID");

                    string fromCompany = GetStringValue(jobData, "FromCompany", "From Company", "fromcompany");
                    string fromAddress = GetStringValue(jobData, "FromAddress", "From Address", "fromaddress");
                    string fromSuburb = GetStringValue(jobData, "FromSuburb", "From Suburb", "fromsuburb");
                    string fromCity = GetStringValue(jobData, "FromCity", "From City", "fromcity");
                    string fromState = GetStringValue(jobData, "FromState", "From State", "fromstate");
                    int? fromPostCode = GetIntValue(jobData, "FromPostCode", "From PostCode", "frompostcode");
                    int? fromZipCode = GetIntValue(jobData, "FromZipCode", "From Zip Code", "fromzipcode");

                    string toCompany = GetStringValue(jobData, "ToCompany", "To Company", "tocompany", "CompanyName");
                    string toAddress = GetStringValue(jobData, "ToAddress", "To Address", "toaddress");
                    string toSuburb = GetStringValue(jobData, "ToSuburb", "To Suburb", "tosuburb");
                    string toCity = GetStringValue(jobData, "ToCity", "To City", "tocity");
                    string toState = GetStringValue(jobData, "ToState", "To State", "tostate");
                    int? toPostCode = GetIntValue(jobData, "ToPostCode", "To PostCode", "topostcode");
                    int? toZipCode = GetIntValue(jobData, "ToZipCode", "To Zip Code", "tozipcode");
                    string toContact = GetStringValue(jobData, "ToContact", "To Contact", "tocontact");
                    string toContactPhone = GetStringValue(jobData, "ToContactPhone", "To Contact Phone", "tocontactphone");

                    short? qty = (short?)GetIntValue(jobData, "Qty", "Quantity", "qty", "Items");
                    int? size = GetIntValue(jobData, "Size", "size", "VehicleSize");
                    double? weight = GetDoubleValue(jobData, "Weight", "weight");
                    int? courierId = GetIntValue(jobData, "CourierId", "Courier Id", "courierid", "CourierID");
                    string courierCode = GetStringValue(jobData, "CourierCode", "Courier Code", "couriercode");

                    // Resolve courier: prefer explicit CourierId if it exists in tucCourier,
                    // otherwise look up by CourierCode.
                    if (courierId.HasValue && courierId.Value > 0)
                    {
                        var courierExists = await Context.TucCouriers.AnyAsync(c => c.UccrId == courierId.Value);
                        if (!courierExists)
                            courierId = null;
                    }
                    if (!courierId.HasValue && !string.IsNullOrWhiteSpace(courierCode))
                    {
                        courierId = await Context.TucCouriers
                            .Where(c => c.Code == courierCode.Trim() && c.Active)
                            .Select(c => (int?)c.UccrId)
                            .FirstOrDefaultAsync();
                    }

                    string clientRefA = GetStringValue(jobData, "ClientRefA", "Client Ref A", "clientrefa");
                    string clientRefB = GetStringValue(jobData, "ClientRefB", "Client Ref B", "clientrefb");
                    string ourRef = GetStringValue(jobData, "OurRef", "Our Ref", "ourref");
                    string notes = GetStringValue(jobData, "Notes", "notes");

                    string trackingEmail = GetStringValue(jobData, "TrackingEmail", "Tracking Email", "trackingemail");
                    string trackingMobile = GetStringValue(jobData, "TrackingMobile", "Tracking Mobile", "trackingmobile");
                    string podEmail = GetStringValue(jobData, "PODEmail", "POD Email", "podemail", "Email");
                    string podMobile = GetStringValue(jobData, "PODMobile", "POD Mobile", "podmobile", "Mobile");

                    string pickUpLatitude = GetStringValue(jobData, "PickUpLatitude", "Pickup Latitude", "pickuplatitude", "fromLat");
                    string pickUpLongitude = GetStringValue(jobData, "PickUpLongitude", "Pickup Longitude", "pickuplongitude", "fromLng");
                    string deliveryLatitude = GetStringValue(jobData, "DeliveryLatitude", "Delivery Latitude", "deliverylatitude", "toLat");
                    string deliveryLongitude = GetStringValue(jobData, "DeliveryLongitude", "Delivery Longitude", "deliverylongitude", "toLng");

                    int? fromGeoType = GetIntValue(jobData, "FromGeoType", "fromGeoType");
                    int? toGeoType = GetIntValue(jobData, "ToGeoType", "toGeoType");

                    bool? onHold = GetBoolValue(jobData, "OnHold", "On Hold", "onhold");
                    bool? nwDocJob = GetBoolValue(jobData, "NWDocJob", "NW Doc Job", "nwdocjob");
                    bool? wellingtonJob = GetBoolValue(jobData, "WellingtonJob", "Wellington Job", "wellingtonjob");
                    bool? prebookJob = GetBoolValue(jobData, "PrebookJob", "Prebook Job", "prebookjob");
                    bool? remoteJob = GetBoolValue(jobData, "RemoteJob", "Remote Job", "remotejob", "RemoteScreen");
                    string runName = GetStringValue(jobData, "RunName", "Run Name", "runname");

                    bool? okToLeave = GetBoolValue(jobData, "Ok_To_Leave", "OkToLeave", "DeliverToPrivateBusiness");
                    int? deliverToLeaveId = GetIntValue(jobData, "Location", "DeliverToLeaveID");

                    int? status = GetIntValue(jobData, "Status", "status");
                    bool? jobDone = GetBoolValue(jobData, "JobDone", "Job Done", "jobdone");
                    DateTime? complTime = GetDateValue(jobData, "ComplTime", "Complete Time", "compltime");
                    string podName = GetStringValue(jobData, "PODName", "POD Name", "podname");

                    string pickupTimeZone = GetTimeZoneCode(pickUpLatitude, pickUpLongitude);
                    string deliverByTimeZone = GetTimeZoneCode(deliveryLatitude, deliveryLongitude);

                    if (!speedId.HasValue || speedId == 0)
                    {
                        speedId = 1;
                    }

                    // ToAddress includes CompanyName prefix like Despatch_Root does
                    string fullToAddress = !string.IsNullOrEmpty(toCompany)
                        ? $"{toCompany}, {toAddress}"
                        : toAddress;

                    if (isNz)
                    {
                    await Context.Procedures.INT_stpJob_BulkInsertAsync(
                        jobNumber: jobNumber,
                        bookDate: bookDate.Date,
                        // NULL when the row didn't supply a booking time. The
                        // 1900-01-01 sentinel silently drifts from legacy which
                        // passes NULL and lets the SP's own defaults kick in.
                        bookTime: bookTime,
                        clientID: client.Id,
                        clientCode: client.Code,
                        contact: contact ?? string.Empty,
                        amount: amount,
                        speed: speedId.Value,
                        fromAddress: fromAddress ?? string.Empty,
                        fromSuburb: fromSuburb ?? fromCity ?? string.Empty,
                        toAddress: fullToAddress ?? string.Empty,
                        toSuburb: toSuburb ?? toCity ?? string.Empty,
                        toContact: toContact ?? string.Empty,
                        toContactPhone: toContactPhone ?? string.Empty,
                        size: (short?)(size ?? 2),
                        qty: qty ?? 1,
                        weight: weight,
                        courierID: courierId,
                        clientRefa: clientRefA ?? string.Empty,
                        clientRefb: clientRefB ?? string.Empty,
                        ourRef: ourRef ?? string.Empty,
                        deliverToPrivateBusiness: okToLeave ?? false,
                        deliverToLeaveID: deliverToLeaveId,
                        notes: notes ?? string.Empty,
                        remoteJob: remoteJob ?? false,
                        trackingEmail: trackingEmail ?? string.Empty,
                        trackingMobile: trackingMobile ?? string.Empty,
                        proofOfDeliveryMobile: podMobile ?? toContactPhone ?? string.Empty,
                        proofOfDeliveryEmail: podEmail ?? trackingEmail ?? string.Empty,
                        // Lat/Lng SP params are nvarchar but INSERT into tucJob's
                        // decimal columns; SQL implicitly casts and blows up on
                        // empty string with SQL 8114 "Error converting data type
                        // nvarchar to numeric". Coerce whitespace/empty to null
                        // so the wrapper sends DBNull and the destination decimal
                        // column stays NULL.
                        pickUpLatitude: string.IsNullOrWhiteSpace(pickUpLatitude) ? null : pickUpLatitude,
                        pickUpLongitude: string.IsNullOrWhiteSpace(pickUpLongitude) ? null : pickUpLongitude,
                        deliveryLatitude: string.IsNullOrWhiteSpace(deliveryLatitude) ? null : deliveryLatitude,
                        deliveryLongitude: string.IsNullOrWhiteSpace(deliveryLongitude) ? null : deliveryLongitude,
                        prebookJob: prebookJob ?? false,
                        onHold: onHold ?? false,
                        wellingtonJob: wellingtonJob ?? false,
                        nWDocJob: nwDocJob ?? false,
                        runName: runName,
                        fromGeoType: fromGeoType,
                        toGeoType: toGeoType,
                        pODName: podName,
                        status: status ?? 1,
                        complTime: complTime,
                        jobDone: jobDone ?? false,
                        sourceID: 3,
                        fromCompany: fromCompany ?? string.Empty,
                        fromExtra: string.Empty,
                        fromStreet: fromAddress ?? string.Empty,
                        fromPostCode: fromPostCode,
                        toCompany: toCompany ?? string.Empty,
                        toExtra: string.Empty,
                        toStreet: toAddress ?? string.Empty,
                        toPostCode: toPostCode,
                        pickupTimeZone: pickupTimeZone,
                        deliverByTimeZone: deliverByTimeZone,
                        opID: opId
                    );

                    successCount++;
                    Log.Information($"({request.MessageId}) [StaffImport] Row {rowNumber}: Successfully created NZ job {jobNumber}");

                    // Look up the created job ID for notes and job items
                    var staffTucJobId = await Context.TucJobs
                        .Where(j => j.UcjbNumber == jobNumber)
                        .OrderByDescending(j => j.UcjbId)
                        .Select(j => j.UcjbId)
                        .FirstOrDefaultAsync();

                    if (!string.IsNullOrWhiteSpace(notes) && staffTucJobId > 0)
                    {
                        await InsertJobDeliveryNote(staffTucJobId, notes);
                    }

                    if (staffTucJobId > 0)
                    {
                        var itemCount = qty ?? 1;
                        for (int qi = 0; qi < itemCount; qi++)
                        {
                            await Context.Procedures.NET_stpBulkJobItems_InsertAsync(
                                staffTucJobId, qi, 1, weight, null, null, null,
                                null, null, null, null, null,
                                notes, null, $"{jobNumber}-{qi + 1}");
                        }
                        Log.Information($"({request.MessageId}) [StaffImport] Inserted {itemCount} job items for NZ job {jobNumber} (ID: {staffTucJobId})");
                    }
                    }
                    else
                    {
                        // US branch - ported from BulkImportHyper BulkService.cs:4391-4516.
                        // Uses DD_stpJob_InsertExceleratorAsync (91-param variant); returns
                        // the JobID via output parameter (no post-lookup like NZ). Item
                        // inserts and delivery-note insert mirror the NZ path.
                        var jobIdParam = new OutputParameter<int?>();
                        var messageParam = new OutputParameter<string>();

                        string fullFromAddress = string.IsNullOrEmpty(fromCompany)
                            ? fromAddress
                            : $"{fromCompany}, {fromAddress}";

                        await Context.Procedures.DD_stpJob_InsertExceleratorAsync(
                            bookedBy: contact ?? string.Empty,
                            fromAddress: fullFromAddress ?? string.Empty,
                            fromStreet: fromAddress ?? string.Empty,
                            fromBuilding: string.Empty,
                            fromCompany: fromCompany ?? string.Empty,
                            fromCity: fromCity ?? string.Empty,
                            fromState: fromState ?? string.Empty,
                            fromZipCode: fromZipCode ?? fromPostCode,
                            speed: string.Empty,
                            speedID: speedId,
                            toAddress: fullToAddress ?? string.Empty,
                            toStreet: toAddress ?? string.Empty,
                            toBuilding: string.Empty,
                            toCompany: toCompany ?? string.Empty,
                            toCity: toCity ?? string.Empty,
                            toState: toState ?? string.Empty,
                            toZipCode: toZipCode ?? toPostCode,
                            toAddressType: null,
                            referenceA: clientRefA ?? string.Empty,
                            referenceB: clientRefB ?? string.Empty,
                            vehicleSizeID: 2,
                            totalWeight: (weight ?? 0).ToString(),
                            totalDistance: "0",
                            @return: "0",
                            courierNotes: string.Empty,
                            clientNotes: notes ?? string.Empty,
                            pickupNotes: string.Empty,
                            deliveryNotes: string.Empty,
                            fromContactName: contact ?? string.Empty,
                            fromPhoneNumber: string.Empty,
                            toContactName: toContact ?? string.Empty,
                            toPhoneNumber: toContactPhone ?? string.Empty,
                            type: "1",
                            pickUpFrom: "1",
                            quantity: (qty ?? 1).ToString(),
                            leaveNotHome: "Signature Required",
                            jobNotificationType: null,
                            jobNotificationEmail: trackingEmail ?? string.Empty,
                            jobNotificationMobile: trackingMobile ?? string.Empty,
                            toAddressCode: string.Empty,
                            fromAddressCode: string.Empty,
                            clientID: client.Id,
                            // NULL when the row didn't supply a booking time -
                            // matches legacy WS_stpJob_Insert semantics.
                            time: bookTime,
                            hold: onHold ?? false,
                            fixedAmount: amount > 0 ? amount : (decimal?)null,
                            agentAmount: null,
                            agentCourierID: courierId,
                            fuelSurchargeAmount: null,
                            ourRef: ourRef ?? string.Empty,
                            pickUpLatitude: pickUpLatitude ?? string.Empty,
                            pickUpLongitude: pickUpLongitude ?? string.Empty,
                            deliveryLatitude: deliveryLatitude ?? string.Empty,
                            deliveryLongitude: deliveryLongitude ?? string.Empty,
                            pickup: null,
                            dropoff: null,
                            privateRes: null,
                            truckStartTime: null,
                            truckHours: null,
                            jobNumber: jobNumber,
                            storageState: null,
                            deliveryState: null,
                            sourceId: 3,
                            totalPallets: 0,
                            extraStopOffs: 0,
                            dryIceWeight: 0,
                            cubic: 0,
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
                            // Use tenant-adjusted wall clock so the SP's audit
                            // ComplTime lines up with the tenant's local day
                            // even when the host runs in a different region.
                            // Sibling call sites (JobFactory) use the same
                            // helper.
                            tenantCurrentTime: TimeZoneUtility.GetTenantNow(_httpContextAccessor),
                            dimensionsType: null,
                            cubicList: string.Empty,
                            weightList: string.Empty,
                            barcodeList: string.Empty,
                            forceTucJobPush: false,
                            jobBookingID: 0,
                            // NULL when the row didn't supply a booking time. The
                            // 1900-01-01 sentinel silently drifts from legacy which
                            // passes NULL and lets downstream defaults kick in.
                            pickupReadyDateTime: bookTime,
                            jobID: jobIdParam,
                            message: messageParam
                        );

                        successCount++;
                        Log.Information($"({request.MessageId}) [StaffImport] Row {rowNumber}: Successfully created US job {jobNumber}");

                        if (!string.IsNullOrWhiteSpace(notes) && jobIdParam.Value.HasValue && jobIdParam.Value.Value > 0)
                        {
                            await InsertJobDeliveryNote(jobIdParam.Value.Value, notes);
                        }

                        if (jobIdParam.Value.HasValue && jobIdParam.Value.Value > 0)
                        {
                            var itemCount = qty ?? 1;
                            for (int qi = 0; qi < itemCount; qi++)
                            {
                                await Context.Procedures.NET_stpBulkJobItems_InsertAsync(
                                    jobIdParam.Value.Value, qi, 1, weight, null, null, null,
                                    null, null, null, null, null,
                                    notes, null, $"{jobNumber}-{qi + 1}");
                            }
                            Log.Information($"({request.MessageId}) [StaffImport] Inserted {itemCount} job items for US job {jobNumber} (ID: {jobIdParam.Value})");
                        }
                    }
                }
                catch (Exception ex)
                {
                    string jobNumber = GetStringValue(jobData, "JobNumber", "Job Number", "jobnumber") ?? $"Row {rowNumber}";
                    Log.Error(ex, $"({request.MessageId}) [StaffImport] Error processing row {rowNumber} (Job: {jobNumber}): {ex.Message}");
                    response.FailedJobs.Add(new FailedJobDto
                    {
                        RowNumber = rowNumber,
                        JobNumber = jobNumber,
                        Error = ex.Message
                    });
                }
            }

            response.SuccessCount = successCount;
            response.FailedCount = response.FailedJobs.Count;
            response.Success = successCount > 0;

            if (response.FailedJobs.Any())
            {
                response.Messages.Add(new MessageDto { Message = $"Import completed with {response.FailedCount} failed jobs out of {rowNumber} total." });
            }
            else
            {
                response.Messages.Add(new MessageDto { Message = $"Successfully imported {successCount} jobs." });
            }

            Log.Information($"({request.MessageId})({contactId}) [StaffImport] Completed - Success: {successCount}, Failed: {response.FailedCount}");
            return response;
        }
        catch (Exception ex)
        {
            Log.Error(ex, $"({request.MessageId})({contactId}) [StaffImport] Fatal error: {ex.Message}");
            response.Messages.Add(new MessageDto { Message = $"Import failed: {ex.Message}" });
            return response;
        }
    }

    // Note: GetStringValue / GetIntValue / GetDecimalValue / GetDoubleValue /
    // GetBoolValue / GetDateValue live on the BulkImportServiceV2 partial in
    // BulkImportServiceV2.cs (they were added there ahead of this port for
    // future dictionary-shaped payloads). Reusing rather than duplicating.
}
