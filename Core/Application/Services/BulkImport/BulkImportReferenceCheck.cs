// The server half of the client reference check. ClientReferenceRule has the rule;
// this loads what it needs. Used by New Import on-demand, Staff Import, the truck
// preview and the /reference-check endpoint. Routed and scheduled imports do not call it.
using Microsoft.EntityFrameworkCore;
using RoutedOperations.Core.Application.Dtos.BulkImport.Bulk;
using Serilog;

namespace RoutedOperations.Core.Application.Services.BulkImport;

public partial class BulkImportServiceV2
{
    /// <summary>
    /// What the import would refuse for these rows, before anything is booked.
    /// A client the caller may not act for reads as not found, so this cannot be
    /// used to look at another client's reference settings.
    /// </summary>
    public async Task<BulkReferenceCheckResponse> CheckReferences(int contactId, BulkReferenceCheckRequest request)
    {
        var response = new BulkReferenceCheckResponse(request.MessageId);
        var rows = request.Rows ?? new List<BulkReferenceCheckRow>();

        static string CodeKey(string? code) => code?.Trim().ToUpperInvariant() ?? "";
        bool HasId(BulkReferenceCheckRow r) => r.ClientId is > 0;
        var ids = rows.Where(HasId).Select(r => r.ClientId!.Value).Distinct().ToList();
        var codes = rows.Where(r => !HasId(r)).Select(r => CodeKey(r.ClientCode)).Where(c => c.Length > 0).Distinct().ToList();

        var clients = await Context.TucClients.AsNoTracking()
            .Where(_scope.CanActFor(contactId))
            .Where(c => ids.Contains(c.UcclId) || codes.Contains(c.UcclCode.ToUpper()))
            .Select(c => new { c.UcclId, c.UcclCode })
            .ToListAsync();
        var byId = clients.Select(c => c.UcclId).ToHashSet();
        var byCode = clients.GroupBy(c => CodeKey(c.UcclCode)).ToDictionary(g => g.Key, g => g.First().UcclId);

        // Indexed by position, so a repeated RowNumber cannot collide.
        var known = new List<ReferenceCheckRow>();
        var notFound = new Dictionary<int, string>();
        for (int i = 0; i < rows.Count; i++)
        {
            var row = rows[i];
            int? clientId = HasId(row)
                ? (byId.Contains(row.ClientId!.Value) ? row.ClientId : null)
                : byCode.TryGetValue(CodeKey(row.ClientCode), out var found) ? found : null;
            if (clientId == null)
                notFound[i] = $"Client not found. ClientID: {row.ClientId}, ClientCode: {row.ClientCode}";
            else
                known.Add(new ReferenceCheckRow(i, clientId.Value, row.ReferenceA ?? "", row.ReferenceB ?? ""));
        }

        var refusals = await ReferenceRefusals(known);
        for (int i = 0; i < rows.Count; i++)
        {
            if (notFound.TryGetValue(i, out var error) || refusals.TryGetValue(i, out error))
                response.Errors.Add(new BulkReferenceCheckError { RowNumber = rows[i].RowNumber, Error = error });
        }

        response.Success = true;
        Log.Information("({MessageId}) [ReferenceCheck] {Rows} rows, {Refused} refused", request.MessageId, rows.Count, response.Errors.Count);
        return response;
    }

    // Refusal text by RowNo. The list query runs only for rows whose client has a
    // list. Pass knownClients when calling per row, so the flags load once per client.
    private async Task<Dictionary<int, string>> ReferenceRefusals(
        IReadOnlyList<ReferenceCheckRow> rows, Dictionary<int, TruckClientFacts>? knownClients = null)
    {
        var refusals = new Dictionary<int, string>();
        if (rows.Count == 0) return refusals;

        var facts = knownClients ?? new Dictionary<int, TruckClientFacts>();
        var toLoad = rows.Select(r => r.ClientId).Distinct().Where(id => !facts.ContainsKey(id)).ToList();
        if (toLoad.Count > 0)
        {
            var loaded = await _truckPreflight.LoadClientsAsync(toLoad);
            foreach (var id in toLoad)
                if (loaded.TryGetValue(id, out var client)) facts[id] = client;
        }

        var listRows = rows
            .Where(r => facts.TryGetValue(r.ClientId, out var c) && (c.ReferenceADefineList || c.ReferenceBDefineList))
            .ToList();
        var lists = listRows.Count == 0 ? null : await _truckPreflight.ReferenceListsAsync(listRows);

        foreach (var row in rows)
        {
            if (!facts.TryGetValue(row.ClientId, out var client)) continue;
            ReferenceListResult? list = null;
            lists?.TryGetValue(row.RowNo, out list);
            var refusal = ClientReferenceRule.Refusal(client, row.ReferenceA, row.ReferenceB, list?.ReferenceAInList ?? true, list?.ReferenceBInList ?? true);
            if (refusal != null) refusals[row.RowNo] = refusal;
        }
        return refusals;
    }

    // Takes refused rows out of request.Jobs, with their reason on ErrorMessage.
    // TruckRejected is what sends a row to the wizard's summary rather than its km
    // review, so it is set here on non-truck rows too.
    private async Task<List<BulkImportJobCreateDto>> SplitOutReferenceRefusals(BulkImportRequest request)
    {
        var jobs = (request.Jobs ?? Enumerable.Empty<BulkImportJobCreateDto>()).ToList();
        // The procs receive '' for a missing reference, never NULL, so nothing here
        // can inherit the proc's ISNULL(@ReferenceA, ClientReferenceA) default.
        var refusals = await ReferenceRefusals(jobs
            .Select((job, i) => new ReferenceCheckRow(i, request.ClientId, job.ClientRefA ?? "", job.ClientRefB ?? ""))
            .ToList());

        var refused = new List<BulkImportJobCreateDto>();
        var kept = new List<BulkImportJobCreateDto>();
        for (int i = 0; i < jobs.Count; i++)
        {
            if (refusals.TryGetValue(i, out var error))
            {
                jobs[i].ErrorMessage = error;
                jobs[i].TruckRejected = true;
                refused.Add(jobs[i]);
            }
            else
            {
                kept.Add(jobs[i]);
            }
        }
        request.Jobs = kept;
        return refused;
    }
}
