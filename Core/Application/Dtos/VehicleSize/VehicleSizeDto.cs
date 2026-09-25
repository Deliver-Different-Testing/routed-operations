namespace RoutedOperations.Core.Application.Dtos.VehicleSize;

public class VehicleSizeDto
{
    public int VehicleSizeId { get; set; }
    public string VehicleName { get; set; } = string.Empty;
    public decimal? CubicCapacity { get; set; }
}
