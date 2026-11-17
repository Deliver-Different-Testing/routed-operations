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
        if (http is null) return BranchScope.Unrestricted;   // background work: no request, no scope

        if (http.Items.TryGetValue(CacheKey, out var cached) && cached is BranchScope prior) return prior;

        var scope = ResolveFromClaims(http);
        http.Items[CacheKey] = scope;
        return scope;
    }

    private static BranchScope ResolveFromClaims(HttpContext http)
    {
        var user = http.User;

        // Only tenant staff are branch limited. Network partners (NP rules), DF Admin, customers and couriers never are.
        var clientTypeId = user.Claims.FirstOrDefault(c => c.Type == "ClientTypeId")?.Value;
        if (!CallerLane.IsStaff(user) || CallerLane.IsNetworkPartner(user) || clientTypeId == "5")
            return BranchScope.Unrestricted;

        return Parse(user.Claims.FirstOrDefault(c => c.Type == ClaimType)?.Value);
    }

    /// <summary>
    /// Empty or absent = unrestricted. Otherwise a comma list of positive ids; a single bad token makes the user
    /// restricted to NO branch (fail closed) rather than ignoring the token and widening what they see.
    /// </summary>
    public static BranchScope Parse(string? raw)
    {
        if (string.IsNullOrWhiteSpace(raw)) return BranchScope.Unrestricted;

        var ids = new List<int>();
        foreach (var token in raw.Split(',', StringSplitOptions.TrimEntries | StringSplitOptions.RemoveEmptyEntries))
        {
            if (!int.TryParse(token, out var id) || id <= 0) return BranchScope.Restricted([]);
            ids.Add(id);
        }

        // "," or " , ": present but holds no id. Malformed, so fail closed.
        return BranchScope.Restricted(ids);
    }
}
