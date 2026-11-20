using Microsoft.Data.SqlClient;
using Microsoft.EntityFrameworkCore;
using RoutedOperations.Core.Domain;

namespace RoutedOperations.Core.Application.Services.RouteViewer;

/// <summary>One row of dbo.REP_fncLabelTemplate. TemplateId is
/// COALESCE(ClientTemplateId, SpeedTemplateId, DefaultTemplateId).</summary>
public sealed record LabelTemplateChoice(
    int? ClientTemplateId, int? SpeedTemplateId, int? DefaultTemplateId, int? TemplateId);

/// <summary>Seam over dbo.REP_fncLabelTemplate (client, then speed, then
/// tenant default), so the template rule lives in the database and tests can
/// fake it on EF InMemory.</summary>
public interface ILabelTemplateResolver
{
    Task<LabelTemplateChoice?> ResolveAsync(int? clientId, int? speedId, bool isBulk);
}

public sealed class SqlLabelTemplateResolver(
    IDbContextFactory<DynamicDespatchDbContext> contextFactory) : ILabelTemplateResolver
{
    private sealed class Row
    {
        public int? ClientTemplateId { get; set; }
        public int? SpeedTemplateId { get; set; }
        public int? DefaultTemplateId { get; set; }
        public int? TemplateId { get; set; }
    }

    public async Task<LabelTemplateChoice?> ResolveAsync(int? clientId, int? speedId, bool isBulk)
    {
        await using var ctx = await contextFactory.CreateDbContextAsync();
        var rows = await ctx.Database.SqlQueryRaw<Row>(
                @"SELECT ClientTemplateId, SpeedTemplateId, DefaultTemplateId, TemplateId
                  FROM dbo.REP_fncLabelTemplate(@ClientId, @SpeedId, @IsBulk)",
                new SqlParameter("@ClientId", (object?)clientId ?? DBNull.Value),
                new SqlParameter("@SpeedId", (object?)speedId ?? DBNull.Value),
                new SqlParameter("@IsBulk", isBulk))
            .ToListAsync();
        var r = rows.FirstOrDefault();
        return r is null
            ? null
            : new LabelTemplateChoice(r.ClientTemplateId, r.SpeedTemplateId, r.DefaultTemplateId, r.TemplateId);
    }
}
