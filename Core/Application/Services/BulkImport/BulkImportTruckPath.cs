// Truck half of the on-demand and staff imports (card bulk-insert-truck-and-ai,
// Part A). NZ only. A row routes here when its speed has TruckJobEntry = 1 and
// is in BulkTruckSpeeds.Allowed. P2P rows stay in the existing loops, which only
// gained the per-row speed. See TruckRowCalculator for the rules and their sources.
using Microsoft.EntityFrameworkCore;
using RoutedOperations.Core.Application.Dtos.BulkImport.Address;
using RoutedOperations.Core.Application.Dtos.BulkImport.Bulk;
using RoutedOperations.Core.Application.Utilities;
using RoutedOperations.Core.Domain.Despatch;
using Serilog;

namespace RoutedOperations.Core.Application.Services.BulkImport;

public partial class BulkImportServiceV2
{
    private sealed record TruckSplit(
        List<BulkImportJobCreateDto> P2PRows,
        List<BulkImportJobCreateDto> TruckRows,
        List<BulkImportJobCreateDto> Rejected,
        List<string> Warnings);

    private sealed record TruckRunResult(int Created, List<(int RowNo, string Error)> Failed, List<string> Warnings);

    private sealed record TruckPlan(List<TruckInsertRow> Ready, Dictionary<int, TruckPreflightRow> Preflight, List<TruckRowPlan> Plans);

    // Splits a wizard request. A file with no Speed column, a P2P batch speed and
    // no truck defaults returns here after one query with every row in P2PRows,
    // in order.
    private async Task<TruckSplit> SplitTruckRows(BulkImportRequest request)
    {
        var jobs = request.Jobs!.ToList();
        var split = new TruckSplit(new(), new(), new(), new());
        bool anyRowSpeed = jobs.Any(j => j.SpeedId.HasValue || !string.IsNullOrWhiteSpace(j.Speed));
        bool batchIsTruck = await Context.TucJobTypes
            .AnyAsync(t => t.UcjtId == request.SpeedId && t.TruckJobEntry == true);

        if (!anyRowSpeed && !batchIsTruck && request.TruckDefaults == null)
        {
            split.P2PRows.AddRange(jobs);
            return split;
        }

        var speeds = await ClientSpeedCatalog.LoadAsync(Context, request.ClientId);
        var truckSpeeds = await Context.TucJobTypes
            .Where(t => t.TruckJobEntry == true)
            .Select(t => new ClientSpeed(t.UcjtId, t.UcjtName, t.ShortName, t.SystemName, true))
            .ToListAsync();
        ClientSpeed? Resolve(BulkImportJobCreateDto j, IReadOnlyList<ClientSpeed> list) =>
            j.SpeedId.HasValue ? list.FirstOrDefault(s => s.Id == j.SpeedId.Value) : ClientSpeedCatalog.Match(list, j.Speed);

        // UC #881 option B (Kevin). A point-to-point file (no row names a truck
        // speed, not even one the client lacks, the batch speed is not a truck and
        // no truck defaults) books an unknown Speed on the batch speed, as it did
        // before the wizard sent the column. Anywhere else an unknown name is
        // refused, because a wrong speed could book a truck as a van.
        bool p2pFile = !batchIsTruck && request.TruckDefaults == null
            && !jobs.Any(j => Resolve(j, truckSpeeds) != null);
        // Mirrors the validator, which skips its size caps only for an on-demand
        // request carrying TruckDefaults; otherwise it has already applied them.
        bool validatorSkippedCaps = request.TruckDefaults != null
            && string.Equals(request.JobType, "ondemand", StringComparison.OrdinalIgnoreCase);

        foreach (var job in jobs)
        {
            bool rowHasSpeed = job.SpeedId.HasValue || !string.IsNullOrWhiteSpace(job.Speed);
            ClientSpeed? rowSpeed = null;
            if (rowHasSpeed)
            {
                rowSpeed = Resolve(job, speeds);
                if (rowSpeed == null && p2pFile && request.SpeedId > 0)
                {
                    split.Warnings.Add($"Job {job.JobNumber}: Speed '{job.Speed ?? job.SpeedId?.ToString()}' is not available for this client; the default speed was used.");
                    job.SpeedId = null;
                }
                else if (rowSpeed == null)
                {
                    job.ErrorMessage = $"Speed {job.Speed ?? job.SpeedId?.ToString()} is not available for this client.";
                    job.TruckRejected = true;
                    split.Rejected.Add(job);
                    continue;
                }
                else
                {
                    job.SpeedId = rowSpeed.Id;
                }
            }

            int speedId = job.SpeedId ?? request.SpeedId;
            bool isTruck = rowSpeed?.TruckJobEntry ?? batchIsTruck;
            if (!isTruck)
            {
                var overCap = validatorSkippedCaps ? DimensionCapError(job) : null;
                if (overCap != null)
                {
                    job.ErrorMessage = overCap;
                    job.TruckRejected = true;
                    split.Rejected.Add(job);
                }
                else
                {
                    split.P2PRows.Add(job);
                }
                continue;
            }

            var refusal = TruckSpeedRefusal(speedId, speeds);
            if (refusal != null)
            {
                job.ErrorMessage = refusal;
                job.TruckRejected = true;
                split.Rejected.Add(job);
                continue;
            }
            job.SpeedId = speedId;
            split.TruckRows.Add(job);
        }
        return split;
    }

    // Truck pallets legitimately exceed the P2P caps (prod job 26448453 has a
    // 180 cm pallet), so the validator skips its caps once a request carries
    // TruckDefaults. A P2P row in that same file still has to meet them.
    private static string? DimensionCapError(BulkImportJobCreateDto job)
    {
        if (job.Length > 240) return "Length must be 240 or less on a non-truck job.";
        if (job.Width > 120) return "Width must be 120 or less on a non-truck job.";
        if (job.Height > 150) return "Height must be 150 or less on a non-truck job.";
        if (P2PItemCalculator.RowWeight(job.Weight, job.TotalWeight, job.Quantity).PerPallet > 1000) return "Weight must be 1000 or less on a non-truck job.";
        return null;
    }

    private static string? TruckSpeedRefusal(int speedId, IReadOnlyList<ClientSpeed> speeds)
    {
        if (!BulkTruckSpeeds.Allowed.Contains(speedId))
            return $"Speed {speeds.FirstOrDefault(s => s.Id == speedId)?.Name ?? speedId.ToString()} cannot be bulk imported yet. Book this job on the booking page.";
        if (speeds.All(s => s.Id != speedId))
            return $"Speed {speedId} is not available for this client.";
        return null;
    }

    private static void ApplyTruckDefaults(BulkImportJobCreateDto job, BulkTruckDefaults? d)
    {
        if (d == null) return;
        job.PalletType = string.IsNullOrWhiteSpace(job.PalletType) ? d.PalletType : job.PalletType;
        job.TailLiftPickup ??= d.TailLiftPickup;
        job.TailLiftDropoff ??= d.TailLiftDropoff;
        job.Residential ??= d.Residential;
        job.DangerousGoods ??= d.DangerousGoods;
        job.DgClass ??= d.DgClass;
        job.DgDocument ??= d.DgDocument;
    }

    // On-demand wizard rows. Returns how many were created, and marks the rest.
    private async Task<TruckRunResult> RunWizardTruckRows(
        int contactId, BulkImportRequest request, List<BulkImportJobCreateDto> rows, DateTime bookDateTime, int? opId, string? podName)
    {
        var inputs = await BuildWizardTruckInputs(contactId, request, rows, bookDateTime, opId, podName);
        var result = await RunTruckRows(inputs, request.MessageId);
        foreach (var (rowNo, error) in result.Failed)
        {
            rows[rowNo].ErrorMessage = error;
            rows[rowNo].TruckRejected = true;
        }
        return result;
    }

    // Shared with the preview. The pickup geocode is in here because it can move
    // the pickup suburb, and so the price: UTL_fncSuburb_FromLocation in the
    // preflight overrides the typed suburb when coordinates are present.
    private async Task<List<TruckRowInput>> BuildWizardTruckInputs(
        int contactId, BulkImportRequest request, List<BulkImportJobCreateDto> rows, DateTime bookDateTime, int? opId, string? podName)
    {
        await GeocodeTruckPickups(rows, request.MessageId, contactId);

        var couriers = await TruckCourierIds(rows.Select(j => j.CourierCode));
        var completedAt = request.ImportAsCompleted ? TimeZoneUtility.GetTenantNow(_httpContextAccessor) : (DateTime?)null; // #881 F3
        return rows.Select((job, i) =>
        {
            ApplyTruckDefaults(job, request.TruckDefaults);
            return new TruckRowInput
            {
                Job = job,
                ClientId = request.ClientId,
                SpeedId = job.SpeedId ?? request.SpeedId,
                BookDateTime = job.ResolvedBookDateTime ?? bookDateTime, // the row's own date first (#881)
                Completed = request.ImportAsCompleted,
                PodName = podName,
                CompletedTime = completedAt,
                OpId = opId,
                LoggedInContactId = contactId,
                CourierId = string.IsNullOrWhiteSpace(job.CourierCode) ? null
                    : couriers.GetValueOrDefault(job.CourierCode.Trim().ToUpperInvariant()),
                PickupTimeZone = GetTimeZoneCode(job.FromLatitude, job.FromLongitude),
                DeliverByTimeZone = GetTimeZoneCode(job.ToLatitude, job.ToLongitude),
                RowNo = i,
            };
        }).ToList();
    }

    // The lookup the P2P loop runs per row, made once for every pickup that still
    // needs coordinates. Geocode keeps its input order and one output per input.
    // A pickup it cannot place keeps its typed suburb, as on the P2P path.
    private async Task GeocodeTruckPickups(List<BulkImportJobCreateDto> rows, Guid messageId, int contactId)
    {
        var pickups = rows
            .Where(j => string.IsNullOrWhiteSpace(j.FromLatitude) || string.IsNullOrWhiteSpace(j.FromLongitude))
            .Where(j => !string.IsNullOrWhiteSpace(j.FromAddress) && !string.IsNullOrWhiteSpace(j.FromSuburb))
            .GroupBy(j => $"{j.FromAddress}|{j.FromSuburb}|{j.FromPostCode}".ToUpperInvariant())
            .Select(g => g.ToList())
            .ToList();
        if (pickups.Count == 0) return;

        try
        {
            var geocoded = await _addressService.Geocode(new GeocodeRequest
            {
                MessageId = messageId,
                Addresses = pickups.Select(g => new AddressDto
                {
                    Address = g[0].FromAddress,
                    Suburb = g[0].FromSuburb,
                    PostCode = g[0].FromPostCode,
                }).ToList(),
            });
            var found = geocoded.Addresses?.ToList();
            if (!geocoded.Success || found == null)
            {
                Log.Warning("({MessageId})({ContactId}) [TruckImport] Pickup geocode failed for {Count} pickups", messageId, contactId, pickups.Count);
                return;
            }
            foreach (var (group, address) in pickups.Zip(found))
            {
                foreach (var job in group)
                {
                    job.FromLatitude = address.Latitude;
                    job.FromLongitude = address.Longitude;
                    if (string.IsNullOrWhiteSpace(job.FromPostCode))
                        job.FromPostCode = address.SuggestedPostCode ?? address.PostCode;
                    else if (!string.IsNullOrWhiteSpace(address.SuggestedPostCode))
                        job.FromPostCode = address.SuggestedPostCode;
                }
            }
        }
        catch (Exception ex)
        {
            Log.Error(ex, "({MessageId})({ContactId}) [TruckImport] Pickup geocode failed", messageId, contactId);
        }
    }

    private async Task<Dictionary<string, int>> TruckCourierIds(IEnumerable<string?> codes)
    {
        var wanted = codes.Where(c => !string.IsNullOrWhiteSpace(c)).Select(c => c!.Trim().ToUpperInvariant()).Distinct().ToList();
        if (wanted.Count == 0) return new();
        var found = await Context.TucCouriers
            .Where(c => wanted.Contains(c.Code.ToUpper()) && c.Active)
            .Select(c => new { c.Code, c.UccrId })
            .ToListAsync();
        return found.GroupBy(c => c.Code.ToUpperInvariant()).ToDictionary(g => g.Key, g => g.First().UccrId);
    }

    // Shared by the wizard and staff import: validate, preflight, finalise, insert.
    private async Task<TruckRunResult> RunTruckRows(IReadOnlyList<TruckRowInput> inputs, Guid messageId)
    {
        var failed = new List<(int RowNo, string Error)>();
        var warnings = new List<string>();
        if (inputs.Count == 0) return new TruckRunResult(0, failed, warnings);

        try
        {
            var ready = (await PlanTruckRows(inputs, failed)).Ready;

            int created = 0;
            if (ready.Count > 0)
            {
                var outcomes = await _truckInserter.InsertAsync(ready, TimeZoneUtility.GetTenantNow(_httpContextAccessor));
                foreach (var outcome in outcomes)
                {
                    if (outcome.JobId.HasValue)
                    {
                        created++;
                        if (outcome.Warning != null)
                            warnings.Add($"Job {ready.First(r => r.RowNo == outcome.RowNo).ucjbNumber}: {outcome.Warning}");
                    }
                    else
                    {
                        failed.Add((outcome.RowNo, outcome.Error!));
                    }
                }
            }
            Log.Information("({MessageId}) [TruckImport] {Created} created, {Failed} failed of {Total}", messageId, created, failed.Count, inputs.Count);
            return new TruckRunResult(created, failed, warnings);
        }
        catch (Exception ex)
        {
            // A preflight failure means no row was priced, so none was written.
            Log.Error(ex, "({MessageId}) [TruckImport] Truck batch failed before insert", messageId);
            FailEveryOtherRow(inputs, failed, ex);
            return new TruckRunResult(0, failed, warnings);
        }
    }

    private void FailEveryOtherRow(IReadOnlyList<TruckRowInput> inputs, List<(int RowNo, string Error)> failed, Exception ex)
    {
        var reason = BuildFriendlyJobError(ex);
        var seen = failed.Select(f => f.RowNo).ToHashSet();
        failed.AddRange(inputs.Where(i => !seen.Contains(i.RowNo)).Select(i => (i.RowNo, reason)));
    }

    // Everything up to the insert: row rules, one preflight, price. Writes nothing.
    // The preview stops here, so its price is the amount the insert would be given.
    private async Task<TruckPlan> PlanTruckRows(IReadOnlyList<TruckRowInput> inputs, List<(int RowNo, string Error)> failed)
    {
        var clients = await _truckPreflight.LoadClientsAsync(inputs.Select(i => i.ClientId).Distinct().ToList());
        var stockByClient = new Dictionary<int, List<TblGssstockSize>>();
        var plans = new List<TruckRowPlan>();
        var clientOf = new Dictionary<int, TruckClientFacts>();
        var numbersSeen = new HashSet<string>(StringComparer.OrdinalIgnoreCase);

        foreach (var input in inputs)
        {
            if (!clients.TryGetValue(input.ClientId, out var client))
            {
                failed.Add((input.RowNo, "Invalid client."));
                continue;
            }
            var number = input.Job.JobNumber?.Trim() ?? "";
            if (!numbersSeen.Add(number))
            {
                failed.Add((input.RowNo, $"Job number {number} appears more than once in this file."));
                continue;
            }

            if (!string.IsNullOrWhiteSpace(input.Job.PalletType))
            {
                if (!stockByClient.TryGetValue(input.ClientId, out var stock))
                {
                    stock = await Context.TblGssstockSizes.AsNoTracking()
                        .Where(s => !s.ClientId.HasValue || s.ClientId == input.ClientId)
                        .OrderByDescending(s => s.ClientId.HasValue)
                        .ToListAsync();
                    stockByClient[input.ClientId] = stock;
                }
                var size = stock.FirstOrDefault(s => string.Equals(s.Name?.Trim(), input.Job.PalletType.Trim(), StringComparison.OrdinalIgnoreCase));
                // Row values win (spec A3). Weight only defaults when the row
                // gave neither Weight nor Total weight. A name that is not a
                // stock size still goes on the items, with the row's own values.
                if (size != null)
                {
                    if (input.Job.Length <= 0) input.Job.Length = (decimal)size.Length;
                    if (input.Job.Width <= 0) input.Job.Width = (decimal)size.Width;
                    if (input.Job.Height <= 0) input.Job.Height = (decimal)size.Height;
                    if (input.Job.Weight <= 0 && input.Job.TotalWeight is not > 0) input.Job.Weight = (decimal)size.Weight;
                }
            }

            var prepared = TruckRowCalculator.Prepare(input, client);
            if (prepared.Plan == null)
            {
                failed.Add((input.RowNo, prepared.Error!));
                continue;
            }
            plans.Add(prepared.Plan);
            clientOf[input.RowNo] = client;
        }

        var preflight = (await _truckPreflight.RunAsync(plans)).ToDictionary(p => p.RowNo);
        var ready = new List<TruckInsertRow>();
        foreach (var plan in plans)
        {
            if (!preflight.TryGetValue(plan.Input.RowNo, out var pre))
            {
                failed.Add((plan.Input.RowNo, "The truck rate check returned nothing for this row."));
                continue;
            }
            var finalized = TruckRowCalculator.Finalize(plan, pre, clientOf[plan.Input.RowNo]);
            if (finalized.Row == null)
                failed.Add((plan.Input.RowNo, finalized.Error!));
            else
                ready.Add(finalized.Row);
        }

        return new TruckPlan(ready, preflight, plans);
    }
}
