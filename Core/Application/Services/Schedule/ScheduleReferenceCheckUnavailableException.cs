namespace RoutedOperations.Core.Application.Services.Schedule;

/// <summary>
/// The day-row reference check (what still uses a day the operator unticked)
/// could not run, so the save is refused rather than guessing. F1, Marcus
/// 18 Nov: a missing SELECT grant on dbo.ShopWindow surfaced as a bare
/// "HTTP 500". Derives from InvalidOperationException so the existing 400
/// arms in the controllers still catch it; MessageId ties the operator's
/// message to the logged database error.
/// </summary>
public sealed class ScheduleReferenceCheckUnavailableException(Guid messageId, Exception inner)
    : InvalidOperationException(UserMessage, inner)
{
    public const string UserMessage =
        "This day could not be removed because the system could not check what still uses it. Nothing was saved.";

    public Guid MessageId { get; } = messageId;
}
