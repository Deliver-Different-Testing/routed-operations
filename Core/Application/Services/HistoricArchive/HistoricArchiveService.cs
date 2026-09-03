// Historic Archive Upload service. Parses an operator-supplied CSV or
// Excel file, previews rows for the wizard, then commits a batch into
// dbo.tucJobArchive under a transaction with the "billing-sentinel"
// recipe stamped so the rows are never selected by any invoice / BCTI /
// settlement picker.
//
// Sentinel recipe (matches the plan file - do NOT relax these without
// re-reviewing the qdfProcessInvoiceSchedule / SAT_stpJobArchive_*
// WHERE clauses):
//
//   ucjbJobDone            = 1
//   ucjbVoid               = 0
//   ucjbStatus             = 6                      (completed)
//   ucjbInvoiceNo          = 999999                 (excludes qdfProcessInvoiceSchedule; no FK)
//   InvoiceProcessID       = 999999                 (excludes SAT_stpJobArchive_*; no FK)
//   JournalHeaderID        = 999999                 (excludes journal posters; no FK)
//   AgentBctiRunId         = NULL                   (FK to TblSettlementRun.Id -
//                                                    cannot use a sentinel int
//                                                    without seeding a real row.
//                                                    100% NULL on both tenants
//                                                    today; no billing SP filters
//                                                    on it being NULL / non-null
//                                                    for archive rows.)
//   CourierSettlementBatchId = NULL                 (FK to CourierSettlementBatch.Id
//                                                    - same rationale as above)
//   ucjbChargeType         = 0                      (defensive - real billing wants IN(2,3))
//   SourceID               = 900                    ("HistoricImport-RoutedOperations")
//   RatedManually          = 1                      (bit NOT NULL; skip rating passes)
//   AutoDespatch           = 0                      (no dispatch)
//   ucjbMonth / ucjbYear   from ucjbDate
//   ucjbComplTime          = mapped CompletedTime, else ucjbDate
//   CreatedTime / CreatedTimeUtc = insert instant   (provenance)
//
// ucjbID allocation: tucJobArchive.ucjbID is NOT identity (unlike
// tucJob). We take MAX(ucjbID) across BOTH tables, then start our batch
// at max(that + 1, 1_900_000_000). The 1.9B floor keeps historic IDs
// visually distinguishable from real jobs (current max ~24M) and well
// under int max (2.14B). Allocation happens inside the same transaction
// as the insert + audit-row write so concurrent imports cannot collide.

using System.Data;
using System.Globalization;
using System.Security.Claims;
using System.Text;
using System.Text.Json;
using ExcelDataReader;
using Microsoft.AspNetCore.Http;
using Microsoft.EntityFrameworkCore;
using RoutedOperations.Core.Application.Dtos.HistoricArchive;
using RoutedOperations.Core.Domain;
using RoutedOperations.Core.Domain.Despatch;
using Serilog;

namespace RoutedOperations.Core.Application.Services.HistoricArchive;

public class HistoricArchiveService(
    IDbContextFactory<DynamicDespatchDbContext> contextFactory,
    IHttpContextAccessor httpContextAccessor) : BaseService(contextFactory)
{
    // ---- constants ----
    internal const int SourceIdHistoricImport = 900;
    internal const int UcjbInvoiceNoSentinel = 999999;
    internal const int InvoiceProcessIdSentinel = 999999;
    internal const int JournalHeaderIdSentinel = 999999;
    // AgentBctiRunId / CourierSettlementBatchId are FK-constrained to real
    // batch rows (TblSettlementRun.Id / CourierSettlementBatch.Id). We
    // deliberately leave both NULL - historic rows never participate in a
    // BCTI or settlement batch, and both columns are 100% NULL on both
    // tenants today, so no picker filters on their nullness for archive
    // rows. See file header for rationale.
    internal const int UcjbIdFloor = 1_900_000_000;
    internal const int UcjbStatusCompleted = 6;
    internal const double UcjbChargeTypeHistoric = 0d;

    // ---- upload + parse ----

    public async Task<HistoricArchiveUploadResponse> ParseUploadAsync(IFormFile? file)
    {
        var response = new HistoricArchiveUploadResponse
        {
            CanonicalFields = HistoricArchiveField.All.ToList(),
            RequiredFields = HistoricArchiveField.Required.ToList(),
        };

        if (file == null || file.Length == 0 || string.IsNullOrWhiteSpace(file.FileName))
            return response;

        response.FileName = file.FileName.Trim();

        var dotIdx = response.FileName.LastIndexOf('.');
        if (dotIdx < 0)
            throw new InvalidOperationException("Uploaded file has no extension. Expected .csv, .xls, or .xlsx.");

        var ext = response.FileName.Substring(dotIdx).Trim().ToLowerInvariant();
        if (ext != ".csv" && ext != ".xls" && ext != ".xlsx")
            throw new InvalidOperationException($"Unsupported file type '{ext}'. Expected .csv, .xls, or .xlsx.");

        Encoding.RegisterProvider(CodePagesEncodingProvider.Instance);

        await using var stream = file.OpenReadStream();

        if (ext == ".csv")
        {
            ParseCsv(stream, response);
        }
        else
        {
            ParseExcel(stream, response);
        }

        Log.Information("Historic archive upload parsed: {FileName}, {RowCount} rows, {HeaderCount} headers",
            response.FileName, response.Rows.Count, response.Headers.Count);

        return response;
    }

    private static void ParseExcel(Stream stream, HistoricArchiveUploadResponse response)
    {
        using var reader = ExcelReaderFactory.CreateReader(stream);
        var ds = reader.AsDataSet(new ExcelDataSetConfiguration
        {
            ConfigureDataTable = _ => new ExcelDataTableConfiguration { UseHeaderRow = true },
        });

        if (ds?.Tables == null || ds.Tables.Count == 0) return;
        var table = ds.Tables[0];
        if (table?.Rows == null) return;

        foreach (DataColumn col in table.Columns)
            response.Headers.Add(col.ColumnName?.Trim() ?? string.Empty);

        foreach (DataRow row in table.Rows)
        {
            var dict = new Dictionary<string, string?>(table.Columns.Count);
            for (var i = 0; i < table.Columns.Count; i++)
            {
                var col = response.Headers[i];
                var value = row[i];
                dict[col] = value == DBNull.Value ? null : Convert.ToString(value, CultureInfo.InvariantCulture);
            }
            response.Rows.Add(dict);
        }
    }

    private static void ParseCsv(Stream stream, HistoricArchiveUploadResponse response)
    {
        using var reader = new StreamReader(stream, Encoding.UTF8, detectEncodingFromByteOrderMarks: true, leaveOpen: false);
        var content = reader.ReadToEnd();
        if (string.IsNullOrWhiteSpace(content)) return;

        var lines = content.Replace("\r\n", "\n").Replace('\r', '\n').Split('\n');
        if (lines.Length == 0) return;

        // Minimal CSV split - matches Quoting.tsx's approach, sufficient for
        // historic-import files. If ops hit a genuinely gnarly file we can
        // wire the RFC-4180 parser from BulkImportServiceV2 later.
        response.Headers.AddRange(SplitCsvLine(lines[0]).Select(h => h.Trim()));

        for (var r = 1; r < lines.Length; r++)
        {
            var line = lines[r];
            if (string.IsNullOrWhiteSpace(line)) continue;
            var cells = SplitCsvLine(line);
            var dict = new Dictionary<string, string?>(response.Headers.Count);
            for (var c = 0; c < response.Headers.Count; c++)
                dict[response.Headers[c]] = c < cells.Count ? cells[c] : null;
            response.Rows.Add(dict);
        }
    }

    private static List<string> SplitCsvLine(string line)
    {
        var cells = new List<string>();
        var sb = new StringBuilder();
        var inQuote = false;
        for (var i = 0; i < line.Length; i++)
        {
            var ch = line[i];
            if (inQuote)
            {
                if (ch == '"')
                {
                    if (i + 1 < line.Length && line[i + 1] == '"') { sb.Append('"'); i++; }
                    else inQuote = false;
                }
                else sb.Append(ch);
            }
            else
            {
                if (ch == ',') { cells.Add(sb.ToString()); sb.Clear(); }
                else if (ch == '"') inQuote = true;
                else sb.Append(ch);
            }
        }
        cells.Add(sb.ToString());
        return cells;
    }

    // ---- commit ----

    public async Task<HistoricArchiveCommitResponse> CommitAsync(HistoricArchiveCommitRequest request, int contactId)
    {
        var response = new HistoricArchiveCommitResponse();

        if (request == null || request.Rows == null || request.Rows.Count == 0)
            return response;

        // ---- validate the mapping covers required fields ----
        var canonicalMapped = request.Mapping
            .Where(kv => !string.IsNullOrWhiteSpace(kv.Value))
            .Select(kv => kv.Value)
            .ToHashSet(StringComparer.OrdinalIgnoreCase);

        var missingRequired = HistoricArchiveField.Required
            .Where(r => !canonicalMapped.Contains(r))
            .ToList();
        if (missingRequired.Count > 0)
            throw new InvalidOperationException(
                $"Mapping is missing required fields: {string.Join(", ", missingRequired)}");

        // Reverse the mapping so we can go canonical -> header. Multiple
        // headers mapping to one canonical field is not allowed at this
        // point; take the first mapping.
        var canonicalToHeader = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
        foreach (var kv in request.Mapping)
        {
            if (string.IsNullOrWhiteSpace(kv.Value)) continue;
            if (!canonicalToHeader.ContainsKey(kv.Value))
                canonicalToHeader[kv.Value] = kv.Key;
        }

        // ---- preload name -> ID lookups for text-resolvable FKs ----
        //
        // Steve 2026-09-03: OTG-style CSVs ship "Service" + "Vehicle" as
        // text names (e.g. "VAN SERVICE", "Van"), not the pre-resolved
        // integer IDs the archive columns want. Rather than force the
        // operator to hand-resolve every row, we hydrate two tenant-local
        // lookup dicts here (single query each - both tables are tiny)
        // and BuildRow uses them to translate ServiceName / VehicleName
        // to UcjbSpeed / UcjbSize.
        //
        // Case-insensitive on the name key. Duplicate names collapse to
        // the FIRST id we see (StringComparer.OrdinalIgnoreCase +
        // GroupBy first-wins) - the alternative would throw at commit
        // and reject every row, which is worse UX than a soft dedupe.
        // Unresolved names on a given row silently leave the FK NULL:
        // operators can spot missing sizes/speeds in the batch drill-
        // down and rerun with corrected data.
        Dictionary<string, int> serviceNameToSpeedId;
        Dictionary<string, int> vehicleNameToSizeId;
        await using (var lookupCtx = await contextFactory.CreateDbContextAsync())
        {
            serviceNameToSpeedId = await lookupCtx.TucJobTypes
                .AsNoTracking()
                .Where(t => t.UcjtName != null)
                .Select(t => new { t.UcjtName, t.UcjtId })
                .ToListAsync()
                .ContinueWith(tk => tk.Result
                    .GroupBy(x => x.UcjtName.Trim(), StringComparer.OrdinalIgnoreCase)
                    .ToDictionary(g => g.Key, g => g.First().UcjtId, StringComparer.OrdinalIgnoreCase));

            vehicleNameToSizeId = await lookupCtx.VehicleSizes
                .AsNoTracking()
                .Where(v => v.VehicleName != null)
                .Select(v => new { v.VehicleName, v.VehicleSizeId })
                .ToListAsync()
                .ContinueWith(tk => tk.Result
                    .GroupBy(x => x.VehicleName.Trim(), StringComparer.OrdinalIgnoreCase)
                    .ToDictionary(g => g.Key, g => g.First().VehicleSizeId, StringComparer.OrdinalIgnoreCase));
        }

        // ---- build TucJobArchive rows in memory + collect per-row errors ----
        var toInsert = new List<TucJobArchive>(request.Rows.Count);
        var errors = new List<HistoricArchiveRowError>();
        for (var i = 0; i < request.Rows.Count; i++)
        {
            var raw = request.Rows[i];
            try
            {
                var row = BuildRow(raw, canonicalToHeader, serviceNameToSpeedId, vehicleNameToSizeId);
                toInsert.Add(row);
            }
            catch (Exception ex)
            {
                errors.Add(new HistoricArchiveRowError
                {
                    RowIndex = i + 1,
                    JobNumber = Get(raw, canonicalToHeader, HistoricArchiveField.JobNumber),
                    Message = ex.Message,
                });
            }
        }

        response.Errors = errors;
        response.RejectedCount = errors.Count;

        if (toInsert.Count == 0)
        {
            // Still record a batch so the audit trail shows the attempt.
            // Errors payload persisted so the drill-down UI can render
            // the reasons after the wizard is dismissed.
            var emptyBatch = await WriteBatchRowAsync(
                request, contactId, request.Rows.Count, 0, errors.Count, null, null,
                SerializeErrors(errors));
            response.BatchId = emptyBatch.Id;
            return response;
        }

        // ---- allocate ucjbID range + insert + audit inside one transaction ----
        await using var ctx = await contextFactory.CreateDbContextAsync();
        await using var tx = await ctx.Database.BeginTransactionAsync();

        // Take MAX across both tables so we never collide with a live tucJob
        // that later archives. The 1.9B floor keeps historic ids visually
        // distinguishable from real ids and well under int max.
        var maxIdRaw = await ctx.Database
            .SqlQueryRaw<int?>(
                @"SELECT MAX(ucjbID) AS Value FROM (
                      SELECT ucjbID FROM dbo.tucJob
                      UNION ALL
                      SELECT ucjbID FROM dbo.tucJobArchive
                  ) t")
            .SingleAsync();
        var maxId = maxIdRaw ?? 0;
        var startId = Math.Max(maxId + 1, UcjbIdFloor);

        for (var i = 0; i < toInsert.Count; i++)
            toInsert[i].UcjbId = startId + i;

        var endId = startId + toInsert.Count - 1;

        ctx.TucJobArchives.AddRange(toInsert);
        await ctx.SaveChangesAsync();

        var batch = new HistoricArchiveImportBatch
        {
            UploadedByContact = contactId,
            UploadedAt = DateTime.UtcNow,
            FileName = request.FileName ?? "unknown",
            TenantCode = ResolveTenantCode(),
            RowCount = request.Rows.Count,
            InsertedCount = toInsert.Count,
            RejectedCount = errors.Count,
            Notes = request.Notes,
            ImportedIdStart = startId,
            ImportedIdEnd = endId,
            Errors = SerializeErrors(errors),
        };
        ctx.HistoricArchiveImportBatches.Add(batch);
        await ctx.SaveChangesAsync();

        await tx.CommitAsync();

        response.BatchId = batch.Id;
        response.InsertedCount = toInsert.Count;
        response.ImportedIdStart = startId;
        response.ImportedIdEnd = endId;

        Log.Information(
            "Historic archive import committed: batch={BatchId}, contact={ContactId}, file={FileName}, inserted={Inserted}, rejected={Rejected}, ids={StartId}..{EndId}",
            batch.Id, contactId, request.FileName, toInsert.Count, errors.Count, startId, endId);

        return response;
    }

    // Build one TucJobArchive from a raw row + operator mapping. Throws on
    // parse / cast failures - the caller catches per-row and records as a
    // rejection.
    //
    // serviceNameToSpeedId / vehicleNameToSizeId are the preloaded
    // tenant-local name -> ID dicts hydrated by CommitAsync. When the
    // operator maps a ServiceName / VehicleName column, BuildRow looks
    // the value up in the dict; unresolved names leave the FK NULL.
    private static TucJobArchive BuildRow(
        Dictionary<string, string?> raw,
        Dictionary<string, string> canonicalToHeader,
        Dictionary<string, int> serviceNameToSpeedId,
        Dictionary<string, int> vehicleNameToSizeId)
    {
        var jobNumber = RequireString(raw, canonicalToHeader, HistoricArchiveField.JobNumber);
        var jobDate = RequireDate(raw, canonicalToHeader, HistoricArchiveField.JobDate);
        var clientCode = RequireString(raw, canonicalToHeader, HistoricArchiveField.ClientCode);

        var completedTime = OptDate(raw, canonicalToHeader, HistoricArchiveField.CompletedTime) ?? jobDate;
        var now = DateTime.Now;
        var nowUtc = DateTime.UtcNow;

        return new TucJobArchive
        {
            // core identity
            UcjbNumber = jobNumber,
            UcjbDate = jobDate,
            UcjbTime = OptDate(raw, canonicalToHeader, HistoricArchiveField.PickupTime),
            UcjbClientCode = clientCode,
            UcjbClientId = OptInt(raw, canonicalToHeader, HistoricArchiveField.ClientId),
            UcjbClientRefa = OptString(raw, canonicalToHeader, HistoricArchiveField.ClientRefA),
            UcjbClientRefb = OptString(raw, canonicalToHeader, HistoricArchiveField.ClientRefB),
            UcjbOurRef = OptString(raw, canonicalToHeader, HistoricArchiveField.OurRef),
            UcjbNotes = OptString(raw, canonicalToHeader, HistoricArchiveField.Notes),
            UcjbPodname = OptString(raw, canonicalToHeader, HistoricArchiveField.PodName),
            UcjbAmount = OptDecimal(raw, canonicalToHeader, HistoricArchiveField.Amount),
            UcjbWeight = OptDouble(raw, canonicalToHeader, HistoricArchiveField.Weight),
            UcjbQty = OptShort(raw, canonicalToHeader, HistoricArchiveField.Quantity),
            UcjbCourierId = OptInt(raw, canonicalToHeader, HistoricArchiveField.CourierId),

            // completed-job defaults
            UcjbJobDone = true,
            UcjbVoid = false,
            UcjbStatus = UcjbStatusCompleted,
            UcjbComplTime = completedTime,
            UcjbMonth = (byte)jobDate.Month,
            UcjbYear = (short)jobDate.Year,

            // legacy NOT NULL bit columns without defaults - all false
            UcjbCbd = false,
            UcjbVan = false,
            UcjbReturn = false,
            UcjbAttention = false,
            UcjbPaged = false,

            // billing sentinels
            UcjbInvoiceNo = UcjbInvoiceNoSentinel,
            InvoiceProcessId = InvoiceProcessIdSentinel,
            JournalHeaderId = JournalHeaderIdSentinel,
            // AgentBctiRunId / CourierSettlementBatchId intentionally NULL
            // - FK-constrained columns, see file header.
            AgentBctiRunId = null,
            CourierSettlementBatchId = null,
            UcjbChargeType = UcjbChargeTypeHistoric,

            // provenance
            SourceId = SourceIdHistoricImport,
            RatedManually = true,
            AutoDespatch = false,
            CreatedTime = now,
            CreatedTimeUtc = nowUtc,

            // money pass-through. FuelSurchargeAmount is the only money
            // column that is NOT NULL on tucJobArchive (DB default = 0),
            // and since EF materialises a nullable property as an explicit
            // NULL in the INSERT it defeats the DB default. Coerce to 0
            // when the operator hasn't mapped the column so the insert
            // matches the DB's own default.
            CourierPayment = OptDecimal(raw, canonicalToHeader, HistoricArchiveField.CourierPayment),
            CourierFuel = OptDecimal(raw, canonicalToHeader, HistoricArchiveField.CourierFuel),
            CourierBonus = OptDecimal(raw, canonicalToHeader, HistoricArchiveField.CourierBonus),
            FuelSurchargeAmount = OptDecimal(raw, canonicalToHeader, HistoricArchiveField.FuelSurchargeAmount) ?? 0m,
            PpdAmount = OptDecimal(raw, canonicalToHeader, HistoricArchiveField.PpdAmount),
            PpdExclusiveAmount = OptDecimal(raw, canonicalToHeader, HistoricArchiveField.PpdExclusiveAmount),
            RawBaseAmount = OptDecimal(raw, canonicalToHeader, HistoricArchiveField.RawBaseAmount),

            // address bag (best-effort - all nullable). Line5 = city,
            // Line6 = state (new 2026-09-03), Line7 = postcode/zip.
            PickupAddressLine1 = OptString(raw, canonicalToHeader, HistoricArchiveField.PickupAddress1),
            PickupAddressLine2 = OptString(raw, canonicalToHeader, HistoricArchiveField.PickupAddress2),
            PickupAddressLine3 = OptString(raw, canonicalToHeader, HistoricArchiveField.PickupAddress3),
            PickupAddressLine4 = OptString(raw, canonicalToHeader, HistoricArchiveField.PickupAddress4),
            PickupAddressLine5 = OptString(raw, canonicalToHeader, HistoricArchiveField.PickupAddressCity),
            PickupAddressLine6 = OptString(raw, canonicalToHeader, HistoricArchiveField.PickupState),
            PickupAddressLine7 = OptString(raw, canonicalToHeader, HistoricArchiveField.PickupPostCode),
            DeliveryAddressLine1 = OptString(raw, canonicalToHeader, HistoricArchiveField.CustomerName),
            DeliveryAddressLine2 = OptString(raw, canonicalToHeader, HistoricArchiveField.DeliveryAddress1),
            DeliveryAddressLine3 = OptString(raw, canonicalToHeader, HistoricArchiveField.DeliveryAddress2),
            DeliveryAddressLine4 = OptString(raw, canonicalToHeader, HistoricArchiveField.DeliveryAddress4),
            DeliveryAddressLine5 = OptString(raw, canonicalToHeader, HistoricArchiveField.DeliveryAddressCity),
            DeliveryAddressLine6 = OptString(raw, canonicalToHeader, HistoricArchiveField.DeliveryState),
            DeliveryAddressLine7 = OptString(raw, canonicalToHeader, HistoricArchiveField.DeliveryPostCode),

            // contact bag (Steve 2026-09-03: expose sender + receiver
            // parties separately so imports do not collapse them into
            // one Company / Notes column).
            //
            // PickupContact + PickupCompany both target PickUpFromContact
            // - last-writer-wins if the operator maps both. PickupContact
            //   is more literal for the canonical name; PickupCompany
            //   matches vendor CSV headers ("Pickup Company").
            PickUpFromContact = OptString(raw, canonicalToHeader, HistoricArchiveField.PickupContact)
                              ?? OptString(raw, canonicalToHeader, HistoricArchiveField.PickupCompany),
            PickUpFromPhone   = OptString(raw, canonicalToHeader, HistoricArchiveField.PickupPhone),
            DeliverToContact  = OptString(raw, canonicalToHeader, HistoricArchiveField.DeliveryContact),
            DeliverToPhone    = OptString(raw, canonicalToHeader, HistoricArchiveField.DeliveryPhone),
            UcjbContact       = OptString(raw, canonicalToHeader, HistoricArchiveField.Contact),
            UcjbContactPhone  = OptString(raw, canonicalToHeader, HistoricArchiveField.ContactPhone),

            // long-form notes + descriptive fields
            ClientNotes       = OptString(raw, canonicalToHeader, HistoricArchiveField.ClientNotes),
            InternalNotes     = OptString(raw, canonicalToHeader, HistoricArchiveField.InternalNotes),
            Connote           = OptString(raw, canonicalToHeader, HistoricArchiveField.Connote),
            Barcode           = OptString(raw, canonicalToHeader, HistoricArchiveField.Barcode),
            CustomJobName     = OptString(raw, canonicalToHeader, HistoricArchiveField.CustomJobName),
            RunName           = OptString(raw, canonicalToHeader, HistoricArchiveField.RunName),
            ScheduleName      = OptString(raw, canonicalToHeader, HistoricArchiveField.ScheduleName),

            // extra references
            UcjbClientRefc    = OptString(raw, canonicalToHeader, HistoricArchiveField.ClientRefC),
            TextRef1          = OptString(raw, canonicalToHeader, HistoricArchiveField.TextRef1),
            TextRef2          = OptString(raw, canonicalToHeader, HistoricArchiveField.TextRef2),
            TextRef3          = OptString(raw, canonicalToHeader, HistoricArchiveField.TextRef3),
            TextRef4          = OptString(raw, canonicalToHeader, HistoricArchiveField.TextRef4),
            NumRef1           = OptInt(raw, canonicalToHeader, HistoricArchiveField.NumRef1),
            NumRef2           = OptInt(raw, canonicalToHeader, HistoricArchiveField.NumRef2),
            NumRef3           = OptInt(raw, canonicalToHeader, HistoricArchiveField.NumRef3),
            NumRef4           = OptInt(raw, canonicalToHeader, HistoricArchiveField.NumRef4),

            // timing / milestone
            RequiredDeliveryTime = OptDate(raw, canonicalToHeader, HistoricArchiveField.RequiredDeliveryTime),
            DeliverByTime        = OptDate(raw, canonicalToHeader, HistoricArchiveField.DeliverByTime),
            PickupArrivalTime    = OptDate(raw, canonicalToHeader, HistoricArchiveField.PickupArrivalTime),
            DeliveryArrivalTime  = OptDate(raw, canonicalToHeader, HistoricArchiveField.DeliveryArrivalTime),

            // service / booking metadata.
            //
            // UcjbSpeed: prefer the explicit Speed int (operator has
            // already resolved the ID) over the ServiceName lookup so
            // callers who provide both aren't overridden. If neither is
            // mapped or the ServiceName can't be resolved, the FK stays
            // null and the row imports without a speed.
            UcjbSpeed         = OptInt(raw, canonicalToHeader, HistoricArchiveField.Speed)
                              ?? LookupOptional(raw, canonicalToHeader, HistoricArchiveField.ServiceName, serviceNameToSpeedId),
            UcjbOpId          = OptInt(raw, canonicalToHeader, HistoricArchiveField.BookedBy),
            UcjbSize          = LookupOptional(raw, canonicalToHeader, HistoricArchiveField.VehicleName, vehicleNameToSizeId),

            // extra money pass-through
            CourierPercentage = OptDecimal(raw, canonicalToHeader, HistoricArchiveField.CourierPercentage),
        };
    }

    private async Task<HistoricArchiveImportBatch> WriteBatchRowAsync(
        HistoricArchiveCommitRequest request, int contactId,
        int rowCount, int insertedCount, int rejectedCount,
        int? startId, int? endId,
        string? errorsJson = null)
    {
        await using var ctx = await contextFactory.CreateDbContextAsync();
        var batch = new HistoricArchiveImportBatch
        {
            UploadedByContact = contactId,
            UploadedAt = DateTime.UtcNow,
            FileName = request.FileName ?? "unknown",
            TenantCode = ResolveTenantCode(),
            RowCount = rowCount,
            InsertedCount = insertedCount,
            RejectedCount = rejectedCount,
            Notes = request.Notes,
            ImportedIdStart = startId,
            ImportedIdEnd = endId,
            Errors = errorsJson,
        };
        ctx.HistoricArchiveImportBatches.Add(batch);
        await ctx.SaveChangesAsync();
        return batch;
    }

    /// <summary>Serialise the per-row error list to the JSON shape stored
    /// on HistoricArchiveImportBatch.Errors. Returns null when the list is
    /// empty so the audit column stays NULL for clean batches.</summary>
    private static string? SerializeErrors(List<HistoricArchiveRowError> errors)
    {
        if (errors == null || errors.Count == 0) return null;
        return JsonSerializer.Serialize(errors, new JsonSerializerOptions
        {
            PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
        });
    }

    /// <summary>Deserialise the persisted Errors payload back into the
    /// typed error list. Empty on null / malformed input so a bad row
    /// never breaks the batch-detail read. Public for reuse from tests +
    /// any future consumer that reads the raw column directly.</summary>
    public static List<HistoricArchiveRowError> DeserializeErrors(string? errorsJson)
    {
        if (string.IsNullOrWhiteSpace(errorsJson)) return new List<HistoricArchiveRowError>();
        try
        {
            return JsonSerializer.Deserialize<List<HistoricArchiveRowError>>(
                       errorsJson,
                       new JsonSerializerOptions { PropertyNameCaseInsensitive = true })
                   ?? new List<HistoricArchiveRowError>();
        }
        catch (JsonException)
        {
            return new List<HistoricArchiveRowError>();
        }
    }

    // ---- batch reads ----

    public async Task<List<HistoricArchiveBatchDto>> GetBatchesAsync(int limit, int offset)
    {
        if (limit <= 0 || limit > 200) limit = 50;
        if (offset < 0) offset = 0;

        // Project the contact name via TucClientContacts and the distinct
        // client codes via a subquery over tucJobArchive filtered by the
        // batch's contiguous ID range. Contact name join is a LEFT via
        // FirstOrDefault so a deleted contact doesn't drop the row. Client
        // codes subquery is empty (null) when the batch had 0 inserts.
        return await Context.HistoricArchiveImportBatches
            .AsNoTracking()
            .OrderByDescending(b => b.UploadedAt)
            .Skip(offset)
            .Take(limit)
            .Select(b => new HistoricArchiveBatchDto
            {
                Id = b.Id,
                UploadedAt = b.UploadedAt,
                UploadedByContact = b.UploadedByContact,
                UploadedByName = Context.TucClientContacts
                    .Where(c => c.UcctId == b.UploadedByContact)
                    .Select(c => ((c.UcctFirstname ?? string.Empty).Trim()
                                  + " "
                                  + (c.UcctSurname ?? string.Empty).Trim()).Trim())
                    .FirstOrDefault(),
                FileName = b.FileName,
                TenantCode = b.TenantCode,
                RowCount = b.RowCount,
                InsertedCount = b.InsertedCount,
                RejectedCount = b.RejectedCount,
                ClientCodes = b.ImportedIdStart == null || b.ImportedIdEnd == null
                    ? null
                    : string.Join(", ",
                        Context.TucJobArchives
                            .Where(j => j.UcjbId >= b.ImportedIdStart.Value
                                     && j.UcjbId <= b.ImportedIdEnd.Value
                                     && j.SourceId == SourceIdHistoricImport
                                     && j.UcjbClientCode != null)
                            .Select(j => j.UcjbClientCode!)
                            .Distinct()
                            .OrderBy(c => c)),
                Notes = b.Notes,
                ImportedIdStart = b.ImportedIdStart,
                ImportedIdEnd = b.ImportedIdEnd,
            })
            .ToListAsync();
    }

    public async Task<HistoricArchiveBatchDetailDto?> GetBatchAsync(int id)
    {
        // Two-step projection: EF Core can't call our static
        // DeserializeErrors helper server-side. Pull the raw Errors JSON
        // in the query, materialise, then deserialise in memory.
        var row = await Context.HistoricArchiveImportBatches
            .AsNoTracking()
            .Where(b => b.Id == id)
            .Select(b => new
            {
                b.Id,
                b.UploadedAt,
                b.UploadedByContact,
                UploadedByName = Context.TucClientContacts
                    .Where(c => c.UcctId == b.UploadedByContact)
                    .Select(c => ((c.UcctFirstname ?? string.Empty).Trim()
                                  + " "
                                  + (c.UcctSurname ?? string.Empty).Trim()).Trim())
                    .FirstOrDefault(),
                b.FileName,
                b.TenantCode,
                b.RowCount,
                b.InsertedCount,
                b.RejectedCount,
                ClientCodes = b.ImportedIdStart == null || b.ImportedIdEnd == null
                    ? null
                    : string.Join(", ",
                        Context.TucJobArchives
                            .Where(j => j.UcjbId >= b.ImportedIdStart.Value
                                     && j.UcjbId <= b.ImportedIdEnd.Value
                                     && j.SourceId == SourceIdHistoricImport
                                     && j.UcjbClientCode != null)
                            .Select(j => j.UcjbClientCode!)
                            .Distinct()
                            .OrderBy(c => c)),
                b.Notes,
                b.ImportedIdStart,
                b.ImportedIdEnd,
                b.Errors,
            })
            .SingleOrDefaultAsync();

        if (row == null) return null;
        return new HistoricArchiveBatchDetailDto
        {
            Id = row.Id,
            UploadedAt = row.UploadedAt,
            UploadedByContact = row.UploadedByContact,
            UploadedByName = row.UploadedByName,
            FileName = row.FileName,
            TenantCode = row.TenantCode,
            RowCount = row.RowCount,
            InsertedCount = row.InsertedCount,
            RejectedCount = row.RejectedCount,
            ClientCodes = row.ClientCodes,
            Notes = row.Notes,
            ImportedIdStart = row.ImportedIdStart,
            ImportedIdEnd = row.ImportedIdEnd,
            Errors = DeserializeErrors(row.Errors),
        };
    }

    /// <summary>Drill-down: paged list of tucJobArchive rows produced by
    /// the given batch. Reads by the batch's contiguous ImportedIdStart..
    /// ImportedIdEnd range, filtered to SourceID = 900 so a random
    /// operator-scripted archive insert in the same numeric range can
    /// never leak into a batch's drill-down view. Returns an empty rows
    /// list when the batch has no imported range yet (all-rejected).
    /// Throws when the batch id is unknown so the controller can
    /// translate to 404.</summary>
    public async Task<HistoricArchiveJobsPage> GetBatchJobsAsync(int batchId, int limit, int offset)
    {
        if (limit <= 0 || limit > 500) limit = 50;
        if (offset < 0) offset = 0;

        var range = await Context.HistoricArchiveImportBatches
            .AsNoTracking()
            .Where(b => b.Id == batchId)
            .Select(b => new { b.ImportedIdStart, b.ImportedIdEnd })
            .SingleOrDefaultAsync()
            ?? throw new InvalidOperationException($"Batch {batchId} not found.");

        if (range.ImportedIdStart == null || range.ImportedIdEnd == null)
        {
            return new HistoricArchiveJobsPage { Total = 0, Limit = limit, Offset = offset };
        }

        var start = range.ImportedIdStart.Value;
        var end = range.ImportedIdEnd.Value;

        var baseQuery = Context.TucJobArchives
            .AsNoTracking()
            .Where(j => j.UcjbId >= start
                     && j.UcjbId <= end
                     && j.SourceId == SourceIdHistoricImport);

        var total = await baseQuery.CountAsync();

        var rows = await baseQuery
            .OrderBy(j => j.UcjbId)
            .Skip(offset)
            .Take(limit)
            .Select(j => new HistoricArchiveJobDto
            {
                UcjbId = j.UcjbId,
                JobNumber = j.UcjbNumber,
                ClientCode = j.UcjbClientCode,
                ClientId = j.UcjbClientId,
                JobDate = j.UcjbDate,
                CompletedTime = j.UcjbComplTime,
                Amount = j.UcjbAmount,
                CourierPayment = j.CourierPayment,
                PodName = j.UcjbPodname,
                ClientRefA = j.UcjbClientRefa,
                ClientRefB = j.UcjbClientRefb,
                OurRef = j.UcjbOurRef,
                Notes = j.UcjbNotes,
                DeliveryCompany = j.DeliveryAddressLine1,
                DeliveryAddress = j.DeliveryAddressLine2,
                DeliveryCity = j.DeliveryAddressLine5,
                DeliveryPostCode = j.DeliveryAddressLine7,
            })
            .ToListAsync();

        return new HistoricArchiveJobsPage
        {
            Total = total,
            Limit = limit,
            Offset = offset,
            Rows = rows,
        };
    }

    // ---- cell casting helpers ----

    private static string? Get(Dictionary<string, string?> raw, Dictionary<string, string> map, string field)
    {
        if (!map.TryGetValue(field, out var header)) return null;
        return raw.TryGetValue(header, out var v) ? v : null;
    }

    private static string RequireString(Dictionary<string, string?> raw, Dictionary<string, string> map, string field)
    {
        var v = Get(raw, map, field);
        if (string.IsNullOrWhiteSpace(v))
            throw new InvalidOperationException($"Required field '{field}' is missing or blank.");
        return v.Trim();
    }

    private static string? OptString(Dictionary<string, string?> raw, Dictionary<string, string> map, string field)
    {
        var v = Get(raw, map, field);
        return string.IsNullOrWhiteSpace(v) ? null : v.Trim();
    }

    private static int? OptInt(Dictionary<string, string?> raw, Dictionary<string, string> map, string field)
    {
        var v = Get(raw, map, field);
        if (string.IsNullOrWhiteSpace(v)) return null;
        if (int.TryParse(v.Trim(), NumberStyles.Any, CultureInfo.InvariantCulture, out var i)) return i;
        // some sources render integers as "5.0"
        if (double.TryParse(v.Trim(), NumberStyles.Any, CultureInfo.InvariantCulture, out var d)) return (int)d;
        throw new InvalidOperationException($"Field '{field}' value '{v}' is not an integer.");
    }

    private static short? OptShort(Dictionary<string, string?> raw, Dictionary<string, string> map, string field)
    {
        var i = OptInt(raw, map, field);
        if (i == null) return null;
        if (i.Value < short.MinValue || i.Value > short.MaxValue)
            throw new InvalidOperationException($"Field '{field}' value '{i}' overflows short.");
        return (short)i.Value;
    }

    private static double? OptDouble(Dictionary<string, string?> raw, Dictionary<string, string> map, string field)
    {
        var v = Get(raw, map, field);
        if (string.IsNullOrWhiteSpace(v)) return null;
        if (double.TryParse(v.Trim(), NumberStyles.Any, CultureInfo.InvariantCulture, out var d)) return d;
        throw new InvalidOperationException($"Field '{field}' value '{v}' is not a number.");
    }

    private static decimal? OptDecimal(Dictionary<string, string?> raw, Dictionary<string, string> map, string field)
    {
        var v = Get(raw, map, field);
        if (string.IsNullOrWhiteSpace(v)) return null;
        var trimmed = v.Trim().TrimStart('$').Replace(",", string.Empty, StringComparison.Ordinal);
        if (decimal.TryParse(trimmed, NumberStyles.Any, CultureInfo.InvariantCulture, out var m)) return m;
        throw new InvalidOperationException($"Field '{field}' value '{v}' is not a number.");
    }

    private static DateTime? OptDate(Dictionary<string, string?> raw, Dictionary<string, string> map, string field)
    {
        var v = Get(raw, map, field);
        if (string.IsNullOrWhiteSpace(v)) return null;
        if (DateTime.TryParse(v, CultureInfo.InvariantCulture, DateTimeStyles.None, out var dt)) return dt;
        if (DateTime.TryParse(v, CultureInfo.CurrentCulture, DateTimeStyles.None, out dt)) return dt;
        // Excel serial dates (days since 1899-12-30) surface as double text
        if (double.TryParse(v, NumberStyles.Any, CultureInfo.InvariantCulture, out var serial))
            return DateTime.FromOADate(serial);
        throw new InvalidOperationException($"Field '{field}' value '{v}' is not a date.");
    }

    private static DateTime RequireDate(Dictionary<string, string?> raw, Dictionary<string, string> map, string field)
    {
        return OptDate(raw, map, field)
            ?? throw new InvalidOperationException($"Required field '{field}' is missing or not a valid date.");
    }

    /// <summary>Resolve a text name column to an integer FK via the
    /// preloaded lookup dict. Returns null if the field is unmapped,
    /// the value is blank, or the name is not present in the dict
    /// (case-insensitive match; leading/trailing whitespace trimmed).
    /// Deliberately does NOT throw on unresolved names - historic
    /// imports commonly carry legacy service / vehicle labels that
    /// don't exist in the current catalogue, and losing the FK is
    /// less destructive than rejecting the whole row.</summary>
    private static int? LookupOptional(
        Dictionary<string, string?> raw,
        Dictionary<string, string> map,
        string field,
        Dictionary<string, int> lookup)
    {
        var v = Get(raw, map, field);
        if (string.IsNullOrWhiteSpace(v)) return null;
        return lookup.TryGetValue(v.Trim(), out var id) ? id : (int?)null;
    }

    // ---- request-scoped context ----

    private string ResolveTenantCode()
    {
        var claim = httpContextAccessor.HttpContext?.User
            ?.FindFirst("TenantCode")?.Value
            ?? httpContextAccessor.HttpContext?.User
                ?.FindFirst("CurrentTenantID")?.Value;
        return string.IsNullOrWhiteSpace(claim) ? "unknown" : claim.Trim();
    }
}
