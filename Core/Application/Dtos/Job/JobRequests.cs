namespace RoutedOperations.Core.Application.Dtos.Job;

public class UpdateJobDetailRequest
{
    public int JobId { get; set; }
    public string Field { get; set; } = string.Empty;
    public string Value { get; set; } = string.Empty;
}

public class UpdateGpsRequest
{
    public int JobId { get; set; }
    public string Address { get; set; } = string.Empty;
    public string Lat { get; set; } = string.Empty;
    public string Lng { get; set; } = string.Empty;
    public string PostCode { get; set; } = string.Empty;
}

public class VoidJobsRequest
{
    public List<int> JobIds { get; set; } = new();
    public bool IsVoid { get; set; }
    public DateTime RunDate { get; set; }
}

public class BulkUpdateRouteDateRequest
{
    public List<int> JobIds { get; set; } = new();
    public DateTime NewDate { get; set; }
    public string RunName { get; set; } = string.Empty;
}
