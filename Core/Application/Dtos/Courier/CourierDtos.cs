namespace RoutedOperations.Core.Application.Dtos.Courier;

public class CourierDto
{
    public int CourierId { get; set; }
    public string Code { get; set; } = string.Empty;
    public string FirstName { get; set; } = string.Empty;
    public string DisplayName { get; set; } = string.Empty;
    public string? Fleet { get; set; }
}

public class FleetDto
{
    public string Fleet { get; set; } = string.Empty;
    public List<CourierDto> Couriers { get; set; } = new();
}
