// Route Viewer report service. Wraps 4 report SPs and formats each
// as CSV for browser-download. The 4 SPs live in the DB with an
// identical signature (@RunDate + @ClientIDs? + @Regions + @Speeds)
// which lets us share one execution path.
//
// Woop XLSX + Linehaul CSV stay as scaffolds - both are gated on
// Section Z stakeholder decisions (Woop uses a hardcoded NZ
// ucclGroupID=16867; Linehaul uses 18 hardcoded NZ speed IDs). Wiring
// them without the decision would silently break US tenants.
using System.Data.Common;
using System.Globalization;
using System.Text;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging;
using RoutedOperations.Core.Application.Dtos.RouteViewer;
using RoutedOperations.Core.Application.Services.Np;
using RoutedOperations.Core.Domain;

namespace RoutedOperations.Core.Application.Services.RouteViewer;

public class RouteViewerReportService(
    IDbContextFactory<DynamicDespatchDbContext> contextFactory,
    INpScopeResolver scopeResolver,
    ILogger<RouteViewerReportService> logger) : BaseService(contextFactory)
{
    public Task<byte[]> GetRunAllocationCsvAsync(ReportRequest request) =>
        RunReportAsync("RVW_stpRunAllocationReport", request, includeClientIds: false);

    public Task<byte[]> GetMissingScanCsvAsync(ReportRequest request) =>
        RunReportAsync("RVW_stpMissingScanReport", request, includeClientIds: true);

    public Task<byte[]> GetMissingRunScanCsvAsync(ReportRequest request) =>
        RunReportAsync("RVW_stpMissingRunScanReport", request, includeClientIds: true);

    public Task<byte[]> GetMissingTransitScanCsvAsync(ReportRequest request) =>
        RunReportAsync("RVW_stpMissingTransitScanReport", request, includeClientIds: true);

    public Task<byte[]> GetWoopRunNumberXlsxAsync(ReportRequest request) =>
        throw new NotImplementedException(
            "Woop XLSX report is Section Z-gated: SP hardcodes NZ ucclGroupID=16867. " +
            "Awaiting stakeholder decision before US tenants can access it.");

    public Task<byte[]> GetLinehaulCsvAsync(ReportRequest request) =>
        throw new NotImplementedException(
            "Linehaul CSV is Section Z-gated: 18 NZ speed IDs are hardcoded in the SP. " +
            "Awaiting stakeholder decision before US tenants can access it.");

    /// <summary>Executes the report SP + streams the result set into a
    /// CSV byte buffer. Uses raw ADO.NET DbDataReader (not EF SqlQueryRaw)
    /// so we don't need a typed DTO per SP - CSV rendering keeps column
    /// order + native SQL types verbatim.</summary>
    private async Task<byte[]> RunReportAsync(string spName, ReportRequest request, bool includeClientIds)
    {
        var scope = await scopeResolver.ResolveAsync();
        if (!scope.IsAdmin && scope.NpAgentId == null) return Array.Empty<byte>();

        var runDate = request.RunDate ?? DateTime.Today;
        logger.LogInformation(
            "Report {Sp} runDate={RunDate} clientIds={ClientIds} regions={Regions} speeds={Speeds}",
            spName, runDate, request.ClientIds, request.Regions, request.Speeds);

        var conn = Context.Database.GetDbConnection();
        if (conn.State != System.Data.ConnectionState.Open) await conn.OpenAsync();

        using var cmd = conn.CreateCommand();
        cmd.CommandType = System.Data.CommandType.StoredProcedure;
        cmd.CommandText = "dbo." + spName;
        AddParam(cmd, "@RunDate", runDate);
        if (includeClientIds) AddParam(cmd, "@ClientIDs", (object?)request.ClientIds ?? DBNull.Value);
        AddParam(cmd, "@Regions", (object?)request.Regions ?? DBNull.Value);
        AddParam(cmd, "@Speeds", (object?)request.Speeds ?? DBNull.Value);

        var sb = new StringBuilder();
        using var reader = await cmd.ExecuteReaderAsync();
        var colCount = reader.FieldCount;
        for (int i = 0; i < colCount; i++)
        {
            if (i > 0) sb.Append(',');
            sb.Append(EscapeCsv(reader.GetName(i)));
        }
        sb.Append('\n');
        while (await reader.ReadAsync())
        {
            for (int i = 0; i < colCount; i++)
            {
                if (i > 0) sb.Append(',');
                if (!reader.IsDBNull(i))
                {
                    var v = reader.GetValue(i);
                    var s = v switch
                    {
                        DateTime dt => dt.ToString("yyyy-MM-dd HH:mm:ss", CultureInfo.InvariantCulture),
                        decimal d => d.ToString(CultureInfo.InvariantCulture),
                        double dd => dd.ToString(CultureInfo.InvariantCulture),
                        float f => f.ToString(CultureInfo.InvariantCulture),
                        _ => v.ToString() ?? string.Empty,
                    };
                    sb.Append(EscapeCsv(s));
                }
            }
            sb.Append('\n');
        }
        return Encoding.UTF8.GetBytes(sb.ToString());
    }

    private static void AddParam(DbCommand cmd, string name, object value)
    {
        var p = cmd.CreateParameter();
        p.ParameterName = name;
        p.Value = value;
        cmd.Parameters.Add(p);
    }

    /// <summary>RFC-4180 CSV escape. Wrap in quotes when the value has
    /// commas / quotes / newlines; double any embedded quotes.</summary>
    private static string EscapeCsv(string s)
    {
        if (string.IsNullOrEmpty(s)) return string.Empty;
        var needsQuote = s.IndexOfAny(new[] { ',', '"', '\r', '\n' }) >= 0;
        if (!needsQuote) return s;
        return "\"" + s.Replace("\"", "\"\"") + "\"";
    }
}
