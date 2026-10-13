using Dapper;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Storage;
using RoutedOperations.Core.Domain;

namespace RoutedOperations.Core.Application.Services.Schedule;

/// <summary>
/// What dbo.uspScheduleConvert reports back, rowset 1. Property names match
/// the procedure's column names so Dapper maps them without configuration.
/// </summary>
public class ScheduleConvertResult
{
    public int ScheduleId { get; set; }
    public string Name { get; set; }

    /// <summary>
    /// 1 when the schedule's day rows agree closely enough to collapse onto
    /// one detail row. 0 is a NORMAL answer, not a fault: a schedule whose
    /// days genuinely differ needs a human decision about which value wins,
    /// or needs splitting in two.
    /// </summary>
    public bool CanConvert { get; set; }

    /// <summary>
    /// Semicolon-separated refusal reasons, NULL when there are none. The
    /// vocabulary is the procedure's, read out of its own source rather
    /// than guessed: WindowVariesByDay, PayloadVaries:&lt;column&gt;,
    /// CutoffDayNotExpressible, CutoffExceptionNotExpressible:&lt;day&gt;,
    /// DayColumnsNotNullable:&lt;column&gt;, ShopWindowReferenced:&lt;shop&gt;,
    /// DuplicateDay:&lt;day&gt;, DescriptionTooLong, SubSecondTime, plus the
    /// data faults NoDayRows, HeaderMissing, HeaderRetired,
    /// DayOfWeekOutOfRange and DetailAlreadyExists.
    /// Surfaced to the operator verbatim rather than translated, so the
    /// message names the actual obstacle.
    /// </summary>
    public string Reasons { get; set; }

    public string ProposedWeekDays { get; set; }

    /// <summary>
    /// Read these two together: a 1 with 'C' is one CALENDAR day before, a 1
    /// with 'W' is one WORKING day before, and for a Monday run those are
    /// Sunday and Friday respectively.
    /// </summary>
    public byte? ProposedCutoffDaysBefore { get; set; }
    public string ProposedCutoffDayUnit { get; set; }
    public TimeSpan? ProposedCutoffTime { get; set; }

    public int RowCount { get; set; }

    /// <summary>
    /// Day rows whose stored CutoffHours disagrees with what the proposed
    /// relative rule derives. Expected to be non-zero on a schedule that
    /// converts under the calendar unit, so a non-zero value here is
    /// information, not a problem to chase.
    /// </summary>
    public int CutoffHoursDriftRows { get; set; }

    /// <summary>
    /// How many schedule-wide day-exception override rows the conversion
    /// wrote, or would write on a dry run. 0 means every day already agreed
    /// on its cutoff.
    /// </summary>
    public int ConvertedWithExceptions { get; set; }

    public bool CutoffVariesByDay { get; set; }

    /// <summary>
    /// 1 only when asked to commit AND the schedule was convertible. Read
    /// alongside ConvertedWithExceptions to tell a forecast from a fact.
    /// </summary>
    public bool Committed { get; set; }
}

/// <summary>
/// Collapses one schedule onto its detail row, or explains why it cannot.
///
/// This exists as a seam for one reason: the derivation it performs lives in
/// dbo.uspScheduleConvert and must stay there. Turning a set of per-day
/// absolute cutoffs into the single relative rule the detail row stores
/// means trying working days, then calendar days, and refusing when neither
/// expresses every day. Writing that a second time in C# would give the
/// system two implementations of one rule, free to drift, with the booking
/// path believing the SQL one.
///
/// So the application writes the old shape and asks the procedure to
/// collapse it. The seam is here so service tests can substitute it, because
/// the in-memory provider the tests run on has no stored procedures.
/// </summary>
public interface IScheduleConverter
{
    /// <summary>
    /// Runs dbo.uspScheduleConvert on <paramref name="ctx"/>'s own
    /// connection, enlisting in its ambient transaction if one is open, so a
    /// convert-on-save and the writes that preceded it commit or roll back
    /// together. Without that the intermediate old-shape write would be
    /// briefly visible to other readers.
    ///
    /// The context is a parameter rather than something this type resolves
    /// for itself precisely because running on the CALLER's connection is
    /// the point. A separate connection would see the caller's uncommitted
    /// writes not at all.
    ///
    /// With <paramref name="commit"/> false it is a dry run that writes
    /// nothing and reports what it would do.
    ///
    /// Returns null when the provider cannot run a stored procedure, which
    /// is how the in-memory test provider behaves. Null means "not
    /// attempted", never "refused"; callers must not read it as a refusal.
    /// </summary>
    Task<ScheduleConvertResult> ConvertAsync(DbContext ctx, int scheduleId, bool commit, string by);

    /// <summary>
    /// Runs dbo.uspScheduleUnconvert: spreads the detail row's payload back
    /// across the day rows, deletes the detail row, and removes the
    /// schedule-wide day-exception override rows the conversion itself
    /// created. It identifies those by the OverrideIds its convert-log entry
    /// recorded rather than by pattern, so a real per-client override is
    /// never touched.
    ///
    /// A no-op on a schedule that has no detail row.
    ///
    /// Needed on the save path because a conversion refuses with
    /// DetailAlreadyExists when one is already there. Rather than special-
    /// case an already-collapsed schedule, the save puts it back on its day
    /// rows first and lets the one derivation run again.
    /// </summary>
    Task UnconvertAsync(DbContext ctx, int scheduleId);
}

/// <summary>
/// The real thing: Dapper against the context's connection and ambient
/// transaction.
/// </summary>
public class SqlScheduleConverter : IScheduleConverter
{
    public async Task<ScheduleConvertResult> ConvertAsync(
        DbContext ctx, int scheduleId, bool commit, string by)
    {
        if (!ctx.Database.IsRelational()) return null;

        var connection = ctx.Database.GetDbConnection();
        var transaction = ctx.Database.CurrentTransaction?.GetDbTransaction();

        return await connection.QueryFirstOrDefaultAsync<ScheduleConvertResult>(
            "dbo.uspScheduleConvert",
            new { ScheduleId = scheduleId, Commit = commit, By = by },
            transaction: transaction,
            commandType: System.Data.CommandType.StoredProcedure);
    }

    public async Task UnconvertAsync(DbContext ctx, int scheduleId)
    {
        if (!ctx.Database.IsRelational()) return;

        var connection = ctx.Database.GetDbConnection();
        var transaction = ctx.Database.CurrentTransaction?.GetDbTransaction();

        // No @By parameter: the procedure takes the login from
        // SUSER_SNAME(), which is the signature the spec asked for.
        await connection.ExecuteAsync(
            "dbo.uspScheduleUnconvert",
            new { ScheduleId = scheduleId },
            transaction: transaction,
            commandType: System.Data.CommandType.StoredProcedure);
    }
}
