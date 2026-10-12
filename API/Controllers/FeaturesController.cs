using DeliverDifferent.AccessControl.Features;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Serilog;

namespace RoutedOperations.API.Controllers;

/// <summary>
/// The Access Control switches the current caller can see (Routed Ops switches
/// spec section 3). The SPA menu and route guard read this; [RequireFeature] on
/// the server asks the same resolver, so the two cannot disagree.
/// </summary>
/// <remarks>
/// Same contract as the configurator's endpoint: a sorted array of
/// feature keys. A DF Admin gets the union of every granted key, and the SPA
/// also skips the switches for them via bootstrap BypassesFeatureSwitches.
///
/// Deliberately only [Authorize], not a RouteBuilder / RouteViewer policy: a
/// caller those policies refuse (a customer today) still needs an answer, and
/// the answer for them is simply the keys their client type is granted.
/// </remarks>
[ApiController]
[Route("api/me")]
[Authorize]
public class FeaturesController(IClientTypeFeatureResolver resolver) : BaseController
{
    /// <summary>GET /api/me/visible-features</summary>
    [HttpGet("visible-features")]
    public async Task<ActionResult<string[]>> GetMyVisibleFeatures()
    {
        var messageId = Guid.NewGuid();
        Log.Information("({MessageId}) GET /api/me/visible-features", messageId);

        var keys = (await resolver.ResolveForCurrentUserAsync())
            .Order(StringComparer.Ordinal)
            .ToArray();

        // Count only: the list itself is long, and the same for every request
        // from a client type.
        Log.Information("({MessageId}) visible-features: {Count} keys", messageId, keys.Length);
        return Ok(keys);
    }
}
