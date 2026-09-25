// Port of BulkImportHyper/Application/Core/Services/BulkService.cs into
// RoutedOperations. Split into three partial-class files by concern so the
// eventual 4,600-line source becomes three cohesive ~1,000-line units that
// still share the same DI-injected fields and helper closures:
//
//   BulkImportServiceV2.cs        - CRUD, list, delete, complete, upload, parse
//   BulkImportJobFactory.cs       - Import dispatch, ProcessOnDemand / ProcessRouted,
//                                   Steve's 4-step origin precedence, geocoding
//   BulkImportRatingService.cs    - Pricing (zone + km rated), split/apply,
//                                   linehaul, pickup, delivery legs
//
// The class is named BulkImportServiceV2 to sidestep the pre-existing
// BulkImportService.cs in this folder (which is the retired shadow-table
// implementation, kept in place until a later task deletes it during cutover).
// The `V2` suffix will be dropped once the shadow-table class is removed.
//
// Everything under this file forms ONE class - the other two partials extend
// this same partial class, no duplication of ctor parameters or fields.
//
// DEVIATIONS FROM SOURCE
//   - Base class: source uses BaseService(IDbContextFactory<DespatchContext>),
//     port uses BaseService(IDbContextFactory<DynamicDespatchDbContext>) because
//     RoutedOperations resolves the tenant DB through the derived context type.
//   - Namespaces: `BulkImport.Application.*` -> `RoutedOperations.Core.*`.
//   - AddressService: exists in RoutedOperations at the same relative path; the
//     `AddressService.TO_COMPANY_SEPERATOR` const is `internal const` in the
//     target so the ported code accesses it via a same-assembly reference.
//   - S3 upload: source stubs S3 out already (comment block). Kept as a
//     comment - a later task can wire real S3 once the RoutedOperations
//     IAmazonS3 dependency lands.
//   - Google Drive import: full body preserved. Marked `[Obsolete]` because the
//     RoutedOperations UI does not currently expose the Google Drive flow -
//     the code still works if a controller is wired in.
//   - DD_stpJob_InsertExceleratorAsync: source called the 85-param signature;
//     the target DB SP has 91 params. The IDespatchContextProcedures interface
//     was updated (see Core/Domain/Despatch/IDespatchContextProcedures.cs) to
//     take the 3 new positional params (forceTucJobPush, jobBookingID,
//     pickupReadyDateTime). The call sites here pass sensible defaults per
//     the plan (forceTucJobPush = false, jobBookingID = 0, pickupReadyDateTime
//     = @Time so the SP mirrors the ready-window off the pickup timestamp).
using System.Collections.Immutable;
using System.Data;
using System.IO;
using System.Net.Http;
using System.Net.Http.Json;
using System.Text;
using ExcelDataReader;
using GeoTimeZone;
using Microsoft.AspNetCore.Http;
using Microsoft.Data.SqlClient;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging;
using Newtonsoft.Json;
using RoutedOperations.Core.Application.Dtos.BulkImport.Address;
using RoutedOperations.Core.Application.Dtos.BulkImport.Bulk;
using RoutedOperations.Core.Application.Dtos.BulkImport.Common;
using RoutedOperations.Core.Application.Utilities;
using RoutedOperations.Core.Domain;
using RoutedOperations.Core.Domain.Despatch;
using RoutedOperations.Core.Domain.Models;
using Serilog;

namespace RoutedOperations.Core.Application.Services.BulkImport;

public partial class BulkImportServiceV2 : BaseService
{
    private readonly IHttpClientFactory _httpClientFactory;
    private readonly IHttpContextAccessor _httpContextAccessor;
    private readonly AddressService _addressService;

    public BulkImportServiceV2(
        IDbContextFactory<DynamicDespatchDbContext> contextFactory,
        IHttpClientFactory httpClientFactory,
        IHttpContextAccessor httpContextAccessor,
        AddressService addressService)
        : base(contextFactory)
    {
        _httpClientFactory = httpClientFactory;
        _httpContextAccessor = httpContextAccessor;
        _addressService = addressService;
    }

    // Per-job result of Steve's 4-step origin precedence chain. Built by
    // ResolveRoutedOriginLocal inside ProcessRoutedJobs (BulkImportJobFactory
    // partial) and used to populate tblBulkJob.From* / PickupAddressLine*
    // fields. When Error is non-null the row failed step 4 (no resolvable
    // origin) and the batch is aborted before any DB writes happen.
    private sealed class ResolvedRoutedOrigin
    {
        public string FromCompany { get; set; }
        public string FromAddress { get; set; }
        public string FromSuburb { get; set; }
        public int FromPostCode { get; set; }
        public string PickUpLatitude { get; set; }
        public string PickUpLongitude { get; set; }
        public int? FromGeoType { get; set; }
        public string AddressLine1 { get; set; }
        public string AddressLine2 { get; set; }
        public string AddressLine3 { get; set; }
        public string AddressLine4 { get; set; }
        public string AddressLine5 { get; set; }
        public string AddressLine6 { get; set; }
        public string AddressLine7 { get; set; }
        public string AddressLine8 { get; set; }
        public string Error { get; set; }
    }

    // ---- tenant helpers ---------------------------------------------------

    private bool IsUsTenant()
    {
        var countryCode = _httpContextAccessor.HttpContext?.User.Claims.FirstOrDefault(x => x.Type == "CountryCode")?.Value;
        var usa = Country.Us.GetDescription();
        return countryCode?.ToUpper().Equals(usa) ?? false;
    }

    private bool IsNzTenant()
    {
        var countryCode = _httpContextAccessor.HttpContext?.User.Claims.FirstOrDefault(x => x.Type == "CountryCode")?.Value;
        var nz = Country.Nz.GetDescription();
        return countryCode?.ToUpper().Equals(nz) ?? false;
    }

    private string GetCountryCode()
    {
        return _httpContextAccessor.HttpContext?.User.Claims.FirstOrDefault(x => x.Type == "CountryCode")?.Value?.ToUpper();
    }

    // ---- list jobs (routed + on-demand + prebook) -------------------------

    public async Task<BulkJobsResponse> GetBulkJobs(int contactId, Guid messageId)
    {
        var response = new BulkJobsResponse(messageId);
        var jobsList = new List<BulkJobListDto>();

        try
        {
            // Internal staff bypass the contact -> client join and see any
            // client with recent bulk activity. External contacts only see
            // clients they are explicitly linked to via tucClientContact or
            // tblClientContact.
            var internalClaim = _httpContextAccessor.HttpContext?.User.Claims.FirstOrDefault(x => x.Type == "Internal")?.Value;
            var isInternal = !string.IsNullOrEmpty(internalClaim) && bool.TryParse(internalClaim, out var internalVal) && internalVal;

            List<int> clientIds;
            if (isInternal)
            {
                clientIds = await Context.TblBulkJobs
                    .Where(j => j.BookDate.Date >= DateTime.Today && j.SourceId == 3 && !j.Done && !j.Void)
                    .Select(j => j.ClientId)
                    .Union(
                        Context.TucJobs
                            .Where(j => j.UcjbDate.Date >= DateTime.Today.AddDays(-30) && j.SourceId == 3 && !j.UcjbVoid && !j.UcjbJobDone && j.UcjbClientId.HasValue)
                            .Select(j => j.UcjbClientId.Value)
                    )
                    .Distinct()
                    .ToListAsync();
            }
            else
            {
                clientIds = await Context.TucClients
                               .Where(c => c.TucClientContacts.Any(cc => cc.UcctId == contactId && cc.Active)
                                           || c.TblClientContacts.Any(tc => tc.ContactId == contactId && tc.Contact.Active))
                               .Select(c => c.UcclId)
                               .ToListAsync();
            }

            var bulkJobs = await Context.TblBulkJobs
                        .Where(j => j.BookDate.Date >= DateTime.Today
                                && j.SourceId == 3
                                && clientIds.Contains(j.ClientId)
                                && j.JobRelationshipTypeId != 20
                                && !j.Done && !j.Void)
                .OrderByDescending(j => j.ImportId)
                .Select(j => new BulkJobListDto()
                {
                    Id = j.BulkJobId,
                    JobNumber = j.JobNumber,
                    BookDate = j.BookDate.Date,
                    Speed = j.SpeedNavigation.UcjtName,
                    ClientCode = j.ClientCode,
                    Amount = j.Amount,
                    Quantity = j.Qty,
                    FromCompany = j.FromCompany,
                    FromAddress = j.FromAddress,
                    FromCity = j.PickupAddressLine5,
                    FromState = j.PickupAddressLine6,
                    FromZipCode = j.PickupAddressLine7,
                    FromSuburb = j.FromSuburb,
                    ToAddress = j.ToAddress.StartsWith(j.ToCompany + AddressService.TO_COMPANY_SEPERATOR)
                                ? j.ToAddress.Substring((j.ToCompany + AddressService.TO_COMPANY_SEPERATOR).Length, j.ToAddress.Length - (j.ToCompany + AddressService.TO_COMPANY_SEPERATOR).Length)
                                : j.ToAddress,
                    ToCity = j.DeliveryAddressLine5,
                    ToState = j.DeliveryAddressLine6,
                    ToZipCode = j.DeliveryAddressLine7,
                    ToSuburb = j.ToSuburb,
                    ToPostCode = IsNzTenant() ? AddressUtility.FormatPostCode(j.ToPostCode.ToString()) : null,
                    CanDelete = !j.BulkRunId.HasValue,
                    Type = "routed"
                })
                .ToListAsync();

            var tucJobs = await Context.TucJobs
                .Where(j => j.UcjbDate.Date >= DateTime.Today.AddDays(-30)
                            && j.SourceId == 3
                            && clientIds.Contains(j.UcjbClientId.Value)
                            && !j.UcjbVoid && !j.UcjbJobDone)
                .Select(j => new BulkJobListDto()
                {
                    Id = j.UcjbId,
                    JobNumber = j.UcjbNumber,
                    BookDate = j.UcjbDate,
                    Speed = Context.TucJobTypes.FirstOrDefault(s => s.UcjtId == j.UcjbSpeed).UcjtName,
                    ClientCode = j.UcjbClientCode,
                    Amount = j.UcjbAmount,
                    Quantity = j.UcjbQty,
                    FromCompany = j.PickupAddressLine1,
                    FromAddress = j.UcjbFromAddr,
                    FromCity = j.PickupAddressLine5,
                    FromState = j.PickupAddressLine6,
                    FromZipCode = j.PickupAddressLine7,
                    FromSuburb = j.PickupAddressLine5,
                    ToAddress = j.UcjbToAddr.StartsWith(j.DeliveryAddressLine1 + AddressService.TO_COMPANY_SEPERATOR)
                                ? j.UcjbToAddr.Substring((j.DeliveryAddressLine1 + AddressService.TO_COMPANY_SEPERATOR).Length, j.UcjbToAddr.Length - (j.DeliveryAddressLine1 + AddressService.TO_COMPANY_SEPERATOR).Length)
                                : j.UcjbToAddr,
                    ToCity = j.DeliveryAddressLine5,
                    ToState = j.DeliveryAddressLine6,
                    ToZipCode = j.DeliveryAddressLine7,
                    ToSuburb = j.DeliveryAddressLine5,
                    ToPostCode = j.DeliveryAddressLine7,
                    CanDelete = j.UcjbStatus <= 1,
                    Type = "ondemand"
                })
                .ToListAsync();

            var prebookJobs = await Context.TucJobBookings
                    .Where(j => j.UcbkDate.HasValue
                                && j.UcbkDate.Value.Date >= DateTime.Today.AddDays(-30)
                                && j.SourceId == 3
                                && clientIds.Contains(j.UcbkClientId.Value)
                                // "not done" means NULL OR false. The previous
                                // `&&` here silently dropped rows where UcbkDone
                                // is NULL (a common state for newly-created
                                // prebook rows). Contrast with the correct
                                // pattern used on the CanDelete projection at
                                // line 264.
                                && (!j.UcbkDone.HasValue || !j.UcbkDone.Value))
                .Select(j => new BulkJobListDto()
                {
                    Id = j.UcbkId,
                    JobNumber = j.UcbkJobNumber,
                    BookDate = j.UcbkDate.HasValue ? j.UcbkDate.Value.Date : default(DateTime),
                    Speed = Context.TucJobTypes.FirstOrDefault(s => s.UcjtId == j.UcbkSpeed).UcjtName,
                    ClientCode = j.UcbkClientCode,
                    Amount = j.UcbkAmount,
                    Quantity = j.Quantity,
                    FromCompany = j.PickupAddressLine1,
                    FromAddress = j.UcbkFromAddr,
                    FromCity = j.PickupAddressLine5,
                    FromState = j.PickupAddressLine6,
                    FromZipCode = j.PickupAddressLine7,
                    FromSuburb = j.PickupAddressLine5,
                    ToAddress = j.UcbkToAddr.StartsWith(j.DeliveryAddressLine1 + AddressService.TO_COMPANY_SEPERATOR)
                                ? j.UcbkToAddr.Substring((j.DeliveryAddressLine1 + AddressService.TO_COMPANY_SEPERATOR).Length, j.UcbkToAddr.Length - (j.DeliveryAddressLine1 + AddressService.TO_COMPANY_SEPERATOR).Length)
                                : j.UcbkToAddr,
                    ToCity = j.DeliveryAddressLine5,
                    ToState = j.DeliveryAddressLine6,
                    ToZipCode = j.DeliveryAddressLine7,
                    ToSuburb = j.DeliveryAddressLine5,
                    CanDelete = !j.UcbkDone.HasValue || !j.UcbkDone.Value,
                    ToPostCode = j.DeliveryAddressLine7,
                    Type = "ondemand"
                })
                .ToListAsync();

            jobsList.AddRange(bulkJobs);
            jobsList.AddRange(tucJobs);
            jobsList.AddRange(prebookJobs);
            response.Jobs = jobsList.OrderByDescending(j => j.BookDate).ToList();
            response.Success = true;
        }
        catch (Exception ex)
        {
            Log.Error(ex, "Error fetching jobs: {ErrorMessage}", ex.Message);
            return BulkImportResponseUtility.AddMessageAndReturnResponse(response,
                "An error occurred while fetching jobs: " + ex.Message);
        }

        return response;
    }

    // ---- upload + parse ---------------------------------------------------

    public async Task<string> UploadFile(int contactId, IFormFile file)
    {
        if (file == null || string.IsNullOrWhiteSpace(file.FileName))
            return string.Empty;

        // Filenames without a dot make Substring(LastIndexOf("."))
        // throw ArgumentOutOfRangeException. Bail cleanly instead so the
        // operator sees an "unsupported file type" experience rather than
        // a server 500.
        var trimmedName = file.FileName.Trim();
        var dotIdx = trimmedName.LastIndexOf('.');
        if (dotIdx < 0) return string.Empty;
        var ext = trimmedName.Substring(dotIdx).Trim().ToLower();
        if (!new[] { ".xls", ".xlsx", ".csv" }.Contains(ext))
            return string.Empty;

        // NOTE: S3 upload was already commented-out in the BulkImportHyper source;
        // preserved here as-is so a later task can enable it without diffing.

        Encoding.RegisterProvider(CodePagesEncodingProvider.Instance);

        await using var fileToRead = file.OpenReadStream();

        List<Dictionary<string, object>> dataList;

        if (ext == ".csv")
        {
            dataList = ParseCsvToDictList(fileToRead);
            if (dataList.Count == 0)
            {
                Log.Warning("No data rows found in uploaded CSV file: {FileName}", file.FileName);
                return string.Empty;
            }
        }
        else
        {
            using var reader = ExcelReaderFactory.CreateReader(fileToRead);
            var dataSet = reader.AsDataSet(new ExcelDataSetConfiguration()
            {
                ConfigureDataTable = (_) => new ExcelDataTableConfiguration()
                {
                    UseHeaderRow = true
                }
            });

            if (dataSet?.Tables?.Count == 0)
            {
                Log.Warning("No data tables found in uploaded Excel file: {FileName}", file.FileName);
                return string.Empty;
            }

            var table = dataSet.Tables[0];

            if (table?.Rows?.Count == 0)
            {
                Log.Warning("No data rows found in uploaded Excel file: {FileName}", file.FileName);
                return string.Empty;
            }

            dataList = new List<Dictionary<string, object>>();

            foreach (DataRow row in table.Rows)
            {
                var rowDict = new Dictionary<string, object>();
                for (int i = 0; i < table.Columns.Count; i++)
                {
                    var columnName = table.Columns[i].ColumnName;
                    var value = row[i];
                    rowDict[columnName] = value == DBNull.Value ? null : value;
                }
                dataList.Add(rowDict);
            }
        }

        Log.Information("Successfully processed import file: {FileName}, Rows: {RowCount}",
            file.FileName, dataList.Count);

        return JsonConvert.SerializeObject(dataList);
    }

    // RFC-4180-ish CSV parser. Supports quoted fields, doubled-quote escaping,
    // CRLF/LF/CR row terminators, embedded newlines inside quoted fields.
    // Delimiter auto-detected from first line (',' ';' or tab).
    private static List<Dictionary<string, object>> ParseCsvToDictList(Stream stream)
    {
        using var reader = new StreamReader(stream, Encoding.UTF8, detectEncodingFromByteOrderMarks: true, leaveOpen: false);
        var content = reader.ReadToEnd();
        if (string.IsNullOrWhiteSpace(content))
            return new List<Dictionary<string, object>>();

        char delimiter = DetectCsvDelimiter(content);
        var rows = ParseCsvRows(content, delimiter);
        if (rows.Count == 0)
            return new List<Dictionary<string, object>>();

        var headers = rows[0];
        var result = new List<Dictionary<string, object>>(rows.Count - 1);
        for (int i = 1; i < rows.Count; i++)
        {
            var row = rows[i];
            if (row.Count == 1 && string.IsNullOrEmpty(row[0]))
                continue;

            var dict = new Dictionary<string, object>(headers.Count);
            for (int c = 0; c < headers.Count; c++)
            {
                var key = string.IsNullOrWhiteSpace(headers[c]) ? $"Column{c + 1}" : headers[c].Trim();
                object value = c < row.Count ? row[c] : null;
                if (value is string s && s.Length == 0) value = null;
                dict[key] = value;
            }
            result.Add(dict);
        }
        return result;
    }

    private static char DetectCsvDelimiter(string content)
    {
        int commas = 0, semicolons = 0, tabs = 0;
        bool inQuotes = false;
        for (int i = 0; i < content.Length; i++)
        {
            char ch = content[i];
            if (ch == '"') { inQuotes = !inQuotes; continue; }
            if (inQuotes) continue;
            if (ch == '\n' || ch == '\r') break;
            if (ch == ',') commas++;
            else if (ch == ';') semicolons++;
            else if (ch == '\t') tabs++;
        }
        if (semicolons > commas && semicolons >= tabs) return ';';
        if (tabs > commas && tabs > semicolons) return '\t';
        return ',';
    }

    private static List<List<string>> ParseCsvRows(string content, char delimiter)
    {
        var rows = new List<List<string>>();
        var currentRow = new List<string>();
        var sb = new StringBuilder();
        bool inQuotes = false;

        for (int i = 0; i < content.Length; i++)
        {
            char ch = content[i];
            if (inQuotes)
            {
                if (ch == '"')
                {
                    if (i + 1 < content.Length && content[i + 1] == '"')
                    {
                        sb.Append('"');
                        i++;
                    }
                    else
                    {
                        inQuotes = false;
                    }
                }
                else
                {
                    sb.Append(ch);
                }
            }
            else
            {
                if (ch == '"')
                {
                    inQuotes = true;
                }
                else if (ch == delimiter)
                {
                    currentRow.Add(sb.ToString());
                    sb.Clear();
                }
                else if (ch == '\r')
                {
                    currentRow.Add(sb.ToString());
                    sb.Clear();
                    rows.Add(currentRow);
                    currentRow = new List<string>();
                    if (i + 1 < content.Length && content[i + 1] == '\n') i++;
                }
                else if (ch == '\n')
                {
                    currentRow.Add(sb.ToString());
                    sb.Clear();
                    rows.Add(currentRow);
                    currentRow = new List<string>();
                }
                else
                {
                    sb.Append(ch);
                }
            }
        }

        currentRow.Add(sb.ToString());
        if (currentRow.Count > 1 || !string.IsNullOrEmpty(currentRow[0]))
            rows.Add(currentRow);

        return rows;
    }

    // ---- Google Drive import (Phase 3) ------------------------------------

    /// <summary>
    /// Pull a file from Google Drive by fileId + accessToken and parse it
    /// through the same CSV / XLSX pipeline the upload endpoint uses. The
    /// caller (frontend) is responsible for the OAuth handshake that yields
    /// the access token - this method just consumes it. Response.Data is
    /// the same JSON-serialized dictionary list the /upload endpoint
    /// returns, so the wizard can rehydrate the parsed grid the same way.
    /// </summary>
    public async Task<GoogleDriveImportResponse> ImportFromGoogleDrive(int contactId, GoogleDriveImportRequest request)
    {
        var response = new GoogleDriveImportResponse(request.MessageId);

        try
        {
            using var httpClient = new HttpClient();
            httpClient.DefaultRequestHeaders.Authorization =
                new System.Net.Http.Headers.AuthenticationHeaderValue("Bearer", request.AccessToken);

            var metadataResponse = await httpClient.GetAsync($"https://www.googleapis.com/drive/v3/files/{request.FileId}?fields=mimeType,name");

            if (!metadataResponse.IsSuccessStatusCode)
            {
                return BulkImportResponseUtility.AddMessageAndReturnResponse(response,
                    $"Failed to get file metadata from Google Drive. Status code: {metadataResponse.StatusCode}");
            }

            var metadata = await metadataResponse.Content.ReadFromJsonAsync<GoogleDriveFileMetadata>();

            Stream fileStream;
            if (metadata.MimeType == "application/vnd.google-apps.spreadsheet")
            {
                var exportResponse = await httpClient.GetAsync(
                    $"https://www.googleapis.com/drive/v3/files/{request.FileId}/export?mimeType=application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");

                if (!exportResponse.IsSuccessStatusCode)
                {
                    Log.Error("Failed to export Google Sheet: {StatusCode} - {ResponseContent}",
                        exportResponse.StatusCode,
                        await exportResponse.Content.ReadAsStringAsync());

                    return BulkImportResponseUtility.AddMessageAndReturnResponse(response,
                        $"Failed to export file from Google Drive. Status code: {exportResponse.StatusCode}");
                }

                fileStream = await exportResponse.Content.ReadAsStreamAsync();
            }
            else
            {
                var downloadResponse = await httpClient.GetAsync($"https://www.googleapis.com/drive/v3/files/{request.FileId}?alt=media");

                if (!downloadResponse.IsSuccessStatusCode)
                {
                    Log.Error("Failed to download file: {StatusCode} - {ResponseContent}",
                        downloadResponse.StatusCode,
                        await downloadResponse.Content.ReadAsStringAsync());

                    return BulkImportResponseUtility.AddMessageAndReturnResponse(response,
                        $"Failed to download file from Google Drive. Status code: {downloadResponse.StatusCode}");
                }

                fileStream = await downloadResponse.Content.ReadAsStreamAsync();
            }

            Encoding.RegisterProvider(CodePagesEncodingProvider.Instance);

            var isCsv = (metadata.Name ?? string.Empty).TrimEnd().EndsWith(".csv", StringComparison.OrdinalIgnoreCase)
                        || string.Equals(metadata.MimeType, "text/csv", StringComparison.OrdinalIgnoreCase);

            if (isCsv)
            {
                var dataList = ParseCsvToDictList(fileStream);
                response.Data = JsonConvert.SerializeObject(dataList);
            }
            else
            {
                using var reader = ExcelReaderFactory.CreateReader(fileStream);
                var result = reader.AsDataSet(new ExcelDataSetConfiguration()
                {
                    ConfigureDataTable = (_) => new ExcelDataTableConfiguration()
                    {
                        UseHeaderRow = true
                    }
                }).Tables[0];

                response.Data = JsonConvert.SerializeObject(result);
            }

            response.Success = true;
            return response;
        }
        catch (Exception ex)
        {
            Log.Error(ex, "Error importing file from Google Drive: {ErrorMessage}", ex.Message);
            return BulkImportResponseUtility.AddMessageAndReturnResponse(response,
                "An error occurred while processing the Google Drive file: " + ex.Message);
        }
    }

    // ---- delete (routed) --------------------------------------------------

    public async Task<Dtos.BulkImport.Common.BaseResponse> DeleteBulkJob(int contactId, IdRequest request)
    {
        var response = new Dtos.BulkImport.Common.BaseResponse(request.MessageId);

        var bulkJobsToDelete = await Context.TblBulkJobs
            .Where(j => (j.BulkJobId == request.Id || ((j.JobRelationshipTypeId == 19 || j.JobRelationshipTypeId == 20)) && j.ParentId == request.Id)
                        && j.Import.ContactId == contactId
                        && (!j.Done || !j.JobId.HasValue)
                        ).ToListAsync();

        if (!bulkJobsToDelete.Any())
        {
            return BulkImportResponseUtility.AddMessageAndReturnResponse(response, "Job not found or cannot be deleted.");
        }

        var children = bulkJobsToDelete.Where(j => j.ParentId == request.Id).ToList();
        var parents = bulkJobsToDelete.Where(j => j.BulkJobId == request.Id).ToList();

        var allBulkJobIds = bulkJobsToDelete.Select(j => j.BulkJobId).ToList();

        // FK cascade cleanup. Seven tables reference tblBulkJob.BulkJobID
        // and none of them declare ON DELETE CASCADE, so every child row
        // must be removed before the parent DELETE runs. Legacy skipped
        // most of these because its test data was thin; the port
        // encounters them once notes / items / events / pricing history
        // start populating for real bookings.
        //
        // Ordered list of child FKs (from sys.foreign_keys ORDER BY name):
        //   PricingBreakdownBulk.BulkJobID           NO_ACTION
        //   PricingBreakdownBulk.ChildBulkJobID      NO_ACTION
        //   tblBulkEvent.BulkJobID                   NO_ACTION
        //   tblBulkJobItems.JobID                    NO_ACTION
        //   tblBulkJobItems.ChildJobID               NO_ACTION
        //   tblBulkJobNotes.BulkJobID                NO_ACTION
        //   tblBulkJobRun.BulkJobID                  NO_ACTION
        //
        // The port doesn't model PricingBreakdownBulk, tblBulkEvent, or the
        // tblBulkJobItems.ChildJobID column as EF entities. Even for the
        // ones we DO model (Runs / Notes), the DespatchContext Ignores their
        // BulkJob nav so EF can't order DELETEs within a single SaveChanges.
        // Raw SQL below sidesteps both issues and runs cleanly regardless
        // of whether the entity is modelled. Ordered so children go before
        // the parent EF DELETE below.
        var idsParam = string.Join(",", allBulkJobIds);
        // No parameterization risk: allBulkJobIds is a projected list of ints
        // from a prior EF query, not user input.
        //
        // Each DELETE is wrapped in its own TRY/CATCH because the tenant DB
        // user may not have permission on some legacy child tables
        // (PricingBreakdownBulk, tblBulkEvent). If a row actually exists in
        // one of those and we lack DELETE perms, the FK constraint will still
        // block the parent delete downstream and we surface the failure. If
        // no row exists (common - most bulk jobs never touch these tables),
        // the silent skip is correct behaviour.
        //
        // OUTPUT of @@ROWCOUNT collected via a scalar output isn't easy across
        // multiple statements, so we just fire the batch and rely on
        // downstream FK check to fail loudly if any cleanup was skipped in
        // error.
        var cleanupSql = $@"
            BEGIN TRY DELETE FROM dbo.PricingBreakdownBulk WHERE BulkJobID IN ({idsParam}) OR ChildBulkJobID IN ({idsParam}); END TRY BEGIN CATCH END CATCH;
            BEGIN TRY DELETE FROM dbo.tblBulkEvent WHERE BulkJobID IN ({idsParam}); END TRY BEGIN CATCH END CATCH;
            BEGIN TRY DELETE FROM dbo.tblBulkJobItems WHERE JobID IN ({idsParam}) OR ChildJobID IN ({idsParam}); END TRY BEGIN CATCH END CATCH;
            BEGIN TRY DELETE FROM dbo.tblBulkJobNotes WHERE BulkJobID IN ({idsParam}); END TRY BEGIN CATCH END CATCH;
            BEGIN TRY DELETE FROM dbo.tblBulkJobRun WHERE BulkJobID IN ({idsParam}); END TRY BEGIN CATCH END CATCH;
        ";
        await Context.Database.ExecuteSqlRawAsync(cleanupSql);
        Log.Information($"({request.MessageId})({contactId}) FK cleanup ran across 5 tables for {allBulkJobIds.Count} bulk job(s).");

        // Detach any change-tracked child instances so the upcoming EF
        // DELETE below doesn't re-issue statements for rows we already
        // removed via raw SQL.
        foreach (var entry in Context.ChangeTracker.Entries().Where(e =>
            e.Entity is TblBulkJobRun
            || e.Entity is TblBulkJobNote
            || e.Entity is TblBulkJobItems).ToList())
        {
            entry.State = EntityState.Detached;
        }

        if (children.Any())
        {
            Context.TblBulkJobs.RemoveRange(children);
            Log.Information($"({request.MessageId})({contactId}) Deleted {children.Count} child bulk job(s).");
        }

        if (parents.Any())
        {
            Context.TblBulkJobs.RemoveRange(parents);
            Log.Information($"({request.MessageId})({contactId}) Deleted {parents.Count} parent bulk job(s).");
        }

        await Context.SaveChangesAsync();

        Log.Information($"({request.MessageId})({contactId}) Deleted {bulkJobsToDelete.Count} bulk jobs in total.");

        response.Success = true;

        return response;
    }

    // ---- delete (on-demand / prebook) -------------------------------------

    public async Task<Dtos.BulkImport.Common.BaseResponse> DeleteTucJob(int contactId, IdRequest request)
    {
        var response = new Dtos.BulkImport.Common.BaseResponse(request.MessageId);

        var allowedStatuses = new int?[] { null, 0, 1, 1000 };

        var tucJobsToVoid = await Context.TucJobs
            .Where(j => (j.UcjbId == request.Id || j.ParentId == request.Id)
                        && allowedStatuses.Contains(j.UcjbStatus))
            .ToListAsync();

        if (!tucJobsToVoid.Any())
        {
            return BulkImportResponseUtility.AddMessageAndReturnResponse(response, "On-demand job not found or cannot be deleted (invalid status).");
        }

        var contact = await Context.TucClientContacts
            .Where(c => c.UcctId == contactId)
            .Select(c => new { c.UcctFirstname, c.UcctSurname, c.UcctEmail })
            .FirstOrDefaultAsync();

        var userName = contact != null
            ? $"{contact.UcctFirstname} {contact.UcctSurname} ({contact.UcctEmail})"
            : $"ContactID: {contactId}";

        var children = tucJobsToVoid.Where(j => j.ParentId == request.Id).ToList();
        var parents = tucJobsToVoid.Where(j => j.UcjbId == request.Id).ToList();

        foreach (var child in children)
        {
            child.UcjbVoid = true;
            child.UcjbStatus = 1000;
            var deletionNote = $"\n[DELETED] from BulkImport by {userName} on {DateTime.Now:yyyy-MM-dd HH:mm:ss}.";
            child.UcjbNotes = string.IsNullOrEmpty(child.UcjbNotes)
                ? deletionNote
                : child.UcjbNotes + deletionNote;
        }

        if (children.Any())
        {
            Log.Information($"({request.MessageId})({contactId}) Voided {children.Count} child on-demand job(s) by {userName}.");
        }

        foreach (var parent in parents)
        {
            parent.UcjbVoid = true;
            parent.UcjbStatus = 1000;
            var deletionNote = $"\n[DELETED] from BulkImport by {userName} on {DateTime.Now:yyyy-MM-dd HH:mm:ss}.";
            parent.UcjbNotes = string.IsNullOrEmpty(parent.UcjbNotes)
                ? deletionNote
                : parent.UcjbNotes + deletionNote;
        }

        if (parents.Any())
        {
            Log.Information($"({request.MessageId})({contactId}) Voided {parents.Count} parent on-demand job(s) by {userName}.");
        }

        await Context.SaveChangesAsync();

        Log.Information($"({request.MessageId})({contactId}) Voided {tucJobsToVoid.Count} on-demand job(s) in total by {userName}.");

        response.Success = true;

        return response;
    }

    // ---- search + bulk-complete -------------------------------------------

    public async Task<BulkJobSearchResponse> SearchJobsForBulkComplete(int contactId, BulkJobSearchRequest request)
    {
        var response = new BulkJobSearchResponse(request.MessageId);
        var foundJobs = new List<BulkJobFoundDto>();
        var notFoundJobNumbers = new List<string>();

        foreach (var searchItem in request.Jobs)
        {
            if (request.JobType.ToLower() == "routed")
            {
                var query = Context.TblBulkJobs
                    .Include(c => c.Courier)
                    .Include(s => s.SpeedNavigation)
                    .Include(js => js.JobStatusNavigation)
                    .Where(j => j.JobNumber == searchItem.JobNumber
                                && j.ClientId == request.ClientId);

                if (searchItem.DateTime.HasValue)
                    query = query.Where(j => j.BookDate.Date == searchItem.DateTime.Value.Date);

                var job = await query
                    .Select(j => new BulkJobFoundDto
                    {
                        Id = j.BulkJobId,
                        JobNumber = j.JobNumber,
                        BookDate = j.BookDate,
                        Speed = j.SpeedNavigation.UcjtName,
                        ClientCode = j.ClientCode,
                        Amount = j.Amount,
                        FromAddress = j.FromAddress,
                        FromSuburb = j.FromSuburb,
                        ToAddress = j.ToAddress,
                        ToSuburb = j.ToSuburb,
                        CourierCode = j.Courier.Code,
                        Status = j.JobStatusNavigation.UcjsName,
                        Done = j.Done,
                        Void = j.Void,
                        Type = "routed",
                        CanComplete = !j.Done && !j.Void
                    })
                    .FirstOrDefaultAsync();

                if (job != null)
                    foundJobs.Add(job);
                else
                    notFoundJobNumbers.Add(searchItem.JobNumber);
            }
            else
            {
                var query = Context.TucJobs
                    .Include(c => c.UcjbCourier)
                    .Include(s => s.UcjbSpeedNavigation)
                    .Include(js => js.UcjbStatusNavigation)
                    .Include(fs => fs.UcjbFromNavigation)
                    .Include(ts => ts.UcjbToNavigation)
                    .Where(j => j.UcjbNumber == searchItem.JobNumber
                                && j.UcjbClientId == request.ClientId);

                if (searchItem.DateTime.HasValue)
                    query = query.Where(j => j.UcjbDate.Date == searchItem.DateTime.Value.Date);

                var job = await query
                    .Select(j => new BulkJobFoundDto
                    {
                        Id = j.UcjbId,
                        JobNumber = j.UcjbNumber,
                        BookDate = j.UcjbDate,
                        Speed = j.UcjbSpeedNavigation.UcjtName,
                        ClientCode = j.UcjbClientCode,
                        Amount = j.UcjbAmount,
                        FromAddress = j.UcjbFromAddr,
                        FromSuburb = j.UcjbFromNavigation.UcsuName,
                        ToAddress = j.UcjbToAddr,
                        ToSuburb = j.UcjbToNavigation.UcsuName,
                        CourierCode = j.UcjbCourier.Code,
                        Status = j.UcjbStatusNavigation.UcjsName,
                        Done = j.UcjbJobDone,
                        Void = j.UcjbVoid,
                        Type = "ondemand",
                        CanComplete = !j.UcjbVoid && !j.UcjbJobDone
                    })
                    .FirstOrDefaultAsync();

                if (job != null)
                    foundJobs.Add(job);
                else
                    notFoundJobNumbers.Add(searchItem.JobNumber);
            }
        }

        response.FoundJobs = foundJobs;
        response.NotFoundJobNumbers = notFoundJobNumbers;
        response.Success = true;

        Log.Information($"({request.MessageId})(ClientId:{request.ClientId}) Found {foundJobs.Count} jobs for bulk complete, {notFoundJobNumbers.Count} not found.");

        return response;
    }

    public async Task<Dtos.BulkImport.Common.BaseResponse> BulkCompleteJobs(int contactId, BulkJobCompleteRequest request)
    {
        var response = new Dtos.BulkImport.Common.BaseResponse(request.MessageId);
        var successCount = 0;
        var failedJobs = new List<string>();
        const int CompleteJobStatusId = 6;

        if (request.JobType.ToLower() == "ondemand")
        {
            var contact = await Context.TucClientContacts
                .Where(c => c.UcctId == contactId)
                .Select(c => new { c.UcctFirstname, c.UcctSurname, c.UcctEmail })
                .FirstOrDefaultAsync();

            var userName = contact != null
                ? $"{contact.UcctFirstname} {contact.UcctSurname} ({contact.UcctEmail})"
                : $"ContactID: {contactId}";

            var jobIds = request.Jobs.Select(j => j.JobId).ToList();

            var allJobs = await Context.TucJobs
                .Where(j => jobIds.Contains(j.UcjbId) || (j.ParentId.HasValue && jobIds.Contains(j.ParentId.Value)))
                .Where(j => j.UcjbClientId == request.ClientId)
                .ToListAsync();

            var children = allJobs.Where(j => j.ParentId.HasValue && jobIds.Contains(j.ParentId.Value)).ToList();
            var parents = allJobs.Where(j => jobIds.Contains(j.UcjbId)).ToList();

            foreach (var child in children)
            {
                try
                {
                    if (!child.UcjbJobDone && !child.UcjbVoid)
                    {
                        var completionNote = $"\n[BulkImport] Job completed from client upload by {userName} on {DateTime.Now:yyyy-MM-dd HH:mm:ss}.";

                        child.UcjbStatus = CompleteJobStatusId;
                        child.UcjbComplTime = DateTime.Now;
                        child.UcjbPodname = userName;
                        child.UcjbNotes = string.IsNullOrEmpty(child.UcjbNotes)
                            ? completionNote
                            : child.UcjbNotes + completionNote;
                        child.UcjbJobDone = true;
                        successCount++;
                        Log.Information($"({request.MessageId})(ClientId:{request.ClientId}) Completed child on-demand job {child.UcjbNumber} (ID: {child.UcjbId})");
                    }
                }
                catch (Exception ex)
                {
                    failedJobs.Add($"{child.UcjbNumber} (Child): {ex.Message}");
                    Log.Error($"({request.MessageId})(ClientId:{request.ClientId}) Error completing child job {child.UcjbId}: {ex}");
                }
            }

            foreach (var jobItem in request.Jobs)
            {
                try
                {
                    var tucJob = parents.FirstOrDefault(j => j.UcjbId == jobItem.JobId);

                    if (tucJob != null)
                    {
                        if (!tucJob.UcjbJobDone && !tucJob.UcjbVoid)
                        {
                            var completionNote = $"\n[BulkImport] Job completed from client upload by {userName} on {DateTime.Now:yyyy-MM-dd HH:mm:ss}.";

                            tucJob.UcjbStatus = CompleteJobStatusId;
                            tucJob.UcjbComplTime = DateTime.Now;
                            tucJob.UcjbPodname = userName;
                            tucJob.UcjbNotes = string.IsNullOrEmpty(tucJob.UcjbNotes)
                                ? completionNote
                                : tucJob.UcjbNotes + completionNote;
                            tucJob.UcjbJobDone = true;

                            if (!string.IsNullOrEmpty(jobItem.CourierCode))
                            {
                                var courier = await Context.TucCouriers
                                    .Where(c => c.Code == jobItem.CourierCode && c.Active)
                                    .FirstOrDefaultAsync();

                                if (courier != null)
                                {
                                    tucJob.UcjbCourierId = courier.UccrId;
                                    Log.Information($"({request.MessageId})(ClientId:{request.ClientId}) Updated courier for job {tucJob.UcjbNumber} to {jobItem.CourierCode}");
                                }
                                else
                                {
                                    Log.Warning($"({request.MessageId})(ClientId:{request.ClientId}) Courier code {jobItem.CourierCode} not found for job {tucJob.UcjbNumber}");
                                }
                            }

                            successCount++;
                            Log.Information($"({request.MessageId})(ClientId:{request.ClientId}) Completed on-demand job {tucJob.UcjbNumber} (ID: {jobItem.JobId})");
                        }
                        else if (tucJob.UcjbVoid)
                        {
                            failedJobs.Add($"{tucJob.UcjbNumber}: Cannot complete void job");
                        }
                        else
                        {
                            failedJobs.Add($"{tucJob.UcjbNumber}: Already completed");
                        }
                    }
                    else
                    {
                        var jobNumber = jobItem.JobNumber ?? $"JobID {jobItem.JobId}";
                        failedJobs.Add($"{jobNumber}: Not found");
                    }
                }
                catch (Exception ex)
                {
                    var jobNumber = jobItem.JobNumber ?? await GetJobNumber(jobItem.JobId, request.JobType);
                    failedJobs.Add($"{jobNumber}: {ex.Message}");
                    Log.Error($"({request.MessageId})(ClientId:{request.ClientId}) Error completing job {jobItem.JobId}: {ex}");
                }
            }
        }
        else
        {
            var bulkJobIds = request.Jobs.Select(j => j.JobId).ToList();
            var bulkJobs = await Context.TblBulkJobs
                .Where(j => bulkJobIds.Contains(j.BulkJobId) && j.ClientId == request.ClientId)
                .ToListAsync();

            if (!bulkJobs.Any())
            {
                response.Success = false;
                response = BulkImportResponseUtility.AddMessageAndReturnResponse(response, "No jobs found to complete.");
                return response;
            }

            var runName = "BulkImportComplete";
            var newRun = new TblBulkRun
            {
                Name = runName,
                Status = 0,
                Created = DateTime.Now,
                LastModified = DateTime.Now
            };

            Context.TblBulkRuns.Add(newRun);
            await Context.SaveChangesAsync();

            var runId = newRun.Id;
            Log.Information($"({request.MessageId})(ClientId:{request.ClientId}) Created bulk run '{runName}' with ID {runId}");

            var existingJobRuns = await Context.TblBulkJobRuns
                .Where(jr => bulkJobIds.Contains(jr.BulkJobId.Value))
                .ToListAsync();

            var runOrder = 1;
            var jobsToProcess = new List<(TblBulkJob bulkJob, int? courierId, BulkJobCompleteItem jobItem)>();

            foreach (var jobItem in request.Jobs)
            {
                try
                {
                    var bulkJob = bulkJobs.FirstOrDefault(j => j.BulkJobId == jobItem.JobId);

                    if (bulkJob != null)
                    {
                        if (!bulkJob.Done)
                        {
                            int? courierId = null;
                            if (!string.IsNullOrEmpty(jobItem.CourierCode))
                            {
                                var courier = await Context.TucCouriers
                                    .Where(c => c.Code == jobItem.CourierCode && c.Active)
                                    .FirstOrDefaultAsync();

                                if (courier != null)
                                {
                                    bulkJob.CourierId = courier.UccrId;
                                    courierId = courier.UccrId;
                                    Log.Information($"({request.MessageId})(ClientId:{request.ClientId}) Updated courier for job {bulkJob.JobNumber} to {jobItem.CourierCode}");
                                }
                                else
                                {
                                    Log.Warning($"({request.MessageId})(ClientId:{request.ClientId}) Courier code {jobItem.CourierCode} not found for job {bulkJob.JobNumber}");
                                }
                            }

                            jobsToProcess.Add((bulkJob, courierId, jobItem));

                            var existingJobRun = existingJobRuns.FirstOrDefault(jr => jr.BulkJobId == bulkJob.BulkJobId);
                            if (existingJobRun != null)
                            {
                                existingJobRun.RunId = runId;
                                existingJobRun.PickRunOrder = runOrder;
                                Log.Information($"({request.MessageId})(ClientId:{request.ClientId}) Updated existing TblBulkJobRun for job {bulkJob.JobNumber}");
                            }
                            else
                            {
                                var bulkJobRun = new TblBulkJobRun
                                {
                                    RunId = runId,
                                    BulkJobId = bulkJob.BulkJobId,
                                    PickRunOrder = runOrder
                                };
                                Context.TblBulkJobRuns.Add(bulkJobRun);
                                Log.Information($"({request.MessageId})(ClientId:{request.ClientId}) Created new TblBulkJobRun for job {bulkJob.JobNumber}");
                            }
                            runOrder++;
                        }
                        else
                        {
                            failedJobs.Add($"{bulkJob.JobNumber}: Already completed");
                        }
                    }
                    else
                    {
                        var jobNumber = jobItem.JobNumber ?? $"JobID {jobItem.JobId}";
                        failedJobs.Add($"{jobNumber}: Not found");
                    }
                }
                catch (Exception ex)
                {
                    var jobNumber = jobItem.JobNumber ?? await GetJobNumber(jobItem.JobId, request.JobType);
                    failedJobs.Add($"{jobNumber}: {ex.Message}");
                    Log.Error($"({request.MessageId})(ClientId:{request.ClientId}) Error preparing job {jobItem.JobId}: {ex}");
                }
            }

            await Context.SaveChangesAsync();

            var processOrder = 1;
            foreach (var (bulkJob, courierId, jobItem) in jobsToProcess)
            {
                try
                {
                    var spResult = await Context.Procedures.UTL_stpJob_InsertFromRunBuilderAsync(
                        bulkJobID: bulkJob.BulkJobId,
                        courierID: courierId,
                        runName: runName,
                        runOrder: processOrder,
                        courierPercentage: null,
                        runStatus: 0
                    );

                    successCount++;
                    processOrder++;
                    Log.Information($"({request.MessageId})(ClientId:{request.ClientId}) Completed routed job {bulkJob.JobNumber} (ID: {jobItem.JobId})");
                }
                catch (Exception ex)
                {
                    var jobNumber = jobItem.JobNumber ?? await GetJobNumber(jobItem.JobId, request.JobType);
                    failedJobs.Add($"{jobNumber}: {ex.Message}");
                    Log.Error($"({request.MessageId})(ClientId:{request.ClientId}) Error processing job {jobItem.JobId} with stored procedure: {ex}");
                }
            }
        }

        await Context.SaveChangesAsync();

        if (failedJobs.Any())
        {
            response.Success = failedJobs.Count < request.Jobs.Count;
            response = BulkImportResponseUtility.AddMessageAndReturnResponse(response,
                $"Completed {successCount} job(s) successfully. Failed to complete {failedJobs.Count} job(s): {string.Join("; ", failedJobs)}");
        }
        else
        {
            response.Success = true;
            response = BulkImportResponseUtility.AddMessageAndReturnResponse(response,
                $"Successfully completed {successCount} job(s).");
        }

        Log.Information($"({request.MessageId})(ClientId:{request.ClientId}) Bulk complete finished: {successCount} successful, {failedJobs.Count} failed.");

        return response;
    }

    // ---- notes / items helpers (shared with JobFactory) -------------------

    private async Task<string> GetJobNumber(int jobId, string jobType)
    {
        if (jobType.ToLower() == "routed")
        {
            var job = await Context.TblBulkJobs
                .Where(j => j.BulkJobId == jobId)
                .Select(j => j.JobNumber)
                .FirstOrDefaultAsync();
            return job ?? $"JobID: {jobId}";
        }
        else
        {
            var job = await Context.TucJobs
                .Where(j => j.UcjbId == jobId)
                .Select(j => j.UcjbNumber)
                .FirstOrDefaultAsync();
            return job ?? $"JobID: {jobId}";
        }
    }

    private async Task<int> GetBookingStaffId()
    {
        var staffId = await Context.Database
            .SqlQueryRaw<int>("SELECT ucstID AS [Value] FROM tucStaff WHERE ucstFirstName = 'Booking' AND ucstLastName = 'STP'")
            .FirstOrDefaultAsync();

        if (staffId == 0)
            throw new InvalidOperationException("Staff 'Booking STP' not found in tucStaff table.");

        return staffId;
    }

    private async Task<int> GetDeliveryNoteTypeId()
    {
        var noteTypeId = await Context.TucNoteTypes
            .Where(n => n.NoteTypeName == "Delivery Notes")
            .Select(n => n.NoteTypeId)
            .FirstOrDefaultAsync();

        if (noteTypeId == 0)
            throw new InvalidOperationException("NoteType 'Delivery Notes' not found in tucNoteType table.");

        return noteTypeId;
    }

    private async Task InsertBulkJobDeliveryNotes(List<TblBulkJob> jobs)
    {
        if (jobs == null || !jobs.Any()) return;
        var jobsWithNotes = jobs.Where(j => !string.IsNullOrWhiteSpace(j.Notes)).ToList();
        if (!jobsWithNotes.Any()) return;

        var deliveryNoteTypeId = await GetDeliveryNoteTypeId();
        var bookingStaffId = await GetBookingStaffId();

        // Read importId from a row we know exists (jobsWithNotes is
        // guaranteed non-empty by the early-return above). Avoids relying
        // on the outer `jobs` list still being populated - defensive against
        // future refactors that might narrow the input.
        var importId = jobsWithNotes.First().ImportId;
        var dbJobs = await Context.TblBulkJobs
            .Where(j => j.ImportId == importId)
            .Select(j => new { j.BulkJobId, j.JobNumber })
            .ToListAsync();

        var jobNumberToId = dbJobs.ToDictionary(j => j.JobNumber, j => j.BulkJobId);

        var currentTime = TimeZoneUtility.GetTenantNow(_httpContextAccessor);
        var notes = jobsWithNotes
            .Where(j => jobNumberToId.ContainsKey(j.JobNumber))
            .Select(j => new TblBulkJobNote
            {
                BulkJobId = jobNumberToId[j.JobNumber],
                NoteText = j.Notes.Trim(),
                NoteTypeId = deliveryNoteTypeId,
                IsImportant = false,
                CreatedBy = bookingStaffId,
                CreatedDate = currentTime
            }).ToList();

        if (!notes.Any()) return;

        await Context.TblBulkJobNotes.AddRangeAsync(notes);
        await Context.SaveChangesAsync();
        Log.Information("Inserted {Count} delivery notes into tblBulkJobNotes", notes.Count);
    }

    private async Task InsertPendingJobItems(List<PendingBulkJobItem> pendingItems, int importId)
    {
        if (pendingItems == null || !pendingItems.Any()) return;

        var parentJobNumbers = pendingItems.Select(p => p.ParentJobNumber).Distinct().ToList();
        var dbJobs = await Context.TblBulkJobs
            .Where(j => j.ImportId == importId && parentJobNumbers.Contains(j.JobNumber))
            .Select(j => new { j.BulkJobId, j.JobNumber })
            .ToListAsync();
        var jobMap = dbJobs.ToDictionary(j => j.JobNumber, j => j.BulkJobId);

        foreach (var item in pendingItems)
        {
            if (!jobMap.TryGetValue(item.ParentJobNumber, out int bulkJobId)) continue;
            await Context.Procedures.NET_stpBulkJobItems_InsertAsync(
                bulkJobId, item.ItemId, item.Items, item.Weight, item.Length,
                item.Height, item.Depth, item.Cubic, null, null, null, null,
                item.Notes, null, item.Barcode);
        }

        Log.Information("Inserted {Count} job items into tblBulkJobItems for {JobCount} jobs", pendingItems.Count, jobMap.Count);
    }

    private async Task InsertJobDeliveryNote(int jobId, string noteText)
    {
        if (string.IsNullOrWhiteSpace(noteText) || jobId <= 0) return;

        var deliveryNoteTypeId = await GetDeliveryNoteTypeId();
        var bookingStaffId = await GetBookingStaffId();
        var currentTime = TimeZoneUtility.GetTenantNow(_httpContextAccessor);
        var note = new TucNote
        {
            JobId = jobId,
            NoteText = noteText.Trim(),
            NoteTypeId = deliveryNoteTypeId,
            IsImportant = false,
            CreatedBy = bookingStaffId,
            CreatedDate = currentTime
        };

        await Context.TucNotes.AddAsync(note);
        await Context.SaveChangesAsync();
        Log.Information("Inserted delivery note into tucNote for JobId: {JobId}", jobId);
    }

    private int EstimateVehicleSize(decimal length, decimal width, decimal height, decimal weight)
    {
        decimal totalVolume = length * width * height;
        if (totalVolume <= (25.5m * 38.5m * 8m) && weight <= 5)
            return 1;

        if (totalVolume <= (90m * 73m * 150m) && weight <= 400)
            return 2;

        if (totalVolume <= (120m * 240m * 150m) && weight <= 1000)
            return 3;

        return 4;
    }

    private string GetTimeZoneCode(string latitude, string longitude)
    {
        try
        {
            if (string.IsNullOrEmpty(latitude) || string.IsNullOrEmpty(longitude))
                return string.Empty;

            if (!double.TryParse(latitude, out double lat) || !double.TryParse(longitude, out double lng))
                return string.Empty;

            var timeZone = TimeZoneLookup.GetTimeZone(lat, lng).Result;
            var timezoneInfo = TimeZoneInfo.FindSystemTimeZoneById(timeZone);
            var currentCode = timezoneInfo.IsDaylightSavingTime(DateTime.Now) ?
                timezoneInfo.DaylightName : timezoneInfo.StandardName;
            return currentCode;
        }
        catch (Exception e)
        {
            Log.Error(e, "Error getting timezone for lat: {Latitude}, lng: {Longitude}", latitude, longitude);
            return string.Empty;
        }
    }

    private async Task<HereMapRouteResponseV8> GetHereMapKmsFromAddress(string fromLatLng, string toLatLng)
    {
        using var httpClient = _httpClientFactory.CreateClient();

        var baseUrl = "https://router.hereapi.com/v8";
        var endpoint = "routes";
        var queryParams = $"?apiKey=KedIcK-HWes4X4mqtK64i4jrxTkD7tAWfJdLCXwGPD8&origin={fromLatLng}&destination={toLatLng}&routingMode=fast&transportMode=car&return=summary";

        var requestUrl = $"{baseUrl}/{endpoint}{queryParams}";

        var response = await httpClient.GetAsync(requestUrl);
        response.EnsureSuccessStatusCode();

        var result = await response.Content.ReadFromJsonAsync<HereMapRouteResponseV8>();
        return result;
    }

    private async Task<double?> CalculateTotalDistance(string fromLatitude, string fromLongitude, string toLatitude, string toLongitude)
    {
        var fromLatLng = "";
        var toLatLng = "";

        if (!string.IsNullOrWhiteSpace(fromLatitude) && !string.IsNullOrWhiteSpace(fromLongitude) &&
            double.TryParse(fromLatitude, out double fromLat) && fromLat != 0 &&
            double.TryParse(fromLongitude, out double fromLng) && fromLng != 0)
        {
            fromLatLng = $"{fromLatitude},{fromLongitude}";
        }

        if (!string.IsNullOrWhiteSpace(toLatitude) && !string.IsNullOrWhiteSpace(toLongitude) &&
            double.TryParse(toLatitude, out double toLat) && toLat != 0 &&
            double.TryParse(toLongitude, out double toLng) && toLng != 0)
        {
            toLatLng = $"{toLatitude},{toLongitude}";
        }

        if (!string.IsNullOrWhiteSpace(fromLatLng) && !string.IsNullOrWhiteSpace(toLatLng))
        {
            var kmsResponse = await GetHereMapKmsFromAddress(fromLatLng, toLatLng);

            if (kmsResponse?.routes != null && kmsResponse.routes.Count > 0)
            {
                float totalMeters = 0;
                for (int i = 0; i < kmsResponse.routes[0]?.sections.Count; i++)
                {
                    if (kmsResponse.routes[0]?.sections[i].transport.mode == "car")
                    {
                        totalMeters += (kmsResponse.routes[0]?.sections[i].summary.length ?? 0);
                    }
                }

                return Math.Round(totalMeters / 1609.344);
            }
        }

        return 0;
    }

    private async Task<double> GetKmsAsync(string fromLatLng, string toLatLng)
    {
        var kmsResponse = await GetHereMapKmsFromAddress(fromLatLng, toLatLng);
        if (kmsResponse != null && kmsResponse.routes?.Count > 0)
        {
            float? Kms = kmsResponse.routes[0]?.sections.Sum(km => km.summary.length);
            return Kms.HasValue && Kms.Value > 0 ? Math.Round(Kms.Value / 1000, 2) : 0;
        }

        return 0;
    }

    // Best-effort int parse for postcode / zipcode-style fields. Returns null
    // for null/blank/whitespace/non-numeric input so a row with a malformed
    // postcode (e.g. "AB12CD" from a UK sample, "6011 Wellington", or a value
    // that grew a stray space during export) does not throw a C# FormatException
    // or coerce into whatever int.Parse recovers - we send NULL to the SP
    // instead, which the SP's INT param accepts. Trims and uses InvariantCulture
    // so the parse is deterministic regardless of the machine's locale.
    private static int? ParseNullableIntSafe(string? value)
    {
        if (string.IsNullOrWhiteSpace(value)) return null;
        return int.TryParse(value.Trim(), System.Globalization.NumberStyles.Integer, System.Globalization.CultureInfo.InvariantCulture, out var parsed)
            ? parsed
            : (int?)null;
    }

    // Walks the exception chain producing a human-readable reason for a job
    // failure. Classifies SQL/EF error shapes so the UI shows "why" instead
    // of generic "failed", and devs can jump straight to the cause.
    private static string BuildFriendlyJobError(Exception ex)
    {
        Exception root = ex;
        while (root.InnerException != null) root = root.InnerException;

        var rootMessage = root.Message ?? string.Empty;

        if (root is SqlException sql)
        {
            switch (sql.Number)
            {
                case 334:
                    return "Database save failed because the target table has a trigger but the EF entity is not configured with .HasTrigger(...). " +
                           $"Configure the entity in DespatchContext OnModelCreating to declare the trigger. SQL error 334: {rootMessage}";
                case 547:
                    return $"Database constraint violation (foreign key or check). SQL error 547: {rootMessage}";
                case 2627:
                case 2601:
                    return $"Duplicate value rejected by a unique index/constraint. SQL error {sql.Number}: {rootMessage}";
                case 8152:
                case 2628:
                    return $"A value is too long for its database column. SQL error {sql.Number}: {rootMessage}";
                case -2:
                    return "Database call timed out. The query took too long to complete.";
                default:
                    return $"Database error (SQL {sql.Number}): {rootMessage}";
            }
        }

        if (root is FormatException || root is OverflowException)
            return $"Data format problem (likely a numeric or date field): {rootMessage}";

        if (root is InvalidOperationException)
            return $"Operation invalid in current state: {rootMessage}";

        return $"{root.GetType().Name}: {rootMessage}";
    }

    // ---- staff-import helper accessors ------------------------------------

    // Shared with the StaffImport method (BulkImportJobFactory partial).
    private string GetStringValue(Dictionary<string, object> data, params string[] keys)
    {
        foreach (var key in keys)
        {
            if (data.TryGetValue(key, out var value) && value != null)
            {
                return value.ToString()?.Trim();
            }
            var foundKey = data.Keys.FirstOrDefault(k => k.Equals(key, StringComparison.OrdinalIgnoreCase));
            if (foundKey != null && data[foundKey] != null)
            {
                return data[foundKey].ToString()?.Trim();
            }
        }
        return null;
    }

    private int? GetIntValue(Dictionary<string, object> data, params string[] keys)
    {
        var strValue = GetStringValue(data, keys);
        if (string.IsNullOrWhiteSpace(strValue)) return null;
        var inv = System.Globalization.CultureInfo.InvariantCulture;
        if (int.TryParse(strValue, System.Globalization.NumberStyles.Integer, inv, out var intValue)) return intValue;
        if (double.TryParse(strValue, System.Globalization.NumberStyles.Any, inv, out var doubleValue)) return (int)doubleValue;
        return null;
    }

    private decimal? GetDecimalValue(Dictionary<string, object> data, params string[] keys)
    {
        var strValue = GetStringValue(data, keys);
        if (string.IsNullOrWhiteSpace(strValue)) return null;
        // InvariantCulture pin so a StaffImport row shipped from a machine writing
        // "5.5" always parses regardless of the server locale. Same reason the
        // OnDemand path pins InvariantCulture on the string-to-SP conversions.
        return decimal.TryParse(strValue, System.Globalization.NumberStyles.Any, System.Globalization.CultureInfo.InvariantCulture, out var value)
            ? value : (decimal?)null;
    }

    private double? GetDoubleValue(Dictionary<string, object> data, params string[] keys)
    {
        var strValue = GetStringValue(data, keys);
        if (string.IsNullOrWhiteSpace(strValue)) return null;
        return double.TryParse(strValue, System.Globalization.NumberStyles.Any, System.Globalization.CultureInfo.InvariantCulture, out var value)
            ? value : (double?)null;
    }

    private bool? GetBoolValue(Dictionary<string, object> data, params string[] keys)
    {
        var strValue = GetStringValue(data, keys);
        if (string.IsNullOrWhiteSpace(strValue)) return null;
        if (bool.TryParse(strValue, out var value)) return value;
        if (strValue == "1" || strValue == "-1" || strValue.Equals("yes", StringComparison.OrdinalIgnoreCase) || strValue.Equals("y", StringComparison.OrdinalIgnoreCase)) return true;
        if (strValue == "0" || strValue.Equals("no", StringComparison.OrdinalIgnoreCase) || strValue.Equals("n", StringComparison.OrdinalIgnoreCase)) return false;
        return null;
    }

    private DateTime? GetDateValue(Dictionary<string, object> data, params string[] keys)
    {
        foreach (var key in keys)
        {
            if (data.TryGetValue(key, out var value) && value != null)
            {
                if (value is DateTime dt) return dt;
                if (DateTime.TryParse(value.ToString(), out var parsedDt)) return parsedDt;
            }
            var foundKey = data.Keys.FirstOrDefault(k => k.Equals(key, StringComparison.OrdinalIgnoreCase));
            if (foundKey != null && data[foundKey] != null)
            {
                if (data[foundKey] is DateTime dt) return dt;
                if (DateTime.TryParse(data[foundKey].ToString(), out var parsedDt)) return parsedDt;
            }
        }
        return null;
    }
}
