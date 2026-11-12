// Implementation of IBranchScopeResolver. Reads the BranchIds claim Hub stamps
// next to ClientTypeId / NpAgentId (B1). Branch changes take effect at the next
// login or token refresh.
using DeliverDifferent.AccessControl;
using Microsoft.AspNetCore.Http;

namespace RoutedOperations.Core.Application.Services.Branches;

public class BranchScopeResolver(IHttpContextAccessor httpContextAccessor) : IBranchScopeResolver
{
    public const string ClaimType = "BranchIds";
    private const string CacheKey = "BranchScope";

    public BranchScope Resolve()
    {
        var http = httpContextAccessor.HttpContext;
        if (http is null) return BranchScope.Unrestricted;

        if (http.Items.TryGetValue(CacheKey, out var cached) && cached is BranchScope prior)
            return prior;

        var scope = ResolveFromClaims(http);
        http.Items[CacheKey] = scope;
        return scope;
    }

    private static BranchScope ResolveFromClaims(HttpContext http)
    {
        var user = http.User;
        if (!CallerLane.IsStaff(user) || CallerLane.IsNetworkPartner(user))
            return BranchScope.Unrestricted;

        var raw = user.Claims.FirstOrDefault(c => c.Type == ClaimType)?.Value;
        return Parse(raw);
    }

    /// <summary>Parses the claim value. Public for tests.</summary>
    public static BranchScope Parse(string? raw)
    {
        if (string.IsNullOrWhiteSpace(raw)) return BranchScope.Unrestricted;

        var ids = new List<int>();
        foreach (var token in raw.Split(',', StringSplitOptions.TrimEntries | StringSplitOptions.RemoveEmptyEntries))
        {
            if (!int.TryParse(token, out var id) || id <= 0)
                return BranchScope.Restricted(Array.Empty<int>());
            ids.Add(id);
        }

        // "," or " , " - present but no ids. Treat as malformed, fail closed.
        return BranchScope.Restricted(ids);
    }
}
