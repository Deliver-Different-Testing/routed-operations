#nullable disable
using System.ComponentModel.DataAnnotations.Schema;

namespace RoutedOperations.Core.Domain.Despatch;

/// <summary>
/// Vehicle preset with a cubic capacity ceiling. Feeds the Build Runs config
/// modal's Vehicle Capacity dropdown so operators can pick a known vehicle
/// instead of typing the m^3 value by hand.
/// </summary>
[Table("VehicleSize")]
public partial class VehicleSize
{
    [Column("VehicleSizeID")]
    public int VehicleSizeId { get; set; }
    public string VehicleName { get; set; }
    public decimal? CubicCapacity { get; set; }
}
