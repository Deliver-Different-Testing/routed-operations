using Microsoft.AspNetCore.Http;
using RoutedOperations.Core.Application.Security;
using Microsoft.EntityFrameworkCore;
using RoutedOperations.Core.Application.Dtos.BulkImport.Clients;
using RoutedOperations.Core.Application.Dtos.BulkImport.Common;
using RoutedOperations.Core.Application.Services.Routing;
using RoutedOperations.Core.Application.Utilities;
using RoutedOperations.Core.Domain;
using RoutedOperations.Core.Domain.Despatch;
using RoutedOperations.Core.Domain.Models;
using Serilog;

namespace RoutedOperations.Core.Application.Services.BulkImport;

// Ported from BulkImportHyper. Wraps every read against the client table
// (tucClient) with the multi-tenant client-contact assignment filter so
// operators see only the clients they've been granted. Internal staff bypass
// the filter for the search endpoint (they'd otherwise see nothing since they
// aren't in TucClientContacts).
public class ClientService(
    IDbContextFactory<DynamicDespatchDbContext> contextFactory,
    IHttpContextAccessor httpContextAccessor,
    TenantScopedCache cache) : BaseService(contextFactory)
{
    private readonly IHttpContextAccessor httpContextAccessor = httpContextAccessor;

    // 5-minute sliding TTL. Clients are edited via ClientManager (different
    // app - we cannot invalidate on write); acceptable staleness ceiling.
    private static readonly TimeSpan ClientsTtl = TimeSpan.FromMinutes(5);

    /// <summary>
    /// Geocode a client's site address (schedule-origin spec 4.5). Preview by
    /// default; writes tucClient.Latitude / Longitude only when the caller
    /// repeats the call with Confirm set.
    ///
    /// This is Routed Operations' first client WRITE path. Until now nothing
    /// in this app or ClientManager wrote these columns; only AdminManager
    /// did, from a Google Maps autocomplete on its client form. AdminManager
    /// is being retired, which is why the write lands here.
    ///
    /// Never overwrites silently: the response carries the previous values so
    /// the caller can show what is about to change, and the write is logged
    /// with who did it.
    /// </summary>
    public async Task<ClientGeocodeResponse> GeocodeSiteAsync(
        int clientId, ClientGeocodeRequest request, HereGeocodeService geocoder, string actor)
    {
        var client = await Context.TucClients.FirstOrDefaultAsync(c => c.UcclId == clientId)
            ?? throw new InvalidOperationException($"Client {clientId} not found.");

        var address = string.IsNullOrWhiteSpace(request?.Address)
            ? client.UcclAddress?.Trim()
            : request.Address.Trim();
        if (string.IsNullOrWhiteSpace(address))
        {
            return new ClientGeocodeResponse(
                clientId, client.UcclName, null, null, null, null,
                (double?)client.Latitude, (double?)client.Longitude, false,
                "This client has no site address to geocode. Add one first, or pass an address to use.");
        }

        var countryCode = httpContextAccessor.HttpContext?.User.Claims
            .FirstOrDefault(x => x.Type == "CountryCode")?.Value;
        var hit = await geocoder.GeocodeAsync(address, countryCode);
        var previousLat = (double?)client.Latitude;
        var previousLng = (double?)client.Longitude;

        if (hit == null)
        {
            return new ClientGeocodeResponse(
                clientId, client.UcclName, address, null, null, null,
                previousLat, previousLng, false,
                "No match for that address. Try a more complete one.");
        }

        if (!(request?.Confirm ?? false))
        {
            return new ClientGeocodeResponse(
                clientId, client.UcclName, address, hit.Lat, hit.Lng, hit.FormattedAddress,
                previousLat, previousLng, false,
                "Preview only. Send the same call with confirm = true to save these coordinates.");
        }

        client.Latitude = (decimal)hit.Lat;
        client.Longitude = (decimal)hit.Lng;
        await Context.SaveChangesAsync();
        Serilog.Log.Information(
            "Client site geocoded: clientId={ClientId} by={Actor} address={Address} "
            + "({PrevLat},{PrevLng}) -> ({Lat},{Lng})",
            clientId, actor, address, previousLat, previousLng, hit.Lat, hit.Lng);

        return new ClientGeocodeResponse(
            clientId, client.UcclName, address, hit.Lat, hit.Lng, hit.FormattedAddress,
            previousLat, previousLng, true,
            "Site coordinates saved.");
    }

    public Task<ClientsResponse> Get(Guid messageId, int contactId) =>
        cache.GetOrSetAsync($"clients:contact:{contactId}", ClientsTtl,
            () => LoadClientsAsync(messageId, contactId));

    private async Task<ClientsResponse> LoadClientsAsync(Guid messageId, int contactId)
    {
        // Get tenant type from JWT claims - default to US tenant
        var countryCode = httpContextAccessor.HttpContext?.User.Claims.FirstOrDefault(x => x.Type == "CountryCode")?.Value;
        var usa = Country.Us.GetDescription();
        var isUsTenant = countryCode?.ToUpper().Equals(usa) ?? true;

        // Check if user is internal staff - internal staff use search endpoint instead
        var isInternal = IsInternalUser();

        if (isInternal)
        {
            return new ClientsResponse(messageId)
            {
                Success = true,
                IsInternal = true,
                IsUsTenant = isUsTenant,
                Clients = new List<ClientDto>()
            };
        }

        return new ClientsResponse(messageId)
        {
            Success = true,
            IsInternal = false,
            IsUsTenant = isUsTenant,
            Clients = await Context.TucClients
                .AsNoTracking()
                .Where(c => c.UcclActive
                    && (c.TucClientContacts.Any(x => x.UcctId == contactId && x.Active) || c.TblClientContacts.Any(x => x.ContactId == contactId && x.Contact.Active)))
                .Select(x => new ClientDto
                {
                    Id = x.UcclId,
                    Code = x.UcclCode,
                    Name = x.UcclName,
                    IsUsTenant = isUsTenant
                })
                .ToListAsync()
        };
    }

    public async Task<ClientsResponse> Search(Guid messageId, int contactId, string search)
    {
        var countryCode = httpContextAccessor.HttpContext?.User.Claims.FirstOrDefault(x => x.Type == "CountryCode")?.Value;
        var usa = Country.Us.GetDescription();
        var isUsTenant = countryCode?.ToUpper().Equals(usa) ?? true;

        var isInternal = IsInternalUser();
        var searchLower = search.ToLower();

        return new ClientsResponse(messageId)
        {
            Success = true,
            IsInternal = isInternal,
            Clients = await Context.TucClients
                .AsNoTracking()
                .Where(c => c.UcclActive
                    && (isInternal || c.TucClientContacts.Any(x => x.UcctId == contactId && x.Active) || c.TblClientContacts.Any(x => x.ContactId == contactId && x.Contact.Active))
                    && (c.UcclName.ToLower().Contains(searchLower) || c.UcclCode.ToLower().Contains(searchLower)))
                .OrderBy(x => x.UcclName)
                .Take(20)
                .Select(x => new ClientDto
                {
                    Id = x.UcclId,
                    Code = x.UcclCode,
                    Name = x.UcclName,
                    IsUsTenant = isUsTenant
                })
                .ToListAsync()
        };
    }

    private bool IsInternalUser()
    {
        // Staff = ClientTypeId 4/5, not the "Internal" billing-flag claim
        // (Steve 2026-10-08: ucclInternal carries no permission).
        return httpContextAccessor.HttpContext?.User is { } user && CallerLane.IsStaff(user);
    }

    public async Task<ClientSettingsResponse> GetSettings(Guid messageId, int contactId, int clientId, bool isUsTenant = false)
    {
        // Get tenant type from JWT claims (override the parameter) - default to US tenant
        var countryCode = httpContextAccessor.HttpContext?.User.Claims.FirstOrDefault(x => x.Type == "CountryCode")?.Value;
        var usa = Country.Us.GetDescription();
        isUsTenant = countryCode?.ToUpper().Equals(usa) ?? true;

        var response = new ClientSettingsResponse(messageId);

        // Check if user is internal staff - internal staff can access any client settings
        var isInternal = IsInternalUser();

        var clientSettings = await Context.TucClients
                .Where(c => c.UcclId == clientId && c.UcclActive
                    && (isInternal || c.TucClientContacts.Any(x => x.UcctId == contactId && x.Active) || c.TblClientContacts.Any(x => x.ContactId == contactId && x.Contact.Active)))
                .Select(x => new ClientSettingsDto
                {
                    Id = x.UcclId,
                    Code = x.UcclCode,
                    Name = x.UcclName,
                    JobPrefix = x.JobPrefix.Trim().ToUpper(),
                    Contacts = x.TblClientContacts
                        .Where(c => c.Contact.Active && c.Contact.UcctFirstname.Trim().Length > 0 && c.Contact.UcctSurname.Trim().Length > 0)
                        .Select(c => new ContactDto
                        {
                            FirstName = c.Contact.UcctFirstname,
                            Surname = c.Contact.UcctSurname
                        }).ToList(),
                    Schedules = Context.TblBulkRunSchedules
                        .Where(s => (!s.ClientId.HasValue || s.ClientId == x.UcclId))
                        .Select(s => new ScheduleDto()
                        {
                            Id = s.BulkRunScheduleId,
                            Name = s.Name,
                            DepotId = s.Region ?? 0,
                            Speed = s.SpeedId == null ? null : new SpeedDto()
                            {
                                Id = s.SpeedId.Value,
                                Name = null
                            },
                            DayOfWeek = s.DayOfWeek ?? 0,
                            StartTime = s.StartTime ?? TimeSpan.Zero,
                            CutoffHours = s.CutoffHours
                        }).ToList(),
                    StockSizes = Context.TblGssstockSizes
                        .Where(s => !s.ClientId.HasValue || s.ClientId == x.UcclId)
                        .OrderBy(m => m.Sequence)
                        .Select(m => new StockSizeDto()
                        {
                            Name = m.Name,
                            Width = m.Width,
                            Length = m.Length,
                            Height = m.Height,
                            Weight = m.Weight
                        }).ToList(),
                    IsUsTenant = isUsTenant,
                    ReferenceAMandatory = x.ReferenceAmandatory,
                    ReferenceAMessage = x.ReferenceAmessage,
                    ReferenceBMandatory = x.ReferenceBmandatory,
                    ReferenceBMessage = x.ReferenceBmessage,
                    CreateBulkHomeDeliveryPickup = x.CreateBulkHomeDeliveryPickup ?? false
                })
                .FirstOrDefaultAsync();

        if (clientSettings == null)
            return BulkImportResponseUtility.AddMessageAndReturnResponse(response, "Invalid client or contact.");

        // Two-tier speed lookup: first try client-specific speeds, then fall back to default speeds
        var clientSpeeds = await Context.TblClientAvailableSpeeds
            .Where(s => s.ClientId == clientId && s.Active && s.WebVisible == true)
            .OrderBy(s => s.Speed.UcjtName)
            .Select(s => new SpeedDto()
            {
                Id = s.Speed.UcjtId,
                Name = s.Speed.UcjtName
            })
            .ToListAsync();

        if (clientSpeeds.Any())
        {
            clientSettings.Speeds = clientSpeeds;
        }
        else
        {
            // Fallback to default speeds with Name = 'API - Web Integration' and Active = 1
            clientSettings.Speeds = await Context.TblClientDefaultAvailableSpeeds
                .Where(s => s.Name == "API - Web Integration" && s.Active)
                .OrderBy(s => s.Speed.UcjtName)
                .Select(s => new SpeedDto()
                {
                    Id = s.Speed.UcjtId,
                    Name = s.Speed.UcjtName
                })
                .ToListAsync();
        }

        // Backfill Schedule.Speed.Name in a second pass. EF Core LINQ can't
        // navigate s.Speed on the TblBulkRunSchedule stub (no nav property);
        // resolve the ID -> name in-memory once we have both slices.
        var speedIds = clientSettings.Schedules
            .Where(sc => sc.Speed != null)
            .Select(sc => sc.Speed.Id)
            .Distinct()
            .ToList();
        if (speedIds.Count > 0)
        {
            var speedNames = await Context.TucJobTypes
                .Where(t => speedIds.Contains(t.UcjtId))
                .ToDictionaryAsync(t => t.UcjtId, t => t.UcjtName);
            foreach (var sc in clientSettings.Schedules)
            {
                if (sc.Speed != null && speedNames.TryGetValue(sc.Speed.Id, out var name))
                    sc.Speed.Name = name;
            }
        }

        response.Settings = clientSettings;
        response.Success = true;
        return response;
    }

    public async Task<SchedulesResponse> GetSchedulesByBookDate(int contactId, SchedulesByBookDateRequest request)
    {
        SchedulesResponse response = new SchedulesResponse(request.MessageId);

        // Convert UTC BookDate to tenant timezone
        if (request.BookDate.Kind == DateTimeKind.Utc)
        {
            request.BookDate = TimeZoneUtility.ConvertToTenantTime(request.BookDate, httpContextAccessor);
            Log.Information($"({request.MessageId})({contactId}) [GetSchedulesByBookDate] Converted BookDate from UTC to tenant timezone: {request.BookDate:yyyy-MM-dd HH:mm:ss}");
        }

        var isInternal = IsInternalUser();
        if (!isInternal && !await Context.TblClientContacts.AnyAsync(c => c.ContactId == contactId && c.ClientId == request.ClientId && c.Contact.Active && c.Client.UcclActive))
            BulkImportResponseUtility.AddMessageAndReturnResponse(response, "Invalid client.");

        var dayOfWeekShort = request.BookDate.DayOfWeek == DayOfWeek.Sunday
            ? (short)7
            : Convert.ToInt16(request.BookDate.DayOfWeek);

        var scheduleRows = await Context.TblBulkRunSchedules
            .Where(s => (!s.ClientId.HasValue || s.ClientId == request.ClientId)
                && (!s.SpeedId.HasValue || s.SpeedId == request.SpeedId)
                && (request.DepotId == 0 || s.Region == request.DepotId)
                && s.DayOfWeek == dayOfWeekShort)
            .Select(s => new
            {
                s.BulkRunScheduleId,
                s.Name,
                s.StartTime,
                s.CutoffHours,
                s.SpeedId
            })
            .ToListAsync();

        // Backfill Speed name for the schedules we kept (see GetSettings for the
        // same pattern). Second query is cheaper than a nav-property join because
        // the schedule filter already narrowed the set.
        var speedIds = scheduleRows
            .Where(s => s.SpeedId.HasValue)
            .Select(s => s.SpeedId.Value)
            .Distinct()
            .ToList();
        var speedNames = speedIds.Count == 0
            ? new Dictionary<int, string>()
            : await Context.TucJobTypes
                .Where(t => speedIds.Contains(t.UcjtId))
                .ToDictionaryAsync(t => t.UcjtId, t => t.UcjtName);

        var schedules = scheduleRows.Select(s => new ScheduleDto
        {
            Id = s.BulkRunScheduleId,
            Name = s.Name,
            StartTime = s.StartTime ?? TimeSpan.Zero,
            CutoffHours = s.CutoffHours,
            Speed = s.SpeedId == null
                ? null
                : new SpeedDto
                {
                    Id = s.SpeedId.Value,
                    Name = speedNames.TryGetValue(s.SpeedId.Value, out var n) ? n : null
                }
        }).ToList();

        var tenantNow = TimeZoneUtility.GetTenantNow(httpContextAccessor);
        Log.Information($"({request.MessageId}) [Schedule Filter] Filtering schedules by cutoff. " +
            $"ClientId: {request.ClientId}, SpeedId: {request.SpeedId}, BookDate: {request.BookDate:yyyy-MM-dd}, " +
            $"TenantNow: {tenantNow:yyyy-MM-dd HH:mm:ss}, Total Schedules: {schedules.Count()}");

        response.Schedules = schedules
            .Where(s =>
            {
                var scheduleStartTime = request.BookDate.Date.AddTicks(s.StartTime.Ticks);
                var cutoffTime = scheduleStartTime.AddHours(s.CutoffHours >= 0 ? s.CutoffHours * -1 : s.CutoffHours);
                var isValid = tenantNow < cutoffTime;

                Log.Debug($"({request.MessageId}) [Schedule Filter] Schedule '{s.Name}' (ID: {s.Id}): " +
                    $"StartTime: {s.StartTime}, CutoffHours: {s.CutoffHours}, " +
                    $"ScheduleStartTime: {scheduleStartTime:yyyy-MM-dd HH:mm:ss}, " +
                    $"CutoffTime: {cutoffTime:yyyy-MM-dd HH:mm:ss}, " +
                    $"IsValid: {isValid} (TenantNow < CutoffTime)");

                return isValid;
            })
            .ToList();

        Log.Information($"({request.MessageId}) [Schedule Filter] Filtered schedules. " +
            $"Available Schedules: {response.Schedules.Count()}");

        response.Success = true;
        return response;
    }

    public async Task<JobNumberResponse> GetJobNumber(JobNumberRequest request)
    {
        JobNumberResponse response = new JobNumberResponse(request.MessageId);

        // Serialise concurrent GetJobNumber callers on the same JobNumberId so
        // two operators can't read the same value before either increments.
        // BulkImportJobNumbers is a small config-shape table so a short
        // transaction is cheap. Bulk / staff / on-demand paths use the SP
        // sp_AssignJobNumbers (see DespatchContextBulkImportExtensions.cs)
        // which has its own DB-side lock; this endpoint is used by the
        // single-job preview only, so a scoped tx here is enough.
        await using var tx = await Context.Database.BeginTransactionAsync(System.Data.IsolationLevel.Serializable);

        var jobNumberUpdate = await Context.BulkImportJobNumbers
            .FirstOrDefaultAsync(c => c.JobNumberId == request.JobNumberId);
        if (jobNumberUpdate == null)
        {
            await tx.RollbackAsync();
            return BulkImportResponseUtility.AddMessageAndReturnResponse(response,
                $"Job number sequence {request.JobNumberId} not found.");
        }

        // JobNumberIncrement is nullable in the schema; treat NULL as "start
        // from 1" instead of NRE.
        int currentNumber = jobNumberUpdate.JobNumberIncrement ?? 0;
        int nextNumber = currentNumber + 1;
        jobNumberUpdate.JobNumberIncrement = nextNumber;

        await Context.SaveChangesAsync();
        await tx.CommitAsync();

        response.JobNumber = new List<JobNumberDto> { new JobNumberDto { JobNumber = currentNumber } };
        response.Success = true;
        return response;
    }
}
