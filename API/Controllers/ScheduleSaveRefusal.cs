using RoutedOperations.Core.Application.Services.Schedule;

namespace RoutedOperations.API.Controllers;

/// <summary>
/// Review r5: the 400 body for a refused schedule save, shared by every
/// caller of the save path (SchedulesV2Controller Create and Update, the
/// legacy SchedulesController Upsert). The F1 refusal (the day-row reference
/// check could not run) carries the MessageId its error was logged under, so
/// a user can quote it; every other refusal is its message alone.
/// </summary>
public static class ScheduleSaveRefusal
{
    public static object Body(InvalidOperationException ex) => ex is ScheduleReferenceCheckUnavailableException f1
        ? new { message = f1.Message, messageId = f1.MessageId }
        : new { message = ex.Message };
}
