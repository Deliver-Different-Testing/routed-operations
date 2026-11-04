using System.ComponentModel.DataAnnotations;

namespace RoutedOperations.Core.Application.Dtos.Linehaul;

/// <summary>A priced speed column on the Linehaul tab. Amount is the run-level
/// price for that speed, i.e. the row with no schedule.</summary>
public record LinehaulSpeedCellDto(
    int? SpeedId,
    string SpeedName,
    int? RateId,
    decimal? Amount,
    decimal? AmountPercentage);

/// <summary>
/// One linehaul run as the tab lists it. The run-level cells (any speed, plus
/// one per priced speed) are directly editable; the per-schedule prices are
/// summarised here and listed in full by <see cref="LinehaulScheduleRateDto"/>
/// when the row is expanded.
/// </summary>
public record LinehaulRunRateDto(
    int RunId,
    string RunName,
    int FromDepotId,
    string FromDepotName,
    int ToDepotId,
    string ToDepotName,
    string StartTime,
    string DespatchTime,
    /// <summary>Any-speed, any-schedule price for the client being viewed.</summary>
    LinehaulSpeedCellDto AnySpeed,
    List<LinehaulSpeedCellDto> SpeedCells,
    /// <summary>How many schedules carry their own price on this run.</summary>
    int ScheduleRateCount,
    decimal? ScheduleMinAmount,
    decimal? ScheduleMaxAmount,
    /// <summary>A few schedule names so the row says who uses it without
    /// being expanded. Not the whole list; ScheduleRateCount is.</summary>
    List<string> UsedBySchedules);

/// <summary>One schedule's own price on a run.</summary>
public record LinehaulScheduleRateDto(
    int RateId,
    int ScheduleId,
    string ScheduleName,
    int? SpeedId,
    string SpeedName,
    int? ClientId,
    string ClientCode,
    decimal? Amount,
    decimal? AmountPercentage,
    bool Active);

/// <summary>The speeds offered as columns, so the "+ Speed" picker shows real
/// names rather than ids.</summary>
public record LinehaulSpeedOptionDto(int SpeedId, string Name);

/// <summary>Depot pair actually used by at least one run, for the two filters.
/// Listing every depot would offer pairs with no runs behind them.</summary>
public record LinehaulDepotOptionDto(int DepotId, string Name);

public record LinehaulBootstrapDto(
    List<LinehaulDepotOptionDto> FromDepots,
    List<LinehaulDepotOptionDto> ToDepots,
    List<LinehaulSpeedOptionDto> Speeds);

/// <summary>
/// Set one price. Identity is the (run, schedule, speed, client) tuple rather
/// than the row id, so the caller does not have to know whether a row exists.
/// Sending both Amount and AmountPercentage is refused, and sending neither
/// clears the price by deactivating the row.
/// </summary>
public class LinehaulRateUpsertRequest
{
    [Required]
    public int LinehaulRunId { get; set; }
    public int? ScheduleId { get; set; }
    public int? SpeedId { get; set; }
    public int? ClientId { get; set; }
    public decimal? Amount { get; set; }
    public decimal? AmountPercentage { get; set; }
}
