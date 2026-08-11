// Route Viewer report service. Wraps 4 report SPs and formats each
// as CSV for browser-download. The 4 SPs live in the DB with an
// identical signature (@RunDate + @ClientIDs? + @Regions + @Speeds)
// which lets us share one execution path.
//
// Woop XLSX + Linehaul CSV are Section Z reports whose legacy queries
// hardcoded NZ-only values (Woop = ucclGroupID 16867; Linehaul = 18
// speed IDs). Both are now parameterised via `ReportRequest.GroupId`
// and `ReportRequest.Speeds` so US tenants can pass their own set
// without breaking NZ. Callers who omit the param fall back to the
// legacy NZ default.
using System.Data.Common;
using System.Globalization;
using System.Text;
using ClosedXML.Excel;
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

    /// <summary>Woop Run-Number report. Ports legacy HomeController.
    /// WoopRunNumberReport verbatim (same 19-column raw SQL + ClosedXML
    /// workbook + Yellow header styling). Uses `request.GroupId` when
    /// supplied, else falls back to legacy NZ default 16867 so existing
    /// consumers behave identically. Date window: [FromDate, ToDate]
    /// inclusive; both required.</summary>
    public async Task<byte[]> GetWoopRunNumberXlsxAsync(ReportRequest request)
    {
        var scope = await scopeResolver.ResolveAsync();
        if (!scope.IsAdmin) return Array.Empty<byte>();

        var from = (request.FromDate ?? DateTime.Today).Date;
        var to = (request.ToDate ?? from).Date;
        var groupId = request.GroupId ?? 16867;

        const string sql = @"
            SELECT
                b.JobNumber, cr.Code AS CourierCode, c.ucclGroupID AS GroupID,
                r.Name AS RunName, b.ClientRefa AS BoxCode, b.Amount,
                CONVERT(varchar, b.BookDate, 103) AS BookDate,
                'UT' AS Service, 'A' AS City,
                b.ToCompany, b.ToAddress AS ShippingStreet,
                'Auckland' AS ShippingCity,
                CAST(b.ToPostCode AS varchar(20)) AS ShippingPostcode,
                b.DeliverToPhone AS ShippingTelephone,
                b.ToSuburb AS ShippingRegion,
                b.Notes AS DeliveryInstruction,
                b.ClientID, b.DeliverToContact AS ShippingName, b.OurRef
            FROM tblBulkJob b
            INNER JOIN tblBulkJobRun jr ON b.BulkJobID = jr.BulkJobID
            INNER JOIN tblBulkRun r ON jr.RunID = r.ID
            LEFT JOIN tucCourier cr ON r.CourierID = cr.uccrID
            INNER JOIN tucClient c ON b.ClientID = c.ucclID
            WHERE b.BookDate >= @FromDate AND b.BookDate <= @ToDate
              AND ISNULL(b.Void, 0) = 0
              AND c.ucclGroupID = @GroupID
            ORDER BY r.Name, b.JobNumber";

        var conn = Context.Database.GetDbConnection();
        if (conn.State != System.Data.ConnectionState.Open) await conn.OpenAsync();
        using var cmd = conn.CreateCommand();
        cmd.CommandText = sql;
        cmd.CommandType = System.Data.CommandType.Text;
        cmd.CommandTimeout = 90;
        AddParam(cmd, "@FromDate", from);
        AddParam(cmd, "@ToDate", to);
        AddParam(cmd, "@GroupID", groupId);

        logger.LogInformation("Woop XLSX from={From} to={To} groupId={GroupId}", from, to, groupId);

        using var workbook = new XLWorkbook();
        var ws = workbook.Worksheets.Add("Woop Run Numbers");
        var headers = new[]
        {
            "JobNumber", "Code", "ucclGroupID", "RunName", "Box Code", "Amount",
            "BookDate", "Service", "City", "To Company", "shipping_street",
            "shipping_City", "shipping_postcode", "shipping_telephone",
            "shipping_region", "delivery_instruction", "ClientID",
            "Shipping_Name", "OurRef",
        };
        for (int i = 0; i < headers.Length; i++) ws.Cell(1, i + 1).Value = headers[i];
        var headerRange = ws.Range(1, 1, 1, headers.Length);
        headerRange.Style.Font.Bold = true;
        headerRange.Style.Fill.BackgroundColor = XLColor.Yellow;
        headerRange.Style.Border.OutsideBorder = XLBorderStyleValues.Thin;

        int row = 2;
        using var reader = await cmd.ExecuteReaderAsync();
        while (await reader.ReadAsync())
        {
            for (int i = 0; i < reader.FieldCount; i++)
            {
                if (reader.IsDBNull(i)) continue;
                var v = reader.GetValue(i);
                ws.Cell(row, i + 1).Value = v switch
                {
                    DateTime dt => dt,
                    decimal d => d,
                    double dd => dd,
                    float f => (double)f,
                    int n => n,
                    long l => l,
                    short s => s,
                    _ => v.ToString() ?? string.Empty,
                };
            }
            row++;
        }
        ws.Columns().AdjustToContents();

        using var stream = new MemoryStream();
        workbook.SaveAs(stream);
        return stream.ToArray();
    }

    /// <summary>Linehaul CSV. Ports legacy repo.GetLinehaulReportDataAsync
    /// verbatim: UNION of tblBulkJob (Bulk source) + tucJob (Live source)
    /// rows over the next 7 days, filtered by linehaul speed IDs. The 18
    /// NZ speed IDs are the legacy default; US callers pass their own via
    /// `LinehaulSpeedIds` on the request.</summary>
    public async Task<byte[]> GetLinehaulCsvAsync(ReportRequest request)
    {
        var scope = await scopeResolver.ResolveAsync();
        if (!scope.IsAdmin) return Array.Empty<byte>();

        // Legacy 18-id default (NZ linehaul speeds). Kept here so existing
        // NZ callers behave unchanged when the caller omits the param.
        const string legacyNzSpeeds = "53,79,94,95,96,110,111,112,126,128,129,130,131,135,140,147,164,165";
        var speeds = string.IsNullOrWhiteSpace(request.LinehaulSpeedIds)
            ? legacyNzSpeeds
            : request.LinehaulSpeedIds;
        // Whitelist to digits/commas only so the string interpolation
        // into the SQL doesn't leak an injection path. Any bad char
        // silently drops that entry rather than throwing.
        var cleanSpeeds = new string(speeds.Where(c => char.IsDigit(c) || c == ',').ToArray());
        if (string.IsNullOrWhiteSpace(cleanSpeeds)) cleanSpeeds = legacyNzSpeeds;

        var excludeClient = request.ExcludeClientName ?? "HelloFresh";
        var excludeSuburb = request.ExcludeFromSuburb ?? "Otahuhu";

        var sql = $@"
SELECT b.BookDate, c.ucclName AS ClientName, jt.ucjtName AS ServiceType,
       b.JobNumber, b.FromAddress, b.FromSuburb AS FromSuburbName,
       b.ToCompany AS ToContact, b.ToAddress, b.ToSuburb AS ToSuburbName,
       b.ToPostCode, b.Qty, b.Weight, b.ClientRefa, b.ClientRefb,
       b.OurRef, b.RunName, b.BookTime, 'Bulk' AS Source
FROM tblBulkJob b
INNER JOIN tucClient c ON b.ClientID = c.ucclID
INNER JOIN tucJobType jt ON b.Speed = jt.ucjtID
WHERE b.BookDate BETWEEN CAST(GETDATE() AS DATE)
                     AND DATEADD(DAY, 7, CAST(GETDATE() AS DATE))
  AND c.ucclName <> @ExcludeClient
  AND b.FromSuburb <> @ExcludeSuburb
  AND ISNULL(b.Void, 0) = 0
  AND b.Speed IN ({cleanSpeeds})
UNION
SELECT j.ucjbDate AS BookDate, c.ucclName AS ClientName, jt.ucjtName AS ServiceType,
       j.ucjbNumber AS JobNumber, j.ucjbFromAddr AS FromAddress,
       sfrom.ucsuName AS FromSuburbName, j.DeliverToContact AS ToContact,
       j.ucjbToAddr AS ToAddress, sto.ucsuName AS ToSuburbName,
       sto.PostCode AS ToPostCode, j.ucjbQty AS Qty, j.ucjbWeight AS Weight,
       j.ucjbClientRefa AS ClientRefa, j.ucjbClientRefb AS ClientRefb,
       j.ucjbOurRef AS OurRef, j.RunName, j.ucjbTime AS BookTime, 'Live' AS Source
FROM tucJob j
INNER JOIN tucClient c ON j.ucjbClientID = c.ucclID
INNER JOIN tucSuburb sto ON j.ucjbTo = sto.ucsuID
INNER JOIN tucSuburb sfrom ON j.ucjbFrom = sfrom.ucsuID
INNER JOIN tucJobType jt ON j.ucjbType = jt.ucjtID
WHERE j.ucjbDate BETWEEN CAST(GETDATE() AS DATE)
                     AND DATEADD(DAY, 7, CAST(GETDATE() AS DATE))
  AND j.ucjbSpeed IN ({cleanSpeeds})
  AND ISNULL(j.ucjbVoid, 0) = 0
ORDER BY BookDate, ServiceType";

        var conn = Context.Database.GetDbConnection();
        if (conn.State != System.Data.ConnectionState.Open) await conn.OpenAsync();
        using var cmd = conn.CreateCommand();
        cmd.CommandText = sql;
        cmd.CommandType = System.Data.CommandType.Text;
        cmd.CommandTimeout = 90;
        AddParam(cmd, "@ExcludeClient", excludeClient);
        AddParam(cmd, "@ExcludeSuburb", excludeSuburb);

        logger.LogInformation("Linehaul CSV speeds={Speeds} excludeClient={EC} excludeSuburb={ES}",
            cleanSpeeds, excludeClient, excludeSuburb);

        return await StreamReaderToCsvAsync(cmd);
    }

    /// <summary>Shared reader-to-CSV pump. Used by Linehaul + any future
    /// ad-hoc SELECT report so we don't re-implement escaping.</summary>
    private static async Task<byte[]> StreamReaderToCsvAsync(DbCommand cmd)
    {
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
