// IBulkClientScope: the one definition of which clients a Bulk Import caller
// may see or act for. Every customer-facing Bulk Import read and write is cut
// down by it, so a wrong answer here is a cross-client leak everywhere.
using Microsoft.EntityFrameworkCore;
using RoutedOperations.Core.Application.Services.BulkImport;
using RoutedOperations.Core.Domain;
using RoutedOperations.Core.Domain.Despatch;

namespace RoutedOperations.Tests.Services.BulkImport;

public class BulkClientScopeTests
{
    internal const int Contact = 7;

    // Client 100: active, linked through tucClientContact.
    // Client 101: active, linked through tblClientContact (a multi-client contact).
    // Client 102: INACTIVE, linked through tblClientContact.
    // Client 103: active, linked through an INACTIVE tucClientContact row.
    // Client 200: active, belongs to someone else.
    internal static void SeedClients(DynamicDespatchDbContext seed)
    {
        seed.TucClients.AddRange(
            new TucClient { UcclId = 100, UcclCode = "A", UcclName = "Alpha", UcclActive = true },
            new TucClient { UcclId = 101, UcclCode = "B", UcclName = "Bravo", UcclActive = true },
            new TucClient { UcclId = 102, UcclCode = "C", UcclName = "Charlie", UcclActive = false },
            new TucClient { UcclId = 103, UcclCode = "D", UcclName = "Delta", UcclActive = true },
            new TucClient { UcclId = 200, UcclCode = "Z", UcclName = "Other", UcclActive = true });
        seed.TucClientContacts.AddRange(
            new TucClientContact { UcctId = Contact, UcctClientId = 100, Active = true, UcctFirstname = "C", UcctSurname = "U", UcctEmail = "c@u" },
            new TucClientContact { UcctId = 8, UcctClientId = 103, Active = false },
            new TucClientContact { UcctId = 9, UcctClientId = 200, Active = true });
        seed.TblClientContacts.AddRange(
            new TblClientContact { ClientContactId = 1, ClientId = 101, ContactId = Contact },
            new TblClientContact { ClientContactId = 2, ClientId = 102, ContactId = Contact },
            new TblClientContact { ClientContactId = 3, ClientId = 103, ContactId = 8 });
        seed.SaveChanges();
    }

    private static (BulkClientScope scope, DynamicDespatchDbContext ctx) Make(string? clientTypeId)
    {
        var opts = BulkImportTestHarness.NewOptions();
        var ctx = BulkImportTestHarness.Context(opts);
        SeedClients(ctx);
        return (new BulkClientScope(BulkImportTestHarness.Accessor("NZ", clientTypeId)), ctx);
    }

    [Theory]
    [InlineData("4")]
    [InlineData("5")]
    public async Task Staff_are_unrestricted_but_still_only_act_for_active_clients(string type)
    {
        var (scope, ctx) = Make(type);
        Assert.True(scope.IsStaff);
        Assert.True(scope.MaySetCommercialFields);
        Assert.Null(await scope.ActForClientIdsAsync(ctx, Contact));
        Assert.True(await scope.CanActForClientAsync(ctx, Contact, 200));
        Assert.False(await scope.CanActForClientAsync(ctx, Contact, 102));
        Assert.Equal(5, ctx.TucClients.Count(scope.CanSee(Contact)));
    }

    [Fact]
    public async Task Customer_acts_for_active_linked_clients_through_either_link_table()
    {
        var (scope, ctx) = Make("2");
        Assert.False(scope.IsStaff);
        Assert.False(scope.MaySetCommercialFields);
        Assert.False(scope.MayChooseCourierOnCompletedImport);

        var ids = await scope.ActForClientIdsAsync(ctx, Contact);
        Assert.Equal(new[] { 100, 101 }, ids!.OrderBy(i => i).ToArray());
        Assert.False(await scope.CanActForClientAsync(ctx, Contact, 200));
    }

    [Fact]
    public void Customer_sees_inactive_linked_clients_but_not_other_clients()
    {
        // The job list keeps showing an inactive client's pending jobs, as it
        // always has (and as legacy does); acting for it is refused.
        var (scope, ctx) = Make("2");
        var seen = ctx.TucClients.Where(scope.CanSee(Contact)).Select(c => c.UcclId).OrderBy(i => i).ToArray();
        Assert.Equal(new[] { 100, 101, 102 }, seen);
    }

    [Fact]
    public async Task Inactive_contact_link_grants_nothing()
    {
        var (scope, ctx) = Make("2");
        Assert.Empty((await scope.ActForClientIdsAsync(ctx, 8))!);
        Assert.False(await scope.CanActForClientAsync(ctx, 8, 103));
    }

    [Fact]
    public void TucClientContact_link_is_the_real_ucctClientID_column()
    {
        // The port mapped TucClient.TucClientContacts to a shadow FK
        // (TucClientUcclId) that tucClientContact does not have, so on SQL
        // Server the tucClientContact half of the scope rule could never match
        // and would error. InMemory cannot show that; the generated SQL can.
        var opts = new DbContextOptionsBuilder<DespatchContext>().UseSqlServer("Server=none;Database=none").Options;
        using var ctx = new DynamicDespatchDbContext(opts);
        var scope = new BulkClientScope(BulkImportTestHarness.Accessor("NZ", "2"));

        var sql = ctx.TucClients.Where(scope.CanActFor(Contact)).ToQueryString();

        Assert.Contains("[ucctClientID]", sql, StringComparison.OrdinalIgnoreCase);
        Assert.DoesNotContain("TucClientUcclId", sql);
    }

    [Theory]
    [InlineData("2")]
    [InlineData(null)]
    [InlineData("1")]
    public async Task Unknown_contact_or_non_staff_type_fails_closed(string? type)
    {
        var (scope, ctx) = Make(type);
        Assert.Empty((await scope.ActForClientIdsAsync(ctx, 4242))!);
        Assert.False(await scope.CanActForClientAsync(ctx, 4242, 100));
        Assert.Empty(ctx.TucClients.Where(scope.CanSee(4242)));
    }
}
