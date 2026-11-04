using System.ComponentModel.DataAnnotations;

namespace RoutedOperations.Core.Application.Dtos.Pricing;

// ─── ZONE RATES GRID ───────────────────────────────────────────────────────

/// <summary>One speed column in the zone rates grid.</summary>
public record RateSpeedColumnDto(int SpeedId, string Name);

/// <summary>
/// One cell. <paramref name="Inherited"/> true means the figure shown belongs
/// to the default sheet and this client has no row of its own, which the grid
/// renders grey; false with an Amount means the client overrides it, rendered
/// black. Both null means nothing is priced there at all.
/// </summary>
public record RateCellDto(
    int Zone,
    int SpeedId,
    int? RateId,
    decimal? Amount,
    decimal? CourierPercentage,
    bool Inherited,
    decimal? DefaultAmount);

/// <summary>
/// The grid for one zone group and one client. Zones come from the group's own
/// membership rather than from the rates, so a zone with no price yet still
/// gets a row to type into.
/// </summary>
public record ZoneRateGridDto(
    int PostcodeGroupId,
    string PostcodeGroupName,
    int? DepotId,
    string DepotName,
    int? ClientId,
    string ClientLabel,
    List<int> Zones,
    List<RateSpeedColumnDto> Speeds,
    List<RateCellDto> Cells,
    /// <summary>Cells where this client differs from the default. Zero when
    /// viewing the default sheet.</summary>
    int OverriddenCellCount,
    /// <summary>True while BulkZoneRate.PostcodeGroupId is still unfilled and
    /// the grid is resolving through the group's depot instead. The screen
    /// says so rather than implying the rates are group-scoped already.</summary>
    bool ResolvedByDepot);

public class ZoneRateUpsertRequest
{
    [Required] public int PostcodeGroupId { get; set; }
    [Required] public int Zone { get; set; }
    [Required] public int SpeedId { get; set; }
    public int? ClientId { get; set; }
    public decimal? Amount { get; set; }
    public decimal? CourierPercentage { get; set; }
}

// ─── DIMENSIONS ────────────────────────────────────────────────────────────

public record PackageRateDto(
    int Id,
    int? SetId,
    string SetName,
    int? ClientId,
    string Name,
    decimal? FromCubic,
    decimal? ToCubic,
    decimal? FromWeight,
    decimal? ToWeight,
    decimal CubicRate);

/// <summary>
/// The dimension bands for a client, plus which rule applied. A client with
/// any rows of its own uses ONLY its own rows; there is no merge with the
/// default. <paramref name="UsingOwnRows"/> is what the screen says out loud,
/// because the alternative reading (bands merge) silently misprices.
/// </summary>
public record PackageRatesDto(
    int? ClientId,
    string ClientLabel,
    bool UsingOwnRows,
    List<PackageRateDto> Rows);

public class PackageRateUpsertRequest
{
    public int? Id { get; set; }
    public int? ClientId { get; set; }
    public int? SetId { get; set; }
    [StringLength(200)] public string Name { get; set; }
    public decimal? FromCubic { get; set; }
    public decimal? ToCubic { get; set; }
    public decimal? FromWeight { get; set; }
    public decimal? ToWeight { get; set; }
    [Required] public decimal CubicRate { get; set; }
}

// ─── SURCHARGES ────────────────────────────────────────────────────────────

/// <summary>Code is the padded spelling an operator recognises; Value is the
/// int actually stored, because PostCode is an int so 0110 lands as 110.</summary>
public record SurchargeDto(int Id, string Code, int Value, int? ClientId, decimal? Surcharge);

public class SurchargeUpsertRequest
{
    public int? Id { get; set; }
    [Required] public string Postcode { get; set; }
    public int? ClientId { get; set; }
    public decimal? Surcharge { get; set; }
}

// ─── SPEEDS ────────────────────────────────────────────────────────────────

/// <summary>A speed and whether it is offered on scheduled jobs for this
/// client (BulkImportSpeed). Offered via a client row beats the global row,
/// which is why both are reported.</summary>
public record OfferedSpeedDto(
    int SpeedId,
    string Name,
    bool OfferedGlobally,
    bool OfferedForClient,
    int? ClientRowId);

// ─── BOOTSTRAP ─────────────────────────────────────────────────────────────

public record RateSheetDto(int Id, int PostcodeGroupId, string Name, bool IsDefault, bool CourierPayHere);
public record RateSetDto(int Id, string Name, bool IsDefault);
public record PricingGroupOptionDto(int Id, string Name, int? DepotId, string DepotName, int? ClientId);

public record PricingBootstrapDto(
    List<PricingGroupOptionDto> Groups,
    List<RateSpeedColumnDto> Speeds,
    List<RateSheetDto> Sheets,
    List<RateSetDto> RateSets);
