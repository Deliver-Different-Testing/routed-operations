// Item lines for point-to-point on-demand bulk jobs, on NZ and US (card
// bulk-insert-truck-and-ai, M5a). Same rows the booking page writes, computed here
// and inserted in batches once the jobs exist, instead of one proc call per item.
//
// Sources, read 2026-11-06:
//   WebAPI JobRepository.PrepareJobItems (:4883)    one row per unit, every column
//   WebAPI GSS/Models/Package.cs (:21)              a blank package name reads "custom"
//   booking desktopHomeControl.js getPackagesObject (:3786), getRowCubicFeet (:3505)
//   NET_stpJobItems_Insert                          the INSERT and the VanOK update
//   trg_UpdateLiveJobTotals                         set based, adds up job weight, qty, cubic
//   tucJob_Update_SendToDevices                     reads one row of `deleted`
using System.Data;
using System.Text.Json;
using Dapper;
using Microsoft.Data.SqlClient;
using Microsoft.EntityFrameworkCore;
using RoutedOperations.Core.Domain;
using Serilog;

namespace RoutedOperations.Core.Application.Services.BulkImport;

/// <summary>A created P2P job and what its item lines are built from. Weight is per item.</summary>
public sealed record P2PItemJob(
    int JobId,
    string JobNumber,
    short Quantity,
    decimal Length,
    decimal Width,
    decimal Height,
    decimal Weight,
    string? PackageName = null);

/// <summary>One tucJobItems row. Property names are the OPENJSON paths in InsertSql.</summary>
public sealed record P2PItemRow(
    int JobId,
    int ItemId,
    int Items,
    double Weight,
    double Length,
    double Height,
    double Depth,
    decimal Cubic,
    string Notes,
    string Barcode);

public static class P2PItemCalculator
{
    // desktopHomeControl.js:3507. NZ dimensions are cm and US dimensions are inches.
    public const decimal NzCubicFactor = 0.000001m;
    public const decimal UsCubicFactor = 0.000579m;
    public const string DefaultPackageName = "custom";

    public static IReadOnlyList<P2PItemRow> BuildItems(P2PItemJob job, bool isNz)
    {
        var cubic = Cubic(job, isNz);
        var name = string.IsNullOrWhiteSpace(job.PackageName) ? DefaultPackageName : job.PackageName;
        var items = new List<P2PItemRow>(Math.Max((int)job.Quantity, 0));
        for (int i = 0; i < job.Quantity; i++)
        {
            items.Add(new P2PItemRow(
                job.JobId,
                ItemId: i,
                Items: 1,
                Weight: (double)job.Weight,
                Length: (double)job.Length,
                Height: (double)job.Height,
                // The booking page puts the package width in Depth (PrepareJobItems:4906).
                Depth: (double)job.Width,
                Cubic: cubic,
                Notes: name,
                // PrepareJobItems:4894: a number that already has a dash is used as it is.
                Barcode: job.JobNumber.Contains('-') ? job.JobNumber : $"{job.JobNumber}-{i + 1}"));
        }
        return items;
    }

    /// <summary>
    /// A stock size sends the exact figure (getPackagesObject:3794). Typed dimensions
    /// are rounded to 3 places first (getRowCubicFeet:3507). The column then holds 4
    /// places, rounded rather than truncated (15 x 2 x 26 cm is stored as .0008).
    /// </summary>
    public static decimal Cubic(P2PItemJob job, bool isNz) =>
        Cubic(job.Length, job.Width, job.Height, job.PackageName, isNz);

    private static decimal Cubic(decimal length, decimal width, decimal height, string? packageName, bool isNz)
    {
        var cubic = length * width * height * (isNz ? NzCubicFactor : UsCubicFactor);
        if (string.IsNullOrWhiteSpace(packageName))
            cubic = Math.Round(cubic, 3, MidpointRounding.AwayFromZero);
        return Math.Round(cubic, 4, MidpointRounding.AwayFromZero);
    }

    /// <summary>
    /// Per-item cubic x units, as the booking page sends a US job (JobRepository.cs:1204,
    /// :5218). It is what trg_UpdateLiveJobTotals adds up from the item rows.
    /// </summary>
    public static decimal JobCubic(decimal length, decimal width, decimal height, short? quantity, string? packageName, bool isNz) =>
        Cubic(length, width, height, packageName, isNz) * Units(quantity);

    /// <summary>
    /// Weight on a P2P row is per item, and the job rates and books on the total, as
    /// on the booking page (JobRepository.cs:1375, :1203, :4315). A row with only a
    /// Total Weight is divided by the quantity, and Weight wins when both are given:
    /// the same rule and rounding as a truck row.
    /// </summary>
    public static TruckRowCalculator.WeightResult RowWeight(decimal weight, decimal? totalWeight, short? quantity) =>
        TruckRowCalculator.ResolveWeight(weight, totalWeight, Units(quantity));

    // Missing or below 1 counts as 1. The proc still gets the quantity the file gave.
    private static short Units(short? quantity) => quantity is > 0 ? quantity.Value : (short)1;

    /// <summary>What DES_fncTruckJob_IsVanOK returns once the job's items exist. No tail lift on a P2P job.</summary>
    public static bool VanOk(P2PItemJob job) =>
        TruckRowCalculator.IsVanOk(job.Quantity, job.Weight, job.Length, job.Width, job.Height, pu: false, dO: false);
}

public sealed record P2PItemFailure(string JobNumber, string Error);

public interface IBulkP2PItemInserter
{
    /// <summary>Never throws. A job whose items could not be saved comes back as a failure.</summary>
    Task<IReadOnlyList<P2PItemFailure>> InsertAsync(IReadOnlyList<P2PItemJob> jobs, bool isNz);
}

/// <summary>Raised by the SQL layer for error 1205, so the batching logic has no SqlClient dependency.</summary>
public sealed class P2PItemDeadlockException(Exception inner) : Exception("Deadlock inserting item lines.", inner);

public interface IP2PItemBatchSql
{
    Task<IReadOnlySet<int>> JobsWithCourierAsync(IReadOnlyList<int> jobIds);

    /// <summary>Writes one batch in one transaction.</summary>
    Task InsertBatchAsync(IReadOnlyList<P2PItemJob> jobs, bool isNz);
}

public sealed class BulkP2PItemInserter(IP2PItemBatchSql sql, Func<TimeSpan, Task>? delay = null) : IBulkP2PItemInserter
{
    public const int MaxBatchItems = 500;
    public const int MaxDeadlockAttempts = 3;

    private readonly Func<TimeSpan, Task> _delay = delay ?? (d => Task.Delay(d));

    /// <summary>
    /// A job with a courier goes alone: inserting items updates tucJob, and
    /// tucJob_Update_SendToDevices decides from one arbitrary row whether a driver
    /// is told about the change. Other jobs share a statement. A job's items are
    /// never split, so its totals and VanOK change together.
    /// </summary>
    public static IReadOnlyList<IReadOnlyList<P2PItemJob>> PlanBatches(IReadOnlyList<P2PItemJob> jobs, IReadOnlySet<int> jobsWithCourier)
    {
        var batches = new List<IReadOnlyList<P2PItemJob>>();
        var current = new List<P2PItemJob>();
        int currentItems = 0;
        foreach (var job in jobs.Where(j => j.Quantity > 0))
        {
            if (jobsWithCourier.Contains(job.JobId))
            {
                batches.Add(new[] { job });
                continue;
            }
            if (current.Count > 0 && currentItems + job.Quantity > MaxBatchItems)
            {
                batches.Add(current);
                current = new List<P2PItemJob>();
                currentItems = 0;
            }
            current.Add(job);
            currentItems += job.Quantity;
        }
        if (current.Count > 0) batches.Add(current);
        return batches;
    }

    public async Task<IReadOnlyList<P2PItemFailure>> InsertAsync(IReadOnlyList<P2PItemJob> jobs, bool isNz)
    {
        var failures = new List<P2PItemFailure>();
        if (jobs.Count == 0) return failures;

        IReadOnlySet<int> withCourier;
        try
        {
            withCourier = await sql.JobsWithCourierAsync(jobs.Select(j => j.JobId).ToList());
        }
        catch (Exception ex)
        {
            // Not knowing is safe: every job alone is what the booking page does anyway.
            Log.Warning(ex, "[BulkP2PItemInserter] Courier lookup failed, inserting job by job");
            withCourier = jobs.Select(j => j.JobId).ToHashSet();
        }

        foreach (var batch in PlanBatches(jobs, withCourier))
            failures.AddRange(await RunBatchAsync(batch, isNz));
        return failures;
    }

    private async Task<IReadOnlyList<P2PItemFailure>> RunBatchAsync(IReadOnlyList<P2PItemJob> batch, bool isNz)
    {
        for (int attempt = 1; ; attempt++)
        {
            try
            {
                await sql.InsertBatchAsync(batch, isNz);
                return Array.Empty<P2PItemFailure>();
            }
            catch (P2PItemDeadlockException) when (attempt < MaxDeadlockAttempts)
            {
                await _delay(TimeSpan.FromMilliseconds(200 * attempt));
            }
            catch (Exception ex)
            {
                if (batch.Count > 1)
                {
                    Log.Warning(ex, "[BulkP2PItemInserter] Batch of {Count} jobs failed, retrying job by job", batch.Count);
                    var failures = new List<P2PItemFailure>();
                    foreach (var job in batch)
                        failures.AddRange(await RunBatchAsync(new[] { job }, isNz));
                    return failures;
                }
                Log.Error(ex, "[BulkP2PItemInserter] Item lines for job {JobNumber} failed", batch[0].JobNumber);
                var root = ex is P2PItemDeadlockException ? ex.InnerException ?? ex : ex;
                return new[] { new P2PItemFailure(batch[0].JobNumber, root.Message) };
            }
        }
    }
}

public sealed class BulkP2PItemBatchSql(IDbContextFactory<DynamicDespatchDbContext> contextFactory)
    : BaseService(contextFactory), IP2PItemBatchSql
{
    private const int CommandTimeoutSeconds = 300;

    // PU, DO and DGClass are the booking page's values with no truck details and no
    // DG on the request (PrepareJobItems:4908-4910). PrivateRes is NULL because the
    // page passes null explicitly (InsertTruckJobItemsAsync:4871).
    public const string InsertSql = """
        SET NOCOUNT ON;
        SET XACT_ABORT ON;

        BEGIN TRANSACTION;

        INSERT INTO dbo.tucJobItems (JobID, ItemID, Items, [Weight], [Length], Height, Depth, Cubic, PU, [DO], DGClass, PrivateRes, Notes, Barcode)
        SELECT x.JobId, x.ItemId, x.Items, x.[Weight], x.[Length], x.Height, x.Depth, x.Cubic, 0, 0, 0, NULL, x.Notes, x.Barcode
        FROM OPENJSON(@items) WITH (
            JobId int, ItemId int, Items int, [Weight] float, [Length] float, Height float, Depth float,
            Cubic decimal(18,4), Notes nvarchar(4000), Barcode varchar(100)) x;

        UPDATE j SET VanOK = v.VanOK
        FROM dbo.tucJob j
        INNER JOIN OPENJSON(@vanOk) WITH (JobId int, VanOK bit) v ON v.JobId = j.ucjbID
        WHERE j.VanOK IS NULL OR j.VanOK <> v.VanOK;

        COMMIT TRANSACTION;
        """;

    public static string BuildItemsJson(IReadOnlyList<P2PItemJob> jobs, bool isNz) =>
        JsonSerializer.Serialize(jobs.SelectMany(j => P2PItemCalculator.BuildItems(j, isNz)));

    public static string BuildVanOkJson(IReadOnlyList<P2PItemJob> jobs) =>
        JsonSerializer.Serialize(jobs.Select(j => new { j.JobId, VanOK = P2PItemCalculator.VanOk(j) }));

    public async Task<IReadOnlySet<int>> JobsWithCourierAsync(IReadOnlyList<int> jobIds)
    {
        var ids = await Context.Database.GetDbConnection().QueryAsync<int>(
            """
            SELECT j.ucjbID
            FROM dbo.tucJob j
            INNER JOIN OPENJSON(@ids) WITH (id int '$') x ON x.id = j.ucjbID
            WHERE j.ucjbCourierID IS NOT NULL;
            """,
            new { ids = JsonSerializer.Serialize(jobIds) },
            commandTimeout: CommandTimeoutSeconds);
        return ids.ToHashSet();
    }

    public async Task InsertBatchAsync(IReadOnlyList<P2PItemJob> jobs, bool isNz)
    {
        var parameters = new DynamicParameters();
        parameters.Add("@items", BuildItemsJson(jobs, isNz), DbType.String, size: -1);
        parameters.Add("@vanOk", BuildVanOkJson(jobs), DbType.String, size: -1);

        try
        {
            await Context.Database.GetDbConnection().ExecuteAsync(InsertSql, parameters, commandTimeout: CommandTimeoutSeconds);
        }
        catch (SqlException ex) when (ex.Number == 1205)
        {
            throw new P2PItemDeadlockException(ex);
        }
    }
}
