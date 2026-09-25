namespace RoutedOperations.Core.Application.Dtos.Common;

public class BaseResponse(Guid messageId)
{
    public Guid MessageId { get; } = messageId;
    public bool Success { get; set; }
    public List<MessageDto> Messages { get; set; } = new();
    public object? Data { get; set; }
}
