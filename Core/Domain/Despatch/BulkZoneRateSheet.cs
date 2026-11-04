#nullable disable
namespace RoutedOperations.Core.Domain.Despatch;

/// <summary>
/// A named set of prices inside one zone group, so a group can carry more than
/// one price list (spec 11.1). CourierPayHere is the opt-in from 11.3: courier
/// pay is only read off a sheet that says it holds it.
///
/// BulkZoneRate.SheetId is NULL on every row today, and the rating function
/// treats NULL as "any sheet", so adding sheets does not change what anything
/// is charged until rows are assigned to one.
/// </summary>
public partial class BulkZoneRateSheet
{
    public int Id { get; set; }
    public int PostcodeGroupId { get; set; }
    public string Name { get; set; }
    public bool IsDefault { get; set; }
    public bool CourierPayHere { get; set; }
    public bool Active { get; set; } = true;
}
