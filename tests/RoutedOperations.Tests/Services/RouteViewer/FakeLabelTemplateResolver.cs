// Stands in for dbo.REP_fncLabelTemplate on the EF InMemory store: same rule
// (client, then speed if that AlertTemplate exists, then the tblSetting
// default for the job/bulk kind), with each client's LabelTemplateId given
// in a dictionary since the entity does not carry the column.
using Microsoft.EntityFrameworkCore;
using RoutedOperations.Core.Application.Services.RouteViewer;
using RoutedOperations.Core.Domain;

namespace RoutedOperations.Tests.Services.RouteViewer;

internal sealed class FakeLabelTemplateResolver(
    IDbContextFactory<DynamicDespatchDbContext> factory,
    IReadOnlyDictionary<int, int>? clientTemplates = null) : ILabelTemplateResolver
{
    public async Task<LabelTemplateChoice?> ResolveAsync(int? clientId, int? speedId, bool isBulk)
    {
        await using var ctx = factory.CreateDbContext();

        int? client = null;
        if (clientId is not null && clientTemplates is not null
            && clientTemplates.TryGetValue(clientId.Value, out var ct)
            && await ctx.AlertTemplates.AnyAsync(a => a.Id == ct))
            client = ct;

        int? speed = null;
        if (speedId is not null)
        {
            var labelId = await ctx.TucJobTypes.Where(s => s.UcjtId == speedId)
                .Select(s => s.LabelId).FirstOrDefaultAsync();
            if (labelId is not null && await ctx.AlertTemplates.AnyAsync(a => a.Id == labelId))
                speed = labelId;
        }

        var settings = await ctx.TblSettings
            .Select(s => new { s.DefaultJobLabelId, s.DefaultBulkLabelId })
            .FirstOrDefaultAsync();
        var def = isBulk ? settings?.DefaultBulkLabelId : settings?.DefaultJobLabelId;

        return new LabelTemplateChoice(client, speed, def, client ?? speed ?? def);
    }
}
