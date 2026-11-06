// Writes prepared truck rows straight into tucJob (Steve 2026-11-04: no
// WS_stpJob_Insert, no per-row UTL_stpJob_Truck_Insert). Batching rules are
// findings section C:
//   * one statement per client, because the trigger's client branches read a
//     single row of `inserted`
//   * multi-row only for rows with no courier and a client outside the
//     code-specific lists; everything else is one statement per row
//   * a deadlock retries the batch; any other SQL error retries it row by row
//     so one bad row (a duplicate number, say) fails on its own
//
// No PricingBreakdown rows (Steve decision 7): TR_PricingBreakdown_tucJob_Sync
// would overwrite ucjbAmount with the sum of the rows.
using System.Data;
using System.Text.Json;
using System.Text.Json.Serialization;
using Dapper;
using Microsoft.Data.SqlClient;
using Microsoft.EntityFrameworkCore;
using RoutedOperations.Core.Domain;
using Serilog;

namespace RoutedOperations.Core.Application.Services.BulkImport;

public sealed record TruckInsertOutcome(int RowNo, int? JobId, string? Error, string? Warning);

public interface IBulkTruckInserter
{
    Task<IReadOnlyList<TruckInsertOutcome>> InsertAsync(IReadOnlyList<TruckInsertRow> rows, DateTime noteCreatedAt);
}

/// <summary>Raised by the SQL layer for error 1205, so the batching logic has no SqlClient dependency.</summary>
public sealed class TruckDeadlockException(Exception inner) : Exception("Deadlock inserting truck jobs.", inner);

public interface ITruckBatchSql
{
    /// <summary>Runs one batch in one transaction. Returns job number to job id.</summary>
    Task<IReadOnlyDictionary<string, int>> InsertBatchAsync(IReadOnlyList<TruckInsertRow> rows, DateTime noteCreatedAt);
}

public sealed class BulkTruckInserter(ITruckBatchSql sql, Func<TimeSpan, Task>? delay = null) : IBulkTruckInserter
{
    public const int MaxBatchRows = 200;
    public const int MaxDeadlockAttempts = 3;

    private readonly Func<TimeSpan, Task> _delay = delay ?? (d => Task.Delay(d));

    /// <summary>Groups rows into the statements they will run in. Public so the rules can be tested.</summary>
    public static IReadOnlyList<IReadOnlyList<TruckInsertRow>> PlanBatches(IReadOnlyList<TruckInsertRow> rows)
    {
        var batches = new List<IReadOnlyList<TruckInsertRow>>();
        foreach (var client in rows.GroupBy(r => r.ucjbClientID))
        {
            batches.AddRange(client.Where(r => r.MustInsertAlone).Select(r => (IReadOnlyList<TruckInsertRow>)new[] { r }));
            batches.AddRange(client.Where(r => !r.MustInsertAlone).Chunk(MaxBatchRows));
        }
        return batches;
    }

    public async Task<IReadOnlyList<TruckInsertOutcome>> InsertAsync(IReadOnlyList<TruckInsertRow> rows, DateTime noteCreatedAt)
    {
        var outcomes = new List<TruckInsertOutcome>(rows.Count);
        foreach (var batch in PlanBatches(rows))
            outcomes.AddRange(await RunBatchAsync(batch, noteCreatedAt));
        return outcomes;
    }

    private async Task<IReadOnlyList<TruckInsertOutcome>> RunBatchAsync(IReadOnlyList<TruckInsertRow> batch, DateTime noteCreatedAt)
    {
        for (int attempt = 1; ; attempt++)
        {
            try
            {
                var ids = await sql.InsertBatchAsync(batch, noteCreatedAt);
                return batch.Select(r => ids.TryGetValue(r.ucjbNumber, out var id)
                    ? new TruckInsertOutcome(r.RowNo, id, null, r.Warning)
                    : new TruckInsertOutcome(r.RowNo, null, "The job was not created.", null)).ToList();
            }
            catch (TruckDeadlockException) when (attempt < MaxDeadlockAttempts)
            {
                await _delay(TimeSpan.FromMilliseconds(200 * attempt));
            }
            catch (Exception ex)
            {
                if (batch.Count > 1)
                {
                    Log.Warning(ex, "[BulkTruckInserter] Batch of {Count} failed, retrying row by row", batch.Count);
                    var outcomes = new List<TruckInsertOutcome>(batch.Count);
                    foreach (var row in batch)
                        outcomes.AddRange(await RunBatchAsync(new[] { row }, noteCreatedAt));
                    return outcomes;
                }
                Log.Error(ex, "[BulkTruckInserter] Row {JobNumber} failed", batch[0].ucjbNumber);
                return new[] { new TruckInsertOutcome(batch[0].RowNo, null, Describe(ex, batch[0].ucjbNumber), null) };
            }
        }
    }

    private static string Describe(Exception ex, string jobNumber)
    {
        var root = ex is TruckDeadlockException ? ex.InnerException ?? ex : ex;
        return root is SqlException { Number: 2601 or 2627 }
            ? $"Job number {jobNumber} already exists."
            : $"The job could not be saved: {root.Message}";
    }
}

public sealed class BulkTruckBatchSql(IDbContextFactory<DynamicDespatchDbContext> contextFactory)
    : BaseService(contextFactory), ITruckBatchSql
{
    private const int CommandTimeoutSeconds = 300;

    // Column name, then the type OPENJSON reads it as. One list drives the
    // INSERT column list, the SELECT and the WITH clause, so they cannot get out
    // of step. A job property must have the same name as its column.
    public static readonly IReadOnlyList<(string Name, string SqlType)> JobColumns = new[]
    {
        ("ucjbNumber", "varchar(50)"), ("ucjbDate", "datetime"), ("ucjbTime", "datetime"), ("ucjbType", "int"),
        ("ucjbClientID", "int"), ("ucjbContact", "nvarchar(30)"), ("ucjbChargeType", "int"), ("ucjbAmount", "decimal(19,4)"),
        ("ucjbSpeed", "int"), ("ucjbFrom", "int"), ("ucjbFromAddr", "varchar(150)"), ("ucjbTo", "int"),
        ("ucjbToAddr", "varchar(150)"), ("ucjbSize", "int"), ("ucjbQty", "smallint"), ("ucjbWeight", "decimal(18,4)"),
        ("ucjbStatus", "int"), ("ucjbCourierID", "int"), ("ucjbDispDate", "datetime"), ("ucjbDispTime", "datetime"),
        ("ucjbDispID", "int"), ("ucjbJobDone", "bit"), ("ucjbComplTime", "datetime"), ("ucjbPODName", "varchar(100)"),
        ("ucjbClientRefa", "varchar(100)"), ("ucjbClientRefb", "varchar(100)"), ("ucjbOurRef", "varchar(20)"), ("ucjbOpID", "int"),
        ("ucjbClientCode", "varchar(5)"), ("ucjbNotes", "nvarchar(4000)"), ("PickupFromContact", "nvarchar(100)"),
        ("DeliverToContact", "nvarchar(100)"), ("DeliverToPhone", "nvarchar(100)"), ("ProofOfDelivery", "int"),
        ("ProofOfDeliveryEmail", "nvarchar(100)"), ("ProofOfDeliveryMobile", "nvarchar(100)"), ("ContactID", "int"),
        ("LoggedInContactID", "int"), ("TrackingMethod", "int"), ("TrackingEmail", "nvarchar(500)"), ("TrackingMobile", "nvarchar(500)"),
        ("PickUpLatitude", "nvarchar(50)"), ("PickUpLongitude", "nvarchar(50)"), ("DeliveryLatitude", "nvarchar(50)"), ("DeliveryLongitude", "nvarchar(50)"),
        ("FromGeoType", "int"), ("ToGeoType", "int"), ("DesiredJobTypeID", "int"), ("Direct", "bit"), ("JobRelationshipTypeID", "int"),
        ("TruckStartTime", "datetime"), ("TruckHours", "float"), ("RequiredDeliveryTime", "datetime"), ("DGClass", "int"), ("DGDocument", "bit"),
        ("RatedManually", "bit"), ("VanOK", "bit"),
        ("PickupAddressLine1", "nvarchar(255)"), ("PickupAddressLine2", "nvarchar(255)"), ("PickupAddressLine3", "nvarchar(255)"), ("PickupAddressLine4", "nvarchar(255)"),
        ("PickupAddressLine5", "nvarchar(255)"), ("PickupAddressLine6", "nvarchar(255)"), ("PickupAddressLine7", "nvarchar(255)"),
        ("DeliveryAddressLine1", "nvarchar(255)"), ("DeliveryAddressLine2", "nvarchar(255)"), ("DeliveryAddressLine3", "nvarchar(255)"), ("DeliveryAddressLine4", "nvarchar(255)"),
        ("DeliveryAddressLine5", "nvarchar(255)"), ("DeliveryAddressLine6", "nvarchar(255)"), ("DeliveryAddressLine7", "nvarchar(255)"),
        ("PickupTimeZoneID", "int"), ("DeliverByTimeZoneID", "int"),
    };

    // Literal values from the UTL_stpJob_Truck_Insert column map. Fixed for every
    // truck row, so they stay out of the JSON. ucjbPickUpFrom and
    // DeliverToLeaveID are left to their NULL default, as the proc writes them.
    public static readonly IReadOnlyList<(string Name, string Literal)> JobConstants = new[]
    {
        ("ucjbCBD", "0"), ("ucjbKm", "0"), ("ucjbVan", "0"), ("ucjbReturn", "0"), ("ucjbVoid", "0"), ("ucjbAttention", "1"),
        ("ucjbPaged", "0"), ("ucjbRefJobID", "0"), ("SaturdayDelivery", "0"), ("DeliverToPrivateBusiness", "0"),
        ("ColsolidateMarsInformation", "0"), ("DisplayInDespatch", "1"), ("AutoDespatch", "1"), ("Truck", "1"),
        ("SourceID", "3"), ("DimensionsType", "1"),
        ("PickupAddressLine8", "N'New Zealand'"), ("DeliveryAddressLine8", "N'New Zealand'"),
    };

    public static readonly string InsertSql = BuildInsertSql();

    private static string BuildInsertSql()
    {
        var insertColumns = string.Join(", ", JobColumns.Select(c => c.Name).Concat(JobConstants.Select(c => c.Name)));
        var selectColumns = string.Join(", ", JobColumns.Select(c => "j." + c.Name).Concat(JobConstants.Select(c => c.Literal)));
        var withClause = string.Join(", ", JobColumns.Select(c => $"{c.Name} {c.SqlType}"));

        return $"""
            SET NOCOUNT ON;
            SET XACT_ABORT ON;
            EXEC sys.sp_set_session_context N'CreatedBySp', N'BulkTruckInserter';
            DECLARE @ids TABLE (JobId int NOT NULL, JobNumber varchar(50) NOT NULL);

            BEGIN TRANSACTION;

            INSERT INTO dbo.tucJob ({insertColumns})
            OUTPUT inserted.ucjbID, inserted.ucjbNumber INTO @ids (JobId, JobNumber)
            SELECT {selectColumns}
            FROM OPENJSON(@jobs) WITH ({withClause}) j;

            UPDATE t SET ParentID = i.JobId, RootParentID = i.JobId, InformationParentID = i.JobId
            FROM dbo.tucJob t
            INNER JOIN @ids i ON i.JobId = t.ucjbID;

            INSERT INTO dbo.tucJobItems (JobID, ItemID, Items, [Weight], [Length], Height, Depth, PU, [DO], DGClass, PrivateRes, Notes, Cubic, Barcode)
            SELECT i.JobId, x.ItemId, x.Items, x.[Weight], x.[Length], x.Height, x.Depth, x.PU, x.[DO], x.DGClass, NULL, x.Notes, x.Cubic, x.Barcode
            FROM OPENJSON(@items) WITH (
                JobNumber varchar(50), ItemId int, Items int, [Weight] float, [Length] float, Height float, Depth float,
                PU bit, [DO] bit, DGClass int, Notes nvarchar(4000), Cubic decimal(18,4), Barcode varchar(100)) x
            INNER JOIN @ids i ON i.JobNumber = x.JobNumber;

            INSERT INTO dbo.tucNote (NoteTypeID, JobID, NoteText, IsImportant, CreatedDate, CreatedBy, UpdatedBy)
            SELECT n.NoteTypeId, i.JobId, n.NoteText, 0, @noteCreatedAt, n.CreatedBy, n.CreatedBy
            FROM OPENJSON(@notes) WITH (JobNumber varchar(50), NoteTypeId int, NoteText nvarchar(max), CreatedBy int) n
            INNER JOIN @ids i ON i.JobNumber = n.JobNumber;

            COMMIT TRANSACTION;

            -- An output parameter, not a result set: tucJob_Insert_GPS returns a
            -- stray SELECT 1 to the client on every insert.
            SET @result = (SELECT JobId, JobNumber FROM @ids FOR JSON PATH);
            """;
    }

    public static string BuildJobsJson(IReadOnlyList<TruckInsertRow> rows) =>
        JsonSerializer.Serialize(rows, TruckJson.Options);

    public static string BuildItemsJson(IReadOnlyList<TruckInsertRow> rows) =>
        JsonSerializer.Serialize(rows.SelectMany(r => r.Items), TruckJson.Options);

    public static string BuildNotesJson(IReadOnlyList<TruckInsertRow> rows) =>
        JsonSerializer.Serialize(
            rows.SelectMany(r => new[] { (Text: r.PickupNote, Type: r.PickupNoteTypeId, Row: r), (Text: r.DeliveryNote, Type: r.DeliveryNoteTypeId, Row: r) })
                .Where(n => n.Text != null)
                .Select(n => new
                {
                    JobNumber = n.Row.ucjbNumber,
                    NoteTypeId = n.Type,
                    NoteText = n.Text,
                    CreatedBy = n.Row.BookingStaffId,
                }), TruckJson.Options);

    public async Task<IReadOnlyDictionary<string, int>> InsertBatchAsync(IReadOnlyList<TruckInsertRow> rows, DateTime noteCreatedAt)
    {
        var parameters = new DynamicParameters();
        parameters.Add("@jobs", BuildJobsJson(rows), DbType.String, size: -1);
        parameters.Add("@items", BuildItemsJson(rows), DbType.String, size: -1);
        parameters.Add("@notes", BuildNotesJson(rows), DbType.String, size: -1);
        parameters.Add("@noteCreatedAt", noteCreatedAt, DbType.DateTime);
        parameters.Add("@result", dbType: DbType.String, direction: ParameterDirection.Output, size: -1);

        try
        {
            await Context.Database.GetDbConnection().ExecuteAsync(InsertSql, parameters, commandTimeout: CommandTimeoutSeconds);
        }
        catch (SqlException ex) when (ex.Number == 1205)
        {
            throw new TruckDeadlockException(ex);
        }

        return ParseResult(parameters.Get<string>("@result"));
    }

    public static IReadOnlyDictionary<string, int> ParseResult(string? json)
    {
        if (string.IsNullOrEmpty(json)) return new Dictionary<string, int>();
        return JsonSerializer.Deserialize<List<InsertedJob>>(json)!.ToDictionary(j => j.JobNumber, j => j.JobId);
    }

    private sealed record InsertedJob(int JobId, string JobNumber);
}

/// <summary>
/// JSON shape for OPENJSON. A datetime column rejects more than three fractional
/// digits, which is what the default DateTime format would send.
/// </summary>
public static class TruckJson
{
    public static readonly JsonSerializerOptions Options = new()
    {
        DefaultIgnoreCondition = JsonIgnoreCondition.Never,
        Converters = { new SqlDateTimeConverter() },
    };

    private sealed class SqlDateTimeConverter : JsonConverter<DateTime>
    {
        public override DateTime Read(ref Utf8JsonReader reader, Type typeToConvert, JsonSerializerOptions options) =>
            reader.GetDateTime();

        public override void Write(Utf8JsonWriter writer, DateTime value, JsonSerializerOptions options) =>
            writer.WriteStringValue(value.ToString("yyyy-MM-ddTHH:mm:ss.fff", System.Globalization.CultureInfo.InvariantCulture));
    }
}
