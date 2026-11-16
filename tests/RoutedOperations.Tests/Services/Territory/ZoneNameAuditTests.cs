using System.Security.Claims;
using Microsoft.AspNetCore.Http;
using Microsoft.EntityFrameworkCore;
using RoutedOperations.Core.Application.Dtos.Territory;
using RoutedOperations.Core.Application.Services.Territory;
using RoutedOperations.Core.Domain;

namespace RoutedOperations.Tests.Services.Territory;

/// <summary>
/// #980: a zone name, zone group or zip zone created in Routed Operations
/// must carry LastModified / LastModifiedBy from the moment it exists.
///
/// The legacy AdminManager screen fills both on create, and the RO EF model
/// has no getdate() default on LastModified, so a create that only stamps
/// Created / CreatedBy writes NULL. That row then reads as "never touched,
/// author unknown" on every screen and report that sorts or filters by last
/// change, which is the row someone would most want the author of.
/// </summary>
public class ZoneNameAuditTests
{
    private const string Who = "vincent@example.test";

    private static DbContextOptions<DespatchContext> NewOptions() =>
        new DbContextOptionsBuilder<DespatchContext>()
            .UseInMemoryDatabase(Guid.NewGuid().ToString(), b => b.EnableNullChecks(false))
            .Options;

    private static TerritoryService Svc(DbContextOptions<DespatchContext> opts)
    {
        var factory = Substitute.For<IDbContextFactory<DynamicDespatchDbContext>>();
        factory.CreateDbContext().Returns(_ => new DynamicDespatchDbContext(opts));
        factory.CreateDbContextAsync(Arg.Any<CancellationToken>())
            .Returns(_ => Task.FromResult(new DynamicDespatchDbContext(opts)));

        var accessor = Substitute.For<IHttpContextAccessor>();
        accessor.HttpContext.Returns(new DefaultHttpContext
        {
            User = new ClaimsPrincipal(new ClaimsIdentity(new List<Claim>
            {
                new("CountryCode", "US"),
                new(ClaimTypes.Email, Who),
            })),
        });
        return new TerritoryService(factory, accessor);
    }

    [Fact]
    public async Task Created_zone_name_has_last_modified_equal_to_created()
    {
        var opts = NewOptions();
        var dto = await Svc(opts).CreateZoneNameAsync(new ZoneNameUpsertRequest { Name = "Inner West" });

        using var db = new DynamicDespatchDbContext(opts);
        var row = await db.ZoneNames.SingleAsync(z => z.ZoneNameId == dto.Id);
        Assert.NotNull(row.LastModified);
        Assert.Equal(row.Created, row.LastModified);
        Assert.Equal(Who, row.CreatedBy);
        Assert.Equal(row.CreatedBy, row.LastModifiedBy);
    }

    [Fact]
    public async Task Created_zone_group_has_last_modified_equal_to_created()
    {
        var opts = NewOptions();
        var dto = await Svc(opts).CreateZoneGroupAsync(new ZoneGroupUpsertRequest { Name = "Metro" });

        using var db = new DynamicDespatchDbContext(opts);
        var row = await db.ZoneGroups.SingleAsync(g => g.ZoneGroupId == dto.Id);
        Assert.NotNull(row.LastModified);
        Assert.Equal(row.Created, row.LastModified);
        Assert.Equal(Who, row.CreatedBy);
        Assert.Equal(row.CreatedBy, row.LastModifiedBy);
    }

    [Fact]
    public async Task Created_zip_zone_has_last_modified_equal_to_created()
    {
        var opts = NewOptions();
        var dto = await Svc(opts).CreateUsZipZoneAsync(new UsZipZoneUpsertRequest { Zip = "90210", ZoneNumber = 3 });

        using var db = new DynamicDespatchDbContext(opts);
        var row = await db.ZoneZips.SingleAsync(z => z.ZoneZipId == dto.Id);
        Assert.NotNull(row.LastModified);
        Assert.Equal(row.Created, row.LastModified);
        Assert.Equal(Who, row.CreatedBy);
        Assert.Equal(row.CreatedBy, row.LastModifiedBy);
    }
}
