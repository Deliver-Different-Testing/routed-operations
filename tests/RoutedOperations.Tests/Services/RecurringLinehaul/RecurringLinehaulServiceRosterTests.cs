using RoutedOperations.Core.Application.Dtos.RecurringLinehaul;
using RoutedOperations.Core.Application.Services.RecurringLinehaul;
using RoutedOperations.Core.Domain.Despatch;

namespace RoutedOperations.Tests.Services.RecurringLinehaul;

/// <summary>
/// Covers GetRosterGridAsync + UpsertRosterCellAsync + DeleteRosterCellAsync. Rounds
/// out with the DOW-range guard, target-type validation, non-existent-run guard, and
/// the soft-deactivation pattern (any prior active cell for the same (run, DOW) must
/// be flipped to IsActive=false before the new row is inserted).
/// </summary>
public class RecurringLinehaulServiceRosterTests
{
    private static RecurringLinehaulService NewSvc(
        out Core.Domain.DynamicDespatchDbContext seed,
        out Microsoft.EntityFrameworkCore.DbContextOptions<Core.Domain.DespatchContext> opts)
    {
        opts = RecurringLinehaulTestHarness.NewOptions();
        seed = RecurringLinehaulTestHarness.Context(opts);
        return new RecurringLinehaulService(RecurringLinehaulTestHarness.Factory(opts));
    }

    private static RecurringLinehaulService NewSvc(out Core.Domain.DynamicDespatchDbContext seed)
        => NewSvc(out seed, out _);

    private static void SeedDepots(Core.Domain.DynamicDespatchDbContext c)
    {
        c.TblBulkRegions.AddRange(
            new TblBulkRegion { BulkRegionId = 1, Name = "A", Active = true },
            new TblBulkRegion { BulkRegionId = 2, Name = "B", Active = true });
        c.SaveChanges();
    }

    // ── GetRosterGridAsync ────────────────────────────────────────────────

    [Fact]
    public async Task GetRosterGridAsync_EmptyReturnsNoRows()
    {
        var svc = NewSvc(out _);

        var grid = await svc.GetRosterGridAsync();

        Assert.Empty(grid.Rows);
    }

    [Fact]
    public async Task GetRosterGridAsync_ReturnsOneRowPerRunOrderedByName()
    {
        var svc = NewSvc(out var seed);
        SeedDepots(seed);
        seed.TblbulkLinehaulRuns.AddRange(
            new TblbulkLinehaulRun { Id = 1, RunName = "Zed", FromDepotId = 1, ToDepotId = 2, Mode = 1 },
            new TblbulkLinehaulRun { Id = 2, RunName = "Alpha", FromDepotId = 1, ToDepotId = 2, Mode = 1 });
        await seed.SaveChangesAsync();

        var grid = await svc.GetRosterGridAsync();

        Assert.Equal(new[] { "Alpha", "Zed" }, grid.Rows.Select(r => r.RunName).ToArray());
    }

    [Fact]
    public async Task GetRosterGridAsync_IgnoresInactiveCells()
    {
        var svc = NewSvc(out var seed);
        SeedDepots(seed);
        seed.TblbulkLinehaulRuns.Add(new TblbulkLinehaulRun { Id = 1, RunName = "R", FromDepotId = 1, ToDepotId = 2, Mode = 1 });
        seed.DispatchLinehaulRunRosters.Add(new DispatchLinehaulRunRoster
        {
            LinehaulRunRosterId = 1, LinehaulRunId = 1, DayOfWeek = 1,
            IsActive = false, TargetType = 1, CourierId = 5,
            CreatedAt = DateTime.UtcNow, CreatedBy = "test"
        });
        await seed.SaveChangesAsync();

        var grid = await svc.GetRosterGridAsync();

        Assert.Empty(grid.Rows.Single().Cells);
    }

    [Fact]
    public async Task GetRosterGridAsync_IgnoresDateOverrideCells()
    {
        var svc = NewSvc(out var seed);
        SeedDepots(seed);
        seed.TblbulkLinehaulRuns.Add(new TblbulkLinehaulRun { Id = 1, RunName = "R", FromDepotId = 1, ToDepotId = 2, Mode = 1 });
        seed.DispatchLinehaulRunRosters.Add(new DispatchLinehaulRunRoster
        {
            LinehaulRunRosterId = 1, LinehaulRunId = 1, DayOfWeek = 1,
            IsActive = true, TargetType = 1, CourierId = 5,
            RosterDate = new DateTime(2026, 8, 15),
            CreatedAt = DateTime.UtcNow, CreatedBy = "test"
        });
        await seed.SaveChangesAsync();

        var grid = await svc.GetRosterGridAsync();

        Assert.Empty(grid.Rows.Single().Cells);
    }

    [Fact]
    public async Task GetRosterGridAsync_ProjectsActiveCourierCells()
    {
        var svc = NewSvc(out var seed);
        SeedDepots(seed);
        seed.TucCouriers.Add(new TucCourier { UccrId = 5, UccrName = "Ada", UccrSurname = "Lovelace", Code = "AL", Active = true });
        seed.TblbulkLinehaulRuns.Add(new TblbulkLinehaulRun { Id = 1, RunName = "R", FromDepotId = 1, ToDepotId = 2, Mode = 1 });
        seed.DispatchLinehaulRunRosters.Add(new DispatchLinehaulRunRoster
        {
            LinehaulRunRosterId = 1, LinehaulRunId = 1, DayOfWeek = 3,
            IsActive = true, TargetType = 1, CourierId = 5,
            CreatedAt = DateTime.UtcNow, CreatedBy = "test"
        });
        await seed.SaveChangesAsync();

        var cell = (await svc.GetRosterGridAsync()).Rows.Single().Cells.Single();

        Assert.Equal(3, cell.DayOfWeek);
        Assert.Equal("Courier", cell.TargetType);
        Assert.Equal(5, cell.CourierId);
        Assert.Equal("Ada Lovelace", cell.CourierName);
        Assert.Equal("AL", cell.TargetHint);
    }

    [Fact]
    public async Task GetRosterGridAsync_ProjectsAgentCells()
    {
        var svc = NewSvc(out var seed);
        SeedDepots(seed);
        seed.TucAgents.Add(new TucAgent { UcagId = 6, UcagName = "Ag6", Association = "NP" });
        seed.TblbulkLinehaulRuns.Add(new TblbulkLinehaulRun { Id = 1, RunName = "R", FromDepotId = 1, ToDepotId = 2, Mode = 1 });
        seed.DispatchLinehaulRunRosters.Add(new DispatchLinehaulRunRoster
        {
            LinehaulRunRosterId = 1, LinehaulRunId = 1, DayOfWeek = 2,
            IsActive = true, TargetType = 2, AgentId = 6,
            CreatedAt = DateTime.UtcNow, CreatedBy = "test"
        });
        await seed.SaveChangesAsync();

        var cell = (await svc.GetRosterGridAsync()).Rows.Single().Cells.Single();

        Assert.Equal("Agent", cell.TargetType);
        Assert.Equal(6, cell.TargetId);
        Assert.Equal("Ag6", cell.TargetName);
        Assert.Null(cell.CourierId);
    }

    [Fact]
    public async Task GetRosterGridAsync_IncludesCouriersLookup()
    {
        var svc = NewSvc(out var seed);
        SeedDepots(seed);
        seed.TucCouriers.Add(new TucCourier { UccrId = 5, UccrName = "Ada", UccrSurname = "L", Code = "AL", Active = true });
        await seed.SaveChangesAsync();

        var grid = await svc.GetRosterGridAsync();

        Assert.Single(grid.Couriers);
        Assert.Equal(5, grid.Couriers[0].Id);
    }

    // ── UpsertRosterCellAsync ─────────────────────────────────────────────

    [Fact]
    public async Task UpsertRosterCellAsync_InvalidDayOfWeekLowReturnsNull()
    {
        var svc = NewSvc(out _);

        var res = await svc.UpsertRosterCellAsync(new LinehaulRosterUpsertDto
        {
            LinehaulRunId = 1, DayOfWeek = 0, TargetType = "Courier", TargetId = 1
        });

        Assert.Null(res);
    }

    [Fact]
    public async Task UpsertRosterCellAsync_InvalidDayOfWeekHighReturnsNull()
    {
        var svc = NewSvc(out _);

        var res = await svc.UpsertRosterCellAsync(new LinehaulRosterUpsertDto
        {
            LinehaulRunId = 1, DayOfWeek = 8, TargetType = "Courier", TargetId = 1
        });

        Assert.Null(res);
    }

    [Fact]
    public async Task UpsertRosterCellAsync_UnknownTargetTypeReturnsNull()
    {
        var svc = NewSvc(out _);

        var res = await svc.UpsertRosterCellAsync(new LinehaulRosterUpsertDto
        {
            LinehaulRunId = 1, DayOfWeek = 1, TargetType = "Bogus", TargetId = 1
        });

        Assert.Null(res);
    }

    [Fact]
    public async Task UpsertRosterCellAsync_ZeroTargetIdReturnsNull()
    {
        var svc = NewSvc(out _);

        var res = await svc.UpsertRosterCellAsync(new LinehaulRosterUpsertDto
        {
            LinehaulRunId = 1, DayOfWeek = 1, TargetType = "Courier", TargetId = 0
        });

        Assert.Null(res);
    }

    [Fact]
    public async Task UpsertRosterCellAsync_MissingRunReturnsNull()
    {
        var svc = NewSvc(out _);

        var res = await svc.UpsertRosterCellAsync(new LinehaulRosterUpsertDto
        {
            LinehaulRunId = 999, DayOfWeek = 1, TargetType = "Courier", TargetId = 5
        });

        Assert.Null(res);
    }

    [Fact]
    public async Task UpsertRosterCellAsync_HappyPathInsertsCell()
    {
        var svc = NewSvc(out var seed);
        SeedDepots(seed);
        seed.TucCouriers.Add(new TucCourier { UccrId = 5, UccrName = "Ada", UccrSurname = "L", Code = "AL", Active = true });
        seed.TblbulkLinehaulRuns.Add(new TblbulkLinehaulRun { Id = 1, RunName = "R", FromDepotId = 1, ToDepotId = 2, Mode = 1 });
        await seed.SaveChangesAsync();

        var res = await svc.UpsertRosterCellAsync(new LinehaulRosterUpsertDto
        {
            LinehaulRunId = 1, DayOfWeek = 4, TargetType = "Courier", TargetId = 5
        });

        Assert.NotNull(res);
        Assert.Equal(4, res!.DayOfWeek);
        Assert.Equal(5, res.CourierId);
        Assert.Equal("Courier", res.TargetType);
        Assert.Equal("Ada L", res.CourierName);
        Assert.Single(seed.DispatchLinehaulRunRosters.Where(x => x.IsActive));
    }

    [Fact]
    public async Task UpsertRosterCellAsync_SoftDeactivatesPreviousActiveCell()
    {
        var svc = NewSvc(out var seed, out var opts);
        SeedDepots(seed);
        seed.TucCouriers.AddRange(
            new TucCourier { UccrId = 5, UccrName = "Old", UccrSurname = "One", Code = "", Active = true },
            new TucCourier { UccrId = 6, UccrName = "New", UccrSurname = "Two", Code = "", Active = true });
        seed.TblbulkLinehaulRuns.Add(new TblbulkLinehaulRun { Id = 1, RunName = "R", FromDepotId = 1, ToDepotId = 2, Mode = 1 });
        seed.DispatchLinehaulRunRosters.Add(new DispatchLinehaulRunRoster
        {
            LinehaulRunRosterId = 100, LinehaulRunId = 1, DayOfWeek = 4,
            IsActive = true, TargetType = 1, CourierId = 5,
            CreatedAt = DateTime.UtcNow, CreatedBy = "test"
        });
        await seed.SaveChangesAsync();

        await svc.UpsertRosterCellAsync(new LinehaulRosterUpsertDto
        {
            LinehaulRunId = 1, DayOfWeek = 4, TargetType = "Courier", TargetId = 6
        });

        using var verify = RecurringLinehaulTestHarness.Verify(opts);
        var rows = verify.DispatchLinehaulRunRosters.OrderBy(r => r.LinehaulRunRosterId).ToList();
        Assert.Equal(2, rows.Count);
        Assert.False(rows[0].IsActive);
        Assert.True(rows[1].IsActive);
        Assert.Equal(6, rows[1].CourierId);
    }

    [Fact]
    public async Task UpsertRosterCellAsync_DoesNotDeactivateOtherDaysCells()
    {
        var svc = NewSvc(out var seed);
        SeedDepots(seed);
        seed.TucCouriers.Add(new TucCourier { UccrId = 5, UccrName = "F", UccrSurname = "L", Code = "", Active = true });
        seed.TblbulkLinehaulRuns.Add(new TblbulkLinehaulRun { Id = 1, RunName = "R", FromDepotId = 1, ToDepotId = 2, Mode = 1 });
        seed.DispatchLinehaulRunRosters.Add(new DispatchLinehaulRunRoster
        {
            LinehaulRunRosterId = 100, LinehaulRunId = 1, DayOfWeek = 2,
            IsActive = true, TargetType = 1, CourierId = 5,
            CreatedAt = DateTime.UtcNow, CreatedBy = "test"
        });
        await seed.SaveChangesAsync();

        await svc.UpsertRosterCellAsync(new LinehaulRosterUpsertDto
        {
            LinehaulRunId = 1, DayOfWeek = 5, TargetType = "Courier", TargetId = 5
        });

        Assert.Equal(2, seed.DispatchLinehaulRunRosters.Count(r => r.IsActive));
    }

    [Fact]
    public async Task UpsertRosterCellAsync_AgentPathInsertsWithAgentId()
    {
        var svc = NewSvc(out var seed);
        SeedDepots(seed);
        seed.TucAgents.Add(new TucAgent { UcagId = 6, UcagName = "Ag6", Association = "NP" });
        seed.TblbulkLinehaulRuns.Add(new TblbulkLinehaulRun { Id = 1, RunName = "R", FromDepotId = 1, ToDepotId = 2, Mode = 1 });
        await seed.SaveChangesAsync();

        var res = await svc.UpsertRosterCellAsync(new LinehaulRosterUpsertDto
        {
            LinehaulRunId = 1, DayOfWeek = 3, TargetType = "Agent", TargetId = 6
        });

        Assert.NotNull(res);
        Assert.Equal("Agent", res!.TargetType);
        Assert.Equal(6, res.TargetId);
        Assert.Null(res.CourierId);
        Assert.Equal("Ag6", res.TargetName);
        var row = seed.DispatchLinehaulRunRosters.Single(r => r.IsActive);
        Assert.Equal(6, row.AgentId);
        Assert.Null(row.CourierId);
        Assert.Equal((byte?)2, row.TargetType);
    }

    // ── DeleteRosterCellAsync ─────────────────────────────────────────────

    [Fact]
    public async Task DeleteRosterCellAsync_MissingReturnsFalse()
    {
        var svc = NewSvc(out _);

        var ok = await svc.DeleteRosterCellAsync(999);

        Assert.False(ok);
    }

    [Fact]
    public async Task DeleteRosterCellAsync_SoftDeletesActiveRow()
    {
        var svc = NewSvc(out var seed, out var opts);
        seed.DispatchLinehaulRunRosters.Add(new DispatchLinehaulRunRoster
        {
            LinehaulRunRosterId = 1, LinehaulRunId = 1, DayOfWeek = 1,
            IsActive = true, TargetType = 1, CourierId = 5,
            CreatedAt = DateTime.UtcNow, CreatedBy = "test"
        });
        await seed.SaveChangesAsync();

        var ok = await svc.DeleteRosterCellAsync(1);

        Assert.True(ok);
        using var verify = RecurringLinehaulTestHarness.Verify(opts);
        Assert.False(verify.DispatchLinehaulRunRosters.Single().IsActive);
    }
}
