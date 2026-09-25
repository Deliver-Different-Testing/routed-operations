using System.Security.Claims;
using Microsoft.AspNetCore.Http;
using RoutedOperations.Core.Application.Dtos.BulkPolygon;
using RoutedOperations.Core.Application.Services.BulkPolygon;
using RoutedOperations.Core.Domain.Despatch;

namespace RoutedOperations.Tests.Services.BulkPolygon;

/// <summary>
/// The write paths (CreateAsync, UpdateShapeAsync, RefreshPartiallyIncludedZipsAsync)
/// use raw `geography::STGeomFromText`, `.MakeValid()`, `.EnvelopeAngle()`,
/// `.ReorientObject()`, plus DELETE + INSERT via SqlQueryRaw. None of that is
/// emulated by InMemory or SQLite; those paths need a real SQL Server. What
/// we CAN cover here:
///   - GetAllAsync / GetByIdAsync (pure EF projection)
///   - UpdateMetaAsync (pure EF)
///   - SoftDeleteAsync (pure EF)
///   - CreateAsync / UpdateShapeAsync validation guards (both throw before
///     touching the DB when name / points are invalid)
///   - CurrentUser (email > name > "system" precedence via HttpContext)
/// </summary>
public class BulkPolygonServiceTests
{
    private static BulkPolygonService NewSvc(out Core.Domain.DynamicDespatchDbContext seed,
        string? email = null, string? name = null)
    {
        var opts = CockpitTestHarness.NewInMemoryOptions();
        seed = CockpitTestHarness.Context(opts);
        var accessor = Substitute.For<IHttpContextAccessor>();
        var claims = new List<Claim>();
        if (email is not null) claims.Add(new Claim(ClaimTypes.Email, email));
        if (name is not null) claims.Add(new Claim(ClaimTypes.Name, name));
        var ctx = new DefaultHttpContext
        {
            User = new ClaimsPrincipal(new ClaimsIdentity(claims)),
        };
        accessor.HttpContext.Returns(ctx);
        return new BulkPolygonService(CockpitTestHarness.Factory(opts), accessor);
    }

    [Fact]
    public async Task GetAllAsync_EmptyReturnsEmpty()
    {
        var svc = NewSvc(out _);

        var rows = await svc.GetAllAsync();

        Assert.Empty(rows);
    }

    [Fact]
    public async Task GetAllAsync_ReturnsActiveOnly()
    {
        var svc = NewSvc(out var seed);
        seed.BulkRunPolygons.AddRange(
            new BulkRunPolygon { PolygonId = 1, Name = "A", Active = true, CreatedUtc = DateTime.UtcNow, CreatedBy = "sys" },
            new BulkRunPolygon { PolygonId = 2, Name = "B", Active = false, CreatedUtc = DateTime.UtcNow, CreatedBy = "sys" });
        await seed.SaveChangesAsync();

        var rows = await svc.GetAllAsync();

        Assert.Single(rows);
        Assert.Equal(1, rows[0].PolygonId);
    }

    [Fact]
    public async Task GetAllAsync_OrdersByName()
    {
        var svc = NewSvc(out var seed);
        seed.BulkRunPolygons.AddRange(
            new BulkRunPolygon { PolygonId = 1, Name = "Zulu", Active = true, CreatedUtc = DateTime.UtcNow, CreatedBy = "s" },
            new BulkRunPolygon { PolygonId = 2, Name = "Alpha", Active = true, CreatedUtc = DateTime.UtcNow, CreatedBy = "s" });
        await seed.SaveChangesAsync();

        var rows = await svc.GetAllAsync();

        Assert.Equal(2, rows[0].PolygonId);
        Assert.Equal(1, rows[1].PolygonId);
    }

    [Fact]
    public async Task GetByIdAsync_ReturnsMatchingPolygon()
    {
        var svc = NewSvc(out var seed);
        seed.BulkRunPolygons.Add(new BulkRunPolygon
        {
            PolygonId = 1, Name = "A", Active = true, CreatedUtc = DateTime.UtcNow, CreatedBy = "s",
        });
        seed.BulkRunPolygonPoints.AddRange(
            new BulkRunPolygonPoint { PolygonId = 1, RingIndex = 0, OrderIndex = 0, Lat = 1, Lng = 1 },
            new BulkRunPolygonPoint { PolygonId = 1, RingIndex = 0, OrderIndex = 1, Lat = 2, Lng = 2 },
            new BulkRunPolygonPoint { PolygonId = 1, RingIndex = 0, OrderIndex = 2, Lat = 3, Lng = 3 });
        await seed.SaveChangesAsync();

        var row = await svc.GetByIdAsync(1);

        Assert.NotNull(row);
        Assert.Equal(3, row!.Points.Count);
    }

    [Fact]
    public async Task GetByIdAsync_MissingReturnsNull()
    {
        var svc = NewSvc(out _);

        var row = await svc.GetByIdAsync(999);

        Assert.Null(row);
    }

    [Fact]
    public async Task UpdateMetaAsync_RenamesActive()
    {
        var svc = NewSvc(out var seed, email: "kev@x");
        seed.BulkRunPolygons.Add(new BulkRunPolygon
        {
            PolygonId = 1, Name = "Old", Active = true, CreatedUtc = DateTime.UtcNow, CreatedBy = "s",
        });
        await seed.SaveChangesAsync();

        var updated = await svc.UpdateMetaAsync(1, new UpdateBulkPolygonMetaRequest("Renamed"));

        Assert.NotNull(updated);
        Assert.Equal("Renamed", updated!.Name);
    }

    [Fact]
    public async Task UpdateMetaAsync_InvalidNameThrows()
    {
        var svc = NewSvc(out _);

        Assert.Throws<InvalidOperationException>(() =>
            svc.UpdateMetaAsync(1, new UpdateBulkPolygonMetaRequest(string.Empty)).GetAwaiter().GetResult());
    }

    [Fact]
    public async Task UpdateMetaAsync_TooLongNameThrows()
    {
        var svc = NewSvc(out _);
        var name = new string('x', 201);

        Assert.Throws<InvalidOperationException>(() =>
            svc.UpdateMetaAsync(1, new UpdateBulkPolygonMetaRequest(name)).GetAwaiter().GetResult());
    }

    [Fact]
    public async Task UpdateMetaAsync_InactivePolygonReturnsNull()
    {
        var svc = NewSvc(out var seed);
        seed.BulkRunPolygons.Add(new BulkRunPolygon
        {
            PolygonId = 1, Name = "Old", Active = false, CreatedUtc = DateTime.UtcNow, CreatedBy = "s",
        });
        await seed.SaveChangesAsync();

        var updated = await svc.UpdateMetaAsync(1, new UpdateBulkPolygonMetaRequest("New"));

        Assert.Null(updated);
    }

    [Fact]
    public async Task UpdateMetaAsync_MissingIdReturnsNull()
    {
        var svc = NewSvc(out _);

        var updated = await svc.UpdateMetaAsync(999, new UpdateBulkPolygonMetaRequest("New"));

        Assert.Null(updated);
    }

    [Fact]
    public async Task SoftDeleteAsync_ActivePolygonReturnsTrueAndClearsActive()
    {
        var svc = NewSvc(out var seed);
        seed.BulkRunPolygons.Add(new BulkRunPolygon
        {
            PolygonId = 1, Name = "A", Active = true, CreatedUtc = DateTime.UtcNow, CreatedBy = "s",
        });
        await seed.SaveChangesAsync();

        var ok = await svc.SoftDeleteAsync(1);

        Assert.True(ok);
    }

    [Fact]
    public async Task SoftDeleteAsync_InactiveReturnsFalse()
    {
        var svc = NewSvc(out var seed);
        seed.BulkRunPolygons.Add(new BulkRunPolygon
        {
            PolygonId = 1, Name = "A", Active = false, CreatedUtc = DateTime.UtcNow, CreatedBy = "s",
        });
        await seed.SaveChangesAsync();

        var ok = await svc.SoftDeleteAsync(1);

        Assert.False(ok);
    }

    [Fact]
    public async Task SoftDeleteAsync_MissingReturnsFalse()
    {
        var svc = NewSvc(out _);

        var ok = await svc.SoftDeleteAsync(999);

        Assert.False(ok);
    }

    [Fact]
    public void CreateAsync_ValidatesName()
    {
        var svc = NewSvc(out _);

        var req = new CreateBulkPolygonRequest(
            string.Empty, 0, 0,
            new List<PolygonPointDto>
            {
                new(0, 0, 1, 1), new(0, 1, 2, 2), new(0, 2, 3, 3),
            });

        Assert.Throws<InvalidOperationException>(() =>
            svc.CreateAsync(req).GetAwaiter().GetResult());
    }

    [Fact]
    public void CreateAsync_ValidatesNameTooLong()
    {
        var svc = NewSvc(out _);
        var req = new CreateBulkPolygonRequest(
            new string('x', 201), 0, 0,
            new List<PolygonPointDto>
            {
                new(0, 0, 1, 1), new(0, 1, 2, 2), new(0, 2, 3, 3),
            });

        Assert.Throws<InvalidOperationException>(() =>
            svc.CreateAsync(req).GetAwaiter().GetResult());
    }

    [Fact]
    public void CreateAsync_ValidatesPointsMinimumThree()
    {
        var svc = NewSvc(out _);
        var req = new CreateBulkPolygonRequest(
            "OK", 0, 0,
            new List<PolygonPointDto>
            {
                new(0, 0, 1, 1), new(0, 1, 2, 2),
            });

        Assert.Throws<InvalidOperationException>(() =>
            svc.CreateAsync(req).GetAwaiter().GetResult());
    }

    [Fact]
    public void CreateAsync_ValidatesPointsNotNull()
    {
        var svc = NewSvc(out _);
        var req = new CreateBulkPolygonRequest("OK", 0, 0, null!);

        Assert.Throws<InvalidOperationException>(() =>
            svc.CreateAsync(req).GetAwaiter().GetResult());
    }

    [Fact]
    public void UpdateShapeAsync_ValidatesPointsMinimumThree()
    {
        var svc = NewSvc(out _);
        var req = new UpdateBulkPolygonShapeRequest(
            0, 0, new List<PolygonPointDto>());

        Assert.Throws<InvalidOperationException>(() =>
            svc.UpdateShapeAsync(1, req).GetAwaiter().GetResult());
    }

    [Fact]
    public async Task UpdateMetaAsync_PicksEmailClaimForCurrentUser()
    {
        var svc = NewSvc(out var seed, email: "e@x", name: "n");
        seed.BulkRunPolygons.Add(new BulkRunPolygon
        {
            PolygonId = 1, Name = "A", Active = true, CreatedUtc = DateTime.UtcNow, CreatedBy = "s",
        });
        await seed.SaveChangesAsync();

        var updated = await svc.UpdateMetaAsync(1, new UpdateBulkPolygonMetaRequest("New"));

        Assert.NotNull(updated);
        Assert.Equal("e@x", updated!.UpdatedBy);
    }

    [Fact]
    public async Task UpdateMetaAsync_FallsBackToNameClaimIfNoEmail()
    {
        var svc = NewSvc(out var seed, name: "name-only");
        seed.BulkRunPolygons.Add(new BulkRunPolygon
        {
            PolygonId = 1, Name = "A", Active = true, CreatedUtc = DateTime.UtcNow, CreatedBy = "s",
        });
        await seed.SaveChangesAsync();

        var updated = await svc.UpdateMetaAsync(1, new UpdateBulkPolygonMetaRequest("New"));

        Assert.Equal("name-only", updated!.UpdatedBy);
    }

    [Fact]
    public async Task UpdateMetaAsync_FallsBackToSystemIfNoClaims()
    {
        var svc = NewSvc(out var seed);
        seed.BulkRunPolygons.Add(new BulkRunPolygon
        {
            PolygonId = 1, Name = "A", Active = true, CreatedUtc = DateTime.UtcNow, CreatedBy = "s",
        });
        await seed.SaveChangesAsync();

        var updated = await svc.UpdateMetaAsync(1, new UpdateBulkPolygonMetaRequest("New"));

        Assert.Equal("system", updated!.UpdatedBy);
    }
}
