// Models ported from BulkImportHyper/Application/Domain/Models. These are the
// keyless read/write shapes the ported BulkService.cs uses to talk to legacy
// pricing SPs (fncT_BulkZoneRate_WithLinehaul, WS_stpJobType_KmRates,
// UTL_fncMFV_FAF_Rates, sp_BulkZoneRate_AddPostCodeSurcharge, etc.). Namespace
// changed from BulkImport.Application.Domain.Models to
// RoutedOperations.Core.Domain.Models. Ppdrate + Discount live on TucClient
// itself so no separate model. All types kept keyless-registered in
// DespatchContextExtensions.cs.
namespace RoutedOperations.Core.Domain.Models;

/// <summary>
/// Result shape for scalar SP calls that return a single decimal named `rate`
/// (e.g. <c>SELECT dbo.UTL_fncMFV_FAF_Rates(...) as rate</c>).
/// </summary>
public class Rate
{
    public decimal? rate { get; set; }
}

/// <summary>
/// Result shape for <c>sp_BulkZoneRate_AddPostCodeSurcharge</c> and
/// <c>sp_BulkZoneRate_AdditionalSpecialRate</c>. Only <see cref="Rate"/> is
/// consumed.
/// </summary>
public class ZoneRate
{
    public decimal? Rate { get; set; }
}

/// <summary>
/// Result shape for <c>WS_stpJobType_Rates</c> / <c>WS_stpJobType_KmRates</c>
/// / <c>UTL_fncJob_ExceleratorRate</c>. Columns beyond
/// <see cref="JobTypeID"/> / <see cref="Rate"/> are optional but preserved so
/// callers that iterate a full row do not blow up on missing setters.
/// </summary>
public class UrgentRate
{
    public int JobTypeID { get; set; }
    public string Name { get; set; }
    public string Speed { get; set; }
    public decimal Rate { get; set; }
    public string Availability { get; set; }
    public DateTime? BookDate { get; set; }
}

/// <summary>
/// Result shape for <c>fncT_BulkZoneRate_WithLinehaul</c>. Every "*Amount"
/// column is nullable because the function returns NULL for legs that do not
/// apply to the requesting client / schedule combo.
/// </summary>
public class ZoneLinehaulRate
{
    public int BulkRunScheduleId { get; set; }
    public decimal? ZoneBaseAmount { get; set; }
    public decimal? PickupAmount { get; set; }
    public decimal? PickupBaseAmount { get; set; }
    public decimal? PickupAddtionItemAmount { get; set; }
    public decimal? LinehaulSumAmount { get; set; }
    public decimal? ZoneAmount { get; set; }
    public decimal? ZoneAddtionItemAmount { get; set; }
    public decimal? TotalAmount { get; set; }
    public string Description { get; set; }
}

/// <summary>
/// In-memory item queue the split/rating helpers build up during
/// <c>ProcessRoutedJobs</c>. Rows are flushed to <c>tblBulkJobItems</c> AFTER
/// <c>BulkInsertAsync</c> completes and the parent JobNumber -> BulkJobId map
/// is materialised (BulkInsertAsync does not round-trip identity columns).
/// </summary>
public class PendingBulkJobItem
{
    public string ParentJobNumber { get; set; }
    public int ItemId { get; set; }
    public int Items { get; set; } = 1;
    public double? Weight { get; set; }
    public double? Length { get; set; }
    public double? Height { get; set; }
    public double? Depth { get; set; }
    public decimal? Cubic { get; set; }
    public string Notes { get; set; }
    public string Barcode { get; set; }
}

/// <summary>
/// Base linehaul depot-endpoint shape. Both from-depot and to-depot get one.
/// </summary>
public class LinehaulAddressDto
{
    public LinehaulAddressDto()
    {
    }

    public string Company { get; set; }
    public string Address { get; set; }
    public string Suburb { get; set; }
    public int SuburbID { get; set; }
    public int PostCode { get; set; }
    public decimal? PickUpLatitude { get; set; }
    public decimal? PickUpLongitude { get; set; }
}

/// <summary>
/// Pickup-leg address container. Name preserved verbatim from the source
/// (typo included) so existing callers keep matching.
/// </summary>
public class PikupAddressDto : LinehaulAddressDto
{
    public PikupAddressDto()
    {
    }
}

/// <summary>
/// Keyless shape for the scalar <c>UTL_fncSuburb_FromNameWithPostCode</c>
/// function. Value returned as a single-column SuburbID.
/// </summary>
public class SuburbIDResult
{
    public int SuburbID { get; set; }
}
