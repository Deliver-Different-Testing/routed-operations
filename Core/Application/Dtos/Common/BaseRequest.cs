namespace RoutedOperations.Core.Application.Dtos.Common;

public class BaseRequest
{
    public Guid MessageId { get; set; } = Guid.NewGuid();
}
