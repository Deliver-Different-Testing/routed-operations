using RoutedOperations.API.Controllers;

namespace RoutedOperations.Tests.Controllers;

/// <summary>
/// M2 / B2 (2026-11-10). POST /api/v2/schedules/{id}/copy used to hardcode
/// CopyClientLinks = false, so the operator could never ask for the source's
/// clients to come along. The body now carries the choice and the controller
/// passes it through. Default stays off, which is what the old modal promised.
/// </summary>
public class SchedulesV2CopyRequestTests
{
    [Fact]
    public void Body_that_asks_for_client_links_reaches_the_service()
    {
        var body = new CopyScheduleRequest { NewName = "X (copy)", CopyClientLinks = true };

        var req = body.ToServiceRequest(42);

        Assert.Equal(42, req.SourceScheduleId);
        Assert.True(req.CopyClientLinks);
        Assert.Empty(req.ClientIds);
        Assert.Null(req.IsDefault);
    }

    [Fact]
    public void Body_that_says_nothing_copies_no_client_links()
    {
        var body = new CopyScheduleRequest { NewName = "X (copy)" };

        var req = body.ToServiceRequest(42);

        Assert.False(req.CopyClientLinks);
    }

    [Fact]
    public void Explicit_default_and_client_ids_pass_through()
    {
        var body = new CopyScheduleRequest
        {
            NewName = "X (copy)",
            ClientIds = new[] { 5, 6 },
            IsDefault = true,
        };

        var req = body.ToServiceRequest(42);

        Assert.Equal(new[] { 5, 6 }, req.ClientIds);
        Assert.True(req.IsDefault);
    }
}
