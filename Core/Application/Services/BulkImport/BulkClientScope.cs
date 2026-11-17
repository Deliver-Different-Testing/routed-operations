using System.Linq.Expressions;
using DeliverDifferent.AccessControl;
using Microsoft.AspNetCore.Http;
using Microsoft.EntityFrameworkCore;
using RoutedOperations.Core.Application.Services.Branches;
using RoutedOperations.Core.Domain;
using RoutedOperations.Core.Domain.Despatch;

namespace RoutedOperations.Core.Application.Services.BulkImport;

/// <summary>
/// The one definition of "which clients may this Bulk Import caller see or act
/// for" (ro-bulk-import-customer-scope, spec B1).
///
/// Before this, the "linked client" rule was written out four times and the
/// copies disagreed: GetBulkJobs had no active filter, Import and the
/// ClientService reads required UcclActive, and GetSchedulesByBookDate only
/// looked at tblClientContact. Every Bulk Import read and write now goes
/// through here.
///
/// Rules:
///   * Staff = ClientTypeId 4 or 5 (CallerLane.IsStaff). Never the Internal
///     claim, which is the ucclInternal billing flag (Steve 2026-10-08).
///   * Anyone else is limited to the clients they are linked to through
///     tucClientContact (UcctId, Active) or tblClientContact (ContactId,
///     Contact.Active). No link means no clients (fail closed).
///   * "See" allows any linked client, active or not. That is the existing
///     job-list behaviour, which legacy BulkImportHyper shares.
///   * "Act for" (import, rate, book, void) also requires the client to be
///     active, as Import always has.
///
/// The client type comes from the caller's claims. The contact id passed in
/// is the ContactID claim, read by the controller (GetCurrentContactId); no
/// request field is ever used for scope.
///
/// The predicates are expressions so callers compose them into their own EF
/// query on their own DbContext rather than this class opening a second one.
/// </summary>
public interface IBulkClientScope
{
    /// <summary>Tenant staff or DF Admin (ClientTypeId 4/5).</summary>
    bool IsStaff { get; }

    /// <summary>
    /// May the caller send their own price, courier percentage, courier or
    /// pickup agent amounts? Staff only. Everyone else is rated by the rating
    /// functions (customer pricing = the client's rates, or the defaults).
    /// </summary>
    bool MaySetCommercialFields { get; }

    /// <summary>
    /// May the caller pick the courier when importing jobs as completed?
    /// Kept as its own switch because the Import as Completed decision is
    /// still open with Steve: flip this one property to change it.
    /// </summary>
    bool MayChooseCourierOnCompletedImport { get; }

    /// <summary>Clients the caller may see (any linked client; staff: all).</summary>
    Expression<Func<TucClient, bool>> CanSee(int contactId);

    /// <summary>Active clients the caller may act for (staff: every active client).</summary>
    Expression<Func<TucClient, bool>> CanActFor(int contactId);

    /// <summary>True when the caller may act for this client.</summary>
    Task<bool> CanActForClientAsync(DespatchContext context, int contactId, int clientId);

    /// <summary>
    /// The client ids the caller may act for, or null when unrestricted (staff).
    /// An empty set means nobody.
    /// </summary>
    Task<IReadOnlySet<int>?> ActForClientIdsAsync(DespatchContext context, int contactId);
}

public sealed class BulkClientScope(IHttpContextAccessor httpContextAccessor, IBranchScopeGuard? branchGuard = null) : IBulkClientScope
{
    // tucClient.ClientTypeId values every branch-limited staff member still sees (internal, tenant, DF Admin): the house accounts.
    private static readonly int[] HouseClientTypeIds = [1, 4, 5];

    // Branches B2c: tenant staff who hold branches act only for clients in their branches (a client with no branch belongs to the
    // default branch). Null when the caller is not branch limited, so existing behaviour is untouched.
    private Expression<Func<TucClient, bool>>? BranchLimit()
    {
        if (branchGuard is null || !branchGuard.IsRestricted) return null;
        var ids = branchGuard.BranchIds;
        var defaultInScope = branchGuard.DefaultBranchInScope;
        return c => (c.BranchId != null && ids.Contains(c.BranchId.Value))
                    || (c.BranchId == null && defaultInScope)
                    || HouseClientTypeIds.Contains(c.ClientTypeId);
    }

    private static Expression<Func<TucClient, bool>> And(Expression<Func<TucClient, bool>> a, Expression<Func<TucClient, bool>>? b)
    {
        if (b is null) return a;
        var body = Expression.AndAlso(a.Body, new ReplaceParameter(b.Parameters[0], a.Parameters[0]).Visit(b.Body));
        return Expression.Lambda<Func<TucClient, bool>>(body, a.Parameters);
    }

    private sealed class ReplaceParameter(ParameterExpression from, ParameterExpression to) : ExpressionVisitor
    {
        protected override Expression VisitParameter(ParameterExpression node) => node == from ? to : base.VisitParameter(node);
    }

    public bool IsStaff =>
        httpContextAccessor.HttpContext?.User is { } user && CallerLane.IsStaff(user);

    public bool MaySetCommercialFields => IsStaff;

    public bool MayChooseCourierOnCompletedImport => IsStaff;

    public Expression<Func<TucClient, bool>> CanSee(int contactId) =>
        IsStaff ? And(c => true, BranchLimit()) : Linked(contactId);

    public Expression<Func<TucClient, bool>> CanActFor(int contactId)
    {
        if (IsStaff) return And(c => c.UcclActive, BranchLimit());
        return c => c.UcclActive
            && (c.TucClientContacts.Any(x => x.UcctId == contactId && x.Active)
                || c.TblClientContacts.Any(x => x.ContactId == contactId && x.Contact.Active));
    }

    public Task<bool> CanActForClientAsync(DespatchContext context, int contactId, int clientId) =>
        context.TucClients.AsNoTracking()
            .Where(c => c.UcclId == clientId)
            .Where(CanActFor(contactId))
            .AnyAsync();

    public async Task<IReadOnlySet<int>?> ActForClientIdsAsync(DespatchContext context, int contactId)
    {
        if (IsStaff && BranchLimit() is null) return null;   // staff with no branches: unrestricted, as before
        var ids = await context.TucClients.AsNoTracking()
            .Where(CanActFor(contactId))
            .Select(c => c.UcclId)
            .ToListAsync();
        return ids.ToHashSet();
    }

    private static Expression<Func<TucClient, bool>> Linked(int contactId) =>
        c => c.TucClientContacts.Any(x => x.UcctId == contactId && x.Active)
             || c.TblClientContacts.Any(x => x.ContactId == contactId && x.Contact.Active);
}
