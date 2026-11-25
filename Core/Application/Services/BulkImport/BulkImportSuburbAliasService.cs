using System.Security.Claims;
using Microsoft.Data.SqlClient;
using Microsoft.EntityFrameworkCore;
using RoutedOperations.Core.Application.Dtos.BulkImport.Common;
using RoutedOperations.Core.Application.Dtos.BulkImport.SuburbAlias;
using RoutedOperations.Core.Application.Utilities;
using RoutedOperations.Core.Domain.Despatch;
using Serilog;

namespace RoutedOperations.Core.Application.Services.BulkImport;

// #333: load / remember / forget the suburb fixes chosen in Fix Suburbs.
// D4 (Steve default): a pick is remembered for the client; tenant-wide rows
// (ClientId NULL) are read as a fallback and are only cleared by staff.
public partial class BulkImportServiceV2
{
    private async Task<bool> MayUseClientAliases(int contactId, int clientId) =>
        _scope.IsStaff
            ? await Context.TucClients.AnyAsync(c => c.UcclId == clientId)
            : await _scope.CanActForClientAsync(Context, contactId, clientId);

    public async Task<SuburbAliasesResponse> GetSuburbAliases(int contactId, int clientId, Guid messageId)
    {
        var response = new SuburbAliasesResponse(messageId);
        if (!await MayUseClientAliases(contactId, clientId))
            return BulkImportResponseUtility.AddMessageAndReturnResponse(response, "Invalid client.");

        var rows = (await BulkSuburbAliases.LoadAsync(Context, new[] { clientId }))
            .OrderBy(a => a.ClientId == null ? 1 : 0)
            .ThenBy(a => a.SuburbAliasId)
            .ToList();
        response.Aliases = await ToDtos(rows);
        response.Success = true;
        return response;
    }

    public async Task<SuburbAliasResponse> RememberSuburbAlias(int contactId, RememberSuburbAliasRequest request)
    {
        var response = new SuburbAliasResponse(request.MessageId);
        // Aliases are only read on NZ (the routed import and Staff Import
        // load them for NZ only), so a US row would never be used.
        if (!IsNzTenant())
            return BulkImportResponseUtility.AddMessageAndReturnResponse(response, "This endpoint is only available for NZ tenants");
        if (!await MayUseClientAliases(contactId, request.ClientId))
            return BulkImportResponseUtility.AddMessageAndReturnResponse(response, "Invalid client.");
        var rawSuburb = BulkSuburbAliases.Normalise(request.RawSuburb);
        if (rawSuburb.Length == 0 || rawSuburb.Length > 100)
            return BulkImportResponseUtility.AddMessageAndReturnResponse(response, "Invalid sheet suburb.");
        if (!await Context.TucSuburbs.AnyAsync(s => s.UcsuId == request.SuburbId))
            return BulkImportResponseUtility.AddMessageAndReturnResponse(response, "Invalid suburb.");
        var rawPostCode = BulkSuburbAliases.NormalisePostCode(request.RawPostCode, isNz: true);

        // The grant is SELECT / INSERT / DELETE, so a changed pick replaces the row.
        var existing = await Context.TblBulkSuburbAliases
            .Where(a => a.ClientId == request.ClientId && a.RawSuburb == rawSuburb && a.RawPostCode == rawPostCode)
            .ToListAsync();
        Context.TblBulkSuburbAliases.RemoveRange(existing);
        var user = _httpContextAccessor.HttpContext?.User;
        var row = new TblBulkSuburbAlias
        {
            ClientId = request.ClientId,
            RawSuburb = rawSuburb,
            RawPostCode = rawPostCode,
            SuburbId = request.SuburbId,
            CreatedBy = Truncate(user?.FindFirstValue(ClaimTypes.Email) ?? user?.FindFirstValue(ClaimTypes.Name) ?? contactId.ToString(), 100),
            Created = DateTime.UtcNow,
        };
        Context.TblBulkSuburbAliases.Add(row);
        try
        {
            await Context.SaveChangesAsync();
        }
        catch (DbUpdateException ex) when (ex.GetBaseException() is SqlException { Number: 2601 or 2627 })
        {
            // A concurrent save of the same sheet value won the unique index
            // UX_tblBulkSuburbAlias_Client_Suburb_PostCode: the fix is
            // remembered, so return that row. Any other failure (deadlock,
            // timeout) rethrows: its rolled-back delete leaves the OLD pick
            // in place, which must not be reported as the new one.
            Context.ChangeTracker.Clear();
            var winner = await Context.TblBulkSuburbAliases.AsNoTracking()
                .FirstOrDefaultAsync(a => a.ClientId == request.ClientId && a.RawSuburb == rawSuburb && a.RawPostCode == rawPostCode);
            if (winner == null) throw;
            Log.Information($"({request.MessageId})({contactId}) Suburb fix for client {request.ClientId}: '{rawSuburb}' {rawPostCode ?? "-"} was saved concurrently as {winner.SuburbAliasId} -> suburb {winner.SuburbId} ({ex.GetBaseException().Message})");
            row = winner;
        }
        Log.Information($"({request.MessageId})({contactId}) Remembered suburb fix for client {request.ClientId}: '{rawSuburb}' {rawPostCode ?? "-"} -> suburb {row.SuburbId}");

        response.Alias = (await ToDtos(new List<TblBulkSuburbAlias> { row })).Single();
        response.Success = true;
        return response;
    }

    public async Task<BaseResponse> ForgetSuburbAlias(int contactId, IdRequest request)
    {
        var response = new BaseResponse(request.MessageId);
        var row = await Context.TblBulkSuburbAliases.FirstOrDefaultAsync(a => a.SuburbAliasId == request.Id);
        var allowed = row != null && (row.ClientId.HasValue
            ? await MayUseClientAliases(contactId, row.ClientId.Value)
            : _scope.IsStaff);
        if (!allowed)
            return BulkImportResponseUtility.AddMessageAndReturnResponse(response, "Suburb fix not found.");

        Context.TblBulkSuburbAliases.Remove(row);
        await Context.SaveChangesAsync();
        Log.Information($"({request.MessageId})({contactId}) Forgot suburb fix {row.SuburbAliasId} for client {row.ClientId?.ToString() ?? "tenant"}");
        response.Success = true;
        return response;
    }

    private async Task<List<SuburbAliasDto>> ToDtos(List<TblBulkSuburbAlias> rows)
    {
        var ids = rows.Select(r => r.SuburbId).Distinct().ToList();
        var suburbs = await Context.TucSuburbs.AsNoTracking()
            .Where(s => ids.Contains(s.UcsuId))
            .Select(s => new { s.UcsuId, s.UcsuName, s.PostCode })
            .ToDictionaryAsync(s => s.UcsuId);
        return rows.Select(r => new SuburbAliasDto
        {
            Id = r.SuburbAliasId,
            ClientId = r.ClientId,
            RawSuburb = r.RawSuburb,
            RawPostCode = r.RawPostCode,
            SuburbId = r.SuburbId,
            SuburbName = suburbs.GetValueOrDefault(r.SuburbId)?.UcsuName?.Trim(),
            PostCode = suburbs.GetValueOrDefault(r.SuburbId)?.PostCode?.Trim(),
        }).ToList();
    }

    private static string Truncate(string value, int max) =>
        value == null || value.Length <= max ? value : value.Substring(0, max);

    // The suburb a remembered fix points at, or null. Shared by the routed
    // import and Staff Import so both book what Fix Suburbs showed.
    private static string AliasedSuburbName(List<TblBulkSuburbAlias> aliases, Dictionary<int, string> suburbNames,
        int? clientId, string suburb, string postCode)
    {
        var hit = BulkSuburbAliases.Find(aliases, clientId, suburb, postCode, isNz: true);
        return hit != null && suburbNames.TryGetValue(hit.SuburbId, out var name) ? name : null;
    }

    // Staff Import: one alias load per client in the file, plus the names of
    // the suburbs those aliases point at.
    private async Task<List<TblBulkSuburbAlias>> StaffClientAliasesAsync(int clientId,
        Dictionary<int, List<TblBulkSuburbAlias>> cache, Dictionary<int, string> names)
    {
        if (cache.TryGetValue(clientId, out var rows)) return rows;
        rows = await BulkSuburbAliases.LoadAsync(Context, new[] { clientId });
        cache[clientId] = rows;
        var missing = rows.Select(a => a.SuburbId).Where(id => !names.ContainsKey(id)).Distinct().ToList();
        if (missing.Count > 0)
        {
            foreach (var s in await Context.TucSuburbs.AsNoTracking()
                         .Where(s => missing.Contains(s.UcsuId))
                         .Select(s => new { s.UcsuId, s.UcsuName })
                         .ToListAsync())
                names[s.UcsuId] = s.UcsuName?.Trim();
        }
        return rows;
    }
}
