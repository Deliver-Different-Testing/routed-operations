namespace RoutedOperations.Core.Application.Services.Territory;

/// <summary>
/// Review r3: the apply refused because the group changed after the preview
/// was made. It is the one refusal the upload panel answers by previewing the
/// file again, so the controller marks it with <c>code: "stale"</c>. Every
/// other refusal stays a plain <see cref="InvalidOperationException"/>.
/// </summary>
public sealed class ZoneGroupImportStaleException() : InvalidOperationException(UserMessage)
{
    public const string UserMessage =
        "This group has changed since the preview was made, so nothing was saved. "
        + "Upload the file again to see the differences against the group as it is now.";
}
