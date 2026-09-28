namespace RoutedOperations.Tests.Services.RouteViewer;

/// <summary>
/// Collection marker that serialises every test class which mutates the NWShip
/// environment variables (WebAPIUrl, NWSHIP_API_TOKEN, TopUp*ClientID,
/// ReDelClientID).
///
/// Environment variables are process-global while xUnit runs test classes in
/// parallel, so two classes that set and clear the same variable race.
/// Concretely: RunViewerBookingControllerTests deliberately nulls WebAPIUrl to
/// exercise its "missing env var surfaces as 501" path, and any
/// NwShipBookingServiceTests test that happens to be mid-flight then reads null
/// and fails with "Route Viewer booking requires env var `WebAPIUrl`". The race
/// is pre-existing and intermittent - it only bites when the scheduler lines the
/// two classes up - so it looked like an unrelated flake.
///
/// Sharing one collection name makes xUnit run them one after another. Any
/// future test class that touches these variables should join this collection
/// rather than relying on luck.
/// </summary>
public static class NwShipEnvironment
{
    public const string CollectionName = "NwShip environment variables";
}
